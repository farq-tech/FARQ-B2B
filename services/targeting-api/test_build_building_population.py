import csv
import json
import tempfile
import unittest
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


def building(lon, lat, use, elevation, city="Riyadh", side=0.0002):
    # ~22 m × 22 m footprint ≈ 490 m²
    return (use, city, square(lon, lat, side).wkb.hex(), elevation)


class BuildingPopulationTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.districts = self.root / "districts.geojson"
        self.districts.write_text(json.dumps(DISTRICTS, ensure_ascii=False), encoding="utf-8")
        rows = [
            # district 1: two residential buildings of 2 storeys (height 6.4 m) and one unknown height
            building(46.601, 24.801, "residential", 6.4), building(46.602, 24.802, "residential", 6.4), building(46.603, 24.803, "residential", None),
            # district 2: one residential 1 storey, one mixed-use 4 storeys (half weight), one commercial (ignored)
            building(46.621, 24.801, "residential", 3.2), building(46.622, 24.802, "mixed_use", 12.8), building(46.623, 24.803, "commercial", 30.0),
            # outside every polygon
            building(46.70, 24.90, "residential", 6.4),
            # Jeddah: one residential, no WorldPop and no official total
            building(39.171, 21.551, "residential", 3.2, city="Jeddah"),
        ]
        db = duckdb.connect()
        db.execute("create table b (building_use varchar, city_en varchar, geometry_wkb_hex varchar, Elevation varchar)")
        db.executemany("insert into b values (?, ?, ?, ?)", [(u, c, g, None if e is None else str(e)) for u, c, g, e in rows])
        self.buildings = self.root / "buildings.parquet"
        db.execute("copy b to ? (format parquet)", [str(self.buildings)])
        db.execute("create table wp (district_id integer, city_en varchar, population_estimate double)")
        db.executemany("insert into wp values (?, ?, ?)", [(1, "Riyadh", 1000.0), (2, "Riyadh", 1000.0), (3, "Jeddah", None)])
        self.worldpop = self.root / "worldpop.parquet"
        db.execute("copy wp to ? (format parquet)", [str(self.worldpop)])
        db.close()
        self.official = self.root / "official.csv"
        with self.official.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["city_en", "population", "year", "source"])
            writer.writerow(["Riyadh", "3000", "2022", "GASTAT census 2022"])

    def run_build(self, **kwargs):
        report = bbp.build(self.buildings, self.districts, self.root / "out", self.worldpop, self.official, elevation_mode=kwargs.pop("elevation_mode", "height"), **kwargs)
        db = duckdb.connect()
        try:
            cols = [c[0] for c in db.execute("describe select * from read_parquet(?)", [str(self.root / "out" / "district_population_buildings_2026.parquet")]).fetchall()]
            rows = db.execute("select * from read_parquet(?) order by district_id", [str(self.root / "out" / "district_population_buildings_2026.parquet")]).fetchall()
        finally:
            db.close()
        return report, {row[0]: dict(zip(cols, row)) for row in rows}

    def test_official_total_is_distributed_by_residential_floor_area(self):
        report, rows = self.run_build()
        # district 1 weight: 490×2 + 490×2 + 490×1 = 5 units; district 2: 490×1 + 490×4×0.5 = 3 units → shares 5/8 and 3/8
        self.assertAlmostEqual(rows["1"]["city_weight_share"], 5 / 8, places=3)
        self.assertAlmostEqual(rows["2"]["city_weight_share"], 3 / 8, places=3)
        self.assertAlmostEqual(rows["1"]["population_estimate"] + rows["2"]["population_estimate"], 3000, delta=0.5, msg="estimates sum to the official city total")
        self.assertEqual(rows["1"]["calibration_source"], "official:GASTAT census 2022")
        self.assertEqual(rows["1"]["residential_buildings"], 3)
        self.assertEqual(rows["2"]["mixed_use_buildings"], 1)
        self.assertAlmostEqual(rows["1"]["floors_known_pct"], 66.7, places=1)
        self.assertEqual(report["cities"]["Riyadh"]["outside_boundaries"], 1)
        self.assertEqual(report["cities"]["Riyadh"]["by_use"], {"residential": 5, "mixed_use": 1}, "commercial buildings never enter the estimate")

    def test_worldpop_comparison_flags_divergence_only_when_both_are_large(self):
        _, rows = self.run_build()
        self.assertAlmostEqual(rows["1"]["worldpop_diff_pct"], 87.5, places=1)   # 1875 vs 1000
        self.assertTrue(rows["1"]["estimates_diverge"])
        self.assertAlmostEqual(rows["2"]["worldpop_diff_pct"], 12.5, places=1)   # 1125 vs 1000
        self.assertFalse(rows["2"]["estimates_diverge"])

    def test_city_without_official_or_worldpop_total_stays_null(self):
        _, rows = self.run_build()
        self.assertIsNone(rows["3"]["population_estimate"])
        self.assertIsNone(rows["3"]["calibration_source"])
        self.assertEqual(rows["3"]["residential_buildings"], 1, "the building count is still reported")

    def test_worldpop_city_total_is_the_fallback_calibration(self):
        self.official.write_text("city_en,population,year,source\n", encoding="utf-8")
        _, rows = self.run_build()
        self.assertEqual(rows["1"]["calibration_source"], "worldpop_city_total")
        self.assertAlmostEqual(rows["1"]["population_estimate"] + rows["2"]["population_estimate"], 2000, delta=0.5)

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
