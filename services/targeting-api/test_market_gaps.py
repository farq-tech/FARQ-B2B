"""Market-gap ranking against synthetic directory rows and district populations."""
import pathlib
import sys
import tempfile
import threading
import unittest

import duckdb
import json

SERVICE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))
from market_analytics import MarketAnalytics  # noqa: E402


def _analytics(root, counts):
    """An analytics instance over a directory where `counts` maps a district to its business count. Each
    business is one synthetic pharmacy row so district_counts sees them."""
    root.mkdir(parents=True, exist_ok=True)
    targets = root / "targets.parquet"
    db = duckdb.connect()
    db.execute("""create table targets(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar,
        has_whatsapp boolean, phone_norm varchar, is_wholesale boolean, district_ar varchar, district_reliable boolean,
        location_precision varchar, longitude double, latitude double)""")
    rows = []
    for district, n in counts.items():
        for i in range(n):
            rows.append((f"{district}-{i}", "Riyadh", f"صيدلية {district}{i}", None, False, None, False,
                         district, True, "point", 46.6, 24.7))
    if rows:
        db.executemany("insert into targets values (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    db.execute("copy targets to ? (format parquet)", [str(targets)])
    db.close()
    tiles = type("Tiles", (), {})()
    tiles.db, tiles.lock, tiles.search_sql, tiles.path = duckdb.connect(), threading.RLock(), "true", str(targets)
    return MarketAnalytics(tiles)


class MarketGapTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        # The النخيل/الياسمين example: more people, fewer pharmacies — count does NOT track population (and only
        # two covered districts anyway). الربيع has people and none; a district with no population figure holds 3.
        self.analytics = _analytics(self.root, {"النخيل": 10, "الياسمين": 2, "مجهول": 3})
        self.population = {
            "النخيل": {"population": 20000.0, "male": 11000.0, "female": 9000.0, "source": "910ths.sa"},
            "الياسمين": {"population": 40000.0, "male": 20000.0, "female": 20000.0},
            "الربيع": {"population": 30000.0, "male": None, "female": None},
            "صغير": {"population": 1000.0, "male": None, "female": None},
        }

    # ------- the population model does not hold here -------

    def test_negative_relationship_returns_unavailable_not_a_hard_shortfall(self):
        # النخيل (20k people, 10 pharmacies) vs الياسمين (40k people, 2): double the people, a fifth of the shops.
        # The old tool published النخيل «مكتفٍ» and الياسمين «ناقص +N» off a 5,000-residents rate; it must not.
        result = self.analytics.market_gaps({"city": "Riyadh"}, self.population)
        self.assertFalse(result["population_model_fits"])
        self.assertIsNone(result["residents_per_business"], "no honest city rate, so none is published")
        self.assertEqual(result["covered_districts"], 2, "only النخيل and الياسمين carry both figures")
        # with only two covered districts the honest reason is that we cannot judge the relationship, not a
        # verdict that the activity ignores population (r over two points is meaningless)
        self.assertEqual(result["population_model_reason"], "too_few_districts")
        self.assertTrue(result["message"], "the panel is told why no shortfall is shown")
        for row in result["districts"]:
            self.assertIsNone(row["expected_businesses"], "no invented «يحتاج» number")
            self.assertIsNone(row["shortfall"], "no fabricated «+N» shortfall")
        # districts are listed by their real directory counts only, the most-served first
        names = [row["district_ar"] for row in result["districts"]]
        self.assertEqual(names, ["النخيل", "الياسمين", "الربيع"], "by real counts: 10, 2, 0")
        self.assertEqual([row["businesses"] for row in result["districts"]], [10, 2, 0])

    def test_too_few_covered_districts_does_not_hold_even_if_positively_correlated(self):
        # three districts, count rising with population — a real signal, but far too thin to trust a city rate
        analytics = _analytics(self.root / "thin", {"أ": 2, "ب": 4, "ج": 6})
        population = {"أ": {"population": 10000.0, "male": None, "female": None},
                      "ب": {"population": 20000.0, "male": None, "female": None},
                      "ج": {"population": 30000.0, "male": None, "female": None}}
        result = analytics.market_gaps({"city": "Riyadh"}, population)
        self.assertFalse(result["population_model_fits"], "3 < 8 covered districts")
        self.assertEqual(result["covered_districts"], 3)
        self.assertEqual(result["population_model_reason"], "too_few_districts", "a positive but thin signal is not judged")
        self.assertIsNone(result["residents_per_business"])

    def test_enough_districts_but_count_ignores_population_is_a_weak_relationship(self):
        # the real wholesale/B2B case: eight covered districts, but more people means fewer businesses — the
        # count does not track population, so it is a genuine non-population verdict, not thin data
        counts = {f"w{i}": c for i, c in enumerate([8, 7, 6, 5, 4, 3, 2, 1])}
        pops = {f"w{i}": p for i, p in enumerate([10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000])}
        analytics = _analytics(self.root / "wholesale", counts)
        population = {name: {"population": float(p), "male": None, "female": None} for name, p in pops.items()}
        result = analytics.market_gaps({"city": "Riyadh"}, population)
        self.assertFalse(result["population_model_fits"])
        self.assertEqual(result["covered_districts"], 8, "enough districts to judge")
        self.assertEqual(result["population_model_reason"], "weak_relationship", "negative relationship, not thin data")
        self.assertLess(result["fit"], 0, "the measured correlation is negative")
        self.assertEqual(result["message"],
                         "هذا النشاط لا يتبع عدد السكان في هذه المدينة، فلا يمكن تقدير النقص؛ "
                         "تُعرض الأحياء بأعدادها الفعلية فقط.", "the product-mandated wording for this case")
        for row in result["districts"]:
            self.assertIsNone(row["shortfall"])

    # ------- the population model holds (behaviour unchanged) -------

    def _fitting(self):
        """Eight residential districts whose pharmacy count tracks population, one clearly under-served, plus a
        surplus one — enough covered districts and a positive, tight relationship for the model to hold."""
        counts = {"حي1": 10, "حي2": 9, "حي3": 8, "حي4": 7, "حي5": 6, "حي6": 5, "حي7": 4,
                  "ناقص": 4, "فائض": 8}
        pops = {"حي1": 50000, "حي2": 45000, "حي3": 40000, "حي4": 35000, "حي5": 30000, "حي6": 25000,
                "حي7": 20000, "ناقص": 40000, "فائض": 25000}
        analytics = _analytics(self.root / "fit", counts)
        population = {name: {"population": float(p), "male": None, "female": None} for name, p in pops.items()}
        return analytics, population, counts, pops

    def test_model_holds_path_ranks_by_shortfall_against_the_city_rate(self):
        analytics, population, counts, pops = self._fitting()
        result = analytics.market_gaps({"city": "Riyadh"}, population)
        self.assertTrue(result["population_model_fits"])
        self.assertEqual(result["covered_districts"], len(counts))
        self.assertIsNotNone(result["fit"], "the correlation is reported so the number is auditable")
        self.assertGreaterEqual(result["fit"], 0.3, "the holds path is a positive, tight-enough fit")
        rate = result["residents_per_business"]
        self.assertEqual(rate, round(sum(pops.values()) / sum(counts.values())), "city rate = people / businesses")
        self.assertIn(f"r = {result['fit']}", result["basis"], "basis shows the measured correlation")
        by_name = {row["district_ar"]: row for row in result["districts"]}
        # each expected count and shortfall is the city rate applied to the district's own population
        naqis = by_name["ناقص"]
        self.assertEqual(naqis["expected_businesses"], round(pops["ناقص"] / rate, 1))
        self.assertEqual(naqis["shortfall"], round(pops["ناقص"] / rate - counts["ناقص"], 1))
        self.assertGreater(naqis["shortfall"], 0, "the under-served district is short")
        self.assertEqual(result["districts"][0]["district_ar"], "ناقص", "largest shortfall leads")
        self.assertLess(by_name["فائض"]["shortfall"], 0, "a surplus is a negative shortfall")

    def test_model_holds_industrial_and_labour_housing_go_after_residential(self):
        analytics, population, counts, pops = self._fitting()
        # no pharmacy in either and both large: by shortfall alone they would lead the list
        population["المدينة الصناعية الجديدة"] = {"population": 100000.0, "male": 60000.0, "female": 40000.0}
        population["سكن عمال"] = {"population": 80000.0, "male": 79000.0, "female": 1000.0}
        result = analytics.market_gaps({"city": "Riyadh"}, population)
        self.assertTrue(result["population_model_fits"], "the two zero-business districts are not covered")
        self.assertEqual(result["covered_districts"], len(counts))
        caveats = {row["district_ar"]: row["caveat"] for row in result["districts"]}
        self.assertEqual(caveats["المدينة الصناعية الجديدة"], "industrial")
        self.assertEqual(caveats["سكن عمال"], "workers")
        order = [row["district_ar"] for row in result["districts"]]
        flagged = [name for name, row in zip(order, result["districts"]) if row["caveat"] is not None]
        self.assertEqual(flagged, ["المدينة الصناعية الجديدة", "سكن عمال"], "flagged districts come last")
        self.assertEqual(order[-2:], ["المدينة الصناعية الجديدة", "سكن عمال"], "and after every residential one")

    def test_model_holds_a_grid_population_over_little_of_the_district_goes_last_flagged(self):
        analytics, population, counts, pops = self._fitting()
        # Al Khobar's الظهران as served: 242,901 people spread from a grid over 23% of its cells, 5 pharmacies; by its
        # shortfall it led the list. A grid figure over most of its district (الخبر الشمالية, 76%) stays ordinary.
        population["الظهران"] = {"population": 242901.2, "male": None, "female": None, "source": "WorldPop 2025", "coverage_pct": 22.9044, "settled_pct": 23}
        population["الخبر الشمالية"] = {"population": 45000.0, "male": None, "female": None, "source": "WorldPop 2025", "coverage_pct": 76.0}
        result = analytics.market_gaps({"city": "Riyadh"}, population)
        self.assertTrue(result["population_model_fits"])
        by_name = {row["district_ar"]: row for row in result["districts"]}
        self.assertEqual(by_name["الظهران"]["caveat"], "estimated")
        self.assertEqual(by_name["الظهران"]["population_coverage_pct"], 23)
        self.assertIsNone(by_name["الخبر الشمالية"]["caveat"])
        self.assertIsNone(by_name["حي1"]["population_coverage_pct"], "a measured figure carries no coverage")
        self.assertEqual(by_name["الظهران"]["settled_pct"], 23, "the settled share travels with the row")
        self.assertIsNone(by_name["حي1"]["settled_pct"], "none given: none said")
        self.assertEqual(result["districts"][-1]["district_ar"], "الظهران", "listed after every ordinary district")
        self.assertNotEqual(result["districts"][0]["district_ar"], "الظهران")
        # its figures are kept, never dropped or zeroed
        self.assertEqual(by_name["الظهران"]["population"], 242901)
        self.assertGreater(by_name["الظهران"]["shortfall"], 0)

    def test_model_holds_a_closed_campus_goes_after_the_residential_districts(self):
        analytics, population, counts, pops = self._fitting()
        # Al Khobar as served: the university campus, 31,805 people and no pharmacy here, led the list second
        population["جامعة الملك فهد للبترول"] = {"population": 31805.0, "male": None, "female": None, "source": "910ths.sa", "coverage_pct": 100.0}
        # a residential district whose name only contains the word stays ordinary
        population["الجامعة"] = {"population": 30000.0, "male": None, "female": None, "source": "910ths.sa", "coverage_pct": 100.0}
        result = analytics.market_gaps({"city": "Riyadh"}, population)
        by_name = {row["district_ar"]: row for row in result["districts"]}
        self.assertEqual(by_name["جامعة الملك فهد للبترول"]["caveat"], "campus")
        self.assertIsNone(by_name["الجامعة"]["caveat"])
        self.assertEqual(result["districts"][-1]["district_ar"], "جامعة الملك فهد للبترول")

    # ------- shared behaviour -------

    def test_no_response_field_names_an_outside_source(self):
        # docs/atlas-product-foundation.md §5: the interface never names a source, so neither does what it is sent
        population = {**self.population, "الربيع": {"population": 30000.0, "male": None, "female": None, "source": "WorldPop 2025"},
                      "الياسمين": {"population": 40000.0, "male": 20000.0, "female": 20000.0, "source": "farq_buildings_v3"}}
        for answer in (self.analytics.market_gaps({"city": "Riyadh"}, population), self.analytics.market_gaps({"city": "Riyadh"}, {})):
            text = json.dumps(answer, ensure_ascii=False).lower()
            for name in ("910ths", "worldpop", "world pop"):
                self.assertNotIn(name, text)
        # every explanation the analytics hand out, not only the gaps one
        import market_analytics
        for key, value in vars(market_analytics).items():
            if key.endswith("_BASIS") and isinstance(value, str):
                self.assertNotRegex(value.lower(), "910ths|worldpop|world pop", key)
        methods = {row["district_ar"]: row["population_method"] for row in self.analytics.market_gaps({"city": "Riyadh"}, population)["districts"]}
        self.assertEqual(methods, {"النخيل": "measured", "الياسمين": "buildings", "الربيع": "grid"})

    def test_district_points_list_located_businesses_of_the_districts_asked(self):
        result = self.analytics.district_points({"city": "Riyadh", "districts": ["الياسمين", "مجهول"]})
        self.assertEqual(sorted(point["id"] for point in result["points"]),
                         ["الياسمين-0", "الياسمين-1", "مجهول-0", "مجهول-1", "مجهول-2"])
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
