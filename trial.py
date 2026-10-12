"""Bounded, read-only public directory trial. Never proxies supplier sends or returns concealed records."""
import collections, hashlib, hmac, secrets, json, threading, time, urllib.request, urllib.error, urllib.parse
from http.cookies import SimpleCookie

_lock = threading.Lock()
_hits = collections.OrderedDict()
_global_hits = collections.deque()
_slots = threading.BoundedSemaphore(2)
_city_lock = threading.Lock()
_city_cache = {'until': 0, 'rows': []}

def permitted(ip):
    now = time.monotonic()
    with _lock:
        while _global_hits and _global_hits[0] < now - 3600: _global_hits.popleft()
        if len(_global_hits) >= 60: return False
        while _hits and next(iter(_hits.values()))[-1] < now - 3600:
            _hits.popitem(last=False)
        bucket = _hits.setdefault(ip, [])
        bucket[:] = [t for t in bucket if t > now - 3600]
        if len(bucket) >= 12 or sum(t > now - 60 for t in bucket) >= 3:
            return False
        if len(_hits) > 5000:
            return False
        _global_hits.append(now)
        bucket.append(now)
        _hits.move_to_end(ip)
        return True

def visitor_cookie(handler, password):
    key = hashlib.sha256(('pricing-trial:' + password).encode()).digest()
    cookie = SimpleCookie()
    try: cookie.load(handler.headers.get('Cookie') or '')
    except Exception: pass
    token = cookie.get('fp_trial')
    if token:
        try:
            payload, signature = token.value.rsplit('.', 1)
            visitor, expiry = payload.split('.')
            if len(visitor) == 32 and all(c in '0123456789abcdef' for c in visitor) and int(expiry) > time.time() and int(expiry) <= time.time() + 1800 and hmac.compare_digest(signature, hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()):
                return visitor, None
        except Exception: pass
    visitor = secrets.token_hex(16)
    payload = visitor + '.' + str(int(time.time()) + 1800)
    value = payload + '.' + hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()
    secure = '' if handler.headers.get('Host', '').split(':')[0] in ('localhost', '127.0.0.1', 'test.local') else '; Secure'
    return visitor, 'fp_trial=' + value + '; Path=/_trial; HttpOnly; SameSite=Strict; Max-Age=1800' + secure

def upstream(origin, password, path, body=None):
    req = urllib.request.Request(origin + path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='GET' if body is None else 'POST')
    if password:
        req.add_header('Cookie', 'ft_auth=' + hashlib.sha256(password.encode()).hexdigest()[:32])
    with urllib.request.urlopen(req, timeout=95) as response:
        return json.loads(response.read(2_000_000))

def city_list(origin, password):
    if _city_cache['until'] > time.monotonic():
        return _city_cache['rows']
    if not _city_lock.acquire(blocking=False):
        raise ValueError('cities busy')
    try:
        data = upstream(origin, password, '/cities')
        if not isinstance(data, list):
            raise ValueError('invalid cities')
        rows = [{'en': str(c['en'])[:80], 'ar': str(c.get('ar') or c['en'])[:80]} for c in data if isinstance(c, dict) and c.get('en')]
        _city_cache.update(until=time.monotonic() + 300, rows=rows)
        return rows
    finally:
        _city_lock.release()

def public_result(data):
    if not isinstance(data, dict) or not isinstance(data.get('rows'), list):
        raise ValueError('bad upstream')
    rows = []
    seen = set()
    for row in data['rows'][:10]:
        if not isinstance(row, dict) or row.get('ai') == 'N':
            continue
        name = str(row.get('name_ar') or row.get('name_en') or '').strip()[:180]
        identity = (name.casefold(), str(row.get('district_ar') or row.get('district_en') or '').casefold())
        if not name or identity in seen:
            continue
        seen.add(identity)
        rows.append({'name': name, 'category': str(row.get('category_ar') or row.get('category') or '')[:180], 'district': str(row.get('district_ar') or row.get('district_en') or '')[:100], 'match': 'product' if row.get('match') == 'product' else 'seller', 'fit': row.get('ai') if row.get('ai') in ('L', 'M') else None})
    total = data.get('total')
    if isinstance(total, bool) or not isinstance(total, int) or total < len(rows):
        raise ValueError('bad count')
    # Counts describe directory matches; top-ten AI screening may exclude entries.
    hidden = max(0, total - min(10, len(data['rows'])))
    return {'suppliers': rows, 'additional': hidden, 'directoryMatches': total, 'screenedOut': min(10, len(data['rows'])) - len(rows)}

def handle(handler, origin, password):
    path = handler.path.split('?', 1)[0]
    visitor, cookie = visitor_cookie(handler, password)
    send = lambda status, payload: handler._send(status, json.dumps(payload, ensure_ascii=False).encode(), 'application/json; charset=utf-8', extra=[('Set-Cookie', cookie)] if cookie else [])
    if path not in ('/_trial/cities', '/_trial/search'):
        return send(404, {'error': 'NOT_FOUND'})
    expected = 'GET' if path.endswith('/cities') else 'POST'
    if handler.command != expected:
        return send(405, {'error': 'METHOD'})
    if not password:
        return send(503, {'error': 'UNAVAILABLE'})
    if path.endswith('/cities'):
        try:
            return send(200, city_list(origin, password))
        except Exception:
            return send(503, {'error': 'UNAVAILABLE'})
    if handler.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
        return send(415, {'error': 'CONTENT_TYPE'})
    origin_header = handler.headers.get('Origin')
    if origin_header and urllib.parse.urlparse(origin_header).netloc != handler.headers.get('Host'):
        return send(403, {'error': 'ORIGIN'})
    try:
        length = int(handler.headers.get('Content-Length') or 0)
        if not 0 < length <= 2048:
            return send(400, {'error': 'INPUT'})
        body = json.loads(handler.rfile.read(length))
        if not isinstance(body, dict):
            raise ValueError()
        q, city = body.get('q'), body.get('city')
        if not isinstance(q, str) or not isinstance(city, str) or not 3 <= len(q.strip()) <= 120 or not 1 <= len(city) <= 80 or any(c in q for c in '\n\r;؛'):
            return send(400, {'error': 'ONE_ITEM'})
    except Exception:
        return send(400, {'error': 'INPUT'})
    if not permitted(visitor) or not _slots.acquire(blocking=False):
        return send(429, {'error': 'LIMIT'})
    try:
        valid = city_list(origin, password)
        if city not in {c.get('en') for c in valid if isinstance(c, dict)}:
            return send(400, {'error': 'CITY'})
        data = upstream(origin, password, '/search', {'q': q.strip(), 'city': city, 'limit': 10, 'only_sendable': False})
        return send(200, public_result(data))
    except Exception:
        return send(503, {'error': 'UNAVAILABLE'})
    finally:
        _slots.release()
