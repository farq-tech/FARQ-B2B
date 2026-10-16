# -*- coding: utf-8 -*-
"""Scheduled campaign sends (owner: «اجعل جدولة موجودة»), server side, nothing kept on the device.

  POST /api/targeting/schedule              {keys, message, template, send_at, cities?, query?} -> one scheduled campaign
  GET  /api/targeting/schedule              the signed-in owner's scheduled campaigns
  POST /api/targeting/schedule/{id}/cancel  cancels one that has not started; nothing is ever deleted

Off unless TARGETING_SCHEDULE_ENABLED=1: every route then answers 404, so the screen says «الجدولة قريباً».
Durable store: Postgres at TARGETING_SCHEDULE_DB_URL, in its own schema `pricing_schedule` (new tables only). This
container's disk is ephemeral, so there is no file fallback: flag on without a store answers 503 STORE_NOT_CONFIGURED.

Same rules as the immediate send (server.send_farq, the one function both use):
- recipients are poi_keys only; the targeting service resolves each from its directory and applies status_policy.
  No number, name or email is taken from the request or stored here.
- validation: the send switch (TARGETING_SEND, read, never changed), the template rules of the send screen
  (templateFits in src/api/targetingClient.ts), eligibility by the service's own dry run (/send-farq dry_run: true,
  which cannot reach WhatsApp). The immediate path has no budget or price check, so none is added here.
- prayer: a send_at inside a prayer window (saudi_rhythm) is moved to the first allowed minute and the answer says so.

The runner (one daemon thread, every RUN_EVERY seconds) claims a due campaign with FOR UPDATE SKIP LOCKED, re-checks
the switch, prayer and eligibility, and sends through server.send_farq exactly as the screen does (register, then
template, 200 places a call). Idempotent: before a chunk leaves, each recipient gets a row (campaign, poi_key) in
state 'sending' (primary key, committed first); a key that already has a row is never sent again. After a crash the
'sending' rows become 'unknown' (never retried: an unknown outcome needs reconciliation, not a duplicate).
"""
import json, os, re, threading, time, traceback, urllib.parse, uuid
from datetime import datetime, timedelta, timezone

import saudi_rhythm as sr

ENABLED = os.environ.get('TARGETING_SCHEDULE_ENABLED') == '1'
DB_URL = os.environ.get('TARGETING_SCHEDULE_DB_URL', '')
RUN_EVERY = 30            # seconds between runner ticks
CHUNK = 200               # places per /send-farq call, as sendCampaign in the client
DRY_CHUNK = 500           # the service's own limit per call
MAX_KEYS = 5000
MAX_AHEAD = timedelta(days=30)
STALE = timedelta(minutes=15)   # a 'running' campaign whose runner stopped beating this long ago crashed
MAX_ATTEMPTS = 3
KEY_RE = re.compile(r'^[A-Za-z0-9:_\-\.]{1,200}$')          # the service's KEY_RE
TEMPLATE_RE = re.compile(r'^[a-z0-9_]{1,512}$')
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
TERMINAL = ('sent', 'partial', 'failed', 'cancelled', 'interrupted')

SCHEMA = """
create schema if not exists pricing_schedule;
create table if not exists pricing_schedule.campaigns (
  id uuid primary key,
  user_id text not null,
  user_email text not null,
  org_id text,
  rfq_id text not null,
  keys jsonb not null,
  cities jsonb not null default '[]'::jsonb,
  message text not null,
  template text not null,
  query text not null default '',
  requested_send_at timestamptz not null,
  send_at timestamptz not null,
  status text not null check (status in ('scheduled','running','sent','partial','failed','cancelled','interrupted')),
  notes jsonb not null default '[]'::jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  error text
);
create index if not exists campaigns_due on pricing_schedule.campaigns (send_at) where status = 'scheduled';
create index if not exists campaigns_user on pricing_schedule.campaigns (user_id, send_at desc);
create table if not exists pricing_schedule.recipients (
  campaign_id uuid not null references pricing_schedule.campaigns(id),
  poi_key text not null,
  status text not null check (status in ('sending','sent','failed','skipped','unknown')),
  message_id text,
  error text,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, poi_key)
);
"""

UTC = timezone.utc
def _now(): return sr.now_utc()
def _iso(dt): return sr._iso(dt) if dt else None
def _clean(v): return re.sub(r'\s{2,}', ' ', re.sub(r'[\r\n\t]+', ' ', str(v or ''))).strip()[:1024]


# ---------------------------------------------------------------- store

_ready = {'done': False}
_ready_lock = threading.Lock()

def connect():
    import psycopg  # only needed once the flag is on
    con = psycopg.connect(DB_URL, connect_timeout=15)
    if not _ready['done']:
        with _ready_lock:
            if not _ready['done']:
                con.execute(SCHEMA); con.commit(); _ready['done'] = True
    return con


# ---------------------------------------------------------------- validation, shared with the immediate path

def template_fits(t):
    """templateFits of the send screen: APPROVED, Arabic, body takes exactly {{1}} and {{2}}, nothing else to fill."""
    if not isinstance(t, dict) or t.get('status') != 'APPROVED': return False
    if t.get('language') and t.get('language') != 'ar': return False
    comps = t.get('components') or []
    for c in comps:
        if c.get('type') == 'HEADER' and ((c.get('format') and c.get('format') != 'TEXT') or '{{' in str(c.get('text') or '')): return False
        if c.get('type') == 'BUTTONS' and any('{{' in f"{b.get('url') or ''}{b.get('text') or ''}" for b in c.get('buttons') or []): return False
    body = next((c.get('text') or '' for c in comps if c.get('type') == 'BODY'), '')
    return sorted(set(re.findall(r'\{\{\s*(\d+)\s*\}\}', body))) == ['1', '2']


def _service_json(server, method, path, body=None):
    status, data, _ = server.targeting_call(method, path, json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None)
    try: return status, json.loads(data or b'{}')
    except ValueError: return status, {}


def check_template(server, name):
    """None when the template may be used, else an error code."""
    if not TEMPLATE_RE.match(str(name or '')): return 'TEMPLATE_INVALID'
    status, d = _service_json(server, 'GET', '/templates')
    if status != 200 or not d.get('ok'): return 'TEMPLATES_UNAVAILABLE'
    t = next((x for x in d.get('data') or [] if x.get('name') == name and (x.get('language') in (None, 'ar'))), None)
    if not t: return 'TEMPLATE_NOT_FOUND'
    return None if template_fits(t) else 'TEMPLATE_NOT_USABLE'


def holder_rfq(server):
    status, d = _service_json(server, 'GET', '/template-status')
    rid = str(((d or {}).get('holder') or {}).get('holder_rfq_id') or '').strip().lower()
    return rid if status == 200 and UUID_RE.match(rid) else None


def eligibility(server, rfq_id, keys, template, message, cities):
    """(eligible keys in order, {key: reason}) from the targeting service's own dry run: directory + status_policy.
    dry_run cannot reach WhatsApp (provider_send refuses), so this sends nothing."""
    eligible, rejected = [], {}
    city = cities[0] if len(cities) == 1 else None
    for i in range(0, len(keys), DRY_CHUNK):
        part = keys[i:i + DRY_CHUNK]
        status, d = _service_json(server, 'POST', '/send-farq', {'rfq_id': rfq_id, 'mode': 'template', 'template': template, 'dry_run': True,
                                                                 'targets': [{'poi_key': k, 'city': city, 'message': message} for k in part]})
        if status != 200 or not d.get('ok'): raise RuntimeError('ELIGIBILITY_UNAVAILABLE')
        ok = set(d.get('eligible') or [])
        for f in d.get('failed') or []: rejected[str(f.get('poi_key'))] = str(f.get('error') or 'NOT_ELIGIBLE')
        for k in part:
            if k in ok: eligible.append(k)
            else: rejected.setdefault(k, 'NOT_ELIGIBLE')
    return eligible, rejected


def parse_send_at(v):
    if not isinstance(v, str) or not v.strip(): return None
    s = v.strip().replace('Z', '+00:00')
    try: dt = datetime.fromisoformat(s)
    except ValueError: return None
    if dt.tzinfo is None: return None  # a time without a zone is ambiguous: refuse rather than guess
    return dt.astimezone(UTC)


def prayer_shift(cities, at):
    """(send moment, None) or (moved moment, note) when `at` is in a prayer window in any of the cities."""
    t, hit = sr.shift_for_cities(cities, at)
    if not hit: return at, None
    t = t.replace(second=0, microsecond=0) + (timedelta(minutes=1) if (t.second or t.microsecond) else timedelta(0))
    clock = sr.ksa_clock(t)
    return t, {'prayer': hit[0], 'from': _iso(at), 'to': _iso(t), 'to_ar': clock,
               'message_ar': f'الوقت المطلوب يوافق صلاة {sr.PRAYER_AR[hit[0]]}، فنقلنا الحملة إلى الساعة {clock}.'}


def validate(server, body):
    """(clean request, None) or (None, (http code, error payload)). Mirrors the immediate send's checks."""
    if not isinstance(body, dict): return None, (400, {'ok': False, 'error': 'BODY_INVALID'})
    raw = body.get('keys')
    if not isinstance(raw, list) or not raw: return None, (400, {'ok': False, 'error': 'KEYS_REQUIRED'})
    keys = list(dict.fromkeys(str(k) for k in raw if isinstance(k, str)))
    if len(keys) != len(raw) or any(not KEY_RE.match(k) for k in keys): return None, (400, {'ok': False, 'error': 'KEYS_INVALID'})
    if len(keys) > MAX_KEYS: return None, (400, {'ok': False, 'error': f'KEYS_1_{MAX_KEYS}'})
    message = _clean(body.get('message'))
    if not message: return None, (400, {'ok': False, 'error': 'EMPTY_MESSAGE'})
    template = str(body.get('template') or '')
    at = parse_send_at(body.get('send_at'))
    if not at: return None, (400, {'ok': False, 'error': 'SEND_AT_INVALID'})
    now = _now()
    if at <= now: return None, (400, {'ok': False, 'error': 'SEND_AT_PAST'})
    if at > now + MAX_AHEAD: return None, (400, {'ok': False, 'error': 'SEND_AT_TOO_FAR'})
    cities = [str(c)[:80] for c in (body.get('cities') or []) if isinstance(c, str) and c.strip()][:50]
    if not server.TARGETING_SEND: return None, (403, {'ok': False, 'error': 'SEND_DISABLED'})
    err = check_template(server, template)
    if err: return None, (422, {'ok': False, 'error': err})
    rfq_id = holder_rfq(server)
    if not rfq_id: return None, (503, {'ok': False, 'error': 'HOLDER_UNAVAILABLE'})
    try: eligible, rejected = eligibility(server, rfq_id, keys, template, message, cities)
    except RuntimeError as e: return None, (503, {'ok': False, 'error': str(e)})
    if not eligible: return None, (422, {'ok': False, 'error': 'NO_ELIGIBLE_RECIPIENTS', 'rejected': rejected})
    send_at, note = prayer_shift(cities, at)
    return {'keys': eligible, 'rejected': rejected, 'message': message, 'template': template, 'cities': cities, 'rfq_id': rfq_id,
            'requested_send_at': at, 'send_at': send_at, 'note': note, 'query': _clean(body.get('query'))[:300]}, None


# ---------------------------------------------------------------- routes

def _org_of(server, handler):
    """The organisation the request acts for: X-Organization-Id when it is one of the user's, else the first one."""
    try:
        import urllib.request
        req = urllib.request.Request(server.API + '/api/business/context', headers={'Authorization': handler.headers.get('Authorization', ''), 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as r: d = json.load(r)
        orgs = [str(o.get('id')) for o in ((d.get('data') or d).get('organizations') or []) if o.get('id')]
    except Exception: return None
    want = str(handler.headers.get('X-Organization-Id') or '')
    return want if want in orgs else (orgs[0] if orgs else None)


def _row(c, r):
    names = [d.name for d in c.description]
    return dict(zip(names, r))


def _public(row, counts=None):
    return {'id': str(row['id']), 'status': row['status'], 'send_at': _iso(row['send_at']), 'requested_send_at': _iso(row['requested_send_at']),
            'template': row['template'], 'message': row['message'], 'keys': row['keys'], 'cities': row['cities'], 'query': row['query'],
            'notes': row['notes'], 'created_at': _iso(row['created_at']), 'started_at': _iso(row['started_at']), 'finished_at': _iso(row['finished_at']),
            'cancelled_at': _iso(row['cancelled_at']), 'error': row['error'], 'org_id': row['org_id'], 'recipients': counts or {}}


def handle(server, h, method):
    """Entry from server.H for /api/targeting/schedule*. Returns True when it answered."""
    path = urllib.parse.urlparse(h.path).path.rstrip('/')
    if not (path == '/api/targeting/schedule' or path.startswith('/api/targeting/schedule/')): return False
    j = lambda code, obj: h._send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')
    if not ENABLED: return j(404, {'error': 'not_found'}) or True
    if not h._authed(): return j(401, {'error': 'gate'}) or True
    if not DB_URL: return j(503, {'ok': False, 'error': 'STORE_NOT_CONFIGURED'}) or True
    user = getattr(h, '_user', None) or {}
    uid, email = str(user.get('id')), str(user.get('email') or '').lower()
    m = re.fullmatch(r'/api/targeting/schedule/([0-9a-f-]{36})/cancel', path)
    try:
        if method == 'GET' and path == '/api/targeting/schedule':
            with connect() as con:
                cur = con.execute('select * from pricing_schedule.campaigns where user_id=%s order by send_at desc limit 200', (uid,))
                rows = [_row(cur, r) for r in cur.fetchall()]
                counts = {}
                if rows:
                    for cid, st, n in con.execute('select campaign_id, status, count(*) from pricing_schedule.recipients where campaign_id = any(%s) group by 1, 2', ([r['id'] for r in rows],)).fetchall():
                        counts.setdefault(str(cid), {})[st] = n
            return j(200, {'ok': True, 'data': [_public(r, counts.get(str(r['id']))) for r in rows]}) or True
        if method == 'POST' and path == '/api/targeting/schedule':
            n = int(h.headers.get('Content-Length') or 0)
            if n > 1_000_000: return j(413, {'ok': False, 'error': 'TOO_LARGE'}) or True
            try: body = json.loads(h.rfile.read(n) or b'{}')
            except ValueError: return j(400, {'ok': False, 'error': 'BODY_INVALID'}) or True
            req, err = validate(server, body)
            if err: return j(*err) or True
            cid = uuid.uuid4()
            notes = [{'kind': 'prayer_shift', **req['note']}] if req['note'] else []
            with connect() as con:
                con.execute("""insert into pricing_schedule.campaigns (id, user_id, user_email, org_id, rfq_id, keys, cities, message, template, query, requested_send_at, send_at, status, notes)
                               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'scheduled',%s)""",
                            (cid, uid, email, _org_of(server, h), req['rfq_id'], json.dumps(req['keys']), json.dumps(req['cities'], ensure_ascii=False), req['message'],
                             req['template'], req['query'], req['requested_send_at'], req['send_at'], json.dumps(notes, ensure_ascii=False)))
                con.commit()
            out = {'ok': True, 'id': str(cid), 'status': 'scheduled', 'send_at': _iso(req['send_at']), 'send_at_ar': sr.ksa_clock(req['send_at']),
                   'requested_send_at': _iso(req['requested_send_at']), 'shifted': bool(req['note']), 'eligible': len(req['keys']), 'rejected': req['rejected']}
            if req['note']: out.update(prayer=req['note']['prayer'], message_ar=req['note']['message_ar'])
            return j(201, out) or True
        if method == 'POST' and m:
            with connect() as con:
                r = con.execute("""update pricing_schedule.campaigns set status='cancelled', cancelled_at=now()
                                   where id=%s and user_id=%s and status='scheduled' returning id""", (m.group(1), uid)).fetchone()
                if not r:
                    st = con.execute('select status from pricing_schedule.campaigns where id=%s and user_id=%s', (m.group(1), uid)).fetchone()
                    con.rollback()
                    return (j(404, {'ok': False, 'error': 'NOT_FOUND'}) if not st else j(409, {'ok': False, 'error': 'NOT_CANCELLABLE', 'status': st[0]})) or True
                con.commit()
            return j(200, {'ok': True, 'id': m.group(1), 'status': 'cancelled'}) or True
        return j(404, {'error': 'not_found'}) or True
    except Exception as e:
        return j(502, {'ok': False, 'error': 'SCHEDULE_FAILED', 'detail': type(e).__name__}) or True


# ---------------------------------------------------------------- runner

def _note(con, cid, note):
    con.execute("update pricing_schedule.campaigns set notes = notes || %s::jsonb where id=%s", (json.dumps([note], ensure_ascii=False), cid))


def recover(con):
    """Campaigns whose runner stopped (restart, crash): rows caught in 'sending' become 'unknown' and are never sent
    again; the campaign goes back to 'scheduled' to finish the keys that have no row yet, or ends 'interrupted'."""
    stale = con.execute("""select id, attempts from pricing_schedule.campaigns where status='running' and coalesce(heartbeat_at, started_at) < %s for update skip locked""",
                        (_now() - STALE,)).fetchall()
    for cid, attempts in stale:
        con.execute("update pricing_schedule.recipients set status='unknown', error='OUTCOME_UNKNOWN_AFTER_RESTART', updated_at=now() where campaign_id=%s and status='sending'", (cid,))
        if attempts >= MAX_ATTEMPTS:
            con.execute("update pricing_schedule.campaigns set status='interrupted', finished_at=now(), error='TOO_MANY_RESTARTS' where id=%s", (cid,))
        else:
            con.execute("update pricing_schedule.campaigns set status='scheduled', send_at=%s where id=%s", (_now(), cid))
            _note(con, cid, {'kind': 'recovered', 'at': _iso(_now())})
    con.commit()
    return len(stale)


def claim(con):
    cur = con.execute("""update pricing_schedule.campaigns set status='running', started_at=coalesce(started_at, now()), heartbeat_at=now(), attempts=attempts+1
                         where id = (select id from pricing_schedule.campaigns where status='scheduled' and send_at <= %s order by send_at limit 1 for update skip locked)
                         returning *""", (_now(),))
    r = cur.fetchone(); row = _row(cur, r) if r else None
    con.commit()
    return row


def _finish(con, cid, status, error=None):
    con.execute("update pricing_schedule.campaigns set status=%s, finished_at=now(), error=%s where id=%s and status='running'", (status, error, cid)); con.commit()


def _hold(con, cid, until, note):
    """Back to 'scheduled' later (prayer): nothing of this step has left."""
    con.execute("update pricing_schedule.campaigns set status='scheduled', send_at=%s where id=%s and status='running'", (until, cid))
    _note(con, cid, note); con.commit()


def run_campaign(server, con, row):
    cid, cities, keys = row['id'], row['cities'] or [], row['keys'] or []
    if not server.TARGETING_SEND: return _finish(con, cid, 'failed', 'SEND_DISABLED')
    done = {k for (k,) in con.execute('select poi_key from pricing_schedule.recipients where campaign_id=%s', (cid,)).fetchall()}
    todo = [k for k in keys if k not in done]
    if todo:
        try: eligible, rejected = eligibility(server, row['rfq_id'], todo, row['template'], row['message'], cities)
        except RuntimeError as e:
            con.rollback(); return _finish(con, cid, 'failed', str(e))
        for k in todo:
            if k in rejected:
                con.execute("insert into pricing_schedule.recipients (campaign_id, poi_key, status, error) values (%s,%s,'skipped',%s) on conflict do nothing", (cid, k, rejected[k][:300]))
        con.commit()
        todo = eligible
    for i in range(0, len(todo), CHUNK):
        part = todo[i:i + CHUNK]
        until, note = prayer_shift(cities, _now())
        if note: return _hold(con, cid, until, {'kind': 'prayer_hold', **note})
        # idempotency: the rows are committed before anything leaves; a key with a row is never sent again
        fresh = [k for k in part if con.execute("insert into pricing_schedule.recipients (campaign_id, poi_key, status) values (%s,%s,'sending') on conflict do nothing returning poi_key", (cid, k)).fetchone()]
        con.execute('update pricing_schedule.campaigns set heartbeat_at=now() where id=%s', (cid,)); con.commit()
        if not fresh: continue
        city = cities[0] if len(cities) == 1 else None
        targets = [{'poi_key': k, 'city': city, 'message': row['message']} for k in fresh]
        base = {'rfq_id': row['rfq_id'], 'query': row['query'], 'targets': targets}
        def call(extra):
            status, data, _ = server.send_farq(json.dumps({**base, **extra}, ensure_ascii=False).encode('utf-8'))
            try: return status, json.loads(data or b'{}')
            except ValueError: return status, {}
        try: st, reg = call({'dispatch': False})
        except Exception: st, reg = 0, {}
        if st in (403, 409):  # the gate closed between the check and the call: nothing left, put the rows back
            con.execute('delete from pricing_schedule.recipients where campaign_id=%s and poi_key = any(%s) and status=%s', (cid, fresh, 'sending'))
            if st == 409: return _hold(con, cid, parse_send_at(reg.get('next_allowed')) or _now() + timedelta(minutes=5), {'kind': 'prayer_hold', 'prayer': reg.get('prayer')})
            con.commit(); return _finish(con, cid, 'failed', 'SEND_DISABLED')
        if st != 200 or not reg.get('ok'):  # registering failed: the template call was never made
            con.execute("update pricing_schedule.recipients set status='failed', error=%s, updated_at=now() where campaign_id=%s and poi_key = any(%s) and status='sending'",
                        ('REGISTER_' + str(reg.get('error') or reg.get('fatal') or st)[:200], cid, fresh)); con.commit()
            continue
        try: st, res = call({'mode': 'template', 'template': row['template']})
        except Exception: st, res = 0, {}
        if st in (403, 409):
            con.execute('delete from pricing_schedule.recipients where campaign_id=%s and poi_key = any(%s) and status=%s', (cid, fresh, 'sending'))
            if st == 409: return _hold(con, cid, parse_send_at(res.get('next_allowed')) or _now() + timedelta(minutes=5), {'kind': 'prayer_hold', 'prayer': res.get('prayer')})
            con.commit(); return _finish(con, cid, 'failed', 'SEND_DISABLED')
        for s in res.get('sent') or []:
            con.execute("update pricing_schedule.recipients set status='sent', message_id=%s, updated_at=now() where campaign_id=%s and poi_key=%s", (str(s.get('message_id') or '')[:200] or None, cid, str(s.get('poi_key'))))
        for f in res.get('failed') or []:
            con.execute("update pricing_schedule.recipients set status='failed', error=%s, updated_at=now() where campaign_id=%s and poi_key=%s and status='sending'", (str(f.get('error') or '')[:300], cid, str(f.get('poi_key'))))
        # anything still 'sending' has no answer: unknown, never retried
        con.execute("update pricing_schedule.recipients set status='unknown', error=%s, updated_at=now() where campaign_id=%s and status='sending'", (f'NO_OUTCOME_{st}', cid))
        con.commit()
    counts = dict(con.execute('select status, count(*) from pricing_schedule.recipients where campaign_id=%s group by 1', (cid,)).fetchall())
    sent = counts.get('sent', 0); other = sum(v for k, v in counts.items() if k != 'sent')
    _finish(con, cid, 'sent' if sent and not other else 'partial' if sent else 'failed', None if sent else 'NOTHING_SENT')


def tick(server):
    """One runner pass: recover crashed campaigns, then send every due one."""
    with connect() as con:
        recover(con)
        while True:
            row = claim(con)
            if not row: break
            try: run_campaign(server, con, row)
            except Exception:
                con.rollback(); traceback.print_exc()
                # leave it 'running': recover() turns in-flight rows to 'unknown' once it is stale, never a resend


def start(server):
    if not (ENABLED and DB_URL): return None
    def loop():
        while True:
            try: tick(server)
            except Exception: traceback.print_exc()
            time.sleep(RUN_EVERY)
    t = threading.Thread(target=loop, name='schedule-runner', daemon=True); t.start()
    return t
