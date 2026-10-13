import os,sqlite3,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from activity_search import search
class ActivitySearch(unittest.TestCase):
 def test_activity_match_does_not_require_product_or_buying_proof(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'index.db';db=sqlite3.connect(p)
   db.executescript('CREATE TABLE profiles(poi_key,name,city,district,activity,website,observed_at,channels_json,lifecycle,company,landmark);CREATE VIRTUAL TABLE profile_search USING fts5(poi_key UNINDEXED,text);')
   for key,activity,closed,landmark in [('1','law firm',False,False),('2','law firm',True,False),('3','law firm',False,True),('4','restaurant',False,False),('5','law firm',False,False)]:
    db.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?,?,?,?)',(key,'Entity '+key,'Riyadh','District',activity,'','2024-01-01','[]','closed' if closed else '', '',str(landmark).lower()))
    db.execute('INSERT INTO profile_search VALUES(?,?)',(key,activity))
   db.commit();db.close()
   with patch.dict(os.environ,{'FARQ_GOLDEN_INDEX':str(p)}):
    k=SimpleNamespace(city_aliases={},city_matches=lambda a,b:a==b)
    r=search(k,'law firm','Riyadh',1)
    self.assertEqual(r['total'],2);self.assertEqual(r['next_offset'],1)
    second=search(k,'law firm','Riyadh',1,1)
    self.assertIsNone(second['next_offset']);self.assertNotEqual(r['direct'][0]['id'],second['direct'][0]['id'])
    self.assertEqual(len(r['direct']),1);item=r['direct'][0]
    self.assertEqual(item['role'],'organization');self.assertEqual(item['purchase_intent'],'UNKNOWN');self.assertFalse(item['verified']);self.assertFalse(r['execution_enabled'])
    self.assertFalse(search(k,'unknown trade','Riyadh',10)['direct'])
if __name__=='__main__':unittest.main()
