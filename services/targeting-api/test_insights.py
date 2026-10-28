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
        rows = insights.growth(self.db, path, ["492", "493", "380"], {"492": "492", "493": "492", "380": "380"}, {"492": ("العليا", None), "380": ("السليمانية", None)})
        self.assertEqual([r["district_ar"] for r in rows], ["السليمانية", "العليا"])
        self.assertEqual((rows[1]["under_construction"], rows[1]["new_buildings"], rows[1]["homes_under_construction"], rows[1]["floor_area_m2"]), (7, 1, 3, 150))
        self.assertIsNone(insights.growth(self.db, None, [], {}, {}), "no layer yet is reported as missing, not as zero")

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

    def test_population_and_businesses_within_a_drive_time_polygon(self):
        points = self.parquet("pw.parquet", "longitude double, latitude double, district_id varchar, dwellings double, population double", [
            (46.7000, 24.7000, "1", 4.0, 30.0), (46.7020, 24.7010, "1", 6.0, 45.0), (46.7090, 24.7090, "1", 8.0, 60.0), (46.7500, 24.7000, "2", 100.0, 500.0)])
        targets = self.parquet("tw.parquet", "poi_key varchar, longitude double, latitude double, category_ar varchar, category varchar", [
            ("a", 46.7001, 24.7001, "صيدلية", "Pharmacy"), ("b", 46.7091, 24.7091, "مطعم", "Restaurant"), ("c", 46.80, 24.80, "مطعم", "Restaurant")])
        # an L-shaped area: the box's top-right corner (46.705+, 24.705+) is outside even though it is inside the box
        shape = {"type": "Polygon", "coordinates": [[[46.695, 24.695], [46.712, 24.695], [46.712, 24.705], [46.705, 24.705], [46.705, 24.712], [46.695, 24.712], [46.695, 24.695]]]}
        result = insights.population_within(self.db, points, targets, "true", shape, 5.0)
        self.assertEqual((result["home_buildings"], result["dwellings"], result["population"]), (2, 10.0, 75))
        self.assertEqual(result["businesses"], 1)
        self.assertEqual(result["top_activities"], [{"activity": "صيدلية", "n": 1}])
        hole = {"type": "Polygon", "coordinates": [shape["coordinates"][0], [[46.6995, 24.6995], [46.7005, 24.6995], [46.7005, 24.7005], [46.6995, 24.7005], [46.6995, 24.6995]]]}
        self.assertEqual(insights.population_within(self.db, points, None, "true", hole, 5.0)["home_buildings"], 1, "a hole is outside")
        self.assertIsNone(insights.population_within(self.db, points, None, "true", {"type": "Point"}, 5.0)["population"])

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


    def test_district_audience_keeps_only_measured_shares(self):
        path = self.root / "audience.json"
        path.write_text(json.dumps({"cities": {"Riyadh": [
            {"district_ar": "الربيع", "male_pct": 51.2, "saudi_pct": 80.1}, {"district_ar": "سكيرينة", "male_pct": None, "saudi_pct": 40.0}]}}, ensure_ascii=False), encoding="utf-8")
        table = insights.district_audience("Riyadh", str(path))
        self.assertEqual(table["districts"], [{"district_ar": "الربيع", "male_pct": 51.2, "saudi_pct": 80.1}])
        self.assertIsNone(insights.district_audience("Jeddah", str(path)))


    def test_housing_level_merges_polygons_and_skips_tiny_districts(self):
        path = self.parquet("hl.parquet", "district_id varchar, district_ar varchar, villas bigint, dwelling_units double", [
            ("492", "العليا", 100, 300.0), ("493", "العليا", 50, 200.0), ("380", "السليمانية", 10, 1000.0), ("7", "صغير", 5, 20.0)])
        rows = insights.housing_level(self.db, path, ["492", "493", "380", "7"], {"492": "492", "493": "492", "380": "380", "7": "7"}, {"492": ("العليا", None)})
        self.assertEqual([(r["district_ar"], r["villa_share_pct"], r["dwelling_units"]) for r in rows], [("العليا", 30.0, 500), ("السليمانية", 1.0, 1000)])
        self.assertIsNone(insights.housing_level(self.db, None, [], {}, {}))


    def test_real_estate_reads_the_reference_and_reports_a_missing_table(self):
        path = self.root / "re.json"
        path.write_text(json.dumps({"retrieved": "2026-10-28", "min_listings": 5, "cities": {"Riyadh": [
            {"district_id": "492", "district_ar": "العليا", "groups": {"rent_commercial": {"listings": 7, "median_sar_per_sqm": 900}}}]}}, ensure_ascii=False), encoding="utf-8")
        table = insights.real_estate("Riyadh", str(path))
        self.assertEqual(table["districts"][0]["groups"]["rent_commercial"]["median_sar_per_sqm"], 900)
        self.assertIsNone(insights.real_estate("Jeddah", str(path)))
        self.assertIsNone(insights.real_estate("Riyadh", str(self.root / "missing.json")))

    def test_real_estate_listings_filter_and_put_the_best_value_first(self):
        card = {"city": "Riyadh", "kind": "rent", "type": "apartment", "district_id": "1", "lon": 46.7, "lat": 24.7,
                "price_sar": 60000, "area_sqm": 120}
        cards = [dict(card, id="a", vs_district_pct=5), dict(card, id="b", vs_district_pct=-10), dict(card, id="c", vs_district_pct=None),
                 dict(card, id="d", kind="sale", vs_district_pct=-50), dict(card, id="e", lon=46.9, vs_district_pct=-20),
                 dict(card, id="f", price_sar=90000, vs_district_pct=-30)]
        path = self.root / "listings.json"
        path.write_text(json.dumps({"retrieved": "2026-10-28", "listings": cards}), encoding="utf-8")
        found = insights.real_estate_listings("Riyadh", {"kind": "rent", "bbox": [46.6, 24.6, 46.8, 24.8], "max_price": 70000}, str(path))
        self.assertEqual([c["id"] for c in found["listings"]], ["b", "a", "c"])
        self.assertEqual(found["total"], 3)
        self.assertIsNone(insights.real_estate_listings("Riyadh", {}, str(self.root / "missing.json")))


if __name__ == "__main__":
    unittest.main()
