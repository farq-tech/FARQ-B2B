"""Full HudHud change-request history («crs_export.csv», 110,831 CRs, 409 columns), read in place. The export flattens nested fields
(opening hours …) into a varying number of cells, so about two thirds of the rows are shifted one column to the right from the
`last_log_*` block on. Each row's shift is detected from anchor columns (coordinates, category ids, review status, status, city,
district) and every value is validated by its pattern after shifting; an invalid value is dropped, never guessed.
For every entity the LATEST APPROVED CR gives the surveyor-verified state: deletion, open/closed status, subcategories (through
hudhud_sub_map.csv), names, phones, website, e-mail, socials (Instagram, X, Snapchat, TikTok), menu/order/reservation links, licence, national address,
street, building number, postal code, floor, district/city, opening hours, description, trade name, amenities, brand, rating, reviews,
duplicate-of id and Google id. Read-only.
Usage: python3 import_crs_full.py [crs_export.csv]
Output: /Users/m4pro/farq-taxonomy-data/enrich/crs_latest.parquet"""
import csv, re, sys, json
import duckdb
F = sys.argv[1] if len(sys.argv) > 1 else '/Volumes/Archive/Cr/crs_export.csv'
D = '/Users/m4pro/farq-taxonomy-data/'
T = '/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/'
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
csv.field_size_limit(10**9)
AR = re.compile('[؀-ۿ]'); NUM = re.compile(r'^-?\d+(\.\d+)?$'); PH = re.compile(r'^[+0-9 ()-]{7,20}$')
CHECK = {
 'latitude': lambda v: NUM.match(v) and 16 < float(v) < 33, 'longitude': lambda v: NUM.match(v) and 34 < float(v) < 56,
 'category_id': lambda v: NUM.match(v), 'sub_categories_ids': lambda v: re.match(r'^\[[0-9, .]*\]$', v),
 'review_status': lambda v: v in ('approved', 'rejected', 'under_review', 'draft'),
 'status': lambda v: v in ('open', 'temporary closed', 'permanently closed', 'closed'),
 'city_en': lambda v: re.match(r"^[A-Za-z .'`-]{2,60}$", v), 'district_en': lambda v: re.match(r"^[A-Za-z0-9 .'`()-]{2,80}$", v),
 'city_ar': lambda v: AR.search(v) and len(v) < 60, 'district_ar': lambda v: AR.search(v) and len(v) < 80,
 'name_ar': lambda v: not v.startswith('http') and len(v) < 200, 'name_en': lambda v: not v.startswith('http') and len(v) < 200,
 'phone_number': lambda v: PH.match(v), 'website': lambda v: re.match(r'^(https?://|www\.)\S+$', v) and 'google.com/maps' not in v,
 'email': lambda v: re.match(r'^[^@\s]+@[^@\s]+\.[a-z]{2,}$', v, re.I), 'instagram': lambda v: 'instagram' in v or re.match(r'^@?[A-Za-z0-9_.]{2,40}$', v),
 'licenseno': lambda v: re.match(r'^[0-9]{6,12}$', v), 'national_address': lambda v: re.match(r'^[A-Z]{4}[0-9]{4}$', v),
 'building_no': lambda v: re.match(r'^[0-9]{3,5}$', v), 'postal_code': lambda v: re.match(r'^[0-9]{5}$', v),
 'streetname_ar': lambda v: AR.search(v) and len(v) < 80, 'streetname_en': lambda v: re.match(r"^[A-Za-z0-9 .'`()-]{2,80}$", v),
 'duplicate_of_id': lambda v: re.match(r'^[0-9]+(\.0)?$', v), 'google_id': lambda v: re.match(r'^(ChIJ[\w-]{10,}|0x[0-9a-f]+:0x[0-9a-f]+)$', v),
 'opening_hours_regular_hours': lambda v: v.startswith('[') or v.startswith('{'),
 'menu_link': lambda v: v.startswith('http'), 'order_link': lambda v: v.startswith('http'), 'reservation_link': lambda v: v.startswith('http'),
 'x_link': lambda v: 'x.com' in v or 'twitter' in v or re.match(r'^@?[A-Za-z0-9_]{2,30}$', v), 'snapchat': lambda v: 'snapchat' in v or re.match(r'^@?[A-Za-z0-9_.-]{2,30}$', v),
 'tiktok': lambda v: 'tiktok' in v or re.match(r'^@?[A-Za-z0-9_.]{2,30}$', v), 'description_ar': lambda v: AR.search(v) and len(v) < 2000,
 'description_en': lambda v: re.search('[A-Za-z]', v) and not v.startswith('http') and len(v) < 2000, 'tradename': lambda v: not v.startswith('http') and len(v) < 200,
 'amenities_ids': lambda v: re.match(r'^\[[0-9, .]*\]$', v), 'brand_id': lambda v: re.match(r'^[0-9]+(\.0)?$', v), 'floorno': lambda v: re.match(r'^-?[0-9A-Za-z]{1,4}$', v),
 'rating': lambda v: NUM.match(v) and 0 <= float(v) <= 5, 'reviews_count': lambda v: NUM.match(v) and float(v) >= 0,
}
ANCHORS = ['latitude', 'longitude', 'category_id', 'sub_categories_ids', 'review_status', 'status', 'city_en', 'city_ar', 'district_ar', 'name_ar']
f = open(F, newline='', encoding='utf-8'); r = csv.reader(f); h = next(r); ix = {c: i for i, c in enumerate(h)}
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
    rec = {'eid': eid, 'last_operation': row[ix['cr_operation']], 'verified_at': at, 'surveyor': row[ix['cr_created_by']], 'shift': d}
    for c, chk in CHECK.items():
        v = get(row, c, d)
        rec[c] = v if v and v.lower() not in ('null', 'none', 'nan') and chk(v) else None
    out.append(rec)
db = duckdb.connect(); db.execute("SET threads=8")
cols = ['eid', 'last_operation', 'verified_at', 'surveyor', 'shift'] + list(CHECK)
db.execute("create table l (" + ", ".join(f'"{c}" varchar' for c in cols) + ")")
db.executemany(f"insert into l values ({', '.join('?' * len(cols))})", [[str(x[c]) if x[c] is not None else None for c in cols] for x in out])
db.execute("create table hmap (hid varchar, sub_id varchar, confidence varchar, hsub varchar)")
db.executemany("insert into hmap values (?,?,?,?)", [(x['hudhud_sub_id'].split('.')[0], x['sub_id'], x['confidence'], x['hudhud_sub_en'])
                                                     for x in csv.DictReader(open(T + 'hudhud_sub_map.csv', encoding='utf-8'))])
db.execute("""create table subpick as select eid, arg_min(h.sub_id, case h.confidence when 'high' then 0 when 'medium' then 1 else 2 end) sub_id,
   arg_min(h.hsub, case h.confidence when 'high' then 0 when 'medium' then 1 else 2 end) hsub, min(h.confidence) conf
   from (select eid, unnest(regexp_extract_all(sub_categories_ids, '[0-9]+')) hid from l) x join hmap h using(hid) group by eid""")
db.execute(f"""copy (select 'hh:' || l.eid poi_key, l.last_operation, l.last_operation='delete' deleted, l.status hh_status, l.verified_at, l.surveyor, l.shift::int shift,
   s.sub_id, s.hsub hudhud_sub, s.conf sub_confidence, l.name_ar, l.name_en, l.phone_number phone, l.website, l.email, l.instagram,
   l.licenseno license_no, l.national_address, l.building_no, l.postal_code, l.streetname_ar street_ar, l.streetname_en street_en,
   l.district_ar, l.district_en, l.city_ar, l.city_en, l.opening_hours_regular_hours opening_hours,
   case when l.duplicate_of_id is not null then 'hh:' || split_part(l.duplicate_of_id, '.', 1) end duplicate_of, l.google_id,
   l.menu_link, l.order_link, l.reservation_link, l.x_link, l.snapchat, l.tiktok, l.description_ar, l.description_en, l.tradename, l.amenities_ids,
   split_part(l.brand_id, '.', 1) hh_brand_id, l.floorno, try_cast(l.rating as double) rating, try_cast(try_cast(l.reviews_count as double) as int) reviews_count
   from l left join subpick s using(eid) where 'hh:' || l.eid in (select poi_key from read_parquet('{P}'))) to '{D}enrich/crs_latest.parquet' (format parquet)""")
print(db.execute(f"""select count(*), count(*) filter (where shift<>'0'), count(*) filter (where deleted), count(*) filter (where hh_status='permanently closed'),
   count(*) filter (where hh_status='temporary closed'), count(sub_id), count(name_ar), count(phone), count(street_ar), count(building_no), count(postal_code),
   count(national_address), count(opening_hours), count(duplicate_of), count(google_id), count(instagram), count(license_no),
   count(menu_link), count(order_link), count(x_link), count(description_ar), count(amenities_ids), count(hh_brand_id), count(rating)
   from read_parquet('{D}enrich/crs_latest.parquet')""").fetchone())
