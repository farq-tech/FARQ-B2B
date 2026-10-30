"""Value patterns for HudHud change-request fields, shared by import_crs_full.py (crs_export.csv) and unpack_poi_logs.py
(poi_logs.raw_json). A value that fails its pattern is dropped, never guessed."""
import re

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
