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
if __name__=='__main__':unittest.main()
