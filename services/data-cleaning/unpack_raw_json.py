"""Unpack every field of HudHud's `raw_json` into columns, one row per place, from either source:
- the CR database (crs_fixed.duckdb, table `crs`, 256,963 change requests): `raw_json.data.last_log` is what the surveyor's
  CR set — names, phone and extra phones, website, e-mail, socials, licence, national address, street, hours, …;
- the logs database (hudhud.db, table `poi_logs`, 371,426 logs): `raw_json` there holds only names, trade name,
  coordinates, duplicate_of_id and the log's metadata (import_poi_logs_db.py reads duplicate_of_id from it).

Rules:
- the keys are profiled first (every key with how many records hold a value); a key the script does not know is listed
  in the report (`not_unpacked`), so a new key in a later export is seen, not lost;
- for every place the LATEST approved record is kept (CR: cr_entity_id by cr_created_at, then cr_id; logs: cr_id by
  created_at, then id), as import_crs_full.py and import_poi_logs_db.py do;
- every value is checked by the pattern import_crs_full.py uses for that field (crs_patterns.py); a key with no pattern
  there gets a narrow one here. A value that fails is dropped and counted, never guessed; a coordinate pair is kept whole
  or not at all; a list keeps only its items that pass;
- the result is compared with crs_latest.parquet: per field, how many values it adds there.
Phones and accounts enter the directory only; nothing is sent to them.

Reads the database (read-only) and crs_latest.parquet; writes a new parquet and a report next to it. Never writes over
its inputs or an existing file.

    python3 unpack_raw_json.py --db crs_fixed.duckdb --crs crs_latest.parquet --out crs_raw_json.parquet
    python3 unpack_raw_json.py --db hudhud.db --crs crs_latest.parquet --out poi_logs_raw_json.parquet
"""
import argparse
import collections
import json
import os
import re
import sqlite3
import sys

import duckdb
import pyarrow as pa

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crs_patterns import AR, CHECK  # noqa: E402

EMPTY = ('', 'null', 'none', 'nan', '[]', '{}')
DIGITS = re.compile(r'^[0-9]+(\.0)?$')
WHEN = re.compile(r'^20[0-9]{2}-[01][0-9]-[0-3][0-9]([ T][0-2][0-9]:[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-][0-9:]{2,5})?)?$')
USER = re.compile(r'^[\w.@+-]{1,80}$')
URL = re.compile(r'^https?://\S+$')


def text(v):
    """A raw_json value as text: a bool as true/false, a list or object as JSON; an empty or null-like value as ''."""
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (list, dict)):
        v = json.dumps(v, ensure_ascii=False)
    v = str(v).strip()
    return '' if v.lower() in EMPTY else v


def pattern(ok):
    """A field check from a text check: the value as text when it passes, else None."""
    return lambda v: (lambda t: t if t and ok(t) else None)(text(v))


def links(ok):
    """A field that may hold one link or a list of them: one link as text, a list as a JSON list of the links that pass."""
    def check(v):
        if not isinstance(v, list):
            return pattern(ok)(v)
        good = [t for t in map(text, v) if t and ok(t)]
        return json.dumps(good, ensure_ascii=False) if good else None
    return check


def hours(v):
    """Opening hours as the regular_hours JSON list (crs_latest's format), when it is one."""
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return None
    if isinstance(v, dict):
        v = v.get('regular_hours')
    t = text(v) if isinstance(v, list) else ''
    return t if t and CHECK['opening_hours_regular_hours'](t) else None


def extra_phones(v):
    """The extra numbers in additional_feature.phone_numbers that pass the phone pattern, as a JSON list."""
    found = v.get('phone_numbers') if isinstance(v, dict) else None
    return links(CHECK['phone_number'])(found) if isinstance(found, list) else None


def media(v):
    """The media URLs of a media list, as a JSON list."""
    urls = [m.get('media_url') for m in v if isinstance(m, dict)] if isinstance(v, list) else []
    return links(URL.match)(urls) if urls else None


def point(v):
    """A GeoJSON point inside Saudi Arabia's box, as JSON."""
    c = v.get('coordinates') if isinstance(v, dict) and v.get('type') == 'Point' else None
    ok = isinstance(c, list) and len(c) == 2 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in c)
    return text(v) if ok and CHECK['longitude'](str(c[0])) and CHECK['latitude'](str(c[1])) else None


ID, BOOL, FREE = pattern(DIGITS.match), pattern(lambda t: t in ('true', 'false')), pattern(lambda t: not t.startswith('http') and len(t) < 2000)
# raw_json key -> (output column, check). A check named after a CHECK key is import_crs_full.py's; the rest are this script's.
FIELDS = {k: (k, pattern(CHECK[k])) for k in (
    'name_ar', 'name_en', 'tradename', 'latitude', 'longitude', 'category_id', 'sub_categories_ids', 'review_status', 'status',
    'city_ar', 'city_en', 'district_ar', 'district_en', 'phone_number', 'website', 'email', 'instagram', 'x_link', 'snapchat',
    'tiktok', 'licenseno', 'national_address', 'building_no', 'postal_code', 'streetname_ar', 'streetname_en', 'duplicate_of_id',
    'google_id', 'description_ar', 'description_en', 'amenities_ids', 'brand_id', 'floorno', 'rating', 'reviews_count')}
FIELDS.update({k: (k, links(CHECK[k])) for k in ('menu_link', 'order_link', 'reservation_link')})
FIELDS.update({
    'opening_hours': ('opening_hours', hours), 'additional_feature': ('additional_phones', extra_phones), 'media': ('media_urls', media),
    'poi_geometry': ('poi_geometry', point), 'submission_location': ('submission_location', point),
    'id': ('log_id', ID), 'cr_id': ('cr_id', ID), 'transaction_id': ('transaction_id', ID), 'version_number': ('version_number', ID),
    'street_id': ('street_id', ID), 'district_id': ('district_id', ID), 'territory_id': ('territory_id', ID),
    'last_approved_log_id': ('last_approved_log_id', ID), 'physical_parent': ('physical_parent', ID), 'confidence': ('confidence', ID),
    'created_at': ('created_at', pattern(WHEN.match)), 'updated_at': ('updated_at', pattern(WHEN.match)),
    'created_by': ('created_by', pattern(USER.match)), 'updated_by': ('updated_by', pattern(USER.match)),
    'source_name': ('source_name', pattern(USER.match)), 'operation': ('operation', pattern(lambda t: t in ('create', 'update', 'delete'))),
    'region_ar': ('region_ar', pattern(lambda t: AR.search(t) and len(t) < 80)), 'secondary_no': ('secondary_no', pattern(re.compile(r'^[0-9]{4}$').match)),
    'google_url': ('google_url', pattern(URL.match)), 'license_link': ('license_link', pattern(URL.match)), 'logo': ('logo', pattern(URL.match)),
    'full_address_ar': ('full_address_ar', FREE), 'full_address_en': ('full_address_en', FREE), 'notes': ('notes', FREE),
    'rejection_reason': ('rejection_reason', FREE), 'verified_by_google': ('verified_by_google', FREE),
})
FIELDS.update({k: (k, BOOL) for k in ('is_deleted', 'is_iconic', 'is_landmark', 'is_new', 'is_regional', 'is_trending')})
# a key whose value is an object counts as empty (not as dropped) when this part of it is empty: {"regular_hours": []}
INNER = {'opening_hours': 'regular_hours', 'additional_feature': 'phone_numbers'}
META = ['poi_key', 'record_id', 'last_operation', 'deleted', 'verified_at', 'surveyor']
# this file's column -> crs_latest.parquet's column, for the comparison
VERSUS = {'name_ar': 'name_ar', 'name_en': 'name_en', 'tradename': 'tradename', 'phone_number': 'phone', 'website': 'website',
          'email': 'email', 'instagram': 'instagram', 'x_link': 'x_link', 'snapchat': 'snapchat', 'tiktok': 'tiktok',
          'licenseno': 'license_no', 'national_address': 'national_address', 'building_no': 'building_no', 'postal_code': 'postal_code',
          'streetname_ar': 'street_ar', 'streetname_en': 'street_en', 'district_ar': 'district_ar', 'district_en': 'district_en',
          'city_ar': 'city_ar', 'city_en': 'city_en', 'opening_hours': 'opening_hours', 'duplicate_of': 'duplicate_of',
          'google_id': 'google_id', 'menu_link': 'menu_link', 'order_link': 'order_link', 'reservation_link': 'reservation_link',
          'description_ar': 'description_ar', 'description_en': 'description_en', 'amenities_ids': 'amenities_ids',
          'brand_id': 'hh_brand_id', 'floorno': 'floorno', 'rating': 'rating', 'reviews_count': 'reviews_count', 'status': 'hh_status'}


def flatten(raw):
    """poi_logs raw_json as {key: value}, one level of nesting as `parent.child`; None when it is not a JSON object."""
    try:
        d = json.loads(raw) if raw else None
    except ValueError:
        return None
    if not isinstance(d, dict):
        return None
    flat = {}
    for k, v in d.items():
        if isinstance(v, dict):
            flat.update({f'{k}.{k2}': v2 for k2, v2 in v.items()})
        else:
            flat[k] = v
    return flat


def last_log(raw, others):
    """CR raw_json's data.last_log; the other sections of data are counted in `others` (they are not unpacked)."""
    try:
        d = json.loads(raw) if raw else None
    except ValueError:
        return None
    data = d.get('data') if isinstance(d, dict) else None
    if not isinstance(data, dict) or not isinstance(data.get('last_log'), dict):
        return None
    others.update(f'data.{k}' for k, v in data.items() if k != 'last_log' and text(v))
    return data['last_log']


def read_crs(path, others):
    """(place, time, record id, operation, editor, status, entity type, fields) for every CR in crs_fixed.duckdb."""
    con = duckdb.connect(path, read_only=True)
    cur = con.execute("""select cr_entity_id, cr_created_at::varchar, cr_id, cr_operation, cr_created_by, cr_status, cr_entity_type, raw_json
                         from crs""")
    while batch := cur.fetchmany(5000):
        for place, at, rid, op, by, status, entity, raw in batch:
            yield place, at, rid, op, by, status, entity, last_log(raw, others)
    con.close()


def read_poi_logs(path, others):
    """The same for every log in hudhud.db's poi_logs (opened immutable)."""
    con = sqlite3.connect(f'file:{path}?immutable=1', uri=True)
    for place, at, rid, op, by, status, entity, raw in con.execute(
            'select cr_id, created_at, id, operation, created_by, status, entity_type, raw_json from poi_logs'):
        yield place, at, rid, op, by, status, entity, flatten(raw)
    con.close()


def clean(flat):
    """The checked columns of one record, and the keys whose value failed its check."""
    out, dropped = {}, []
    for key, (col, check) in FIELDS.items():
        v = flat.get(key)
        out[col] = check(v)
        inner = v.get(INNER[key]) if key in INNER and isinstance(v, dict) else v
        if out[col] is None and text(inner):
            dropped.append(key)
    # a coordinate is used only as a pair; half a pair is dropped, never paired with another source's half
    if (out['latitude'] is None) != (out['longitude'] is None):
        for key in ('latitude', 'longitude'):
            if out[key] is not None:
                out[key] = None
                dropped.append(key)
    for col in ('log_id', 'cr_id', 'transaction_id', 'version_number', 'duplicate_of_id', 'brand_id', 'category_id', 'reviews_count'):
        if out[col] is not None:
            out[col] = out[col].split('.')[0]
    out['duplicate_of'] = 'hh:' + out['duplicate_of_id'] if out['duplicate_of_id'] else None
    return out, dropped


def order(at, rid):
    return (at or '', int(rid.split('.')[0]) if DIGITS.match(rid or '') else -1)


def unpack(records, others):
    """The latest approved record per place as output rows, and the report's profile."""
    present, filled, kinds = collections.Counter(), collections.Counter(), collections.defaultdict(collections.Counter)
    n = bad = no_place = 0
    latest = {}
    for place, at, rid, op, by, status, entity, flat in records:
        n += 1
        if flat is None:
            bad += 1
            continue
        for k, v in flat.items():
            present[k] += 1
            kinds[k][type(v).__name__] += 1
            filled[k] += bool(text(v))
        if status != 'approved' or entity != 'poi':
            continue
        place = text(place).split('.')[0]
        if not place:
            no_place += 1
            continue
        rid = text(rid)
        if place not in latest or order(at, rid) > order(latest[place][1], latest[place][2]):
            latest[place] = (flat, at, rid, op, by)
    rows, valid, dropped = [], collections.Counter(), collections.Counter()
    for place, (flat, at, rid, op, by) in latest.items():
        cols, bad_keys = clean(flat)
        dropped.update(bad_keys)
        valid.update(k for k, (c, _) in FIELDS.items() if cols[c] is not None)
        deleted = op == 'delete' or cols['is_deleted'] == 'true'
        rows.append({'poi_key': 'hh:' + place, 'record_id': rid.split('.')[0], 'last_operation': op, 'deleted': deleted,
                     'verified_at': at, 'surveyor': by, **cols})
    profile = {
        'records': n, 'records_without_fields': bad, 'approved_records_without_place': no_place,
        'keys': {k: {'present': present[k], 'filled': filled[k], 'types': dict(kinds[k])} for k, _ in present.most_common()},
        'not_unpacked': {**{k: filled[k] for k in present if k not in FIELDS}, **dict(others)},
        'places': len(rows), 'places_deleted': sum(r['deleted'] for r in rows),
        'per_field': {k: {'valid': valid[k], 'dropped': dropped[k]} for k in FIELDS if present[k]},
    }
    return rows, profile, [c for k, (c, _) in FIELDS.items() if present[k]] + (['duplicate_of'] if present['duplicate_of_id'] else [])


def compare(db, out, crs, columns):
    """Per field, what this file adds over crs_latest.parquet: values for places crs_latest has with that field empty
    (`_live`: the place is not deleted here), values for places it does not have at all, and agreement where both have one.
    List and JSON fields can differ only in format (crs_latest comes from a flattened CSV), so `differs` is a ceiling there."""
    j = f"read_parquet('{out}') o left join read_parquet('{crs}') c using(poi_key)"
    fields = {}
    for ours in columns:
        theirs = VERSUS.get(ours)
        if theirs is None:
            continue
        q = db.execute(f"""select
            count(*) filter (where o.{ours} is not null and c.poi_key is not null and c.{theirs} is null),
            count(*) filter (where o.{ours} is not null and c.poi_key is not null and c.{theirs} is null and not o.deleted),
            count(*) filter (where o.{ours} is not null and c.poi_key is null),
            count(*) filter (where o.{ours} is not null and c.poi_key is null and not o.deleted),
            count(*) filter (where o.{ours} = c.{theirs}::varchar),
            count(*) filter (where o.{ours} <> c.{theirs}::varchar) from {j}""").fetchone()
        fields[ours] = dict(zip(('adds_where_crs_empty', 'adds_where_crs_empty_live', 'adds_place_not_in_crs',
                                 'adds_place_not_in_crs_live', 'same', 'differs'), q))
    for theirs in sorted(set(VERSUS.values()) - {VERSUS[c] for c in columns if c in VERSUS}):
        fields[theirs] = {'adds': 0, 'note': 'not in this raw_json'}
    places = db.execute(f"""select count(*), count(c.poi_key), count(*) filter (where c.poi_key is null and not o.deleted),
        count(*) filter (where o.deleted and c.poi_key is not null and not c.deleted), count(*) filter (where not o.deleted and c.deleted)
        from {j}""").fetchone()
    result = dict(zip(('places', 'places_in_crs', 'places_not_in_crs_live', 'deleted_here_live_in_crs', 'live_here_deleted_in_crs'), places))
    if 'phone_number' in columns:
        extra = 'o.additional_phones' if 'additional_phones' in columns else 'null'
        result['phones'] = dict(zip(('crs_places_given_a_first_phone_live', 'places_with_extra_phones', 'extra_phones'), db.execute(f"""select
            count(*) filter (where c.poi_key is not null and c.phone is null and not o.deleted and coalesce(o.phone_number, {extra}) is not null),
            count({extra}), coalesce(sum(json_array_length({extra})), 0) from {j}""").fetchone()))
    if 'opening_hours' in columns:
        # every day 00:00-00:00: open all day or a «no hours» placeholder; this step does not decide which
        result['opening_hours_adds_all_days_00_00'] = db.execute(f"""select count(*) from {j} where c.poi_key is not null
            and c.opening_hours is null and not o.deleted
            and list_distinct(regexp_extract_all(o.opening_hours, '"(?:open|close)": "([0-9:]+)"', 1)) = ['00:00']""").fetchone()[0]
    result['fields'] = fields
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--db', required=True, help='crs_fixed.duckdb (table crs) or hudhud.db (SQLite, table poi_logs); read-only')
    ap.add_argument('--crs', required=True, help='crs_latest.parquet from import_crs_full.py, for the comparison')
    ap.add_argument('--out', required=True, help='new parquet; the report is written beside it as .report.json')
    a = ap.parse_args(argv)
    report_path = os.path.splitext(a.out)[0] + '.report.json'
    inputs = {os.path.realpath(a.db), os.path.realpath(a.crs)}
    for path in (a.out, report_path):
        if os.path.realpath(path) in inputs:
            sys.exit(f'refusing to write over an input: {path}')
        if os.path.exists(path):
            sys.exit(f'refusing to overwrite {path}')
    others = collections.Counter()
    read = read_crs if a.db.endswith('.duckdb') else read_poi_logs
    rows, profile, columns = unpack(read(a.db, others), others)
    t = pa.table({c: pa.array([r[c] for r in rows], pa.bool_() if c == 'deleted' else pa.string()) for c in META + columns})
    db = duckdb.connect()
    db.register('t', t)
    coords = 'latitude::double latitude, longitude::double longitude' if 'latitude' in columns else ''
    db.execute(f"""copy (select * {'exclude (latitude, longitude), ' + coords if coords else ''} from t order by poi_key)
        to '{a.out}' (format parquet)""")
    report = {'db': os.path.abspath(a.db), 'source': 'crs.raw_json.data.last_log' if read is read_crs else 'poi_logs.raw_json',
              'crs': os.path.abspath(a.crs), 'out': os.path.abspath(a.out), 'profile': profile,
              'versus_crs_latest': compare(db, a.out, a.crs, columns)}
    with open(report_path, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    v = report['versus_crs_latest']
    print(json.dumps({'places': profile['places'], 'deleted': profile['places_deleted'], 'phones': v.get('phones'),
                      'adds_where_crs_empty_live': {k: f['adds_where_crs_empty_live'] for k, f in v['fields'].items() if 'adds_where_crs_empty_live' in f}},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
