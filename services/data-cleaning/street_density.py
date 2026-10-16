"""Street density of each trade along real streets (owner 2026-10-16: «تحديد الشوارع اللي فيها كثافة للتصنيفات غير جيدة»).
Each precisely located business (location_precision='point') is snapped to the nearest named OSM street within 40 m; for every
(street way, subcategory) we count shops, then join touching ways of the same street name into stretches where the trade is dense
(≥ 1 shop per 100 m, ≥ 5 shops, ≥ 3× the trade's share of the city). Output: GeoJSON-ready lines with counts, length and lift.
Usage: street_density.py <city_en> <W> <S> <E> <N> <out.parquet>"""
import sys, collections, math, json
import duckdb, numpy as np
from shapely import STRtree, from_wkb, points, get_coordinates
from shapely.geometry import mapping
from shapely.ops import linemerge, unary_union
CITY, W, S, E, N, OUT = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
P = '/Users/m4pro/farq-taxonomy-data/raw/osm/gcc-states-latest.osm.pbf'
T = '/Users/m4pro/farq-taxonomy-data/export/targets_golden.parquet'
c = duckdb.connect(); c.execute("install spatial; load spatial; set threads=8; set memory_limit='12GB'")
c.execute(f"create table nodes as select id, lat, lon from st_readosm('{P}') where kind='node' and lat between {S} and {N} and lon between {W} and {E}")
c.execute(f"""create table ways as select id, refs, map_extract_value(tags,'highway') hw, coalesce(map_extract_value(tags,'name:ar'), map_extract_value(tags,'name')) nm
  from st_readosm('{P}') where kind='way' and map_contains(tags,'highway') and (map_contains(tags,'name') or map_contains(tags,'name:ar'))""")
c.execute("create table wn as select w.id, w.hw, w.nm, r.ref, r.i from ways w, unnest(w.refs) with ordinality as r(ref,i)")
roads = c.execute("""select wn.id, any_value(nm), ST_AsWKB(ST_MakeLine(list(ST_Point(n.lon,n.lat) order by wn.i))) from wn join nodes n on n.id=wn.ref
  where hw not in ('footway','path','steps','cycleway','track','construction','proposed','service') group by wn.id having count(*)>=2""").fetchall()
ids = [r[0] for r in roads]; names = [r[1] for r in roads]; geoms = from_wkb([bytes(r[2]) for r in roads])
k = math.cos(math.radians((S + N) / 2))           # degrees → metres (equirectangular, fine at city scale)
def m(g):  # length in metres
    xy = get_coordinates(g); d = np.diff(xy, axis=0); return float(np.sum(np.hypot(d[:, 0] * k, d[:, 1])) * 111_320)
lengths = np.array([m(g) for g in geoms])
tree = STRtree(geoms)
pts = c.execute(f"""select poi_key, longitude, latitude, sub_id, coalesce(is_wholesale,false) from read_parquet('{T}')
  where city_en=? and location_precision='point' and sub_id is not null and sub_id not like 'unc.%' and sub_id not like 'noncom.%'
  and longitude between {W} and {E} and latitude between {S} and {N}""", [CITY]).fetchall()
pg = points([(p[1], p[2]) for p in pts])
near = tree.query_nearest(pg, max_distance=40 / 111_320, return_distance=False, all_matches=False)   # ~40 m
hit = collections.Counter(); ws = collections.Counter(); sub_city = collections.Counter(p[3] for p in pts); tot = len(pts)
for pi, ri in zip(*near):
    hit[(ri, pts[pi][3])] += 1
    if pts[pi][4]: ws[(ri, pts[pi][3])] += 1
print(CITY, len(roads), 'ways,', tot, 'precise places,', len(set(near[0])), 'snapped')
# hot ways per subcategory, then stretches = touching ways with the same street name
out = []
by_sub = collections.defaultdict(list)
for (ri, sub), n in hit.items():
    if n >= 2 and n / max(lengths[ri] / 100, 1) >= 0.6: by_sub[sub].append(ri)
for sub, ris in by_sub.items():
    share = sub_city[sub] / tot
    groups = collections.defaultdict(list)
    for ri in ris: groups[names[ri]].append(ri)
    for nm, rs in groups.items():
        u = unary_union([geoms[r] for r in rs])
        merged = linemerge(u) if u.geom_type == 'MultiLineString' else u
        parts = list(merged.geoms) if hasattr(merged, 'geoms') else [merged]
        for part in parts:
            members = [r for r in rs if geoms[r].distance(part) < 1e-7]
            n = sum(hit[(r, sub)] for r in members); L = sum(lengths[r] for r in members)
            if n < 5 or L < 60: continue
            dens = n / (L / 100)
            all_here = sum(v for (r2, s2), v in hit.items() if r2 in members)
            lift = (n / all_here) / share if all_here and share else 0
            if dens < 1 or lift < 3: continue
            out.append((CITY, sub, nm, n, sum(ws[(r, sub)] for r in members), round(L), round(dens, 2), round(lift, 1), json.dumps(mapping(part))))
c.execute("create table o (city_en varchar, sub_id varchar, street_ar varchar, n int, n_wholesale int, length_m int, per_100m double, lift double, geojson varchar)")
out = list({(r[1], r[2], r[3], r[5]): r for r in out}.values())   # a stretch reached from two parts is one stretch
c.executemany("insert into o values (?,?,?,?,?,?,?,?,?)", out)
c.execute(f"copy (select * from o order by n desc) to '{OUT}' (format parquet)")
print(len(out), 'dense stretches;', c.sql("select sub_id, street_ar, n, length_m, per_100m, lift from o order by n desc limit 12").fetchall())
