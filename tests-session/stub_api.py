# -*- coding: utf-8 -*-
"""A fake Farq API (and targeting service) for the session tests: single-use rotating refresh tokens with reuse
detection like api/lib/auth/tokens.js, access tokens that can be revoked, and a record of every Authorization header.
Run: python3 tests-session/stub_api.py PORT"""
import json, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

USER = {'id': 'u-1', 'email': 'abdulrhman@farq.sa', 'email_verified': True, 'display_name': 'عبدالرحمن'}
S = {'n': 0, 'access': set(), 'refresh': None, 'spent': set(), 'seen': [], 'events': []}
L = threading.Lock()


def issue():
    S['n'] += 1
    a, r = f'acc-{S["n"]}', f'ref-{S["n"]}'
    S['access'].add(a); S['refresh'] = r
    return {'access_token': a, 'refresh_token': r, 'expires_in': 3600, 'user': USER}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def out(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        try: return json.loads(self.rfile.read(n) or b'{}') if n else {}
        except Exception: return {}
    def handle_any(self):
        p = self.path.split('?')[0]; b = self.body() if self.command in ('POST', 'PUT') else {}
        auth = self.headers.get('Authorization', '')
        with L:
            if p == '/__stub/state': return self.out(200, {k: (sorted(v) if isinstance(v, set) else v) for k, v in S.items()})
            if p == '/__stub/revoke-access': S['access'].clear(); return self.out(200, {'ok': True})
            if p == '/__stub/reset':
                S.update(n=0, access=set(), refresh=None, spent=set(), seen=[], events=[]); return self.out(200, {'ok': True})
            S['seen'].append([self.command, p, auth])
            if p == '/api/auth/login':
                if b.get('password') != 'right': return self.out(401, {'ok': False, 'errors': [{'code': 'INVALID_CREDENTIALS', 'message': 'البريد أو كلمة المرور غير صحيحة.'}]})
                S['events'].append('login'); return self.out(200, {'ok': True, 'data': issue()})
            if p == '/api/auth/refresh':
                r = b.get('refresh_token')
                if r in S['spent']:  # reuse: revoke the whole family
                    S['events'].append('reuse'); S['refresh'] = None; S['access'].clear(); return self.out(401, {'ok': False})
                if not r or r != S['refresh']: return self.out(401, {'ok': False})
                S['spent'].add(r); S['events'].append('refresh'); return self.out(200, {'ok': True, 'data': issue()})
            if p == '/api/auth/logout':
                S['events'].append('logout:' + str(b.get('refresh_token') or b.get('scope')))
                if b.get('refresh_token') == S['refresh']: S['refresh'] = None
                return self.out(200, {'ok': True})
            ok = auth.startswith('Bearer ') and auth[7:] in S['access']
            if p == '/api/auth/me': return self.out(200, {'ok': True, 'data': {'user': USER}}) if ok else self.out(401, {'ok': False})
            if p.startswith('/api/'):
                return self.out(200, {'ok': True, 'data': {}}) if ok else self.out(401, {'ok': False, 'errors': [{'code': 'CONSTRUCTION_AUTH_REQUIRED'}]})
            # targeting service paths
            if p == '/cities': return self.out(200, [{'en': 'Riyadh', 'ar': 'الرياض', 'n': 1}])
            return self.out(200, {'ok': True})
    do_GET = do_POST = do_PUT = do_DELETE = handle_any


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
