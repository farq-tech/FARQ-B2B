"""Contract checks for broad directory discovery and explicit contact filters."""
import collections
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
                brand_name varchar, completeness_pct double, district_reliable boolean, street_ar varchar, role_badges varchar, specialty_concepts_ar varchar
            )""")
            db.execute("""insert into places values
                ('wholesale', 'مورد جملة', 'Wholesale supplier', 'مواد بناء', 'مواد بناء', '', '', 'Riyadh', '', '',
                 'حي الملز', '', 24.6, 46.7, 'point', null, null, false, true, null, '', 1, '', null, null, '', 90, true, 'طريق الملك فهد', 'مصنع|جملة', 'حديد، إسمنت'),
                ('retail', 'متجر تجزئة', 'Retail shop', 'مواد بناء', 'مواد بناء', '', '', 'Riyadh', '', '',
                 'حي الملز', '', 24.61, 46.71, 'point', '0501234567', null, true, false, null, '', 1, '', null, null, '', 80, true, 'شارع العليا', 'متجر', 'دهانات')
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
            self.assertEqual(result["rows"][0]["street_ar"], "طريق الملك فهد")
            self.assertEqual(result["areas"]["streets"], [{"name": "طريق الملك فهد", "district": "حي الملز", "n": 1}])
            broad_result = tiles.browse("Riyadh", {}, limit=1)
            self.assertEqual(broad_result["total"], 2)
            self.assertEqual(len(broad_result["rows"]), 1)
            self.assertEqual(broad_result["with_whatsapp"], 1)
            self.assertCountEqual(broad_result["areas"]["streets"], [
                {"name": "طريق الملك فهد", "district": "حي الملز", "n": 1},
                {"name": "شارع العليا", "district": "حي الملز", "n": 1},
            ])
            self.assertIs(result["rows"][0]["district_reliable"], True)
            self.assertEqual(result["rows"][0]["role_badges"], ["مصنع", "جملة"])
            role_result = tiles.browse("Riyadh", {"role": "مصنع"})
            self.assertEqual([row["poi_key"] for row in role_result["rows"]], ["wholesale"])
            specialty_result = tiles.browse("Riyadh", {"specialty": "حديد"})
            self.assertEqual([row["poi_key"] for row in specialty_result["rows"]], ["wholesale"])
            self.assertEqual(specialty_result["rows"][0]["specialties"], ["حديد", "إسمنت"])
            tiles.context = lambda _key: (9999999999, None, "Riyadh", {})
            tiles.branch_counts = {}
            profile = tiles.profile("map-key", "wholesale")
            self.assertEqual(profile["role_badges"], ["مصنع", "جملة"])
            self.assertEqual(profile["specialties"], ["حديد", "إسمنت"])
            self.assertTrue(profile["is_wholesale"])
            db.close()

    def test_search_page_scopes_total_rows_and_tile_cohort_to_the_selected_district(self):
        """The list total and the map query must describe the same district cohort."""
        from trial_search import Directory

        result = {
            "rows": [
                {"poi_key": "malaz-a", "district_ar": "حي الملز", "district_reliable": True, "match_confidence": {"score": 3}},
                {"poi_key": "malaz-b", "district_ar": "الملز", "district_reliable": True, "match_confidence": {"score": 2}},
                {"poi_key": "other", "district_ar": "حي النخيل", "district_reliable": True, "match_confidence": {"score": 9}},
            ]
        }

        page = Directory.page(result, limit=1, offset=0, filters={"district": "حي الملز"})

        self.assertEqual(page["total"], 2)
        self.assertEqual([row["poi_key"] for row in page["rows"]], ["malaz-a"])
        self.assertEqual([row["poi_key"] for row in page["_map_rows"]], ["malaz-a", "malaz-b"])
        self.assertTrue(page["has_more"])
        self.assertEqual(page["next_offset"], 1)

    def test_browse_applies_normalized_district_and_street_filters(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = pathlib.Path(temp_dir) / "directory.parquet"
            db = duckdb.connect()
            db.execute("""create table places(
                poi_key varchar, name_ar varchar, name_en varchar, category varchar, category_ar varchar,
                secondary_category varchar, category_l3 varchar, city_en varchar, region_en varchar, region_ar varchar,
                district_ar varchar, district_en varchar, latitude double, longitude double, location_precision varchar,
                phone_norm varchar, phone_kind varchar, has_whatsapp boolean, is_wholesale boolean, email varchar,
                sources varchar, source_count integer, legal_name varchar, company_status varchar, lifecycle_state varchar,
                brand_name varchar, completeness_pct double, district_reliable boolean, street_ar varchar, role_badges varchar, specialty_concepts_ar varchar
            )""")
            db.execute("""insert into places values
                ('target', 'منشأة الهدف', '', '', '', '', '', 'Riyadh', '', '', 'حي الملز', '', 24.6, 46.7,
                 'point', null, null, false, false, null, '', 1, '', null, null, '', 90, true, 'طريق الملك فهد', 'مصنع|جملة', 'حديد، إسمنت'),
                ('other-street', 'منشأة أخرى', '', '', '', '', '', 'Riyadh', '', '', 'حي الملز', '', 24.61, 46.71,
                 'point', null, null, false, false, null, '', 1, '', null, null, '', 80, true, 'شارع العليا', 'متجر', 'دهانات'),
                ('other-district', 'منشأة حي آخر', '', '', '', '', '', 'Riyadh', '', '', 'حي النخيل', '', 24.62, 46.72,
                 'point', null, null, false, false, null, '', 1, '', null, null, '', 70, true, 'طريق الملك فهد', 'مصنع|جملة', 'حديد، إسمنت')
            """)
            db.execute("copy places to ? (format parquet)", [str(path)])
            db.execute("create table branches(brand varchar, n integer)")
            tiles = DirectoryTiles.__new__(DirectoryTiles)
            tiles.db = db
            tiles.lock = threading.RLock()
            tiles.path = str(path)
            tiles.search_sql = "true"
            tiles.register = lambda **_kwargs: "map-key"

            result = tiles.browse("Riyadh", {"district": "الملز", "street": "الملك فهد"})

            self.assertEqual(result["total"], 1)
            self.assertEqual([row["poi_key"] for row in result["rows"]], ["target"])
            db.close()

    def test_area_picker_includes_streets_beyond_the_density_preview_limit(self):
        """Selecting a street must use geography, never the top-60 density preview."""
        with tempfile.TemporaryDirectory() as temp_dir:
            path = pathlib.Path(temp_dir) / "directory.parquet"
            seed = duckdb.connect()
            seed.execute("create table places(city_en varchar, district_ar varchar, street_ar varchar, is_wholesale boolean)")
            seed.executemany(
                "insert into places values (?, ?, ?, ?)",
                [("Riyadh", "حي الملز", f"شارع {index}", False) for index in range(61)],
            )
            seed.execute("copy places to ? (format parquet)", [str(path)])
            seed.close()

            tiles = DirectoryTiles.__new__(DirectoryTiles)
            tiles.db = duckdb.connect()
            tiles.lock = threading.RLock()
            tiles.path = str(path)
            tiles.area_options_cache = {}
            tiles.column = lambda name, _fallback: name

            def scoped_sql(city, filters):
                self.assertEqual(city, "Riyadh")
                self.assertEqual(filters["district"], "حي الملز")
                self.assertEqual(filters["street"], "")
                return "from read_parquet(?) p where city_en=? and district_ar=?", [str(path), city, filters["district"]]

            tiles.sql = scoped_sql
            areas = tiles.area_options("Riyadh", {"district": "حي الملز", "street": "شارع 0"})

            self.assertEqual(len(areas["streets"]), 61)
            self.assertIn({"name": "شارع 60", "district": "حي الملز", "n": 1}, areas["streets"])
            tiles.db.close()

    def test_browse_degrades_safely_for_legacy_directory_assets(self):
        """A delayed enrichment refresh must not take the map endpoint down."""
        with tempfile.TemporaryDirectory() as temp_dir:
            path = pathlib.Path(temp_dir) / "legacy-directory.parquet"
            db = duckdb.connect()
            db.execute("""create table places(
                poi_key varchar, name_ar varchar, name_en varchar, category varchar, category_ar varchar,
                secondary_category varchar, category_l3 varchar, city_en varchar, region_en varchar, region_ar varchar,
                district_ar varchar, district_en varchar, latitude double, longitude double, phone_norm varchar,
                phone_kind varchar, has_whatsapp boolean, email varchar, sources varchar, source_count integer,
                legal_name varchar, company_status varchar, lifecycle_state varchar, brand_name varchar, completeness_pct double
            )""")
            db.execute("""insert into places values
                ('legacy', 'منشأة قديمة', '', 'مواد بناء', 'مواد بناء', '', '', 'Riyadh', '', '',
                 'حي الملز', '', 24.6, 46.7, null, null, false, null, '', 1, '', null, null, '', 90)
            """)
            db.execute("copy places to ? (format parquet)", [str(path)])
            db.execute("create table branches(brand varchar, n integer)")
            tiles = DirectoryTiles.__new__(DirectoryTiles)
            tiles.db = db
            tiles.lock = threading.RLock()
            tiles.path = str(path)
            tiles.columns = {row[0] for row in db.execute("describe places").fetchall()}
            tiles.search_sql = "true"
            tiles.register = lambda **_kwargs: "map-key"

            broad = tiles.browse("Riyadh", {})
            self.assertEqual([row["poi_key"] for row in broad["rows"]], ["legacy"])
            self.assertEqual(broad["rows"][0]["role_badges"], [])
            self.assertEqual(broad["rows"][0]["specialties"], [])
            self.assertEqual(tiles.browse("Riyadh", {"wholesale": True})["total"], 0)
            self.assertEqual(tiles.browse("Riyadh", {"specialty": "حديد"})["total"], 0)
            # The map tiles must also work: a browse-only fallback would still leave
            # the live map blank for a legacy data asset.
            tiles.context = lambda _key: (9999999999, None, "Riyadh", {})
            tiles.tiles = collections.OrderedDict()
            tile = tiles.tile("map-key", 0, 0, 0)
            self.assertGreater(len(tile), 0)
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
