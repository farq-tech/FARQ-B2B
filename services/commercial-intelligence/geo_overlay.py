"""Observed point -> source-asserted geography candidates. No fabricated boundaries."""
import argparse,json,sqlite3,math,csv
from collections import defaultdict,Counter
from pathlib import Path
from shapely.geometry import shape,Point
from shapely.strtree import STRtree
from shapely.prepared import prep
from identity import normalize,observation_id
def run(registry,dbpath,geo):
    features=json.loads(Path(geo).read_text())['features']
    polys=[f for f in features if f['properties']['type']=='neighborhood' and f['geometry']['type'] in ['Polygon','MultiPolygon']]
    shapes=[shape(f['geometry']) for f in polys];tree=STRtree(shapes);prepared=[prep(g) if g.is_valid else None for g in shapes]
    regions=[(f['properties'],prep(shape(f['geometry']))) for f in features if f['properties']['type']=='region']
    cities={f['properties']['id']:f['properties'] for f in features if f['properties']['type']=='locality'};alias=defaultdict(set)
    for id,p in cities.items():
        for v in [p.get('name_ar'),p.get('name_en')]+p.get('aliases',[]):
            if v:alias[normalize(v)].add(id)
    src=sqlite3.connect(Path(registry).as_uri()+'?mode=ro',uri=True);src.row_factory=sqlite3.Row;src.execute('PRAGMA query_only=ON')
    db=sqlite3.connect(dbpath);db.execute('CREATE TABLE IF NOT EXISTS geo_candidates(observation_id TEXT PRIMARY KEY,city_id TEXT,region_id TEXT,district_id TEXT,status TEXT NOT NULL,basis TEXT NOT NULL,official_parent_verified INTEGER NOT NULL DEFAULT 0)');db.execute('DELETE FROM geo_candidates')
    counts=Counter();regioncounts=Counter()
    for r in src.execute('SELECT source_id,record_uid,city,district,lat,lon FROM source_records'):
        oid=observation_id(r['source_id'],r['record_uid']);city_ids=alias.get(normalize(r['city']),set());city_id=next(iter(city_ids)) if len(city_ids)==1 else None
        region_id=None;district_id=None;status='SOURCE_TEXT_ONLY';basis=[]
        if city_id:basis.append('UNIQUE_BILINGUAL_SOURCE_CITY_ALIAS')
        if r['lat'] is not None and r['lon'] is not None:
            try:
                lat,lon=float(r['lat']),float(r['lon'])
                if not math.isfinite(lat) or not math.isfinite(lon) or not -90<=lat<=90 or not -180<=lon<=180:status='INVALID_COORDINATE_RANGE'
                else:
                    point=Point(lon,lat);matches=[p for p,g in regions if g.covers(point)]
                    if len(matches)==1:region_id=matches[0]['id'];status='SPATIAL_REGION_CANDIDATE';basis.append('POINT_IN_RECOVERED_REGION')
                    else:status='UNRESOLVED_REGION'
                    hit=[polys[int(i)]['properties'] for i in tree.query(point) if prepared[int(i)] and prepared[int(i)].covers(point)]
                    if len(hit)==1:
                        parent=hit[0].get('source_asserted_parent_id')
                        if city_id and parent and city_id!=parent:status='CITY_POINT_CONFLICT'
                        else:district_id=hit[0]['id'];city_id=city_id or parent;basis.append('UNIQUE_DISTRICT_POLYGON_SOURCE_PARENT')
                    elif len(hit)>1:status='OVERLAPPING_DISTRICT_CANDIDATES'
            except (ValueError,TypeError):status='NONNUMERIC_COORDINATE'
        # Name alone never resolves a district; no delivery radius is inferred.
        db.execute('INSERT INTO geo_candidates VALUES(?,?,?,?,?,?,0)',(oid,city_id,region_id,district_id,status,';'.join(basis)))
        counts[status]+=1;regioncounts[region_id or 'UNRESOLVED']+=1
        if sum(counts.values())%50000==0:print({'geographic_records_processed':sum(counts.values())},flush=True)
    db.commit();db.close();src.close()
    out=Path(dbpath).parent
    with (out/'geographic-coverage.csv').open('w') as f:
        w=csv.DictWriter(f,fieldnames=['region_candidate','source_observation_records','denominator','share','official_parent_verified','delivery_coverage']);w.writeheader()
        for reg,count in sorted(regioncounts.items()):w.writerow({'region_candidate':reg,'source_observation_records':count,'denominator':sum(counts.values()),'share':count/sum(counts.values()),'official_parent_verified':False,'delivery_coverage':'UNKNOWN'})
    (out/'geo-recovery-receipt.json').write_text(json.dumps({'source_records':sum(counts.values()),'statuses':dict(counts),'source_layer':geo,'district_polygons':len(polys),'region_shapes':len(regions),'official_claims':0,'fabricated_shapes':0},indent=2));print(dict(counts),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--registry',required=True);p.add_argument('--db',required=True);p.add_argument('--geo',required=True);a=p.parse_args();run(a.registry,a.db,a.geo)
