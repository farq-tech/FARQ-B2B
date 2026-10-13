import os,unittest
from unittest.mock import patch
from test_core import Tests
from core import Knowledge
from pragmatic import reject,score
class Policy(unittest.TestCase):
 def test_critical_exclusions(self):
  self.assertIsNotNone(reject('أبواب WPC داخلية','مفصلة باب WPC','مفصلة باب WPC'))
  self.assertIsNotNone(reject('أبواب PVC منزلية','High Speed Doors industrial','PVC industrial doors'))
  self.assertIsNotNone(reject('كاميرا فحص الأنابيب','كاميرات مراقبة','security camera'))
  self.assertIsNotNone(reject('أنبوب UPVC قطر 110 مم','أنبوب UPVC قطر 90 مم','upvc 90 mm'))
  self.assertIsNone(reject('أبواب WPC داخلية','باب WPC','باب wpc'))
 def test_weights_and_contact_separation(self):
  self.assertEqual(score({k:1 for k in ['product','specialty','identity','geography','recency','contact']}),100)
  self.assertEqual(score({'product':1}),40)
 def test_disabled_in_production(self):
  with patch.dict(os.environ,{'FARQ_PRAGMATIC_MATCHING':'1','NODE_ENV':'production'}):
   from pathlib import Path
   self.assertFalse(Knowledge(Path('/tmp/no-access-needed'),None).pragmatic)
class PragmaticScope(Tests):
 def test_pragmatic_does_not_transfer_private_evidence(self):
  self.k.pragmatic=True
  self.assertFalse(self.k.search('WPC door','purchase','','local-review:bob')['main'])
 def test_missing_legal_identity_allows_independent_commercial_source(self):
  self.k.pragmatic=True
  r=self.k.search('WPC door','purchase','','local-review:alice')
  self.assertTrue(r['main']);self.assertFalse(r['main'][0]['verified']);self.assertTrue(r['main'][0]['entity_id'].startswith('COMMERCIAL_PROFILE'));self.assertNotEqual(r['main'][0]['entity_id'],'obs')
if __name__=='__main__':unittest.main()
