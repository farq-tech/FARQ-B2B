# -*- coding: utf-8 -*-
"""Copy Farq (فرق بناء) suppliers into the targeting set (data/targets.parquet), same schema.

Read-only on the Farq database. Run from ~/farq-targeting:
    railway run -- nice python3 <this file> export     # suppliers -> data/farq_suppliers.parquet
    nice python3 <this file> merge                     # -> data/targets.new.parquet + report

- A supplier whose phone already exists in the set enriches that place: source 'farq_supplier',
  its items/activities join the search text, the email fills in when missing. No duplicate.
- Any other supplier becomes a new place `farq:<supplier id>`.
- City: the Farq city text mapped to the set's city_en (Arabic or English); no city but coordinates
  -> nearest city centre within 60 km. Suppliers private to another buyer (not the owner / Farq) are left out.
"""
import os, sys, json, re
import duckdb

HERE = os.getcwd()
OUT_SUP = os.path.join(HERE, 'data', 'farq_suppliers.parquet')
SRC = os.path.join(HERE, 'data', 'targets.parquet')
NEW = os.path.join(HERE, 'data', 'targets.new.parquet')
FARQ_OWNERS = ('44cdaadd-e084-4654-a84b-a95e6c920580', '7bb09c2e-b6f1-42c8-8aaa-7b6effb3e431')


def export():
    import psycopg
    rows = []
    with psycopg.connect(os.environ['CONSTRUCTION_DB_URL'], sslmode='require', connect_timeout=20) as c:
        c.execute('set transaction read only')
        cur = c.execute("""
          select s.id::text, s.external_key, s.name_ar, s.name_en, s.city, s.district, s.supplied_items_text, s.source_system,
                 s.directory_visibility, s.qualification_status, s.business_type,
                 coalesce((s.directory_metadata->'geo'->>'lat')::float8, (s.directory_metadata->>'latitude')::float8),
                 coalesce((s.directory_metadata->'geo'->>'lon')::float8, (s.directory_metadata->>'longitude')::float8),
                 s.directory_metadata->'activities', s.directory_metadata->'rule_trades'->>'primary',
                 coalesce(s.directory_metadata->>'website', s.directory_metadata->>'url'),
                 c.whatsapp_e164, c.phone_e164, c.emails
          from construction.suppliers s left join construction.supplier_contacts c on c.supplier_id = s.id
          where s.active and (s.owner_scope_user_id is null or s.owner_scope_user_id::text = any(%s))""", (list(FARQ_OWNERS),))
        for r in cur:
            rows.append(r)
    cols = ['id', 'external_key', 'name_ar', 'name_en', 'city', 'district', 'items', 'source_system', 'visibility', 'qualification',
            'business_type', 'lat', 'lon', 'activities', 'trade', 'website', 'wa', 'phone', 'emails']
    con = duckdb.connect()
    con.execute("""create table sup (id varchar, external_key varchar, name_ar varchar, name_en varchar, city varchar, district varchar, items varchar,
        source_system varchar, visibility varchar, qualification varchar, business_type varchar, lat double, lon double, activities varchar, trade varchar,
        website varchar, wa varchar, phone varchar, emails varchar[])""")
    con.executemany('insert into sup values (' + ','.join(['?'] * 19) + ')',
                    [list(r[:13]) + [json.dumps(r[13], ensure_ascii=False) if r[13] is not None else None] + list(r[14:18]) + [list(r[18] or [])] for r in rows])
    con.execute(f"copy sup to '{OUT_SUP}' (format parquet)")
    print('exported', len(rows), '->', OUT_SUP)


NORM_SQL = "translate(lower(trim({x})), 'أإآةىؤئ', 'اااهيوي')"


def merge():
    con = duckdb.connect()
    con.execute("SET threads=2; SET memory_limit='3GB'")
    con.execute(f"create view t as select * from '{SRC}'")
    con.execute(f"create view s0 as select * from '{OUT_SUP}'")
    # phones: digits only; Saudi mobile = 9665XXXXXXXX
    con.execute("""
      create temp table s as
      select *,
        regexp_replace(coalesce(wa, phone, ''), '[^0-9]', '', 'g') as d0
      from s0""")
    con.execute("""
      create temp table s2 as
      select *,
        case when d0 like '05%' and length(d0) = 10 then '966' || substr(d0, 2)
             when d0 like '5%' and length(d0) = 9 then '966' || d0
             else d0 end as digits
      from s""")
    # city dictionary from the set itself: Arabic (normalised) and English -> city_en; centres for the nearest-city fallback
    # one city_en per key (the spelling used most), only cities big enough to be in the city list
    con.execute(f"""
      create temp table cmap as
      with big as (select city_en, count(*) n from t where city_en is not null group by 1 having count(*) >= 1500),
      keys as (
        select {NORM_SQL.format(x='t.city_ar')} k, t.city_en, count(*) n from t join big using (city_en) where t.city_ar is not null group by 1, 2
        union all select lower(city_en), city_en, n from big)
      select k, arg_max(city_en, n) city_en from keys group by k""")
    con.execute("""
      create temp table centres as
      select city_en, any_value(city_ar) city_ar, any_value(region_en) region_en, any_value(region_ar) region_ar,
             median(latitude) lat, median(longitude) lon, count(*) n
      from t where city_en is not null and latitude is not null group by 1 having count(*) >= 1500""")
    con.execute(f"""
      create temp table s3 as
      select s2.*, coalesce(m.city_en, (
          select c.city_en from centres c
          where s2.lat is not null and abs(c.lat - s2.lat) < 0.6 and abs(c.lon - s2.lon) < 0.6
          order by (c.lat - s2.lat)^2 + (c.lon - s2.lon)^2 limit 1)) as city_en
      from s2 left join cmap m on m.k = {NORM_SQL.format(x='s2.city')}""")
    # existing places by phone
    con.execute("""
      create temp table tp as select poi_key, regexp_replace(coalesce(phone_norm, ''), '[^0-9]', '', 'g') d from t where phone_norm is not null""")
    con.execute("""
      create temp table hits as
      select s3.id sid, min(tp.poi_key) poi_key from s3 join tp on tp.d = s3.digits where length(s3.digits) >= 9 group by 1""")
    # text each supplier brings to search: items, activities, trade
    con.execute("""
      create temp table stext as
      select id, trim(concat_ws(' ', items, regexp_replace(coalesce(activities, ''), '[\\[\\]"]', ' ', 'g'), trade)) txt,
             emails[1] email from s3""")
    enrich = con.execute("""
      create temp table enr as
      select h.poi_key, string_agg(x.txt, ' ') txt, min(x.email) email from hits h join stext x on x.id = h.sid group by 1""")
    # new places
    con.execute("""
      create temp table newp as
      select 'farq:' || s3.id poi_key, null::bigint hudhud_id, s3.name_ar, s3.name_en, null legal_name, null brand_name,
        s3.trade category, coalesce(nullif(regexp_replace(coalesce(s3.activities, ''), '[\\[\\]"]', '', 'g'), ''), s3.items) category_ar,
        null secondary_category, null category_l3, null google_category, s3.items description_ar, null description_en,
        null company_status, null lifecycle_state,
        c.region_en, c.region_ar, s3.city_en, c.city_ar, null district_en, s3.district district_ar, null full_address_ar, null full_address_en,
        s3.lat latitude, s3.lon longitude,
        coalesce(s3.wa, s3.phone) phone_raw,
        case when length(s3.digits) >= 9 then '+' || s3.digits end phone_norm,
        case when s3.digits like '9665%' and length(s3.digits) = 12 then 'mobile' when length(s3.digits) >= 9 then 'landline' end phone_kind,
        (s3.digits like '9665%' and length(s3.digits) = 12) has_whatsapp,
        s3.emails[1] email, s3.website, null instagram, null x_link, null snapchat, null tiktok, null working_hours, null rating, null reviews_count,
        null commercial_license, ['farq_supplier', lower(coalesce(s3.source_system, 'farq'))] sources, 1::bigint source_count,
        round(100.0 * ((s3.name_ar is not null)::int + (s3.city_en is not null)::int + (s3.lat is not null)::int + (length(s3.digits) >= 9)::int + (s3.emails[1] is not null)::int) / 5, 1) completeness_pct,
        lower(concat_ws(' ', s3.name_ar, s3.name_en, x.txt, s3.city, s3.district)) search_text
      from s3 left join centres c on c.city_en = s3.city_en join stext x on x.id = s3.id
      where s3.id not in (select sid from hits)
        and (s3.name_ar is not null or s3.name_en is not null)""")
    con.execute(f"""
      copy (
        select t.* replace (
          case when e.poi_key is not null then list_distinct(list_append(t.sources, 'farq_supplier')) else t.sources end as sources,
          case when e.poi_key is not null then t.source_count + 1 else t.source_count end as source_count,
          case when e.poi_key is not null then lower(concat_ws(' ', t.search_text, e.txt)) else t.search_text end as search_text,
          coalesce(t.email, e.email) as email)
        from t left join enr e on e.poi_key = t.poi_key
        union all by name
        select * from newp
      ) to '{NEW}' (format parquet, compression zstd)""")
    rep = {
        'suppliers': con.execute('select count(*) from s3').fetchone()[0],
        'matched_existing_by_phone': con.execute('select count(*) from hits').fetchone()[0],
        'existing_places_enriched': con.execute('select count(*) from enr').fetchone()[0],
        'new_places': con.execute('select count(*) from newp').fetchone()[0],
        'new_with_city': con.execute('select count(*) from newp where city_en is not null').fetchone()[0],
        'new_with_coords': con.execute('select count(*) from newp where latitude is not null').fetchone()[0],
        'new_with_whatsapp': con.execute('select count(*) from newp where has_whatsapp').fetchone()[0],
        'new_with_email': con.execute('select count(*) from newp where email is not null').fetchone()[0],
        'total_after': con.execute(f"select count(*) from '{NEW}'").fetchone()[0],
        'new_by_city': con.execute('select city_en, count(*) from newp group by 1 order by 2 desc limit 10').fetchall(),
    }
    print(json.dumps(rep, ensure_ascii=False, default=str, indent=1))


if __name__ == '__main__':
    {'export': export, 'merge': merge}[sys.argv[1]]()
