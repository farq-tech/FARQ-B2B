import hmac, re
# -*- coding: utf-8 -*-
"""Serve the public landing and account-login app; proxy Farq with each user's
Authorization header, taken from the sealed HttpOnly session cookie (session_cookie.py) — the browser never holds a token. Farq enforces API permissions. Targeting uses a server
credential only after /api/auth/me validates an allowed account. Sending is
still disabled unless TARGETING_SEND=1.
"""
import os, sys, json, hashlib, html, time, urllib.request, urllib.parse, mimetypes
import schedule
from trial import handle as handle_trial
from saudi_rhythm import block_for_body
import session_cookie as sc
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__)); DIST = os.path.join(HERE, 'dist')
PORT = int(os.environ.get('PORT', '8080'))
API = os.environ.get('FARQ_API_ORIGIN', 'https://api.farq.sa').rstrip('/')
SITE_URL = os.environ.get('SITE_URL', '').rstrip('/')  # public origin for canonical / sitemap (unset: from the Host header)
# The landing's <head> for crawlers (docs/qa/requests.md B3); app routes keep noindex.
LANDING_TITLE = 'FARQ B2B — الجهات المناسبة لاحتياج منشأتك'
LANDING_DESC = 'جهّز احتياج منشأتك وراجع البنود، ثم قارن عروض الموردين المستلمة ومواصفاتها وشروطها قبل قرار الشراء.'
def landing_head(origin):
    t, d, u = html.escape(LANDING_TITLE), html.escape(LANDING_DESC), html.escape(origin + '/')
    return (f'<title>{t}</title><meta name="description" content="{d}" /><meta name="robots" content="index, follow" />'
            f'<meta property="og:type" content="website" /><meta property="og:site_name" content="FARQ B2B" /><meta property="og:locale" content="ar_SA" />'
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

TARGETING = os.environ.get('TARGETING_ORIGIN', 'https://farq-targeting-production-4687.up.railway.app').rstrip('/')
TARGETING_PW = os.environ.get('TARGETING_PASSWORD', '')
TARGETING_SEND = os.environ.get('TARGETING_SEND') == '1'
# Service-to-service header for the targeting service: its own token when set, else a value derived from the password
# (never equal to a browser cookie). Must match the targeting service's service_token().
TARGETING_SERVICE = os.environ.get('TARGETING_SERVICE_TOKEN') or (hmac.new(TARGETING_PW.encode(), b'farq-proxy-v1', hashlib.sha256).hexdigest() if TARGETING_PW else None)
T_READ = {('GET', '/status'), ('GET', '/template-status'), ('GET', '/templates'), ('GET', '/cities'), ('POST', '/search'), ('GET', '/facets'), ('POST', '/map-query'), ('POST', '/map-profile'), ('POST', '/clusters'), ('POST', '/suggest-specialties'), ('GET', '/districts'), ('POST', '/street-density'), ('POST', '/street-density/catalog'), ('POST', '/district-counts'), ('POST', '/district-insights'), ('POST', '/who-buys'), ('POST', '/market-summary')}
T_SUBMIT = {('POST', '/templates')}  # submits a template to Meta for review — sends nothing to anyone
T_SEND = {('POST', '/send-farq')}

def targeting_call(method, path, body=None, *, retry_transient=False):
    """One call to the targeting service with the server's service header: (status, data, content-type).
    The proxy and the scheduled-send runner (schedule.py) both go through here. Only callers that
    explicitly identify an idempotent read may retry a transient failure."""
    attempts = 2 if retry_transient else 1
    log_path = urllib.parse.urlsplit(path).path
    for attempt in range(attempts):
        req = urllib.request.Request(TARGETING + path, data=body, method=method, headers={'content-type': 'application/json'})
        if TARGETING_SERVICE: req.add_header('X-Farq-Service', TARGETING_SERVICE)
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read(), r.headers.get("Content-Type","application/json")
        except urllib.error.HTTPError as e:
            if attempt + 1 < attempts and e.code in {502, 503, 504}:
                print(f'targeting read retry after HTTP {e.code}: {method} {log_path}', flush=True)
                time.sleep(0.2)
                continue
            return e.code, e.read(), "application/json"
        except (urllib.error.URLError, OSError):
            if attempt + 1 >= attempts: raise
            print(f'targeting read retry after network error: {method} {log_path}', flush=True)
            time.sleep(0.2)


def send_gate(body):
    """(code, payload) when a /send-farq call must not be forwarded now, else None: closed unless TARGETING_SEND=1, and
    held during prayer (saudi_rhythm). The one gate of the immediate path and of scheduled sends."""
    if not TARGETING_SEND: return 403, {'ok': False, 'error': 'SEND_DISABLED'}
    # Owner-approved send rule (2026-10-16): no campaign send from a prayer's start until 25 min after it, nor during
    # Friday prayer (11:30–13:30 Saudi time), in any target city (saudi_rhythm.py). 409, not forwarded.
    blk = block_for_body(body)
    return (409, blk) if blk else None


def send_farq(body):
    """The immediate send path as a function: gate, then forward /send-farq unchanged. (status, data, content-type)."""
    g = send_gate(body)
    if g: return g[0], json.dumps(g[1], ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8'
    return targeting_call('POST', '/send-farq', body)


HOP = {'connection', 'keep-alive', 'transfer-encoding', 'host', 'content-length', 'accept-encoding'}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    # ---- session (sealed HttpOnly cookie; see session_cookie.py)
    _cookies = None
    _sess_done = False
    _sess = None
    def _session(self):
        """This request's Farq session from the cookie, renewed when close to expiry. Cookie changes go out with the response."""
        if self._sess_done: return self._sess
        self._sess_done, self._cookies = True, []
        s = sc.read(self.headers.get('Cookie'))
        if s:
            s, changed, refused = sc.refresh(API, s)
            if refused: self._cookies.append(sc.clear_cookie())
            elif changed: self._cookies.append(sc.set_cookie(s))
        self._sess = s
        return s
    def _force_refresh(self):
        s = self._session()
        if not s: return None
        s, changed, refused = sc.refresh(API, s, force=True)
        self._cookies = [c for c in self._cookies if not c[1].startswith(sc.COOKIE + '=')]
        if refused: self._cookies.append(sc.clear_cookie())
        elif changed: self._cookies.append(sc.set_cookie(s))
        self._sess = s if not refused else None
        return self._sess
    def _csrf_ok(self):
        """State-changing requests that carry the session cookie must come from this site (Origin / Referer check)."""
        if self.command in ('GET', 'HEAD', 'OPTIONS'): return True
        if sc.COOKIE + '=' not in (self.headers.get('Cookie') or ''): return True
        return sc.same_origin(self.headers, self.headers.get('Host'))
    def _bearer(self):
        s = self._session()
        if s: return 'Bearer ' + s['a']
        return self.headers.get('Authorization', '')
    def _session_route(self, path):
        """/_session/me (GET) · login · refresh · logout · password (POST). Answers carry the user, never a token."""
        j = lambda code, obj, extra=None: self._send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8', extra)
        if path == '/_session/me' and self.command == 'GET':
            s = self._session()
            return j(200, {'ok': True, 'data': sc.public(s)}) if s else j(401, {'ok': False, 'error': 'NO_SESSION'})
        if self.command != 'POST': return j(405, {'ok': False})
        if not sc.same_origin(self.headers, self.headers.get('Host')): return j(403, {'ok': False, 'error': 'CSRF'})
        n = int(self.headers.get('Content-Length') or 0)
        try: body = json.loads(self.rfile.read(n) or b'{}') if n else {}
        except Exception: body = {}
        if path in ('/_session/login', '/_session/signup'):
            fields = {k: body.get(k) for k in ('email', 'password') if isinstance(body.get(k), str)}
            status, data = sc.api_post(API, '/api/auth/login' if path.endswith('login') else '/api/auth/signup', fields)
            nxt = sc.from_payload(data) if 200 <= status < 300 else None
            if not nxt:
                err = (data or {}).get('errors') if isinstance(data, dict) else None
                return j(status if status >= 400 else 502, {'ok': False, 'errors': err or [{'code': 'LOGIN_FAILED', 'message': 'تعذّر الوصول إلى خدمة الحسابات.' if not status else ''}]})
            return j(200, {'ok': True, 'data': sc.public(nxt)}, [sc.set_cookie(nxt)])
        if path == '/_session/refresh':
            s = self._force_refresh()
            if s: return j(200, {'ok': True, 'data': sc.public(s)})
            return j(401, {'ok': False, 'error': 'NO_SESSION'})
        if path == '/_session/logout':
            s = sc.read(self.headers.get('Cookie'))
            self._sess_done, self._cookies = True, [sc.clear_cookie()]
            if s:
                if body.get('scope') == 'global': sc.api_post(API, '/api/auth/logout', {'scope': 'global'}, bearer=s['a'])
                else: sc.api_post(API, '/api/auth/logout', {'refresh_token': s['r']})
            return j(200, {'ok': True})
        if path == '/_session/password':
            s = self._session()
            if not s: return j(401, {'ok': False, 'error': 'NO_SESSION'})
            status, data = sc.api_post(API, '/api/auth/password', {k: body.get(k) for k in ('current_password', 'new_password')}, bearer=s['a'])
            if not 200 <= status < 300: return j(status or 502, data or {'ok': False})
            nxt = sc.from_payload(data)
            return j(200, {'ok': True, 'data': sc.public(nxt or s)}, [sc.set_cookie(nxt)] if nxt else None)
        return j(404, {'ok': False})
    def _authed(self):
        """Validate the account on Farq before using the server's targeting credential."""
        bearer = self._bearer()
        if not bearer.startswith('Bearer ') or len(bearer) > 8192: return False
        req = urllib.request.Request(API + '/api/auth/me', headers={'Authorization': bearer, 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                user = json.load(response).get('data', {}).get('user', {})
            allowed = {e.strip().lower() for e in os.environ.get('ALLOWED_EMAILS', 'abdulrhman@farq.sa').split(',') if e.strip()}
            ok = bool(user.get('id') and str(user.get('email', '')).lower() in allowed)
            self._user = user if ok else None  # the owner identity scheduled campaigns are stored under
            return ok
        except Exception: return False
    def _send(self, code, body, ctype='text/html; charset=utf-8', extra=None):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or []) + [c for c in (self._cookies or []) if c not in (extra or [])]: self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def _proxy(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else None
        path = self.path[len('/_api'):] or '/'
        # tokens never travel to the browser: sign-in, refresh and sign-out go through /_session/*
        if re.match(r'/api/auth/(login|signup|refresh|logout|password|claim)', path): return self._send(404, b'{"ok":false,"error":"USE_SESSION_ROUTES"}', 'application/json')
        if not self._csrf_ok(): return self._send(403, b'{"ok":false,"error":"CSRF"}', 'application/json')
        def build():
            req = urllib.request.Request(API + path, data=body, method=self.command)
            s = self._session()
            for k, v in self.headers.items():
                if k.lower() in HOP or k.lower() == 'cookie' or (s and k.lower() == 'authorization'): continue
                req.add_header(k, v)
            if s: req.add_header('Authorization', 'Bearer ' + s['a'])
            return req
        try:
            try:
                with urllib.request.urlopen(build(), timeout=60) as r: status, hdrs, data = r.status, r.headers, r.read()
            except urllib.error.HTTPError as e:
                # an access token rejected mid-life (secret rotation, revoke): one forced renewal, one retry
                if e.code != 401 or not self._session() or not self._force_refresh(): raise
                with urllib.request.urlopen(build(), timeout=60) as r: status, hdrs, data = r.status, r.headers, r.read()
        except urllib.error.HTTPError as e: status, hdrs, data = e.code, e.headers, e.read()
        except Exception as e: self._send(502, json.dumps({'error': 'UPSTREAM', 'detail': str(e)[:200]}).encode(), 'application/json'); return
        self.send_response(status)
        for k, v in hdrs.items():
            if k.lower() in HOP or k.lower() == 'content-encoding': continue
            self.send_header(k, v)
        for k, v in (self._cookies or []): self.send_header(k, v)
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def _targeting(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path[len('/_targeting'):] or '/'
        tile = self.command == 'GET' and re.fullmatch(r'/tiles/[a-f0-9]{32}/[0-9]{1,2}/[0-9]{1,7}/[0-9]{1,7}\.pbf',path)
        key = (self.command, path)
        # Read-only: lets the review screen say up front whether sending is open (Figma M11c). Never changes the flag.
        if key == ('GET', '/send-status'): return self._send(200, json.dumps({'send': TARGETING_SEND}).encode(), 'application/json')
        if not tile and key not in T_READ and key not in T_SEND and key not in T_SUBMIT: return self._send(404, b'{"error":"not_found"}', 'application/json')
        if key in T_SEND and not TARGETING_SEND: return self._send(403, b'{"ok":false,"error":"SEND_DISABLED"}', 'application/json')
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else None
        try: status, data, ctype = send_farq(body) if key in T_SEND else targeting_call(self.command, path + (("?"+parsed.query) if parsed.query else ""), body, retry_transient=key in T_READ)
        except Exception as e: return self._send(502, json.dumps({'error': 'UPSTREAM', 'detail': str(e)[:200]}).encode(), 'application/json')
        self._send(status, data, ctype)
    def _origin(self): return SITE_URL or ('https://' + (self.headers.get('Host') or 'localhost'))
    def _file(self, f):
        ctype = mimetypes.guess_type(f)[0] or 'application/octet-stream'
        with open(f, 'rb') as fh: data = fh.read()
        self._send(200, data, ctype if 'text' not in ctype else ctype + '; charset=utf-8')
    def _landing(self):
        with open(os.path.join(DIST, 'index.html'), encoding='utf-8') as fh: page = fh.read()
        page = page.replace('<meta name="robots" content="noindex, nofollow" />', '', 1).replace('<title>FARQ B2B</title>', landing_head(self._origin()), 1)
        self._send(200, page.encode())
    def do_GET(self):
        if self.path.startswith('/api/targeting/schedule') and schedule.handle(sys.modules[__name__], self, 'GET'): return
        if self.path.startswith('/_trial/'): return handle_trial(self, TARGETING, TARGETING_PW)
        if self.path.startswith('/_session/'): return self._session_route(urllib.parse.urlparse(self.path).path)
        if self.path.startswith('/_api/'): return self._proxy()
        if self.path.startswith('/_targeting/'): return self._targeting() if self._authed() else self._send(401, b'{"error":"gate"}', 'application/json')
        u = urllib.parse.urlparse(self.path); p = u.path
        # public: the landing, its own files, robots / sitemap / favicon
        if (p == '/' and 'rfq=' not in u.query) or p.rstrip('/') == '/landing': return self._landing()
        if p == '/robots.txt':
            return self._send(200, f'User-agent: *\nAllow: /$\nDisallow: /\nSitemap: {self._origin()}/sitemap.xml\n'.encode(), 'text/plain; charset=utf-8')
        if p == '/sitemap.xml':
            return self._send(200, f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>{html.escape(self._origin())}/</loc></url></urlset>'.encode(), 'application/xml')
        if p in public_files() or p in ('/favicon.ico', '/favicon.svg', '/gate-network.js'):
            f = os.path.normpath(os.path.join(DIST, p.lstrip('/')))
            if f.startswith(DIST + os.sep) and os.path.isfile(f): return self._file(f)
            return self._send(404, b'')
        if p == '/__gate':
            return self._send(303, b'', extra=[('Location', self._next(u.query))])
        f = os.path.normpath(os.path.join(DIST, p.lstrip('/')))
        if not f.startswith(DIST + os.sep) or not os.path.isfile(f): f = os.path.join(DIST, 'index.html')
        self._file(f)
    def _next(self, query):
        n = urllib.parse.parse_qs(query).get('next', ['/requests'])[0]
        # same-site path only: no //host, no /\\host, no control characters (header injection)
        if not n.startswith('/') or n.startswith('//') or '\\' in n or n.startswith('/__gate') or any(ord(ch) < 32 for ch in n): return '/requests'
        return n
    def do_POST(self):
        if self.path.startswith('/api/targeting/schedule') and schedule.handle(sys.modules[__name__], self, self.command): return
        if self.path.startswith('/_trial/'): return handle_trial(self, TARGETING, TARGETING_PW)
        if urllib.parse.urlparse(self.path).path == '/__gate':
            return self._send(410, b'{"error":"USE_ACCOUNT_LOGIN"}', 'application/json')
        if self.path.startswith('/_session/'): return self._session_route(urllib.parse.urlparse(self.path).path)
        if self.path.startswith('/_api/'): return self._proxy()
        if self.path.startswith('/_targeting/'):
            if not self._csrf_ok(): return self._send(403, b'{"ok":false,"error":"CSRF"}', 'application/json')
            return self._targeting() if self._authed() else self._send(401, b'{"error":"gate"}', 'application/json')
        self._send(404, b'')
    do_PUT = do_PATCH = do_DELETE = do_POST

if __name__ == '__main__':
    print(f'farq-pricing on :{PORT} -> {API} (account login; targeting -> {TARGETING}, send: {"ON" if TARGETING_SEND else "off"}, schedule: {"ON" if schedule.ENABLED and schedule.DB_URL else "off"})', flush=True)
    schedule.start(sys.modules[__name__])  # scheduled sends: only with TARGETING_SCHEDULE_ENABLED=1 and a store
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
