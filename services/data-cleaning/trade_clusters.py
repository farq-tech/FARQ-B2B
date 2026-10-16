"""Trade clusters: streets, districts and ~300 m cells where one trade concentrates («شارع الكهرباء بالفيصلية»), plus a
row-level wholesale flag. Owner request 2026-10-16: wholesale first-class, clusters on the map, target a trade by street/district.

Input : staging-targeting/data/targets.parquet (golden export) + farq_taxonomy.json (sub roles)
Output: enrich/wholesale_flag.parquet (poi_key, is_wholesale, wholesale_basis)
        enrich/trade_clusters.parquet (one row per cluster: level street|district|cell, city, district, street, sub, counts, lift, centroid)
A cluster is evidence of concentration only (counts + lift over the city's share of that trade); never a claim about prices."""
import duckdb, json, re
D = '/Users/m4pro/farq-taxonomy-data/'
T = D + 'staging-targeting/data/targets.parquet'
TAX = '/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/farq_taxonomy.json'
subs = json.load(open(TAX, encoding='utf-8'))['subs']
db = duckdb.connect()
db.execute("create table subs as select * from (values " + ','.join(
    "('%s','%s','%s')" % (s['sub_id'], s['sub_ar'].replace("'", "''"), (s.get('roles') or '').replace("'", "''")) for s in subs) + ") t(sub_id, sub_ar, roles)")

WS = r'(جمل[ةه]|بالجمل|موزع|توزيع|مستودع|مستودعات|وكيل|وكلاء|wholesale|distribut|warehouse|trading est)'
db.execute(f"""
create table base as
select t.poi_key, t.city_en, nullif(trim(t.district_ar),'') district_ar, nullif(trim(t.street_ar),'') street_ar, t.sub_id,
       t.latitude lat, t.longitude lon,
       case when regexp_matches(lower(coalesce(t.name_ar,'')||' '||coalesce(t.name_en,'')), '{WS}') then 'name'
            when regexp_matches(lower(coalesce(t.category_ar,'')||' '||coalesce(t.category,'')||' '||coalesce(t.specialties_ar,'')), '{WS}') then 'category'
            when s.roles like '%wholesale%' and s.roles not like '%retail%' then 'subcategory'
            else null end wholesale_basis
from read_parquet('{T}') t left join subs s using (sub_id)
where t.sub_id is not null and t.sub_id not like 'unc.%' and t.sub_id not like 'noncom.%' and t.latitude is not null
""")
db.execute("copy (select poi_key, wholesale_basis is not null is_wholesale, wholesale_basis from base) to '" + D + "enrich/wholesale_flag.parquet' (format parquet)")

# street names: drop the generic prefix so «شارع الملك فهد» and «طريق الملك فهد» do not split one street; keep the original for display
db.execute(r"""create table b2 as select *, nullif(trim(regexp_replace(regexp_replace(coalesce(street_ar,''), '^(شارع|طريق|ش\.?|street|st\.?|road|rd\.?)\s+', '', 'i'), '\s+', ' ', 'g')),'') street_key,
                round(lat/0.003)*0.003 cy, round(lon/0.003)*0.003 cx from base""")
db.execute("create table city_share as select city_en, sub_id, n_sub, sum(n_sub) over (partition by city_en) n_city from (select city_en, sub_id, count(*) n_sub from b2 group by city_en, sub_id)")

def level(name, keys, where, min_n, min_lift):
    k = ', '.join(keys)
    db.execute(f"""
    create or replace table lv_{name} as
    with g as (select city_en, {k}, sub_id, count(*) n, count(*) filter (where wholesale_basis in ('name','category')) n_wholesale,
                      avg(lat) lat, avg(lon) lon, mode(district_ar) district_any, mode(street_ar) street_display,
                      count(distinct (round(lat,4), round(lon,4))) n_points
               from b2 where {where} group by city_en, {k}, sub_id),
         a as (select city_en, {k}, sum(n) n_all from g group by city_en, {k})
    select '{name}' as level, g.*, a.n_all, round((g.n::double/a.n_all)/(c.n_sub::double/c.n_city),1) lift
    from g join a using (city_en, {k}) join city_share c using (city_en, sub_id)
    -- many shops on one coordinate is a geocoding fallback (city/district centroid), not a market street
    where g.n_points >= 0.5 * g.n and g.n >= {min_n} and (g.n::double/a.n_all)/(c.n_sub::double/c.n_city) >= {min_lift}""")

level('street', ['district_ar', 'street_key'], 'street_key is not null and district_ar is not null', 6, 3)
level('district', ['district_ar'], 'district_ar is not null', 15, 2.5)
level('cell', ['cy', 'cx'], 'true', 10, 4)
db.execute(f"""
copy (
  select l."level", l.city_en, coalesce(l.district_ar, l.district_any) district_ar,
         case when l."level"='street' then l.street_display end street_ar, l.sub_id, s.sub_ar, l.n, l.n_wholesale,
         round(100.0*l.n_wholesale/l.n) wholesale_pct, l.n_all, l.lift, l.lat, l.lon,
         s.sub_ar || case when l.n_wholesale*1.0/l.n >= 0.3 then ' (جملة)' else '' end ||
           case l."level" when 'street' then ' — ' || coalesce(l.street_display,'') || '، ' || coalesce(l.district_ar,'')
                        when 'district' then ' — حي ' || coalesce(l.district_ar,'')
                        else ' — قرب ' || coalesce(l.district_any,'') end label_ar
  from (select "level", city_en, district_ar, sub_id, n, n_wholesale, lat, lon, district_any, street_display, n_all, lift from lv_street
        union all select "level", city_en, district_ar, sub_id, n, n_wholesale, lat, lon, district_any, null::varchar, n_all, lift from lv_district
        union all select "level", city_en, null::varchar, sub_id, n, n_wholesale, lat, lon, district_any, null::varchar, n_all, lift from lv_cell) l
  join subs s using (sub_id)
  order by city_en, n desc) to '{D}enrich/trade_clusters.parquet' (format parquet)""")
print(db.sql(f"select level_, count(*) clusters, sum(n) businesses, count(*) filter (where wholesale_pct>=30) wholesale_clusters from (select \"level\" level_, * from '{D}enrich/trade_clusters.parquet') group by all"))
print(db.sql(f"select count(*) filter (where is_wholesale) wholesale, count(*) all_rows from '{D}enrich/wholesale_flag.parquet'"))
