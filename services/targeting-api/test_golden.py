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

    def test_housing_merges_polygons_before_calculating_the_classified_unit_share(self):
        result = golden.housing([
            ("492", "اسم قديم", 100.0, 300.0), ("493", "العليا", 50.0, 200.0),
            ("380", "السليمانية", 10.0, 1000.0), ("7", "صغير", 5.0, 20.0),
        ], {"492": "492", "493": "492", "380": "380", "7": "7"}, {"492": ("العليا", None)})
        self.assertEqual([(row["district_ar"], row["villa_share_pct"], row["classified_home_units"]) for row in result], [
            ("العليا", 30.0, 500), ("السليمانية", 1.0, 1000),
        ])

    def test_housing_hides_a_merged_district_when_any_polygon_measure_is_invalid(self):
        id_map = {"492": "492", "493": "492", "380": "380"}
        names = {"492": ("العليا", None), "380": ("السليمانية", None)}
        rows = [
            ("492", "العليا", None, 300.0), ("493", "العليا", 50.0, 200.0),
            ("380", "السليمانية", 10.0, 1000.0),
        ]

        result = golden.housing(rows, id_map, names)

        self.assertEqual([row["district_ar"] for row in result], ["السليمانية"])

        impossible_ratio = golden.housing([("380", "السليمانية", 1001.0, 1000.0)], {"380": "380"}, names)
        self.assertEqual(impossible_ratio, [])

    def test_one_figure_per_district_in_priority_order(self):
        built = golden.building_totals([("1", 30000.0, "910ths.sa"), ("2", 82800.0, "910ths.sa:people_per_dwelling"), ("3", 99999.0, "worldpop_city_total")], {})
        out = {r["district_ar"]: r for r in golden.population(self.rows(), "Riyadh", built, self.path)}
        self.assertEqual((out["الربيع"]["population"], out["الربيع"]["source"]), (35100.0, "910ths.sa"), "910ths first")
        self.assertEqual((out["النرجس"]["population"], out["النرجس"]["source"]), (82800.0, golden.BUILDINGS), "then buildings calibrated on 910ths")
        self.assertEqual((out["الملقا"]["population"], out["الملقا"]["source"]), (18000.0, golden.WORLDPOP), "buildings not calibrated on 910ths never replace WorldPop")
        # Atlas (lib/live-market.ts) drops a row whose year or coverage_pct is not a number
        self.assertTrue(all(isinstance(r["year"], int) and isinstance(r["coverage_pct"], float) for r in out.values()))
        self.assertEqual(out["الربيع"]["year"], 2026)

    def test_population_name_map_keeps_districts_without_a_golden_row_unavailable(self):
        out = golden.population_by_name([
            {"district_ar": "الربيع", "population": 0, "source": "910ths.sa"},
            {"district_ar": "النرجس", "population": 50000, "source": "WorldPop"},
        ], ["الربيع", "النرجس", "الملقا"])
        self.assertEqual(out["الربيع"]["population"], 0, "a measured zero remains a valid measurement")
        self.assertEqual(out["النرجس"]["population"], 50000)
        self.assertIsNone(out["الملقا"]["population"], "a missing golden row is unavailable, not zero")

    def test_a_910ths_figure_shared_by_two_districts_is_split_not_repeated(self):
        shared = ["النرجس", "الملقا"]
        Path(self.path).write_text(json.dumps({"retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": name, "population": 34000, "male_pct": 60.0, "shared_with": shared} for name in shared]}}, ensure_ascii=False), encoding="utf-8")
        out = {r["district_ar"]: r for r in golden.population(self.rows(), "Riyadh", {}, self.path)}
        self.assertEqual((out["النرجس"]["population"], out["الملقا"]["population"]), (25000.0, 9000.0), "split like their WorldPop figures (50,000 : 18,000)")
        out = {r["district_ar"]: r for r in golden.population(self.rows(), "Riyadh", {"2": 4000.0, "3": 30000.0}, self.path)}
        self.assertEqual((out["النرجس"]["population"], out["الملقا"]["population"]), (4000.0, 30000.0), "the building model's split when every part has one")
        self.assertEqual(out["النرجس"]["source"], "910ths.sa")

    def test_shared_910ths_total_falls_back_to_each_worldpop_value_if_one_part_is_unavailable(self):
        shared = ["النرجس", "الملقا"]
        Path(self.path).write_text(json.dumps({"retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": name, "population": 34000, "shared_with": shared} for name in shared]}}, ensure_ascii=False), encoding="utf-8")
        rows = self.rows()
        rows[2]["population"] = None

        out = {row["district_ar"]: row for row in golden.population(rows, "Riyadh", {}, self.path)}

        self.assertEqual((out["النرجس"]["population"], out["النرجس"]["source"]), (50000, golden.WORLDPOP))
        self.assertEqual((out["الملقا"]["population"], out["الملقا"]["source"]), (None, golden.WORLDPOP))

    def test_shared_910ths_total_is_not_split_over_only_present_district_rows(self):
        shared = ["النرجس", "الملقا"]
        Path(self.path).write_text(json.dumps({"retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": name, "population": 34000, "shared_with": shared} for name in shared]}}, ensure_ascii=False), encoding="utf-8")
        rows = [row for row in self.rows() if row["district_ar"] == "النرجس"]

        out = golden.population(rows, "Riyadh", {}, self.path)
        by_name = golden.population_by_name(out, shared)

        self.assertEqual((out[0]["population"], out[0]["source"]), (50000, golden.WORLDPOP))
        self.assertIsNone(by_name["الملقا"]["population"])

    def test_shared_910ths_total_does_not_use_an_equal_split_when_worldpop_weights_are_zero(self):
        shared = ["النرجس", "الملقا"]
        Path(self.path).write_text(json.dumps({"retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": name, "population": 34000, "shared_with": shared} for name in shared]}}, ensure_ascii=False), encoding="utf-8")
        rows = self.rows()
        rows[1]["population"] = 0
        rows[2]["population"] = 0

        out = {row["district_ar"]: row for row in golden.population(rows, "Riyadh", {}, self.path)}

        self.assertEqual((out["النرجس"]["population"], out["النرجس"]["source"]), (0, golden.WORLDPOP))
        self.assertEqual((out["الملقا"]["population"], out["الملقا"]["source"]), (0, golden.WORLDPOP))

    def test_shared_910ths_total_uses_worldpop_when_complete_building_weights_have_no_basis(self):
        shared = ["النرجس", "الملقا"]
        Path(self.path).write_text(json.dumps({"retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": name, "population": 34000, "shared_with": shared} for name in shared]}}, ensure_ascii=False), encoding="utf-8")

        out = {row["district_ar"]: row for row in golden.population(self.rows(), "Riyadh", {"2": 0.0, "3": 0.0}, self.path)}

        self.assertEqual((out["النرجس"]["population"], out["الملقا"]["population"]), (25000, 9000))
        self.assertTrue(all(out[name]["source"] == "910ths.sa" for name in shared))

    def test_population_is_whole_people(self):
        out = {r["district_ar"]: r for r in golden.population(self.rows(), "Riyadh", {"2": 58770.9, "3": 7.6}, self.path)}
        self.assertEqual((out["النرجس"]["population"], out["الملقا"]["population"]), (58771, 8))
        self.assertTrue(all(isinstance(out[name]["population"], int) for name in ("الربيع", "النرجس", "الملقا") if out[name]["source"] != golden.WORLDPOP))

    def test_measured_zero_from_910ths_keeps_priority_over_other_sources(self):
        Path(self.path).write_text(json.dumps({"retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": "الربيع", "population": 0}]}}, ensure_ascii=False), encoding="utf-8")
        out = {row["district_ar"]: row for row in golden.population(self.rows(), "Riyadh", {"1": 20000.0}, self.path)}
        self.assertEqual((out["الربيع"]["population"], out["الربيع"]["source"]), (0, "910ths.sa"))

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

    def test_incomplete_age_shape_stays_unavailable_instead_of_becoming_zeroes(self):
        rows = [
            {"district_ar": "الربيع", "age_code": "ALL", "male": None, "female": None, "total": 100.0},
            {"district_ar": "الربيع", "age_code": "00", "male": 30.0, "female": 20.0, "total": 50.0},
            {"district_ar": "الربيع", "age_code": "30", "male": None, "female": None, "total": None},
        ]

        out = golden.demographics(rows, {"الربيع": 35100.0}, "Riyadh", self.path)
        age_rows = [row for row in out if row["age_code"] != "ALL"]
        whole = next(row for row in out if row["age_code"] == "ALL")

        self.assertEqual([row["total"] for row in age_rows], [None, None])
        self.assertTrue(all(row["male"] is None and row["female"] is None for row in age_rows))
        self.assertEqual(whole["total"], 35100.0)
        self.assertAlmostEqual(whole["male"] + whole["female"], 35100.0)


if __name__ == "__main__":
    unittest.main()
