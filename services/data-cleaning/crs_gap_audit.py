"""What the full HudHud change-request database (crs_fixed.duckdb) can correct or fill in a directory release, field by field.

Read-only (the database is attached read-only). Prints JSON of aggregate counts, no business rows. Run from the repository root:

    python3 services/data-cleaning/crs_gap_audit.py \
        --crs /Users/m4pro/Desktop/crs_fixed.duckdb \
        --release /Users/m4pro/farq-taxonomy-data/export/targets_golden_z19.parquet \
        --data /Users/m4pro/farq-taxonomy-data \
        > docs/crs-gap-audit.json

The database: one row per change request (CR, 2024-10 to 2025-08) with the request's log (`last_log_*`), the log before it
(`prev_log_*`) and the place's current state in HudHud (`trx_*`, the same for every CR of one place). The current state is
compared with the release row of the same `hudhud_id`; the CR history gives the lifecycle.

Per field, a release row falls in one class:
- fill: the release is empty and HudHud has a valid value (validated by pattern, as in import_crs_full.py);
- same / differs: both have a value, equal or not after normalising;
- release_only, both_empty.
«differs» is a disagreement to review, not proof that either side is wrong.
"""
import argparse
import collections
import csv
import json
import math
import pathlib
import re
import sys

import duckdb

AR = re.compile('[؀-ۿ]')
VALID = {
    'name_ar': lambda v: AR.search(v) and len(v) < 200 and not v.startswith('http'),
    'name_en': lambda v: re.search('[A-Za-z]', v) and len(v) < 200 and not v.startswith('http'),
    'phone': lambda v: len(re.sub(r'\D', '', v)) >= 9,
    'website': lambda v: re.match(r'^(https?://|www\.)\S+$', v) and 'google.com/maps' not in v,
    'email': lambda v: re.match(r'^[^@\s]+@[^@\s]+\.[a-z]{2,}$', v, re.I),
    'instagram': lambda v: 'instagram' in v or re.match(r'^@?[A-Za-z0-9_.]{2,40}$', v),
    'license': lambda v: re.match(r'^[0-9]{6,12}$', v),
    'national_address': lambda v: re.match(r'^[A-Z]{4}[0-9]{4}$', v),
    'building_no': lambda v: re.match(r'^[0-9]{4}$', v),
    'postal_code': lambda v: re.match(r'^[0-9]{5}$', v),
    'street_ar': lambda v: AR.search(v) and len(v) < 80,
    'district_ar': lambda v: AR.search(v) and len(v) < 80,
    'floor': lambda v: re.match(r'^-?[0-9]{1,3}$|^(G|GF|M|B[0-9]?)$', v, re.I),
    'opening_hours': lambda v: v.startswith('[') and len(v) > 2,
    'google_id': lambda v: re.match(r'^(ChIJ[\w-]{10,}|0x[0-9a-f]+:0x[0-9a-f]+)$', v),
    'menu_link': lambda v: v.startswith('http'),
    'description_ar': lambda v: AR.search(v) and len(v) < 2000,
    'description_en': lambda v: re.search('[A-Za-z]', v) and len(v) < 2000 and not v.startswith('http'),
    'tradename': lambda v: len(v) < 200 and not v.startswith('http'),
    'x_link': lambda v: 'x.com' in v or 'twitter' in v or re.match(r'^@?[A-Za-z0-9_]{2,30}$', v),
    'snapchat': lambda v: 'snapchat' in v or re.match(r'^@?[A-Za-z0-9_.-]{2,30}$', v),
    'tiktok': lambda v: 'tiktok' in v or re.match(r'^@?[A-Za-z0-9_.]{2,30}$', v),
    'order_link': lambda v: v.startswith('http'),
    'reservation_link': lambda v: v.startswith('http'),
    'full_address_ar': lambda v: AR.search(v) and len(v) < 300,
    'rating': lambda v: re.match(r'^[0-5](\.[0-9]+)?$', v),
    'reviews_count': lambda v: re.match(r'^[0-9]+(\.0)?$', v) and v not in ('0', '0.0'),
}
# release column for each HudHud field
RELEASE = {'name_ar': 'name_ar', 'name_en': 'name_en', 'phone': 'phone_norm', 'website': 'website', 'email': 'email',
           'instagram': 'instagram', 'license': 'commercial_license', 'national_address': 'national_address', 'building_no': 'building_no',
           'postal_code': 'postal_code', 'street_ar': 'street_ar', 'district_ar': 'district_ar', 'floor': 'floor_no',
           'opening_hours': 'working_hours', 'google_id': 'google_place_id', 'menu_link': 'menu_link', 'description_ar': 'description_ar', 'description_en': 'description_en', 'tradename': 'tradename',
           'x_link': 'x_link', 'snapchat': 'snapchat', 'tiktok': 'tiktok', 'order_link': 'order_link', 'reservation_link': 'reservation_link',
           'full_address_ar': 'full_address_ar', 'rating': 'rating', 'reviews_count': 'reviews_count'}
TRX = {'name_ar': 'trx_name_ar', 'name_en': 'trx_name_en', 'phone': 'trx_phone_number', 'website': 'trx_website', 'email': 'trx_email',
       'instagram': 'trx_instagram', 'license': 'trx_licenseno', 'national_address': 'trx_national_address', 'building_no': 'trx_building_no',
       'postal_code': 'trx_postal_code', 'street_ar': 'trx_streetname_ar', 'district_ar': 'trx_district_ar', 'floor': 'trx_floorno',
       'opening_hours': 'trx_opening_hours_regular_hours', 'google_id': 'trx_google_id', 'menu_link': 'trx_menu_link',
       'description_ar': 'trx_description_ar', 'description_en': 'trx_description_en', 'tradename': 'trx_tradename',
       'x_link': 'trx_x_link', 'snapchat': 'trx_snapchat', 'tiktok': 'trx_tiktok', 'order_link': 'trx_order_link',
       'reservation_link': 'trx_reservation_link', 'full_address_ar': 'trx_full_address_ar', 'rating': 'trx_rating',
       'reviews_count': 'trx_reviews_count'}
MOBILE = re.compile(r'^(?:\+?966|00966|0)?(5[0-9]{8})$')


def phones(v):
    """Saudi numbers in a free text or a JSON list, as their last nine digits with a kind."""
    out = {}
    for raw in re.findall(r'\+?[0-9][0-9 ()-]{7,20}', text(v)):
        digits = re.sub(r'\D', '', raw)
        m = MOBILE.match(digits)
        if m:
            out[m.group(1)] = 'mobile'
        elif re.match(r'^(?:966|0)?(1[1-7][0-9]{7}|9200[0-9]{5}|800[0-9]{7})$', digits):
            out[digits[-9:]] = 'landline'
    return out
TR = str.maketrans('أإآةىؤئ', 'اااهيوي')


def text(v):
    v = '' if v is None else str(v).strip()
    return '' if v.lower() in ('', 'null', 'none', 'nan', '[]', '{}') else v


def norm(field, v):
    """Comparable form: spelling noise (hamza, ta marbuta, case, spaces, URL scheme, phone prefix) removed."""
    v = text(v)
    if field == 'phone':
        return re.sub(r'\D', '', v)[-9:]
    if field in ('website', 'menu_link', 'order_link', 'reservation_link'):
        return re.sub(r'^(https?://)?(www\.)?', '', v.lower()).rstrip('/')
    if field == 'instagram':
        return re.sub(r'^(https?://)?(www\.)?instagram\.com/|^@|/.*$|\?.*$', '', v.lower()).strip('/')
    if field in ('x_link', 'snapchat', 'tiktok'):
        return re.sub(r'^(https?://)?(www\.)?[a-z.]*\.com/@?|^@|/.*$|\?.*$', '', v.lower()).strip('/')
    if field in ('rating', 'reviews_count'):
        return str(round(float(v), 1)) if re.match(r'^[0-9.]+$', v) else v
    if field in ('building_no', 'postal_code', 'license', 'floor'):
        return v[:-2] if v.endswith('.0') else v.upper()
    if field == 'opening_hours':
        return 'present'
    return re.sub(r'\s+', ' ', v.lower().translate(TR)).strip()


def metres(a, b, c, d):
    k = math.pi / 180
    h = math.sin((c - a) * k / 2) ** 2 + math.cos(a * k) * math.cos(c * k) * math.sin((d - b) * k / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--crs', required=True)
    parser.add_argument('--release', required=True)
    parser.add_argument('--data', required=True)
    parser.add_argument('--sub-map', default='/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/hudhud_sub_map.csv')
    args = parser.parse_args()
    db = duckdb.connect()
    db.execute(f"attach '{args.crs}' as c (read_only)")
    C = collections.Counter
    out = {}

    # --- the database itself
    out['database'] = dict(zip(('change_requests', 'places', 'first_cr', 'last_cr'), db.execute(
        "select count(*), count(distinct cr_entity_id), min(cr_created_at)::varchar, max(cr_created_at)::varchar from c.crs").fetchone()))
    out['database']['cr_by_status_and_operation'] = {f'{s}|{o}': n for s, o, n in db.execute(
        "select cr_status, cr_operation, count(*) from c.crs group by all order by 3 desc").fetchall()}
    out['database']['places_by_current_state'] = {f'{s}|deleted={d}': n for s, d, n in db.execute(
        "select coalesce(trx_state, '(none)'), coalesce(trx_is_deleted, '(none)'), count(distinct cr_entity_id) from c.crs group by all order by 3 desc").fetchall()}
    out['database']['places_by_source'] = dict(db.execute(
        "select coalesce(trx_source_name, '(none)'), count(distinct cr_entity_id) from c.crs group by 1 order by 2 desc").fetchall())

    # --- one current state per place, and its approved history in order
    fields = ', '.join(f'any_value({c}) {f}' for f, c in TRX.items())
    current = {r[0]: r for r in db.execute(f"""select split_part(cr_entity_id::varchar, '.', 1) eid, any_value(trx_state), any_value(trx_is_deleted),
            any_value(trx_status), any_value(trx_duplicate_of_id)::varchar, any_value(trx_latitude)::double, any_value(trx_longitude)::double,
            any_value(trx_sub_categories_ids)::varchar, any_value(trx_source_name), {fields}
        from c.crs group by 1""").fetchall()}
    names = ['eid', 'state', 'deleted', 'status', 'duplicate_of', 'lat', 'lon', 'subs', 'source'] + list(TRX)
    current = {k: dict(zip(names, v)) for k, v in current.items()}
    history = collections.defaultdict(list)
    for eid, at, op, status, by_survey in db.execute("""select split_part(cr_entity_id::varchar, '.', 1), cr_created_at::varchar, cr_operation,
            last_log_status, cr_created_by from c.crs where cr_status = 'approved' order by 1, 2""").fetchall():
        history[eid].append((at, op, status))

    # --- the release and the existing CR import
    release = {}
    for row in db.execute(f"""select cast(hudhud_id as varchar), poi_key, city_en, company_status, latitude, longitude, sub_id,
            surveyor_verified_at, legal_name, cls_confidence, {', '.join(sorted(set(RELEASE.values())))} from read_parquet('{args.release}') where hudhud_id is not null""").fetchall():
        release[row[0]] = dict(zip(['hid', 'poi_key', 'city', 'company_status', 'lat', 'lon', 'sub_id', 'verified_at', 'legal_name', 'cls_confidence'] + sorted(set(RELEASE.values())), row))
    known = {k.split(':', 1)[1] for (k,) in db.execute(f"select poi_key from read_parquet('{args.data}/enrich/crs_latest.parquet')").fetchall()}
    golden = {k.split(':', 1)[1]: (in_golden, reason, dup) for k, in_golden, reason, dup in db.execute(
        f"select poi_key, in_golden, exclude_reason, dup_primary from read_parquet('{args.data}/golden/golden_set.parquet') where poi_key like 'hh:%'").fetchall()}

    live = lambda p: p['state'] == 'ready to publish' and str(p['deleted']).lower() != 'true'
    out['coverage'] = {
        'places': len(current), 'places_in_release': sum(e in release for e in current),
        'places_in_existing_crs_import': sum(e in known for e in current),
        'places_in_release_not_in_existing_import': sum(e in release and e not in known for e in current),
        'live_places': sum(live(p) for p in current.values()),
    }

    # --- field by field, for live places in the release
    per_field = {f: C() for f in TRX}
    fill_by_city = {f: C() for f in TRX}
    for eid, p in current.items():
        r = release.get(eid)
        if not r or not live(p):
            continue
        for f in TRX:
            h, mine = text(p[f]), text(r[RELEASE[f]])
            ok = bool(h) and bool(VALID[f](h))
            cls = ('fill' if ok and not mine else 'same' if ok and norm(f, h) == norm(f, mine) else 'differs' if ok
                   else 'release_only' if mine else 'both_empty')
            per_field[f][cls] += 1
            if cls == 'fill':
                fill_by_city[f][r['city'] or '(none)'] += 1
    out['fields_live_places_in_release'] = {f: dict(v) for f, v in per_field.items()}
    out['fill_by_city_top'] = {f: dict(v.most_common(6)) for f, v in fill_by_city.items() if v}

    # coordinates and category
    moved, cat = C(), C()
    for eid, p in current.items():
        r = release.get(eid)
        if not r or not live(p):
            continue
        if p['lat'] and p['lon'] and r['lat'] and r['lon']:
            m = metres(p['lat'], p['lon'], r['lat'], r['lon'])
            moved['<20m' if m < 20 else '20-100m' if m < 100 else '100-500m' if m < 500 else '>=500m'] += 1
        else:
            moved['missing'] += 1
        cat['release_has_sub' if r['sub_id'] else 'release_no_sub'] += 1
    out['coordinates_hudhud_vs_release'] = dict(moved)

    # phones: every Saudi number HudHud holds (the phone field and the extra list in additional_feature), by kind
    extra = {eid: (main, more) for eid, main, more in db.execute("""select split_part(cr_entity_id::varchar, '.', 1),
            any_value(trx_phone_number)::varchar, any_value(trx_additional_feature)::varchar from c.crs group by 1""").fetchall()}
    tel = C()
    for eid, p in current.items():
        r = release.get(eid)
        if not r or not live(p):
            continue
        main, more = extra.get(eid, (None, None))
        hudhud = phones(main) | phones(more)
        mine = set(phones(r['phone_norm']))
        for number, kind in hudhud.items():
            tel[f'{kind}|' + ('already_in_release' if number in mine else 'release_has_another' if mine else 'release_has_none')] += 1
        tel['places_with_a_new_mobile'] += any(k == 'mobile' and n not in mine for n, k in hudhud.items())
        tel['places_with_two_or_more_numbers'] += len(hudhud) > 1
    out['phones_live_places_in_release'] = dict(sorted(tel.items()))

    # legal name: HudHud has no legal-name field; its trade name is compared with the release legal name
    legal = C()
    for eid, p in current.items():
        r = release.get(eid)
        if not r or not live(p) or not text(p['tradename']):
            continue
        h, mine = norm('tradename', p['tradename']), norm('tradename', r['legal_name'])
        legal['release_legal_empty' if not mine else 'same' if h == mine else 'contains' if h in mine or mine in h else 'differs'] += 1
    out['hudhud_tradename_vs_release_legal_name'] = dict(legal)

    # media and other place attributes the release has no column for
    out['attributes_without_a_release_column'] = dict(zip(
        ('places_with_media', 'places_with_logo', 'places_with_amenities', 'places_with_brand_id', 'places_verified_by_google',
         'places_with_license_link', 'places_with_secondary_no', 'places_with_physical_parent'), db.execute("""select
        count(distinct cr_entity_id) filter (where nullif(trx_media::varchar, '[]') is not null),
        count(distinct cr_entity_id) filter (where nullif(trx_logo::varchar, '') is not null),
        count(distinct cr_entity_id) filter (where nullif(trx_amenities_ids::varchar, '[]') is not null),
        count(distinct cr_entity_id) filter (where trx_brand_id is not null),
        count(distinct cr_entity_id) filter (where trx_verified_by_google::varchar = 'true'),
        count(distinct cr_entity_id) filter (where nullif(trx_license_link::varchar, '') is not null),
        count(distinct cr_entity_id) filter (where nullif(trx_secondary_no::varchar, '') is not null),
        count(distinct cr_entity_id) filter (where nullif(trx_physical_parent::varchar, '') is not null)
        from c.crs where trx_state = 'ready to publish' and trx_is_deleted::varchar = 'false'""").fetchone()))

    # names that differ: a spelling of the same name, or a different name (a wrong name in the release, or a new occupant)
    words = lambda v: set(re.findall(r'\w{2,}', norm('name_ar', v)))
    names = C()
    for eid, p in current.items():
        r = release.get(eid)
        h, mine = text(p['name_ar']), text(r['name_ar']) if r else ''
        if not r or not live(p) or not h or not mine or norm('name_ar', h) == norm('name_ar', mine):
            continue
        a, b = norm('name_ar', h), norm('name_ar', mine)
        names['release_name_reads_like_a_description' if len(mine) > 60 or len(mine.split()) > 8
              else 'one_contains_the_other' if a in b or b in a else 'shared_word' if words(h) & words(mine) else 'no_shared_word'] += 1
    out['name_ar_differs_by_kind'] = dict(names)

    # category: HudHud subcategories through hudhud_sub_map.csv (high and medium only), against the release sub_id
    mapped = {}
    for row in csv.DictReader(open(args.sub_map, encoding='utf-8')):
        if row['confidence'] in ('high', 'medium'):
            mapped.setdefault(row['hudhud_sub_id'].split('.')[0], row['sub_id'])
    cats = C()
    for eid, p in current.items():
        r = release.get(eid)
        if not r or not live(p):
            continue
        subs = {mapped[i] for i in re.findall(r'\d+', p['subs'] or '') if i in mapped}
        cats['hudhud_sub_not_mapped' if not subs else 'fill' if not r['sub_id'] else 'same' if r['sub_id'] in subs
             else f"differs|release_confidence={r['cls_confidence']}"] += 1
    out['category_live_places_in_release'] = dict(cats)

    # --- lifecycle
    life = C()
    missing = []
    for eid, p in current.items():
        r = release.get(eid)
        status = text(p['status'])
        if r:
            if str(p['deleted']).lower() == 'true':
                life['in_release_but_deleted_in_hudhud'] += 1
            elif not live(p):
                # a draft or an edit in progress is not a removal: the place stays
                life[f"in_release_hudhud_state={p['state']}"] += 1
            elif status == 'permanently closed':
                life['in_release_live_but_permanently_closed'] += 1
                life['  of_which_release_says_closed'] += (r['company_status'] or '') != ''
            elif status == 'temporary closed':
                life['in_release_live_but_temporarily_closed'] += 1
                life['  of_which_release_says_temporarily_closed'] += r['company_status'] == 'temporarily_closed'
            dup = text(p['duplicate_of'])
            if dup:
                life['in_release_with_duplicate_of'] += 1
                life['  of_which_target_also_in_release'] += dup.split('.')[0] in release
        elif live(p) and status == 'open':
            g = golden.get(eid)
            reason = 'not_in_golden_set' if not g else (g[1] or ('duplicate_kept_other' if g[2] is False else 'in_golden_but_not_in_release'))
            named = bool(text(p['name_ar'])) and bool(VALID['name_ar'](text(p['name_ar'])))
            life[f'live_open_missing_from_release|{reason}|hudhud_has_name={named}'] += 1
            if named and p['lat'] and p['lon']:
                missing.append((eid, reason, p['name_ar'], p['lat'], p['lon']))
        statuses = [s for _, _, s in history.get(eid, []) if s]
        if any(a != 'open' and b == 'open' for a, b in zip(statuses, statuses[1:])):
            life['history_closed_then_reopened'] += 1
        if any(a == 'open' and b != 'open' for a, b in zip(statuses, statuses[1:])):
            life['history_open_then_closed'] += 1
        if len(history.get(eid, [])) > 1:
            life['places_with_two_or_more_approved_crs'] += 1
    out['lifecycle'] = dict(sorted(life.items()))

    # a place missing under its HudHud key may be in the release from another source: the same name within about 100 m
    key = lambda c: f"regexp_replace(translate(lower(coalesce({c}, '')), 'أإآةىؤئ', 'اااهيوي'), '[^a-z0-9ء-ي]+', '', 'g')"
    db.execute("create table m(eid varchar, why varchar, name varchar, lat double, lon double)")
    db.executemany("insert into m values (?, ?, ?, ?, ?)", missing)
    db.execute(f"create table rk as select {key('name_ar')} k, latitude lat, longitude lon from read_parquet('{args.release}') where latitude is not null")
    out['live_open_missing_from_release_checked_by_name'] = {why: {'places': n, 'same_name_within_100m_in_release': present, 'not_found': n - present}
        for why, n, present in db.execute(f"""select why, count(*), count(*) filter (where exists (select 1 from rk where rk.k = {key('m.name')}
            and length(rk.k) >= 3 and abs(rk.lat - m.lat) < 0.001 and abs(rk.lon - m.lon) < 0.001)) from m group by 1 order by 2 desc""").fetchall()}

    # --- what changed in each approved update: the event types the lifecycle design needs
    changed = C()
    for (fields_changed,) in db.execute("""select cr_fields_changed::varchar from c.crs where cr_status = 'approved' and cr_operation = 'update'""").fetchall():
        for f in set(re.findall(r'[a-z_]+', fields_changed or '')):
            changed[f] += 1
    out['approved_updates_by_field_changed'] = dict(changed.most_common(25))

    # --- side tables. users holds people (names, roles): counted, never read
    out['side_tables'] = {t: db.execute(f'select count(*) from c.{t}').fetchone()[0] for t in ('districts', 'territories', 'users')}
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'targeting-api'))
    from canonical_data import district_key
    canon = {district_key(n) for (n,) in db.execute(f"select distinct district_ar from read_parquet('{args.release}') where district_ar is not null").fetchall()}
    levels = C()
    for name, level in db.execute("select name_ar, admin_level from c.districts").fetchall():
        levels[f"admin_level={level}|" + ('spelled_as_release' if district_key(name or '') in canon else 'not_in_release_spelling')] += 1
    out['hudhud_districts_table'] = dict(sorted(levels.items()))
    out['survey_territories_by_status'] = dict(db.execute("select coalesce(status, '(none)'), count(*) from c.territories group by 1 order by 2 desc").fetchall())
    print(json.dumps(out, ensure_ascii=False, indent=1, default=str))


if __name__ == '__main__':
    sys.exit(main())
