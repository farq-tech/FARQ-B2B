# -*- coding: utf-8 -*-
"""فرق تسعير — hosts the built app (dist/) behind a site password and proxies /_api/* to the Farq API
(same origin, so the browser needs no CORS). Nothing is cached; every API call carries the user's own
Authorization header from the Farq login, so the API still decides what this person may see.

Public without the password: the landing page at / (and /landing) and only the files it loads (computed from the Vite
manifest: index.html and its imports, minus the App chunk and everything only the app uses), plus
robots.txt, sitemap.xml and the favicon. Every app route, every app chunk and /_api/* stay behind the gate."""
import os, json, hashlib, html, urllib.request, urllib.parse, mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__)); DIST = os.path.join(HERE, 'dist')
PORT = int(os.environ.get('PORT', '8080')); PASSWORD = os.environ.get('PRICING_PASSWORD', '')
API = os.environ.get('FARQ_API_ORIGIN', 'https://api.farq.sa').rstrip('/')
TOKEN = hashlib.sha256(PASSWORD.encode()).hexdigest()[:32] if PASSWORD else ''
SITE_URL = os.environ.get('SITE_URL', '').rstrip('/')  # public origin for canonical / sitemap (unset: from the Host header)
LOGIN = '''<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>فرق تسعير</title>
<body style="font-family:Tahoma,sans-serif;background:#f7f7f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<form method="post" action="/__gate" style="background:#fff;padding:28px;border-radius:16px;border:1px solid #e6e6e2;min-width:300px"><h2 style="margin:0 0 14px">فرق تسعير</h2>
<input name="p" type="password" placeholder="كلمة مرور الصفحة" style="width:100%;padding:10px;border-radius:12px;border:1px solid #e6e6e2;font-size:15px" autofocus>
<button style="margin-top:12px;width:100%;padding:10px;border-radius:12px;border:0;background:#121212;color:#fff;font-size:15px">دخول</button></form></body></html>'''
# The landing's <head> for crawlers (docs/qa/requests.md B3); app routes keep noindex.
LANDING_TITLE = 'فرق تسعير — قبل ما تشتري، شوف الفرق'
LANDING_DESC = 'ارفع الكراسة أو اكتب الطلبات أو صوّرها، ونجيب لك عروض أسعار من موردين حقيقيين، محسوبة شامل التوصيل والضريبة، مرتبة من الأوفر.'
def landing_head(origin):
    t, d, u = html.escape(LANDING_TITLE), html.escape(LANDING_DESC), html.escape(origin + '/')
    return (f'<title>{t}</title><meta name="description" content="{d}" /><meta name="robots" content="index, follow" />'
            f'<meta property="og:type" content="website" /><meta property="og:site_name" content="فرق تسعير" /><meta property="og:locale" content="ar_SA" />'
            f'<meta property="og:title" content="{t}" /><meta property="og:description" content="{d}" /><meta property="og:url" content="{u}" />'
            f'<meta name="twitter:card" content="summary" /><meta name="twitter:title" content="{t}" /><meta name="twitter:description" content="{d}" />'
            f'<link rel="canonical" href="{u}" />')

_PUBLIC = {'mtime': None, 'files': set()}
def public_files():
    """Files under dist/ the landing needs: index.html's chunk + imports + dynamic imports, never the App chunk."""
    mf = os.path.join(DIST, '.vite', 'manifest.json')
    try: mt = os.path.getmtime(mf)
    except OSError: return set()
    if _PUBLIC['mtime'] == mt: return _PUBLIC['files']
    with open(mf, encoding='utf-8') as fh: m = json.load(fh)
    out, seen = set(), set()
    def add(k):
        if k in seen or k not in m: return
        seen.add(k); c = m[k]; out.add('/' + c['file'])
        for x in c.get('css', []) + c.get('assets', []): out.add('/' + x)
        for i in c.get('imports', []) + c.get('dynamicImports', []):
            if m.get(i, {}).get('src') == 'src/App.tsx' or m.get(i, {}).get('name') == 'App': continue
            add(i)
    add('index.html')
    _PUBLIC.update(mtime=mt, files=out)
    return out

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
    def _origin(self): return SITE_URL or ('https://' + (self.headers.get('Host') or 'localhost'))
    def _file(self, f):
        ctype = mimetypes.guess_type(f)[0] or 'application/octet-stream'
        with open(f, 'rb') as fh: data = fh.read()
        self._send(200, data, ctype if 'text' not in ctype else ctype + '; charset=utf-8')
    def _landing(self):
        with open(os.path.join(DIST, 'index.html'), encoding='utf-8') as fh: page = fh.read()
        page = page.replace('<meta name="robots" content="noindex, nofollow" />', '', 1).replace('<title>فرق تسعير</title>', landing_head(self._origin()), 1)
        self._send(200, page.encode())
    def do_GET(self):
        if self.path.startswith('/_api/'): return self._proxy() if self._authed() else self._send(401, b'{"error":"gate"}', 'application/json')
        u = urllib.parse.urlparse(self.path); p = u.path
        # public: the landing, its own files, robots / sitemap / favicon
        if (p == '/' and 'rfq=' not in u.query) or p.rstrip('/') == '/landing': return self._landing()
        if p == '/robots.txt':
            return self._send(200, f'User-agent: *\nAllow: /$\nDisallow: /\nSitemap: {self._origin()}/sitemap.xml\n'.encode(), 'text/plain; charset=utf-8')
        if p == '/sitemap.xml':
            return self._send(200, f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>{html.escape(self._origin())}/</loc></url></urlset>'.encode(), 'application/xml')
        if p in public_files() or p in ('/favicon.ico', '/favicon.svg'):
            f = os.path.normpath(os.path.join(DIST, p.lstrip('/')))
            if f.startswith(DIST + os.sep) and os.path.isfile(f): return self._file(f)
            return self._send(404, b'')
        if p == '/__gate': return self._send(200, LOGIN.replace('action="/__gate"', 'action="/__gate?next=' + urllib.parse.quote(self._next(u.query), safe='') + '"').encode())
        if not self._authed():
            # app files: 401; app pages: to the password form, then back to the page asked for
            if p.startswith('/assets/') or '.' in p.rsplit('/', 1)[-1]: return self._send(401, b'', 'text/plain')
            return self._send(303, b'', extra=[('Location', '/__gate?next=' + urllib.parse.quote(self.path, safe=''))])
        f = os.path.normpath(os.path.join(DIST, p.lstrip('/')))
        if not f.startswith(DIST) or not os.path.isfile(f): f = os.path.join(DIST, 'index.html')
        self._file(f)
    def _next(self, query):
        n = urllib.parse.parse_qs(query).get('next', ['/requests'])[0]
        # same-site path only: no //host, no /\\host, no control characters (header injection)
        if not n.startswith('/') or n.startswith('//') or '\\' in n or n.startswith('/__gate') or any(ord(ch) < 32 for ch in n): return '/requests'
        return n
    def do_POST(self):
        if urllib.parse.urlparse(self.path).path == '/__gate':
            n = int(self.headers.get('Content-Length') or 0); p = urllib.parse.parse_qs(self.rfile.read(n).decode()).get('p', [''])[0]
            self.send_response(303); self.send_header('Location', urllib.parse.quote(self._next(urllib.parse.urlparse(self.path).query), safe="/?=&:#-._~"))
            if PASSWORD and p == PASSWORD: self.send_header('Set-Cookie', f'fp_gate={TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000')
            self.end_headers(); return
        if self.path.startswith('/_api/'): return self._proxy() if self._authed() else self._send(401, b'{"error":"gate"}', 'application/json')
        self._send(404, b'')
    do_PUT = do_PATCH = do_DELETE = do_POST

if __name__ == '__main__':
    print(f'farq-pricing on :{PORT} -> {API} (gate: {"on" if PASSWORD else "OFF"})', flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
