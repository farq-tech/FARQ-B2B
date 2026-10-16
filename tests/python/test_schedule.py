# -*- coding: utf-8 -*-
"""Scheduled sends (schedule.py): validation, prayer shift, idempotency, cancel, flag off.
The proxy's handler on an ephemeral port, a fake targeting service, and a throwaway local Postgres cluster (initdb).
Run: python3 -m unittest discover -s tests/python -v"""
import json, os, shutil, socket, subprocess, sys, tempfile, threading, time, unittest, urllib.error, urllib.request
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
import saudi_rhythm as sr  # noqa: E402
import schedule  # noqa: E402
import server  # noqa: E402

RIYADH = sr.CITIES['riyadh']
DAY = date(2026, 10, 20)  # Tuesday
P = sr.prayer_times(DAY, *RIYADH)
CLEAR = P['dhuhr'] + timedelta(hours=1, minutes=10)  # between dhuhr + 25 and asr
NOW = P['dhuhr'] - timedelta(hours=3)                  # the clock when scheduling
HOLDER = '11111111-2222-3333-4444-555555555555'
TEMPLATES = [
    {'name': 'farq_outreach_ar', 'status': 'APPROVED', 'language': 'ar', 'components': [{'type': 'BODY', 'text': 'مرحبا {{1}}، {{2}}'}]},
    {'name': 'one_var', 'status': 'APPROVED', 'language': 'ar', 'components': [{'type': 'BODY', 'text': 'مرحبا {{1}}'}]},
    {'name': 'pending_tpl', 'status': 'PENDING', 'language': 'ar', 'components': [{'type': 'BODY', 'text': '{{1}} {{2}}'}]},
]


class Upstream(BaseHTTPRequestHandler):
    """The targeting service: dry run says keys starting 'bad' are not eligible; template mode 'sends' every key."""
    calls = []
    def log_message(self, *a): pass
    def _j(self, obj):
        out = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)
    def do_GET(self):
        if self.path == '/templates': return self._j({'ok': True, 'data': TEMPLATES})
        if self.path == '/template-status': return self._j({'name': 'farq_outreach_ar', 'status': 'APPROVED', 'holder': {'holder_rfq_id': HOLDER}})
        self._j({})
    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        keys = [t['poi_key'] for t in b.get('targets') or []]
        assert all(set(t) <= {'poi_key', 'city', 'message'} for t in b['targets']), 'no number, name or email ever sent'
        kind = 'dry' if b.get('dry_run') else 'register' if b.get('dispatch') is False else 'template'
        Upstream.calls.append((kind, keys))
        if kind == 'dry': return self._j({'ok': True, 'dry_run': True, 'eligible': [k for k in keys if not k.startswith('bad')],
                                          'failed': [{'poi_key': k, 'error': 'NOT_ELIGIBLE:no_verified_whatsapp'} for k in keys if k.startswith('bad')]})
        if kind == 'register': return self._j({'ok': True, 'added': len(keys)})
        return self._j({'ok': True, 'sent': [{'poi_key': k, 'message_id': 'wamid.' + k} for k in keys if not k.startswith('fail')],
                        'failed': [{'poi_key': k, 'error': 'META_131026'} for k in keys if k.startswith('fail')]})


def serve(handler):
    s = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def free_port():
    with socket.socket() as s: s.bind(('127.0.0.1', 0)); return s.getsockname()[1]


PG_BIN = next((d for d in ('/opt/homebrew/opt/postgresql@16/bin', '/opt/homebrew/bin', '/usr/lib/postgresql/16/bin', '/usr/local/bin')
               if os.path.exists(os.path.join(d, 'initdb')) and os.path.exists(os.path.join(d, 'pg_ctl'))), None) or (os.path.dirname(shutil.which('initdb')) if shutil.which('initdb') else None)


class FlagOff(unittest.TestCase):
    """Flag off: every schedule route is 404 (the screen shows «الجدولة قريباً»), before any login check."""
    def test_routes_404(self):
        proxy = serve(server.H)
        base = f'http://127.0.0.1:{proxy.server_port}'
        try:
            with mock.patch.object(schedule, 'ENABLED', False):
                for method, path in (('GET', '/api/targeting/schedule'), ('POST', '/api/targeting/schedule'),
                                     ('POST', '/api/targeting/schedule/11111111-2222-3333-4444-555555555555/cancel')):
                    req = urllib.request.Request(base + path, data=b'{}' if method == 'POST' else None, method=method)
                    with self.assertRaises(urllib.error.HTTPError) as e: urllib.request.urlopen(req, timeout=10)
                    self.assertEqual(e.exception.code, 404)
                    self.assertEqual(json.loads(e.exception.read()), {'error': 'not_found'})
        finally: proxy.shutdown()

    def test_runner_not_started(self):
        with mock.patch.object(schedule, 'ENABLED', False), mock.patch.object(schedule, 'DB_URL', 'postgresql://x'):
            self.assertIsNone(schedule.start(server))


@unittest.skipUnless(PG_BIN, 'needs a local Postgres (initdb / pg_ctl)')
class Schedule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='sched-pg-')
        port = free_port()
        subprocess.run([os.path.join(PG_BIN, 'initdb'), '-D', cls.tmp + '/d', '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], check=True, capture_output=True)
        subprocess.run([os.path.join(PG_BIN, 'pg_ctl'), '-D', cls.tmp + '/d', '-o', f'-p {port} -k {cls.tmp} -c listen_addresses=127.0.0.1', '-l', cls.tmp + '/log', '-w', 'start'], check=True, capture_output=True)
        cls.dsn = f'postgresql://postgres@127.0.0.1:{port}/postgres'
        cls.up, cls.proxy = serve(Upstream), serve(server.H)
        cls.base = f'http://127.0.0.1:{cls.proxy.server_port}'
        cls.user = {'id': 'u-1', 'email': 'abdulrhman@farq.sa'}
        def authed(h): h._user = dict(cls.user); return True
        cls.patches = [mock.patch.object(server, 'TARGETING', f'http://127.0.0.1:{cls.up.server_port}'),
                       mock.patch.object(server.H, '_authed', authed),
                       mock.patch.object(schedule, 'ENABLED', True), mock.patch.object(schedule, 'DB_URL', cls.dsn),
                       mock.patch.object(schedule, '_org_of', lambda srv, h: 'org-1')]
        for p in cls.patches: p.start()

    @classmethod
    def tearDownClass(cls):
        for p in cls.patches: p.stop()
        cls.up.shutdown(); cls.proxy.shutdown()
        subprocess.run([os.path.join(PG_BIN, 'pg_ctl'), '-D', cls.tmp + '/d', '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        Upstream.calls.clear()
        self.user.update(id='u-1')
        with schedule.connect() as c:
            c.execute('truncate pricing_schedule.recipients, pricing_schedule.campaigns'); c.commit()

    def req(self, method, path, body=None, now=NOW, send=True):
        r = urllib.request.Request(self.base + path, data=json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None, method=method,
                                   headers={'Content-Type': 'application/json'})
        with mock.patch.object(server, 'TARGETING_SEND', send), mock.patch.object(sr, 'now_utc', lambda: now):
            try:
                with urllib.request.urlopen(r, timeout=20) as x: return x.status, json.loads(x.read())
            except urllib.error.HTTPError as e: return e.code, json.loads(e.read())

    def schedule(self, keys=('p:1', 'p:2'), at=CLEAR, **kw):
        return self.req('POST', '/api/targeting/schedule', {'keys': list(keys), 'message': 'عندنا طلب حديد', 'template': 'farq_outreach_ar',
                                                            'send_at': sr._iso(at), 'cities': ['Riyadh'], **kw})

    def tick(self, now, send=True):
        with mock.patch.object(server, 'TARGETING_SEND', send), mock.patch.object(sr, 'now_utc', lambda: now): schedule.tick(server)

    def rows(self):
        with schedule.connect() as c:
            camp = c.execute('select id, status, send_at, user_id, user_email, org_id, keys from pricing_schedule.campaigns').fetchall()
            rec = dict(c.execute('select poi_key, status from pricing_schedule.recipients').fetchall())
        return camp, rec

    def template_sends(self): return [k for kind, ks in Upstream.calls if kind == 'template' for k in ks]

    # ---- validation
    def test_validation(self):
        bad = [({'keys': []}, 400, 'KEYS_REQUIRED'), ({'keys': ['p:1', 'p:1']}, 400, 'KEYS_INVALID'), ({'keys': ['bad key!']}, 400, 'KEYS_INVALID'),
               ({'message': '  '}, 400, 'EMPTY_MESSAGE'), ({'send_at': '2026-10-20T12:00:00'}, 400, 'SEND_AT_INVALID'),
               ({'send_at': sr._iso(NOW - timedelta(minutes=1))}, 400, 'SEND_AT_PAST'), ({'send_at': sr._iso(NOW + timedelta(days=31))}, 400, 'SEND_AT_TOO_FAR'),
               ({'template': 'one_var'}, 422, 'TEMPLATE_NOT_USABLE'), ({'template': 'pending_tpl'}, 422, 'TEMPLATE_NOT_USABLE'),
               ({'template': 'nope'}, 422, 'TEMPLATE_NOT_FOUND'), ({'keys': ['bad:1', 'bad:2']}, 422, 'NO_ELIGIBLE_RECIPIENTS')]
        for override, code, err in bad:
            body = {'keys': ['p:1'], 'message': 'نص', 'template': 'farq_outreach_ar', 'send_at': sr._iso(CLEAR), **override}
            got = self.req('POST', '/api/targeting/schedule', body)
            self.assertEqual((got[0], got[1].get('error')), (code, err), override)
        self.assertEqual(self.req('POST', '/api/targeting/schedule', {'keys': ['p:1'], 'message': 'x', 'template': 'farq_outreach_ar', 'send_at': sr._iso(CLEAR)}, send=False)[1]['error'], 'SEND_DISABLED')
        self.assertEqual(self.rows()[0], [])  # nothing stored
        self.assertNotIn('template', [k for k, _ in Upstream.calls]); self.assertNotIn('register', [k for k, _ in Upstream.calls])

    def test_stores_eligible_keys_with_owner_identity(self):
        code, j = self.schedule(keys=('p:1', 'bad:9', 'p:2'))
        self.assertEqual(code, 201)
        self.assertEqual((j['status'], j['shifted'], j['eligible'], j['send_at']), ('scheduled', False, 2, sr._iso(CLEAR)))
        self.assertEqual(j['rejected'], {'bad:9': 'NOT_ELIGIBLE:no_verified_whatsapp'})
        (cid, st, _, uid, email, org, keys), = self.rows()[0]
        self.assertEqual((st, uid, email, org, keys), ('scheduled', 'u-1', 'abdulrhman@farq.sa', 'org-1', ['p:1', 'p:2']))
        self.assertEqual(self.template_sends(), [])  # scheduling sends nothing

    # ---- prayer shift
    def test_prayer_shift_on_schedule(self):
        code, j = self.schedule(at=P['asr'] + timedelta(minutes=5, seconds=30))
        self.assertEqual(code, 201)
        self.assertTrue(j['shifted'])
        self.assertEqual((j['prayer'], j['send_at']), ('asr', sr._iso(P['asr'] + timedelta(minutes=25))))
        self.assertIn('صلاة العصر', j['message_ar']); self.assertIn(j['send_at_ar'], j['message_ar'])

    def test_friday_shift(self):
        fri = datetime(2026, 10, 23, 12, 0, tzinfo=sr.KSA).astimezone(sr.UTC)
        code, j = self.schedule(at=fri)
        self.assertEqual((code, j['prayer'], j['send_at_ar']), (201, 'jumuah', '1:30 م'))

    def test_runner_rechecks_prayer(self):
        self.schedule(at=P['asr'] - timedelta(minutes=1))           # allowed when scheduled
        self.tick(P['asr'] + timedelta(minutes=2))                  # runner late: now inside asr
        camp, rec = self.rows()
        self.assertEqual((camp[0][1], camp[0][2]), ('scheduled', P['asr'] + timedelta(minutes=25)))
        self.assertEqual((rec, self.template_sends()), ({}, []))
        self.tick(P['asr'] + timedelta(minutes=25))
        self.assertEqual(self.rows()[0][0][1], 'sent'); self.assertEqual(sorted(self.template_sends()), ['p:1', 'p:2'])

    # ---- runner, idempotency
    def test_runner_sends_once(self):
        self.schedule(keys=('p:1', 'p:2', 'fail:3'))
        self.tick(CLEAR - timedelta(minutes=1))                     # not due yet
        self.assertEqual(self.template_sends(), [])
        self.tick(CLEAR); self.tick(CLEAR + timedelta(minutes=1)); self.tick(CLEAR + timedelta(hours=1))
        camp, rec = self.rows()
        self.assertEqual(camp[0][1], 'partial')
        self.assertEqual(rec, {'p:1': 'sent', 'p:2': 'sent', 'fail:3': 'failed'})
        self.assertEqual(sorted(self.template_sends()), ['fail:3', 'p:1', 'p:2'])   # each key once
        self.assertEqual([k for k, _ in Upstream.calls], ['dry', 'dry', 'register', 'template'])  # schedule dry, run dry, then as the screen

    def test_runner_eligibility_recheck(self):
        self.schedule(keys=('p:1', 'p:2'))
        with schedule.connect() as c:  # p:2 lost its eligibility since (simulated by renaming it to a 'bad' key)
            c.execute("""update pricing_schedule.campaigns set keys='["p:1","bad:2"]'"""); c.commit()
        self.tick(CLEAR)
        self.assertEqual(self.rows()[1], {'p:1': 'sent', 'bad:2': 'skipped'}); self.assertEqual(self.template_sends(), ['p:1'])

    def test_restart_never_resends(self):
        self.schedule(keys=('p:1', 'p:2', 'p:3'))
        with schedule.connect() as c:  # a runner died mid-chunk: p:1 sent, p:2 in flight, then the container restarted
            cid = c.execute('select id from pricing_schedule.campaigns').fetchone()[0]
            c.execute("update pricing_schedule.campaigns set status='running', heartbeat_at=%s, attempts=1", (CLEAR - timedelta(minutes=30),))
            c.execute("insert into pricing_schedule.recipients (campaign_id, poi_key, status) values (%s,'p:1','sent'), (%s,'p:2','sending')", (cid, cid)); c.commit()
        self.tick(CLEAR - timedelta(minutes=5))                     # heartbeat 15 min old: recovered, then finished
        camp, rec = self.rows()
        self.assertEqual(rec, {'p:1': 'sent', 'p:2': 'unknown', 'p:3': 'sent'})
        self.assertEqual(self.template_sends(), ['p:3'])
        self.assertEqual(camp[0][1], 'partial')
        self.tick(CLEAR + timedelta(hours=2)); self.assertEqual(self.template_sends(), ['p:3'])

    def test_fresh_running_job_not_taken(self):
        self.schedule()
        with schedule.connect() as c:  # another replica is working on it right now
            c.execute("update pricing_schedule.campaigns set status='running', heartbeat_at=%s", (CLEAR,)); c.commit()
        self.tick(CLEAR + timedelta(minutes=1))
        self.assertEqual((self.rows()[0][0][1], self.template_sends()), ('running', []))

    def test_send_switch_off_at_run_time(self):
        self.schedule()
        self.tick(CLEAR, send=False)
        self.assertEqual((self.rows()[0][0][1], self.template_sends()), ('failed', []))

    # ---- list, cancel
    def test_cancel_and_list(self):
        _, a = self.schedule(); _, b = self.schedule(at=CLEAR + timedelta(hours=1))
        self.assertEqual(self.req('POST', f"/api/targeting/schedule/{a['id']}/cancel"), (200, {'ok': True, 'id': a['id'], 'status': 'cancelled'}))
        self.assertEqual(self.req('POST', f"/api/targeting/schedule/{a['id']}/cancel")[1]['error'], 'NOT_CANCELLABLE')
        self.user.update(id='u-2')
        self.assertEqual(self.req('POST', f"/api/targeting/schedule/{b['id']}/cancel")[0], 404)   # not someone else's
        self.assertEqual(self.req('GET', '/api/targeting/schedule')[1]['data'], [])
        self.user.update(id='u-1')
        code, j = self.req('GET', '/api/targeting/schedule')
        self.assertEqual({x['id']: x['status'] for x in j['data']}, {a['id']: 'cancelled', b['id']: 'scheduled'})  # cancelled stays recorded
        self.tick(CLEAR + timedelta(hours=2))
        self.assertEqual(sorted(self.template_sends()), ['p:1', 'p:2'])  # only b
        self.assertEqual(self.req('POST', f"/api/targeting/schedule/{b['id']}/cancel")[1], {'ok': False, 'error': 'NOT_CANCELLABLE', 'status': 'sent'})
        self.assertEqual(self.req('DELETE', f"/api/targeting/schedule/{b['id']}")[0], 404)  # no delete

    def test_store_missing(self):
        with mock.patch.object(schedule, 'DB_URL', ''):
            self.assertEqual(self.req('GET', '/api/targeting/schedule'), (503, {'ok': False, 'error': 'STORE_NOT_CONFIGURED'}))


if __name__ == '__main__':
    unittest.main()
