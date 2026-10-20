# -*- coding: utf-8 -*-
"""Server-side Farq session for the pricing proxy (owner 2026-10-16: no app data on the device, yet the login must
survive a refresh and a new tab).

The browser holds ONE cookie, `farq_session`: HttpOnly, Secure, SameSite=Lax, Path=/. Its value is the Farq session
(access token, refresh token, expiry, the user's id/email/name) sealed with FARQ_SESSION_SECRET: encrypted
(HMAC-SHA256 in counter mode) and authenticated (encrypt-then-MAC, HMAC-SHA256), so JavaScript can neither read it
(HttpOnly) nor make sense of it, and nobody can forge or alter it without the secret. The front end never sees a token.

Lifetime matches the Farq API's own: the access token is renewed shortly before it expires; the cookie lives as long as
the refresh token (30 days, api/lib/auth/tokens.js REFRESH_TTL_SECONDS) and is re-issued on every rotation. A refused
refresh (401) ends the session and clears the cookie; a network failure keeps it.

Refresh tokens are single use: the API treats a replay as theft and revokes the family. Concurrent requests that carry
the same expiring cookie (several tabs, parallel calls) are therefore serialised and share one rotation: the successor
is remembered for a short while keyed by the spent token's hash.
"""
import base64, hashlib, hmac, json, os, secrets, sys, threading, time, urllib.error, urllib.request

COOKIE = 'farq_session'
MAX_AGE = 60 * 60 * 24 * 30          # = the API's refresh-token TTL
REFRESH_MARGIN = 5 * 60              # renew this long before the access token expires (same as the old client)
SUCCESSOR_TTL = 120                  # how long a rotation is shared with requests still holding the old cookie
COOKIE_SECURE = os.environ.get('FARQ_SESSION_COOKIE_SECURE', '1') != '0'

_secret = os.environ.get('FARQ_SESSION_SECRET', '').encode()
if len(_secret) < 32:
    # Without a configured secret the sessions only last as long as this process (a restart signs everyone out).
    print('session: FARQ_SESSION_SECRET unset or shorter than 32 bytes; using a per-process key', file=sys.stderr, flush=True)
    _secret = secrets.token_bytes(32)
_ENC = hmac.new(_secret, b'farq-session-enc-v1', hashlib.sha256).digest()
_MAC = hmac.new(_secret, b'farq-session-mac-v1', hashlib.sha256).digest()


def _stream(nonce, n):
    out, ctr = bytearray(), 0
    while len(out) < n:
        out += hmac.new(_ENC, nonce + ctr.to_bytes(8, 'big'), hashlib.sha256).digest(); ctr += 1
    return bytes(out[:n])


def seal(obj):
    raw = json.dumps(obj, separators=(',', ':')).encode()
    nonce = secrets.token_bytes(16)
    ct = bytes(a ^ b for a, b in zip(raw, _stream(nonce, len(raw))))
    tag = hmac.new(_MAC, nonce + ct, hashlib.sha256).digest()[:16]
    return base64.urlsafe_b64encode(nonce + ct + tag).decode().rstrip('=')


def unseal(value):
    try:
        blob = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
        if len(blob) < 33: return None
        nonce, ct, tag = blob[:16], blob[16:-16], blob[-16:]
        if not hmac.compare_digest(tag, hmac.new(_MAC, nonce + ct, hashlib.sha256).digest()[:16]): return None
        obj = json.loads(bytes(a ^ b for a, b in zip(ct, _stream(nonce, len(ct)))))
        return obj if isinstance(obj, dict) and obj.get('a') and obj.get('r') else None
    except Exception:
        return None


def from_payload(payload, now=None):
    """The API's session payload ({access_token, refresh_token, expires_at|expires_in, user}) → our sealed shape."""
    p = (payload or {}).get('data', payload) if isinstance(payload, dict) else {}
    a, r, u = p.get('access_token'), p.get('refresh_token'), p.get('user') or {}
    if not a or not r or not u.get('id'): return None
    exp = p.get('expires_at') or int(now or time.time()) + int(p.get('expires_in') or 3600)
    return {'a': a, 'r': r, 'e': int(exp), 'u': {'id': str(u['id']), 'email': u.get('email'), 'email_verified': u.get('email_verified') is True, 'display_name': u.get('display_name')}}


def public(s):
    """What the front end may know: the user and when the access token expires. Never a token."""
    return {'user': s['u'], 'expires_at': s['e']}


def set_cookie(s):
    secure = '; Secure' if COOKIE_SECURE else ''
    return ('Set-Cookie', f'{COOKIE}={seal(s)}; Path=/; Max-Age={MAX_AGE}; HttpOnly{secure}; SameSite=Lax')


def clear_cookie():
    secure = '; Secure' if COOKIE_SECURE else ''
    return ('Set-Cookie', f'{COOKIE}=; Path=/; Max-Age=0; HttpOnly{secure}; SameSite=Lax')


def read(cookie_header):
    for part in (cookie_header or '').split(';'):
        k, _, v = part.strip().partition('=')
        if k == COOKIE and v: return unseal(v)
    return None


def api_post(api, path, body, bearer=None, timeout=20):
    """POST to the Farq auth API → (status, json or None). Status 0 = unreachable."""
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if bearer: headers['Authorization'] = 'Bearer ' + bearer
    req = urllib.request.Request(api + path, data=json.dumps(body).encode(), method='POST', headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'null')
        except Exception: return e.code, None
    except Exception:
        return 0, None


_lock = threading.Lock()
_successors = {}  # sha256(spent refresh token) -> (session, time)


def refresh(api, s, force=False):
    """Renew `s` when it is close to expiry (or `force`). → (session or None, changed: bool, refused: bool).
    None + refused = the API refused the refresh token: the session is over. None + not refused = unreachable."""
    if not force and s['e'] - time.time() > REFRESH_MARGIN: return s, False, False
    key = hashlib.sha256(s['r'].encode()).hexdigest()
    with _lock:
        now = time.time()
        for k in [k for k, (_, t) in _successors.items() if now - t > SUCCESSOR_TTL]: _successors.pop(k, None)
        if key in _successors: return _successors[key][0], True, False
        status, data = api_post(api, '/api/auth/refresh', {'refresh_token': s['r']})
        if status == 401: return None, False, True
        nxt = from_payload(data) if 200 <= status < 300 else None
        if not nxt: return s, False, False  # unreachable or odd answer: keep the session, the API will say 401 if it must
        _successors[key] = (nxt, now)
        return nxt, True, False


def same_origin(headers, host):
    """CSRF guard for state-changing requests that ride on the session cookie: the Origin (or, without one, the
    Referer) must be this site. SameSite=Lax already keeps the cookie off cross-site POSTs; this is the second lock."""
    src = headers.get('Origin') or headers.get('Referer') or ''
    if not src or not host: return False
    netloc = src.split('://', 1)[-1].split('/', 1)[0]
    return netloc.lower() == host.lower()
