import io, json, pathlib, sys, unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))
import trial
class Handler:
    command='POST'; path='/_trial/search';client_address=('unit-test',123)
    def __init__(self, body=None):
        raw=json.dumps(body or {'q':'كرسي انتظار','city':'Riyadh'}).encode();self.rfile=io.BytesIO(raw);self.headers={'Content-Length':str(len(raw)),'Content-Type':'application/json','Host':'test.local'}
    def _send(self,status,body,ctype,extra=None): self.status=status;self.data=json.loads(body)
class TrialTests(unittest.TestCase):
    def setUp(self): trial._hits.clear();trial._global_hits.clear();trial._city_cache.update(until=0,rows=[])
    def test_concealed_and_contact_data_never_leave_server(self):
        data={'total':30,'rows':[{'name_ar':f'اختبار {i}','phone':'PRIVATE','email':'PRIVATE','poi_key':'PRIVATE','latitude':24,'extra':{'secret':'PRIVATE'}} for i in range(20)]}
        result=trial.public_result(data);self.assertEqual(len(result['suppliers']),10);self.assertEqual(result['additional'],20);self.assertNotIn('PRIVATE',json.dumps(result));self.assertNotIn('اختبار 10',json.dumps(result,ensure_ascii=False))
    def test_no_fabricated_ten_when_results_are_fewer(self):
        self.assertEqual(len(trial.public_result({'rows':[{'name_ar':'اختبار'}],'total':1})['suppliers']),1)
        self.assertEqual(trial.public_result({'rows':[],'total':0})['additional'],0)
    def test_unrelated_ranked_result_not_shown(self): self.assertEqual(trial.public_result({'rows':[{'name_ar':'اختبار','ai':'N'}],'total':1})['suppliers'],[])
    def test_only_read_calls_with_server_owned_limit(self):
        h=Handler({'q':'كرسي انتظار','city':'Riyadh','limit':5000,'send':True})
        with patch.object(trial,'upstream',side_effect=[[{'en':'Riyadh','ar':'الرياض'}],{'total':1,'rows':[{'name_ar':'اختبار'}]}]) as call:
            trial.handle(h,'http://127.0.0.1:1','fixture-only');self.assertEqual(h.status,200);self.assertEqual(call.call_args.args[-1]['limit'],10);self.assertEqual([c.args[2] for c in call.call_args_list],['/cities','/search'])
    def test_invalid_or_multi_item_input_does_not_call_upstream(self):
        for body in [{'q':'كرسي\nقهوة','city':'Riyadh'},{'q':'ab','city':'Riyadh'},{'q':{},'city':'Riyadh'}]:
            with patch.object(trial,'upstream') as call:
                h=Handler(body);trial.handle(h,'http://127.0.0.1:1','fixture-only');self.assertEqual(h.status,400);call.assert_not_called()
    def test_no_provider_secret_is_fail_closed(self):
        h=Handler();trial.handle(h,'http://127.0.0.1:1','');self.assertEqual(h.status,503)
    def test_send_and_wrong_methods_rejected(self):
        h=Handler();h.path='/_trial/send';trial.handle(h,'','fixture-only');self.assertEqual(h.status,404)
        h=Handler();h.command='DELETE';trial.handle(h,'','fixture-only');self.assertEqual(h.status,405)
    def test_cross_origin_rejected_before_provider(self):
        h=Handler();h.headers['Origin']='https://other.invalid';trial.handle(h,'','fixture-only');self.assertEqual(h.status,403)
    def test_rate_limits(self): self.assertEqual([trial.permitted('fixture') for _ in range(4)],[True,True,True,False])
if __name__=='__main__': unittest.main()
