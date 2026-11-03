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


ENRICH_COLS = (
    "status_voted",
    "status_voted_confidence",
    "last_seen_at",
    "is_stale",
    "hours_week",
    "whatsapp_state",
)


class DirectoryTilesEnrichmentTests(unittest.TestCase):
    """browse() and profile() must emit the v13 enrichment fields (same names as the
    search/taxonomy paths) when the release carries them, and degrade to a safe NULL —
    never a crash, never a fabricated value — when an older asset lacks the columns."""

    # Base/v7 columns that every release carries; enrichment columns are added only
    # in the "current release" fixture so the guard can be exercised in isolation.
    BASE_COLS = [
        ("poi_key", "varchar"), ("name_ar", "varchar"), ("name_en", "varchar"),
        ("category", "varchar"), ("category_ar", "varchar"), ("secondary_category", "varchar"),
        ("category_l3", "varchar"), ("city_en", "varchar"), ("region_en", "varchar"),
        ("region_ar", "varchar"), ("district_ar", "varchar"), ("district_en", "varchar"),
        ("street_ar", "varchar"), ("district_reliable", "boolean"), ("latitude", "double"),
        ("longitude", "double"), ("location_precision", "varchar"), ("phone_norm", "varchar"),
        ("phone_kind", "varchar"), ("has_whatsapp", "boolean"), ("is_wholesale", "boolean"),
        ("role_badges", "varchar"), ("specialty_concepts_ar", "varchar"), ("email", "varchar"),
        ("sources", "varchar"), ("source_count", "integer"), ("legal_name", "varchar"),
        ("brand_name", "varchar"), ("company_status", "varchar"), ("lifecycle_state", "varchar"),
        ("completeness_pct", "double"),
    ]
    BASE_ROW = {
        "poi_key": "FA-1", "name_ar": "مؤسسة السباكة", "name_en": "Plumbing Est",
        "category": "Home Goods", "category_ar": "تجهيزات المنزل", "secondary_category": "سباكة",
        "category_l3": "مغاسل", "city_en": "Riyadh", "region_en": "Riyadh", "region_ar": "الرياض",
        "district_ar": "السويدي", "district_en": "Suwaidi", "street_ar": "شارع الملك فهد",
        "district_reliable": True, "latitude": 24.7, "longitude": 46.7, "location_precision": "point",
        "phone_norm": "966551234567", "phone_kind": "mobile", "has_whatsapp": True,
        "is_wholesale": False, "role_badges": "", "specialty_concepts_ar": "", "email": "a@b.co",
        "sources": "farq", "source_count": 1, "legal_name": "", "brand_name": "",
        "company_status": None, "lifecycle_state": None, "completeness_pct": 90.0,
    }
    ENRICH_ROW = {
        "status_voted": "open", "status_voted_confidence": "high", "last_seen_at": "2026-10-01",
        "is_stale": False, "hours_week": '{"sun":[["09:00","21:00"]]}', "whatsapp_state": "verified",
    }

    def _build(self, with_enrichment):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = str(pathlib.Path(temp.name) / "directory.parquet")
        cols = list(self.BASE_COLS) + ([(c, "varchar" if c != "is_stale" else "boolean") for c in ENRICH_COLS] if with_enrichment else [])
        row = dict(self.BASE_ROW)
        if with_enrichment:
            row.update(self.ENRICH_ROW)
        db = duckdb.connect()
        db.execute("create table d(" + ",".join(f"{n} {t}" for n, t in cols) + ")")
        db.execute("insert into d values (" + ",".join("?" for _ in cols) + ")", [row[n] for n, _ in cols])
        db.execute("copy d to ? (format parquet)", [path])
        db.close()
        tiles = DirectoryTiles(path)
        tiles.register = lambda rows=None, city=None, filters=None: "tok"
        return tiles

    def test_browse_emits_enrichment_when_release_carries_it(self):
        tiles = self._build(with_enrichment=True)
        result = tiles.browse("Riyadh", {})
        self.assertEqual(len(result["rows"]), 1)
        row = result["rows"][0]
        for col in ENRICH_COLS:
            self.assertIn(col, row, f"{col} missing from browse row")
        self.assertEqual(row["status_voted"], "open")
        self.assertEqual(row["status_voted_confidence"], "high")
        self.assertEqual(row["last_seen_at"], "2026-10-01")
        self.assertIs(row["is_stale"], False)
        self.assertEqual(row["hours_week"], '{"sun":[["09:00","21:00"]]}')
        self.assertEqual(row["whatsapp_state"], "verified")

    def test_browse_degrades_safely_when_columns_absent(self):
        tiles = self._build(with_enrichment=False)
        result = tiles.browse("Riyadh", {})
        self.assertEqual(len(result["rows"]), 1)
        row = result["rows"][0]
        # Older asset: keys are still emitted (stable client contract) but hold NULL —
        # the UI renders «غير متاح». Nothing is fabricated and browse does not crash.
        for col in ENRICH_COLS:
            self.assertIn(col, row)
            self.assertIsNone(row[col])

    def test_profile_emits_enrichment_when_release_carries_it(self):
        tiles = self._build(with_enrichment=True)
        tiles.context = lambda _key: (9999999999, None, "Riyadh", {})
        row = tiles.profile("tok", "FA-1")
        self.assertIsNotNone(row)
        for col in ENRICH_COLS:
            self.assertIn(col, row, f"{col} missing from profile row")
        self.assertEqual(row["status_voted"], "open")
        self.assertEqual(row["whatsapp_state"], "verified")
        self.assertEqual(row["hours_week"], '{"sun":[["09:00","21:00"]]}')

    def test_profile_degrades_safely_when_columns_absent(self):
        tiles = self._build(with_enrichment=False)
        tiles.context = lambda _key: (9999999999, None, "Riyadh", {})
        row = tiles.profile("tok", "FA-1")
        self.assertIsNotNone(row)
        # Older asset via select p.*: the columns simply are not present; profile must
        # not invent them. Absent key (or None) both read as «غير متاح» downstream.
        for col in ENRICH_COLS:
            self.assertIsNone(row.get(col))


if __name__ == "__main__":
    unittest.main()
