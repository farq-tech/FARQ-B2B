"""Crosswalk exact 2GIS card IDs to exact building HouseId values for the staged Farq Golden rows."""
import json,sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,'/tmp/farq-audit-libs')
import shapefile,duckdb
ROOT=Path('/app/data/buildings_ingest'); GOLD=ROOT/'golden/v2'; BUILD=ROOT/'normalized/buildings.parquet'; OUT=GOLD/'business_building_links.parquet'
# Exact CardSyncod -> BuildSynco source relation. Retain only one-build-per-card mappings.
r=shapefile.Reader('/app/data/buildings_ingest/firms_source/Firms with trade license.shp',encoding='utf-8')
links=defaultdict(set)
for rec in r.iterRecords():
 d=rec.as_dict(); card=str(d.get('CardSyncod') or '').strip(); house=str(d.get('BuildSynco') or '').strip()
 if card and house: links[card].add(house)
r.close()
rows=[(card,next(iter(houses))) for card,houses in links.items() if len(houses)==1]
ambiguous_cards=sum(len(v)>1 for v in links.values())
# Write the exact relation to CSV, then join server-side against Golden and normalized Buildings.
import csv
src=ROOT/'golden/v2/card_build_links.csv'
with src.open('w',encoding='utf-8',newline='') as f:
 w=csv.writer(f); w.writerow(['source_coordinate_id','building_house_id']); w.writerows(rows)
db=duckdb.connect(); db.execute("SET threads=4"); db.execute("SET memory_limit='8GB'")
p=lambda x:"'"+str(x).replace("'","''")+"'"
db.execute(f"create view q as select * from read_csv({p(src)},all_varchar=true,header=true)")
db.execute(f"create view g as select poi_key,source_coordinate_id from read_parquet({p(GOLD/'farq_golden_v2.parquet')}) where source_coordinate_id is not null")
db.execute(f"""create view b as select * from read_parquet({p(BUILD)}) qualify count(*) over(partition by trim(cast(houseid as varchar)))=1""")
if OUT.exists(): OUT.unlink()
db.execute(f"""copy (
 select g.poi_key,g.source_coordinate_id,q.building_house_id as houseid,b.source_feature_id,b.building_use,b.building_use_ar,b.classification_basis,
        b.type,b.purpose,b.city,b.city_en,b.district,b.street,b.elevation,b.entrances,b.apartments,b.geometry_wkb_hex,
        'exact_card_id_to_buildsynco_to_houseid' as link_method,'high' as link_confidence
 from q join g on g.source_coordinate_id=q.source_coordinate_id join b on trim(cast(b.houseid as varchar))=q.building_house_id
) to {p(OUT)} (format parquet,compression zstd)""")
metrics=db.execute(f"""select count(*) as total_rows,count(distinct poi_key) unique_poi,count(distinct houseid) unique_houseids,
count(*) filter(where entrances is not null and trim(cast(entrances as varchar))<>'') entrances_filled,
count(*) filter(where apartments is not null and trim(cast(apartments as varchar))<>'') apartments_filled from read_parquet({p(OUT)})""").fetchone()
report={'qgis_card_ids_with_building_link':len(links),'qgis_card_ids_with_multiple_buildsynco':ambiguous_cards,'unambiguous_card_build_links':len(rows),
 'exact_golden_to_building':{'rows':metrics[0],'unique_poi_keys':metrics[1],'unique_building_houseids':metrics[2],'rows_with_entrances':metrics[3],'rows_with_apartments':metrics[4]},
 'building_layer_rows':db.execute(f'select count(*) from read_parquet({p(BUILD)})').fetchone()[0],
 'building_layer_unique_houseids':db.execute(f"select count(distinct trim(cast(houseid as varchar))) from read_parquet({p(BUILD)})").fetchone()[0],
 'duplicate_houseid_rows_excluded':db.execute(f"select count(*) from read_parquet({p(BUILD)}) where trim(cast(houseid as varchar)) in (select trim(cast(houseid as varchar)) from read_parquet({p(BUILD)}) group by 1 having count(*)>1)").fetchone()[0],
 'output_path':str(OUT),'policy':'ambiguous CardSyncod-to-BuildSynco mappings and duplicate HouseId features are excluded; all links are exact IDs.'}
json.dump(report,open(ROOT/'reports/business_building_link_report.json','w'),ensure_ascii=False,indent=2); print(json.dumps(report,ensure_ascii=False,indent=2))
