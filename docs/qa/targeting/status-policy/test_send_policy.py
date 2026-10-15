"""Synthetic, offline tests for the status policy and every send path.
Run:  CODE_DIR=patched python3 -m unittest test_send_policy -v
Network is blocked (urllib.request.urlopen raises); the WhatsApp provider is a recording fake."""
import os, sys, re, json, glob, shutil, threading, unittest, urllib.request, http.client
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
CODE = (HERE / os.environ.get('CODE_DIR', 'patched')).resolve()
sys.path.insert(0, str(CODE)); sys.path.insert(0, str(HERE))
for k in ('TARGETING_PASSWORD', 'ANTHROPIC_API_KEY', 'CONSTRUCTION_DB_URL', 'GOOGLE_PLACES_API_KEY'): os.environ.pop(k, None)
urllib.request.urlopen = mock.Mock(side_effect=AssertionError('network is not allowed in tests'))
import socket
_connect = socket.socket.connect
def _local_only(self, addr):
    if isinstance(addr, tuple) and addr[0] not in ('127.0.0.1', '::1', 'localhost'): raise AssertionError(f'network call blocked: {addr[0]}')
    return _connect(self, addr)
socket.socket.connect = _local_only
import make_fixture
import server  # noqa: E402  (loads CODE/data/targets.parquet = synthetic fixture)
PATCHED = hasattr(server, 'resolve_recipients')
RFQ = '00000000-0000-4000-8000-000000000001'
FULL_NUMBER = re.compile(r'9665\d{8}')

class FakePG:
    """Answers the few construction.* queries send_farq makes; records writes. No database."""
    def __init__(self): self.calls = []
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def commit(self): pass
    def rollback(self): pass
    def execute(self, sql, params=()):
        self.calls.append((sql.split()[0], sql[:60])); q = sql.lower()
        class R:
            def __init__(s, one=None, many=()): s.one, s.many = one, many
            def fetchone(s): return s.one
            def fetchall(s): return list(s.many)
        if 'from construction.rfqs' in q: return R(('rfq', 'owner', 'ver', 'OPEN'))
        if 'from construction.rfq_invites' in q: return R(('invite-1',))
        if 'from construction.rfq_lines' in q: return R(many=[('L1',)])
        if 'returning id' in q: return R(('supplier-1',))
        return R()

class Base(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.p1 = mock.patch.object(server, 'pg', lambda: FakePG()); self.p1.start()
        self.p2 = mock.patch.object(server, 'DB_URL', 'fake://db'); self.p2.start()
        fake = lambda payload: (self.sent.append(payload) or {'messages': [{'id': 'm%d' % len(self.sent)}]})
        if PATCHED: self.p3 = mock.patch.object(server, 'provider_send', fake)
        else: self.p3 = mock.patch.object(server, 'graph', lambda path, body=None, method=None: fake(body))
        self.p3.start()
        if hasattr(server, 'WA_TOKEN'): self.p4 = mock.patch.multiple(server, WA_TOKEN='t', WA_PHONE_ID='p'); self.p4.start()
        if hasattr(server, 'template_status'): self.p5 = mock.patch.object(server, 'template_status', lambda n: {'status': 'APPROVED'}); self.p5.start()
        if PATCHED and getattr(self, 'mechanism', True):
            # Simulates a FUTURE owner definition so the send mechanism can be exercised: open + empty lifecycle,
            # flag accepted, basis not required. The real defaults are tested in T0_DefaultPolicy.
            import status_policy as sp
            mock.patch.multiple(sp, CHECK_LIFECYCLE=True, SEND_CLASSES=frozenset({'open'}), SEND_LIFECYCLE=frozenset({''}), REQUIRE_VERIFIED_WHATSAPP=False, REQUIRE_CONTACT_BASIS=False).start()
    def tearDown(self): mock.patch.stopall()
    def farq(self, targets, mode='template', **kw):
        return server.send_farq({'rfq_id': RFQ, 'mode': mode, 'targets': targets, **kw})
    def recipients(self): return [p['to'] for p in self.sent]

@unittest.skipUnless(PATCHED, 'policy module exists only in the patched code')
class T0_DefaultPolicy(Base):
    mechanism = False
    def test_default_nothing_eligible_and_nothing_sent(self):
        keys = [k for k, *_ in make_fixture.ROWS if k != 'dupkey']
        out = self.farq([{'poi_key': k, 'whatsapp': '966511111111', 'message': 'x'} for k in keys])
        self.assertEqual(self.sent, []); self.assertEqual(out['eligible'], [])
        reasons = {f['poi_key']: f['error'] for f in out['failed']}
        self.assertTrue(reasons['s_open'].startswith('NOT_ELIGIBLE:whatsapp:source_flag_unverified'), reasons['s_open'])
        self.assertFalse(server.send_template({'poi_key': 's_open', 'to': '966511111111', 'message': 'x'})['ok'])
        out2 = self.farq([{'poi_key': k, 'whatsapp': '966511111111', 'email': 'a@b.co'} for k in keys], mode=None)
        self.assertEqual(out2.get('added', 0), 0, out2)
    def test_policy_cannot_be_widened_by_environment(self):
        import importlib, status_policy as sp
        with mock.patch.dict(os.environ, {'SEND_ALLOWED_CLASSES': 'open,hidden,unknown_empty', 'SEND_LIFECYCLE': 'draft,'}):
            importlib.reload(sp)
            self.assertEqual(sp.SEND_CLASSES, frozenset({'open', 'closed_temporary'})); self.assertTrue(sp.REQUIRE_VERIFIED_WHATSAPP)
        importlib.reload(sp)
    def test_dry_run_guard_blocks_provider_even_if_called(self):
        graph_calls = []
        mock.patch.object(server, 'provider_send', server.__dict__['provider_send']).stop() if False else None
        self.p3.stop()                                     # use the real provider_send, recording graph()
        with mock.patch.object(server, 'graph', lambda *a, **k: graph_calls.append(a) or {}):
            token = server._DRY.set(True)
            try:
                with self.assertRaises(RuntimeError): server.provider_send({'to': 'x'})
            finally: server._DRY.reset(token)
            self.farq([{'poi_key': 's_open', 'message': 'x'}], dry_run=True); server.send_template({'poi_key': 's_open', 'message': 'x', 'dry_run': True})
        self.assertEqual(graph_calls, [])
        self.p3.start()

@unittest.skipUnless(PATCHED, 'policy module exists only in the patched code')
class T1_Classification(Base):
    def test_1_all_closed_variants(self):
        import status_policy as sp
        for v in ['Permanently Closed', 'permanently closed', 'permanently_closed', '  Permanently   Closed ', 'Closed', 'cancelled', 'ملغى', 'ملغي']:
            self.assertEqual(sp.normalize(v)['status_normalized'], 'closed_permanent', v)
        for lc in ['closed', 'permanently_closed', 'Permanently Closed']:
            self.assertEqual(sp.normalize('open', lc)['status_normalized'], 'closed_permanent', lc)
        for v in ['Temporarily Closed', 'temporary closed', 'temporarily_closed']: self.assertEqual(sp.normalize(v)['status_normalized'], 'closed_temporary')
        for v in ['Inactive', 'INACTIVE', 'inactive ']: self.assertEqual(sp.normalize(v)['status_normalized'], 'inactive')
    def test_1b_sql_matches_python(self):
        import status_policy as sp, duckdb
        rows = duckdb.connect().execute(f"select poi_key, company_status, lifecycle_state, {sp.CLASS_SQL} from '{CODE}/data/targets.parquet'").fetchall()
        for k, cs, lc, sql_cls in rows: self.assertEqual(sql_cls, sp.normalize(cs, lc)['status_normalized'], k)
    def test_2_3_unknown_and_unresolved_never_eligible(self):
        import status_policy as sp, duckdb
        rows = duckdb.connect().execute(f"select * from '{CODE}/data/targets.parquet'").fetchdf().to_dict('records') if False else None
        con = duckdb.connect(); cur = con.execute(f"select * from '{CODE}/data/targets.parquet'"); cols = [d[0] for d in cur.description]
        recs = {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}
        for k in ['s_open_draft', 's_open_archived', 's_open_ready', 's_hidden', 's_null', 's_invalid', 's_numeric', 't_1', 'i_1', 'c_pc1', 'c_lc1']:
            ok, why = sp.send_decision(recs[k]); self.assertFalse(ok, f'{k} {why}')
        self.assertTrue(sp.send_decision(recs['s_open'])[0])
    def test_7_flag_is_not_verification(self):
        import status_policy as sp
        self.assertEqual(sp.whatsapp_state({'has_whatsapp': True}), 'source_flag_unverified')
        with mock.patch.object(sp, 'REQUIRE_VERIFIED_WHATSAPP', True):
            ok, why = sp.send_decision({'company_status': 'open', 'has_whatsapp': True, 'phone_norm': '+966500000001'})
        self.assertFalse(ok); self.assertEqual(why, 'whatsapp:source_flag_unverified')

class T2_SendPaths(Base):
    def test_4_request_number_is_never_used(self):
        self.farq([{'poi_key': 's_open', 'whatsapp': '966511111111', 'name_ar': 'X', 'message': 'hi'}])
        self.assertNotIn('966511111111', self.recipients())
        self.assertEqual(self.recipients(), ['966500000001'])
    def test_5_missing_duplicate_ambiguous_rejected(self):
        out = self.farq([{'poi_key': 'nope', 'whatsapp': '966511111111'}, {'poi_key': 'dupkey', 'whatsapp': '966500000026'},
                         {'poi_key': 's_open', 'message': 'a'}, {'poi_key': 's_open', 'message': 'b'}, {'poi_key': "x' or 1=1 --"}])
        errs = {f['poi_key']: f['error'] for f in out['failed']}
        self.assertEqual(errs.get('nope'), 'NOT_IN_DIRECTORY'); self.assertEqual(errs.get('dupkey'), 'AMBIGUOUS_KEY')
        self.assertEqual(errs.get('s_open'), 'DUPLICATE_IN_REQUEST'); self.assertEqual(self.recipients(), ['966500000001'])
    def test_6_ineligible_rejected_before_provider(self):
        bad = ['c_pc1', 'c_pc3', 'c_pc7', 'c_lc2', 't_1', 'i_2', 's_hidden', 's_null', 's_invalid', 's_open_draft', 's_open_archived', 's_nowa', 's_badmobile']
        out = self.farq([{'poi_key': k, 'whatsapp': '966500000099', 'message': 'x'} for k in bad])
        self.assertEqual(self.sent, [], out)
    def test_8_send_template_same_policy(self):
        r1 = server.send_template({'poi_key': 'c_pc1', 'to': '966511111111', 'message': 'x'})
        r2 = server.send_template({'to': '966511111111', 'message': 'x'})
        r3 = server.send_template({'poi_key': 's_open', 'to': '966511111111', 'message': 'x'})
        self.assertFalse(r1['ok']); self.assertFalse(r2['ok'])
        self.assertEqual(self.recipients(), ['966500000001'])
    def test_8b_registration_uses_directory_contacts(self):
        pg = FakePG()
        with mock.patch.object(server, 'pg', lambda: pg):
            out = self.farq([{'poi_key': 'c_pc1', 'whatsapp': '966511111111'}, {'poi_key': 's_open', 'whatsapp': '966511111111'}], mode=None)
        self.assertEqual(out['added'], 1, out)
    def test_dry_run_never_calls_provider(self):
        out = self.farq([{'poi_key': 's_open', 'message': 'x'}], dry_run=True)
        self.assertEqual(self.sent, []); self.assertEqual(out['eligible'], ['s_open'])
        self.assertTrue(server.send_template({'poi_key': 's_open', 'message': 'x', 'dry_run': True})['ok']); self.assertEqual(self.sent, [])
    def test_toc_status_changes_between_register_and_send(self):
        path = CODE / 'data' / 'targets.parquet'; backup = path.with_suffix('.bak'); shutil.copy(path, backup)
        try:
            self.farq([{'poi_key': 's_open'}], mode=None)
            make_fixture.build(str(path), closed_key='s_open')          # status changes after selection
            out = self.farq([{'poi_key': 's_open', 'message': 'x'}])
            self.assertEqual(self.sent, [], out)
        finally: shutil.move(backup, path)

class T3_LogsAndConsistency(Base):
    def test_9_logs_hold_no_full_numbers(self):
        self.farq([{'poi_key': 's_open', 'message': 'x'}]); server.send_template({'poi_key': 's_open', 'message': 'x'})
        srv = server.ThreadingHTTPServer(('127.0.0.1', 0), server.H); th = threading.Thread(target=srv.serve_forever, daemon=True); th.start()
        try:
            c = http.client.HTTPConnection('127.0.0.1', srv.server_address[1], timeout=5)
            c.request('POST', '/log', json.dumps({'poi_key': 's_open', 'channel': 'wa', 'to': '+966500000001', 'message': 'm'}), {'content-type': 'application/json'}); c.getresponse().read()
            c.request('GET', '/log'); body = c.getresponse().read().decode()
        finally: srv.shutdown()
        self.assertNotRegex(body, FULL_NUMBER)
        for f in glob.glob(str(CODE / 'data' / '*.jsonl')) + glob.glob(str(CODE / 'data' / '*.csv')):
            self.assertNotRegex(open(f, encoding='utf-8').read(), FULL_NUMBER, f)
    def test_10_only_permanently_closed_leave_search_and_map(self):
        res = server.TRIAL_DIRECTORY.search('سباكة', 'Riyadh', 'purchase', 200, 0)
        shown = {r.get('poi_key') or r.get('name_ar') for r in res.get('_map_rows', res['rows'])}
        browse = server.TILES.browse('Riyadh', None, 200, 0); bkeys = {r['poi_key'] for r in browse['rows']}
        closed = {k for k, cs, lc, *_ in make_fixture.ROWS if k.startswith('c_')}
        self.assertFalse(closed & bkeys, 'permanently closed shown on map/browse')
        for k in ['t_1', 'i_1', 's_hidden', 's_null', 's_open_draft', 's_open_archived', 's_open']: self.assertIn(k, bkeys, k)

@unittest.skipUnless(PATCHED, 'patched only')
class T4_StatusLabels(Base):
    def test_rows_carry_class_not_raw_status(self):
        b = {r['poi_key']: r for r in server.TILES.browse('Riyadh', None, 200, 0)['rows']}
        self.assertEqual(b['t_1']['status_class'], 'closed_temporary'); self.assertEqual(b['i_1']['status_class'], 'inactive')
        self.assertEqual(b['s_open']['status_class'], 'open')
        self.assertTrue(all('company_status' not in r and 'lifecycle_state' not in r for r in b.values()))
        s = server.TRIAL_DIRECTORY.search('سباكة', 'Riyadh', 'purchase', 200, 0)
        rows = s.get('_map_rows', s['rows'])
        self.assertTrue(rows and all('status_class' in r and 'company_status' not in r for r in rows))

@unittest.skipUnless(PATCHED and hasattr(server, 'SESSIONS'), 'session code only in patched')
class T5_Sessions(unittest.TestCase):
    def setUp(self):
        mock.patch.object(server, 'AUTH_PASSWORD', 'pw-test-only').start(); server.SESSIONS.clear(); server.LOGIN_ATTEMPTS.clear()
        self.srv = server.ThreadingHTTPServer(('127.0.0.1', 0), server.H); threading.Thread(target=self.srv.serve_forever, daemon=True).start()
    def tearDown(self): self.srv.shutdown(); self.srv.server_close(); mock.patch.stopall()
    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.srv.server_address[1], timeout=5)
        c.request(method, path, body, headers or {}); r = c.getresponse(); data = r.read(); c.close(); return r, data
    def login(self, pw='pw-test-only', ip='1.1.1.1'):
        r, _ = self.req('POST', '/login', 'p=' + pw, {'content-type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': ip}); return r
    def sid_of(self, r):
        for v in r.headers.get_all('Set-Cookie') or []:
            if v.startswith('ft_session=') and 'Max-Age=0' not in v: return v.split(';')[0].split('=', 1)[1], v
        return None, None
    def test_login_sets_strict_secure_session(self):
        sid, raw = self.sid_of(self.login())
        self.assertTrue(sid and len(sid) > 30)
        for flag in ('HttpOnly', 'Secure', 'SameSite=Strict'): self.assertIn(flag, raw)
        r, _ = self.req('GET', '/status', headers={'Cookie': f'ft_session={sid}'}); self.assertIn(b'pois', _)
    def test_wrong_password_no_session_and_rate_limit(self):
        for i in range(5): self.assertIsNone(self.sid_of(self.login('nope', ip='9.9.9.9'))[0])
        r = self.login('pw-test-only', ip='9.9.9.9'); self.assertEqual(r.status, 429)
        self.assertIsNotNone(self.sid_of(self.login(ip='8.8.8.8'))[0])      # other clients unaffected
    def test_legacy_cookie_and_substring_tricks_rejected(self):
        import hashlib
        legacy = hashlib.sha256(b'pw-test-only').hexdigest()[:32]
        for cookie in (f'ft_auth={legacy}', f'x=ft_session=abc', 'ft_session=', 'ft_session=forged'):
            r, data = self.req('POST', '/send-farq', '{}', {'Cookie': cookie, 'content-type': 'application/json'}); self.assertEqual(r.status, 401, cookie)
    def test_service_header(self):
        r, _ = self.req('POST', '/search', json.dumps({'q': 'سباكة', 'city': 'Riyadh', 'objective': 'purchase', 'limit': 2}), {'X-Farq-Service': server.service_token(), 'content-type': 'application/json'}); self.assertEqual(r.status, 200)
        r, _ = self.req('POST', '/search', '{}', {'X-Farq-Service': 'wrong', 'content-type': 'application/json'}); self.assertEqual(r.status, 401)
        r, _ = self.req('POST', '/search', '{}', {'X-Farq-Service': 'wr\xe9ng', 'content-type': 'application/json'}); self.assertEqual(r.status, 401)
        import hashlib; self.assertNotEqual(server.service_token(), hashlib.sha256(b'pw-test-only').hexdigest()[:32])
        with mock.patch.dict(os.environ, {'TARGETING_SERVICE_TOKEN': 'separate-token'}): self.assertEqual(server.service_token(), 'separate-token')
    def test_logout_and_expiry(self):
        sid, _ = self.sid_of(self.login())
        self.req('GET', '/logout', headers={'Cookie': f'ft_session={sid}'})
        r, _ = self.req('POST', '/send-farq', '{}', {'Cookie': f'ft_session={sid}'}); self.assertEqual(r.status, 401)
        sid2, _ = self.sid_of(self.login())
        self.assertTrue(server.session_ok(sid2)); import time as _t
        self.assertFalse(server.session_ok(sid2, now=_t.time() + server.SESSION_IDLE + 1))
    def test_production_never_open_without_password(self):
        with mock.patch.object(server, 'AUTH_PASSWORD', None), mock.patch.dict(os.environ, {'RAILWAY_ENVIRONMENT': 'production'}):
            r, _ = self.req('POST', '/send-farq', '{}'); self.assertEqual(r.status, 401)

@unittest.skipUnless(PATCHED, 'patched only')
class T6_OwnerDecision(unittest.TestCase):
    """«أي محل متحقق من واتساب حقه، مفتوح أو مغلق مؤقتاً»"""
    def row(self, status, verified=True, lifecycle=None):
        r = {'company_status': status, 'lifecycle_state': lifecycle, 'has_whatsapp': True, 'phone_norm': '+966500000001'}
        if verified: r.update(whatsapp_verified_at='2026-10-15', whatsapp_verification_source='check')
        return r
    def test_decision(self):
        import status_policy as sp
        for st in ('open', 'Active', 'Temporarily Closed', 'temporary closed'):
            for lc in (None, 'draft', 'archived', 'ready to publish'):
                self.assertTrue(sp.send_decision(self.row(st, lifecycle=lc))[0], (st, lc))
        for st in ('Permanently Closed', 'Inactive', 'hidden', None, 'مؤسسة'):
            self.assertFalse(sp.send_decision(self.row(st))[0], st)
        self.assertEqual(sp.send_decision(self.row('open', verified=False)), (False, 'whatsapp:source_flag_unverified'))

if __name__ == '__main__': unittest.main()
