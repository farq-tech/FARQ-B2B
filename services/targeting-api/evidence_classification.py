"""Classify unclassified businesses from evidence the name classifier never reads, each kind kept only if it measures.

Five kinds of evidence, each giving a candidate main activity (and a sub when it is unambiguous):

- `shared_phone`: every classified business with the same phone has one main (and one sub).
- `google_categories` / `license_activity`: the source labels, mapped through the taxonomy crosswalk
  (`activity_map.csv`, high/medium rows), name one main (and one sub).
- `description`: the official description holds the match words (`match_hints`) of one main (and one sub) only.
- `delivery_signal`: a delivery-app rating, fee or time: a food place, main only.

Before any kind labels a business, it is measured on businesses a surveyor classified (poi_taxonomy `source` in
TRUTH_SOURCES). The current classification is partly built from source categories, so agreeing with it would be
circular; a surveyor read the storefront. A kind is used at a level (main, sub) only when that level is right at least
`min_accuracy` of the time on at least `min_support` surveyed businesses. Each label carries its kind, the measured
accuracy as its confidence, and the evidence, so it is explained (docs/atlas-classification-policy.md).

Reads the release files and the crosswalk only; writes one parquet and returns a report of counts and accuracies.
"""
import csv
import json
import os
import re

import duckdb

VERSION = 'evidence_v1'
TRUTH_SOURCES = ('crs_surveyor',)
MIN_ACCURACY, MIN_SUPPORT = 0.95, 200
# a phone on more businesses than this is a call centre or a placeholder, not one owner's branches
MAX_PHONE_GROUP = 50
KINDS = ('shared_phone', 'google_categories', 'license_activity', 'description', 'delivery_signal')
DELIVERY = ('delivery_rating', 'delivery_rate_count', 'delivery_fee', 'delivery_min_order', 'delivery_eta')
OUT = 'poi_evidence_classification.parquet'


def _norm(text):
    return re.sub(r'\s+', ' ', re.sub(r'[^\w؀-ۿ]+', ' ', (text or '').lower())).strip()


def _crosswalk(path):
    rows = []
    with open(path, encoding='utf-8-sig') as handle:
        for row in csv.DictReader(handle):
            if row.get('confidence') in ('high', 'medium') and row.get('sub_id') and not row['sub_id'].startswith('unc.'):
                for raw in (row.get('raw_activity'), row.get('raw_ar')):
                    if raw and _norm(raw):
                        rows.append((_norm(raw), row['sub_id']))
    return sorted(set(rows))


def _hints(subs):
    rows = []
    for sub in subs:
        if sub['sub_id'].startswith(('unc.', 'noncom.')):
            continue
        for term in (sub.get('match_hints') or '').split('|'):
            term = _norm(term)
            if len(term) >= 4:
                rows.append((term, sub['sub_id']))
    return sorted(set(rows))


def build(targets, taxonomy, taxonomy_json, crosswalk, out_dir, min_accuracy=MIN_ACCURACY, min_support=MIN_SUPPORT):
    with open(taxonomy_json, encoding='utf-8') as handle:
        subs = json.load(handle)['subs']
    db = duckdb.connect()
    db.execute('create table tx(sub_id varchar, main_id varchar)')
    db.executemany('insert into tx values (?, ?)', [(s['sub_id'], s['main_id']) for s in subs])
    db.execute('create table xw(label varchar, sub_id varchar)')
    db.executemany('insert into xw values (?, ?)', _crosswalk(crosswalk))
    db.execute('create table hints(term varchar, sub_id varchar)')
    db.executemany('insert into hints values (?, ?)', _hints(subs))
    have = {r[0] for r in db.execute('describe select * from read_parquet(?)', [str(targets)]).fetchall()}
    col = lambda c, sql: sql if c in have else 'null'
    delivery = ' or '.join(f'{c} is not null' for c in DELIVERY if c in have) or 'false'
    norm_sql = "trim(regexp_replace(regexp_replace(lower({}), '[^[:alnum:]؀-ۿ]+', ' ', 'g'), '\\s+', ' ', 'g'))"
    db.execute(f"""create table b as select poi_key,
            {col('phone_norm', "nullif(right(regexp_replace(coalesce(phone_norm, ''), '[^0-9]', '', 'g'), 9), '')")} phone,
            {col('google_categories', 'google_categories')} gcats,
            {col('license_activity_en', norm_sql.format('license_activity_en'))} lic,
            {col('description_ar', "' ' || " + norm_sql.format('description_ar') + " || ' '")} descr,
            {delivery} has_delivery
        from read_parquet(?) qualify row_number() over (partition by poi_key) = 1""", [str(targets)])
    db.execute("""create table served as select c.poi_key, any_value(c.sub_id) sub_id, any_value(t.main_id) main_id,
                  bool_or(c.source in (select unnest(?::varchar[]))) surveyed
                  from read_parquet(?) c join tx t using (sub_id)
                  where c.confidence in ('high', 'medium') and c.sub_id not like 'unc.%' group by c.poi_key""",
               [list(TRUTH_SOURCES), str(taxonomy)])
    # only businesses that need a label, or that measure one, get candidates
    db.execute("""create table need as select poi_key from b where poi_key not in (select poi_key from served)
                  union select poi_key from served where surveyed""")
    db.execute(f"""create table phones as select phone from b where phone is not null group by phone
                   having count(*) between 2 and {MAX_PHONE_GROUP}""")
    # candidate labels per business and kind: (poi_key, kind, sub_id or null, main_id, evidence)
    db.execute("""create table cand(poi_key varchar, kind varchar, sub_id varchar, main_id varchar, evidence varchar)""")
    one = "case when count(distinct {k}) = 1 then any_value({k}) end"
    db.execute(f"""insert into cand
        select b.poi_key, 'shared_phone', {one.format(k='s.sub_id')}, {one.format(k='s.main_id')}, count(*) || ' classified with this phone'
        from b join b o on o.phone = b.phone and o.poi_key <> b.poi_key join served s on s.poi_key = o.poi_key
        where b.phone in (select phone from phones) and b.poi_key in (select poi_key from need) group by b.poi_key""")
    db.execute(f"""insert into cand
        select b.poi_key, 'google_categories', {one.format(k='t.sub_id')}, {one.format(k='t.main_id')}, string_agg(distinct x.label, '|')
        from b, unnest(regexp_split_to_array(lower(b.gcats), '\\s*[|,;]\\s*')) u(cat)
        join xw x on x.label = trim(regexp_replace(regexp_replace(u.cat, '[^[:alnum:]؀-ۿ]+', ' ', 'g'), '\\s+', ' ', 'g'))
        join tx t on t.sub_id = x.sub_id
        where b.gcats is not null and b.poi_key in (select poi_key from need) group by b.poi_key""")
    db.execute(f"""insert into cand
        select b.poi_key, 'license_activity', {one.format(k='t.sub_id')}, {one.format(k='t.main_id')}, any_value(x.label)
        from b join xw x on x.label = b.lic join tx t on t.sub_id = x.sub_id where b.poi_key in (select poi_key from need) group by b.poi_key""")
    db.execute(f"""insert into cand
        select b.poi_key, 'description', {one.format(k='t.sub_id')}, {one.format(k='t.main_id')}, string_agg(distinct h.term, '|')
        from b join hints h on b.descr like '% ' || h.term || ' %' join tx t on t.sub_id = h.sub_id
        where b.descr is not null and b.poi_key in (select poi_key from need) group by b.poi_key""")
    db.execute("insert into cand select poi_key, 'delivery_signal', null, 'food', 'delivery app signal' from b where has_delivery and poi_key in (select poi_key from need)")
    db.execute('delete from cand where main_id is null')

    # measure each kind on surveyed businesses
    measured = {}
    for kind in KINDS:
        n_main, ok_main, n_sub, ok_sub = db.execute("""
            select count(*), count(*) filter (where c.main_id = s.main_id),
                   count(c.sub_id), count(*) filter (where c.sub_id = s.sub_id)
            from cand c join served s using (poi_key) where s.surveyed and c.kind = ?""", [kind]).fetchone()
        main_acc = ok_main / n_main if n_main else None
        sub_acc = ok_sub / n_sub if n_sub else None
        measured[kind] = {
            'surveyed_support_main': n_main, 'main_accuracy': round(main_acc, 4) if main_acc is not None else None,
            'surveyed_support_sub': n_sub, 'sub_accuracy': round(sub_acc, 4) if sub_acc is not None else None,
            'use_main': bool(n_main >= min_support and main_acc is not None and main_acc >= min_accuracy),
            'use_sub': bool(n_sub >= min_support and sub_acc is not None and sub_acc >= min_accuracy),
        }
    db.execute('create table acc(kind varchar, use_main boolean, use_sub boolean, main_acc double, sub_acc double)')
    db.executemany('insert into acc values (?, ?, ?, ?, ?)',
                   [(k, m['use_main'], m['use_sub'], m['main_accuracy'], m['sub_accuracy']) for k, m in measured.items()])
    # label unclassified businesses: the most accurate accepted kind wins; a sub only where that kind is accepted at sub
    db.execute(f"""create table out as
        select c.poi_key, case when a.use_sub then c.sub_id end sub_id, c.main_id,
               'rules:' || c.kind ai_method, round(case when a.use_sub and c.sub_id is not null then a.sub_acc else a.main_acc end, 4) ai_confidence,
               c.evidence ai_evidence, '{VERSION}' ai_version
        from cand c join acc a using (kind)
        where a.use_main and c.poi_key not in (select poi_key from served)
        qualify row_number() over (partition by c.poi_key order by (a.use_sub and c.sub_id is not null) desc, a.main_acc desc, c.kind) = 1""")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, OUT)
    db.execute(f"copy out to '{path}.partial' (format parquet, compression zstd)")
    os.replace(path + '.partial', path)
    report = {
        'version': VERSION, 'min_accuracy': min_accuracy, 'min_support': min_support,
        'surveyed_truth': db.execute('select count(*) from served where surveyed').fetchone()[0],
        'kinds': measured,
        'labelled': db.execute('select count(*) from out').fetchone()[0],
        'labelled_with_sub': db.execute('select count(sub_id) from out').fetchone()[0],
        'phones_too_shared': db.execute(f'select count(*) from (select phone from b where phone is not null group by phone having count(*) > {MAX_PHONE_GROUP})').fetchone()[0],
        'by_method': dict(db.execute('select ai_method, count(*) from out group by 1 order by 2 desc').fetchall()),
    }
    db.close()
    return report
