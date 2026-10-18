"""Contract checks for read-only taxonomy focus applied to directory map tiles."""
import pathlib
import sys
import threading
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from directory_tiles import DirectoryTiles  # noqa: E402
import duckdb  # noqa: E402


class DirectoryTilesFocusTests(unittest.TestCase):
    def setUp(self):
        self.tiles = DirectoryTiles.__new__(DirectoryTiles)
        self.tiles.lock = threading.RLock()
        self.registered = None
        self.tiles.context = lambda _key: (
            9999999999,
            None,
            "Riyadh",
            {"district": "السويدي", "contact": "whatsapp", "taxonomy_sub_id": "old.sub"},
        )
        self.tiles.register = self._register

    def _register(self, rows=None, city=None, filters=None):
        self.registered = {"rows": rows, "city": city, "filters": filters}
        return "focused-token"

    def test_browse_subcategory_preserves_scope_and_replaces_old_taxonomy(self):
        token = self.tiles.focus("base-token", "sub", "plumbing.fixtures")

        self.assertEqual(token, "focused-token")
        self.assertEqual(self.registered["city"], "Riyadh")
        self.assertIsNone(self.registered["rows"])
        self.assertEqual(self.registered["filters"], {
            "district": "السويدي",
            "contact": "whatsapp",
            "taxonomy_sub_id": "plumbing.fixtures",
        })

    def test_browse_specialty_requires_ids_and_filters_exactly(self):
        self.tiles.focus("base-token", "spec", "مغاسل", "plumbing.fixtures", "spec.sinks")

        self.assertEqual(self.registered["filters"], {
            "district": "السويدي",
            "contact": "whatsapp",
            "taxonomy_sub_id": "plumbing.fixtures",
            "taxonomy_specialty_id": "spec.sinks",
        })

    def test_search_cohort_focuses_on_exact_subcategory(self):
        rows = [
            {"poi_key": "a", "taxonomy_sub": "plumbing.fixtures"},
            {"poi_key": "b", "taxonomy_sub": "plumbing.tools"},
        ]
        self.tiles.context = lambda _key: (9999999999, rows, None, {"contact": "whatsapp"})

        self.tiles.focus("search-token", "sub", "plumbing.fixtures")

        self.assertEqual([row["poi_key"] for row in self.registered["rows"]], ["a"])
        self.assertIsNone(self.registered["city"])

    def test_search_cohort_specialty_matches_subcategory_and_name(self):
        rows = [
            {"poi_key": "a", "taxonomy_sub": "plumbing.fixtures", "specialties": ["مغاسل"]},
            {"poi_key": "b", "taxonomy_sub": "plumbing.fixtures", "specialties": ["خلاطات"]},
            {"poi_key": "c", "taxonomy_sub": "plumbing.tools", "specialties": ["مغاسل"]},
        ]
        self.tiles.context = lambda _key: (9999999999, rows, None, {})

        self.tiles.focus("search-token", "spec", "مغاسل", "plumbing.fixtures", "spec.sinks")

        self.assertEqual([row["poi_key"] for row in self.registered["rows"]], ["a"])

    def test_unclassified_main_focus_keeps_unclassified_rows(self):
        rows = [
            {"poi_key": "a", "taxonomy_sub": None},
            {"poi_key": "b", "taxonomy_sub": "unc"},
            {"poi_key": "c", "taxonomy_sub": "unc.other"},
            {"poi_key": "d", "taxonomy_sub": "plumbing.fixtures"},
        ]
        self.tiles.context = lambda _key: (9999999999, rows, None, {})

        self.tiles.focus("search-token", "main", "unc")

        self.assertEqual([row["poi_key"] for row in self.registered["rows"]], ["a", "b", "c"])

    def test_invalid_focus_level_is_rejected(self):
        with self.assertRaises(ValueError):
            self.tiles.focus("base-token", "street", "King Fahd")

    def test_taxonomy_sql_is_parameterized(self):
        self.tiles.path = "/private/directory.parquet"
        self.tiles.search_sql = "true"

        sql, params = self.tiles.sql("Riyadh", {
            "taxonomy_main_id": "plumbing",
            "taxonomy_sub_id": "plumbing.fixtures",
            "taxonomy_specialty_id": "spec.sinks",
        })

        self.assertIn("split_part(coalesce(p.sub_id,''),'.',1)=?", sql)
        self.assertIn("p.sub_id=?", sql)
        self.assertIn("p.specialty_ids", sql)
        self.assertEqual(params, [self.tiles.path, "Riyadh", "plumbing", "plumbing.fixtures", "spec.sinks"])

    def test_taxonomy_sql_executes_exact_specialty_intersection(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = pathlib.Path(temp_dir) / "directory.parquet"
            db = duckdb.connect()
            db.execute("create table places(city_en varchar, poi_key varchar, sub_id varchar, specialty_ids varchar, brand_name varchar, name_ar varchar, name_en varchar)")
            db.executemany("insert into places values (?, ?, ?, ?, ?, ?, ?)", [
                ("Riyadh", "a", "plumbing.fixtures", "spec.sinks|spec.taps", "", "منشأة أ", "Place A"),
                ("Riyadh", "b", "plumbing.fixtures", "spec.taps", "", "منشأة ب", "Place B"),
                ("Riyadh", "c", "plumbing.tools", "spec.sinks", "", "منشأة ج", "Place C"),
                ("Jeddah", "d", "plumbing.fixtures", "spec.sinks", "", "منشأة د", "Place D"),
                ("Riyadh", "e", "unc.unknown", "", "", "منشأة هـ", "Place E"),
            ])
            db.execute("copy places to ? (format parquet)", [str(path)])
            db.execute("create table branches(brand varchar, n integer)")
            self.tiles.db = db
            self.tiles.path = str(path)
            self.tiles.search_sql = "true"

            sql, params = self.tiles.sql("Riyadh", {
                "taxonomy_main_id": "plumbing",
                "taxonomy_sub_id": "plumbing.fixtures",
                "taxonomy_specialty_id": "spec.sinks",
            })
            matches = db.execute("select p.poi_key " + sql, params).fetchall()

            self.assertEqual(matches, [("a",)])
            db.close()

    def test_unclassified_browse_sql_includes_exact_and_nested_ids(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = pathlib.Path(temp_dir) / "directory.parquet"
            db = duckdb.connect()
            db.execute("create table places(city_en varchar, poi_key varchar, sub_id varchar, specialty_ids varchar, brand_name varchar, name_ar varchar, name_en varchar)")
            db.executemany("insert into places values (?, ?, ?, ?, ?, ?, ?)", [
                ("Riyadh", "a", "unc", "", "", "منشأة أ", "Place A"),
                ("Riyadh", "b", "unc.unknown", "", "", "منشأة ب", "Place B"),
                ("Riyadh", "c", None, "", "", "منشأة ج", "Place C"),
                ("Riyadh", "d", "plumbing.fixtures", "spec.sinks", "", "منشأة د", "Place D"),
            ])
            db.execute("copy places to ? (format parquet)", [str(path)])
            db.execute("create table branches(brand varchar, n integer)")
            self.tiles.db = db
            self.tiles.path = str(path)
            self.tiles.search_sql = "true"

            sql, params = self.tiles.sql("Riyadh", {"taxonomy_main_id": "unc"})
            matches = db.execute("select p.poi_key " + sql, params).fetchall()

            self.assertEqual(matches, [("a",), ("b",), ("c",)])
            db.close()


if __name__ == "__main__":
    unittest.main()
