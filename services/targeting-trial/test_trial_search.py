import pathlib, tempfile, time, unittest
from unittest.mock import patch
import duckdb
from trial_search import Directory, evidence, interpret

def row(name,category): return {'name':name,'evidence_category':category}
class Relevance(unittest.TestCase):
    def test_buyer_activity_never_becomes_seller(self):
        self.assertEqual(interpret('كرسي انتظار للعيادة')['key'],'chairs')
        self.assertEqual(interpret('حبوب قهوة للمكتب')['key'],'coffee')
        self.assertEqual(interpret('مواد غذائية للمطعم')['key'],'food')
    def test_arabic_variants(self):
        self.assertEqual(interpret('موية للشركة')['key'],'water')
        self.assertEqual(interpret('أثاث للموظفين')['key'],'furniture')
        self.assertEqual(interpret('ادوية محددة')['key'],'medicine')
    def test_lookalike_grocery_and_repair_not_chair_suppliers(self):
        p=interpret('كرسي انتظار للعيادة')
        for n,c in [('كرسي أريكة','Grocery'),('صيانة كرسي كهربائي','medical repair'),('عيادة كرسي','clinic'),('مفروشات','Furniture fittings')]: self.assertIsNone(evidence(row(n,c),p))
        self.assertIsNotNone(evidence(row('مورد أثاث','office furniture'),p))
    def test_roaster_not_cafe_or_bakery(self):
        p=interpret('قهوة للمكتب');self.assertIsNotNone(evidence(row('محمصة البن','coffee wholesaler'),p))
        for n,c in [('مقهى البن','Coffee shop'),('بندر','Grocery'),('أسواق ومخابز','Grocery | coffee supplier')]:self.assertIsNone(evidence(row(n,c),p))
    def test_medical_supplier_not_clinic_or_repair(self):
        p=interpret('مستلزمات طبية');self.assertIsNotNone(evidence(row('تجهيزات طبية','medical supplies'),p))
        self.assertIsNone(evidence(row('مكتب أجهزة طبية','تصليح تجهيزات طبية'),p))
    def test_computer_query_does_not_return_copy_shop(self):
        p=interpret('كمبيوتر للمكتب');self.assertIsNone(evidence(row('مركز طباعة','printer | copying service'),p))
        self.assertIsNotNone(evidence(row('متجر حاسب','computer store'),p))
    def test_generic_query_requires_all_terms(self):
        p=interpret('ميزان مخبري');self.assertIsNone(evidence(row('ميزان','ميزان صناعي'),p));self.assertIsNotNone(evidence(row('ميزان مخبري','معدات مختبر'),p))
class IsolatedDirectory(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=str(pathlib.Path(self.tmp.name)/'fixture.parquet')
        c=duckdb.connect();c.execute('create table fixture(name_ar varchar,name_en varchar,category_ar varchar,category varchar,secondary_category varchar,category_l3 varchar,google_category varchar,district_ar varchar,district_en varchar,completeness_pct double,phone_norm varchar,email varchar,website varchar,city_en varchar,lifecycle_state varchar,company_status varchar)')
        for i in range(15):c.execute('insert into fixture values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[f'مورد أثاث اختبار {i}',None,'أثاث مكتبي','office furniture',None,None,None,'حي اختبار',None,100-i,'FAKE-ONLY',None,None,'Riyadh','active','active'])
        c.execute("insert into fixture select * from fixture limit 1")
        c.execute("insert into fixture values ('كرسي وهمي',null,'بقالة','Grocery',null,null,null,'حي اختبار',null,100,'FAKE-ONLY',null,null,'Riyadh','active','active')")
        c.execute('copy fixture to ? (format parquet)',[self.path]);c.close();self.d=Directory(self.path)
    def tearDown(self):self.d.db.close();self.tmp.cleanup()
    def test_ten_real_unique_rows_and_correct_hidden_count(self):
        r=self.d.search('كراسي انتظار','Riyadh');self.assertEqual(r['total'],15);self.assertEqual(len(r['rows']),10);self.assertEqual(len({x['name_ar'] for x in r['rows']}),10);self.assertNotIn('FAKE-ONLY',str(r));self.assertNotIn('كرسي وهمي',str(r))
    def test_city_isolation_and_injection(self):
        self.assertEqual(self.d.search('كراسي انتظار','Jeddah')['total'],0)
        self.assertEqual(self.d.search('كراسي انتظار',"Riyadh' OR 1=1 --")['total'],0)
    def test_common_query_does_not_call_model(self):
        with patch('trial_search.extend_intent',side_effect=AssertionError('common product should not call a model')):self.assertEqual(len(self.d.search('كرسي انتظار','Riyadh')['rows']),10)
    def test_unknown_model_failure_preserves_honest_empty_result(self):
        with patch.dict('os.environ',{'ANTHROPIC_API_KEY':'fixture-only'}), patch('trial_search.urllib.request.urlopen',side_effect=TimeoutError) as call:
            self.assertEqual(self.d.search('ميزان مخبري','Riyadh')['rows'],[]);self.assertEqual(call.call_args.kwargs['timeout'],4)
    def test_empty_result_not_fabricated(self):self.assertEqual(self.d.search('ميزان مخبري','Riyadh')['rows'],[])
    def test_cached_search_does_not_query_database(self):
        first=self.d.search('كراسي انتظار','Riyadh');self.d.db.close();self.assertEqual(self.d.search('كراسي انتظار','Riyadh'),first)
    def test_invalid_input(self):
        for q in ['',None,{},'x'*121]:
            with self.assertRaises(ValueError):self.d.search(q,'Riyadh')
if __name__=='__main__':unittest.main()
