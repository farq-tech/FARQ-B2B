import json
import tempfile
import unittest
from pathlib import Path

import district_reference


class DistrictReferenceTests(unittest.TestCase):
    def setUp(self):
        self.path = str(Path(tempfile.mkdtemp()) / "districts_910ths.json")
        Path(self.path).write_text(json.dumps({"source": "910ths.sa", "cities": {"Riyadh": [
            {"district_ar": "الربيع", "population": 35100, "male_pct": 58.1, "income_all": 10700}]}}, ensure_ascii=False), encoding="utf-8")

    def test_population_is_replaced_only_where_910ths_lists_the_district(self):
        rows = [{"district_ar": "الربيع", "population": 20000.0, "source": "WorldPop", "license": "CC-BY-4.0", "year": 2025, "coverage_pct": 90.0},
                {"district_ar": "النرجس", "population": 50000.0, "source": "WorldPop", "license": "CC-BY-4.0", "year": 2025, "coverage_pct": 95.0}]
        out = district_reference.apply_population(rows, "Riyadh", self.path)
        self.assertEqual((out[0]["population"], out[0]["source"], out[0]["license"]), (35100.0, "910ths.sa", None))
        self.assertEqual((out[1]["population"], out[1]["source"]), (50000.0, "WorldPop"))
        self.assertEqual(district_reference.apply_population([dict(rows[1])], "Jeddah", self.path)[0]["population"], 50000.0)

    def test_male_share_comes_from_910ths_and_the_regional_split_is_never_shown_as_local(self):
        # WorldPop gives every district of a region the same split (60/40 here); its age shape is kept
        rows = [{"district_ar": "الربيع", "age_code": "ALL", "male": 12000.0, "female": 8000.0, "total": 20000.0},
                {"district_ar": "الربيع", "age_code": "00", "male": 3000.0, "female": 2000.0, "total": 5000.0},
                {"district_ar": "الربيع", "age_code": "30", "male": 9000.0, "female": 6000.0, "total": 15000.0},
                {"district_ar": "النرجس", "age_code": "ALL", "male": 30000.0, "female": 20000.0, "total": 50000.0},
                {"district_ar": "النرجس", "age_code": "00", "male": 30000.0, "female": 20000.0, "total": 50000.0}]
        out = district_reference.apply_demographics(rows, "Riyadh", self.path)
        ages = [r for r in out if r["district_ar"] == "الربيع" and r["age_code"] != "ALL"]
        self.assertAlmostEqual(sum(r["total"] for r in ages), 35100, places=3)
        self.assertAlmostEqual(sum(r["male"] for r in ages) / 35100, 0.581, places=6)
        self.assertAlmostEqual(ages[1]["total"] / ages[0]["total"], 3.0, places=1, msg="age shape is unchanged")
        whole = next(r for r in out if r["district_ar"] == "الربيع" and r["age_code"] == "ALL")
        self.assertAlmostEqual(whole["male"] + whole["female"], 35100, places=3)
        others = [r for r in out if r["district_ar"] == "النرجس"]
        self.assertTrue(all(r["male"] is None and r["female"] is None for r in others), "no measured split: unavailable, not 60/40")
        self.assertEqual(others[0]["total"], 50000.0, "the WorldPop total itself is untouched")

    def test_missing_or_broken_file_changes_nothing(self):
        Path(self.path).write_text("{not json", encoding="utf-8")
        self.assertEqual(district_reference.city_rows("Riyadh", self.path), {})
        self.assertIsNone(district_reference.load(str(Path(self.path).with_name("absent.json"))))


if __name__ == "__main__":
    unittest.main()
