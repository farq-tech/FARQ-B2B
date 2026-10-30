"""Merge the directory's own classification with the model estimate into one category per place (estimate layer last).

The served snapshot carries its classification (`sub_id` + `cls_confidence`), built from surveyors, rules and source
categories. `classify_poi.py` writes a model estimate for the same keys. This step joins them in a fixed order, so the
model only fills what the directory does not already know (docs/atlas-classification-policy.md):
  1. vacant (`--vacancy`, rows whose source = 'vacant'): stays «شاغر» and takes no estimate.
  2. the directory's sub at high or medium confidence. Never overwritten.
  3. the model's sub, for rows with no confident directory sub and a name that describes something.
  4. else the model's main only («تقدير»), else nothing («غير متاح»).
Where the directory (high/medium) and the model give different subs, the directory sub stays and the row is flagged
`needs_review`. A row whose text says nothing (every field the classifier reads is empty, a placeholder such as «False» or «null», a
state such as «محل مغلق», or has no letter) never takes an estimate. That test is `classify_poi.text_expr`, so a row
the classifier scored from its trade name, licence name or description is not discarded here.

Reads every input read-only; writes a new parquet, a report and a review sample next to it. Never writes over an
existing file.

    python3 merge_classification.py --targets targets.parquet --estimates poi_estimates.parquet \
        --taxonomy farq_taxonomy.json --vacancy poi_taxonomy.parquet --out classification_merged.parquet
"""
import argparse
import json
import os
import pathlib
import sys

import duckdb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_poi import text_expr  # noqa: E402  the classifier's own text, so both steps agree on what is readable


def parse(argv):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--targets', required=True, help='served snapshot with poi_key, name_ar, name_en, sub_id, cls_confidence')
    p.add_argument('--estimates', required=True, help='classify_poi.py output')
    p.add_argument('--taxonomy', required=True, help='farq_taxonomy.json (sub_id -> main_ar)')
    p.add_argument('--vacancy', help='parquet with poi_key and source; rows with source = vacant stay «شاغر»')
    p.add_argument('--out', required=True)
    p.add_argument('--sample-seed', type=int, default=7)
    return p.parse_args(argv)


def main(argv=None):
    a = parse(argv)
    out = pathlib.Path(a.out)
    side = [out, out.with_suffix('.report.json'), out.with_name(out.stem + '_review_sample.csv')]
    inputs = {os.path.abspath(x) for x in (a.targets, a.estimates, a.taxonomy, a.vacancy) if x}
    for f in side:
        if f.exists() or os.path.abspath(f) in inputs:
            sys.exit(f'refusing to overwrite {f}')

    subs = json.load(open(a.taxonomy, encoding='utf-8'))['subs']
    db = duckdb.connect()
    db.execute('create table submain(sub_id varchar, main_ar varchar)')
    db.executemany('insert into submain values (?, ?)', [(s['sub_id'], s['main_ar']) for s in subs])
    vac = (f"select distinct poi_key from read_parquet('{a.vacancy}') where source = 'vacant'" if a.vacancy
           else 'select null::varchar poi_key where false')

    db.execute(f"""create table m as
    with h as (
      select poi_key, name_ar, name_en, sub_id dir_sub, cls_confidence dir_conf, length({text_expr(db, a.targets)}) > 0 name_ok,
             case when sub_id is not null and sub_id not like 'unc.%' and cls_confidence in ('high', 'medium') then sub_id end rules_sub
      from read_parquet('{a.targets}')),
     vac as ({vac}),
     est as (select poi_key, cls_sub_estimate est_sub, cls_sub_confidence est_sub_conf,
                    cls_main_estimate est_main, cls_main_confidence est_main_conf from read_parquet('{a.estimates}'))
    select h.*, vac.poi_key is not null is_vacant, est_sub, est_sub_conf, est_main, est_main_conf
    from h left join vac using (poi_key) left join est using (poi_key)""")

    db.execute("""create table f as
    select m.*,
      case when is_vacant then null when rules_sub is not null then rules_sub
           when name_ok and est_sub is not null then est_sub end final_sub,
      case when is_vacant then 'vacant' when rules_sub is not null then 'directory_' || dir_conf
           when name_ok and est_sub is not null then 'model_estimate'
           when name_ok and est_main is not null then 'model_estimate_main_only' else 'none' end final_source,
      case when is_vacant then null when rules_sub is not null then dir_conf
           when name_ok and est_sub is not null then 'estimate:' || cast(round(est_sub_conf, 2) as varchar)
           when name_ok and est_main is not null then 'estimate_main:' || cast(round(est_main_conf, 2) as varchar)
      end final_confidence,
      coalesce(rules_sub is not null and est_sub is not null and rules_sub <> est_sub, false) needs_review,
      not name_ok invalid_name,
      not is_vacant and name_ok and rules_sub is null and est_sub is not null model_added
    from m""")
    db.execute("""create table o as
    select f.*, case when final_sub is not null then sm.main_ar
                     when final_source = 'model_estimate_main_only' then est_main end final_main
    from f left join submain sm on sm.sub_id = f.final_sub""")
    db.execute(f"""copy (select poi_key, name_ar, name_en, final_sub, final_main, final_source, final_confidence,
                        needs_review, invalid_name, model_added, dir_sub, dir_conf, est_sub, est_sub_conf
                 from o order by poi_key) to '{out}' (format parquet, compression zstd)""")

    one = lambda q: db.execute(q).fetchone()[0]
    n = one('select count(*) from o')
    rep = {
        'inputs': {'targets': a.targets, 'estimates': a.estimates, 'taxonomy': a.taxonomy, 'vacancy': a.vacancy},
        'rows': n,
        'with_final_sub': one('select count(final_sub) from o'),
        'by_source': dict(db.execute('select final_source, count(*) from o group by 1 order by 2 desc').fetchall()),
        'model_added_sub': one('select count(*) from o where model_added'),
        'needs_review': one('select count(*) from o where needs_review'),
        'invalid_name': one('select count(*) from o where invalid_name'),
        'vacant_kept': one("select count(*) from o where final_source = 'vacant'"),
        'coverage_before_pct': round(one('select count(rules_sub) from o') / n, 4) if n else 0,
        'coverage_after_pct': round(one('select count(final_sub) from o') / n, 4) if n else 0,
        'by_main': dict(db.execute('select coalesce(final_main, \'غير متاح\'), count(*) from o group by 1 order by 2 desc').fetchall()),
    }
    side[1].write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding='utf-8')
    s = a.sample_seed
    # sample within each bucket (a SAMPLE clause runs before WHERE, so it would sample the whole table first)
    pick = lambda where, n, tag: (f"(select * from (select '{tag}' bucket, poi_key, name_ar, name_en, final_sub, final_main, "
                                  f"final_confidence, dir_sub, est_sub from o where {where}) using sample {n} rows (reservoir, {s}))")
    db.execute(f"""copy ({pick('model_added', 100, 'model_added')} union all {pick('needs_review', 60, 'needs_review')}
                       union all {pick('invalid_name', 40, 'invalid_name')}) to '{side[2]}' (header, delimiter ',')""")
    side[2].write_bytes(b'\xef\xbb\xbf' + side[2].read_bytes())   # BOM so a spreadsheet opens the Arabic correctly
    print(json.dumps({k: v for k, v in rep.items() if k not in ('by_main', 'inputs')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
