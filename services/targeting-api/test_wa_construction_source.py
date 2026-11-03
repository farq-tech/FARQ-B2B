"""The construction inbox as a source of Atlas replies, against a fake construction database.

The fake is SQLite with the columns the construction migrations define (farq-tech/farq,
api/db/migrations/construction: company_inbox, conversation_channels, inbox_sending, whatsapp_status_events), attached
under the schema name `construction`, and opened read only: a write from the source would fail the test. Every row
is a fixed fake. Nothing is sent and no real database is touched.
"""
import datetime as dt
import json
import os
import sqlite3
import tempfile
import unittest

import wa_construction_source as source_mod
import wa_inbox

NUMBER = '966500000001'   # fake, got an Atlas campaign
OTHER = '966500000002'    # fake, a construction supplier Atlas never wrote to
T0 = 1_800_000_000

FAKE_SCHEMA = """
create table rfq_invites (id text primary key, rfq_version_id text, supplier_id text not null);
create table suppliers (id text primary key, external_key text unique, name_ar text);
create table supplier_contacts (supplier_id text primary key, contact_name text, whatsapp_e164 text, emails text);
create table inbox_messages (
  id text primary key, invite_id text not null, provider_email_id text, provider_event_id text not null,
  sender text not null, subject text not null, body_text text not null, body_truncated integer not null default 0,
  attachments text not null default '[]', received_at text not null, internet_message_id text,
  reference_ids text not null default '[]', reply_recipient text, kind_hint text not null default 'UNCLASSIFIED',
  correspondence_captured integer not null default 0, channel text not null default 'EMAIL', provider_message_id text,
  provider_sent_at text
);
create table inbox_unrouted_whatsapp (
  provider_message_id text primary key, sender text not null, body_text text not null, context_message_id text,
  reason text not null, received_at text not null
);
create table whatsapp_status_events (
  id text primary key, provider_message_id text not null, status text not null, provider_timestamp text,
  error_code integer, error_title text, error_details text, pricing_category text, callback_data text,
  phone_number_id text, received_at text not null
);
"""


def iso(seconds):
    return dt.datetime.fromtimestamp(seconds, dt.timezone.utc).isoformat()


class ConstructionSourceTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.dir.name, 'construction.sqlite3')
        con = sqlite3.connect(self.db)
        con.executescript(FAKE_SCHEMA)
        con.executemany('insert into suppliers values (?,?,?)', [
            ('s-catch', f'whatsapp:{NUMBER}', 'واتساب'), ('s-golden', 'golden:poi:1', 'مورد'), ('s-other', 'golden:poi:9', 'مورد آخر')])
        con.executemany('insert into supplier_contacts values (?,?,?,?)', [
            ('s-catch', 'x', None, '{}'), ('s-golden', 'x', '+966 50 000 0001', '{}'), ('s-other', 'x', OTHER, '{}')])
        con.executemany('insert into rfq_invites values (?,?,?)', [('i-catch', 'v1', 's-catch'), ('i-golden', 'v2', 's-golden'), ('i-other', 'v2', 's-other')])
        con.commit(); con.close()
        self.store = wa_inbox.InboxStore(os.path.join(self.dir.name, 'wa_inbox.sqlite3'))
        self.store.record_outbound('wamid.OUT1', 'org-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0)
        self.source = source_mod.ConstructionSource(self.connect_read_only, placeholder='?', time_param=iso)

    def tearDown(self):
        self.dir.cleanup()

    def connect_read_only(self):
        # the fake database attached as `construction`, read only: any write from the source raises
        con = sqlite3.connect('file::memory:', uri=True)
        con.execute('attach database ? as construction', (f'file:{self.db}?mode=ro',))
        return con

    def write(self, sql, rows):
        con = sqlite3.connect(self.db)
        con.executemany(sql, rows)
        con.commit(); con.close()

    def routed(self, *rows):
        self.write("insert into inbox_messages (id, invite_id, provider_event_id, sender, subject, body_text, received_at, channel, provider_message_id, provider_sent_at) "
                   "values (?,?,?,?,'رسالة واتساب',?,?,'WHATSAPP',?,?)", [(r[0], r[1], r[2], 'المورد', r[3], iso(r[4]), r[2], iso(r[4]) if r[4] else None) for r in rows])

    def unrouted(self, *rows):
        self.write('insert into inbox_unrouted_whatsapp values (?,?,?,?,?,?)', [(r[0], r[1], r[2], r[3], 'NO_MATCH', iso(r[4])) for r in rows])

    def test_a_catch_all_reply_is_read_by_the_number_in_its_supplier_key_and_linked(self):
        self.routed(('m1', 'i-catch', 'wamid.IN1', 'نعم مهتم', T0 + 60))
        result = self.source.poll(self.store, now=T0 + 120)
        self.assertEqual((result['new'], result['unlinked']), (1, 0))
        [message] = self.store.feed('org-1')['messages']
        self.assertEqual((message['id'], message['requestId'], message['poiKey'], message['body'], message['link']), ('wamid.IN1', 'cmp-1', 'poi:1', 'نعم مهتم', 'recent'))

    def test_a_reply_routed_to_an_rfq_is_read_by_the_contact_number(self):
        self.routed(('m1', 'i-golden', 'wamid.IN1', 'كم الكمية؟', T0 + 60))
        self.assertEqual(self.source.poll(self.store, now=T0 + 120)['new'], 1)
        self.assertEqual(self.store.feed('org-1')['messages'][0]['id'], 'wamid.IN1')

    def test_an_unrouted_reply_links_by_the_message_it_quotes(self):
        self.store.record_outbound('wamid.OUT2', 'org-2', 'cmp-2', 'poi:1', NUMBER, sent_at=T0 + 10)
        self.unrouted(('wamid.IN1', NUMBER, 'أرسلوا التفاصيل', 'wamid.OUT1', T0 + 60))
        self.source.poll(self.store, now=T0 + 120)
        [message] = self.store.feed('org-1')['messages']
        self.assertEqual(message['link'], 'context', 'the quoted message wins over the more recent campaign of org-2')
        self.assertEqual(self.store.feed('org-2')['messages'], [])

    def test_construction_conversations_with_numbers_atlas_never_wrote_to_stay_out(self):
        self.routed(('m1', 'i-other', 'wamid.RFQ1', 'عرض السعر مرفق', T0 + 60))
        self.unrouted(('wamid.RFQ2', OTHER, 'مرحبا', None, T0 + 70))
        result = self.source.poll(self.store, now=T0 + 120)
        self.assertEqual((result['read'], result['ours'], result['new']), (2, 0, 0))
        self.assertEqual(self.store.unlinked(), [], 'not even in the owner review')

    def test_polling_again_is_idempotent_and_the_cursor_moves_forward(self):
        self.routed(('m1', 'i-catch', 'wamid.IN1', 'أول', T0 + 60))
        self.assertEqual(self.source.poll(self.store, now=T0 + 120)['new'], 1)
        self.assertEqual(self.store.cursor('construction:routed'), str(T0 + 60))
        again = self.source.poll(self.store, now=T0 + 180)
        self.assertEqual((again['new'], again['duplicate']), (0, 1), 'the overlap re-reads it; the store keeps it once')
        self.routed(('m2', 'i-catch', 'wamid.IN2', 'ثانٍ', T0 + 4000))
        self.assertEqual(self.source.poll(self.store, now=T0 + 4100)['new'], 1)
        self.assertEqual(self.store.cursor('construction:routed'), str(T0 + 4000))
        self.assertEqual([m['id'] for m in self.store.feed('org-1')['messages']], ['wamid.IN2', 'wamid.IN1'])

    def test_a_row_written_late_inside_the_overlap_is_still_read(self):
        self.routed(('m2', 'i-catch', 'wamid.IN2', 'ثانٍ', T0 + 4000))
        self.source.poll(self.store, now=T0 + 4100)
        self.routed(('m1', 'i-catch', 'wamid.IN1', 'وصل متأخراً', T0 + 4000 - 600))
        self.assertEqual(self.source.poll(self.store, now=T0 + 4200)['new'], 1)

    def test_a_message_without_text_keeps_its_kind_not_the_placeholder_sentence(self):
        self.routed(('m1', 'i-catch', 'wamid.IMG', 'رسالة واتساب من نوع image — النص غير متاح', T0 + 60))
        self.source.poll(self.store, now=T0 + 120)
        [message] = self.store.feed('org-1')['messages']
        self.assertEqual((message['kind'], message['body']), ('image', ''))

    def test_delivery_receipts_of_atlas_messages_are_read_forward_only(self):
        self.write('insert into whatsapp_status_events (id, provider_message_id, status, provider_timestamp, received_at) values (?,?,?,?,?)', [
            ('e1', 'wamid.OUT1', 'delivered', iso(T0 + 5), iso(T0 + 6)), ('e2', 'wamid.OUT1', 'read', iso(T0 + 50), iso(T0 + 51)),
            ('e3', 'wamid.CONSTRUCTION', 'read', iso(T0), iso(T0))])
        self.assertEqual(self.source.poll(self.store, now=T0 + 120)['statuses'], 2, 'sent, then delivered, then read; the construction message is not ours')
        self.assertEqual(self.store.feed('org-1')['deliveries'][0]['status'], 'read')
        self.assertEqual(self.store.open_outbound_ids(T0 - 1), [], 'a read message is final: not asked again')

    def test_the_source_never_writes(self):
        con = self.connect_read_only()
        with self.assertRaises(sqlite3.OperationalError):
            con.execute("insert into construction.inbox_unrouted_whatsapp values ('x','1','b',null,'NO_MATCH','t')")
        con.close()
        for sql in (source_mod.ROUTED_SQL, source_mod.UNROUTED_SQL, source_mod.STATUS_SQL):
            self.assertTrue(sql.lstrip().lower().startswith('select'))


ARRIVALS_SCHEMA = """
create table inbox_arrivals (
  id text primary key, owner_id text, provider text not null, account_id text not null, external_id text not null,
  state text not null, candidate_invites text not null default '[]', invite_id text, message_id text,
  evidence text not null default '{}', payload text not null default '{}', payload_hash text not null,
  occurred_at text, ingested_at text not null default '', revision integer not null default 1, resolved_by text,
  resolved_at text, resolution_reason text, unique(provider, account_id, external_id)
);
"""


class RoutingRecordTests(unittest.TestCase):
    """With the construction routing record (inbox_arrivals) present."""
    setUp = ConstructionSourceTests.setUp
    tearDown = ConstructionSourceTests.tearDown
    connect_read_only = ConstructionSourceTests.connect_read_only
    write = ConstructionSourceTests.write
    routed = ConstructionSourceTests.routed

    def arrival(self, message_id, reason):
        con = sqlite3.connect(self.db)
        if not con.execute("select 1 from sqlite_master where name='inbox_arrivals'").fetchone():
            con.executescript(ARRIVALS_SCHEMA)
        con.execute("insert into inbox_arrivals (id, provider, account_id, external_id, state, evidence, payload_hash) values (?,?,?,?,?,?,?)",
                    (f'a-{message_id}', 'WHATSAPP', 'PHONE', message_id, 'RESOLVED', json.dumps({'resolver_version': 1, 'reason': reason}), 'h'))
        con.commit(); con.close()

    def test_a_reply_that_quoted_a_construction_message_is_left_out(self):
        self.routed(('m1', 'i-golden', 'wamid.RFQ', 'هذا عرضنا لطلبكم', T0 + 60), ('m2', 'i-golden', 'wamid.ATLAS', 'نعم مهتم', T0 + 70))
        self.arrival('wamid.RFQ', 'WHATSAPP_CONTEXT')
        self.arrival('wamid.ATLAS', 'LATEST_FOR_SENDER')
        result = self.source.poll(self.store, now=T0 + 120)
        self.assertEqual((result['quotesConstruction'], result['new']), (1, 1))
        self.assertEqual([m['id'] for m in self.store.feed('org-1')['messages']], ['wamid.ATLAS'])

    def test_a_routed_reply_without_a_routing_record_is_read_as_before(self):
        self.arrival('wamid.OTHER', 'LATEST_FOR_SENDER')
        self.routed(('m1', 'i-catch', 'wamid.IN1', 'نعم', T0 + 60))
        self.assertEqual(self.source.poll(self.store, now=T0 + 120)['new'], 1)


class HelperTests(unittest.TestCase):
    def test_the_routing_reason_reads_from_jsonb_or_text(self):
        self.assertEqual(source_mod.routing_reason({'reason': 'WHATSAPP_CONTEXT'}), 'WHATSAPP_CONTEXT')
        self.assertEqual(source_mod.routing_reason('{"reason": "LATEST_FOR_SENDER"}'), 'LATEST_FOR_SENDER')
        self.assertIsNone(source_mod.routing_reason(None))
        self.assertIsNone(source_mod.routing_reason('not json'))

    def test_timestamps_from_postgres_and_text_read_the_same(self):
        moment = dt.datetime(2027, 1, 15, 8, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(source_mod.epoch(moment), source_mod.epoch('2027-01-15T08:00:00+00:00'))
        self.assertEqual(source_mod.epoch('2027-01-15T08:00:00Z'), int(moment.timestamp()))
        self.assertIsNone(source_mod.epoch('not a time'))
        self.assertIsNone(source_mod.epoch(None))

    def test_numbers_come_from_the_catch_all_key_or_the_contact(self):
        self.assertEqual(source_mod.routed_number(f'whatsapp:{NUMBER}', None), NUMBER)
        self.assertEqual(source_mod.routed_number('golden:poi:1', '+966 50 000 0001'), NUMBER)
        self.assertEqual(source_mod.routed_number('golden:poi:1', None), '')


if __name__ == '__main__':
    unittest.main()
