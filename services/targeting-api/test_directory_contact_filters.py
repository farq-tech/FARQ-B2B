"""Contract checks for broad directory discovery and explicit contact filters."""
import pathlib
import sys
import unittest

SERVICE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))
from directory_tiles import DirectoryTiles, filter_rows, valid_filters  # noqa: E402


class DirectoryContactFilterTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"poi_key": "wa", "has_whatsapp": True, "email": None},
            {"poi_key": "email", "has_whatsapp": False, "email": "info@example.test"},
            {"poi_key": "none", "has_whatsapp": False, "email": None},
        ]

    def test_omitted_contact_keeps_all_directory_rows(self):
        self.assertEqual([row["poi_key"] for row in filter_rows(self.rows, {})], ["wa", "email", "none"])

    def test_all_contact_filter_keeps_all_directory_rows(self):
        self.assertEqual(valid_filters({"contact": "all"})["contact"], "all")
        self.assertEqual([row["poi_key"] for row in filter_rows(self.rows, {"contact": "all"})], ["wa", "email", "none"])

    def test_explicit_whatsapp_and_email_filters_remain_available(self):
        self.assertEqual([row["poi_key"] for row in filter_rows(self.rows, {"contact": "whatsapp"})], ["wa"])
        self.assertEqual([row["poi_key"] for row in filter_rows(self.rows, {"contact": "email"})], ["email"])

    def test_map_sql_restricts_contact_only_when_explicitly_requested(self):
        tiles = DirectoryTiles.__new__(DirectoryTiles)
        tiles.path = "/directory.parquet"
        tiles.search_sql = "true"

        broad_sql, _ = tiles.sql("Riyadh", valid_filters({}))
        whatsapp_sql, _ = tiles.sql("Riyadh", valid_filters({"contact": "whatsapp"}))
        email_sql, _ = tiles.sql("Riyadh", valid_filters({"contact": "email"}))

        self.assertNotIn("has_whatsapp=true", broad_sql)
        self.assertIn("has_whatsapp=true", whatsapp_sql)
        self.assertIn("email", email_sql)


if __name__ == "__main__":
    unittest.main()
