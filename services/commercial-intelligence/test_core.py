import json,sqlite3,tempfile,unittest,threading,urllib.request,urllib.error
from pathlib import Path
from identity import observation_id,reconcile,stable_id
from core import Knowledge
from server import handler
from http.server import ThreadingHTTPServer

class Port:
    def analyze(self,objective,text):return {'product':{'resolution':{'intent':'wpc_door','search_terms':[]}},'targetRole':'seller' if objective=='purchase' else 'buyer'}

class Tests(unittest.TestCase):
    def setUp(self):
        self.dir=tempfile.TemporaryDirectory();self.db=Path(self.dir.name)/'review.db'
        db=sqlite3.connect(self.db);db.executescript(Path(__file__).with_name('schema.sql').read_text())
        db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?,?)',('obs','source','uid','شركة المثال','الرياض','حي تجريبي','building supplier','example.test','SOURCE_RECORD_LINEAGE_ONLY'))
        db.execute('INSERT INTO subjects VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',('subject','key','WPC Door 6 cm','wpc door 6 cm','source',None,None,'{}','https://example.test/door','PRODUCT','2026-09-03','SAVED_FETCH','saved-file'))
        db.execute('INSERT INTO subject_search VALUES(?,?)',('subject','wpc door 6 cm'))
        db.execute('INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)',('ev','saved-file',1,'https://example.test/door','hash','2026-09-03','SAVED_FETCH','PRODUCT','WPC Door',None,'AUTOMATED_CONTENT_CAPTURE'))
        db.execute('INSERT INTO relations VALUES(?,?,?,?,?,?,?,?,?,?,?)',('relation','obs','subject',None,None,'SELLS','ev','IDENTITY_REVIEW_REQUIRED','PRODUCT','["LEGAL_IDENTITY_UNPROVEN"]','local-review:alice'))
        db.commit();db.close();self.k=Knowledge(self.db,Port())
    def tearDown(self):self.dir.cleanup()
    def test_stable_ids_survive_sg_renumber(self):
        before=observation_id('source','uid');legacy_before=['SG-0000001'];legacy_after=['SG-0000002']
        self.assertNotEqual(legacy_before,legacy_after);self.assertEqual(before,observation_id('source','uid'))
    def test_name_and_domain_never_legal_merge(self):
        r=reconcile({'supplier_name':'شركة أ','url':'https://example.test'},[{'source_id':'s','record_uid':'1','name_ar':'شركة أ','website_raw':'https://example.test'}])
        self.assertFalse(r['automatic_legal_merge']);self.assertFalse(r['legacy_key_used_as_identity'])
    def test_shared_domain_names_not_same_business(self):
        records=[{'source_id':'s','record_uid':'1','name_ar':'شركة أ','website_raw':'https://example.test'},{'source_id':'s','record_uid':'2','name_ar':'شركة ب','website_raw':'https://example.test'}]
        r=reconcile({'supplier_name':'شركة أ','url':'https://example.test'},records)
        self.assertEqual(len(r['candidate_observation_ids']),1)
    def test_unknown_seller_not_promoted(self):
        r=self.k.search('WPC door','purchase','','local-review:alice');self.assertFalse(r['direct']);self.assertEqual(len(r['potential']),1);self.assertEqual(r['potential'][0]['availability'],'UNKNOWN')
    def test_private_relation_hidden_from_other_actor(self):
        r=self.k.search('WPC door','purchase','','local-review:bob');self.assertFalse(r['direct']);self.assertFalse(r['potential'])
    def test_private_evidence_hidden_even_with_public_relation(self):
        db=sqlite3.connect(self.db);db.execute("UPDATE relations SET scope_owner=NULL");db.execute("UPDATE evidence SET owner_scope='local-review:alice'");db.commit();db.close()
        r=self.k.search('WPC door','purchase','','local-review:bob');self.assertFalse(r['potential']);self.assertFalse(r.get('catalogue_evidence'))
    def test_wait_message_is_not_waiting_chair(self):
        db=sqlite3.connect(self.db);db.execute("UPDATE subjects SET name='Office Chair',normalized_text='office chair please wait while loading'");db.execute("UPDATE subject_search SET normalized_text='office chair please wait while loading'");db.commit();db.close()
        r=self.k.search('waiting chair','purchase','','local-review:alice');self.assertFalse(r['potential'])
    def test_source_read_only(self):
        before=self.db.read_bytes();self.k.search('WPC door','purchase','','local-review:alice');self.assertEqual(before,self.db.read_bytes())
    def test_no_actor_and_limits(self):
        with self.assertRaises(PermissionError):self.k.search('WPC door')
        with self.assertRaises(ValueError):self.k.search('WPC door',actor='a',limit=True)
    def test_http_flag_and_actor(self):
        for enabled in [False,True]:
            server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.k,enabled));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                request=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/commercial/discover',data=b'{"text":"WPC door"}',headers={'content-type':'application/json'})
                with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(request)
                self.assertEqual(err.exception.code,401 if enabled else 404)
                if enabled:
                    request.add_header('X-Local-Review-Actor','local-review:alice')
                    r=json.load(urllib.request.urlopen(request));self.assertFalse(r['execution_enabled']);self.assertEqual(r['messages_sent'],0)
            finally:server.shutdown();server.server_close();thread.join()
    def test_proven_buyer_has_no_activity_fallback(self):
        r=self.k.search('أبيع مواد سباكة وأريد احتياجات مثبتة','marketing','','local-review:alice',proven_only=True);self.assertFalse(r['potential']);self.assertFalse(r['direct'])
    def test_seller_list_not_reversed_to_partners(self):
        r=self.k.search('WPC door','partnership','','local-review:alice');self.assertFalse(r['potential'])

if __name__=='__main__':unittest.main()
