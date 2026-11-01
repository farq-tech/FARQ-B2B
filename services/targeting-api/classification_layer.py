"""Publish the merged classification (services/data-cleaning/merge_classification.py) as the served activity layer.

The release's poi_taxonomy.parquet is what every activity figure reads (market_analytics._where, taxonomy_search). The
merged classification of 2026-10-30 adds a measured layer under it: low labels the model confirmed, model estimates at
their gates, and main activities alone where the sub is not known (docs/atlas-classification-policy.md). It was built
and measured but never served. This module turns it into two files beside the population folder, which outlive releases:

- `poi_taxonomy_ai.parquet`: the release classification with the merged decisions applied. A row the merge did not change
  is copied as it is. A changed row keeps what it replaced in `orig_sub_id` / `orig_confidence`, and says how it was
  decided (`ai_method`, `ai_evidence`, `ai_version`), so every edit is explained and can be undone row by row.
- `poi_main_only.parquet`: businesses whose main activity is known but not their sub. They count when a main activity
  is picked (market_analytics._where), never for a typed or sub activity, because their sub is not known.

The release files are never written. Which layer the figures read is one switch, FARQ_AI_CLASSIFICATION: off (or a
layer file missing) means the release classification exactly as before.
"""
import json
import os

import duckdb

VERSION = 'merge_2026_10_30_v1'
LAYER, MAIN_ONLY = 'poi_taxonomy_ai.parquet', 'poi_main_only.parquet'
SERVED = ('high', 'medium')
# merge_classification final_source -> how the served row was decided. The directory's own high/medium labels and
# vacant rows are not edits; everything else is.
METHODS = {'directory_low_confirmed': 'low_label_confirmed_by_model', 'model_estimate': 'model_estimate'}
MAIN_ONLY_METHODS = {'directory_low_main_confirmed': 'low_label_main_confirmed_by_model',
                     'model_estimate_main_only': 'model_estimate_main_only'}


def layer_dir():
    aux = os.environ.get('FARQ_TARGETING_AUX_DATA_DIR') or os.environ.get('FARQ_TARGETING_DATA_DIR') or ''
    return os.path.join(aux, 'ai_classification')


def enabled():
    return os.environ.get('FARQ_AI_CLASSIFICATION', '').strip().lower() in {'1', 'true', 'yes'}


def served_taxonomy(default):
    """The classification the figures read: the AI layer when switched on and built, else the release file."""
    path = os.path.join(layer_dir(), LAYER)
    return path if enabled() and os.path.isfile(path) else default


def main_only():
    """The main-only file when switched on and built, else None."""
    path = os.path.join(layer_dir(), MAIN_ONLY)
    return path if enabled() and os.path.isfile(path) and os.path.isfile(os.path.join(layer_dir(), LAYER)) else None


def build(taxonomy, merged, taxonomy_json, out_dir):
    """Write the two layer files from the release classification and the merged classification; returns counts only.

    Files are written beside their final names and moved into place last, so a reader never sees a partial layer."""
    with open(taxonomy_json, encoding='utf-8') as handle:
        mains = {s['main_ar']: s['main_id'] for s in json.load(handle)['subs']}
    os.makedirs(out_dir, exist_ok=True)
    layer, main_only_path = os.path.join(out_dir, LAYER), os.path.join(out_dir, MAIN_ONLY)
    db = duckdb.connect()
    db.execute('create table mains(main_ar varchar, main_id varchar)')
    db.executemany('insert into mains values (?, ?)', list(mains.items()))
    db.execute('create table methods(final_source varchar, method varchar)')
    db.executemany('insert into methods values (?, ?)', list(METHODS.items()))
    db.execute('create table main_methods(final_source varchar, method varchar)')
    db.executemany('insert into main_methods values (?, ?)', list(MAIN_ONLY_METHODS.items()))
    db.execute('create table orig as select * from read_parquet(?)', [str(taxonomy)])
    db.execute("""create table cur as select poi_key, any_value(sub_id) sub_id, any_value(confidence) confidence from orig
                  where confidence in ('high', 'medium') and sub_id not like 'unc.%' group by poi_key""")
    db.execute("""create table m as select poi_key, final_sub, final_main, final_source, final_confidence
                  from read_parquet(?) qualify row_number() over (partition by poi_key) = 1""", [str(merged)])
    # an edit: the merge serves a sub the release does not already serve for that business
    db.execute(f"""create table edits as
        select m.poi_key, m.final_sub sub_id, x.method ai_method, m.final_source || ':' || coalesce(m.final_confidence, '') ai_evidence
        from m join methods x using (final_source) left join cur c using (poi_key)
        where m.final_sub is not null and c.sub_id is distinct from m.final_sub""")
    original_columns = [r[0] for r in db.execute('describe orig').fetchall()]
    keep = ', '.join(f'o.{c}' for c in original_columns)
    db.execute(f"""create table out as
        select {keep}, null::varchar orig_sub_id, null::varchar orig_confidence, null::varchar ai_method,
               null::varchar ai_evidence, null::varchar ai_version
        from orig o where o.poi_key not in (select poi_key from edits)
        union all by name
        select e.poi_key, e.sub_id, 'ai_classification' as source, 'medium' as confidence,
               c.sub_id orig_sub_id, c.confidence orig_confidence, e.ai_method, e.ai_evidence, '{VERSION}' ai_version
        from edits e left join (select poi_key, any_value(sub_id) sub_id, any_value(confidence) confidence from orig
                                group by poi_key) c using (poi_key)""")
    db.execute(f"""create table mo as
        select m.poi_key, n.main_id, x.method ai_method, m.final_source || ':' || coalesce(m.final_confidence, '') ai_evidence,
               '{VERSION}' ai_version
        from m join main_methods x using (final_source) join mains n on n.main_ar = m.final_main
        where m.final_sub is null and m.poi_key not in (select poi_key from cur)""")
    for table, path in (('out', layer), ('mo', main_only_path)):
        partial = path + '.partial'
        db.execute(f"copy {table} to '{partial}' (format parquet, compression zstd)")
        os.replace(partial, path)
    one = lambda q: db.execute(q).fetchone()[0]
    report = {
        'version': VERSION,
        'served_before': one('select count(*) from cur'),
        'served_after': one("select count(distinct poi_key) from out where confidence in ('high', 'medium') and sub_id not like 'unc.%'"),
        'edits': dict(db.execute('select ai_method, count(*) from edits group by 1 order by 2 desc').fetchall()),
        'replaced_a_served_label': one('select count(*) from edits where poi_key in (select poi_key from cur)'),
        'main_only': dict(db.execute('select ai_method, count(*) from mo group by 1 order by 2 desc').fetchall()),
        'merged_main_unknown': one("select count(*) from m left join mains n on n.main_ar = m.final_main "
                                   "where m.final_main is not null and n.main_id is null"),
    }
    db.close()
    return report
