import json, unittest
from unittest.mock import patch
import buyer_review
class Response:
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def read(self,*args):return json.dumps({'content':[{'text':'{"accepted":[0,0,99,-1,"1",true]}'}]}).encode()
class ReviewTests(unittest.TestCase):
 def test_only_supplied_ids_and_no_demand_claim(self):
  rows=[{'name_ar':'شركة مقاولات','category':'Construction contractor'}]
  with patch.dict('os.environ',{'ANTHROPIC_API_KEY':'test'}),patch('buyer_review.urllib.request.urlopen',return_value=Response()):result=buyer_review.review('أبيع مواد سباكة',rows)
  self.assertEqual(len(result),1);self.assertIn('غير مثبتين',result[0]['reason'])
 def test_no_key_abstains(self):
  with patch.dict('os.environ',{},clear=True):self.assertEqual(buyer_review.review('منتج',[{'name_ar':'جهة'}]),[])
if __name__=='__main__':unittest.main()
