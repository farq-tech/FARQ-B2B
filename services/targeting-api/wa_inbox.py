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
* ``feed`` returns one account's messages with the request and poi_key they answer. Numbers never leave the service.

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
  status_at integer
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
  stored_at integer not null
);
create index if not exists wa_inbound_by_account on wa_inbound (account_id, received_at desc);
"""


def digits(value) -> str:
    """A WhatsApp number as digits only (wa_id form, e.g. 9665XXXXXXXX)."""
    return re.sub(r'\D', '', str(value or ''))


def valid_id(value) -> bool:
    return isinstance(value, str) and bool(ID_RE.match(value))


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
                    self._ready = True
                with con:
                    yield con
            finally:
                con.close()

    def record_outbound(self, message_id, account_id, request_id, poi_key, to, sent_at=None) -> bool:
        """Remember one campaign message we sent, so its reply can be linked back. Returns False when an id is not
        usable (nothing stored); a repeated message id keeps the first record."""
        number = digits(to)
        if not (MESSAGE_ID_RE.match(str(message_id or '')) and valid_id(account_id) and valid_id(request_id)
                and isinstance(poi_key, str) and 1 <= len(poi_key) <= 200 and 8 <= len(number) <= 15):
            return False
        with self._connect() as con:
            con.execute('insert or ignore into wa_outbound (message_id, account_id, request_id, poi_key, wa_id, sent_at) values (?,?,?,?,?,?)',
                        (message_id, account_id, request_id, poi_key, number, int(sent_at or time.time())))
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
        messages, statuses = parse_events(payload, phone_number_id)
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

    def feed(self, account_id: str, since: int | None = None, limit: int = 200) -> dict:
        """One account's linked replies (newest first) and the delivery status of its campaign messages. No numbers."""
        if not valid_id(account_id):
            return {'messages': [], 'deliveries': []}
        limit = max(1, min(int(limit), 500))
        with self._connect() as con:
            rows = con.execute('select message_id, request_id, poi_key, kind, body, received_at, link from wa_inbound '
                               'where account_id=? and received_at>=? order by received_at desc, rowid desc limit ?',
                               (account_id, int(since or 0), limit)).fetchall()
            deliveries = con.execute('select request_id, poi_key, status, coalesce(status_at, sent_at) from wa_outbound '
                                     'where account_id=? order by sent_at desc limit 1000', (account_id,)).fetchall()
        iso = lambda seconds: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(seconds))
        return {
            'messages': [{'id': r[0], 'requestId': r[1], 'poiKey': r[2], 'kind': r[3], 'body': r[4], 'receivedAt': iso(r[5]), 'link': r[6]} for r in rows],
            'deliveries': [{'requestId': r[0], 'poiKey': r[1], 'status': r[2], 'at': iso(r[3])} for r in deliveries],
        }


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
