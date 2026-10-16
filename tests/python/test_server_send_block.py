# -*- coding: utf-8 -*-
"""server.py send path under the owner-approved prayer rule (2026-10-16): the proxy's handler H on an ephemeral port,
in front of a fake targeting service that records what reaches it. Run: python3 -m unittest discover -s tests/python -v"""
import json, os, sys, threading, unittest, urllib.error, urllib.request
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
import saudi_rhythm as sr  # noqa: E402
import server  # noqa: E402

RIYADH = sr.CITIES['riyadh']
ASR = sr.prayer_times(date(2026, 10, 15), *RIYADH)['asr']  # Thursday
FRIDAY_NOON = datetime(2026, 10, 16, 12, 0, tzinfo=sr.KSA).astimezone(sr.UTC)
BODY = json.dumps({'dispatch': False, 'targets': [{'city': 'Riyadh', 'phone': '9665'}], 'note': 'حملة'}, ensure_ascii=False).encode('utf-8')


class Upstream(BaseHTTPRequestHandler):
    seen = []
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        Upstream.seen.append((self.command, self.path, self.rfile.read(n) if n else b''))
        out = b'{"ok":true}'
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)
    do_GET = do_POST


def serve(handler):
    s = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


class SendBlock(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.up, cls.proxy = serve(Upstream), serve(server.H)
        cls.base = f'http://127.0.0.1:{cls.proxy.server_port}'
        cls.patches = [mock.patch.object(server, 'TARGETING', f'http://127.0.0.1:{cls.up.server_port}'),
                       mock.patch.object(server.H, '_authed', lambda self: True)]
        for p in cls.patches: p.start()

    @classmethod
    def tearDownClass(cls):
        for p in cls.patches: p.stop()
        cls.up.shutdown(); cls.proxy.shutdown()

    def setUp(self): Upstream.seen.clear()

    def post(self, path, body, now, send=True):
        req = urllib.request.Request(self.base + '/_targeting' + path, data=body, method='POST', headers={'Content-Type': 'application/json'})
        with mock.patch.object(server, 'TARGETING_SEND', send), mock.patch.object(sr, 'now_utc', lambda: now):
            try:
                with urllib.request.urlopen(req, timeout=10) as r: return r.status, r.read(), r.headers.get('Content-Type')
            except urllib.error.HTTPError as e: return e.code, e.read(), e.headers.get('Content-Type')

    def test_asr_window_blocked_not_forwarded(self):
        code, data, ctype = self.post('/send-farq', BODY, ASR + timedelta(minutes=5))
        self.assertEqual(code, 409)
        self.assertIn('application/json', ctype)
        j = json.loads(data.decode('utf-8'))
        self.assertEqual((j['ok'], j['error'], j['prayer']), (False, 'PRAYER_WINDOW', 'asr'))
        self.assertEqual(j['next_allowed'], sr._iso(ASR + timedelta(minutes=25)))
        self.assertEqual(j['message_ar'], f"الحين وقت صلاة العصر، فما أرسلنا الحملة. تقدر ترسلها من الساعة {j['next_allowed_ar']}.")
        self.assertIn('العصر'.encode('utf-8'), data)  # ensure_ascii=False: raw UTF-8, not \\u escapes
        self.assertEqual(Upstream.seen, [])

    def test_outside_window_forwarded_byte_identical(self):
        code, data, _ = self.post('/send-farq', BODY, ASR + timedelta(minutes=25))
        self.assertEqual((code, data), (200, b'{"ok":true}'))
        self.assertEqual(Upstream.seen, [('POST', '/send-farq', BODY)])

    def test_friday_prayer(self):
        code, data, _ = self.post('/send-farq', BODY, FRIDAY_NOON)
        self.assertEqual(code, 409)
        j = json.loads(data)
        self.assertEqual((j['prayer'], j['next_allowed_ar']), ('jumuah', '1:30 م'))
        self.assertEqual(Upstream.seen, [])

    def test_send_disabled_takes_precedence(self):
        for now in (ASR + timedelta(minutes=5), ASR + timedelta(minutes=40)):
            code, data, _ = self.post('/send-farq', BODY, now, send=False)
            self.assertEqual((code, data), (403, b'{"ok":false,"error":"SEND_DISABLED"}'))
        self.assertEqual(Upstream.seen, [])

    def test_read_paths_not_blocked(self):
        body = b'{"q":"x","city":"Riyadh"}'
        for send in (True, False):
            code, _, _ = self.post('/search', body, ASR + timedelta(minutes=5), send=send)
            self.assertEqual(code, 200)
        self.assertEqual(Upstream.seen, [('POST', '/search', body)] * 2)


if __name__ == '__main__':
    unittest.main()
