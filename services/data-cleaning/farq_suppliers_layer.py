"""Farq construction-database suppliers (export of 2026-10-09, data/farq_suppliers.parquet in the targeting folder, read-only): 146,201
suppliers, of which 129,778 entered the directory as 'farq:<id>' rows. Most have no coordinates (120 k were excluded from the golden set as
«no location»). This layer gives every 'farq:' row:
- a subcategory from what the supplier says it supplies (items, activities, trade) through the row classifier;
- the supplier's district text matched to ONE official/OSM district of the same city (exact after normalisation), giving the district
  and, when coordinates are missing, the district's median point (`location_precision = 'district'`);
- else a city-level location when coordinates are missing: the median point of the golden rows of that city, flagged
  `location_precision = 'city'` (never shown as an exact point);
- the supplier attributes: items, activities, trade, business type, qualification, source system, visibility.
Output: /Users/m4pro/farq-taxonomy-data/enrich/farq_suppliers_layer.parquet"""
import os, subprocess, tempfile
import duckdb
S = '/Users/m4pro/farq-targeting/data/farq_suppliers.parquet'
D = '/Users/m4pro/farq-taxonomy-data/'
db = duckdb.connect(); db.execute("SET threads=6")
db.execute(f"create table s as select 'farq:' || id poi_key, * from read_parquet('{S}')")
tmp = tempfile.mkdtemp()
db.execute(f"""copy (select poi_key, name_ar, name_en, replace(coalesce(items, activities),'|',', ') category, items category_ar,
   concat_ws(', ', activities, trade) secondary_category, trade google_category, null::varchar lifecycle_state, null::varchar company_status from s) to '{tmp}/s.parquet' (format parquet)""")
subprocess.run(['python3', 'classify_rows.py', f'{tmp}/s.csv'], cwd='/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/rowlevel',
               env={**os.environ, 'CLASSIFY_INPUT': f'{tmp}/s.parquet'}, check=True, stdout=subprocess.DEVNULL)
db.execute(f"create table c as select * from read_csv('{tmp}/s.csv', all_varchar=true)")
# city centroid per city name as written in the golden set (Arabic or English), from located golden rows
db.execute(f"""create table cc as select k, median(latitude) clat, median(longitude) clon, any_value(city_en) city_en, any_value(city_ar) city_ar from (
   select lower(trim(city_ar)) k, latitude, longitude, city_en, city_ar from read_parquet('{D}golden/golden_set.parquet') where in_golden and city_ar is not null
   union all select lower(trim(city_en)), latitude, longitude, city_en, city_ar from read_parquet('{D}golden/golden_set.parquet') where in_golden and city_en is not null)
   group by 1 having count(*) >= 20""")
# city for suppliers with no city text (owner: most suppliers are in Riyadh): landline area code 011 -> Riyadh; else a city name
# found in the supplier name or items; else Riyadh, flagged `farq_city_method = 'assumed_riyadh'` so search can rank it below known cities
db.execute("""create table cnames as select k, city_en from cc where length(k) >= 4 and regexp_matches(k, '[ء-ي]')""")
db.execute("""create table s_city as select s.poi_key, case
     when cc.city_en is not null then cc.city_en
     when regexp_matches(regexp_replace(coalesce(s.phone,''),'[^0-9]','','g'), '^(00966|966|0)?11[0-9]{7}$') then 'Riyadh'
     else (select any_value(n.city_en) from cnames n where position(n.k in lower(coalesce(s.name_ar,'') || ' ' || coalesce(s.items,''))) > 0) end city_found,
   case when cc.city_en is not null then 'supplier_city'
     when regexp_matches(regexp_replace(coalesce(s.phone,''),'[^0-9]','','g'), '^(00966|966|0)?11[0-9]{7}$') then 'landline_011'
     when (select count(*) from cnames n where position(n.k in lower(coalesce(s.name_ar,'') || ' ' || coalesce(s.items,''))) > 0) > 0 then 'name_mentions_city' end city_how
   from s left join cc on cc.k = lower(trim(s.city))""")
db.execute("create table s_city2 as select poi_key, coalesce(city_found, 'Riyadh') city_en, coalesce(city_how, 'assumed_riyadh') city_how from s_city")
db.execute("create table cc_en as select city_en, any_value(city_ar) city_ar, any_value(clat) clat, any_value(clon) clon from cc group by 1")
# district: the supplier's own district text, matched to an official/OSM-boundary district of the SAME city only.
# Names are normalised (no «حي», no article, unified hamza/taa/yaa, no spaces); a match must be exact after normalisation and
# point to ONE district of that city — anything else stays without a district.
db.execute(f"""create macro dn(x) as regexp_replace(regexp_replace(translate(lower(trim(coalesce(x,''))),'أإآٱةىؤئ','ااااهيوي'),'^(حي|حى)[[:space:]]+',''),'[^a-z0-9ء-ي]+','','g')""")
db.execute(f"""create table dref as select city_en, coalesce(district_ar, district) district_ar, any_value(district_en) district_en,
   median(latitude) dlat, median(longitude) dlon, count(*) n
   from read_parquet('{D}golden/golden_set.parquet') where in_golden and district_method in ('official_boundary','osm_boundary') and city_en is not null
   group by 1, 2 having count(*) >= 5""")
db.execute("create table dk as select city_en, regexp_replace(dn(district_ar), '^ال', '') k, district_ar, district_en, dlat, dlon from dref")
db.execute("create table dku as select * from dk where (city_en, k) in (select city_en, k from dk group by 1, 2 having count(*) = 1)")
# match suppliers without coordinates to an existing located golden row: same phone (anywhere), else same normalised name in the same
# city when that name is unique among the city's located rows. The supplier then merges into that row (no approximate point).
db.execute(f"""create table gl as select poi_key gkey, phone, city_en, regexp_replace(translate(lower(coalesce(name_ar, name_en,'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g') k,
   regexp_replace(regexp_replace(translate(lower(coalesce(name_ar, name_en,'')),'أإآةىؤئ','اااهيوي'), '(^|\\s)(مؤسسه|مؤسسة|موسسه|موسسة|شركه|شركة|للمقاولات|المقاولات|مقاولات|العامه|العامة|عامه|المحدوده|المحدودة|التجاريه|التجارية|للتجاره|للتجارة|تجاره|ذ م م|est|co|company|trading|contracting|ltd|llc)(\\s|$)', ' ', 'g'),'[^a-z0-9ء-ي]+','','g') kc,
   regexp_replace(translate(lower(coalesce(name_en,'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g') k2
   from read_parquet('{D}golden/golden_set.parquet') where latitude is not null and coalesce(location_precision,'point')='point' and poi_key not like 'farq:%'
     and coalesce(exclude_reason,'') not in ('hudhud_deleted','surveyor_closed','google_permanently_closed')""")
db.execute("""create table sp as select s.poi_key, '+966' || regexp_replace(regexp_replace(s.phone,'[^0-9]','','g'), '^(00966|966|0)', '') ph,
   regexp_replace(translate(lower(coalesce(s.name_ar, s.name_en,'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g') k,
   regexp_replace(regexp_replace(translate(lower(coalesce(s.name_ar, s.name_en,'')),'أإآةىؤئ','اااهيوي'), '(^|\\s)(مؤسسه|مؤسسة|موسسه|موسسة|شركه|شركة|للمقاولات|المقاولات|مقاولات|العامه|العامة|عامه|المحدوده|المحدودة|التجاريه|التجارية|للتجاره|للتجارة|تجاره|ذ م م|est|co|company|trading|contracting|ltd|llc)(\\s|$)', ' ', 'g'),'[^a-z0-9ء-ي]+','','g') kc, cc.city_en
   from s join s_city2 cc using(poi_key) where s.lat is null""")
# a shared phone alone is not enough (the Farq database has agent/shared numbers): the names must also agree
db.execute("""create table m_phone as select sp.poi_key, any_value(gl.gkey) gkey, 'phone+name' how from sp join gl on gl.phone = sp.ph
   where length(sp.ph) >= 12 and length(sp.kc) >= 4 and length(gl.kc) >= 4
     and (jaro_winkler_similarity(sp.kc, gl.kc) >= 0.88 or (length(gl.kc) >= 6 and (position(gl.kc in sp.kc) > 0 or position(sp.kc in gl.kc) > 0)))
   group by 1 having count(distinct gl.gkey) = 1""")
db.execute("""create table m_name as select sp.poi_key, any_value(gl.gkey) gkey, 'name_city' how from sp join gl on gl.city_en = sp.city_en and (gl.k = sp.k or gl.k2 = sp.k)
   where length(sp.k) >= 6 and sp.poi_key not in (select poi_key from m_phone) group by 1 having count(distinct gl.gkey) = 1""")
db.execute("create table mm as select * from m_phone union all select * from m_name")
PH = lambda c: f"case when regexp_matches(regexp_replace(coalesce({c},''),'[^0-9]','','g'), '^(00966|966|0)?(5[0-9]{{8}}|1[1-7][0-9]{{7}}|9200[0-9]{{5}})$') then '+966' || regexp_replace(regexp_replace({c},'[^0-9]','','g'), '^(00966|966|0)', '') end"
db.execute(f"copy (select mm.*, c.sub_id farq_sub, c.confidence farq_sub_conf, s.items farq_items, s.activities farq_activities, s.trade farq_trade, {PH('s.phone')} farq_phone, {PH('s.wa')} farq_wa from mm join s using(poi_key) join c using(poi_key)) to '{D}enrich/farq_suppliers_matched.parquet' (format parquet)")
db.execute(f"""copy (select s.poi_key, c.sub_id farq_sub,
   c.confidence farq_sub_conf, s.items farq_items, s.activities farq_activities, s.trade farq_trade,
   s.business_type farq_business_type, s.qualification farq_qualification, s.source_system farq_source_system, s.visibility farq_visibility,
   case when s.lat is null then ce.clat end city_lat, case when s.lat is null then ce.clon end city_lon, sc.city_en farq_city_en, ce.city_ar farq_city_ar, sc.city_how farq_city_method
   , case when s.lat is null then d.dlat end district_lat, case when s.lat is null then d.dlon end district_lon, d.district_ar farq_district_ar, d.district_en farq_district_en,
   s.district farq_district_raw, mm.gkey merged_into, mm.how merged_how,
   {PH('s.phone')} farq_phone, {PH('s.wa')} farq_wa
   from s left join c using(poi_key) join s_city2 sc using(poi_key) left join cc_en ce on ce.city_en = sc.city_en
   left join mm using(poi_key)
   left join dku d on d.city_en = sc.city_en and d.k = regexp_replace(dn(s.district), '^ال', '') and length(d.k) >= 2) to '{D}enrich/farq_suppliers_layer.parquet' (format parquet)""")
print(db.execute(f"""select count(*), count(*) filter (where farq_sub not like 'unc.%' and farq_sub_conf in ('high','medium')), count(city_lat), count(farq_city_en),
   count(farq_district_raw), count(farq_district_ar), count(district_lat), count(merged_into), count(*) filter (where merged_how='phone+name')
   from read_parquet('{D}enrich/farq_suppliers_layer.parquet')""").fetchone())
