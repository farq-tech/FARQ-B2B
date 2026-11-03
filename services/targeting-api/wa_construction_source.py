"""Atlas inbox source: WhatsApp replies read from the construction inbox (read only).

The construction API (`farq-construction-api`) owns the Meta webhook of the number Atlas sends from, so Meta delivers
every reply there and its inbox stores it (api/lib/construction/conversation-capture.js in farq-tech/farq):

* ``construction.inbox_messages`` (``channel='WHATSAPP'``): a reply routed to an RFQ invite, including the catch-all
  holder request (``CONSTRUCTION_WHATSAPP_CATCHALL_RFQ_ID``) that takes messages from numbers no request contacted.
  The number is not on the row: it is the supplier's ``external_key`` (``whatsapp:<msisdn>``, catch-all) or its
  ``supplier_contacts.whatsapp_e164``. The quoted message id is not stored for these rows.
* ``construction.inbox_unrouted_whatsapp``: a reply held because its number matched no request (or more than one),
  with the sender's number and the quoted message id.
* ``construction.whatsapp_status_events``: delivery receipts (sent, delivered, read, failed) of every message the
  number sent, Atlas campaign messages included.

This module only runs SELECT statements, on a connection opened read only. It brings in only messages from numbers
an Atlas campaign message was sent to (``InboxStore.known_numbers``), so construction RFQ conversations stay out of
Atlas; those it brings in are linked by wa_inbox's own rules (quoted message, else the most recent campaign to that
number within 30 days, else unlinked). Each table is read from a cursor (the newest ``received_at`` seen) minus an
overlap, so a row written a little late is still read; the store keeps every message once, so a re-read is harmless.
"""
from __future__ import annotations

import datetime as dt
import re
import time

import wa_inbox

OVERLAP_SECONDS = 30 * 60
PAGE = 2000
# conversation-capture.js stores a message without text as this sentence
NON_TEXT = re.compile(r'^رسالة واتساب من نوع (\w{1,40}) — النص غير متاح$')

ROUTED_SQL = """select m.provider_message_id, m.body_text, m.received_at, m.provider_sent_at, s.external_key, c.whatsapp_e164
from construction.inbox_messages m
join construction.rfq_invites i on i.id = m.invite_id
join construction.suppliers s on s.id = i.supplier_id
left join construction.supplier_contacts c on c.supplier_id = s.id
where m.channel = 'WHATSAPP' and m.received_at >= {p}
order by m.received_at
limit {n}"""

UNROUTED_SQL = """select provider_message_id, sender, body_text, context_message_id, received_at
from construction.inbox_unrouted_whatsapp
where received_at >= {p}
order by received_at
limit {n}"""

STATUS_SQL = """select provider_message_id, status, provider_timestamp, received_at
from construction.whatsapp_status_events
where provider_message_id in ({ids})"""


def epoch(value) -> int | None:
    """A timestamptz from Postgres (datetime) or the fake database (ISO text) as epoch seconds."""
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
        return int(moment.timestamp())
    try:
        moment = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return int((moment if moment.tzinfo else moment.replace(tzinfo=dt.timezone.utc)).timestamp())


def text_and_kind(body) -> tuple[str, str]:
    body = str(body or '')[:wa_inbox.MAX_BODY_CHARS]
    match = NON_TEXT.match(body.strip())
    if match:
        kind = match.group(1).lower()
        return (kind if kind in wa_inbox.NON_TEXT_KINDS else 'unsupported'), ''
    return 'text', body


def routed_number(external_key, whatsapp_e164) -> str:
    key = str(external_key or '')
    if key.startswith('whatsapp:'):
        return wa_inbox.digits(key[len('whatsapp:'):])
    return wa_inbox.digits(whatsapp_e164)


class ConstructionSource:
    """`connect()` returns a DB-API connection to the construction database, opened read only by the caller.
    `placeholder` is the driver's parameter mark ('%s' for psycopg, '?' for sqlite3); `time_param` turns epoch
    seconds into the value the driver compares with a timestamptz."""

    def __init__(self, connect, placeholder: str = '%s', time_param=None, overlap: int = OVERLAP_SECONDS, page: int = PAGE):
        self.connect = connect
        self.p = placeholder
        self.time_param = time_param or (lambda seconds: dt.datetime.fromtimestamp(seconds, dt.timezone.utc))
        self.overlap = int(overlap)
        self.page = int(page)

    def _since(self, store, name: str, now: int) -> int:
        saved = store.cursor(name)
        start = int(saved) if saved and saved.isdigit() else now - 30 * 86400   # first run: the link window
        return max(0, start - self.overlap)

    def poll(self, store: 'wa_inbox.InboxStore', now: int | None = None) -> dict:
        now = int(now or time.time())
        out = {'read': 0, 'ours': 0, 'new': 0, 'duplicate': 0, 'unlinked': 0, 'statuses': 0}
        con = self.connect()
        try:
            cur = con.cursor()
            # replies routed to a construction conversation (incl. the catch-all holder)
            since = self._since(store, 'construction:routed', now)
            cur.execute(ROUTED_SQL.format(p=self.p, n=self.page), (self.time_param(since),))
            routed = cur.fetchall()
            # replies held unrouted, with the number and the quoted message id
            since_u = self._since(store, 'construction:unrouted', now)
            cur.execute(UNROUTED_SQL.format(p=self.p, n=self.page), (self.time_param(since_u),))
            unrouted = cur.fetchall()
            candidates = []
            newest_routed = newest_unrouted = None
            for message_id, body, received_at, provider_sent_at, external_key, e164 in routed:
                at = epoch(received_at)
                newest_routed = max(newest_routed or 0, at or 0)
                kind, text = text_and_kind(body)
                candidates.append({'message_id': str(message_id or ''), 'wa_id': routed_number(external_key, e164), 'kind': kind, 'body': text,
                                   'received_at': epoch(provider_sent_at) or at or now, 'context_id': ''})
            for message_id, sender, body, context_id, received_at in unrouted:
                at = epoch(received_at)
                newest_unrouted = max(newest_unrouted or 0, at or 0)
                kind, text = text_and_kind(body)
                context = str(context_id or '')
                candidates.append({'message_id': str(message_id or ''), 'wa_id': wa_inbox.digits(sender), 'kind': kind, 'body': text,
                                   'received_at': at or now, 'context_id': context if wa_inbox.MESSAGE_ID_RE.match(context) else ''})
            out['read'] = len(candidates)
            valid = [m for m in candidates if wa_inbox.MESSAGE_ID_RE.match(m['message_id']) and 8 <= len(m['wa_id']) <= 15]
            ours = store.known_numbers(m['wa_id'] for m in valid)
            messages = [m for m in valid if m['wa_id'] in ours]
            out['ours'] = len(messages)
            # receipts of our own campaign messages that are not final yet
            statuses = []
            open_ids = store.open_outbound_ids(now - 30 * 86400)
            for start in range(0, len(open_ids), 200):
                chunk = open_ids[start:start + 200]
                cur.execute(STATUS_SQL.format(ids=','.join([self.p] * len(chunk))), chunk)
                for message_id, state, provider_ts, received_at in cur.fetchall():
                    if state in ('sent', 'delivered', 'read', 'failed'):
                        statuses.append({'message_id': str(message_id), 'status': state, 'at': epoch(provider_ts) or epoch(received_at) or now})
        finally:
            try: con.rollback()   # nothing was written; end the read-only transaction
            except Exception: pass
            con.close()
        # rows come back in no fixed order: apply in rank order so each receipt moves the state one step forward
        statuses.sort(key=lambda st: (st['message_id'], wa_inbox.STATUS_RANK.get(st['status'], 0)))
        result = store.ingest_events(messages, statuses, now)
        out.update({k: result[k] for k in ('new', 'duplicate', 'unlinked', 'statuses')})
        # the cursors move only after the store has the rows
        if newest_routed:
            store.set_cursor('construction:routed', str(newest_routed), now)
        if newest_unrouted:
            store.set_cursor('construction:unrouted', str(newest_unrouted), now)
        return out


def postgres_source(db_url: str) -> ConstructionSource:
    """The production source: psycopg, read-only session (default_transaction_read_only) and read-only connection."""
    def connect():
        import psycopg
        con = psycopg.connect(db_url, sslmode='require', connect_timeout=15, options='-c default_transaction_read_only=on')
        con.read_only = True
        return con
    return ConstructionSource(connect)
