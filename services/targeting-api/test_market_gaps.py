"""Market-gap ranking against synthetic directory rows and district populations."""
import pathlib
import sys
import tempfile
import threading
import unittest

import duckdb

SERVICE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))
from market_analytics import MarketAnalytics  # noqa: E402
import status_policy  # noqa: E402


class MarketGapTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.targets = self.root / "targets.parquet"
        db = duckdb.connect()
        db.execute("""create table targets(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar,
            has_whatsapp boolean, phone_norm varchar, is_wholesale boolean, district_ar varchar, district_reliable boolean,
            location_precision varchar, longitude double, latitude double)""")
        rows = []
        # pharmacies: 10 in النخيل (20k people), 2 in الياسمين (40k people), 0 in الربيع (30k people), 3 in a district with no population
        for i in range(10): rows.append((f"n{i}", "Riyadh", f"صيدلية {i}", None, False, None, False, "النخيل", True, "point", 46.6, 24.7))
        for i in range(2): rows.append((f"y{i}", "Riyadh", f"صيدلية ي{i}", None, False, None, False, "الياسمين", True, "point", 46.7, 24.8))
        for i in range(3): rows.append((f"u{i}", "Riyadh", f"صيدلية م{i}", None, False, None, False, "مجهول", True, "point", 46.8, 24.9))
        db.executemany("insert into targets values (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        db.execute("alter table targets add column company_status varchar default 'open'")
        db.execute("alter table targets add column lifecycle_state varchar")
        db.execute("""insert into targets values
            ('temp', 'Riyadh', 'مؤقت', null, false, null, false, 'مجهول', true, 'point', 46.8, 24.9, 'temporarily closed', null),
            ('temp', 'Riyadh', 'نسخة غير موثوقة', null, false, null, false, 'مجهول', false, 'point', 46.9, 25.0, 'temporarily closed', null),
            ('untrusted', 'Riyadh', 'إسناد حي غير موثوق', null, false, null, false, 'الياسمين', false, 'point', 46.7, 24.8, 'open', null),
            ('permanent', 'Riyadh', 'مغلق نهائيا', null, false, null, false, 'مجهول', true, 'point', 46.8, 24.9, 'permanently closed', null)""")
        db.execute("copy targets to ? (format parquet)", [str(self.targets)])
        search_sql = status_policy.search_sql(db, str(self.targets))
        db.close()
        tiles = type("Tiles", (), {})()
        tiles.db, tiles.lock, tiles.search_sql, tiles.path = duckdb.connect(), threading.RLock(), search_sql, str(self.targets)
        self.analytics = MarketAnalytics(tiles)
        self.population = {
            "النخيل": {"population": 20000.0, "male": 11000.0, "female": 9000.0, "source": "910ths.sa"},
            "الياسمين": {"population": 40000.0, "male": 20000.0, "female": 20000.0},
            "الربيع": {"population": 30000.0, "male": None, "female": None},
            "صفر": {"population": 0.0, "male": None, "female": None, "source": "910ths.sa"},
            "صغير": {"population": 1000.0, "male": None, "female": None},
        }

    def test_districts_are_ranked_by_shortfall_against_the_city_rate(self):
        result = self.analytics.market_gaps({"city": "Riyadh"}, self.population)
        # city rate over districts with both population and businesses: 60,000 people / 12 pharmacies = 5,000
        self.assertEqual(result["residents_per_business"], 5000)
        names = [row["district_ar"] for row in result["districts"]]
        self.assertEqual(names, ["الربيع", "الياسمين", "النخيل"], "the small district is below min_population")
        rabi, yasmin, nakheel = result["districts"]
        self.assertEqual((rabi["businesses"], rabi["expected_businesses"], rabi["shortfall"]), (0, 6.0, 6.0))
        self.assertIsNone(rabi["residents_per_business"], "no business means no ratio, not infinity")
        self.assertEqual((yasmin["businesses"], yasmin["shortfall"], yasmin["residents_per_business"]), (2, 6.0, 20000))
        self.assertEqual(nakheel["shortfall"], -6.0, "a surplus is a negative shortfall")
        self.assertEqual(nakheel["male_pct"], 55.0)
        self.assertEqual((nakheel["population_source"], rabi["population_source"]), ("910ths.sa", None), "each figure names its source")
        self.assertIn("الدليل لا يغطي", result["basis"])

    def test_zero_male_share_is_measured_not_unavailable(self):
        population = {**self.population, "الربيع": {"population": 30000.0, "male": 0.0, "female": 30000.0}}
        result = self.analytics.market_gaps({"city": "Riyadh"}, population)
        rabi = next(row for row in result["districts"] if row["district_ar"] == "الربيع")
        self.assertEqual(rabi["male_pct"], 0.0)

    def test_measured_zero_population_is_not_dropped_as_missing(self):
        result = self.analytics.market_gaps({"city": "Riyadh", "min_population": 0}, self.population)
        zero = next(row for row in result["districts"] if row["district_ar"] == "صفر")
        self.assertEqual(zero["population"], 0)
        self.assertEqual(zero["population_source"], "910ths.sa")
        self.assertEqual(result["districts_with_population"], len(self.population))

    def test_site_fit_score_balances_activity_gap_and_measured_worker_income(self):
        result = self.analytics.market_gaps({"city": "Riyadh", "min_population": 0}, self.population, {
            "النخيل": 1000.0, "الياسمين": 2000.0, "الربيع": 3000.0,
            "صفر": None, "صغير": None,
        })
        by_name = {row["district_ar"]: row for row in result["districts"]}
        self.assertEqual(result["fit_sample_districts"], 3, "districts without measured income are not ranked")
        self.assertEqual((by_name["الربيع"]["fit_gap_rank"], by_name["الربيع"]["fit_income_rank"], by_name["الربيع"]["fit_score"]), (75, 100, 88))
        self.assertEqual((by_name["الياسمين"]["fit_gap_rank"], by_name["الياسمين"]["fit_income_rank"], by_name["الياسمين"]["fit_score"]), (75, 50, 63))
        self.assertIsNone(by_name["صفر"]["fit_score"], "an unmeasured income must not receive a composite score")

    def test_site_fit_score_is_neutral_when_only_one_district_is_comparable(self):
        result = self.analytics.market_gaps({"city": "Riyadh"}, self.population, {"الياسمين": 12000.0})
        yasmin = next(row for row in result["districts"] if row["district_ar"] == "الياسمين")
        self.assertEqual((result["fit_sample_districts"], yasmin["fit_gap_rank"], yasmin["fit_income_rank"], yasmin["fit_score"]), (1, 50, 50, 50))

    def test_id_mode_keeps_same_named_districts_and_income_ranks_separate(self):
        names = {"a": "النخيل", "b": "الياسمين", "c": "الربيع", "z": "صفر", "s": "صغير",
                 "d1": "الندى", "d2": "الندى", "out": "مجهول"}
        population = {
            "a": {"district_ar": "النخيل", "population": 20000.0, "male": 11000.0, "female": 9000.0, "source": "910ths.sa"},
            "b": {"district_ar": "الياسمين", "population": 40000.0, "male": 20000.0, "female": 20000.0},
            "c": {"district_ar": "الربيع", "population": 30000.0},
            "z": {"district_ar": "صفر", "population": 0.0},
            "s": {"district_ar": "صغير", "population": 1000.0},
            "d1": {"district_ar": "الندى", "population": 8000.0},
            "d2": {"district_ar": "الندى", "population": 12000.0},
        }
        income = {key: 1000.0 + index * 1000 for index, key in enumerate(population)}
        result = self.analytics.market_gaps(
            {"city": "Riyadh", "min_population": 0}, population, income,
            district_ids_by_name={name: key for key, name in names.items()}, district_names_by_id=names,
        )
        duplicate_names = [row for row in result["districts"] if row["district_ar"] == "الندى"]
        self.assertEqual({row["district_id"] for row in duplicate_names}, {"d1", "d2"})
        self.assertEqual(result["residents_per_business"], 5000)
        self.assertIsNotNone(next(row for row in duplicate_names if row["district_id"] == "d1")["fit_score"])

    def test_unresolved_business_identity_stops_gap_ranking_instead_of_making_a_false_zero(self):
        result = self.analytics.market_gaps(
            {"city": "Riyadh"}, {"a": {"district_ar": "النخيل", "population": 20000.0}},
            district_ids_by_name={"النخيل": "a"}, district_names_by_id={"a": "النخيل"},
        )
        self.assertIsNone(result["residents_per_business"])
        self.assertEqual(result["districts"], [])
        self.assertIn("تعذر ربط", result["message"])

    def test_district_points_list_located_businesses_of_the_districts_asked(self):
        result = self.analytics.district_points({"city": "Riyadh", "districts": ["الياسمين", "مجهول"]})
        ids = [point["id"] for point in result["points"]]
        self.assertEqual(sorted(ids), ["temp", "u0", "u1", "u2", "y0", "y1"])
        self.assertEqual(len(ids), len(set(ids)), "duplicate snapshot rows must produce one map point per business")
        temp = next(point for point in result["points"] if point["id"] == "temp")
        self.assertEqual((temp["name"], temp["district_ar"], temp["lon"], temp["lat"]),
                         ("مؤقت", "مجهول", 46.8, 24.9),
                         "when duplicate identities disagree, the reliable district record must win deterministically")
        self.assertNotIn("untrusted", ids, "an unreliable district assignment must not be used to route a visit")
        self.assertNotIn("permanent", ids, "permanently closed businesses must not appear as route points")
        self.assertEqual(set(result["points"][0]), {"id", "name", "district_ar", "lon", "lat", "whatsapp"})
        self.assertFalse(result["truncated"])
        with self.assertRaises(ValueError):
            self.analytics.district_points({"city": "Riyadh"})   # never the whole city in one call

    def test_min_population_and_limit_are_respected_and_validated(self):
        result = self.analytics.market_gaps({"city": "Riyadh", "min_population": 500, "limit": 2}, self.population)
        self.assertEqual(len(result["districts"]), 2)
        for bad in ({"city": "Riyadh", "min_population": -1}, {"city": "Riyadh", "limit": 0}, {"city": "Riyadh", "limit": True}):
            with self.assertRaises(ValueError):
                self.analytics.market_gaps(bad, self.population)

    def test_no_population_or_no_businesses_gives_an_explained_empty_answer(self):
        result = self.analytics.market_gaps({"city": "Riyadh"}, {})
        self.assertEqual(result["districts"], [])
        self.assertIsNone(result["residents_per_business"])
        self.assertTrue(result["message"])


if __name__ == "__main__":
    unittest.main()
