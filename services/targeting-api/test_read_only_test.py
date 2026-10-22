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

class ReadOnlyFixtureTests(unittest.TestCase):
    def test_fixture_cluster_layer_is_queryable_by_city_and_activity(self):
        import tempfile
        from pathlib import Path
        import taxonomy_search
        from test_fixture.generate import main

        with tempfile.TemporaryDirectory() as directory:
            main(directory)
            rows = taxonomy_search.trade_clusters(
                str(Path(directory) / "trade_clusters.parquet"),
                "Riyadh",
                ["build.contracting"],
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["sub_id"], "build.contracting")
