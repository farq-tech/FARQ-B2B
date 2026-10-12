import unittest
from searchability import classify
class Triage(unittest.TestCase):
 def test_general(self):self.assertEqual(classify({'name_ar':'مطعم','category':'Restaurants'})[0],'GENERAL_NAME')
 def test_missing(self):self.assertEqual(classify({'category':'Corporate'})[0],'UNRESOLVED')
 def test_landmark(self):self.assertEqual(classify({'name_ar':'جامع الملك','category':'Mosques'})[0],'LANDMARK_OR_NONCOMMERCIAL')
 def test_candidate(self):self.assertEqual(classify({'name_ar':'مطعم الاختبار','category':'Restaurants'})[0],'SEARCHABLE_BUSINESS_CANDIDATE')
 def test_name_only(self):self.assertEqual(classify({'name_ar':'شركة الاختبار'})[0],'NAME_ONLY_BUSINESS_CANDIDATE')
 def test_no_automatic_entity_merge(self):self.assertEqual(classify({'name_ar':'الاختبار'})[0],'UNRESOLVED')
if __name__=='__main__':unittest.main()
