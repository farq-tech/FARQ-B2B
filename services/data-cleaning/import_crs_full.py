"""Full HudHud change-request history («crs_export.csv», 110,831 CRs, 409 columns), read in place. The export flattens nested fields
(opening hours …) into a varying number of cells, so about two thirds of the rows are shifted one column to the right from the
`last_log_*` block on. Each row's shift is detected from anchor columns (coordinates, category ids, review status, status, city,
district) and every value is validated by its pattern after shifting; an invalid value is dropped, never guessed.
For every entity the LATEST APPROVED CR gives the surveyor-verified state: deletion, open/closed status, subcategories (through
hudhud_sub_map.csv), names, phones, website, e-mail, socials (Instagram, X, Snapchat, TikTok), menu/order/reservation links, licence, national address,
street, building number, postal code, floor, district/city, opening hours, description, trade name, amenities, brand, rating, reviews,
duplicate-of id and Google id. Read-only.
The CR database (crs_fixed.duckdb, 256,963 CRs) is the preferred source: its `raw_json.data.last_log` holds the same state as JSON, so
nothing is shifted. It is read through unpack_raw_json.py (same latest-approved rule, same patterns) into the same columns; a list of
links keeps its first valid link, as the CSV holds one; opening hours are written in the directory's readable format.
Usage: python3 import_crs_full.py [crs_fixed.duckdb | crs_export.csv] [out.parquet]
Output: /Users/m4pro/farq-taxonomy-data/enrich/crs_latest.parquet unless out.parquet is given"""
import collections, csv, re, sys, json
import duckdb
from crs_patterns import CHECK
F = sys.argv[1] if len(sys.argv) > 1 else '/Volumes/Archive/Cr/crs_export.csv'
D = '/Users/m4pro/farq-taxonomy-data/'
O = sys.argv[2] if len(sys.argv) > 2 else D + 'enrich/crs_latest.parquet'
T = '/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/'
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
csv.field_size_limit(10**9)
# raw_json fields crs_export.csv does not carry: appended as new columns (empty from the CSV); consumers read columns by name
EXTRA = {'additional_phones': 'extra_phones', 'full_address_ar': 'full_address_ar', 'full_address_en': 'full_address_en',
         'region_ar': 'region_ar', 'secondary_no': 'secondary_no', 'logo': 'logo', 'media_urls': 'media_urls', 'license_link': 'license_link',
         'google_url': 'google_url', 'verified_by_google': 'verified_by_google', 'is_landmark': 'is_landmark', 'is_iconic': 'is_iconic',
         'physical_parent': 'physical_parent', 'confidence': 'confidence',
         'category_id': 'hh_category_id', 'sub_categories_ids': 'hh_sub_categories_ids', 'menu_link': 'menu_links', 'order_link': 'order_links',
         'reservation_link': 'reservation_links'}
def first_link(v):
    return json.loads(v)[0] if v and v.startswith('[') else v
def from_raw_json(path):
    """Latest approved CR per entity from crs_fixed.duckdb's raw_json, as the CSV path's records (shift 0)."""
    from hudhud_fill import hours
    from unpack_raw_json import read_crs, unpack
    rows, _, _ = unpack(read_crs(path, collections.Counter()), {})
    out = []
    for x in rows:
        rec = {'eid': x['poi_key'][3:], 'last_operation': x['last_operation'], 'deleted': x['deleted'], 'verified_at': x['verified_at'], 'surveyor': x['surveyor'], 'shift': 0}
        for c in CHECK:
            # hours in the directory's own format («Sun: 08:30 - 23:30 | …», 00:00-00:00 = open all day), as hudhud_fill.py writes
            # them, so a surveyor's hours never replace readable hours with raw JSON in the golden set
            rec[c] = hours(x['opening_hours']) if c == 'opening_hours_regular_hours' else x.get(c)
        for src, col in EXTRA.items():
            v = x.get(src)
            rec[col] = v if src not in ('menu_link', 'order_link', 'reservation_link') or v is None or v.startswith('[') else json.dumps([v])
        for c in ('menu_link', 'order_link', 'reservation_link'):
            rec[c] = first_link(rec[c])
        out.append(rec)
    return out
def from_csv(path):
    ANCHORS = ['latitude', 'longitude', 'category_id', 'sub_categories_ids', 'review_status', 'status', 'city_en', 'city_ar', 'district_ar', 'name_ar']
    f = open(path, newline='', encoding='utf-8'); r = csv.reader(f); h = next(r); ix = {c: i for i, c in enumerate(h)}
    def get(row, col, d):
        i = ix['last_log_' + col] + d
        return row[i].strip() if 0 <= i < len(row) else ''
    latest = {}
    shifts = {}
    for row in r:
        if row[ix['cr_status']] != 'approved': continue
        eid = row[ix['cr_entity_id']].split('.')[0]; at = row[ix['cr_created_at']]
        if eid in latest and latest[eid][0] >= at: continue
        def score(d): return sum(1 if (v := get(row, c, d)) and CHECK[c](v) else 0.2 if not v else 0 for c in ANCHORS)
        d = max(range(0, 4), key=lambda k: (score(k), -k))
        latest[eid] = (at, row, d)
    out = []
    for eid, (at, row, d) in latest.items():
        rec = {'eid': eid, 'last_operation': row[ix['cr_operation']], 'deleted': row[ix['cr_operation']] == 'delete', 'verified_at': at, 'surveyor': row[ix['cr_created_by']], 'shift': d}
        for c, chk in CHECK.items():
            v = get(row, c, d)
            rec[c] = v if v and v.lower() not in ('null', 'none', 'nan') and chk(v) else None
        out.append(rec)
    return out
out = from_raw_json(F) if F.endswith('.duckdb') else from_csv(F)
db = duckdb.connect(); db.execute("SET threads=8")
cols = ['eid', 'last_operation', 'deleted', 'verified_at', 'surveyor', 'shift'] + list(CHECK) + list(EXTRA.values())
db.execute("create table l (" + ", ".join(f'"{c}" varchar' for c in cols) + ")")
db.executemany(f"insert into l values ({', '.join('?' * len(cols))})", [[str(x[c]) if x.get(c) is not None else None for c in cols] for x in out])
db.execute("create table hmap (hid varchar, sub_id varchar, confidence varchar, hsub varchar)")
db.executemany("insert into hmap values (?,?,?,?)", [(x['hudhud_sub_id'].split('.')[0], x['sub_id'], x['confidence'], x['hudhud_sub_en'])
                                                     for x in csv.DictReader(open(T + 'hudhud_sub_map.csv', encoding='utf-8'))])
db.execute("""create table subpick as select eid, arg_min(h.sub_id, case h.confidence when 'high' then 0 when 'medium' then 1 else 2 end) sub_id,
   arg_min(h.hsub, case h.confidence when 'high' then 0 when 'medium' then 1 else 2 end) hsub, min(h.confidence) conf
   from (select eid, unnest(regexp_extract_all(sub_categories_ids, '[0-9]+')) hid from l) x join hmap h using(hid) group by eid""")
db.execute(f"""copy (select 'hh:' || l.eid poi_key, l.last_operation, l.deleted='True' deleted, l.status hh_status, l.verified_at, l.surveyor, l.shift::int shift,
   s.sub_id, s.hsub hudhud_sub, s.conf sub_confidence, l.name_ar, l.name_en, l.phone_number phone, l.website, l.email, l.instagram,
   l.licenseno license_no, l.national_address, l.building_no, l.postal_code, l.streetname_ar street_ar, l.streetname_en street_en,
   l.district_ar, l.district_en, l.city_ar, l.city_en, l.opening_hours_regular_hours opening_hours,
   case when l.duplicate_of_id is not null then 'hh:' || split_part(l.duplicate_of_id, '.', 1) end duplicate_of, l.google_id,
   l.menu_link, l.order_link, l.reservation_link, l.x_link, l.snapchat, l.tiktok, l.description_ar, l.description_en, l.tradename, l.amenities_ids,
   split_part(l.brand_id, '.', 1) hh_brand_id, l.floorno, try_cast(l.rating as double) rating, try_cast(try_cast(l.reviews_count as double) as int) reviews_count,
   l.extra_phones, l.full_address_ar, l.full_address_en, l.region_ar, l.secondary_no, l.logo, l.media_urls, l.license_link, l.google_url,
   l.verified_by_google, l.is_landmark::boolean is_landmark, l.is_iconic::boolean is_iconic, l.physical_parent, try_cast(l.confidence as int) confidence,
   try_cast(l.latitude as double) latitude, try_cast(l.longitude as double) longitude, l.hh_category_id, l.hh_sub_categories_ids,
   l.menu_links, l.order_links, l.reservation_links
   from l left join subpick s using(eid) where 'hh:' || l.eid in (select poi_key from read_parquet('{P}'))) to '{O}' (format parquet)""")
print(db.execute(f"""select count(*), count(*) filter (where shift<>'0'), count(*) filter (where deleted), count(*) filter (where hh_status='permanently closed'),
   count(*) filter (where hh_status='temporary closed'), count(sub_id), count(name_ar), count(phone), count(street_ar), count(building_no), count(postal_code),
   count(national_address), count(opening_hours), count(duplicate_of), count(google_id), count(instagram), count(license_no),
   count(menu_link), count(order_link), count(x_link), count(description_ar), count(amenities_ids), count(hh_brand_id), count(rating)
   from read_parquet('{O}')""").fetchone())
