import unittest
from types import SimpleNamespace
from commercial_contract import identity_basis,annotate
from golden_directory import pure_functions,activity_conflict
class Contract(unittest.TestCase):
 def test_identity_neutral_and_does_not_merge_by_host_alone(self):
  a=identity_basis('a','Firm A','https://example.sa');b=identity_basis('b','Firm A','https://example.sa')
  self.assertEqual(a['id'],b['id']);self.assertNotEqual(a['id'],identity_basis('b','Firm B','https://example.sa')['id'])
  self.assertNotEqual(identity_basis('a','Firm A','https://facebook.com/a')['id'],identity_basis('b','Firm A','https://facebook.com/a')['id'])
  self.assertEqual(a['legal_status'],'UNVERIFIED')
 def test_roles_are_contextual_and_contacts_never_borrowed(self):
  k=SimpleNamespace();ids=[]
  for objective,role in [('purchase','seller'),('marketing','buyer'),('partnership','partner'),('availability','seller')]:
   row={'id':'row','entity_id':'same-source','name':'Firm','role':role,'level':'C','evidence_kind':'SOURCE_ACTIVITY','reason':'Activity','verified':False,'contact_channels':[]}
   r=annotate(k,{'main':[],'expansion':[row]},'Product',objective);x=r['potential'][0];ids.append(x['entity_id'])
   self.assertIsNone(x['commercial_identity']['permanent_role']);self.assertFalse(x['commercial_relationship']['current_demand']);self.assertEqual(x['commercial_relationship']['role'],role)
   self.assertFalse(x['reachability']['borrowed_from_other_branch']);self.assertTrue(x['reachability']['needs_enrichment'])
  self.assertEqual(len(set(ids)),1)
 def test_general_services_and_adversarial_disambiguation(self):
  f=pure_functions()
  for q,key in [('خدمات محاسبة','accounting'),('برامج محاسبة','software'),('استشارات قانونية','legal'),('خدمات شحن','logistics'),('قطع غيار سيارات','auto_parts')]:
   self.assertEqual(f['interpret'](q)['key'],key);self.assertTrue(f['buyer_intent']('أبيع '+q)['seller'])
  self.assertFalse(activity_conflict('Example Law Firm','law firm',f['interpret']('استشارات قانونية'),'استشارات قانونية','purchase'))
 def test_explicit_targets_are_not_limited_by_product_profiles(self):
  r=pure_functions()['buyer_intent']('أبيع عبوات زجاجية وأستهدف المطاعم')
  self.assertEqual(r['key'],'explicit_buyer_activity');self.assertTrue(r['seller'])
class OfferQuality(unittest.TestCase):
 def test_offer_context_separates_services(self):
  from pragmatic import offer_support
  self.assertFalse(offer_support('accounting','Accounting software','accounting software product'))
  self.assertTrue(offer_support('accounting','Accounting firm','accounting services and bookkeeping'))
  self.assertFalse(offer_support('logistics','Clothes shop','shipping policy free delivery'))
  self.assertTrue(offer_support('logistics','Shipping company','freight forwarding services'))
  self.assertFalse(offer_support('legal','Engineering consultants','engineering consultants legal footer'))
if __name__=='__main__':unittest.main()
