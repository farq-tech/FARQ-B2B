"""Incoming WhatsApp replies for the Atlas inbox (owner approved 2026-11-03).

The targeting service already sends every Atlas campaign message (``/send-template``) and is the only service that
knows the recipient's number (it resolves it from the directory at the moment of sending). So it is also where a reply
is received and tied back to the campaign it answers:

* ``record_outbound`` keeps, for each message the service hands to WhatsApp for an Atlas campaign, the account that sent
  it, the request it belongs to, the directory record (poi_key) and the recipient's number.
* ``handle_post`` is the webhook: it accepts only a body signed with the app secret (``X-Hub-Signature-256``), stores
  each incoming message once (by its message id) and moves the delivery status of messages we sent forward
  (sent → delivered → read, or failed).
* A reply is linked to the outbound message it quotes (``context.id``) when it quotes one, else to the most recent
  campaign message sent to the same number within ``LINK_WINDOW_DAYS``; otherwise it is kept as unlinked and nobody's
  inbox shows it.
* ``feed`` returns one account's messages with the request and poi_key they answer, whether the account has read
  each one (``set_read``, so the state follows the person across devices), and the delivery state of its campaign
  messages. The account is the Farq organisation the Atlas server names; ``sender_id`` keeps the person who sent.
* ``unlinked`` / ``attach`` / ``dismiss`` let a Farq owner place a reply nobody could be matched to, but only onto a
  campaign message that was sent to the same number (never onto an arbitrary account). Numbers leave the service only
  masked, and only on that owner review.

Storage is one SQLite file on the service's existing data volume (``FARQ_TARGETING_RUNTIME_DIR``), next to the send
logs the service already keeps there: standard library only, no new server or vendor. Nothing here calls Meta.
"""
from __future__ import annotations

import contextlib
import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time

LINK_WINDOW_DAYS = 30
MAX_BODY_CHARS = 4096
MAX_WEBHOOK_BYTES = 1024 * 1024
ID_RE = re.compile(r'^[A-Za-z0-9_\-:.]{1,160}$')
MESSAGE_ID_RE = re.compile(r'^[A-Za-z0-9_\-:.=+/]{1,256}$')
CHALLENGE_RE = re.compile(r'^[A-Za-z0-9_\-.]{1,256}$')
STATUS_RANK = {'sent': 1, 'delivered': 2, 'read': 3}
# the kinds a person can send that carry no text of their own; the inbox names the kind instead
NON_TEXT_KINDS = {'image', 'video', 'audio', 'voice', 'document', 'sticker', 'location', 'contacts', 'reaction', 'order', 'unsupported'}

SCHEMA = """
create table if not exists wa_outbound (
  message_id text primary key,
  account_id text not null,
  request_id text not null,
  poi_key text not null,
  wa_id text not null,
  sent_at integer not null,
  status text not null default 'sent',
  status_at integer,
  sender_id text,
  request_title text
);
create index if not exists wa_outbound_by_number on wa_outbound (wa_id, sent_at desc);
create index if not exists wa_outbound_by_account on wa_outbound (account_id, sent_at desc);
create table if not exists wa_inbound (
  message_id text primary key,
  wa_id text not null,
  account_id text,
  request_id text,
  poi_key text,
  outbound_id text,
  link text not null,
  kind text not null,
  body text not null,
  received_at integer not null,
  stored_at integer not null,
  read_at integer,
  reviewed_at integer,
  reviewed_by text
);
create index if not exists wa_inbound_by_account on wa_inbound (account_id, received_at desc);
create index if not exists wa_inbound_by_link on wa_inbound (link, received_at desc);
create table if not exists wa_source_cursor (
  source text primary key,
  value text not null,
  updated_at integer not null
);
create table if not exists wa_source_health (
  source text primary key,
  last_ok_at integer,
  last_error_at integer,
  last_error_kind text,
  failures integer not null default 0,
  last_counts text
);
"""
# columns added after the first release of the file: added in place to a store created before them
LATER_COLUMNS = {'wa_outbound': {'sender_id': 'text', 'request_title': 'text'}, 'wa_inbound': {'read_at': 'integer', 'reviewed_at': 'integer', 'reviewed_by': 'text'}}


def digits(value) -> str:
    """A WhatsApp number as digits only (wa_id form, e.g. 9665XXXXXXXX)."""
    return re.sub(r'\D', '', str(value or ''))


def valid_id(value) -> bool:
    return isinstance(value, str) and bool(ID_RE.match(value))


def mask(number) -> str:
    d = digits(number)
    return (d[:4] + '****' + d[-2:]) if len(d) >= 8 else '****'


def accounts_of(value) -> list:
    """One account id or a few (an organisation and its sender's own fallback account), each checked; at most 4."""
    values = [value] if isinstance(value, str) else list(value or []) if isinstance(value, (list, tuple)) else []
    return list(dict.fromkeys(v for v in values if valid_id(v)))[:4]


def clean_title(value) -> str | None:
    """A request's title as the person named it, for the owner's review: one line, at most 200 characters."""
    if not isinstance(value, str):
        return None
    text = re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f\x7f<>]', ' ', value)).strip()[:200]
    return text or None


def iso(seconds) -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(int(seconds)))


# ── signature and subscription ────────────────────────────────────────────────────────────────────────────────────────

def signature_ok(raw: bytes, header: str | None, app_secret: str | None) -> bool:
    """X-Hub-Signature-256 is ``sha256=`` + HMAC-SHA256 of the exact request bytes, keyed by the app secret."""
    if not app_secret or not header or not isinstance(raw, (bytes, bytearray)):
        return False
    header = header.strip()
    if not header.lower().startswith('sha256='):
        return False
    given = header[7:].strip().lower()
    if not re.fullmatch(r'[0-9a-f]{64}', given):
        return False
    expected = hmac.new(app_secret.encode('utf-8'), bytes(raw), hashlib.sha256).hexdigest()
    return hmac.compare_digest(given, expected)


def handle_verify(query: dict, verify_token: str | None) -> tuple[int, str]:
    """Meta's subscription check: echo hub.challenge only for hub.mode=subscribe and our verify token."""
    if not verify_token:
        return 503, 'WEBHOOK_NOT_CONFIGURED'
    first = lambda key: (query.get(key) or [''])[0] if isinstance(query.get(key), list) else str(query.get(key) or '')
    mode, token, challenge = first('hub.mode'), first('hub.verify_token'), first('hub.challenge')
    if mode != 'subscribe' or not token or not hmac.compare_digest(token.encode('utf-8'), verify_token.encode('utf-8')):
        return 403, 'FORBIDDEN'
    if not CHALLENGE_RE.match(challenge):
        return 400, 'BAD_CHALLENGE'
    return 200, challenge


# ── payload parsing ───────────────────────────────────────────────────────────────────────────────────────────────────

def message_text(message: dict) -> tuple[str, str]:
    """(kind, text) of one incoming message: its own words where it has any, never a media URL or file id."""
    kind = str(message.get('type') or 'unsupported')
    part = message.get(kind) if isinstance(message.get(kind), dict) else {}
    text = ''
    if kind == 'text':
        text = part.get('body') or ''
    elif kind == 'button':
        text = part.get('text') or ''
    elif kind == 'interactive':
        reply = part.get('button_reply') or part.get('list_reply') or {}
        text = reply.get('title') or ''
    elif kind in ('image', 'video', 'document'):
        text = part.get('caption') or ''
    elif kind == 'reaction':
        text = part.get('emoji') or ''
    if kind not in NON_TEXT_KINDS and kind not in ('text', 'button', 'interactive'):
        kind = 'unsupported'
    return kind, str(text)[:MAX_BODY_CHARS]


def parse_events(payload: dict, phone_number_id: str | None = None):
    """Incoming messages and status updates from one webhook body. When our sending number is configured, changes
    addressed to another number of the same app are skipped."""
    messages, statuses = [], []
    if not isinstance(payload, dict) or payload.get('object') != 'whatsapp_business_account':
        return messages, statuses
    for entry in payload.get('entry') or []:
        for change in (entry or {}).get('changes') or []:
            if (change or {}).get('field') != 'messages':
                continue
            value = change.get('value') or {}
            to_number = str((value.get('metadata') or {}).get('phone_number_id') or '')
            if phone_number_id and to_number and to_number != str(phone_number_id):
                continue
            for message in value.get('messages') or []:
                if not isinstance(message, dict):
                    continue
                message_id = str(message.get('id') or '')
                sender = digits(message.get('from'))
                if not MESSAGE_ID_RE.match(message_id) or not 8 <= len(sender) <= 15:
                    continue
                kind, text = message_text(message)
                try:
                    received_at = int(message.get('timestamp'))
                except (TypeError, ValueError):
                    received_at = int(time.time())
                context = str((message.get('context') or {}).get('id') or '')
                messages.append({'message_id': message_id, 'wa_id': sender, 'kind': kind, 'body': text,
                                 'received_at': received_at, 'context_id': context if MESSAGE_ID_RE.match(context) else ''})
            for status in value.get('statuses') or []:
                if not isinstance(status, dict):
                    continue
                state = str(status.get('status') or '')
                message_id = str(status.get('id') or '')
                if state not in ('sent', 'delivered', 'read', 'failed') or not MESSAGE_ID_RE.match(message_id):
                    continue
                try:
                    at = int(status.get('timestamp'))
                except (TypeError, ValueError):
                    at = int(time.time())
                statuses.append({'message_id': message_id, 'status': state, 'at': at})
    return messages, statuses


# ── storage ───────────────────────────────────────────────────────────────────────────────────────────────────────────

class InboxStore:
    def __init__(self, path: str, link_window_days: int = LINK_WINDOW_DAYS):
        self.path = path
        self.window = int(link_window_days) * 86400
        self._lock = threading.Lock()
        self._ready = False

    @contextlib.contextmanager
    def _connect(self):
        """One short-lived connection per operation, under the store's lock: committed on success, always closed."""
        with self._lock:
            if not self._ready:
                directory = os.path.dirname(self.path)
                if directory:
                    os.makedirs(directory, exist_ok=True)
            con = sqlite3.connect(self.path, timeout=10)
            try:
                if not self._ready:
                    con.execute('pragma journal_mode=wal')
                    con.executescript(SCHEMA)
                    for table, columns in LATER_COLUMNS.items():
                        have = {row[1] for row in con.execute(f'pragma table_info({table})')}
                        for name, kind in columns.items():
                            if name not in have:
                                con.execute(f'alter table {table} add column {name} {kind}')
                    self._ready = True
                with con:
                    yield con
            finally:
                con.close()

    def record_outbound(self, message_id, account_id, request_id, poi_key, to, sent_at=None, sender_id=None, request_title=None) -> bool:
        """Remember one campaign message we sent, so its reply can be linked back. Returns False when an id is not
        usable (nothing stored); a repeated message id keeps the first record."""
        number = digits(to)
        if not (MESSAGE_ID_RE.match(str(message_id or '')) and valid_id(account_id) and valid_id(request_id)
                and isinstance(poi_key, str) and 1 <= len(poi_key) <= 200 and 8 <= len(number) <= 15):
            return False
        with self._connect() as con:
            con.execute('insert or ignore into wa_outbound (message_id, account_id, request_id, poi_key, wa_id, sent_at, sender_id, request_title) values (?,?,?,?,?,?,?,?)',
                        (message_id, account_id, request_id, poi_key, number, int(sent_at or time.time()), sender_id if valid_id(sender_id) else None, clean_title(request_title)))
        return True

    def _link(self, con, message):
        if message['context_id']:
            row = con.execute('select message_id, account_id, request_id, poi_key from wa_outbound where message_id=? and wa_id=?',
                              (message['context_id'], message['wa_id'])).fetchone()
            if row:
                return row, 'context'
        row = con.execute('select message_id, account_id, request_id, poi_key from wa_outbound where wa_id=? and sent_at<=? and sent_at>=? '
                          'order by sent_at desc, rowid desc limit 1',
                          (message['wa_id'], message['received_at'] + 300, message['received_at'] - self.window)).fetchone()
        return (row, 'recent') if row else (None, 'unlinked')

    def ingest(self, payload: dict, phone_number_id: str | None = None, now: int | None = None) -> dict:
        """One webhook body: its messages and its status updates."""
        messages, statuses = parse_events(payload, phone_number_id)
        return self.ingest_events(messages, statuses, now)

    def ingest_events(self, messages: list, statuses: list, now: int | None = None) -> dict:
        """Incoming messages ({message_id, wa_id, kind, body, received_at, context_id}) and status updates
        ({message_id, status, at}) from any source: each message once by its id, statuses forward only."""
        result = {'new': 0, 'duplicate': 0, 'unlinked': 0, 'statuses': 0}
        stored_at = int(now or time.time())
        with self._connect() as con:
            for message in messages:
                if con.execute('select 1 from wa_inbound where message_id=?', (message['message_id'],)).fetchone():
                    result['duplicate'] += 1
                    continue
                row, link = self._link(con, message)
                outbound_id, account_id, request_id, poi_key = row if row else (None, None, None, None)
                con.execute('insert or ignore into wa_inbound (message_id, wa_id, account_id, request_id, poi_key, outbound_id, link, kind, body, received_at, stored_at) '
                            'values (?,?,?,?,?,?,?,?,?,?,?)',
                            (message['message_id'], message['wa_id'], account_id, request_id, poi_key, outbound_id, link,
                             message['kind'], message['body'], message['received_at'], stored_at))
                result['new'] += 1
                result['unlinked'] += 1 if link == 'unlinked' else 0
            for status in statuses:
                row = con.execute('select status from wa_outbound where message_id=?', (status['message_id'],)).fetchone()
                if not row:
                    continue   # not an Atlas campaign message
                current, state = row[0], status['status']
                # statuses can arrive out of order: only move forward; failed replaces only «sent»
                forward = STATUS_RANK.get(state, 0) > STATUS_RANK.get(current, 0) if state != 'failed' else current == 'sent'
                if forward:
                    con.execute('update wa_outbound set status=?, status_at=? where message_id=?', (state, status['at'], status['message_id']))
                    result['statuses'] += 1
        return result

    def known_numbers(self, numbers) -> set:
        """Which of these numbers an Atlas campaign message was sent to. A message from any other number is not a
        reply to Atlas, so a second source (the construction inbox) does not bring it in at all."""
        wanted = sorted({digits(n) for n in numbers if 8 <= len(digits(n)) <= 15})
        found = set()
        with self._connect() as con:
            for start in range(0, len(wanted), 200):
                chunk = wanted[start:start + 200]
                found.update(r[0] for r in con.execute(f"select distinct wa_id from wa_outbound where wa_id in ({','.join('?' * len(chunk))})", chunk))
        return found

    def open_outbound_ids(self, since: int, limit: int = 2000) -> list:
        """Campaign messages sent since `since` whose delivery is not final yet (not read, not failed)."""
        with self._connect() as con:
            return [r[0] for r in con.execute("select message_id from wa_outbound where sent_at>=? and status not in ('read','failed') "
                                              'order by sent_at desc limit ?', (int(since), int(limit)))]

    # ── health of a reply source, for the owner and the log ───────────────────────────────────────────────────────

    def record_poll(self, source: str, ok: bool, error_kind: str | None = None, counts: dict | None = None, now: int | None = None) -> int:
        """Notes one poll of a source. Returns how many polls in a row have now failed (0 after a success)."""
        at = int(now or time.time())
        kind = re.sub(r'[^A-Za-z0-9_.]', '', str(error_kind or ''))[:80] or 'Error'
        with self._connect() as con:
            con.execute('insert or ignore into wa_source_health (source, failures) values (?, 0)', (source,))
            if ok:
                con.execute('update wa_source_health set last_ok_at=?, failures=0, last_counts=? where source=?',
                            (at, json.dumps(counts or {}, sort_keys=True), source))
                return 0
            con.execute('update wa_source_health set last_error_at=?, last_error_kind=?, failures=failures+1 where source=?', (at, kind, source))
            return con.execute('select failures from wa_source_health where source=?', (source,)).fetchone()[0]

    def health(self, source: str) -> dict:
        with self._connect() as con:
            row = con.execute('select last_ok_at, last_error_at, last_error_kind, failures, last_counts from wa_source_health where source=?', (source,)).fetchone()
        if not row:
            return {'source': source, 'lastOkAt': None, 'lastErrorAt': None, 'lastErrorKind': None, 'failures': 0, 'lastCounts': None}
        try: counts = json.loads(row[4]) if row[4] else None
        except ValueError: counts = None
        return {'source': source, 'lastOkAt': iso(row[0]) if row[0] else None, 'lastErrorAt': iso(row[1]) if row[1] else None,
                'lastErrorKind': row[2], 'failures': int(row[3] or 0), 'lastCounts': counts}

    def health_epochs(self, source: str) -> tuple[int | None, int]:
        """(last success as epoch seconds or None, failures in a row) for the watchdog and the metrics."""
        with self._connect() as con:
            row = con.execute('select last_ok_at, failures from wa_source_health where source=?', (source,)).fetchone()
        return (row[0], int(row[1] or 0)) if row else (None, 0)

    def cursor(self, source: str) -> str | None:
        with self._connect() as con:
            row = con.execute('select value from wa_source_cursor where source=?', (source,)).fetchone()
        return row[0] if row else None

    def set_cursor(self, source: str, value: str, now: int | None = None) -> None:
        with self._connect() as con:
            con.execute('insert into wa_source_cursor (source, value, updated_at) values (?,?,?) '
                        'on conflict(source) do update set value=excluded.value, updated_at=excluded.updated_at', (source, value, int(now or time.time())))

    def feed(self, account_id, since: int | None = None, limit: int = 200) -> dict:
        """One account's linked replies (newest first) and the delivery status of its campaign messages. No numbers.
        `account_id` may list a few accounts of the same person (accounts_of)."""
        accounts = accounts_of(account_id)
        if not accounts:
            return {'messages': [], 'deliveries': []}
        limit = max(1, min(int(limit), 500))
        marks = ','.join('?' * len(accounts))
        with self._connect() as con:
            rows = con.execute('select message_id, request_id, poi_key, kind, body, received_at, link, read_at from wa_inbound '
                               f'where account_id in ({marks}) and received_at>=? order by received_at desc, rowid desc limit ?',
                               (*accounts, int(since or 0), limit)).fetchall()
            # the newest message per recipient of each request: its delivery state is the recipient's
            deliveries = con.execute('select request_id, poi_key, status, coalesce(status_at, sent_at) from wa_outbound o '
                                     f'where account_id in ({marks}) and sent_at = (select max(sent_at) from wa_outbound i where i.account_id=o.account_id '
                                     'and i.request_id=o.request_id and i.poi_key=o.poi_key) order by sent_at desc limit 1000', accounts).fetchall()
        return {
            'messages': [{'id': r[0], 'requestId': r[1], 'poiKey': r[2], 'kind': r[3], 'body': r[4], 'receivedAt': iso(r[5]), 'link': r[6], 'read': r[7] is not None} for r in rows],
            'deliveries': [{'requestId': r[0], 'poiKey': r[1], 'status': r[2], 'at': iso(r[3])} for r in deliveries],
        }

    def set_read(self, account_id, message_ids, read: bool = True, now: int | None = None) -> int:
        """Marks the account's own replies read (or unread again). Ids of another account's replies change nothing."""
        ids = [i for i in (message_ids or []) if isinstance(i, str) and MESSAGE_ID_RE.match(i)][:200] if isinstance(message_ids, list) else []
        accounts = accounts_of(account_id)
        if not accounts or not ids:
            return 0
        with self._connect() as con:
            cursor = con.execute(f"update wa_inbound set read_at=? where account_id in ({','.join('?' * len(accounts))}) and message_id in ({','.join('?' * len(ids))})",
                                 (int(now or time.time()) if read else None, *accounts, *ids))
            return cursor.rowcount

    # ── owner review of replies nobody could be matched to ────────────────────────────────────────────────────────

    def unlinked(self, limit: int = 100) -> list:
        """Unlinked replies, newest first, each with the campaign messages sent to the same number (any age, any
        account) that it could be placed on. The number is masked; the caller adds business names from the directory."""
        limit = max(1, min(int(limit), 200))
        with self._connect() as con:
            rows = con.execute('select message_id, wa_id, kind, body, received_at from wa_inbound where link=? '
                               'order by received_at desc, rowid desc limit ?', ('unlinked', limit)).fetchall()
            out = []
            for message_id, wa_id, kind, body, received_at in rows:
                candidates = con.execute('select message_id, account_id, request_id, poi_key, sent_at, request_title from wa_outbound where wa_id=? '
                                         'order by sent_at desc limit 5', (wa_id,)).fetchall()
                out.append({'id': message_id, 'from': mask(wa_id), 'kind': kind, 'body': body, 'receivedAt': iso(received_at),
                            'candidates': [{'outboundId': c[0], 'accountId': c[1], 'requestId': c[2], 'poiKey': c[3], 'sentAt': iso(c[4]), 'requestTitle': c[5]} for c in candidates]})
        return out

    def attach(self, message_id: str, outbound_id: str, reviewer: str, now: int | None = None) -> bool:
        """Places an unlinked reply on a campaign message sent to the same number. Anything else is refused."""
        if not (MESSAGE_ID_RE.match(str(message_id or '')) and MESSAGE_ID_RE.match(str(outbound_id or '')) and valid_id(reviewer)):
            return False
        with self._connect() as con:
            row = con.execute('select o.message_id, o.account_id, o.request_id, o.poi_key from wa_inbound i join wa_outbound o on o.wa_id=i.wa_id '
                              'where i.message_id=? and i.link=? and o.message_id=?', (message_id, 'unlinked', outbound_id)).fetchone()
            if not row:
                return False
            con.execute('update wa_inbound set outbound_id=?, account_id=?, request_id=?, poi_key=?, link=?, reviewed_at=?, reviewed_by=? where message_id=?',
                        (row[0], row[1], row[2], row[3], 'manual', int(now or time.time()), reviewer, message_id))
        return True

    def dismiss(self, message_id: str, reviewer: str, now: int | None = None) -> bool:
        """Takes an unlinked reply off the review list; it stays stored and stays in nobody's inbox."""
        if not (MESSAGE_ID_RE.match(str(message_id or '')) and valid_id(reviewer)):
            return False
        with self._connect() as con:
            cursor = con.execute('update wa_inbound set link=?, reviewed_at=?, reviewed_by=? where message_id=? and link=?',
                                 ('dismissed', int(now or time.time()), reviewer, message_id, 'unlinked'))
            return cursor.rowcount == 1


# ── the webhook request ───────────────────────────────────────────────────────────────────────────────────────────────

def handle_post(raw: bytes, signature_header: str | None, app_secret: str | None, store: InboxStore,
                phone_number_id: str | None = None, now: int | None = None) -> tuple[int, dict]:
    """(HTTP status, JSON body) for one webhook POST. Unsigned or wrongly signed bodies are rejected before parsing."""
    if not app_secret:
        return 503, {'ok': False, 'error': 'WEBHOOK_NOT_CONFIGURED'}
    if len(raw or b'') > MAX_WEBHOOK_BYTES:
        return 413, {'ok': False, 'error': 'TOO_LARGE'}
    if not signature_ok(raw or b'', signature_header, app_secret):
        return 401, {'ok': False, 'error': 'BAD_SIGNATURE'}
    try:
        payload = json.loads(raw or b'{}')
    except (ValueError, UnicodeDecodeError):
        return 400, {'ok': False, 'error': 'BAD_JSON'}
    return 200, {'ok': True, **store.ingest(payload, phone_number_id, now)}


# ── staleness: a source that stops succeeding, including one whose poll hangs and never reports a failure ─────────

STALE_AFTER_SECONDS = 10 * 60
REALERT_SECONDS = 30 * 60


class StalenessWatch:
    """Says when to raise `ALERT inbox_source_stale`: once the source has had no success for `stale_after` seconds
    (counted from the start when it never succeeded), then again every `realert` seconds while it stays stale, and
    once more (`recovered`) when a success comes back. A poll that hangs on a connection never records a failure, so
    the failure counter alone cannot see it; this can."""

    def __init__(self, started_at: int, stale_after: int = STALE_AFTER_SECONDS, realert: int = REALERT_SECONDS):
        self.started_at = int(started_at)
        self.stale_after = int(stale_after)
        self.realert = int(realert)
        self.alerted_at = None

    def check(self, last_ok_at: int | None, now: int) -> dict | None:
        since = last_ok_at if last_ok_at else self.started_at
        age = int(now) - int(since)
        if age <= self.stale_after:
            if self.alerted_at is not None:
                self.alerted_at = None
                return {'event': 'recovered', 'age_seconds': age}
            return None
        if self.alerted_at is None or now - self.alerted_at >= self.realert:
            self.alerted_at = int(now)
            return {'event': 'stale', 'age_seconds': age, 'never_succeeded': not last_ok_at}
        return None


def prometheus_lines(source: str, last_ok_at: int | None, failures: int, now: int, running: bool) -> list:
    """Gauges for the existing authenticated /metrics, so any scraper can alert on the reply source: up (running, last
    poll succeeded, success within STALE_AFTER_SECONDS), age of the last success (-1 when never) and failures in a row."""
    label = re.sub(r'[^a-z0-9_]', '_', str(source).lower())[:40] or 'unknown'
    age = int(now) - int(last_ok_at) if last_ok_at else -1
    up = 1 if running and failures == 0 and 0 <= age <= STALE_AFTER_SECONDS else 0
    return [
        '# HELP atlas_inbox_source_up 1 when the WhatsApp reply source is running and read successfully in the last 10 minutes.',
        '# TYPE atlas_inbox_source_up gauge',
        f'atlas_inbox_source_up{{source="{label}"}} {up}',
        '# HELP atlas_inbox_source_last_ok_age_seconds Seconds since the reply source last read successfully (-1: never).',
        '# TYPE atlas_inbox_source_last_ok_age_seconds gauge',
        f'atlas_inbox_source_last_ok_age_seconds{{source="{label}"}} {age}',
        '# HELP atlas_inbox_source_failures_in_row Failed reads of the reply source since its last success.',
        '# TYPE atlas_inbox_source_failures_in_row gauge',
        f'atlas_inbox_source_failures_in_row{{source="{label}"}} {int(failures)}',
    ]
