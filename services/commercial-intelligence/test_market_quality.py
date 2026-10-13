# coding: utf-8
import unittest
from activity_quality import assessment,eligibility,offer_conflict,usage_priority
from golden_directory import pure_functions

class MarketQuality(unittest.TestCase):
 def test_conflicting_category_preserved_but_not_eligible(self):
  a=assessment('مطعم المثال','Software company')
  self.assertEqual(a['original_source_categories'][0]['value'],'Software company');self.assertTrue(a['conflicts']);self.assertFalse(a['name_alone_is_proof'])
  self.assertFalse(eligibility('برامج محاسبة','software','purchase','مطعم المثال','Software company')['eligible'])
  self.assertTrue(eligibility('برامج محاسبة','software','purchase','مطعم المثال','Software company','نطور software solutions',True)['eligible'])
 def test_noncommercial_and_marketplace_roles(self):
  self.assertFalse(eligibility('مستلزمات طبية','medical','purchase','هيئة الغذاء والدواء','Medical supplier')['eligible'])
  self.assertFalse(eligibility('كمبيوتر','computers','purchase','مجلة التقنية','Computer supplier')['eligible'])
  self.assertEqual(eligibility('مواد سباكة','plumbing','purchase','سوق الكتروني','Marketplace')['commercial_function'],'marketplace_intermediary')
  self.assertNotEqual(eligibility('زي موحد','textiles','purchase','متجر ملابس','Clothing store')['commercial_function'],'manufacturer')
 def test_mandatory_product_service_conflicts(self):
  self.assertEqual(offer_conflict('حبوب قهوة','coffee','حبوب إفطار تريكس','حبوب إفطار تريكس'),'COFFEE_NOT_CEREAL_OR_TOOL_BITS')
  self.assertEqual(offer_conflict('حبوب قهوة','coffee','طقم مفكات حبوب','طقم مفكات حبوب'),'COFFEE_NOT_CEREAL_OR_TOOL_BITS')
  self.assertFalse(eligibility('أجهزة كمبيوتر','computers','purchase','صيانة كمبيوتر','Computer repair')['eligible'])
  self.assertFalse(eligibility('خدمات محاسبة','accounting','purchase','برنامج محاسبة','Software company')['eligible'])
  self.assertFalse(eligibility('مستلزمات أسنان','dental','purchase','صيدلية','Pharmacy')['eligible'])
  self.assertFalse(eligibility('مصنع زي موحد','textiles','purchase','متجر ملابس','Clothing store')['eligible'])
  self.assertFalse(eligibility('خدمات شحن','logistics','purchase','ورشة سيارات','Car repair')['eligible'])
 def test_contextual_buyer_use_not_same_office_list(self):
  self.assertGreater(usage_priority('plumbing','Plumbing contractor')[0],usage_priority('plumbing','Corporate office')[0])
  self.assertGreater(usage_priority('computers','School')[0],usage_priority('computers','Government office')[0])
  self.assertGreater(usage_priority('accounting','Restaurant')[0],usage_priority('accounting','Corporate office')[0])
  f=pure_functions()
  for query,key in [('مستلزمات طب الأسنان','dental'),('أكواب ورقية','packaging'),('برامج محاسبة','software'),('خدمات محاسبة','accounting')]:self.assertEqual(f['interpret'](query)['key'],key)
  self.assertFalse(eligibility('قهوة','coffee','marketing','الصافنات لنقل الجامع والمدرسي','Coffee shop')['eligible'])
 def test_known_good_candidates_are_not_strictly_blocked(self):
  for key,name,activity in [('computers','متجر تقنية','Computer store'),('accounting','مكتب محاسبة','Accounting firm'),('logistics','شركة شحن','Shipping company'),('dental','متجر أسنان','Dental supply'),('textiles','مصنع زي موحد','Uniform manufacturer')]:
   self.assertTrue(eligibility('طلب منتج',key,'purchase',name,activity)['eligible'])
  self.assertIsNone(offer_conflict('حبوب قهوة','coffee','حبوب البن البرازيلي 1 كجم','منتج حبوب البن'))
if __name__=='__main__':unittest.main()

class EnrichmentLimits(unittest.TestCase):
 def test_planner_deduplicates_and_no_budget_is_implicit(self):
  import importlib.util
  from pathlib import Path
  p=Path(__file__).parents[1]/'goal-foundation/targeting/serper/plan.py'
  spec=importlib.util.spec_from_file_location('offline_serper_plan',p);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  r=module.plan([{'entity_id':'one','score':20},{'entity_id':'one','score':10},{'entity_id':'two','score':25}])
  self.assertEqual(r['businesses'],2);self.assertEqual(r['maximum_search_credits'],2);self.assertEqual(r['approved_credit_cap'],0);self.assertFalse(r['approved']);self.assertEqual(r['targets'][0]['entity_id'],'two')
 def test_concurrent_identity_claim_allows_only_one(self):
  import sys,tempfile,concurrent.futures
  from pathlib import Path
  folder=Path(__file__).parents[1]/'goal-foundation/targeting/serper';sys.path.insert(0,str(folder))
  from run_batch import claim_identity
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'attempts.db'
   # Initialize outside workers; claims are still serialized transactionally.
   import sqlite3
   db=sqlite3.connect(p);db.execute('CREATE TABLE identity_attempts(identity TEXT PRIMARY KEY,status TEXT NOT NULL)');db.close()
   def call(_):
    try:claim_identity(p,'ENTITY-one');return True
    except ValueError:return False
   with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(call,range(8)))
   self.assertEqual(sum(results),1)

class CoreRetrievalRegression(unittest.TestCase):
 def test_real_source_shapes_reject_conflicts_and_preserve_good_provider(self):
  import os,sqlite3,tempfile
  from unittest.mock import patch
  from types import SimpleNamespace
  from pathlib import Path
  from golden_directory import candidates
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'directory.db';db=sqlite3.connect(p)
   db.executescript('CREATE TABLE profiles(poi_key,name,city,district,activity,website,observed_at,channels_json,lifecycle,company,landmark);CREATE VIRTUAL TABLE profile_search USING fts5(poi_key UNINDEXED,text);')
   data=[('restaurant','مطعم المثال','Software company'),('good','شركة تطوير برمجيات','Software company'),('stationery','قرطاسية ومكتبة نوف','Software company Shopping متجر مستلزمات مكتبية')]
   for key,name,activity in data:
    db.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?,?,?,?)',(key,name,'Riyadh','',activity,'','2024-01-01','[]','','','false'));db.execute('INSERT INTO profile_search VALUES(?,?)',(key,name+' '+activity))
   db.commit();db.close()
   with patch.dict(os.environ,{'FARQ_GOLDEN_INDEX':str(p),'FARQ_ACTIVITY_QUALITY':''}):
    k=SimpleNamespace(city_aliases={},city_matches=lambda a,b:a==b)
    for direction in ['purchase','availability','partnership']:
     rows=candidates(k,'برامج محاسبة',direction,'Riyadh',20)
     self.assertEqual([r['name'] for r in rows],['شركة تطوير برمجيات'])
     self.assertTrue(k.last_directory_exclusions)
 def test_repair_intent_and_guarding_are_services(self):
  from pragmatic import offer_support
  f=pure_functions();intent=f['interpret']('صيانة أجهزة كمبيوتر')
  self.assertEqual(intent['key'],'computer_repair')
  self.assertFalse(offer_support('insurance','شركة مصاعد','تأمين مصاعد وقطع غيار'))
  self.assertFalse(offer_support('security_services','شبك ممدد','مواد للحماية والحراسة'))
  self.assertFalse(offer_support('tourism','أثاث منزلي','حقائب سفر وأثاث'))
  self.assertTrue(offer_support('tourism','شركة للسفر والسياحة','للسفر والسياحة حجز الرحلات'))
 def test_unapproved_serper_never_reads_secrets_or_network(self):
  import sys,tempfile,json
  from pathlib import Path
  from unittest.mock import patch
  folder=Path(__file__).parents[1]/'goal-foundation/targeting/serper';sys.path.insert(0,str(folder))
  from run_batch import run
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'approved-batch-plan.json').write_text(json.dumps({'targets':[{'entity_id':'ENTITY-one'}],'approved':False,'approved_credit_cap':0}))
   with patch('run_batch.urllib.request.urlopen') as network:
    with self.assertRaises(ValueError):run(p,1)
    network.assert_not_called()

class NewObservedRegressions(unittest.TestCase):
 def test_role_and_product_errors_from_expanded_actual_results(self):
  self.assertFalse(eligibility('أبحث عن شريك برمجيات وأنظمة أعمال','software','partnership','البنك السعودي للإستثمار','Software company')['eligible'])
  self.assertFalse(eligibility('صيانة أجهزة كمبيوتر','computer_repair','purchase','مطعم جودة التنور المأكولات البحرية','Computer repair')['eligible'])
  self.assertFalse(eligibility('استشارات قانونية','legal','purchase','مطبعة السلامة','Law firm Printing service')['eligible'])
  self.assertFalse(eligibility('مصنع زي موحد','textiles','purchase','مركز دبي للأقمشة','Fabric store Manufacturer')['eligible'])
  self.assertEqual(offer_conflict('مستلزمات طب الأسنان','dental','فرش أسنان الأطفال','فرش أسنان الأطفال'),'CONSUMER_ORAL_CARE_NOT_PROFESSIONAL_DENTAL_SUPPLY')
  self.assertEqual(offer_conflict('مصنع زي موحد','textiles','uniformsa | مصادر ومحلات الزي الموحد بالسعودية','دليل مصانع زي موحد'),'DIRECTORY_NOT_COMMERCIAL_SELLER')
 def test_corrupt_secondary_label_does_not_discard_valid_customer_use(self):
  r=eligibility('خدمات محاسبة','accounting','marketing','شركة اون تايم للخدمات اللوجستية','Corporate office Restaurant')
  self.assertTrue(r['eligible']);self.assertTrue(r['activity_assessment']['conflicts'])

class CommercialDiversificationRegression(unittest.TestCase):
 def test_brand_once_for_buyers_but_local_sellers_keep_locations_and_contacts(self):
  from diversification import diversify
  rows=[{'id':str(i),'entity_id':str(i),'name':name,'city':'الرياض','district':district,'source_ref':str(i),'contact_channels':channels,'activity_assessment':{'primary_activity':'food_service'}} for i,(name,district,channels) in enumerate([('دانكن, مقهى','الملقا',['phone']),('دانكن دونتس','النخيل',[]),('دانكن','الملقا',['email']),('مقهى مختلف','الملقا',[])])]
  grouped=diversify(rows,'marketing');self.assertEqual(len(grouped),2)
  g=grouped[0]['commercial_group'];self.assertIsNone(g['known_branch_count']);self.assertEqual(g['source_locality_count'],2);self.assertEqual(len(g['branches']),3);self.assertFalse(g['legal_merge']);self.assertEqual(g['branches'][1]['contact_channels'],[])
  self.assertEqual(len(diversify(rows,'purchase')),4);self.assertNotIn('commercial_group',rows[0])
 def test_distinct_hosts_and_generic_names_never_coalesce(self):
  from diversification import diversify
  base={'city':'الرياض','district':'الملقا','activity_assessment':{'primary_activity':'food_service'}}
  rows=[dict(base,id='a',name='مقهى',source_website=''),dict(base,id='b',name='مقهى',source_website=''),dict(base,id='c',name='مطعم المثال',source_website='one.example'),dict(base,id='d',name='مطعم المثال',source_website='two.example')]
  self.assertEqual(len(diversify(rows,'marketing')),4)
 def test_actual_mandatory_secondary_source_errors_and_independent_support(self):
  examples=[('software','محاصيل تركيا للفواكه والخضروات',"Grocery التموينات Software company ['متجر فواكه وخضروات']"),('software','رباط المونسية',"Hotels and Accommodations Software company ['مبنى سكني']"),('plumbing','كدن لتأجير السيارات','Plumbing supply store|Building materials store'),('textiles','شركه البحر الاحمر للتأمين','Uniform store'),('plumbing','سهام لهدايا المواليد والمناسبات','Electrical supply store|Building materials store|Plumbing supply store')]
  for key,name,category in examples:
   for direction in ['purchase','availability','partnership']:
    r=eligibility('طلب منتج',key,direction,name,category);self.assertFalse(r['eligible'],name);self.assertEqual(r['activity_assessment']['original_source_categories'][0]['value'],category)
   self.assertTrue(eligibility('طلب منتج',key,'purchase',name,category,independent_offer=True)['eligible'],name)
 def test_new_activity_labels_do_not_turn_into_product_proof(self):
  for category,expected in [('Warehousing services خدمات تخزين','warehouse'),('Gift shops / home decoration هدايا تذكارية','gifts'),('Tools / Equipment rental','equipment_rental'),('Flower shops زهور','flowers')]:
   a=assessment('اسم منشأة',category);self.assertEqual(a['primary_activity'],expected);self.assertFalse(a['name_alone_is_proof'])
  self.assertIsNone(assessment('منشأة مجهولة','19.0')['primary_activity'])

class CityPostingIntegration(unittest.TestCase):
 def test_same_source_candidates_with_city_index_and_immutable_input(self):
  import tempfile,sqlite3,os
  from pathlib import Path
  from unittest.mock import patch
  from types import SimpleNamespace
  from city_retrieval_index import build
  from golden_directory import candidates
  with tempfile.TemporaryDirectory() as folder:
   src=Path(folder)/'original.db';dst=Path(folder)/'derived.db';db=sqlite3.connect(src)
   db.executescript('CREATE TABLE profiles(poi_key TEXT PRIMARY KEY,name,city,district,activity,website,observed_at,channels_json,lifecycle,company,landmark);CREATE TABLE metadata(key TEXT PRIMARY KEY,value);CREATE VIRTUAL TABLE profile_search USING fts5(poi_key UNINDEXED,text);')
   for key,city in [('r1','Riyadh'),('r2','الرياض'),('j1','Jeddah')]:
    db.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?,?,?,?)',(key,'شركة تطوير برمجيات '+key,city,'حي','Software company',None,'2025-01-01','["phone"]','open','open','false'))
    db.execute('INSERT INTO profile_search VALUES(?,?)',(key,'شركة تطوير برمجيات Software company'))
   db.commit();db.close();original=src.read_bytes();build(src,dst)
   k=SimpleNamespace(city_aliases={'riyadh':'r','الرياض':'r'},city_matches=lambda a,b:a.lower() in ['riyadh','الرياض'] and b.lower() in ['riyadh','الرياض'])
   results=[]
   for path in [src,dst]:
    with patch.dict(os.environ,{'FARQ_GOLDEN_INDEX':str(path),'FARQ_ACTIVITY_QUALITY':''}):results.append({r['source_ref'] for r in candidates(k,'برامج محاسبة','purchase','الرياض',20)})
   self.assertEqual(results,[{'r1','r2'},{'r1','r2'}]);self.assertEqual(src.read_bytes(),original)
