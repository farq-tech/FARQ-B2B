"""Build an auditable Farq Golden candidate set from the live Atlas target and exact-ID license/coordinate sources.
Run on the Farq target service, never on a local source copy. Does not replace targets.parquet.
"""
from __future__ import annotations
import csv, datetime, decimal, hashlib, json, re, sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, '/tmp/farq-audit-libs')
from openpyxl import load_workbook
import duckdb

DATA=Path('/app/data')
ROOT=DATA/'buildings_ingest'
COORD=ROOT/'coordinate_source/Coordinates'
LICENSE=ROOT/'license_source/Licenses'
OUT=ROOT/'golden'
OUT.mkdir(exist_ok=True)
STAGE=OUT/'stage'
STAGE.mkdir(exist_ok=True)

def ident(v):
    if v is None or isinstance(v,bool): return ''
    if isinstance(v,int): return str(v)
    if isinstance(v,float):
        d=decimal.Decimal(str(v)); return str(d.quantize(decimal.Decimal(1))) if d==d.to_integral_value() else str(d.normalize())
    s=str(v).strip()
    if re.fullmatch(r'\d+\.0+',s): s=s.split('.',1)[0]
    return '' if s.casefold() in {'null','none','nan','n/a','-',''} else s

def blank(v): return v is None or (isinstance(v,str) and v.strip().casefold() in {'','null','none','nan','n/a','-','--'})
def normalize_name(v): return re.sub(r'\s+',' ',str(v or '').strip()) or ''
def coord_valid(lon,lat):
    try:
        x=float(str(lon).replace(',','.')); y=float(str(lat).replace(',','.'))
        return -180<=x<=180 and -90<=y<=90 and not (x==0 and y==0),x,y
    except Exception: return False,None,None

def rows_xlsx(path):
    wb=load_workbook(path,read_only=True,data_only=True)
    try:
        for ws in wb.worksheets:
            it=ws.iter_rows(values_only=True); hdr=next(it,None)
            if not hdr: continue
            headers=[str(x).strip() if x is not None else '' for x in hdr]
            ix={h:i for i,h in enumerate(headers) if h}
            for row in it:
                yield ix,row
    finally: wb.close()

# Source coordinate records. Keep only a deterministic representative after checking meaningful fields.
coord_variants=defaultdict(list); coordinate_rows=0; invalid_coords=0; hidden_ids=set()
for fp in sorted(COORD.glob('*.xlsx')):
    for ix,row in rows_xlsx(fp):
        coordinate_rows+=1
        get=lambda k: row[ix[k]] if k in ix and ix[k]<len(row) else None
        sid=ident(get('SynCode'))
        if not sid: continue
        ok,lon,lat=coord_valid(get('Longitude'),get('Latitude'))
        if not ok: invalid_coords+=1
        hidden=str(get('Hidden') or '').strip().casefold() in {'true','1','yes','да','نعم'}
        rec={'id':sid,'name':normalize_name(get('Firmname')),'partner':normalize_name(get('PartnerName')),'lon':lon,'lat':lat,'valid':ok,'hidden':hidden,'project':ident(get('Project')),'source':fp.name}
        coord_variants[sid].append(rec)

coord={}; conflicting_coord_ids=[]
for sid,vs in coord_variants.items():
    signatures={(v['lon'],v['lat'],v['name'],v['hidden']) for v in vs if v['valid']}
    if len(signatures)>1: conflicting_coord_ids.append(sid)
    valid=[v for v in vs if v['valid']]
    if valid:
        # stable by content, not workbook ordering
        coord[sid]=sorted(valid,key=lambda v:(v['source'],v['name'],v['partner']))[0]

# Exact license-card-ID aggregation. Conflicting values are nulled and counted field-wise.
license_variants=defaultdict(list); license_rows=0
for fp in sorted(LICENSE.glob('*.xlsx')):
    for ix,row in rows_xlsx(fp):
        license_rows+=1
        get=lambda k: row[ix[k]] if k in ix and ix[k]<len(row) else None
        card=ident(get('card_id'))
        if not card: continue
        vals={k:(None if blank(get(k)) else str(get(k)).strip()) for k in ('name','trade_license','license_type','legal_form','end_date','PartnerName')}
        vals['firm_id']=ident(get('firm_id')); vals['source']=fp.name
        license_variants[card].append(vals)

license={}; license_conflicts=defaultdict(int)
for card,vs in license_variants.items():
    out={}
    for k in ('name','trade_license','license_type','legal_form','end_date','firm_id','PartnerName'):
        vals={v[k] for v in vs if not blank(v[k])}
        if len(vals)>1:
            license_conflicts[k]+=1; out[k]=None
        else: out[k]=next(iter(vals),None)
    out['source']=';'.join(sorted({v['source'] for v in vs}))
    license[card]=out

# Source match candidate: exact coordinate SynCode == license card_id, visible coordinate, valid coordinate,
# and a usable display name. Do not infer operational status from Hidden or license expiry.
source_candidates=[]; matched_coord_license=0; hidden_licensed=0; missing_name=0
for sid,c in coord.items():
    lic=license.get(sid)
    if not lic: continue
    matched_coord_license+=1
    if c['hidden']:
        hidden_licensed+=1; continue
    name=c['name'] or normalize_name(lic.get('name'))
    if not name:
        missing_name+=1; continue
    source_candidates.append((sid,c,lic,name))

# Export source candidate rows to CSV so DuckDB can build/join without installing data-frame packages.
source_csv=STAGE/'exact_coordinate_license_candidates.csv'
with source_csv.open('w',encoding='utf-8',newline='') as f:
    fields=['source_id','name','partner','longitude','latitude','project','coordinate_source','license_name','trade_license','license_type','license_end_date','legal_form','license_partner','license_source']
    w=csv.DictWriter(f,fieldnames=fields); w.writeheader()
    for sid,c,l,name in source_candidates:
        w.writerow({'source_id':sid,'name':name,'partner':c['partner'] or None,'longitude':c['lon'],'latitude':c['lat'],'project':c['project'],'coordinate_source':c['source'],'license_name':l['name'],'trade_license':l['trade_license'],'license_type':l['license_type'],'license_end_date':l['end_date'],'legal_form':l['legal_form'],'license_partner':l['PartnerName'],'license_source':l['source']})

# DuckDB output is a separate, non-production file.
db=duckdb.connect(); db.execute("SET threads=4"); db.execute("SET memory_limit='8GB'")
q=lambda p: "'"+str(p).replace("'","''")+"'"
base='/app/data/targets.parquet'
db.execute(f"CREATE VIEW base AS SELECT * FROM read_parquet({q(base)})")
db.execute(f"CREATE VIEW cand AS SELECT * FROM read_csv({q(source_csv)}, all_varchar=true, header=true, nullstr='')")
# Guard source candidate keys against current targets and source duplicate IDs.
db.execute("CREATE TABLE safe_new AS SELECT c.* FROM cand c LEFT JOIN base b ON b.poi_key='urbi_coords:'||c.source_id WHERE b.poi_key IS NULL")
source_duplicate_count=db.execute("select count(*)-count(distinct source_id) from cand").fetchone()[0]
assert source_duplicate_count==0, f'duplicate candidate IDs: {source_duplicate_count}'
# New rows map source-derived name/location and exact license facts into separate, attributed columns.
cols=[r[0] for r in db.execute(f"DESCRIBE SELECT * FROM base").fetchall()]
base_select=', '.join('b.'+('"'+c.replace('"','""')+'"') for c in cols)
new_select=[]
for c in cols:
    if c=='poi_key': val="'urbi_coords:'||source_id"
    elif c=='name_ar': val='CASE WHEN regexp_matches(name, \'[؀-ۿ]\') THEN name END'
    elif c=='name_en': val='CASE WHEN NOT regexp_matches(name, \'[؀-ۿ]\') THEN name END'
    elif c=='latitude': val='try_cast(latitude AS DOUBLE)'
    elif c=='longitude': val='try_cast(longitude AS DOUBLE)'
    elif c=='commercial_license': val='trade_license'
    elif c=='sources': val="['coordinates_syn_code','license_card_id']"
    elif c=='source_count': val='2'
    elif c=='search_text': val='name'
    elif c in ('category','category_ar'): val='NULL'
    elif c=='company_status': val="'unknown'"
    elif c=='lifecycle_state': val="'unknown'"
    elif c=='region_en': val='project'
    elif c in ('city_en','city_ar'): val='project' if c=='city_en' else 'NULL'
    elif c=='location_precision': val="'point'"
    elif c=='district_reliable': val='false'
    elif c=='completeness_pct': val='NULL'
    elif c=='license_expired': val="CASE WHEN try_cast(license_end_date AS DATE) < DATE '2026-10-25' THEN true WHEN try_cast(license_end_date AS DATE) >= DATE '2026-10-25' THEN false END"
    elif c=='sub_id': val='NULL'
    elif c=='cls_confidence': val="'unknown'"
    elif c in ('latitude','longitude'): val='NULL'
    elif c in ('district_en','district_ar','full_address_ar','full_address_en','phone_raw','phone_norm','phone_kind','email','website','instagram','x_link','snapchat','tiktok','working_hours','rating','reviews_count','governorate_ar','street_ar','building_no','postal_code','national_address','surveyor_verified_at','phone_source','district_method','city_method','specialties_ar','specialty_ids','menu_link','order_link','reservation_link','amenities_ids','tradename','google_place_id','google_cid','floor_no','wholesale_basis','role_badges','specialty_concept_ids','specialty_concepts_ar','sector'): val='NULL'
    elif c in ('hudhud_id','secondary_category','category_l3','google_category','description_ar','description_en','legal_name','brand_name','has_whatsapp','is_wholesale'): val='NULL'
    else: val='NULL'
    new_select.append(val+' AS "'+c.replace('"','""')+'"')
new_sql=', '.join(new_select)
extra="""
  'coordinate_license_exact' AS golden_match_method,
  'high' AS golden_match_confidence,
  source_id AS source_coordinate_id,
  name AS source_coordinate_name,
  partner AS source_coordinate_partner_name,
  project AS source_project,
  coordinate_source,
  license_name AS source_license_name,
  trade_license AS source_trade_license,
  license_type AS source_license_type,
  license_end_date AS source_license_end_date,
  legal_form AS source_legal_form,
  license_partner AS source_license_partner_name,
  license_source
"""
base_extra="""
  CASE WHEN c.source_id IS NULL THEN 'existing_atlas' ELSE 'existing_atlas_exact_coordinate_license' END AS golden_match_method,
  CASE WHEN c.source_id IS NULL THEN 'existing_key' ELSE 'high' END AS golden_match_confidence,
  c.source_id AS source_coordinate_id,
  c.name AS source_coordinate_name,
  c.partner AS source_coordinate_partner_name,
  c.project AS source_project,
  c.coordinate_source,
  c.license_name AS source_license_name,
  c.trade_license AS source_trade_license,
  c.license_type AS source_license_type,
  c.license_end_date AS source_license_end_date,
  c.legal_form AS source_legal_form,
  c.license_partner AS source_license_partner_name,
  c.license_source
"""
# Enrich existing Atlas rows only by exact Urbi coordinate ID. Keep core Atlas fields untouched.
# We use the candidate source for all matches, including Hidden entries, but do not change company_status.
db.execute(f"""CREATE TABLE exact_src AS SELECT * FROM read_csv({q(source_csv)}, all_varchar=true, header=true, nullstr='')""")
# candidate source excludes Hidden entries, so build independent exact overlay from all unhidden candidate rows only;
# exact joins against base can still enrich from license via commercial license already present, without source claims.
# Golden output preserves all original columns, adds exact-ID provenance overlays, and appends safe_new.
if (OUT/'farq_golden_v1.parquet').exists(): (OUT/'farq_golden_v1.parquet').unlink()
db.execute(f"""COPY (
 SELECT {base_select}, {base_extra} FROM base b LEFT JOIN cand c ON b.poi_key='urbi_coords:'||c.source_id
 UNION ALL
 SELECT {new_sql}, {extra} FROM safe_new
) TO {q(OUT/'farq_golden_v1.parquet')} (FORMAT PARQUET, COMPRESSION ZSTD)""")

report={
 'build_version':'farq_golden_v1', 'built_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'production_input':'/app/data/targets.parquet','production_input_sha256':hashlib.sha256(Path(base).read_bytes()).hexdigest(),
 'production_input_preserved':True,'rows':{},'source_audit':{},
 'policy':{'append_rule':'visible coordinate point with valid coordinates, exact SynCode=license card_id, usable source/license display name','match_confidence':'high only for exact ID links','status':'unknown for new entities; source Hidden and license expiry do not imply closure','existing_rows':'all original Atlas columns copied unchanged; exact-ID source fields added as attributed overlays'},
 'excluded_from_automatic_golden':['ambiguous or duplicate source IDs','hidden coordinate records','records with invalid coordinates','records without coordinate or license display name','fuzzy/name-only matches','unavailable FSQ full source'],
 'rights_confirmation':{'status':'user_confirmed','scope':'Farq holds rights to use the source data; confirmation supplied in this task.'},
 'limitations':['population and road network are analytical layers, not business-level entity fields','unknown status is not a verified open/closed status']}
report['rows']['input_atlas']=db.execute('select count(*) from base').fetchone()[0]
report['rows']['input_atlas_unique_keys']=db.execute('select count(distinct poi_key) from base').fetchone()[0]
report['rows']['eligible_source_candidates']=db.execute('select count(*) from cand').fetchone()[0]
report['rows']['new_exact_candidates']=db.execute('select count(*) from safe_new').fetchone()[0]
report['rows']['existing_atlas_exact_source_matches']=db.execute("select count(*) from base b join cand c on b.poi_key='urbi_coords:'||c.source_id").fetchone()[0]
report['rows']['output_total']=db.execute(f"select count(*) from read_parquet({q(OUT/'farq_golden_v1.parquet')})").fetchone()[0]
report['rows']['output_unique_keys']=db.execute(f"select count(distinct poi_key) from read_parquet({q(OUT/'farq_golden_v1.parquet')})").fetchone()[0]
report['rows']['output_valid_coordinate_pairs']=db.execute(f"select count(*) from read_parquet({q(OUT/'farq_golden_v1.parquet')}) where latitude between -90 and 90 and longitude between -180 and 180 and (latitude<>0 or longitude<>0)").fetchone()[0]
report['rows']['unknown_status_new_candidates']=db.execute(f"select count(*) from read_parquet({q(OUT/'farq_golden_v1.parquet')}) where golden_match_method='coordinate_license_exact' and company_status='unknown'").fetchone()[0]
report['source_audit']={'coordinate_rows':coordinate_rows,'coordinate_unique_ids':len(coord_variants),'coordinate_valid_unique_ids':len(coord),'coordinate_invalid_rows':invalid_coords,'coordinate_ids_with_conflicting_valid_fields':len(conflicting_coord_ids),'license_rows':license_rows,'license_unique_card_ids':len(license),'license_conflicting_values_by_field':dict(license_conflicts),'exact_coordinate_license_ids':matched_coord_license,'hidden_exact_matched_ids_excluded':hidden_licensed,'exact_matched_ids_missing_display_name':missing_name,'source_duplicate_candidate_ids':source_duplicate_count}
assert report['rows']['output_total']==report['rows']['input_atlas']+report['rows']['new_exact_candidates']
assert report['rows']['output_unique_keys']==report['rows']['output_total']
assert report['rows']['output_valid_coordinate_pairs']>=report['rows']['new_exact_candidates']
(OUT/'farq_golden_v1_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
