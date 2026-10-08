# -*- coding: utf-8 -*-
"""فرق تسعير — hosts the built app (dist/) behind a site password and proxies /_api/* to the Farq API
(same origin, so the browser needs no CORS). Nothing is cached; every API call carries the user's own
Authorization header from the Farq login, so the API still decides what this person may see."""
import os, json, hashlib, urllib.request, urllib.parse, mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__)); DIST = os.path.join(HERE, 'dist')
PORT = int(os.environ.get('PORT', '8080')); PASSWORD = os.environ.get('PRICING_PASSWORD', '')
API = os.environ.get('FARQ_API_ORIGIN', 'https://api.farq.sa').rstrip('/')
TOKEN = hashlib.sha256(PASSWORD.encode()).hexdigest()[:32] if PASSWORD else ''
LOGIN = '''<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>فرق تسعير</title>
<body style="font-family:Tahoma,sans-serif;background:#f7f7f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<form method="post" action="/__gate" style="background:#fff;padding:28px;border-radius:16px;border:1px solid #e6e6e2;min-width:300px"><h2 style="margin:0 0 14px">فرق تسعير</h2>
<input name="p" type="password" placeholder="كلمة مرور الصفحة" style="width:100%;padding:10px;border-radius:12px;border:1px solid #e6e6e2;font-size:15px" autofocus>
<button style="margin-top:12px;width:100%;padding:10px;border-radius:12px;border:0;background:#121212;color:#fff;font-size:15px">دخول</button></form></body></html>'''
HOP = {'connection', 'keep-alive', 'transfer-encoding', 'host', 'content-length', 'accept-encoding'}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _authed(self): return not TOKEN or f'fp_gate={TOKEN}' in (self.headers.get('Cookie') or '')
    def _send(self, code, body, ctype='text/html; charset=utf-8', extra=None):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or []): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def _proxy(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else None
        path = self.path[len('/_api'):] or '/'
        req = urllib.request.Request(API + path, data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in HOP and k.lower() != 'cookie': req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=60) as r: status, hdrs, data = r.status, r.headers, r.read()
        except urllib.error.HTTPError as e: status, hdrs, data = e.code, e.headers, e.read()
        except Exception as e: self._send(502, json.dumps({'error': 'UPSTREAM', 'detail': str(e)[:200]}).encode(), 'application/json'); return
        self.send_response(status)
        for k, v in hdrs.items():
            if k.lower() in HOP or k.lower() == 'content-encoding': continue
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if self.path.startswith('/_api/'): return self._proxy() if self._authed() else self._send(401, b'{"error":"gate"}', 'application/json')
        if not self._authed(): return self._send(200, LOGIN.encode())
        p = urllib.parse.urlparse(self.path).path
        f = os.path.normpath(os.path.join(DIST, p.lstrip('/')))
        if not f.startswith(DIST) or not os.path.isfile(f): f = os.path.join(DIST, 'index.html')
        ctype = mimetypes.guess_type(f)[0] or 'application/octet-stream'
        with open(f, 'rb') as fh: data = fh.read()
        self._send(200, data, ctype if 'text' not in ctype else ctype + '; charset=utf-8')
    def do_POST(self):
        if self.path == '/__gate':
            n = int(self.headers.get('Content-Length') or 0); p = urllib.parse.parse_qs(self.rfile.read(n).decode()).get('p', [''])[0]
            self.send_response(303); self.send_header('Location', '/')
            if PASSWORD and p == PASSWORD: self.send_header('Set-Cookie', f'fp_gate={TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000')
            self.end_headers(); return
        if self.path.startswith('/_api/'): return self._proxy() if self._authed() else self._send(401, b'{"error":"gate"}', 'application/json')
        self._send(404, b'')
    do_PUT = do_PATCH = do_DELETE = do_POST

if __name__ == '__main__':
    print(f'farq-pricing on :{PORT} -> {API} (gate: {"on" if PASSWORD else "OFF"})', flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
