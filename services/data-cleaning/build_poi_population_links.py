"""Spatially assign Golden POIs to population districts by point-in-polygon, never by a guessed district name.
Runs on the Farq target service and preserves unmatched/boundary-ambiguous POIs with a quality reason.
"""
import csv,json,sys
from pathlib import Path
sys.path.insert(0,'/tmp/farq-audit-libs')
import duckdb,shapely
from shapely.strtree import STRtree
ROOT=Path('/app/data/buildings_ingest'); GOLD=ROOT/'golden'; POP=ROOT/'population'; OUT=GOLD/'v2/poi_population_districts.parquet'
GEO=Path('/app/data/districts.geojson'); G=GOLD/'v2/farq_golden_v2.parquet'; P=POP/'district_population_2025.parquet'
collection=json.loads(GEO.read_text(encoding='utf-8')); ids=[]; geoms=[]; invalid=0
for f in collection['features']:
 prop=f.get('properties') or {}; did=prop.get('id'); geo=f.get('geometry')
 if did is None or not geo: continue
 geom=shapely.geometry.shape(geo)
 if not geom.is_valid: geom=shapely.make_valid(geom); invalid+=1
 ids.append(did); geoms.append(geom)
if len(ids)!=len(set(ids)): raise ValueError('duplicate district ids in boundary source')
tree=STRtree(geoms)
db=duckdb.connect(); db.execute("SET threads=4"); db.execute("SET memory_limit='4GB'")
cur=db.execute(f"select poi_key,longitude,latitude,location_precision from read_parquet('{G}')")
outcsv=GOLD/'v2/poi_population_districts.csv'
counts={'input_rows':0,'matched_unique_district':0,'unmatched_outside_boundaries':0,'ambiguous_boundary':0,'invalid_coordinates':0,'non_point_location':0}
with outcsv.open('w',encoding='utf-8',newline='') as f:
 w=csv.writer(f); w.writerow(['poi_key','district_id','population_estimate','population_coverage_pct','population_year','population_source','spatial_match_status'])
 while True:
  batch=cur.fetchmany(50000)
  if not batch: break
  keys=[r[0] for r in batch]; lons=[r[1] for r in batch]; lats=[r[2] for r in batch]; precisions=[r[3] for r in batch]; n=len(batch); counts['input_rows']+=n
  valid=[i for i,(x,y,precision) in enumerate(zip(lons,lats,precisions)) if x is not None and y is not None and -180<=x<=180 and -90<=y<=90 and precision=='point']
  counts['non_point_location']+=sum(precision!='point' for precision in precisions)
  counts['invalid_coordinates']+=sum(x is None or y is None or not (-180<=x<=180 and -90<=y<=90) for x,y in zip(lons,lats))
  assigned=[None]*n; status=['non_point_location' if precision!='point' else 'invalid_coordinate' for precision in precisions]
  if valid:
   pts=shapely.points([lons[i] for i in valid],[lats[i] for i in valid])
   pairs=tree.query(pts,predicate='intersects')
   pc=len(valid); hits=[[] for _ in range(pc)]
   for pi,gi in zip(pairs[0].tolist(),pairs[1].tolist()): hits[pi].append(int(gi))
   for j,gi in enumerate(valid):
    match=hits[j]
    if len(match)==1: assigned[gi]=int(ids[match[0]]); status[gi]='matched'
    elif len(match)>1: status[gi]='ambiguous_boundary'
    else: status[gi]='outside_boundaries'
  for x in status:
   if x=='matched': counts['matched_unique_district']+=1
   elif x=='ambiguous_boundary': counts['ambiguous_boundary']+=1
   elif x=='outside_boundaries': counts['unmatched_outside_boundaries']+=1
  for k,did,st in zip(keys,assigned,status): w.writerow([k,did,'','','2025','worldpop_sau_pop_2025_CN_100m_R2025A_v1',st])
# join in the small district population table, then write final Parquet and remove staging CSV.
if OUT.exists(): OUT.unlink()
db.execute(f"""copy (
 select l.poi_key,l.district_id,p.population_estimate,p.population_coverage_pct,p.population_year,p.population_source,l.spatial_match_status,
        p.population_license,p.population_valid_cells,p.population_polygon_cells
 from read_csv('{outcsv}',all_varchar=true,header=true,nullstr='') l
 left join read_parquet('{P}') p on try_cast(l.district_id as bigint)=p.district_id
) to '{OUT}' (format parquet,compression zstd)""")
valid_stats=db.execute(f"select count(*) filter(where district_id is not null),count(*) filter(where population_estimate is not null),count(*) from read_parquet('{OUT}')").fetchone()
report={**counts,'output_rows':valid_stats[2],'poi_with_population_value':valid_stats[1],'poi_inside_unique_district':valid_stats[0],
 'district_polygon_count':len(ids),'invalid_source_polygons_repaired':invalid,'population_source_year':2025,'spatial_rule':'Only location_precision=point is spatially assigned; WGS84 point intersects exactly one district polygon; 0 matches are outside; >1 polygon intersections stay ambiguous; approximate coordinates remain unassigned.',
 'output_path':str(OUT),'source_boundary':str(GEO)}
json.dump(report,open(GOLD/'v2/poi_population_link_report.json','w'),ensure_ascii=False,indent=2); outcsv.unlink(); print(json.dumps(report,ensure_ascii=False,indent=2))
