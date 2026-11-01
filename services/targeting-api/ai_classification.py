"""Measure the directory rows that have no usable activity, before any of them is classified.

The served activity of a business is its `sub_id` in poi_taxonomy.parquet at high or medium confidence (the filter in
market_analytics._where). A business with no such row, or only an `unc.*` / low-confidence one, is counted by no
activity figure on the map. This step counts those businesses and, for each, which evidence the current classifier
(services/data-cleaning/classify_poi.py) never reads but a later step could:

- licence activity (`license_activity_en`) and Google categories (`google_categories`);
- delivery-app signals (`delivery_rating` and its siblings), which only food places carry;
- a brand (`brand`), shared with branches that are classified;
- a phone number shared with a classified business.

It reads the two files only and writes nothing but its report. The report holds counts and shares, never a business
name, key, phone or coordinate, so it is safe in the service log. Columns a release does not carry count as absent.
"""
import duckdb

import canonical_data

SOURCE = 'ai_classification_profile_v2'
LOG_CITIES = 15   # cities kept in the log line; a line with every city was cut by the log collector
SERVED = ('high', 'medium')   # the confidences market_analytics counts
# a value that says nothing about the activity is read as absent (the same words classify_poi.py ignores)
EMPTY = ('', 'null', 'none', 'nan', 'false', 'true', 'n/a', 'na', '-', '.', '0', 'unknown', 'غير معروف', 'بدون', 'لا يوجد')
LETTER = '[A-Za-zء-ي]'
EVIDENCE = {   # report key -> columns, any of which counts
    'license_activity': ('license_activity_en',),
    'google_categories': ('google_categories',),
    'description': ('description_ar', 'description_en'),
    'delivery_signal': ('delivery_rating', 'delivery_rate_count', 'delivery_fee', 'delivery_min_order', 'delivery_eta'),
    'brand': ('brand',),
}
TEXT = ('name_ar', 'name_en', 'tradename', 'source_license_name', 'description_ar')


def _columns(db, path):
    return {row[0] for row in db.execute('describe select * from read_parquet(?)', [str(path)]).fetchall()}


def _present(column, have):
    """SQL true when the column exists and holds a value that names something (a letter, not a placeholder)."""
    if column not in have:
        return 'false'
    words = ', '.join("'" + w.replace("'", "''") + "'" for w in EMPTY)
    return (f"(p.{column} is not null and lower(trim(cast(p.{column} as varchar))) not in ({words}) "
            f"and (regexp_matches(cast(p.{column} as varchar), '{LETTER}') or try_cast(p.{column} as double) is not null))")


def _any(columns, have):
    parts = [_present(c, have) for c in columns if c in have]
    return '(' + ' or '.join(parts) + ')' if parts else 'false'


def profile(targets, taxonomy):
    """Counts of the businesses no activity figure counts, overall and per city, with the evidence each carries."""
    db = duckdb.connect()
    have = _columns(db, targets)
    city = 'p.city_en' if 'city_en' in have else "'unknown'"
    phone = "p.phone_norm" if 'phone_norm' in have else 'null'
    evidence = ',\n'.join(f"{_any(cols, have)} as {key}" for key, cols in EVIDENCE.items())
    db.execute(f"create temp table served as select distinct poi_key from read_parquet(?) "
               f"where confidence in {SERVED} and sub_id not like 'unc.%'", [str(taxonomy)])
    db.execute("create temp table labelled_low as select distinct poi_key from read_parquet(?) "
               "where confidence = 'low' and sub_id not like 'unc.%'", [str(taxonomy)])
    db.execute(f"""
        create temp table biz as
            select p.poi_key, coalesce({city}, 'unknown') city, {phone} phone,
                   s.poi_key is not null served, l.poi_key is not null low_label,
                   {_any(TEXT, have)} has_text,
                   {evidence}
            from (select * from read_parquet(?) qualify row_number() over (partition by poi_key) = 1) p
            left join served s using (poi_key) left join labelled_low l using (poi_key)
    """, [str(targets)])
    db.execute("""
        create temp table served_phones as select distinct phone from biz where served and phone is not null;
        create temp table gaps as
            select r.*, r.phone is not null and r.phone in (select phone from served_phones) shared_phone
            from biz r where not r.served;
    """)
    keys = list(EVIDENCE) + ['shared_phone']
    sums = ', '.join(f'count(*) filter (where {k})' for k in ['has_text', 'low_label'] + keys)
    any_evidence = ' or '.join(keys)

    def block(rows):
        n, text, low, *found = rows[:-1]
        return {'unclassified': n, 'with_text': text, 'with_low_label': low,
                'evidence': dict(zip(keys, found)), 'with_any_evidence': rows[-1]}

    total, served = db.execute('select count(*), count(*) filter (where served) from biz').fetchone()
    overall = db.execute(f'select count(*), {sums}, count(*) filter (where {any_evidence}) from gaps').fetchone()
    raw = db.execute(f'select city, count(*), {sums}, count(*) filter (where {any_evidence}) from gaps group by city').fetchall()
    db.close()
    # one spelling per city (canonical_data.CITY_ALIAS), so «Mecca» and «Makkah Al Mukarramah» are one row
    folded = {}
    for city, *counts in raw:
        name = (canonical_data.canonical_city(city) or (city,))[0]
        folded[name] = [a + b for a, b in zip(folded.get(name, [0] * len(counts)), counts)]
    cities = sorted(folded.items(), key=lambda item: (-item[1][0], item[0]))
    return {'source': SOURCE, 'businesses': total, 'served_activity': served,
            'missing_columns': sorted({c for cols in EVIDENCE.values() for c in cols} - have),
            **block(overall), 'cities': {name: block(counts) for name, counts in cities}}


def log_summary(report, cities=LOG_CITIES):
    """The report for one log line: the largest cities only (the full report is in the file), so the line is never cut."""
    names = list(report['cities'])
    return {**report, 'cities': {name: report['cities'][name] for name in names[:cities]}, 'other_cities': len(names[cities:])}
