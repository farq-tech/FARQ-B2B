import io
import json
import unittest
import urllib.error

import advisor_proxy


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class AdvisorProxyTest(unittest.TestCase):
    def test_reads_only_an_alternating_conversation_that_ends_with_the_user(self):
        system, messages = advisor_proxy.read({'system': 's', 'messages': [{'role': 'user', 'content': 'hi', 'extra': 1}]})
        self.assertEqual(messages, [{'role': 'user', 'content': 'hi'}])
        for bad in ({'system': '', 'messages': [{'role': 'user', 'content': 'a'}]},
                    {'system': 's', 'messages': [{'role': 'assistant', 'content': 'a'}]},
                    {'system': 's', 'messages': [{'role': 'user', 'content': 'a'}, {'role': 'assistant', 'content': 'b'}]}):
            with self.assertRaises(ValueError):
                advisor_proxy.read(bad)

    def test_forwards_with_the_fixed_model_and_returns_the_text(self):
        sent = {}

        def opener(request, timeout):
            sent.update(json.loads(request.data))
            return Response(json.dumps({'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': 'جواب'}]}).encode())

        status, body = advisor_proxy.reply('s', [{'role': 'user', 'content': 'a'}], {'ANTHROPIC_API_KEY': 'k'}, opener)
        self.assertEqual((status, body, sent['model']), (200, {'reply': 'جواب'}, 'claude-opus-5-5'))

    def test_failures_map_to_plain_states(self):
        self.assertEqual(advisor_proxy.reply('s', [], {}, None), (503, {'error': 'UNCONFIGURED'}))

        def busy(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 429, 'busy', {}, None)

        self.assertEqual(advisor_proxy.reply('s', [{'role': 'user', 'content': 'a'}], {'ANTHROPIC_API_KEY': 'k'}, busy)[0], 429)


if __name__ == '__main__':
    unittest.main()


class AdvisorErrorLogTest(unittest.TestCase):
    def test_an_api_error_is_logged_with_its_type_and_message_not_the_key(self):
        def denied(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, 'Unauthorized', {'request-id': 'req_1'},
                                         io.BytesIO(json.dumps({'type': 'error', 'error': {'type': 'authentication_error', 'message': 'invalid x-api-key'}}).encode()))

        with self.assertLogs('farq.targeting.advisor', 'WARNING') as logs:
            status, body = advisor_proxy.reply('s', [{'role': 'user', 'content': 'a'}], {'ANTHROPIC_API_KEY': 'secret-key'}, denied)
        self.assertEqual((status, body), (502, {'error': 'UPSTREAM'}))
        line = logs.output[0]
        self.assertIn('http=401', line)
        self.assertIn('authentication_error', line)
        self.assertIn('req_1', line)
        self.assertNotIn('secret-key', line)

    def test_an_error_body_of_any_shape_still_gives_the_plain_state(self):
        for payload in (b'[1, 2]', b'"text"', b'{"error": "flat"}', b'{"error": [1]}', b'null'):
            def failing(request, timeout, payload=payload):
                raise urllib.error.HTTPError(request.full_url, 400, 'Bad Request', {}, io.BytesIO(payload))

            with self.assertLogs('farq.targeting.advisor', 'WARNING'):
                self.assertEqual(advisor_proxy.reply('s', [{'role': 'user', 'content': 'a'}], {'ANTHROPIC_API_KEY': 'k'}, failing),
                                 (502, {'error': 'UPSTREAM'}))
