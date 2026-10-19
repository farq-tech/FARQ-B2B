"""Contract checks for broad directory discovery and explicit contact filters."""
import pathlib
import sys
import tempfile
import threading
import unittest

import duckdb

SERVICE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))
from directory_tiles import DirectoryTiles, filter_rows, valid_filters  # noqa: E402
import status_policy  # noqa: E402


class DirectoryContactFilterTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"poi_key": "wa", "has_whatsapp": True, "phone": "+966 50 123 4567", "email": None},
            {"poi_key": "local-wa", "has_whatsapp": True, "phone": "050 123 4567", "email": None},
            {"poi_key": "flag-without-mobile", "has_whatsapp": True, "phone": "011 123 4567", "email": None},
            {"poi_key": "email", "has_whatsapp": False, "email": "info@example.test"},
            {"poi_key": "none", "has_whatsapp": False, "email": None},
        ]

    def test_omitted_contact_keeps_all_directory_rows(self):
        self.assertEqual([row["poi_key"] for row in filter_rows(self.rows, {})], ["wa", "local-wa", "flag-without-mobile", "email", "none"])

    def test_all_contact_filter_keeps_all_directory_rows(self):
        self.assertEqual(valid_filters({"contact": "all"})["contact"], "all")
        self.assertEqual([row["poi_key"] for row in filter_rows(self.rows, {"contact": "all"})], ["wa", "local-wa", "flag-without-mobile", "email", "none"])

    def test_explicit_whatsapp_and_email_filters_remain_available(self):
        self.assertEqual([row["poi_key"] for row in filter_rows(self.rows, {"contact": "whatsapp"})], ["wa", "local-wa"])
        self.assertEqual([row["poi_key"] for row in filter_rows(self.rows, {"contact": "email"})], ["email"])

    def test_whatsapp_filter_excludes_source_markers_without_a_deliverable_mobile(self):
        self.assertEqual([row["poi_key"] for row in filter_rows(self.rows, {"contact": "whatsapp"})], ["wa", "local-wa"])

    def test_backend_mobile_normalization_matches_the_pricing_ui(self):
        cases = {
            "+966 50 123 4567": "966501234567",
            "00966501234567": "966501234567",
            "0501234567": "966501234567",
            "501234567": "966501234567",
            "0111234567": None,
        }
        for phone, expected in cases.items():
            with self.subTest(phone=phone):
                self.assertEqual(status_policy.mobile_of({"phone_norm": phone}), expected)

    def test_browse_returns_wholesale_flag_for_filtered_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = pathlib.Path(temp_dir) / "directory.parquet"
            db = duckdb.connect()
            db.execute("""create table places(
                poi_key varchar, name_ar varchar, name_en varchar, category varchar, category_ar varchar,
                secondary_category varchar, category_l3 varchar, city_en varchar, region_en varchar, region_ar varchar,
                district_ar varchar, district_en varchar, latitude double, longitude double, location_precision varchar,
                phone_norm varchar, phone_kind varchar, has_whatsapp boolean, is_wholesale boolean, email varchar,
                sources varchar, source_count integer, legal_name varchar, company_status varchar, lifecycle_state varchar,
                brand_name varchar, completeness_pct double
            )""")
            db.execute("""insert into places values
                ('wholesale', 'مورد جملة', 'Wholesale supplier', 'مواد بناء', 'مواد بناء', '', '', 'Riyadh', '', '',
                 'الملز', '', 24.6, 46.7, 'point', null, null, false, true, null, '', 1, '', null, null, '', 90),
                ('retail', 'متجر تجزئة', 'Retail shop', 'مواد بناء', 'مواد بناء', '', '', 'Riyadh', '', '',
                 'الملز', '', 24.61, 46.71, 'point', null, null, false, false, null, '', 1, '', null, null, '', 80)
            """)
            db.execute("copy places to ? (format parquet)", [str(path)])
            db.execute("create table branches(brand varchar, n integer)")
            tiles = DirectoryTiles.__new__(DirectoryTiles)
            tiles.db = db
            tiles.lock = threading.RLock()
            tiles.path = str(path)
            tiles.search_sql = "true"
            tiles.register = lambda **_kwargs: "map-key"

            result = tiles.browse("Riyadh", {"wholesale": True})

            self.assertEqual(result["total"], 1)
            self.assertEqual(result["rows"][0]["poi_key"], "wholesale")
            self.assertIs(result["rows"][0]["is_wholesale"], True)
            db.close()

    def test_map_sql_restricts_contact_only_when_explicitly_requested(self):
        tiles = DirectoryTiles.__new__(DirectoryTiles)
        tiles.path = "/directory.parquet"
        tiles.search_sql = "true"

        broad_sql, _ = tiles.sql("Riyadh", valid_filters({}))
        whatsapp_sql, _ = tiles.sql("Riyadh", valid_filters({"contact": "whatsapp"}))
        email_sql, _ = tiles.sql("Riyadh", valid_filters({"contact": "email"}))

        self.assertNotIn("has_whatsapp=true", broad_sql)
        self.assertIn("has_whatsapp=true", whatsapp_sql)
        self.assertIn("regexp_matches", whatsapp_sql)
        self.assertIn("email", email_sql)


if __name__ == "__main__":
    unittest.main()
