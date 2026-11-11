"""Insight functions against small synthetic files."""
import json
import pathlib
import sys
import tempfile
import unittest

import duckdb

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import canonical_data  # noqa: E402
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

    def test_growth_keeps_partial_polygon_metrics_unavailable_instead_of_adding_null_as_zero(self):
        path = self.parquet("g_partial.parquet", "district_id varchar, district_ar varchar, city_en varchar, under_construction bigint, new_buildings bigint, homes_under_construction bigint, floor_area_m2 double", [
            ("492", "العليا", "Riyadh", 3, 1, 2, 100.0), ("493", "العليا", "Riyadh", None, 0, None, None),
            ("380", "السليمانية", "Riyadh", 1, 2, 0, 10.0),
        ])
        rows = insights.growth(self.db, path, ["492", "493", "380"], {"492": "492", "493": "492", "380": "380"},
                               {"492": ("العليا", None), "380": ("السليمانية", None)})
        self.assertEqual([row["district_ar"] for row in rows], ["السليمانية", "العليا"],
                         "an incomplete district is not ranked as if the missing figures were zero")
        incomplete = rows[1]
        self.assertIsNone(incomplete["under_construction"])
        self.assertEqual(incomplete["new_buildings"], 1, "complete metrics remain usable")
        self.assertIsNone(incomplete["homes_under_construction"])
        self.assertIsNone(incomplete["floor_area_m2"])

    def test_population_and_businesses_within_a_radius(self):
        # three home buildings: two within ~300 m of the point, one ~5 km away
        points = self.parquet("p.parquet", "longitude double, latitude double, district_id varchar, dwellings double", [
            (46.7000, 24.7000, "1", 4.0), (46.7020, 24.7010, "1", 6.0), (46.7500, 24.7000, "2", 100.0)])
        targets = self.parquet("t.parquet", "poi_key varchar, longitude double, latitude double, category_ar varchar, category varchar", [
            ("a", 46.7001, 24.7001, "صيدلية", "Pharmacy"), ("b", 46.7002, 24.7002, "صيدلية", "Pharmacy"), ("c", 46.7003, 24.6999, "مطعم", "Restaurant"), ("d", 46.80, 24.80, "مطعم", "Restaurant")])
        result = insights.population_around(self.db, points, targets, "true", 46.7005, 24.7003, 500)
        self.assertEqual((result["home_buildings"], result["dwellings"], result["population"]), (2, 10.0, None))
        self.assertFalse(result["people_per_district"])
        self.assertEqual(result["businesses"], 3)
        self.assertEqual(result["top_activities"][0], {"activity": "صيدلية", "n": 2})

    def test_population_around_uses_each_buildings_people_when_the_layer_has_them(self):
        points = self.parquet("p3.parquet", "longitude double, latitude double, district_id varchar, dwellings double, population double", [
            (46.7000, 24.7000, "1", 4.0, 30.0), (46.7020, 24.7010, "1", 6.0, 45.0), (46.7500, 24.7000, "2", 100.0, 500.0)])
        result = insights.population_around(self.db, points, None, "true", 46.7005, 24.7003, 500)
        self.assertEqual((result["home_buildings"], result["dwellings"], result["population"], result["people_per_district"]), (2, 10.0, 75, True))

    def test_population_around_does_not_sum_a_partial_building_population_coverage(self):
        points = self.parquet("p3_partial.parquet", "longitude double, latitude double, district_id varchar, dwellings double, population double", [
            (46.7000, 24.7000, "1", 4.0, 30.0), (46.7020, 24.7010, "1", 6.0, None), (46.7500, 24.7000, "2", 100.0, 500.0)])
        result = insights.population_around(self.db, points, None, "true", 46.7005, 24.7003, 500)
        self.assertEqual(result["home_buildings"], 2)
        self.assertIsNone(result["population"], "a partial sum must not look like a complete count")

    def test_population_around_keeps_dwellings_unavailable_when_one_building_count_is_missing(self):
        points = self.parquet("p3_missing_dwellings.parquet", "longitude double, latitude double, district_id varchar, dwellings double, population double", [
            (46.7000, 24.7000, "1", 4.0, 30.0), (46.7020, 24.7010, "1", None, 45.0), (46.7500, 24.7000, "2", 100.0, 500.0)])
        result = insights.population_around(self.db, points, None, "true", 46.7005, 24.7003, 500)
        self.assertIsNone(result["dwellings"], "do not report a partial unit sum as complete")
        self.assertEqual(result["population"], 75, "a complete population measure remains usable")

    def test_population_and_businesses_within_a_drive_time_polygon(self):
        points = self.parquet("pw.parquet", "longitude double, latitude double, district_id varchar, dwellings double, population double", [
            (46.7000, 24.7000, "1", 4.0, 30.0), (46.7020, 24.7010, "1", 6.0, 45.0), (46.7090, 24.7090, "1", 8.0, 60.0), (46.7500, 24.7000, "2", 100.0, 500.0)])
        targets = self.parquet("tw.parquet", "poi_key varchar, longitude double, latitude double, category_ar varchar, category varchar", [
            ("a", 46.7001, 24.7001, "صيدلية", "Pharmacy"), ("b", 46.7091, 24.7091, "مطعم", "Restaurant"), ("c", 46.80, 24.80, "مطعم", "Restaurant")])
        # an L-shaped area: the box's top-right corner (46.705+, 24.705+) is outside even though it is inside the box
        shape = {"type": "Polygon", "coordinates": [[[46.695, 24.695], [46.712, 24.695], [46.712, 24.705], [46.705, 24.705], [46.705, 24.712], [46.695, 24.712], [46.695, 24.695]]]}
        result = insights.population_within(self.db, points, targets, "true", shape)
        self.assertEqual((result["home_buildings"], result["dwellings"], result["population"]), (2, 10.0, 75))
        self.assertEqual(result["businesses"], 1)
        self.assertEqual(result["top_activities"], [{"activity": "صيدلية", "n": 1}])
        hole = {"type": "Polygon", "coordinates": [shape["coordinates"][0], [[46.6995, 24.6995], [46.7005, 24.6995], [46.7005, 24.7005], [46.6995, 24.7005], [46.6995, 24.6995]]]}
        self.assertEqual(insights.population_within(self.db, points, None, "true", hole)["home_buildings"], 1, "a hole is outside")
        self.assertIsNone(insights.population_within(self.db, points, None, "true", {"type": "Point"})["population"])

    def test_population_within_keeps_dwellings_but_does_not_estimate_people_without_the_population_column(self):
        points = self.parquet("pw_legacy.parquet", "longitude double, latitude double, district_id varchar, dwellings double", [
            (46.7000, 24.7000, "1", 4.0), (46.7020, 24.7010, "1", 6.0), (46.7500, 24.7000, "2", 100.0)])
        shape = {"type": "Polygon", "coordinates": [[[46.695, 24.695], [46.712, 24.695], [46.712, 24.712], [46.695, 24.712], [46.695, 24.695]]]}

        result = insights.population_within(self.db, points, None, "true", shape)

        self.assertEqual(result["dwellings"], 10.0)
        self.assertIsNone(result["population"])
        self.assertFalse(result["people_per_district"])

    def test_population_within_does_not_sum_a_partial_building_population_coverage(self):
        points = self.parquet("pw_partial.parquet", "longitude double, latitude double, district_id varchar, dwellings double, population double", [
            (46.7000, 24.7000, "1", 4.0, 30.0), (46.7020, 24.7010, "1", 6.0, None), (46.7500, 24.7000, "2", 100.0, 500.0)])
        shape = {"type": "Polygon", "coordinates": [[[46.695, 24.695], [46.712, 24.695], [46.712, 24.712], [46.695, 24.712], [46.695, 24.695]]]}
        result = insights.population_within(self.db, points, None, "true", shape)
        self.assertEqual(result["home_buildings"], 2)
        self.assertIsNone(result["population"], "a partial sum must not look like a complete count")

    def test_population_within_keeps_dwellings_unavailable_when_one_building_count_is_missing(self):
        points = self.parquet("pw_missing_dwellings.parquet", "longitude double, latitude double, district_id varchar, dwellings double, population double", [
            (46.7000, 24.7000, "1", 4.0, 30.0), (46.7020, 24.7010, "1", None, 45.0), (46.7500, 24.7000, "2", 100.0, 500.0)])
        shape = {"type": "Polygon", "coordinates": [[[46.695, 24.695], [46.712, 24.695], [46.712, 24.712], [46.695, 24.712], [46.695, 24.695]]]}
        result = insights.population_within(self.db, points, None, "true", shape)
        self.assertIsNone(result["dwellings"], "do not report a partial unit sum as complete")
        self.assertEqual(result["population"], 75, "a complete population measure remains usable")

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

    def test_territory_weights_use_ids_when_district_names_repeat(self):
        features = [
            {"properties": {"id": "d1", "ar": "الندى"}, "geometry": square(46.0, 24.0)},
            {"properties": {"id": "d2", "ar": "الندى"}, "geometry": square(46.1, 24.0)},
        ]
        groups = insights.territories(features, {"d1": 90, "d2": 10}, 2, by_id=True)
        assigned = {district["district_id"]: district["weight"] for group in groups for district in group["districts"]}
        self.assertEqual(assigned, {"d1": 90, "d2": 10})

    def test_territory_weights_leave_duplicate_polygon_ids_out(self):
        features = [
            {"properties": {"id": "duplicate", "ar": "الندى"}, "geometry": square(46.0, 24.0)},
            {"properties": {"id": "duplicate", "ar": "الياسمين"}, "geometry": square(46.1, 24.0)},
            {"properties": {"id": "valid", "ar": "الربيع"}, "geometry": square(46.2, 24.0)},
        ]
        groups = insights.territories(features, {"duplicate": 100, "valid": 10}, 1, by_id=True)
        assigned = [district["district_id"] for group in groups for district in group["districts"]]
        self.assertEqual(assigned, ["valid"], "an ambiguous polygon ID cannot contribute weight twice")

    def test_territory_centres_use_the_same_stable_order_and_skip_invalid_geometry(self):
        features = [{"properties": {"id": i, "ar": f"حي{i}"}, "geometry": square(46.0 + (i % 4) * 0.01, 24.0 + (i // 4) * 0.01)} for i in range(16)]
        features.append({"properties": {"id": 99, "ar": "بلا هندسة"}, "geometry": None})

        centres = insights.territory_centres(features)

        self.assertEqual(len(centres), 16)
        self.assertEqual(len({row["district_ar"] for row in centres}), 16)
        self.assertEqual(set(row["district_id"] for row in centres), set(range(16)))
        self.assertTrue(all(34 <= row["lon"] <= 56 and 16 <= row["lat"] <= 33 for row in centres))
        self.assertEqual(centres, insights.territory_centres(features), "the same source geometries must produce the same road-matrix order")

    def test_territory_representative_point_stays_inside_concave_and_multipart_districts(self):
        concave = {"type": "Polygon", "coordinates": [[[0, 0], [4, 0], [4, 4], [3, 4], [3, 1], [1, 1], [1, 4], [0, 4], [0, 0]]]}
        multipart = {"type": "MultiPolygon", "coordinates": [square(0, 0)["coordinates"], square(4, 0)["coordinates"]]}
        invalid = {"type": "Polygon", "coordinates": [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]]}

        naive_vertex_average = (16 / 9, 2)
        self.assertFalse(insights._inside(*naive_vertex_average, canonical_data._polygons(concave)),
                         "this concave outline demonstrates why averaging its vertices is unsafe")
        for geometry in (concave, multipart):
            with self.subTest(kind=geometry["type"]):
                point = insights._centre(geometry)
                self.assertIsNotNone(point)
                self.assertTrue(insights._inside(*point, canonical_data._polygons(geometry)))
        self.assertIsNone(insights._centre(invalid), "invalid boundaries must not create a plausible but untrusted road waypoint")

    def test_territories_include_measured_zero_weight_districts_but_leave_unknown_out(self):
        features = [{"properties": {"id": i, "ar": f"حي{i}"}, "geometry": square(46.0 + (i % 4) * 0.01, 24.0 + (i // 4) * 0.01)} for i in range(16)]
        weights = {f"حي{i}": (100 if i == 0 else 0) for i in range(15)}

        groups = insights.territories(features, weights, 4)

        assigned = [district["district_id"] for group in groups for district in group["districts"]]
        self.assertEqual(set(assigned), set(range(15)), "measured zero districts belong to a territory; unknown حي15 does not")
        self.assertNotIn(15, assigned)
        self.assertEqual(sum(district["weight"] for group in groups for district in group["districts"]), 100)
        self.assertEqual(insights.territories(features, {f"حي{i}": 0 for i in range(16)}, 4), [], "zero total cannot form a balanced split")

    def test_district_income_reads_the_reference_table(self):
        path = self.root / "income.json"
        path.write_text(json.dumps({"source": "s", "retrieved": "2026-10-27", "cities": {"Riyadh": [
            {"district_ar": "الربيع", "polygon_ids": ["101", "102"], "population": 35100, "income_all": 10700},
            {"district_ar": "سكيرينة", "polygon_ids": ["103"], "population": 11500, "income_all": None}]}}, ensure_ascii=False), encoding="utf-8")
        table = insights.district_income("Riyadh", str(path))
        self.assertEqual(table["districts"], [{"district_ar": "الربيع", "income_all": 10700, "income_male": None, "income_female": None, "income_saudi": None, "income_non_saudi": None}],
                         "districts with no published income are left out, not shown as zero")
        with_ids = insights.district_income("Riyadh", str(path), {"101": "10", "102": "10"})
        self.assertEqual(with_ids["districts"][0]["district_id"], "10", "all source polygons must resolve to the same canonical district")
        self.assertIsNone(insights.district_income("Riyadh", str(path), {"101": "10", "102": "11"})["districts"][0]["district_id"],
                          "a conflicting polygon-to-district mapping must not invent an identity")
        self.assertIsNone(insights.district_income("Riyadh", str(path), {"101": "10"})["districts"][0]["district_id"],
                          "a missing polygon mapping must not fall back to an unverified raw identity")
        self.assertEqual(table["unit"], "SAR/month")
        self.assertIsNone(insights.district_income("Jeddah", str(path)))
        self.assertIsNone(insights.district_income("Riyadh", str(self.root / "missing.json")))


    def test_district_audience_keeps_each_independently_measured_share(self):
        path = self.root / "audience.json"
        path.write_text(json.dumps({"cities": {"Riyadh": [
            {"district_ar": "الربيع", "male_pct": 51.2, "saudi_pct": 80.1},
            {"district_ar": "سكيرينة", "male_pct": None, "saudi_pct": 40.0},
            {"district_ar": "النهضة", "male_pct": None, "saudi_pct": None}]}}, ensure_ascii=False), encoding="utf-8")
        table = insights.district_audience("Riyadh", str(path))
        self.assertEqual(table["districts"], [
            {"district_ar": "الربيع", "male_pct": 51.2, "saudi_pct": 80.1},
            {"district_ar": "سكيرينة", "male_pct": None, "saudi_pct": 40.0},
        ])
        self.assertIsNone(insights.district_audience("Jeddah", str(path)))

    def test_district_audience_drops_invalid_percentages_but_keeps_the_other_share(self):
        path = self.root / "audience-invalid.json"
        path.write_text(json.dumps({"cities": {"Riyadh": [
            {"district_ar": "الربيع", "male_pct": 120, "saudi_pct": 42},
            {"district_ar": "النخيل", "male_pct": -1, "saudi_pct": None},
        ]}}, ensure_ascii=False), encoding="utf-8")
        self.assertEqual(insights.district_audience("Riyadh", str(path))["districts"], [
            {"district_ar": "الربيع", "male_pct": None, "saudi_pct": 42},
        ])


    def test_housing_level_merges_polygons_and_skips_tiny_districts(self):
        path = self.parquet("hl.parquet", "district_id varchar, district_ar varchar, villa_units double, classified_home_units double", [
            ("492", "العليا", 100.0, 300.0), ("493", "العليا", 50.0, 200.0), ("380", "السليمانية", 10.0, 1000.0), ("7", "صغير", 5.0, 20.0)])
        rows = insights.housing_level(self.db, path, ["492", "493", "380", "7"], {"492": "492", "493": "492", "380": "380", "7": "7"}, {"492": ("العليا", None)})
        self.assertEqual([(r["district_ar"], r["villa_share_pct"], r["classified_home_units"]) for r in rows], [("العليا", 30.0, 500), ("السليمانية", 1.0, 1000)])
        self.assertIsNone(insights.housing_level(self.db, None, [], {}, {}))

    def test_housing_level_hides_a_district_when_a_polygon_is_missing_or_duplicated(self):
        columns = "district_id varchar, district_ar varchar, villa_units double, classified_home_units double"
        id_map = {"492": "492", "493": "492", "380": "380"}
        names = {"492": ("العليا", None), "380": ("السليمانية", None)}
        cases = [
            ("hl-missing.parquet", [("492", "العليا", 100.0, 300.0), ("380", "السليمانية", 10.0, 1000.0)]),
            ("hl-duplicate.parquet", [("492", "العليا", 100.0, 300.0), ("492", "العليا", 100.0, 300.0),
                                      ("493", "العليا", 50.0, 200.0), ("380", "السليمانية", 10.0, 1000.0)]),
        ]
        for filename, data in cases:
            with self.subTest(filename=filename):
                path = self.parquet(filename, columns, data)
                rows = insights.housing_level(self.db, path, ["492", "493", "380"], id_map, names)
                self.assertEqual([row["district_ar"] for row in rows], ["السليمانية"],
                                 "a malformed source polygon count must not produce a partial district ratio")

    def test_housing_level_hides_a_district_when_one_polygon_has_a_missing_measure(self):
        path = self.parquet("hl-null-units.parquet",
                            "district_id varchar, district_ar varchar, villa_units double, classified_home_units double",
                            [("492", "العليا", None, 300.0), ("493", "العليا", 50.0, 200.0),
                             ("380", "السليمانية", 10.0, 1000.0)])

        rows = insights.housing_level(self.db, path, ["492", "493", "380"],
                                      {"492": "492", "493": "492", "380": "380"},
                                      {"492": ("العليا", None), "380": ("السليمانية", None)})

        self.assertEqual([row["district_ar"] for row in rows], ["السليمانية"])

    def test_housing_level_rejects_legacy_mixed_unit_ratio(self):
        path = self.parquet("hl-legacy.parquet", "district_id varchar, district_ar varchar, villas bigint, dwelling_units double", [("492", "العليا", 50, 500.0)])
        self.assertIsNone(insights.housing_level(self.db, path, ["492"], {}, {}))


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
                "price_sar": 60000, "area_sqm": 120, "photo": "p.jpg"}
        cards = [dict(card, id="a", vs_district_pct=5), dict(card, id="b", vs_district_pct=-10), dict(card, id="c", vs_district_pct=None),
                 dict(card, id="d", kind="sale", vs_district_pct=-50), dict(card, id="e", lon=46.9, vs_district_pct=-20),
                 dict(card, id="f", price_sar=90000, vs_district_pct=-30)]
        path = self.root / "listings.json"
        path.write_text(json.dumps({"retrieved": "2026-10-28", "listings": cards}), encoding="utf-8")
        found = insights.real_estate_listings("Riyadh", {"kind": "rent", "bbox": [46.6, 24.6, 46.8, 24.8], "max_price": 70000}, str(path))
        self.assertEqual([c["id"] for c in found["listings"]], ["b", "a", "c"])
        self.assertEqual(found["total"], 3)
        self.assertIsNone(insights.real_estate_listings("Riyadh", {}, str(self.root / "missing.json")))

    def test_advertiser_number_stays_out_of_lists_and_is_returned_for_one_publishable_listing(self):
        card = {"city": "Riyadh", "kind": "rent", "type": "apartment", "district_id": "1", "lon": 46.7, "lat": 24.7,
                "price_sar": 60000, "area_sqm": 120, "photo": "p.jpg"}
        path = self.root / "phones.json"
        path.write_text(json.dumps({"listings": [dict(card, id="7", phone="0501234567"), dict(card, id="8"),
                                                 dict(card, id="9", phone="0507654321", check=True)]}), encoding="utf-8")
        found = insights.real_estate_listings("Riyadh", {}, str(path))
        self.assertFalse(any("phone" in c for c in found["listings"]))
        self.assertEqual({c["id"]: c["has_phone"] for c in found["listings"]}, {"7": True, "8": False})
        self.assertEqual(insights.listing_phone("7", str(path)), "0501234567")
        self.assertIsNone(insights.listing_phone("8", str(path)))
        self.assertIsNone(insights.listing_phone("9", str(path)), "a listing Atlas does not show gives no number")
        self.assertIsNone(insights.listing_phone("7", str(self.root / "missing.json")))

    def test_real_estate_listings_ranges_leave_out_ads_without_the_figure(self):
        card = {"city": "Riyadh", "kind": "rent", "type": "apartment", "district_id": "1", "lon": 46.7, "lat": 24.7, "vs_district_pct": None, "photos": ["p.jpg"]}
        cards = [dict(card, id="a", price_sar=40000, area_sqm=90), dict(card, id="b", price_sar=45000, area_sqm=200),
                 dict(card, id="c", price_sar=70000, area_sqm=None), dict(card, id="d", price_sar=55000, area_sqm=150)]
        path = self.root / "listings.json"
        path.write_text(json.dumps({"listings": cards}), encoding="utf-8")
        ids = lambda filters: [c["id"] for c in insights.real_estate_listings("Riyadh", filters, str(path))["listings"]]
        self.assertEqual(sorted(ids({})), ["a", "b", "c", "d"])
        self.assertEqual(sorted(ids({"min_area": 100})), ["b", "d"], 'an ad without an area is not taken as 0 m²')
        self.assertEqual(sorted(ids({"min_price": 50000, "max_price": 60000})), ["d"])
        self.assertEqual(sorted(ids({"max_area": 160})), ["a", "d"])

    def test_real_estate_listing_zero_price_and_area_bounds_are_real_filters(self):
        card = {"city": "Riyadh", "kind": "rent", "deal": "rent_year", "type": "apartment", "district_id": "1",
                "lon": 46.7, "lat": 24.7, "vs_district_pct": None, "photos": ["p.jpg"]}
        cards = [dict(card, id="zero", price_sar=0, area_sqm=0), dict(card, id="positive", price_sar=10000, area_sqm=50)]
        path = self.root / "zero_ranges.json"
        path.write_text(json.dumps({"listings": cards}), encoding="utf-8")
        ids = lambda filters: [row["id"] for row in insights.real_estate_listings("Riyadh", filters, str(path))["listings"]]
        self.assertEqual(ids({"max_price": 0}), ["zero"])
        self.assertEqual(ids({"min_price": 0}), ["positive", "zero"])
        self.assertEqual(ids({"max_area": 0}), ["zero"])
        self.assertEqual(ids({"min_area": 0}), ["positive", "zero"])

    def test_real_estate_listings_by_building_age_leave_out_ads_that_state_none(self):
        card = {"city": "Riyadh", "kind": "rent", "type": "floor", "district_id": "1", "lon": 46.7, "lat": 24.7, "vs_district_pct": None,
                "photos": ["p.jpg"], "price_sar": 100000, "area_sqm": 180}
        cards = [dict(card, id="new", age=0), dict(card, id="two", age=2), dict(card, id="old", age=11), dict(card, id="unknown")]
        path = self.root / "listings.json"
        path.write_text(json.dumps({"listings": cards}), encoding="utf-8")
        ids = lambda filters: sorted(c["id"] for c in insights.real_estate_listings("Riyadh", filters, str(path))["listings"])
        self.assertEqual(ids({"max_age": 0}), ["new"], '0 means new only, not «no filter»')
        self.assertEqual(ids({"max_age": 2}), ["new", "two"], 'an ad that states no age is not taken as new')
        self.assertEqual(ids({}), ["new", "old", "two", "unknown"])

    def test_real_estate_listings_minimum_beds_leave_out_unknown_room_counts(self):
        card = {"city": "Riyadh", "kind": "rent", "type": "apartment", "district_id": "1", "lon": 46.7, "lat": 24.7,
                "vs_district_pct": None, "photos": ["p.jpg"], "price_sar": 50000, "area_sqm": 100}
        cards = [dict(card, id="two", beds=2), dict(card, id="three", beds=3), dict(card, id="unknown")]
        path = self.root / "listings.json"
        path.write_text(json.dumps({"listings": cards}), encoding="utf-8")
        result = insights.real_estate_listings("Riyadh", {"min_beds": 3}, str(path))
        self.assertEqual([row["id"] for row in result["listings"]], ["three"])
        self.assertEqual(result["total"], 1)

    def test_real_estate_listing_filters_apply_before_the_result_cap(self):
        card = {"city": "Riyadh", "kind": "rent", "deal": "rent_year", "type": "apartment", "district_id": "1",
                "lon": 46.7, "lat": 24.7, "vs_district_pct": -10, "photos": ["p.jpg"], "price_sar": 50000,
                "area_sqm": 120, "beds": 3, "livings": 1, "wc": 2, "street_width": 20, "age": 2,
                "tenants": "both", "features": {"lift": 1, "furnished": 0}, "sar_per_sqm": 416.7}
        cards = [dict(card, id="match"), dict(card, id="wrong_living", livings=0), dict(card, id="wrong_wc", wc=1),
                 dict(card, id="wrong_street", street_width=10), dict(card, id="wrong_tenant", tenants="singles"),
                 dict(card, id="wrong_feature", features={"lift": 0}), dict(card, id="old", age=11)]
        path = self.root / "filter_before_cap.json"
        path.write_text(json.dumps({"listings": cards}), encoding="utf-8")
        filters = {"min_livings": 1, "min_wc": 2, "min_street_width": 15, "tenants": "families",
                   "features": ["lift"], "max_age": 5, "limit": 1}
        found = insights.real_estate_listings("Riyadh", filters, str(path))
        self.assertEqual([row["id"] for row in found["listings"]], ["match"])
        self.assertEqual(found["total"], 1)

    def test_real_estate_listing_sort_is_applied_before_the_result_cap(self):
        card = {"city": "Riyadh", "kind": "sale", "deal": "sale", "type": "apartment", "district_id": "1",
                "lon": 46.7, "lat": 24.7, "vs_district_pct": None, "photos": ["p.jpg"], "area_sqm": 100}
        cards = [dict(card, id="expensive", price_sar=900000, sar_per_sqm=9000),
                 dict(card, id="cheap", price_sar=300000, sar_per_sqm=3000),
                 dict(card, id="middle", price_sar=600000, sar_per_sqm=6000)]
        path = self.root / "sort_before_cap.json"
        path.write_text(json.dumps({"listings": cards}), encoding="utf-8")
        found = insights.real_estate_listings("Riyadh", {"sort": "price_asc", "limit": 1}, str(path))
        self.assertEqual([row["id"] for row in found["listings"]], ["cheap"])
        self.assertEqual(found["total"], 3)

    def test_real_estate_listing_pages_keep_the_global_order_and_total(self):
        card = {"city": "Riyadh", "kind": "rent", "deal": "rent_year", "type": "apartment", "district_id": "1",
                "lon": 46.7, "lat": 24.7, "vs_district_pct": -10, "photos": ["p.jpg"], "price_sar": 50000, "area_sqm": 100}
        cards = [dict(card, id=f"ad-{index:02}", price_sar=10000 + index) for index in range(5)]
        path = self.root / "listing_pages.json"
        path.write_text(json.dumps({"listings": cards}), encoding="utf-8")
        first = insights.real_estate_listings("Riyadh", {"sort": "price_asc", "limit": 2, "offset": 0}, str(path))
        second = insights.real_estate_listings("Riyadh", {"sort": "price_asc", "limit": 2, "offset": 2}, str(path))
        last = insights.real_estate_listings("Riyadh", {"sort": "price_asc", "limit": 2, "offset": 4}, str(path))
        self.assertEqual([row["id"] for row in first["listings"]], ["ad-00", "ad-01"])
        self.assertEqual([row["id"] for row in second["listings"]], ["ad-02", "ad-03"])
        self.assertEqual([row["id"] for row in last["listings"]], ["ad-04"])
        self.assertEqual([first["total"], second["total"], last["total"]], [5, 5, 5])
        self.assertEqual([first["offset"], second["offset"], last["offset"]], [0, 2, 4])

    def test_real_estate_listings_filter_districts_and_price_discount_before_limit(self):
        card = {"city": "Riyadh", "kind": "rent", "type": "apartment", "lon": 46.7, "lat": 24.7,
                "vs_district_pct": -20, "photos": ["p.jpg"], "price_sar": 50000, "area_sqm": 100}
        cards = [dict(card, id="in", district_id="1"), dict(card, id="other_district", district_id="2"),
                 dict(card, id="too_cheap", district_id="1", vs_district_pct=-35),
                 dict(card, id="unmeasured", district_id="1", vs_district_pct=None)]
        path = self.root / "listings.json"
        path.write_text(json.dumps({"listings": cards}), encoding="utf-8")
        filters = {"district_ids": ["1"], "min_vs_district_pct": -30, "max_vs_district_pct": -10, "limit": 1}
        result = insights.real_estate_listings("Riyadh", filters, str(path))
        self.assertEqual([row["id"] for row in result["listings"]], ["in"])
        self.assertEqual(result["total"], 1, "total counts after district and comparison filters, before limit")
        none = insights.real_estate_listings("Riyadh", {**filters, "district_ids": []}, str(path))
        self.assertEqual(none["listings"], [], "an explicit empty district set matches no rows")

    def test_real_estate_listings_serve_only_publishable_ads(self):
        card = {"city": "Riyadh", "kind": "rent", "deal": "rent_year", "type": "apartment", "district_id": "1", "lon": 46.7, "lat": 24.7,
                "price_sar": 40000, "area_sqm": 90, "photos": ["p.jpg"]}
        cards = [dict(card, id="ok"), dict(card, id="check", check=True), dict(card, id="no_price", price_sar=None),
                 dict(card, id="no_photo", photos=[]), dict(card, id="no_period", deal="rent_unstated"), dict(card, id="one_photo", photos=[], photo="p.jpg")]
        path = self.root / "listings.json"
        path.write_text(json.dumps({"listings": cards}), encoding="utf-8")
        found = insights.real_estate_listings("Riyadh", {}, str(path))
        self.assertEqual(sorted(c["id"] for c in found["listings"]), ["ok", "one_photo"])
        self.assertEqual(found["total"], 2)


class RegisteredDealsTest(unittest.TestCase):
    def test_the_city_table_or_none(self):
        import json, tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as handle:
            json.dump({'quarters': ['2026-Q1'], 'min_deals': 10, 'cities': {'Riyadh': [{'district_ar': 'العزيزية', 'residential': {'deals': 298, 'median_sar_per_sqm': 2731}}]}}, handle)
        table = insights.registered_deals('Riyadh', handle.name)
        self.assertEqual(table['districts'][0]['residential']['median_sar_per_sqm'], 2731)
        self.assertIsNone(insights.registered_deals('Tabuk', handle.name))


if __name__ == '__main__':
    unittest.main()
