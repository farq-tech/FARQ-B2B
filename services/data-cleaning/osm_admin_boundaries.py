"""OSM administrative boundary polygons for Saudi Arabia (Geofabrik gcc-states, © OpenStreetMap contributors, ODbL), assembled from
relations: boundary=administrative, admin_level 4 (region), 6 (governorate), 8, 9 (municipality), 10 (district). Outer member ways are
joined into polygons (ST_BuildArea). Read-only.
Usage: python3 osm_admin_boundaries.py gcc-states-latest.osm.pbf OUT.parquet"""
import duckdb, sys
F, OUT = sys.argv[1], sys.argv[2]
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("LOAD spatial"); db.execute("SET memory_limit='16GB'")
db.execute(f"""create table rel as select id, tags, refs, ref_roles, ref_types::varchar[] rt from ST_ReadOSM('{F}') where kind='relation'
   and tags['boundary']='administrative' and tags['admin_level'] in ('4','6','8','9','10')""")
db.execute("""create table mem as select id as rid, refs[i] as wid from (select *, generate_subscripts(refs, 1) as i from rel)
   where rt[i]='way' and coalesce(nullif(ref_roles[i],''),'outer')='outer'""")
db.execute(f"create table wy as select id, refs from ST_ReadOSM('{F}') where kind='way' and id in (select wid from mem)")
db.execute("create table wv as select id as wid, i as ord, refs[i] as nref from (select *, generate_subscripts(refs,1) as i from wy)")
db.execute(f"create table nd as select id, lon, lat from ST_ReadOSM('{F}') where kind='node' and id in (select nref from wv)")
db.execute("create table wl as select wv.wid, ST_MakeLine(list(ST_Point(nd.lon, nd.lat) order by wv.ord)) as g from wv join nd on nd.id=wv.nref group by 1")
db.execute("""create table poly as select r.id, r.tags['admin_level'] as lvl, coalesce(r.tags['name:ar'], r.tags['name']) as name_ar,
   coalesce(r.tags['name:en'], r.tags['name']) as name_en, ST_BuildArea(ST_Union_Agg(wl.g)) as geom
   from rel r join mem m on m.rid=r.id join wl on wl.wid=m.wid group by 1,2,3,4""")
print(db.execute("select lvl, count(*), count(*) filter (where geom is not null and not ST_IsEmpty(geom)) from poly group by 1 order by 1").fetchall())
db.execute(f"copy (select id, lvl, name_ar, name_en, ST_AsWKB(geom) as wkb from poly where geom is not null and not ST_IsEmpty(geom)) to '{OUT}' (format parquet)")
