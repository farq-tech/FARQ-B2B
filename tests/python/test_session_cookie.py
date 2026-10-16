# -*- coding: utf-8 -*-
"""session_cookie.py: sealing, tamper detection, origin check, and one rotation shared by concurrent requests.
Run: python3 -m unittest discover -s tests/python -v"""
import os, sys, threading, time, unittest
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
import session_cookie as sc  # noqa: E402

S = {'a': 'acc-1', 'r': 'ref-1', 'e': int(time.time()) + 3600, 'u': {'id': 'u1', 'email': 'a@farq.sa'}}


class Seal(unittest.TestCase):
    def test_round_trip_and_opaque(self):
        v = sc.seal(S)
        self.assertEqual(sc.unseal(v), S)
        self.assertNotIn('acc', v); self.assertNotIn('farq', v)
        self.assertNotEqual(sc.seal(S), v)  # fresh nonce each time

    def test_tampered_or_garbage_is_rejected(self):
        v = sc.seal(S)
        flipped = v[:30] + ('A' if v[30] != 'A' else 'B') + v[31:]
        for bad in (flipped, v[:-2], '', 'x', 'not.base64!'):
            self.assertIsNone(sc.unseal(bad))

    def test_cookie_attributes(self):
        k, v = sc.set_cookie(S)
        self.assertEqual(k, 'Set-Cookie')
        for part in ('HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', f'Max-Age={60 * 60 * 24 * 30}'): self.assertIn(part, v)
        self.assertEqual(sc.read('a=b; ' + v.split(';')[0]), S)
        self.assertIn('Max-Age=0', sc.clear_cookie()[1])

    def test_public_has_no_token(self):
        self.assertEqual(set(sc.public(S)), {'user', 'expires_at'})

    def test_same_origin(self):
        self.assertTrue(sc.same_origin({'Origin': 'https://b2b.farq.sa'}, 'b2b.farq.sa'))
        self.assertTrue(sc.same_origin({'Referer': 'https://b2b.farq.sa/requests'}, 'b2b.farq.sa'))
        self.assertFalse(sc.same_origin({'Origin': 'https://evil.example'}, 'b2b.farq.sa'))
        self.assertFalse(sc.same_origin({}, 'b2b.farq.sa'))


class Refresh(unittest.TestCase):
    def test_fresh_session_is_not_renewed(self):
        with mock.patch.object(sc, 'api_post') as p:
            self.assertEqual(sc.refresh('x', S), (S, False, False)); p.assert_not_called()

    def test_concurrent_requests_share_one_rotation(self):
        old = dict(S, r='ref-c', e=int(time.time()) + 10)
        calls = []
        def fake(api, path, body, bearer=None):
            calls.append(body['refresh_token']); time.sleep(0.05)
            return 200, {'data': {'access_token': 'acc-2', 'refresh_token': 'ref-2', 'expires_in': 3600, 'user': {'id': 'u1'}}}
        out = []
        with mock.patch.object(sc, 'api_post', fake):
            ts = [threading.Thread(target=lambda: out.append(sc.refresh('x', old))) for _ in range(6)]
            for t in ts: t.start()
            for t in ts: t.join()
        self.assertEqual(calls, ['ref-c'])
        self.assertTrue(all(s['a'] == 'acc-2' and changed for s, changed, _ in out))

    def test_refused_ends_unreachable_keeps(self):
        old = dict(S, r='ref-x', e=int(time.time()) + 10)
        with mock.patch.object(sc, 'api_post', return_value=(401, None)):
            self.assertEqual(sc.refresh('x', old), (None, False, True))
        old = dict(S, r='ref-y', e=int(time.time()) + 10)
        with mock.patch.object(sc, 'api_post', return_value=(0, None)):
            self.assertEqual(sc.refresh('x', old), (old, False, False))


if __name__ == '__main__':
    unittest.main()
