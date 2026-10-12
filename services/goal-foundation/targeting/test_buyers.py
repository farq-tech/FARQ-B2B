import unittest
from unittest.mock import patch
import trial_search as t
class Buyers(unittest.TestCase):
 def test_four_cases_and_reverse(self):
  cases=[('ابيع خدمات موارد بشرية','شركة تصنيع','Corporate'),('ابيع ادوية طبية تجميلية','عيادة جلدية','Dermatology clinic'),('ابيع اكواب ورق','مقهى الرياض','Cafe'),('ابيع اكواب بلاستيك','مطعم الرياض','Restaurant')]
  for q,name,category in cases:
   intent=t.buyer_intent(q)
   self.assertIsNotNone(t.evidence({'name':name,'evidence_category':category},intent))
  self.assertIsNone(t.evidence({'name':'مورد اكواب','evidence_category':'packaging factory'},t.buyer_intent('ابيع اكواب ورق')))
  self.assertIsNone(t.evidence({'name':'صالون تجميل','evidence_category':'beauty salon'},t.buyer_intent('ابيع ادوية طبية تجميلية')))
  self.assertIsNone(t.evidence({'name':'شركة توظيف','evidence_category':'recruitment agency'},t.buyer_intent('ابيع خدمات موارد بشرية')))
 def test_unknown_abstains_without_model(self):
  with patch.dict(t.os.environ,{},clear=True):
   fallback=t.buyer_intent('ابيع منتج مجهول تماما')
   self.assertEqual(t.extend_intent('ابيع منتج مجهول تماما',fallback,'marketing')['seller'],[])
 def test_ai_supplies_family_and_target_categories(self):
  import json
  from io import BytesIO
  data={'content':[{'text':json.dumps({'label':'أنظمة محاسبة','family':'برمجيات أعمال','product':[], 'seller':['restaurant | مطعم','مطاعم'],'broader':['retail shops'], 'target_label':'منشآت تحتاج إدارة حساباتها','exclude':['software developer']})}]}
  with patch.dict(t.os.environ,{'ANTHROPIC_API_KEY':'test-key'}), patch.object(t.urllib.request,'urlopen',return_value=BytesIO(json.dumps(data).encode())) as call:
   result=t.extend_intent('أبيع برنامج محاسبة',t.buyer_intent('أبيع برنامج محاسبة'),'marketing')
   self.assertEqual(result['family'],'برمجيات أعمال')
   self.assertEqual(result['understanding_source'],'ai')
   self.assertIn('retail shops',result['seller'])
   self.assertIn('restaurant',result['seller'])
   self.assertIn('مطعم',result['seller'])
   self.assertNotIn('restaurant | مطعم',result['seller'])
   self.assertEqual(call.call_args.kwargs['timeout'],12)
 def test_usage_priority_is_not_purchase_intent(self):
  intent={'usage_priority':[{'term':'restaurant','level':'high','reason':'استخدام متكرر للأكواب'},{'term':'office','level':'low','reason':'استخدام محدود'}]}
  self.assertGreater(t.usage_rank(intent,'Restaurant','Food')[0],t.usage_rank(intent,'Office','Corporate')[0])
  self.assertEqual(t.usage_rank(intent,'Unknown','Other')[0],0)
if __name__=='__main__':unittest.main()
