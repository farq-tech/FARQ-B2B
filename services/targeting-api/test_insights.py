"""Insight functions against small synthetic files."""
import json
import pathlib
import sys
import tempfile
import unittest

import duckdb

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import insights  # noqa: E402


def square(x, y, size=0.01):
    return {'type': 'Polygon', 'coordinates': [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]}


class InsightTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.db = duckdb.connect()

    def parquet(self, name, columns, rows):
        path = self.root / name
        self.db.execute(f"create or replace table t ({columns})")
        self.db.executemany("insert into t values (" + ", ".join("?" for _ in columns.split(",")) + ")", rows)
        self.db.execute(f"copy t to '{path}' (format parquet)")
        return str(path)

    def test_growth_merges_polygons_into_canonical_districts_and_ranks(self):
        path = self.parquet("g.parquet", "district_id varchar, district_ar varchar, city_en varchar, under_construction bigint, new_buildings bigint, homes_under_construction bigint, floor_area_m2 double", [
            ("492", "العليا", "Riyadh", 3, 1, 2, 100.0), ("493", "العليا", "Riyadh", 4, 0, 1, 50.0), ("380", "السليمانية", "Riyadh", 10, 0, 9, 900.0), ("1", "x", "Jeddah", 99, 0, 0, 0.0)])
        rows = insights.growth(self.db, path, "Riyadh", {"492": "492", "493": "492", "380": "380"}, {"492": ("العليا", None), "380": ("السليمانية", None)})
        self.assertEqual([r["district_ar"] for r in rows], ["السليمانية", "العليا"])
        self.assertEqual((rows[1]["under_construction"], rows[1]["new_buildings"], rows[1]["homes_under_construction"], rows[1]["floor_area_m2"]), (7, 1, 3, 150))
        self.assertIsNone(insights.growth(self.db, None, "Riyadh", {}, {}), "no layer yet is reported as missing, not as zero")

    def test_population_and_businesses_within_a_radius(self):
        # three home buildings: two within ~300 m of the point, one ~5 km away
        points = self.parquet("p.parquet", "longitude double, latitude double, district_id varchar, dwellings double", [
            (46.7000, 24.7000, "1", 4.0), (46.7020, 24.7010, "1", 6.0), (46.7500, 24.7000, "2", 100.0)])
        targets = self.parquet("t.parquet", "poi_key varchar, longitude double, latitude double, category_ar varchar, category varchar", [
            ("a", 46.7001, 24.7001, "صيدلية", "Pharmacy"), ("b", 46.7002, 24.7002, "صيدلية", "Pharmacy"), ("c", 46.7003, 24.6999, "مطعم", "Restaurant"), ("d", 46.80, 24.80, "مطعم", "Restaurant")])
        result = insights.population_around(self.db, points, targets, "true", 46.7005, 24.7003, 500, 5.0)
        self.assertEqual((result["home_buildings"], result["dwellings"], result["population"]), (2, 10.0, 50))
        self.assertEqual(result["businesses"], 3)
        self.assertEqual(result["top_activities"][0], {"activity": "صيدلية", "n": 2})

    def test_population_around_uses_each_buildings_people_when_the_layer_has_them(self):
        points = self.parquet("p3.parquet", "longitude double, latitude double, district_id varchar, dwellings double, population double", [
            (46.7000, 24.7000, "1", 4.0, 30.0), (46.7020, 24.7010, "1", 6.0, 45.0), (46.7500, 24.7000, "2", 100.0, 500.0)])
        result = insights.population_around(self.db, points, None, "true", 46.7005, 24.7003, 500, 5.0)
        self.assertEqual((result["home_buildings"], result["dwellings"], result["population"], result["people_per_district"]), (2, 10.0, 75, True))

    def test_territories_are_balanced_runs_of_neighbouring_districts(self):
        features = [{"properties": {"id": i, "ar": f"حي{i}"}, "geometry": square(46.0 + (i % 4) * 0.01, 24.0 + (i // 4) * 0.01)} for i in range(16)]
        weights = {f"حي{i}": 100 for i in range(16)}
        groups = insights.territories(features, weights, 4)
        self.assertEqual(len(groups), 4)
        self.assertEqual(sorted(len(g["districts"]) for g in groups), [4, 4, 4, 4])
        self.assertEqual([g["share_pct"] for g in groups], [25.0, 25.0, 25.0, 25.0])
        # each territory of a 4×4 grid along a Hilbert curve is a 2×2 block
        for group in groups:
            ids = [d["district_id"] for d in group["districts"]]
            cols, rows = {i % 4 for i in ids}, {i // 4 for i in ids}
            self.assertEqual((len(cols), len(rows)), (2, 2), ids)
        self.assertEqual(insights.territories(features, {}, 3), [], "districts without weight are left out")

    def test_district_income_reads_the_reference_table(self):
        path = self.root / "income.json"
        path.write_text(json.dumps({"source": "s", "retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": "الربيع", "population": 35100, "income_all": 10700}, {"district_ar": "سكيرينة", "population": 11500, "income_all": None}]}}, ensure_ascii=False), encoding="utf-8")
        table = insights.district_income("Riyadh", str(path))
        self.assertEqual(table["districts"], [{"district_ar": "الربيع", "income_all": 10700, "income_male": None, "income_female": None, "income_saudi": None, "income_non_saudi": None}],
                         "districts with no published income are left out, not shown as zero")
        self.assertEqual(table["unit"], "SAR/month")
        self.assertIsNone(insights.district_income("Jeddah", str(path)))
        self.assertIsNone(insights.district_income("Riyadh", str(self.root / "missing.json")))


if __name__ == "__main__":
    unittest.main()
