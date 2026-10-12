import sys,unittest
sys.path.insert(0,'/Users/m4pro/farq-targeting')
from contact_lookup import verified_phone,enrich
class Test(unittest.TestCase):
 def setUp(self):
  self.row={'name_ar':'شركة المثال','latitude':24.7,'longitude':46.7}
  self.place={'displayName':{'text':'شركة المثال'},'location':{'latitude':24.7,'longitude':46.7},'internationalPhoneNumber':'+966 55 123 4567','googleMapsUri':'https://maps.google.com/?cid=1'}
 def test_match(self):
  p=verified_phone(self.row,self.place);self.assertEqual(p['phone'],'966551234567');self.assertFalse(p['whatsapp_verified'])
 def test_wrong_branch(self):
  self.place['location']['latitude']=25;self.assertIsNone(verified_phone(self.row,self.place))
 def test_similar_name(self):
  self.place['displayName']['text']='شركة مثال مختلفة';self.assertIsNone(verified_phone(self.row,self.place))
 def test_missing_source(self):
  self.place['googleMapsUri']='https://unrelated.example';self.assertIsNone(verified_phone(self.row,self.place))
unittest.main()
