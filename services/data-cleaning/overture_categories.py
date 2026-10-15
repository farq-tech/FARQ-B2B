"""Overture category -> Farq subcategory for the rows the row classifier left unclassified or low: Overture's own primary category
(taxonomy.primary) mapped by hand for the categories the activity map does not cover. Applies to the new Overture businesses
(rewrites golden/overture_taxonomy.parquet rows that are unclassified/low, source `overture_category`, confidence medium) and to existing
rows matched to an Overture place (enrich/overture_class.parquet, used only to fill unclassified/low like the Urbi categories). Read-only
on every other input."""
import duckdb, json
D = '/Users/m4pro/farq-taxonomy-data/'
MAP = {
 'auto_dealer': 'auto.dealership', 'automotive_service': 'auto.workshop', 'automotive_repair': 'auto.workshop', 'car_dealer': 'auto.dealership',
 'party_and_event_planning': 'hosp.event_planning', 'event_planning': 'hosp.event_planning', 'lodging': 'hosp.hotel', 'hotel': 'hosp.hotel',
 'travel_service': 'hosp.travel_agency', 'travel_agency': 'hosp.travel_agency',
 'corporate_or_business_office': 'biz.head_office', 'professional_service': 'biz.pro_services', 'home_cleaning': 'biz.cleaning_services',
 'real_estate_service': 're.office', 'real_estate_agent': 're.office', 'real_estate': 're.office',
 'building_or_construction_service': 'contract.general', 'construction_services': 'contract.general', 'engineering_service': 'contract.engineering_consult',
 'college_university': 'edu.university', 'education': 'edu.education_services', 'health_care': 'health.clinic',
 'freight_and_cargo_service': 'log.freight_customs', 'financial_service': 'fin.financing',
 'industrial_company': 'ind.industrial_supplies', 'commercial_industrial': 'ind.industrial_supplies', 'industrial_equipment_manufacturer': 'ind.industrial_supplies',
 'flowers_and_gifts_store': 'retail.flowers', 'shopping': 'retail.general_store', 'arts_and_entertainment': 'media.events_entertainment',
 'historic_site': 'noncom.landmark', 'social_or_community_service': 'noncom.social_services',
}
subs = {s['sub_id'] for s in json.load(open('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/farq_taxonomy.json'))['subs']}
assert all(v in subs for v in MAP.values()), [v for v in MAP.values() if v not in subs]
db = duckdb.connect()
db.execute("create table m (cat varchar, sub_id varchar)"); db.executemany("insert into m values (?,?)", list(MAP.items()))
db.execute(f"""create table t as select t.poi_key,
   case when (t.sub_id like 'unc.%' or t.confidence='low') and m.sub_id is not null then m.sub_id else t.sub_id end sub_id,
   case when (t.sub_id like 'unc.%' or t.confidence='low') and m.sub_id is not null then 'overture_category' else t.source end as source,
   case when (t.sub_id like 'unc.%' or t.confidence='low') and m.sub_id is not null then 'medium' else t.confidence end as confidence, t.evidence
   from read_parquet('{D}golden/overture_taxonomy.parquet') t left join read_parquet('{D}golden/overture_new.parquet') o using(poi_key) left join m on m.cat=o.category""")
db.execute(f"copy t to '{D}golden/overture_taxonomy.parquet' (format parquet)")
db.execute(f"""copy (select o.poi_key, m.sub_id from read_parquet('{D}enrich/overture_match.parquet') o join m on m.cat=o.ov_cat) to '{D}enrich/overture_class.parquet' (format parquet)""")
print('new rows by source:', db.execute(f"select source, count(*) from read_parquet('{D}golden/overture_taxonomy.parquet') group by 1 order by 2 desc").fetchall())
print('matched rows with a mapped category:', db.execute(f"select count(*) from read_parquet('{D}enrich/overture_class.parquet')").fetchone())
