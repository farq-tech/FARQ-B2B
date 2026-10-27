import hashlib
import io
import tempfile
import unittest
from pathlib import Path

import input_upload

PAYLOAD = b'parquet-bytes' * 1000
TOKEN = 'x' * 40


def environ(**extra):
    return {'FARQ_INPUT_UPLOAD_TOKEN': TOKEN, 'FARQ_BUILDINGS_SHA256': hashlib.sha256(PAYLOAD).hexdigest(), **extra}


class InputUploadTests(unittest.TestCase):
    def setUp(self):
        self.data = Path(tempfile.mkdtemp())
        self.target = input_upload.destination(self.data)

    def send(self, payload=PAYLOAD, token=TOKEN, env=None, length=None):
        headers = {'X-Farq-Upload-Token': token, 'Content-Length': str(len(payload) if length is None else length)}
        return input_upload.receive(headers, io.BytesIO(payload), self.data, environ() if env is None else env)

    def test_the_configured_file_lands_in_its_one_place(self):
        status, body = self.send()
        self.assertEqual((status, body['bytes']), (200, len(PAYLOAD)))
        self.assertEqual(self.target.read_bytes(), PAYLOAD)

    def test_without_the_token_variable_the_endpoint_does_not_exist(self):
        self.assertEqual(self.send(env={})[0], 404)
        self.assertFalse(self.target.exists())

    def test_a_wrong_token_or_a_different_file_changes_nothing(self):
        self.assertEqual(self.send(token='y' * 40)[0], 401)
        self.assertEqual(self.send(payload=b'other' * 10)[0], 422)
        self.assertFalse(self.target.exists())
        self.assertEqual(list(self.target.parent.iterdir()), [], 'no partial file is left behind')

    def test_short_tokens_size_limits_and_truncated_bodies_are_refused(self):
        self.assertEqual(self.send(token='short', env=environ(FARQ_INPUT_UPLOAD_TOKEN='short'))[0], 401)
        self.assertEqual(self.send(length=0)[0], 413)
        self.assertEqual(self.send(length=input_upload.MAX_BYTES + 1)[0], 413)
        self.assertEqual(self.send(length=len(PAYLOAD) + 10)[0], 400)
        self.assertEqual(self.send(env=environ(FARQ_BUILDINGS_SHA256=''))[0], 409)
        self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()
