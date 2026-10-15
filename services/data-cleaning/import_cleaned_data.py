"""Import «cleaned_data (3)» (69,122 Riyadh-area businesses, 2025-03) as an enrichment layer. Read-only on the directory.
Match: same phone (last 9 digits) within 2 km, else same name (Arabic or English) within 150 m.
Writes /Users/m4pro/farq-taxonomy-data/enrich/cleaned_data_attrs.parquet (company size, branches, legal name, address, Makani,
payment methods, socials, hours) and cleaned_data_new.parquet (rows not in the directory)."""
import duckdb, sys
F = sys.argv[1]
PREFIX = sys.argv[2] if len(sys.argv) > 2 else 'cleaned_data'   # e.g. western_cleaning (same Urbi schema)
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
O = '/Users/m4pro/farq-taxonomy-data/enrich/'
db = duckdb.connect(); db.execute("SET threads=6")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
# names carry «, category» suffixes («9 Round Kickboxing Fitness, gym») – the part before the comma is the name
K_AR = nm("split_part(\"Name Arabic\", ',', 1)"); K_EN = nm("split_part(\"Name\", ',', 1)")
db.execute("create table raw as select * from read_csv(?, all_varchar=true, header=true, ignore_errors=true)", [F])
for col, in db.execute("select column_name from (describe raw)").fetchall():
    db.execute(f'update raw set "{col}" = null where trim("{col}") in (\'None\', \'{{}}\', \'\', \'nan\')')
db.execute(f"""create table c as select row_number() over () rid, *,
   {K_AR} k_ar, {K_EN} k_en,
   try_cast("Latitude" as double) lat, try_cast("Longitude" as double) lon, right(regexp_replace(coalesce("Phone",''),'[^0-9]','','g'),9) ph
   from raw""")
db.execute(f"""create table t as select poi_key, {nm("coalesce(nullif(name_ar,''),name_en)")} k, {nm('name_en')} k_en, latitude lat, longitude lon,
   right(regexp_replace(coalesce(phone_norm,''),'[^0-9]','','g'),9) ph from read_parquet('{P}') where latitude is not null""")
db.execute("""create table m as
  select c.rid, t.poi_key, 0 pr from c join t on c.ph<>'' and length(c.ph)=9 and c.ph=t.ph and abs(c.lat-t.lat)<0.02 and abs(c.lon-t.lon)<0.02
  union all select c.rid, t.poi_key, 1 from c join t on length(c.k_ar)>=4 and c.k_ar=t.k and abs(c.lat-t.lat)<0.00135 and abs(c.lon-t.lon)<0.0015
  union all select c.rid, t.poi_key, 1 from c join t on length(c.k_en)>=4 and c.k_en in (t.k, t.k_en) and abs(c.lat-t.lat)<0.00135 and abs(c.lon-t.lon)<0.0015""")
db.execute("create table best as select rid, arg_min(poi_key, pr) poi_key, min(pr) pr from m group by rid")
cols = '''"Number of Employees" employees_band, "Branches Count" branches_count, nullif("Legal Name",'') legal_name_en, nullif("Legal Name Arabic",'') legal_name_ar,
   nullif("Brand Name",'') brand_name, nullif("Building Number",'') building_number, nullif("Building ID",'') building_id, nullif("Street Arabic",'') street_ar,
   nullif("Street",'') street_en, nullif("Makani",'') makani, nullif("Floor",'') floor, nullif("Payment Methods",'') payment_methods,
   nullif("Service Languages",'') service_languages, nullif("Category Arabic",'') category_ar, nullif("Category English",'') category_en,
   nullif("Website",'') website, nullif("Email",'') email, nullif("Instagram",'') instagram, nullif("Twitter",'') twitter, nullif("LinkedIn",'') linkedin,
   nullif("Phone",'') phone, concat_ws(' | ', "Sun Working Hours","Mon Working Hours","Tue Working Hours","Wed Working Hours","Thu Working Hours","Fri Working Hours","Sat Working Hours") working_hours'''
db.execute(f"copy (select b.poi_key, case b.pr when 0 then 'phone_2km' else 'name_150m' end matched_by, {cols} from best b join c using(rid)) to '{O}{PREFIX}_attrs.parquet' (format parquet)")
NAMES = "nullif(\"Name Arabic\",'') name_ar, nullif(\"Name\",'') name_en"
db.execute(f"copy (select lat, lon, {NAMES}, {cols} from c anti join best using(rid)) to '{O}{PREFIX}_new.parquet' (format parquet)")
s = db.execute(f"select count(*), count(employees_band), count(*) filter (where employees_band not in ('up to 15')), count(legal_name_ar), count(makani) from read_parquet('{O}{PREFIX}_attrs.parquet')").fetchone()
print('rows:', db.execute('select count(*) from c').fetchone()[0], '| matched:', s[0], '| with company size:', s[1], '(16+ employees:', s[2], ') | legal name ar:', s[3], '| makani:', s[4])
n = db.execute(f"select count(*), count(phone), count(category_en) from read_parquet('{O}{PREFIX}_new.parquet')").fetchone()
print('not in directory:', n[0], '| with phone:', n[1], '| with category:', n[2])
