"""Merge the directory's own classification with the model estimate into one category per place (estimate layer last).

The served snapshot carries its classification (`sub_id` + `cls_confidence`), built from surveyors, rules and source
categories. `classify_poi.py` writes a model estimate for the same keys. This step joins them in a fixed order, so the
model only fills what the directory does not already know (docs/atlas-classification-policy.md):
  1. vacant (`--vacancy`, rows whose source = 'vacant'): stays «شاغر» and takes no estimate.
  2. the directory's sub at high confidence. Never overwritten.
  3. the directory's sub at medium confidence, unless the model names a different main at OVERRIDE_MIN or more.
  4. the directory's sub at low confidence when the model gives the same sub; else its main alone when the model gives
     the same main at CONFIRM_MIN or more. Two independent readings that agree are kept; a low one alone is not.
  5. the model's sub, for rows with no directory sub kept and a name that describes something.
  6. else the model's main only («تقدير»), else nothing («غير متاح»).
The thresholds are measured against surveyor labels the model never saw (docs/opportunity-map-improvement-log.md):
the main of a medium directory sub is right 78% of the time, 96.8% when the model agrees, and where the model names
another main at 0.80+ the model is right 96.4%; a low one is right 38%, 95.7% when the model agrees. A row the model read
from its English name alone needs the stricter CONFIRM_MIN_EN / OVERRIDE_MIN_EN.
Where the directory (high/medium) and the model give different subs, or the model overrode a medium one, the row is
flagged `needs_review`. A row whose text says nothing (every field the classifier reads is empty, a placeholder such as «False» or «null», a
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
from classify_poi import english, text_expr  # noqa: E402  the classifier's own text, so both steps agree on what is readable


CONFIRM_MIN, OVERRIDE_MIN = 0.60, 0.80
# When the model read an English name alone (most places a licence lists only by a machine-translated name), its
# agreement is weaker: measured on unseen surveyor places, an override at 0.80 is right 86.6% (94.8% at 0.90) and a low
# confirmation at 0.60 is right 93.0% (95.7% at 0.80). Those rows need the stricter gates.
CONFIRM_MIN_EN, OVERRIDE_MIN_EN = 0.80, 0.90


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

    # agreement reads the model's ungated top main, so it does not depend on the estimate's display gate; an older
    # estimates file without it falls back to the gated main
    est_cols = {r[0] for r in db.execute(f"describe select * from read_parquet('{a.estimates}')").fetchall()}
    top = ('cls_main_top top_main, cls_main_top_confidence top_conf' if 'cls_main_top' in est_cols
           else 'cls_main_estimate top_main, cls_main_confidence top_conf')
    db.execute(f"""create table m as
    with h as (
      select poi_key, name_ar, name_en, sub_id dir_sub, cls_confidence dir_conf, length({text_expr(db, a.targets)}) > 0 name_ok,
             length({text_expr(db, a.targets)}) > 0 and {text_expr(db, a.targets)} = trim({english(db, a.targets)}, ' |')
               english_only,
             case when sub_id is not null and sub_id not like 'unc.%' then sub_id end dir_valid
      from read_parquet('{a.targets}')),
     vac as ({vac}),
     est as (select poi_key, cls_sub_estimate est_sub, cls_sub_confidence est_sub_conf,
                    cls_main_estimate est_main, cls_main_confidence est_main_conf, {top} from read_parquet('{a.estimates}'))
    select h.*, sm.main_ar dir_main, vac.poi_key is not null is_vacant, est_sub, est_sub_conf, est_main, est_main_conf,
           top_main, top_conf
    from h left join submain sm on sm.sub_id = h.dir_valid left join vac using (poi_key) left join est using (poi_key)""")
    override_min = f'case when english_only then {OVERRIDE_MIN_EN} else {OVERRIDE_MIN} end'
    confirm_min = f'case when english_only then {CONFIRM_MIN_EN} else {CONFIRM_MIN} end'
    db.execute(f"""create table k as select m.*,
      coalesce(name_ok and dir_conf = 'medium' and top_main is not null and top_conf >= {override_min}
               and top_main <> dir_main, false) overridden,
      coalesce(name_ok and dir_conf not in ('high', 'medium') and est_sub = dir_valid
               and (not english_only or top_conf >= {CONFIRM_MIN_EN}), false) low_confirmed,
      coalesce(name_ok and dir_conf not in ('high', 'medium') and est_sub is distinct from dir_valid and top_main = dir_main
               and top_conf >= {confirm_min}, false) low_main_confirmed
    from m""")
    db.execute("""create table m2 as select k.*,
      case when dir_valid is null then null
           when dir_conf = 'high' or (dir_conf = 'medium' and not overridden) or low_confirmed then dir_valid end rules_sub
    from k""")

    db.execute("""create table f as
    select m2.*,
      case when is_vacant then null when rules_sub is not null then rules_sub
           when low_main_confirmed then null
           when name_ok and est_sub is not null then est_sub end final_sub,
      case when is_vacant then 'vacant' when low_confirmed then 'directory_low_confirmed'
           when rules_sub is not null then 'directory_' || dir_conf
           when low_main_confirmed then 'directory_low_main_confirmed'
           when name_ok and est_sub is not null then 'model_estimate'
           when name_ok and est_main is not null then 'model_estimate_main_only' else 'none' end final_source,
      case when is_vacant then null when low_confirmed then 'low+model:' || cast(round(est_sub_conf, 2) as varchar)
           when rules_sub is not null then dir_conf
           when low_main_confirmed then 'low+model_main:' || cast(round(est_main_conf, 2) as varchar)
           when name_ok and est_sub is not null then 'estimate:' || cast(round(est_sub_conf, 2) as varchar)
           when name_ok and est_main is not null then 'estimate_main:' || cast(round(est_main_conf, 2) as varchar)
      end final_confidence,
      coalesce(name_ok and rules_sub is not null and est_sub is not null and rules_sub <> est_sub, false) or overridden needs_review,
      not name_ok invalid_name,
      not is_vacant and name_ok and rules_sub is null and not low_main_confirmed and est_sub is not null model_added
    from m2""")
    db.execute("""create table o as
    select f.*, case when final_sub is not null then sm.main_ar
                     when final_source = 'directory_low_main_confirmed' then dir_main
                     when final_source = 'model_estimate_main_only' then est_main end final_main
    from f left join submain sm on sm.sub_id = f.final_sub""")
    db.execute(f"""copy (select poi_key, name_ar, name_en, final_sub, final_main, final_source, final_confidence,
                        needs_review, invalid_name, model_added, overridden, dir_sub, dir_conf, est_sub, est_sub_conf
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
        'overridden': one('select count(*) from o where overridden'),
        'with_final_main': one('select count(final_main) from o'),
        'thresholds': {'confirm_min': CONFIRM_MIN, 'override_min': OVERRIDE_MIN,
                       'confirm_min_english_only': CONFIRM_MIN_EN, 'override_min_english_only': OVERRIDE_MIN_EN},
        'english_only': one('select count(*) from o where english_only'),
        'invalid_name': one('select count(*) from o where invalid_name'),
        'vacant_kept': one("select count(*) from o where final_source = 'vacant'"),
        'coverage_before_pct': round(one("select count(dir_valid) from o where dir_conf in ('high', 'medium')") / n, 4) if n else 0,
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
