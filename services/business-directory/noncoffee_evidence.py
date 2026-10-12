"""Small purposefully selected evidence set; never population accuracy estimates."""
import json,argparse,duckdb
from pathlib import Path
from evidence_state import state
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();c=duckdb.connect();c.read_parquet(a.source).create_view('r')
def record(key):
 cur=c.execute('select poi_key,name_ar,name_en,website,category,city_en,district_ar from r where poi_key=?',[key]);return dict(zip([x[0] for x in cur.description],cur.fetchone()))
common={'observed_at':'2026-10-12','confidence':None,'independent_review':'PENDING','branch_availability':'UNKNOWN','identity_status':'NAME_AND_DOMAIN_CONCORDANT_NOT_LEGAL_ID_VERIFIED','decision':'VERIFIED'}
items=[
 {**common,'id':'hasoob-computers','record':record('nationwide:golden_24.680655_46.68987'),'role':'SELLER','product':'أجهزة لابتوب وطباعة','evidence_date':None,'source_url':'https://www.alhasoob.com/ar/about-us','source_type':'FIRST_PARTY_OFFER','reason':'الموقع الرسمي يصف البيع المباشر لأجهزة اللابتوب والطباعة؛ الاسم والنطاق متوافقان'},
 {**common,'id':'hotpack-paper-cups','record':record('hh:1276312'),'role':'SELLER','product':'أكواب ورقية وتغليف','evidence_date':None,'source_url':'https://hotpack.com.sa/collections/paper-cups-essentials','identity_chain_url':'https://www.hotpackglobal.com/','source_type':'FIRST_PARTY_PRODUCT_CATALOG','reason':'المتجر يعرض أكوابًا ورقية ويربط بموقع الشركة الذي يطابق نطاق سجل Hotpack؛ لا ضمان مخزون فرع الرياض'},
 {**common,'id':'taqeem-professional-development','record':record('hh:1343314'),'role':'BUYER','product':'خطة تطوير وتنمية الكفاءات المهنية','evidence_date':'2026-10-11','source_status':'active','deadline':'2026-11-03T12:00:00+03:00','competition_id':'PRCOMP20261000042','source_url':'https://taqeem.gov.sa/tenders/mshrw-ttwyr-kht-tnmy-wttwyr-lkft-lmhny-167','source_type':'FIRST_PARTY_OPEN_TENDER','reason':'منافسة نشطة بموعد مستقبل؛ عنوان تسليم الضمان الرياض حي العارض','policy':'PUBLIC_PROCUREMENT_ELIGIBILITY_NOT_VERIFIED','opportunity_location':'الرياض/العارض','source_record_location':'الصحافة؛ قد يكون مقرًا سابقًا، لا تنقل الحي تلقائيًا'},
 {**common,'id':'taqeem-facility-operations','record':record('hh:1343314'),'role':'BUYER','product':'تشغيل وصيانة مبنى','evidence_date':'2026-09-22','source_status':'active','deadline':'2026-10-27T12:00:00+03:00','competition_id':'PRCOMP20260800034','source_url':'https://taqeem.gov.sa/tenders/mshrw-tshgyl-wsyn-mbn-lhyy-ls-wdy-llmqymyn-166','source_type':'FIRST_PARTY_OPEN_TENDER','reason':'منافسة نشطة بموعد مستقبل؛ آخر تعديل 8 أكتوبر 2026','policy':'PUBLIC_PROCUREMENT_ELIGIBILITY_NOT_VERIFIED','opportunity_location':'الرياض/العارض'},
 {**common,'id':'rejected-hasoob-point','record':record('hh:1270971'),'role':'UNKNOWN','product':'أجهزة كمبيوتر','identity_status':'CONFLICTED','decision':'CONFLICTED','source_url':'https://www.alhasoob.com/','evidence_date':None,'reason':'اسم المصدر EPSG:4326 / Point وليس اسم المنشأة؛ النطاق وحده غير كافٍ'},
 {**common,'id':'rejected-pipe-domain','record':record('hh:250490767877412704'),'role':'UNKNOWN','product':'أنابيب سباكة','identity_status':'CONFLICTED','decision':'CONFLICTED','source_url':'https://almonaplast.com','evidence_date':None,'reason':'اسم مقاول يختلف عن المصنع صاحب النطاق؛ الصفحة لم تقرأ مباشرة؛ لا دليل بيع مقبول'}]
for e in items:e['temporal_state']=state(e,'2026-10-12T12:00:00+03:00')
# Extend product-specific potential roles from reviewed directory activity only.
rows=json.load(open(a.out.parent/'expanded/sample-normalized.json'));potentials=[]
for r in rows:
 cat=(r.get('category') or '').split('|')[0].lower()
 product=None
 if cat in ['education','school','schools']:product='أجهزة كمبيوتر للتعليم'
 if cat in ['hospitals','hospital','medical clinic']:product='لوازم طبية؛ الصنف والتخصص الدقيق غير مثبتين'
 if 'contract' in cat:product='مواد مشاريع؛ احتياج السباكة تحديدًا غير مثبت'
 if product:potentials.append({'source_record_id':r['poi_key'],'name':r.get('name_ar') or r.get('name_en'),'product':product,'role':'POTENTIAL_BUYER','decision':'POTENTIAL','temporal_state':'POTENTIAL','reason':'استنتاج من نشاط الدليل فقط؛ لا طلب شراء حالي','source_value':r.get('category'),'source_type':'DIRECTORY_ACTIVITY','confidence':None})
a.out.mkdir(parents=True,exist_ok=True);(a.out/'product-evidence.json').write_text(json.dumps({'as_of':'2026-10-12 Asia/Riyadh','sampling':'purposeful evidence cases, separate from stratified sample','annotations':items,'potential_cases':potentials,'verified_seller_records':2,'current_buyer_entities':1,'current_requests':2,'identity_conflicts':2},ensure_ascii=False,indent=2));print('2 seller source records; 1 buyer entity / 2 current requests;',len(potentials),'potential cases; 2 identity conflicts')
