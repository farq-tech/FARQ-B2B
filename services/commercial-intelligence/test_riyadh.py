import unittest
from golden_directory import pure_functions,activity_conflict
class RiyadhDirections(unittest.TestCase):
 def test_existing_products_reused_and_direction_inverted(self):
  f=pure_functions()
  for goal,key in [('مواد نظافة','cleaning'),('قرطاسية','stationery'),('كابلات كهربائية','cables'),('مواد تغليف','packaging'),('معدات مطبخ','kitchen'),('مستلزمات طبية','medical'),('مواد غذائية','food'),('أجهزة كمبيوتر','computers')]:
   with self.subTest(goal=goal):
    product=f['interpret'](goal);buyer=f['buyer_intent']('أبيع '+goal)
    self.assertEqual(product['key'],key);self.assertTrue(buyer['seller'])
    self.assertNotEqual(product['seller'],buyer['seller'])
    self.assertIn('غير',buyer['label']) if key in ['computers','food'] else self.assertIn('لا طلب شراء',buyer['label'])
 def test_source_activity_conflicts_are_quarantined(self):
  f=pure_functions()
  for name,activity,goal,direction in [('درعه','Computer store متجر عطور','أجهزة كمبيوتر','purchase'),('مكتب الهديان للعقارات','Plastic containers','مواد تغليف','purchase'),('تصليح ساعات','Construction company','أبيع حديد','marketing'),('شركة حلول الأنظمة للطاقة المتجددة','Medical equipment','مستلزمات طبية','purchase')]:
   with self.subTest(name=name):self.assertTrue(activity_conflict(name,activity,f['interpret'](goal),goal,direction))
 def test_unsupported_goal_does_not_invent_buyers(self):
  self.assertFalse(pure_functions()['buyer_intent']('أبيع صنف مجهول س123')['seller'])
 def test_buyers_do_not_become_sellers(self):
  f=pure_functions()
  self.assertIsNone(f['evidence']({'name':'عيادة المثال','evidence_category':'medical clinic'},f['interpret']('مستلزمات طبية')))
if __name__=='__main__':unittest.main()
