import json
import tempfile
import unittest
from pathlib import Path

import district_reference


class DistrictReferenceTests(unittest.TestCase):
    def setUp(self):
        self.path = str(Path(tempfile.mkdtemp()) / "districts_910ths.json")
        Path(self.path).write_text(json.dumps({"source": "910ths.sa", "retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": "الربيع", "population": 35100, "male_pct": 58.1, "income_all": 10700}]}}, ensure_ascii=False), encoding="utf-8")

    def test_rows_and_year_are_read_from_the_table(self):
        self.assertEqual(district_reference.city_rows("Riyadh", self.path)["الربيع"]["population"], 35100)
        self.assertEqual(district_reference.reference_year(self.path), 2026)
        self.assertEqual(district_reference.city_rows("Jeddah", self.path), {})

    def test_missing_or_broken_file_changes_nothing(self):
        Path(self.path).write_text("{not json", encoding="utf-8")
        self.assertEqual(district_reference.city_rows("Riyadh", self.path), {})
        self.assertIsNone(district_reference.load(str(Path(self.path).with_name("absent.json"))))

    def test_invalid_shares_are_unavailable_without_clamping_valid_source_data(self):
        Path(self.path).write_text(json.dumps({"cities": {"Riyadh": [
            {"district_ar": "الربيع", "male_pct": -0.1, "saudi_pct": 100.0},
            {"district_ar": "النخيل", "male_pct": 100.1, "saudi_pct": True},
        ]}}, ensure_ascii=False), encoding="utf-8")
        rows = district_reference.city_rows("Riyadh", self.path)
        self.assertIsNone(rows["الربيع"]["male_pct"])
        self.assertEqual(rows["الربيع"]["saudi_pct"], 100.0)
        self.assertIsNone(rows["النخيل"]["male_pct"])
        self.assertIsNone(rows["النخيل"]["saudi_pct"])


if __name__ == "__main__":
    unittest.main()
