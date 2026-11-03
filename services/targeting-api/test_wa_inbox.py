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


if __name__ == '__main__':
    unittest.main()
