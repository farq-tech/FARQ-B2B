import unittest,tempfile,sqlite3,json,os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from commercial_contract import annotate
from commercial_value import understand,rerank,target_intent
from internal_contacts import values
from prepare_value_enrichment import prepare
class CommercialValue(unittest.TestCase):
 def row(self,id,name,activity):return {'id':id,'name':name,'source_activity':activity,'score':60,'level':'C','source_ref':id}
 def test_quantity_and_target_not_confused_with_product(self):
  c=understand('شركة تبيع ٥٠٠ جهاز كمبيوتر تبحث عن جهات لديها مشتريات مؤسسية','marketing','الرياض')
  self.assertEqual(c['quantities'],[{'value':500,'unit':'جهاز'}]);self.assertTrue(c['institutional_procurement']);self.assertEqual(c['product_text'],'جهاز كمبيوتر')
 def test_scale_changes_ranking_not_demand(self):
  c=understand('أبيع 500 جهاز كمبيوتر','marketing')
  rows=rerank([self.row('school','مدرسة','elementary school'),self.row('uni','جامعة','university')],c)
  self.assertEqual(rows[0]['id'],'uni');self.assertEqual(rows[0]['commercial_value']['relationship_state'],'POTENTIAL');self.assertEqual(rows[0]['commercial_value']['quantity_capacity'],'UNCONFIRMED')
 def test_independent_does_not_claim_ownership(self):
  c=understand('مصنع أكواب يريد مقاهي مستقلة بالجملة','marketing')
  rows=rerank([self.row('chain','دانكن','cafe'),self.row('local','مقهى المثال','cafe')],c)
  self.assertEqual([r['id'] for r in rows],['local']);self.assertIn('يحتاج تحقق',rows[0]['commercial_value']['reasons'][1])
 def test_large_contracts_not_individual(self):
  c=understand('أبيع سباكة لمقاولين كبار بالجملة','marketing')
  rows=rerank([self.row('p','فني فردي','technician'),self.row('c','شركة مقاولات','construction company')],c)
  self.assertEqual(rows[0]['id'],'c')
 def test_head_office_and_local_record_separate(self):
  c=understand('أبيع 500 جهاز كمبيوتر','marketing');r=self.row('h','المقر الرئيسي','corporate office');r['district']='الملز'
  self.assertEqual(rerank([r],c)[0]['commercial_value']['procurement_scope'],'CENTRAL_OFFICE_SOURCE_SIGNAL')
 def test_open_targets_not_product_family_cap(self):
  c=understand('مصنع أبواب يبي موزعين ومقاولين','marketing')
  i=target_intent(c,{'seller':[]});self.assertIn('distributor',i['seller']);self.assertIn('contractor',i['seller'])
 def test_no_quantity_from_material_spec(self):
  c=understand('أنبوب قطر 110 مم','purchase');self.assertFalse(c['institutional_procurement'])
 def test_retail_and_wholesale_distinct(self):
  self.assertEqual(understand('أشتري أكواب بالتجزئة','purchase')['trade_channel'],'RETAIL');self.assertEqual(understand('مصنع أكواب بالجملة','marketing')['requesting_establishment'],'MANUFACTURER')
 def test_plan_budget_zero_and_one_identity(self):
  row=self.row('a','مثال','store');row.update(commercial_identity={'id':'entity-a'},reachability={'contact_completion_needed':True})
  plan=prepare([{'expansion':[row,row]}]);self.assertEqual(len(plan),1);self.assertEqual(plan[0]['approved_budget'],0);self.assertFalse(plan[0]['execution_allowed'])
 def test_contact_overlay_preserves_saved_values_and_never_borrows(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'contacts.db';db=sqlite3.connect(path);db.execute('CREATE TABLE contacts(source_id TEXT PRIMARY KEY,payload TEXT)');db.execute('INSERT INTO contacts VALUES(?,?)',('COMMERCIAL_PROFILE-a',json.dumps({'phone':['+966551234567'],'email':[],'scope':'EXACT_SOURCE_RECORD'})));db.commit();db.close();before=path.read_bytes()
   a={'id':'a','entity_id':'COMMERCIAL_PROFILE-a','name':'Firm','role':'seller','public_source_contacts':{'phone':[],'email':['sales@example.sa']}}
   b={'id':'b','entity_id':'COMMERCIAL_PROFILE-b','name':'Firm','role':'seller'}
   with patch.dict(os.environ,{'FARQ_INTERNAL_CONTACTS':str(path),'FARQ_GOLDEN_INDEX':'','FARQ_ACTIVITY_QUALITY':'','FARQ_COMMERCIAL_REGISTRY':''}):r=annotate(SimpleNamespace(),{'main':[a,b],'expansion':[]},'product','purchase')
   self.assertEqual(r['main'][0]['reachability']['source_contacts'],{'phone':['+966551234567'],'email':['sales@example.sa']});self.assertFalse(r['main'][1]['reachability']['actual_values_available']);self.assertEqual(path.read_bytes(),before)
 def test_contacts_sa_format_and_no_whatsapp_claim(self):
  self.assertEqual(values('٠٥٥١٢٣٤٥٦٧','phone'),['+966551234567']);self.assertEqual(values('0000000000','phone'),[]);self.assertEqual(values('965551234567','phone'),[])
if __name__=='__main__':unittest.main()
