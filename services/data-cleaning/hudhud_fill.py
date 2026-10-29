"""Fill empty fields of a directory snapshot from each place's current state in the full HudHud change-request database.

A step after the golden export and before publishing, like chain_consensus.py. Rules:
- only a field the snapshot leaves empty is filled; a value already there is never changed;
- only places live in HudHud (`ready to publish`, not deleted) and not permanently closed;
- every value is checked by its pattern and written in the snapshot's own format (phone +966…, account URLs, hours
  «Sun: 08:30 - 23:30 | …»); a value that fails is left out, never guessed;
- `hudhud_filled` lists the fields each row took from HudHud; a filled phone is the first mobile HudHud holds (its phone
  field, then the extra numbers in additional_feature), else the first landline, with `phone_source = hudhud_cr`;
- completeness_pct moves only when a filled phone, e-mail or website gives a row its first contact (build_golden.py).
Phones, e-mails and accounts enter the directory only; nothing is sent to them.

Reads the snapshot and the database (read-only); writes a new snapshot and a report next to it. Never writes over its input
or the served files.

    python3 hudhud_fill.py --targets T.parquet --crs crs_fixed.duckdb --out T_hudhud.parquet
"""
import argparse
import collections
import json
import os
import re
import sys

import duckdb

AR = re.compile('[؀-ۿ]')
DAYS = {'Sunday': 'Sun', 'Monday': 'Mon', 'Tuesday': 'Tue', 'Wednesday': 'Wed', 'Thursday': 'Thu', 'Friday': 'Fri', 'Saturday': 'Sat'}
FLOOR = re.compile(r'^(G|GF|M|MZ|B\d{0,2}|-?\d{1,3})$', re.I)
FLOOR_SAME = {'G': '0', 'GF': '0', 'MZ': 'M'}
ACCOUNT = {'instagram': ('instagram.com', 'https://instagram.com/{}'), 'x_link': ('(x|twitter).com', 'https://x.com/{}'),
           'tiktok': ('tiktok.com', 'https://www.tiktok.com/@{}'), 'snapchat': ('snapchat.com', 'https://www.snapchat.com/add/{}')}


def text(v):
    v = '' if v is None else str(v).strip()
    return '' if v.lower() in ('', 'null', 'none', 'nan', '[]', '{}') else v


def phone(*values):
    """A Saudi number from the values as (+966 number, kind): the first mobile, else the first landline, else None."""
    found = list(numbers(*values))
    return next((n for n in found if n[1] == 'mobile'), found[0] if found else None)


def numbers(*values):
    """Every Saudi number in the values, in order, as (+966 number, kind)."""
    for value in values:
        for raw in re.findall(r'\+?[0-9][0-9 ()-]{7,20}', text(value)):
            digits = re.sub(r'\D', '', raw)
            m = re.match(r'^(?:966|00966|0)?(5[0-9]{8})$', digits)
            if m:
                yield '+966' + m.group(1), 'mobile'
                continue
            # landline, unified (9200…) and toll-free (800…) numbers, written +966… as the snapshot writes them;
            # a five-digit short code (19996) has no such form in the snapshot and is left out
            m = re.match(r'^(?:966|00966|0)?(1[1-7][0-9]{7}|9200[0-9]{5}|800[0-9]{7})$', digits)
            if m:
                yield '+966' + m.group(1), 'landline'


def account(field, v):
    """An account as a full URL; a bare handle is expanded, another site's link is refused."""
    v = text(v)
    host, template = ACCOUNT[field]
    if re.search(host, v, re.I):
        return v if v.startswith('http') else 'https://' + v
    if re.match(r'^@?[A-Za-z0-9_.-]{2,40}$', v):
        return template.format(v.lstrip('@'))
    return None


def hours(v):
    """HudHud regular hours (JSON list of days) in the snapshot's format, or None."""
    try:
        days = json.loads(text(v) or 'null')
    except ValueError:
        return None
    parts = []
    for day in days or []:
        name = DAYS.get((day or {}).get('day'))
        # HudHud writes a day open all day as «00:00 - 00:00» (owner, 2026-10-29); the snapshot writes it «00:00 - 24:00».
        # Any other equal pair («08:00 - 08:00») has no stated meaning and is left out
        spans = [f"{h.get('open')} - {'24:00' if h.get('open') == h.get('close') == '00:00' else h.get('close')}"
                 for h in (day.get('hours') or [])
                 if re.match(r'^\d{2}:\d{2}$', str(h.get('open'))) and re.match(r'^\d{2}:\d{2}$', str(h.get('close')))
                 and (h.get('open') != h.get('close') or h.get('open') == '00:00')]
        if name and spans:
            parts.append(f"{name}: {', '.join(spans)}")
    return ' | '.join(parts) or None


def floor(v):
    v = text(v)
    v = v[:-2] if v.endswith('.0') else v
    return FLOOR_SAME.get(v.upper(), v.upper()) if FLOOR.match(v) else None


def website(v):
    v = text(v)
    if not re.match(r'^(https?://|www\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(/\S*)?$', v) or re.search(r'google\.[a-z]+/maps|instagram|twitter|x\.com|tiktok|snapchat|facebook', v, re.I):
        return None
    return re.sub(r'^(https?://)?(www\.)?', '', v).rstrip('/')


# snapshot column -> (HudHud column, cleaner returning the value in the snapshot's format or None)
FIELDS = {
    'national_address': ('trx_national_address', lambda v: text(v).upper() if re.match(r'^[A-Z]{4}\d{4}$', text(v).upper()) else None),
    'postal_code': ('trx_postal_code', lambda v: text(v)[:5] if re.match(r'^\d{5}(\.0)?$', text(v)) else None),
    'building_no': ('trx_building_no', lambda v: text(v)[:4] if re.match(r'^\d{4}(\.0)?$', text(v)) else None),
    'floor_no': ('trx_floorno', floor),
    'email': ('trx_email', lambda v: text(v).lower() if re.match(r'^[^@\s]+@[^@\s]+\.[a-z]{2,}$', text(v), re.I) else None),
    'website': ('trx_website', website),
    'instagram': ('trx_instagram', lambda v: account('instagram', v)),
    'x_link': ('trx_x_link', lambda v: account('x_link', v)),
    'tiktok': ('trx_tiktok', lambda v: account('tiktok', v)),
    'snapchat': ('trx_snapchat', lambda v: account('snapchat', v)),
    'menu_link': ('trx_menu_link', lambda v: text(v) if text(v).startswith('http') else None),
    'google_place_id': ('trx_google_id', lambda v: text(v) if re.match(r'^ChIJ[\w-]{10,}$', text(v)) else None),
    'working_hours': ('trx_opening_hours_regular_hours', hours),
    'description_ar': ('trx_description_ar', lambda v: text(v) if AR.search(text(v)) and len(text(v)) < 2000 else None),
    'description_en': ('trx_description_en', lambda v: text(v) if re.search('[A-Za-z]', text(v)) and len(text(v)) < 2000 and not text(v).startswith('http') else None),
    'tradename': ('trx_tradename', lambda v: text(v) if len(text(v)) < 200 and not text(v).startswith('http') else None),
    'name_en': ('trx_name_en', lambda v: text(v) if re.search('[A-Za-z]', text(v)) and len(text(v)) < 200 and not text(v).startswith('http') else None),
    'commercial_license': ('trx_licenseno', lambda v: text(v)[:10] if re.match(r'^\d{10}(\.0)?$', text(v)) else None),
    'rating': ('trx_rating', lambda v: text(v) if re.match(r'^[0-5](\.\d+)?$', text(v)) and float(text(v)) > 0 else None),
    'reviews_count': ('trx_reviews_count', lambda v: str(int(float(text(v)))) if re.match(r'^\d+(\.0)?$', text(v)) and float(text(v)) > 0 else None),
}
CONTACT = ('phone_norm', 'email', 'website')


def fills(snapshot, hudhud):
    """snapshot: {hudhud_id: {column: value}}; hudhud: {hudhud_id: {trx column: value}}.
    Returns {hudhud_id: {column: new value}} for empty snapshot fields only, and a Counter of refused values."""
    out, refused = {}, collections.Counter()
    for hid, row in snapshot.items():
        place = hudhud.get(hid)
        if not place or place['trx_state'] != 'ready to publish' or str(place['trx_is_deleted']).lower() == 'true' \
                or text(place['trx_status']) == 'permanently closed':
            continue
        new = {}
        for column, (source, clean) in FIELDS.items():
            if text(row.get(column)) or not text(place.get(source)):
                continue
            value = clean(place[source])
            if value:
                new[column] = value
            else:
                refused[column] += 1
        if not text(row.get('phone_norm')):
            found = phone(place.get('trx_phone_number'), place.get('trx_additional_feature'))
            if found:
                new.update(phone_raw=found[0], phone_norm=found[0], phone_kind=found[1], phone_source='hudhud_cr')
            elif text(place.get('trx_phone_number')):
                refused['phone_norm'] += 1
        if new:
            out[hid] = new
    return out, refused


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--targets', required=True)
    parser.add_argument('--crs', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    if os.path.abspath(args.out) == os.path.abspath(args.targets) or os.path.exists(args.out):
        sys.exit('refused: --out must be a new file, never the input or an existing snapshot')
    db = duckdb.connect()
    db.execute("SET threads=4")
    db.execute("SET memory_limit='8GB'")
    db.execute("SET preserve_insertion_order=false")
    db.execute(f"attach '{args.crs}' as c (read_only)")
    columns = list(FIELDS) + ['phone_raw', 'phone_norm', 'phone_kind', 'phone_source']
    have = {name for name, *_ in db.execute(f"describe select * from read_parquet('{args.targets}')").fetchall()}
    missing = [c for c in columns + ['hudhud_id', 'completeness_pct'] if c not in have]
    if missing:
        sys.exit(f'refused: the snapshot has no column {missing}')
    snapshot = {hid: dict(zip(columns, rest)) for hid, *rest in db.execute(
        f"select cast(hudhud_id as varchar), {', '.join(f'{c}::varchar' for c in columns)} from read_parquet('{args.targets}') where hudhud_id is not null").fetchall()}
    trx = ['trx_state', 'trx_is_deleted', 'trx_status', 'trx_phone_number', 'trx_additional_feature'] + sorted({s for s, _ in FIELDS.values()})
    hudhud = {hid: dict(zip(trx, rest)) for hid, *rest in db.execute(
        f"select split_part(cr_entity_id::varchar, '.', 1), {', '.join(f'any_value({c})::varchar' for c in trx)} from c.crs group by 1").fetchall()}
    new, refused = fills(snapshot, hudhud)

    rows = [(hid, column, value) for hid, values in new.items() for column, value in values.items()]
    db.execute("create table f(hid varchar, col varchar, val varchar)")
    db.executemany("insert into f values (?, ?, ?)", rows)
    db.execute(f"create table t as select * from read_parquet('{args.targets}')")
    for column in columns:
        db.execute(f"""update t set {column} = f.val from f where f.col = '{column}' and f.hid = cast(t.hudhud_id as varchar)
                       and nullif(trim(t.{column}::varchar), '') is null""")
    db.execute("""create table filled as select hid, list(col order by col) cols from f where col not in ('phone_raw', 'phone_kind', 'phone_source') group by 1""")
    db.execute("alter table t add column hudhud_filled varchar[]")
    db.execute("update t set hudhud_filled = filled.cols from filled where filled.hid = cast(t.hudhud_id as varchar)")
    # a first contact adds one of the six completeness points (build_golden.py: phone, e-mail or website)
    db.execute(f"""update t set completeness_pct = round(100.0 * least(6, round(coalesce(t.completeness_pct, 0) * 6 / 100) + 1) / 6, 1)
                   from read_parquet('{args.targets}') o where o.poi_key = t.poi_key and t.hudhud_filled is not null
                   and nullif(trim(o.phone_norm), '') is null and nullif(trim(o.email), '') is null and nullif(trim(o.website), '') is null
                   and (nullif(trim(t.phone_norm), '') is not null or nullif(trim(t.email), '') is not null or nullif(trim(t.website), '') is not null)""")

    # no existing value may change: every column but the filled ones and completeness is compared with the input
    changed = db.execute(f"""select count(*) from read_parquet('{args.targets}') o join t using (poi_key)
        where {' or '.join(f"(nullif(trim(o.{c}::varchar), '') is not null and o.{c}::varchar is distinct from t.{c}::varchar)" for c in columns)}""").fetchone()[0]
    count = db.execute(f"select (select count(*) from read_parquet('{args.targets}')), (select count(*) from t)").fetchone()
    if changed or count[0] != count[1]:
        sys.exit(f'refused: {changed} existing values changed or rows {count} differ')
    db.execute(f"copy t to '{args.out}' (format parquet, compression zstd)")

    by_field = collections.Counter(column for values in new.values() for column in values if column not in ('phone_raw', 'phone_kind', 'phone_source'))
    city = {hid: c for hid, c in db.execute("select cast(hudhud_id as varchar), city_en from t where hudhud_filled is not null").fetchall()}
    report = {
        'input': args.targets, 'output': args.out, 'rows': count[1],
        'rows_with_hudhud_id': len(snapshot), 'rows_filled': len(new),
        'filled_by_field': dict(by_field.most_common()),
        'phones_filled_by_kind': dict(collections.Counter(v['phone_kind'] for v in new.values() if 'phone_kind' in v)),
        'refused_by_field': dict(refused.most_common()),
        'rows_filled_by_city': dict(collections.Counter(city.get(h) or '(none)' for h in new).most_common(10)),
        'rows_given_a_first_contact': db.execute("select count(*) from t join read_parquet(?) o using (poi_key) where t.completeness_pct is distinct from o.completeness_pct", [args.targets]).fetchone()[0],
        'existing_values_changed': changed,
    }
    with open(os.path.splitext(args.out)[0] + '.report.json', 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
