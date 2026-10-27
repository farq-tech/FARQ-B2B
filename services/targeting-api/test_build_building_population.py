import csv
import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path

import duckdb
import shapely

import build_building_population as bbp


def square(lon, lat, size):
    return shapely.geometry.box(lon, lat, lon + size, lat + size)


# Two official districts in Riyadh (each ~1.1 km square) and one in Jeddah.
DISTRICTS = {
    "type": "FeatureCollection",
    "features": [
        {"type": "Feature", "properties": {"id": 1, "ar": "الملقا", "en": "Al Malqa", "city_ar": "الرياض", "city_en": "Riyadh"}, "geometry": shapely.geometry.mapping(square(46.60, 24.80, 0.01))},
        {"type": "Feature", "properties": {"id": 2, "ar": "الياسمين", "en": "Al Yasmin", "city_ar": "الرياض", "city_en": "Riyadh"}, "geometry": shapely.geometry.mapping(square(46.62, 24.80, 0.01))},
        {"type": "Feature", "properties": {"id": 3, "ar": "الروضة", "en": "Al Rawdah", "city_ar": "جدة", "city_en": "Jeddah"}, "geometry": shapely.geometry.mapping(square(39.17, 21.55, 0.01))},
    ],
}
SIDE = 0.0002   # ~22 m × 22 m footprint


def building(lon, lat, use, elevation, purpose="", city="Riyadh"):
    return (use, city, square(lon, lat, SIDE).wkb.hex(), None if elevation is None else str(elevation), purpose)


class BuildingPopulationTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.districts = self.root / "districts.geojson"
        self.districts.write_text(json.dumps(DISTRICTS, ensure_ascii=False), encoding="utf-8")
        self.rows = [
            # district 1: two 2-storey apartment buildings and one of unknown height (counts as one storey)
            building(46.601, 24.801, "residential", 6.4, "Residential building"), building(46.602, 24.802, "residential", 6.4, "Residential building"),
            building(46.603, 24.803, "residential", None, "Residential building"),
            # district 2: a 1-storey apartment building, a 4-storey mixed-use one (ground floor is shops), a commercial one (ignored)
            building(46.621, 24.801, "residential", 3.2, "Residential building"), building(46.622, 24.802, "mixed_use", 12.8), building(46.623, 24.803, "commercial", 30.0),
            # outside every polygon
            building(46.70, 24.90, "residential", 6.4),
            # Jeddah: one residential, no WorldPop and no official total
            building(39.171, 21.551, "residential", 3.2, city="Jeddah"),
        ]
        self.write_buildings()
        db = duckdb.connect()
        db.execute("create table wp (district_id integer, city_en varchar, population_estimate double)")
        db.executemany("insert into wp values (?, ?, ?)", [(1, "Riyadh", 1000.0), (2, "Riyadh", 1100.0), (3, "Jeddah", None)])
        self.worldpop = self.root / "worldpop.parquet"
        db.execute("copy wp to ? (format parquet)", [str(self.worldpop)])
        db.close()
        self.official = self.root / "official.csv"
        with self.official.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["city_en", "population", "year", "source"])
            writer.writerow(["Riyadh", "3000", "2022", "GASTAT census 2022"])

    def write_buildings(self):
        db = duckdb.connect()
        db.execute("create table b (building_use varchar, city_en varchar, geometry_wkb_hex varchar, Elevation varchar, Purpose varchar)")
        db.executemany("insert into b values (?, ?, ?, ?, ?)", self.rows)
        self.buildings = self.root / "buildings.parquet"
        db.execute("copy b to ? (format parquet)", [str(self.buildings)])
        db.close()

    def run_build(self, pois=None, **kwargs):
        report = bbp.build(self.buildings, self.districts, self.root / "out", self.worldpop, self.official,
                           elevation_mode=kwargs.pop("elevation_mode", "height"), pois=pois, **kwargs)
        out = self.root / "out" / "district_population_buildings_2026.parquet"
        db = duckdb.connect()
        try:
            cols = [c[0] for c in db.execute("describe select * from read_parquet(?)", [str(out)]).fetchall()]
            rows = db.execute("select * from read_parquet(?) order by district_id", [str(out)]).fetchall()
        finally:
            db.close()
        return report, {row[0]: dict(zip(cols, row)) for row in rows}

    def area(self):
        return bbp.footprint_m2(square(46.601, 24.801, SIDE), 24.801 + SIDE / 2)

    def flats_per_storey(self):
        return self.area() * bbp.NET_FACTOR / bbp.UNIT_M2

    def households(self, storeys):
        return max(1.0, self.area() * storeys / bbp.VILLA_M2)

    def test_official_total_is_distributed_by_dwellings(self):
        report, rows = self.run_build()
        # district 1: 2 + 2 + 1 home storeys; district 2: 1 + (4 - 1 ground-floor shops) → 5 vs 4
        self.assertAlmostEqual(rows["1"]["city_weight_share"], 5 / 9, places=3)
        self.assertAlmostEqual(rows["2"]["city_weight_share"], 4 / 9, places=3)
        self.assertAlmostEqual(rows["1"]["population_estimate"] + rows["2"]["population_estimate"], 3000, delta=0.5, msg="estimates sum to the official city total")
        self.assertEqual(rows["1"]["calibration_source"], "official:GASTAT census 2022")
        self.assertAlmostEqual(rows["1"]["dwelling_units"], 5 * self.flats_per_storey(), delta=0.1)
        self.assertAlmostEqual(rows["1"]["population_buildings_only"], 5 * self.flats_per_storey() * bbp.HOUSEHOLD_SIZE, delta=0.5, msg="buildings-only total uses no outside source")
        self.assertEqual(rows["1"]["residential_buildings"], 3)
        self.assertEqual(rows["2"]["mixed_use_buildings"], 1)
        self.assertAlmostEqual(rows["1"]["floors_known_pct"], 66.7, places=1)
        self.assertEqual(report["cities"]["Riyadh"]["outside_boundaries"], 1)
        self.assertEqual(report["cities"]["Riyadh"]["by_use"], {"residential": 5, "mixed_use": 1}, "commercial buildings never enter the estimate")

    def test_villa_households_follow_floor_area_and_unfinished_buildings_hold_nobody(self):
        self.rows = [
            building(46.601, 24.801, "residential", 6.4, "Villa"),                              # 2 storeys
            building(46.602, 24.802, "residential", 9.6, "Villa"),                              # 3 storeys
            building(46.603, 24.803, "residential", 6.4, "Villa under construction"),           # nobody yet
            building(46.621, 24.801, "residential", 6.4, "Residential building under construction"),
            building(46.622, 24.802, "residential", 3.2, "Residential building"),
        ]
        self.write_buildings()
        _, rows = self.run_build()
        self.assertAlmostEqual(rows["1"]["dwelling_units"], self.households(2) + self.households(3), places=1)
        self.assertEqual(rows["1"]["villas"], 2)
        self.assertEqual(rows["1"]["shops_or_unoccupied_excluded"], 1)
        self.assertAlmostEqual(rows["2"]["dwelling_units"], self.flats_per_storey(), delta=0.1)
        self.assertEqual(rows["2"]["shops_or_unoccupied_excluded"], 1)

    def test_growth_and_building_points_are_written(self):
        self.rows = [
            building(46.601, 24.801, "residential", 6.4, "Villa"),
            building(46.602, 24.802, "residential", 6.4, "Villa under construction"),
            building(46.603, 24.803, "administrative", 9.6, "Administrative building under construction"),
            building(46.621, 24.801, "residential", 3.2, "Residential building"),
        ]
        self.write_buildings()
        report, _ = self.run_build()
        db = duckdb.connect()
        try:
            growth = {r[0]: r[1:] for r in db.execute("select district_id, under_construction, new_buildings, homes_under_construction from read_parquet(?)", [str(self.root / "out" / "district_growth_2026.parquet")]).fetchall()}
            points = db.execute("select district_id, dwellings from read_parquet(?) order by district_id", [str(self.root / "out" / "building_points_2026.parquet")]).fetchall()
        finally:
            db.close()
        self.assertEqual(growth["1"], (2, 0, 1), "both unfinished buildings count; only the villa is a home")
        self.assertNotIn("2", growth)
        self.assertEqual([p[0] for p in points], ["1", "2"], "one point per occupied home building")
        self.assertAlmostEqual(points[0][1], self.households(2), places=1)
        self.assertEqual(report["output"]["growth"]["under_construction"], 2)

    def test_directory_business_inside_a_building_takes_its_ground_floor(self):
        pois = self.root / "targets.parquet"
        db = duckdb.connect()
        db.execute("create table t (longitude double, latitude double, location_precision varchar)")
        centre = SIDE / 2
        db.executemany("insert into t values (?, ?, ?)", [
            (46.601 + centre, 24.801 + centre, "point"),   # inside a 2-storey building → 1 home storey left
            (46.603 + centre, 24.803 + centre, "point"),   # inside the 1-storey building → it is a shop
            (46.602 + centre, 24.802 + centre, "approximate"),  # imprecise location is ignored
        ])
        db.execute("copy t to ? (format parquet)", [str(pois)])
        db.close()
        report, rows = self.run_build(pois=pois)
        self.assertAlmostEqual(rows["1"]["dwelling_units"], 3 * self.flats_per_storey(), delta=0.1)   # 1 + 2 + 0
        self.assertEqual(rows["1"]["shops_or_unoccupied_excluded"], 1)
        self.assertEqual(report["method"]["pois"]["points"], 2)

    def test_unsurveyed_homes_count_as_low_density_and_administrative_upper_floors_hold_some_flats(self):
        self.rows = [
            building(46.601, 24.801, "residential", 6.4),                                        # purpose never surveyed
            building(46.602, 24.802, "administrative", 12.8, "Administrative building"),         # 4 storeys: 3 upper floors
            building(46.603, 24.803, "administrative", 12.8, "Hotel"),                           # a named non-home use
            building(46.604, 24.804, "administrative", 3.2),                                     # one storey: offices or shops
            building(46.621, 24.801, "residential", 6.4, "Labour camp"),                         # dense housing counts as flats
        ]
        self.write_buildings()
        report, rows = self.run_build()
        self.assertAlmostEqual(rows["1"]["dwelling_units"], self.households(2) + bbp.ADMIN_HOME_SHARE * 3 * self.flats_per_storey(), places=1)
        self.assertEqual(rows["1"]["shops_or_unoccupied_excluded"], 1)
        self.assertAlmostEqual(rows["2"]["dwelling_units"], 2 * self.flats_per_storey(), places=1)
        self.assertEqual(report["method"]["villa_m2"], bbp.VILLA_M2)

    def test_910ths_district_totals_are_used_and_spread_over_buildings(self):
        reference = self.root / "districts_910ths.json"
        reference.write_text(json.dumps({"source": "910ths.sa", "cities": {"Riyadh": [{"district_ar": "الملقا", "population": 9000, "male_pct": 55}]}}, ensure_ascii=False), encoding="utf-8")
        with mock.patch.object(bbp, "MIN_REFERENCE_DISTRICTS", 1):   # this two-district city is its whole sample
            report, rows = self.run_build(reference=reference)
        self.assertAlmostEqual(rows["1"]["population_estimate"], 9000, delta=0.5, msg="a listed district takes its 910ths total")
        self.assertEqual(rows["1"]["calibration_source"], "910ths.sa")
        # an unlisted district in the same city gets the people per dwelling the listed ones show
        per_dwelling = 9000 / rows["1"]["dwelling_units"]
        self.assertAlmostEqual(rows["2"]["population_estimate"], rows["2"]["dwelling_units"] * per_dwelling, delta=0.01 * rows["2"]["population_estimate"])   # dwelling_units is rounded in the output
        self.assertEqual(rows["2"]["calibration_source"], "910ths.sa:people_per_dwelling")
        self.assertIsNone(rows["3"]["population_estimate"], "a city with no reference and no total stays unavailable")
        self.assertEqual(report["method"]["reference"]["districts"], 1)
        db = duckdb.connect()
        try:
            people = db.execute("select sum(population) from read_parquet(?) where district_id = '1'", [str(self.root / "out" / "building_points_2026.parquet")]).fetchone()[0]
        finally:
            db.close()
        self.assertAlmostEqual(people, 9000, delta=1, msg="the district's buildings carry exactly its people")

    def test_a_city_with_too_few_910ths_districts_is_not_calibrated_on_them(self):
        reference = self.root / "districts_910ths.json"
        reference.write_text(json.dumps({"cities": {"Riyadh": [{"district_ar": "الملقا", "population": 9000}]}}, ensure_ascii=False), encoding="utf-8")
        report, rows = self.run_build(reference=reference)   # one district is below MIN_REFERENCE_DISTRICTS
        self.assertAlmostEqual(rows["1"]["population_estimate"], 9000, delta=0.5, msg="the listed district still takes its own figure")
        self.assertFalse(str(rows["2"]["calibration_source"]).startswith("910ths"), "the other districts are not scaled on a one-district sample")
        self.assertEqual(report["method"]["reference"]["people_per_dwelling"], {})

    def test_a_district_split_into_several_polygons_shares_one_reference_total(self):
        collection = json.loads(self.districts.read_text(encoding="utf-8"))
        collection["features"][1]["properties"]["ar"] = "الملقا"   # polygon 2 is the same district under the same name,
        collection["features"][1]["geometry"] = shapely.geometry.mapping(square(46.61, 24.80, 0.02))   # drawn touching polygon 1
        self.districts.write_text(json.dumps(collection, ensure_ascii=False), encoding="utf-8")
        reference = self.root / "districts_910ths.json"
        reference.write_text(json.dumps({"cities": {"Riyadh": [{"district_ar": "الملقا", "population": 9000}]}}, ensure_ascii=False), encoding="utf-8")
        _, rows = self.run_build(reference=reference)
        self.assertAlmostEqual(rows["1"]["population_estimate"] + rows["2"]["population_estimate"], 9000, delta=1)
        self.assertAlmostEqual(rows["1"]["population_estimate"] / rows["2"]["population_estimate"], rows["1"]["dwelling_units"] / rows["2"]["dwelling_units"], delta=0.02)

    def test_a_polygon_moved_to_another_city_never_takes_the_old_citys_figure(self):
        collection = json.loads(self.districts.read_text(encoding="utf-8"))
        collection["features"][1]["properties"]["ar"] = "الملقا"   # same name as polygon 1, but filed in another city
        self.districts.write_text(json.dumps(collection, ensure_ascii=False), encoding="utf-8")
        reference = self.root / "districts_910ths.json"
        reference.write_text(json.dumps({"cities": {"Riyadh": [{"district_ar": "الملقا", "population": 9000}]}}, ensure_ascii=False), encoding="utf-8")
        moved = {("Riyadh", "2"): {"city_en": "Riyadh", "id": "2", "ar": "الملقا", "to_city_en": "Diriyah", "to_city_ar": "الدرعية"}}
        with mock.patch.object(bbp.canonical_data, "load_corrections", lambda path=None: moved):
            _, rows = self.run_build(reference=reference)
        self.assertAlmostEqual(rows["1"]["population_estimate"], 9000, delta=0.5)
        self.assertNotEqual(rows["2"]["calibration_source"], "910ths.sa", "the Riyadh figure stays with the Riyadh district")

    def test_worldpop_comparison_flags_divergence_only_when_large(self):
        _, rows = self.run_build()
        self.assertAlmostEqual(rows["1"]["worldpop_diff_pct"], 66.7, places=1)   # 1666.7 vs 1000
        self.assertTrue(rows["1"]["estimates_diverge"])
        self.assertAlmostEqual(rows["2"]["worldpop_diff_pct"], 21.2, places=1)   # 1333.3 vs 1100
        self.assertFalse(rows["2"]["estimates_diverge"])

    def test_city_without_official_or_worldpop_total_stays_null(self):
        _, rows = self.run_build()
        self.assertIsNone(rows["3"]["population_estimate"])
        self.assertIsNone(rows["3"]["calibration_source"])
        self.assertEqual(rows["3"]["residential_buildings"], 1, "the building count is still reported")
        self.assertIsNotNone(rows["3"]["population_buildings_only"], "the buildings-only estimate needs no outside total")

    def test_worldpop_city_total_is_the_fallback_calibration(self):
        self.official.write_text("city_en,population,year,source\n", encoding="utf-8")
        _, rows = self.run_build()
        self.assertEqual(rows["1"]["calibration_source"], "worldpop_city_total")
        self.assertAlmostEqual(rows["1"]["population_estimate"] + rows["2"]["population_estimate"], 2100, delta=0.5)

    def test_elevation_mode_is_decided_from_the_data(self):
        self.assertEqual(bbp.decide_elevation_mode([6.4, 9.6, 12.8, 25.0], "auto")[0], "height")
        self.assertEqual(bbp.decide_elevation_mode([1, 2, 2, 3, 1], "auto")[0], "floors")
        self.assertEqual(bbp.decide_elevation_mode([], "auto")[0], "ignore")
        self.assertEqual(bbp.floors_from(6.4, "height", 3.2), (2, True))
        self.assertEqual(bbp.floors_from(None, "height", 3.2), (1, False))
        self.assertEqual(bbp.floors_from(3, "floors", 3.2), (3, True))
        self.assertEqual(bbp.floors_from(99, "ignore", 3.2), (1, False))


if __name__ == "__main__":
    unittest.main()
