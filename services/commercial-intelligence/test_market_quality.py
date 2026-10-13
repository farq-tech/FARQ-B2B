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
