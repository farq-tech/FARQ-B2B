"""Street name for every golden point from OpenStreetMap highways (Geofabrik gcc-states, © OpenStreetMap contributors, ODbL).
Arabic first: name:ar, else name when it is written in Arabic letters; English from name:en (else a Latin name).
Each way is split into vertex-to-vertex segments, indexed on a ~110 m grid; a point takes the nearest named segment within MAX_M
(point-to-segment distance, longitude scaled by cos(lat)). Kept as its own columns with the distance; read-only.
Usage: python3 osm_streets.py gcc-states-latest.osm.pbf
Output: /Users/m4pro/farq-taxonomy-data/golden/osm_streets.parquet (poi_key, street_ar, street_en, street_kind, street_m)"""
import duckdb, sys
F = sys.argv[1]
MAX_M = 80
C = 0.001   # grid cell in degrees
D = '/Users/m4pro/farq-taxonomy-data/golden/'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='20GB'"); db.execute("LOAD spatial")
KINDS = "('motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street','service','pedestrian','road','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link')"
db.execute(f"""create table w as select id, refs, tags['highway'] kind,
   coalesce(tags['name:ar'], case when regexp_matches(coalesce(tags['name'],''), '[؀-ۿ]') then tags['name'] end) street_ar,
   coalesce(tags['name:en'], case when regexp_matches(coalesce(tags['name'],''), '^[^؀-ۿ]*[A-Za-z]') then tags['name'] end) street_en
   from ST_ReadOSM('{F}') where kind='way' and tags['highway'] in {KINDS} and (tags['name'] is not null or tags['name:ar'] is not null or tags['name:en'] is not null)""")
db.execute(f"""create table v as select w.id wid, r.ord, r.ref from w, unnest(w.refs) with ordinality as r(ref, ord)""")
db.execute(f"""create table nd as select id, lat, lon from ST_ReadOSM('{F}') where kind='node' and id in (select ref from v)""")
db.execute("""create table seg as select a.wid, n1.lon x1, n1.lat y1, n2.lon x2, n2.lat y2
   from v a join v b on a.wid=b.wid and b.ord=a.ord+1 join nd n1 on n1.id=a.ref join nd n2 on n2.id=b.ref
   where n1.lat between 16 and 32.2""")
db.execute(f"""create table si as select row_number() over () sid, * from seg""")
pad = MAX_M / 100000
db.execute(f"""create table cell as select sid, cx, cy from si,
   range(cast(floor((least(x1,x2)-{pad})/{C}) as bigint), cast(floor((greatest(x1,x2)+{pad})/{C}) as bigint)+1) t1(cx),
   range(cast(floor((least(y1,y2)-{pad})/{C}) as bigint), cast(floor((greatest(y1,y2)+{pad})/{C}) as bigint)+1) t2(cy)""")
db.execute(f"""create table p as select poi_key, latitude y, longitude x, cast(floor(longitude/{C}) as bigint) cx, cast(floor(latitude/{C}) as bigint) cy
   from read_parquet('{D}golden_set.parquet') where latitude between 16 and 33""")
# point-to-segment distance in a local metric frame (metres)
db.execute(f"""create table near as select p.poi_key, s.wid,
   (with_k.dx) dx from p join cell c using(cx, cy) join si s using(sid),
   lateral (select 111320*cos(radians(p.y)) kx, 110540 ky) k,
   lateral (select (s.x2-s.x1)*k.kx ux, (s.y2-s.y1)*k.ky uy, (p.x-s.x1)*k.kx px, (p.y-s.y1)*k.ky py) q,
   lateral (select greatest(0, least(1, (q.px*q.ux+q.py*q.uy)/nullif(q.ux*q.ux+q.uy*q.uy,0))) t) tt,
   lateral (select sqrt(power(q.px - coalesce(tt.t,0)*q.ux,2) + power(q.py - coalesce(tt.t,0)*q.uy,2)) dx) with_k
   where with_k.dx <= {MAX_M}""")
db.execute(f"""copy (select n.poi_key, arg_min(w.street_ar, n.dx) street_ar, arg_min(w.street_en, n.dx) street_en, arg_min(w.kind, n.dx) street_kind,
   round(min(n.dx)) street_m from near n join w on w.id=n.wid group by 1) to '{D}osm_streets.parquet' (format parquet)""")
print('points:', db.execute('select count(*) from p').fetchone()[0], '| with street:',
      db.execute(f"select count(*), count(street_ar), count(street_en), median(street_m) from read_parquet('{D}osm_streets.parquet')").fetchone())
