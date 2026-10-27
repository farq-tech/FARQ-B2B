import json
import tempfile
import unittest
from pathlib import Path

import golden


class GoldenPopulationTests(unittest.TestCase):
    def setUp(self):
        self.path = str(Path(tempfile.mkdtemp()) / "districts_910ths.json")
        Path(self.path).write_text(json.dumps({"source": "910ths.sa", "retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": "الربيع", "population": 35100, "male_pct": 58.1, "income_all": 10700}]}}, ensure_ascii=False), encoding="utf-8")

    def rows(self):
        return [{"district_id": "1", "district_ar": "الربيع", "population": 20000.0, "source": "WorldPop", "license": "CC-BY-4.0", "year": 2025, "coverage_pct": 90.0},
                {"district_id": "2", "district_ar": "النرجس", "population": 50000.0, "source": "WorldPop", "license": "CC-BY-4.0", "year": 2025, "coverage_pct": 95.0},
                {"district_id": "3", "district_ar": "الملقا", "population": 18000.0, "source": "WorldPop", "license": "CC-BY-4.0", "year": 2025, "coverage_pct": 92.0}]

    def test_one_figure_per_district_in_priority_order(self):
        built = golden.building_totals([("1", 30000.0, "910ths.sa"), ("2", 82800.0, "910ths.sa:people_per_dwelling"), ("3", 99999.0, "worldpop_city_total")], {})
        out = {r["district_ar"]: r for r in golden.population(self.rows(), "Riyadh", built, self.path)}
        self.assertEqual((out["الربيع"]["population"], out["الربيع"]["source"]), (35100.0, "910ths.sa"), "910ths first")
        self.assertEqual((out["النرجس"]["population"], out["النرجس"]["source"]), (82800.0, golden.BUILDINGS), "then buildings calibrated on 910ths")
        self.assertEqual((out["الملقا"]["population"], out["الملقا"]["source"]), (18000.0, golden.WORLDPOP), "buildings not calibrated on 910ths never replace WorldPop")
        # Atlas (lib/live-market.ts) drops a row whose year or coverage_pct is not a number
        self.assertTrue(all(isinstance(r["year"], int) and isinstance(r["coverage_pct"], float) for r in out.values()))
        self.assertEqual(out["الربيع"]["year"], 2026)

    def test_a_910ths_figure_shared_by_two_districts_is_split_not_repeated(self):
        shared = ["النرجس", "الملقا"]
        Path(self.path).write_text(json.dumps({"retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": name, "population": 34000, "male_pct": 60.0, "shared_with": shared} for name in shared]}}, ensure_ascii=False), encoding="utf-8")
        out = {r["district_ar"]: r for r in golden.population(self.rows(), "Riyadh", {}, self.path)}
        self.assertEqual((out["النرجس"]["population"], out["الملقا"]["population"]), (25000.0, 9000.0), "split like their WorldPop figures (50,000 : 18,000)")
        out = {r["district_ar"]: r for r in golden.population(self.rows(), "Riyadh", {"2": 4000.0, "3": 30000.0}, self.path)}
        self.assertEqual((out["النرجس"]["population"], out["الملقا"]["population"]), (4000.0, 30000.0), "the building model's split when every part has one")
        self.assertEqual(out["النرجس"]["source"], "910ths.sa")

    def test_building_total_counts_only_when_every_polygon_is_calibrated(self):
        built = golden.building_totals([("10", 100.0, "910ths.sa"), ("11", 50.0, "worldpop_city_total"), ("12", 70.0, "910ths.sa")], {"11": "10"})
        self.assertEqual(built, {"12": 70.0})

    def test_ages_add_up_to_the_golden_total_and_sex_only_where_measured(self):
        rows = [{"district_ar": "الربيع", "age_code": "ALL", "male": 99999.0, "female": 1.0, "total": 100000.0},
                {"district_ar": "الربيع", "age_code": "00", "male": 3000.0, "female": 2000.0, "total": 5000.0},
                {"district_ar": "الربيع", "age_code": "30", "male": 9000.0, "female": 6000.0, "total": 15000.0},
                {"district_ar": "النرجس", "age_code": "ALL", "male": 30000.0, "female": 20000.0, "total": 50000.0},
                {"district_ar": "النرجس", "age_code": "00", "male": 12000.0, "female": 8000.0, "total": 20000.0},
                {"district_ar": "النرجس", "age_code": "30", "male": 18000.0, "female": 12000.0, "total": 30000.0}]
        out = golden.demographics(rows, {"الربيع": 35100.0, "النرجس": 82800.0}, "Riyadh", self.path)
        rabi = [r for r in out if r["district_ar"] == "الربيع" and r["age_code"] != "ALL"]
        self.assertAlmostEqual(sum(r["total"] for r in rabi), 35100, places=3)
        self.assertAlmostEqual(sum(r["male"] for r in rabi) / 35100, 0.581, places=6)
        self.assertAlmostEqual(rabi[1]["total"] / rabi[0]["total"], 3.0, places=1, msg="age shape is kept")
        whole = next(r for r in out if r["district_ar"] == "الربيع" and r["age_code"] == "ALL")
        self.assertAlmostEqual(whole["male"] + whole["female"], 35100, places=3)
        narjis = [r for r in out if r["district_ar"] == "النرجس"]
        self.assertAlmostEqual(sum(r["total"] for r in narjis if r["age_code"] != "ALL"), 82800, places=3, msg="ages follow the golden total, not WorldPop's")
        self.assertEqual(next(r for r in narjis if r["age_code"] == "ALL")["total"], 82800.0)
        self.assertTrue(all(r["male"] is None and r["female"] is None for r in narjis), "no measured split: unavailable, not the regional one")


if __name__ == "__main__":
    unittest.main()
