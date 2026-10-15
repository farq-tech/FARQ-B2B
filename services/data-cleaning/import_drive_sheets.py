"""Two HudHud sheets from My Drive, read in place with openpyxl (read-only):
- trx_poi_202412311250.xlsx: 132,730 TRX rows (Dec 2024) with phone, website, Instagram, X, opening hours, rating, reviews, status.
- SURVEYOR_DATA_COLLECTION.xlsx (HIGH_PRIORITY): 130,161 rows with phone and address.
Keyed by the HudHud id ('hh:<id>'); values are validated (Saudi phone pattern, URL). Contacts fill only missing values in the golden set.
Output: /Users/m4pro/farq-taxonomy-data/enrich/drive_sheets.parquet"""
import re, openpyxl, duckdb
G = '/Users/m4pro/Library/CloudStorage/GoogleDrive-abdulrhman@farq.sa/'
F1 = G + 'Other computers/My Laptop (1)/Downloads/trx_poi_202412311250/trx_poi_202412311250.xlsx'
F2 = G + 'My Drive/SURVEYOR_DATA_COLLECTION.xlsx'
def ph(v):
    d = re.sub(r'[^0-9]', '', str(v or ''))
    d = re.sub(r'^(00966|966|0)', '', d)
    return '+966' + d if re.match(r'^(5[0-9]{8}|1[1-7][0-9]{7}|9200[0-9]{5}|800[0-9]{7})$', d) else None
def url(v):
    v = str(v or '').strip()
    return v if re.match(r'^(https?://|www\.)\S+$', v) else None
out = {}
ws = openpyxl.load_workbook(F1, read_only=True).worksheets[0]
it = ws.iter_rows(values_only=True); h = [str(x) for x in next(it)]; ix = {c: i for i, c in enumerate(h)}
for r in it:
    k = str(r[ix['id']]).split('.')[0] if r[ix['id']] is not None else None
    if not k: continue
    g = lambda c: r[ix[c]] if c in ix else None
    out['hh:' + k] = {'phone': ph(g('phone_number')), 'website': url(g('website')), 'instagram': g('instagram') or None, 'x_link': g('x_link') or None,
                      'opening_hours': str(g('opening_hours')) if g('opening_hours') else None, 'rating': g('rating'), 'reviews_count': g('reviews_count'),
                      'status': g('status'), 'src': 'trx_poi_2024_12'}
ws = openpyxl.load_workbook(F2, read_only=True).worksheets[1]
it = ws.iter_rows(values_only=True); h = [str(x) for x in next(it)]; ix = {c: i for i, c in enumerate(h)}
for r in it:
    k = str(r[ix['id']]).split('.')[0] if r[ix['id']] is not None else None
    if not k: continue
    p = ph(r[ix['phone_numb']])
    cur = out.setdefault('hh:' + k, {'phone': None, 'website': None, 'instagram': None, 'x_link': None, 'opening_hours': None, 'rating': None, 'reviews_count': None, 'status': None, 'src': 'surveyor_collection'})
    if p and not cur['phone']: cur['phone'] = p
db = duckdb.connect()
db.execute("create table s (poi_key varchar, phone varchar, website varchar, instagram varchar, x_link varchar, opening_hours varchar, rating varchar, reviews_count varchar, status varchar, src varchar)")
db.executemany("insert into s values (?,?,?,?,?,?,?,?,?,?)", [(k, v['phone'], v['website'], v['instagram'], v['x_link'], v['opening_hours'], str(v['rating']) if v['rating'] is not None else None,
     str(v['reviews_count']) if v['reviews_count'] is not None else None, v['status'], v['src']) for k, v in out.items()])
db.execute("copy s to '/Users/m4pro/farq-taxonomy-data/enrich/drive_sheets.parquet' (format parquet)")
print(db.execute("select count(*), count(phone), count(website), count(instagram), count(opening_hours), count(rating) from s").fetchone())
