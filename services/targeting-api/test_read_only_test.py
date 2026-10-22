import os
import unittest
from unittest.mock import patch

import read_only_test


class ReadOnlyTestModeTests(unittest.TestCase):
    def test_blocks_every_mutating_route_only_when_enabled(self):
        with patch.dict(os.environ, {"ATLAS_READ_ONLY": "1"}, clear=False):
            self.assertTrue(read_only_test.blocks_request("/send-template"))
            self.assertTrue(read_only_test.blocks_request("/templates"))
            self.assertTrue(read_only_test.blocks_request("/log"))
            self.assertFalse(read_only_test.blocks_request("/search"))
            self.assertFalse(read_only_test.provider_calls_allowed())

    def test_normal_service_keeps_existing_route_behavior(self):
        with patch.dict(os.environ, {"ATLAS_READ_ONLY": "0"}, clear=False):
            self.assertFalse(read_only_test.blocks_request("/send-template"))
            self.assertTrue(read_only_test.provider_calls_allowed())
