"""Atlas inbox webhook: signature, subscription check, idempotency, linking and the per-account feed.

Every payload here is a fixed fake. Nothing is sent and Meta is never called: wa_inbox has no network code at all.
"""
import hashlib
import hmac
import json
import os
import tempfile
import unittest

import wa_inbox

SECRET = 'test-app-secret-not-real'
NUMBER = '966500000001'      # fake recipient
OTHER = '966500000002'
PHONE_ID = '100000000000001'  # fake sending number id
T0 = 1_800_000_000


def sign(raw: bytes, secret: str = SECRET) -> str:
    return 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def body(messages=(), statuses=(), phone_number_id=PHONE_ID) -> bytes:
    value = {'messaging_product': 'whatsapp', 'metadata': {'display_phone_number': '000', 'phone_number_id': phone_number_id}}
    if messages:
        value['contacts'] = [{'wa_id': m['from'], 'profile': {'name': 'fake'}} for m in messages]
        value['messages'] = list(messages)
    if statuses:
        value['statuses'] = list(statuses)
    payload = {'object': 'whatsapp_business_account', 'entry': [{'id': 'WABA', 'changes': [{'field': 'messages', 'value': value}]}]}
    return json.dumps(payload).encode()


def text(message_id, sender=NUMBER, words='نعم مهتم', at=T0 + 60, context=None):
    message = {'from': sender, 'id': message_id, 'timestamp': str(at), 'type': 'text', 'text': {'body': words}}
    if context:
        message['context'] = {'from': PHONE_ID, 'id': context}
    return message


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = wa_inbox.InboxStore(os.path.join(self.dir.name, 'inbox', 'wa_inbox.sqlite3'))

    def tearDown(self):
        self.dir.cleanup()

    def post(self, raw, signature=None, secret=SECRET):
        return wa_inbox.handle_post(raw, sign(raw) if signature is None else signature, secret, self.store, PHONE_ID, now=T0 + 3600)


class SignatureTests(Base):
    def test_valid_signature_is_accepted(self):
        raw = body([text('wamid.A')])
        status, result = self.post(raw)
        self.assertEqual(status, 200)
        self.assertEqual(result['new'], 1)

    def test_unsigned_wrong_and_tampered_bodies_are_rejected_before_parsing(self):
        raw = body([text('wamid.A')])
        self.assertEqual(self.post(raw, signature='')[0], 401)
        self.assertEqual(self.post(raw, signature='sha256=' + '0' * 64)[0], 401)
        self.assertEqual(self.post(raw, signature=sign(raw, 'another-secret'))[0], 401)
        self.assertEqual(self.post(raw, signature=sign(raw)[7:])[0], 401, 'the sha256= prefix is required')
        self.assertEqual(self.post(raw + b' ', signature=sign(raw))[0], 401, 'one changed byte breaks the signature')
        self.assertEqual(self.post(b'not json', signature=sign(b'not json'))[0], 400)
        self.assertEqual(self.store.feed('acct-1')['messages'], [])

    def test_uppercase_hex_signature_is_accepted(self):
        raw = body([text('wamid.A')])
        self.assertEqual(self.post(raw, signature='sha256=' + sign(raw)[7:].upper())[0], 200)

    def test_missing_app_secret_refuses_everything(self):
        raw = body([text('wamid.A')])
        self.assertEqual(wa_inbox.handle_post(raw, sign(raw), '', self.store)[0], 503)
        self.assertFalse(wa_inbox.signature_ok(raw, sign(raw), None))

    def test_oversized_body_is_refused(self):
        raw = b'x' * (wa_inbox.MAX_WEBHOOK_BYTES + 1)
        self.assertEqual(self.post(raw)[0], 413)


class VerifyTests(unittest.TestCase):
    def test_subscription_check_echoes_the_challenge_only_for_our_token(self):
        query = {'hub.mode': ['subscribe'], 'hub.verify_token': ['fake-verify'], 'hub.challenge': ['1158201444']}
        self.assertEqual(wa_inbox.handle_verify(query, 'fake-verify'), (200, '1158201444'))
        self.assertEqual(wa_inbox.handle_verify({**query, 'hub.verify_token': ['wrong']}, 'fake-verify')[0], 403)
        self.assertEqual(wa_inbox.handle_verify({**query, 'hub.mode': ['unsubscribe']}, 'fake-verify')[0], 403)
        self.assertEqual(wa_inbox.handle_verify({**query, 'hub.challenge': ['<script>']}, 'fake-verify')[0], 400)
        self.assertEqual(wa_inbox.handle_verify(query, '')[0], 503, 'no token configured: never verified')


class IdempotencyTests(Base):
    def test_the_same_message_delivered_twice_is_stored_once(self):
        self.store.record_outbound('wamid.OUT1', 'acct-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0)
        raw = body([text('wamid.IN1')])
        self.assertEqual(self.post(raw)[1]['new'], 1)
        second = self.post(raw)[1]
        self.assertEqual((second['new'], second['duplicate']), (0, 1))
        # the same id inside a different (retried) body is still one message
        self.assertEqual(self.post(body([text('wamid.IN1', words='تعديل')]))[1]['duplicate'], 1)
        messages = self.store.feed('acct-1')['messages']
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]['body'], 'نعم مهتم', 'the first copy is kept')

    def test_status_updates_only_move_forward_and_only_for_our_messages(self):
        self.store.record_outbound('wamid.OUT1', 'acct-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0)
        st = lambda state, at: {'id': 'wamid.OUT1', 'status': state, 'timestamp': str(at), 'recipient_id': NUMBER}
        self.post(body(statuses=[st('read', T0 + 20)]))
        self.post(body(statuses=[st('delivered', T0 + 10)]))      # late, out of order
        self.post(body(statuses=[st('failed', T0 + 30)]))         # cannot undo a read
        self.post(body(statuses=[{'id': 'wamid.NOT_OURS', 'status': 'read', 'timestamp': str(T0)}]))
        deliveries = self.store.feed('acct-1')['deliveries']
        self.assertEqual([(d['poiKey'], d['status']) for d in deliveries], [('poi:1', 'read')])

    def test_failed_replaces_sent(self):
        self.store.record_outbound('wamid.OUT1', 'acct-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0)
        self.post(body(statuses=[{'id': 'wamid.OUT1', 'status': 'failed', 'timestamp': str(T0 + 5)}]))
        self.assertEqual(self.store.feed('acct-1')['deliveries'][0]['status'], 'failed')


class LinkingTests(Base):
    def test_a_reply_links_to_the_most_recent_campaign_sent_to_that_number(self):
        self.store.record_outbound('wamid.OLD', 'acct-1', 'cmp-old', 'poi:1', '+966 50 000 0001', sent_at=T0 - 86400)
        self.store.record_outbound('wamid.NEW', 'acct-1', 'cmp-new', 'poi:1', NUMBER, sent_at=T0)
        self.post(body([text('wamid.IN1')]))
        [message] = self.store.feed('acct-1')['messages']
        self.assertEqual((message['requestId'], message['poiKey'], message['link']), ('cmp-new', 'poi:1', 'recent'))

    def test_a_quoted_reply_links_to_the_message_it_quotes_even_when_older(self):
        self.store.record_outbound('wamid.OLD', 'acct-2', 'cmp-old', 'poi:9', NUMBER, sent_at=T0 - 86400)
        self.store.record_outbound('wamid.NEW', 'acct-1', 'cmp-new', 'poi:1', NUMBER, sent_at=T0)
        self.post(body([text('wamid.IN1', context='wamid.OLD')]))
        self.assertEqual(self.store.feed('acct-1')['messages'], [])
        [message] = self.store.feed('acct-2')['messages']
        self.assertEqual((message['requestId'], message['link']), ('cmp-old', 'context'))

    def test_a_reply_from_an_unknown_or_long_silent_number_is_unlinked_and_shown_to_nobody(self):
        self.store.record_outbound('wamid.OUT1', 'acct-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0 - 40 * 86400)
        result = self.post(body([text('wamid.IN1'), text('wamid.IN2', sender=OTHER)]))[1]
        self.assertEqual((result['new'], result['unlinked']), (2, 2))
        self.assertEqual(self.store.feed('acct-1')['messages'], [])

    def test_a_campaign_sent_after_the_reply_does_not_claim_it(self):
        self.store.record_outbound('wamid.OUT1', 'acct-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0 + 86400)
        self.assertEqual(self.post(body([text('wamid.IN1')]))[1]['unlinked'], 1)

    def test_messages_to_another_number_of_the_app_are_ignored(self):
        self.store.record_outbound('wamid.OUT1', 'acct-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0)
        result = self.post(body([text('wamid.IN1')], phone_number_id='999'))[1]
        self.assertEqual(result['new'], 0)

    def test_only_the_owning_account_reads_its_messages_and_no_number_leaves(self):
        self.store.record_outbound('wamid.OUT1', 'acct-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0)
        self.store.record_outbound('wamid.OUT2', 'acct-2', 'cmp-2', 'poi:2', OTHER, sent_at=T0)
        self.post(body([text('wamid.IN1'), text('wamid.IN2', sender=OTHER, words='كم السعر؟')]))
        one, two = self.store.feed('acct-1'), self.store.feed('acct-2')
        self.assertEqual([m['id'] for m in one['messages']], ['wamid.IN1'])
        self.assertEqual([m['id'] for m in two['messages']], ['wamid.IN2'])
        self.assertEqual(self.store.feed('acct-3'), {'messages': [], 'deliveries': []})
        self.assertEqual(self.store.feed("acct-1' or 1=1 --"), {'messages': [], 'deliveries': []})
        dump = json.dumps([one, two])
        self.assertNotIn(NUMBER, dump)
        self.assertNotIn(OTHER, dump)

    def test_non_text_messages_name_their_kind_and_keep_only_a_caption(self):
        self.store.record_outbound('wamid.OUT1', 'acct-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0)
        image = {'from': NUMBER, 'id': 'wamid.IMG', 'timestamp': str(T0 + 70), 'type': 'image',
                 'image': {'id': 'media-1', 'mime_type': 'image/jpeg', 'caption': 'الكتالوج'}}
        button = {'from': NUMBER, 'id': 'wamid.BTN', 'timestamp': str(T0 + 80), 'type': 'button', 'button': {'text': 'مهتم', 'payload': 'x'}}
        odd = {'from': NUMBER, 'id': 'wamid.ODD', 'timestamp': str(T0 + 90), 'type': 'something_new'}
        self.post(body([image, button, odd]))
        got = {m['id']: (m['kind'], m['body']) for m in self.store.feed('acct-1')['messages']}
        self.assertEqual(got, {'wamid.IMG': ('image', 'الكتالوج'), 'wamid.BTN': ('button', 'مهتم'), 'wamid.ODD': ('unsupported', '')})

    def test_unusable_outbound_records_are_not_stored(self):
        self.assertFalse(self.store.record_outbound('', 'acct-1', 'cmp-1', 'poi:1', NUMBER))
        self.assertFalse(self.store.record_outbound('wamid.X', 'bad id!', 'cmp-1', 'poi:1', NUMBER))
        self.assertFalse(self.store.record_outbound('wamid.X', 'acct-1', 'cmp-1', 'poi:1', '123'))
        self.assertTrue(self.store.record_outbound('wamid.X', 'acct-1', 'cmp-1', 'poi:1', NUMBER))


class ReadStateTests(Base):
    def test_read_state_is_kept_per_account_and_cannot_touch_another_account(self):
        self.store.record_outbound('wamid.OUT1', 'org-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0, sender_id='user-1')
        self.store.record_outbound('wamid.OUT2', 'org-2', 'cmp-2', 'poi:2', OTHER, sent_at=T0)
        self.post(body([text('wamid.IN1'), text('wamid.IN2', sender=OTHER)]))
        self.assertEqual([m['read'] for m in self.store.feed('org-1')['messages']], [False])
        self.assertEqual(self.store.set_read('org-1', ['wamid.IN1', 'wamid.IN2']), 1, "org-2's reply is not org-1's to mark")
        self.assertTrue(self.store.feed('org-1')['messages'][0]['read'])
        self.assertFalse(self.store.feed('org-2')['messages'][0]['read'])
        self.assertEqual(self.store.set_read('org-1', ['wamid.IN1'], read=False), 1)
        self.assertFalse(self.store.feed('org-1')['messages'][0]['read'])
        self.assertEqual(self.store.set_read('bad id!', ['wamid.IN1']), 0)
        self.assertEqual(self.store.set_read('org-1', ["x' or '1'='1"]), 0)
        self.assertEqual(self.store.set_read('org-1', 'wamid.IN1'), 0, 'ids must be a list')

    def test_a_person_reads_their_organisation_and_their_own_fallback_account_together(self):
        self.store.record_outbound('wamid.OUT1', 'org-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0)
        self.store.record_outbound('wamid.OUT2', 'user-7', 'cmp-2', 'poi:2', OTHER, sent_at=T0)
        self.post(body([text('wamid.IN1'), text('wamid.IN2', sender=OTHER)]))
        self.assertEqual(sorted(m['id'] for m in self.store.feed(['org-1', 'user-7'])['messages']), ['wamid.IN1', 'wamid.IN2'])
        self.assertEqual(self.store.set_read(['org-1', 'user-7'], ['wamid.IN1', 'wamid.IN2']), 2)
        self.assertEqual(self.store.feed(['bad id!']), {'messages': [], 'deliveries': []})

    def test_deliveries_report_the_newest_message_per_recipient(self):
        self.store.record_outbound('wamid.OLD', 'org-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0 - 100)
        self.store.record_outbound('wamid.NEW', 'org-1', 'cmp-1', 'poi:1', NUMBER, sent_at=T0)
        self.post(body(statuses=[{'id': 'wamid.OLD', 'status': 'read', 'timestamp': str(T0)}]))
        self.assertEqual([(d['poiKey'], d['status']) for d in self.store.feed('org-1')['deliveries']], [('poi:1', 'sent')])

    def test_a_store_from_the_first_release_gains_the_new_columns(self):
        import sqlite3
        path = os.path.join(self.dir.name, 'old.sqlite3')
        con = sqlite3.connect(path)
        con.executescript(wa_inbox.SCHEMA.replace(',\n  sender_id text,\n  request_title text', '').replace(',\n  read_at integer,\n  reviewed_at integer,\n  reviewed_by text', ''))
        con.execute("insert into wa_outbound (message_id, account_id, request_id, poi_key, wa_id, sent_at) values ('wamid.O','org-1','cmp-1','poi:1',?,?)", (NUMBER, T0))
        con.commit(); con.close()
        store = wa_inbox.InboxStore(path)
        raw = body([text('wamid.IN1')])
        self.assertEqual(wa_inbox.handle_post(raw, sign(raw), SECRET, store, PHONE_ID)[0], 200)
        self.assertEqual(store.set_read('org-1', ['wamid.IN1']), 1)
        self.assertTrue(store.feed('org-1')['messages'][0]['read'])
        self.assertTrue(store.record_outbound('wamid.O2', 'org-1', 'cmp-2', 'poi:2', OTHER, sent_at=T0, request_title='حملة'))


class OwnerReviewTests(Base):
    def setUp(self):
        super().setUp()
        self.store.record_outbound('wamid.OLD', 'org-2', 'cmp-old', 'poi:1', NUMBER, sent_at=T0 - 60 * 86400)
        self.store.record_outbound('wamid.ELSE', 'org-3', 'cmp-else', 'poi:2', OTHER, sent_at=T0)
        self.post(body([text('wamid.IN1'), text('wamid.IN2', sender='966500000009')]))

    def test_the_review_list_masks_the_number_and_offers_only_messages_sent_to_it(self):
        listed = {m['id']: m for m in self.store.unlinked()}
        self.assertEqual(set(listed), {'wamid.IN1', 'wamid.IN2'})
        self.assertEqual(listed['wamid.IN1']['from'], '9665****01')
        self.assertEqual([c['outboundId'] for c in listed['wamid.IN1']['candidates']], ['wamid.OLD'])
        self.assertEqual(listed['wamid.IN2']['candidates'], [])
        self.assertNotIn(NUMBER, json.dumps(listed))

    def test_attach_places_a_reply_only_on_a_message_sent_to_the_same_number(self):
        self.assertFalse(self.store.attach('wamid.IN1', 'wamid.ELSE', 'owner-1'), 'another number: refused')
        self.assertFalse(self.store.attach('wamid.IN1', 'wamid.NOPE', 'owner-1'))
        self.assertTrue(self.store.attach('wamid.IN1', 'wamid.OLD', 'owner-1'))
        [message] = self.store.feed('org-2')['messages']
        self.assertEqual((message['requestId'], message['poiKey'], message['link']), ('cmp-old', 'poi:1', 'manual'))
        self.assertFalse(self.store.attach('wamid.IN1', 'wamid.OLD', 'owner-1'), 'only an unlinked reply can be placed')
        self.assertEqual([m['id'] for m in self.store.unlinked()], ['wamid.IN2'])

    def test_dismiss_takes_a_reply_off_the_list_and_out_of_every_inbox(self):
        self.assertTrue(self.store.dismiss('wamid.IN2', 'owner-1'))
        self.assertFalse(self.store.dismiss('wamid.IN2', 'owner-1'))
        self.assertEqual([m['id'] for m in self.store.unlinked()], ['wamid.IN1'])
        self.assertFalse(self.store.attach('wamid.IN2', 'wamid.OLD', 'owner-1'))


class TitleAndHealthTests(Base):
    def test_the_owner_review_names_each_candidate_by_its_request_title(self):
        self.store.record_outbound('wamid.OLD', 'org-2', 'cmp-old', 'poi:1', NUMBER, sent_at=T0 - 60 * 86400,
                                   request_title='  حملة <b>مخابز</b>\n العليا ')
        self.post(body([text('wamid.IN1')]))
        [message] = self.store.unlinked()
        self.assertEqual(message['candidates'][0]['requestTitle'], 'حملة b مخابز /b العليا', 'one line, no markup')
        self.assertIsNone(wa_inbox.clean_title(None))
        self.assertEqual(len(wa_inbox.clean_title('x' * 500)), 200)

    def test_poll_health_keeps_the_last_success_the_last_error_kind_and_the_failures_in_a_row(self):
        self.assertEqual(self.store.health('construction_db')['lastOkAt'], None)
        self.assertEqual(self.store.record_poll('construction_db', True, counts={'new': 2}, now=T0), 0)
        self.assertEqual(self.store.record_poll('construction_db', False, 'InsufficientPrivilege', now=T0 + 60), 1)
        self.assertEqual(self.store.record_poll('construction_db', False, 'psycopg.errors.InsufficientPrivilege!', now=T0 + 120), 2)
        health = self.store.health('construction_db')
        self.assertEqual((health['failures'], health['lastErrorKind'], health['lastCounts']), (2, 'psycopg.errors.InsufficientPrivilege', {'new': 2}))
        self.assertEqual(health['lastOkAt'], wa_inbox.iso(T0))
        self.assertEqual(self.store.record_poll('construction_db', True, now=T0 + 180), 0)
        self.assertEqual(self.store.health('construction_db')['failures'], 0)
        self.assertEqual(self.store.health('construction_db')['lastErrorKind'], 'psycopg.errors.InsufficientPrivilege', 'the last error stays visible')



class StalenessTests(Base):
    def test_a_source_with_no_success_for_ten_minutes_alerts_once_then_every_half_hour_then_recovers(self):
        watch = wa_inbox.StalenessWatch(started_at=T0)
        self.assertIsNone(watch.check(None, T0 + 300), 'starting up: not stale yet')
        first = watch.check(None, T0 + 601)
        self.assertEqual((first['event'], first['never_succeeded']), ('stale', True))
        self.assertIsNone(watch.check(None, T0 + 1200), 'no repeat within 30 minutes')
        self.assertEqual(watch.check(None, T0 + 601 + 1800)['event'], 'stale')
        self.assertEqual(watch.check(T0 + 2500, T0 + 2510), {'event': 'recovered', 'age_seconds': 10})
        self.assertIsNone(watch.check(T0 + 2500, T0 + 2520))
        hung = watch.check(T0 + 2500, T0 + 2500 + 700)
        self.assertEqual((hung['event'], hung['never_succeeded']), ('stale', False), 'a hung poll records no failure; age still counts')

    def test_metrics_gauges_say_up_age_and_failures(self):
        self.store.record_poll('construction_db', True, now=T0)
        last_ok, failures = self.store.health_epochs('construction_db')
        self.assertEqual((last_ok, failures), (T0, 0))
        up = wa_inbox.prometheus_lines('construction_db', last_ok, failures, T0 + 60, True)
        self.assertIn('atlas_inbox_source_up{source="construction_db"} 1', up)
        self.assertIn('atlas_inbox_source_last_ok_age_seconds{source="construction_db"} 60', up)
        self.store.record_poll('construction_db', False, 'InsufficientPrivilege', now=T0 + 120)
        down = wa_inbox.prometheus_lines('construction_db', *self.store.health_epochs('construction_db'), T0 + 120, True)
        self.assertIn('atlas_inbox_source_up{source="construction_db"} 0', down)
        self.assertIn('atlas_inbox_source_failures_in_row{source="construction_db"} 1', down)
        never = wa_inbox.prometheus_lines('construction_db', None, 0, T0, True)
        self.assertIn('atlas_inbox_source_last_ok_age_seconds{source="construction_db"} -1', never)
        self.assertIn('atlas_inbox_source_up{source="x"} 0', wa_inbox.prometheus_lines('x', T0, 0, T0, False), 'not running: down')
        self.assertEqual(self.store.health_epochs('nothing'), (None, 0))


class ReplyStatsTests(Base):
    def setUp(self):
        super().setUp()
        self.third = '966500000003'
        for message_id, request_id, poi, number, at in [
            ('wamid.A1', 'cmp-1', 'poi:1', NUMBER, T0), ('wamid.A2', 'cmp-1', 'poi:2', OTHER, T0), ('wamid.A3', 'cmp-1', 'poi:3', self.third, T0),
            ('wamid.B1', 'cmp-2', 'poi:1', NUMBER, T0 + 7200),   # a later campaign of the same account to the same number
        ]:
            self.store.record_outbound(message_id, 'org-1', request_id, poi, number, sent_at=at)
        self.store.record_outbound('wamid.X', 'org-9', 'cmp-x', 'poi:1', NUMBER, sent_at=T0 + 9000)   # another account
        # poi:2 answers cmp-1 after 1 h (quoting it); poi:1 answers cmp-2 after 3 h; poi:3's message failed
        self.post(body([text('wamid.R2', sender=OTHER, at=T0 + 3600, context='wamid.A2'),
                        text('wamid.R1', sender=NUMBER, at=T0 + 7200 + 3 * 3600, context='wamid.B1')]))
        self.post(body(statuses=[{'id': 'wamid.A3', 'status': 'failed', 'timestamp': str(T0 + 5)}]))

    def test_each_request_counts_the_recipients_reached_the_replies_and_the_median_reply_time(self):
        stats = {r['requestId']: r for r in self.store.reply_stats('org-1', now=T0 + 86400)['requests']}
        self.assertEqual((stats['cmp-1']['sent'], stats['cmp-1']['replied'], stats['cmp-1']['medianReplySeconds']), (2, 1, 3600),
                         'the failed recipient is not counted as reached')
        self.assertEqual((stats['cmp-2']['sent'], stats['cmp-2']['replied'], stats['cmp-2']['medianReplySeconds']), (1, 1, 3 * 3600))
        self.assertNotIn('cmp-x', stats, "another account's campaign is not read")
        self.assertEqual(self.store.reply_stats('bad id!'), {'requests': [], 'elsewhere': []})

    def test_a_recipient_who_answered_another_campaign_of_the_account_is_flagged(self):
        elsewhere = self.store.reply_stats('org-1', now=T0 + 86400)['elsewhere']
        self.assertEqual([(e['requestId'], e['poiKey'], e['otherRequestId'], e['messageId']) for e in elsewhere],
                         [('cmp-1', 'poi:1', 'cmp-2', 'wamid.R1')])
        self.assertNotIn(NUMBER, json.dumps(elsewhere))
        self.assertEqual(self.store.reply_stats('org-9', now=T0 + 86400)['elsewhere'], [], "another account's replies are never named")
        self.assertEqual(self.store.reply_stats('org-1', now=T0 + 40 * 86400)['elsewhere'], [], 'only replies of the last 30 days')

    def test_an_even_number_of_reply_times_takes_the_mean_of_the_middle_two(self):
        self.store.record_outbound('wamid.E1', 'org-1', 'cmp-e', 'poi:5', '966500000005', sent_at=T0)
        self.store.record_outbound('wamid.E2', 'org-1', 'cmp-e', 'poi:6', '966500000006', sent_at=T0)
        self.post(body([text('wamid.RE1', sender='966500000005', at=T0 + 3600, context='wamid.E1'),
                        text('wamid.RE2', sender='966500000006', at=T0 + 3 * 3600, context='wamid.E2')]))
        stats = {r['requestId']: r for r in self.store.reply_stats('org-1', now=T0 + 86400)['requests']}
        self.assertEqual(stats['cmp-e']['medianReplySeconds'], 2 * 3600)


class ReplyTimingAndCacheTests(Base):
    def test_a_reply_after_a_follow_up_message_is_timed_from_that_message(self):
        self.store.record_outbound('wamid.F1', 'org-1', 'cmp-f', 'poi:1', NUMBER, sent_at=T0)
        self.store.record_outbound('wamid.F2', 'org-1', 'cmp-f', 'poi:1', NUMBER, sent_at=T0 + 3 * 86400)   # sent again, same request
        self.post(body([text('wamid.RF', at=T0 + 3 * 86400 + 1800)]))
        [stat] = [r for r in self.store.reply_stats('org-1', now=T0 + 4 * 86400)['requests'] if r['requestId'] == 'cmp-f']
        self.assertEqual(stat['medianReplySeconds'], 1800, 'from the latest message before the reply, not 3 days earlier')

    def test_a_message_sent_after_the_reply_does_not_shorten_its_time(self):
        self.store.record_outbound('wamid.G1', 'org-1', 'cmp-g', 'poi:1', NUMBER, sent_at=T0)
        self.post(body([text('wamid.RG', at=T0 + 7200, context='wamid.G1')]))
        self.store.record_outbound('wamid.G2', 'org-1', 'cmp-g', 'poi:1', NUMBER, sent_at=T0 + 86400)
        [stat] = [r for r in self.store.reply_stats('org-1', now=T0 + 2 * 86400)['requests'] if r['requestId'] == 'cmp-g']
        self.assertEqual(stat['medianReplySeconds'], 7200)

    def test_the_figures_are_kept_until_a_write_or_five_minutes(self):
        import sqlite3
        self.store.record_outbound('wamid.C1', 'org-1', 'cmp-c', 'poi:1', NUMBER, sent_at=T0)
        first = self.store.reply_stats('org-1', now=T0 + 10)
        # a change behind the store's back is not seen while the answer is kept
        con = sqlite3.connect(self.store.path)
        con.execute("insert into wa_outbound (message_id, account_id, request_id, poi_key, wa_id, sent_at) values ('wamid.C2','org-1','cmp-c','poi:2',?,?)", (OTHER, T0))
        con.commit(); con.close()
        self.assertEqual(self.store.reply_stats('org-1', now=T0 + 20), first, 'kept')
        self.assertEqual(self.store.reply_stats('org-1', now=T0 + 10 + wa_inbox.STATS_TTL_SECONDS)['requests'][0]['sent'], 2, 'five minutes later: read again')
        # a write through the store is seen at once
        self.store.record_outbound('wamid.C3', 'org-1', 'cmp-c', 'poi:3', '966500000003', sent_at=T0)
        self.assertEqual(self.store.reply_stats('org-1', now=T0 + 400)['requests'][0]['sent'], 3)
        self.post(body([text('wamid.RC', at=T0 + 60)]))
        self.assertEqual(self.store.reply_stats('org-1', now=T0 + 401)['requests'][0]['replied'], 1, 'a new reply is seen at once')

    def test_a_caller_cannot_change_the_kept_answer(self):
        self.store.record_outbound('wamid.D1', 'org-1', 'cmp-d', 'poi:1', NUMBER, sent_at=T0)
        answer = self.store.reply_stats('org-1', now=T0)
        answer['requests'].clear()
        self.assertEqual(len(self.store.reply_stats('org-1', now=T0 + 1)['requests']), 1)


if __name__ == '__main__':
    unittest.main()
