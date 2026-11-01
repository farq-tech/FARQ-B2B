# -*- coding: utf-8 -*-
import unittest

import district_metrics as dm


class DistrictMetricsTest(unittest.TestCase):
    def test_residents_per_is_none_without_both_figures(self):
        self.assertEqual(dm.residents_per(12000, 40), 300)
        self.assertIsNone(dm.residents_per(None, 40))
        self.assertIsNone(dm.residents_per(12000, 0))
        self.assertIsNone(dm.residents_per(12000, None))

    def test_per_km2_and_density_need_an_area(self):
        self.assertEqual(dm.per_km2(100, 4), 25)
        self.assertIsNone(dm.per_km2(100, 0))
        self.assertIsNone(dm.per_km2(100, None))
        self.assertEqual(dm.density(12000, 3), 4000)
        self.assertIsNone(dm.density(None, 3))
        self.assertIsNone(dm.density(12000, None))

    def test_audience_sizes_are_population_times_each_measured_share(self):
        sizes = dm.audience_sizes(10000, 60, 40)
        self.assertEqual((sizes["men"], sizes["women"]), (6000, 4000))
        self.assertEqual((sizes["saudi"], sizes["non_saudi"]), (4000, 6000))
        # two shares are never multiplied into one another
        self.assertNotEqual(sizes["men"], 10000 * 0.6 * 0.4)

    def test_audience_size_is_none_where_a_share_or_population_is_missing(self):
        self.assertEqual(dm.audience_sizes(10000, None, 40), {"men": None, "women": None, "saudi": 4000, "non_saudi": 6000})
        self.assertEqual(dm.audience_sizes(None, 60, 40), {"men": None, "women": None, "saudi": None, "non_saudi": None})

    def test_area_of_a_unit_square_near_riyadh(self):
        # ~0.01° square at lat 24.7; area ≈ (0.01*111.32)² * cos(24.7°) ≈ 1.126 km²
        square = {"type": "Polygon", "coordinates": [[[46.7, 24.7], [46.71, 24.7], [46.71, 24.71], [46.7, 24.71], [46.7, 24.7]]]}
        self.assertAlmostEqual(dm.area_km2(square), 1.126, delta=0.02)

    def test_hole_is_subtracted(self):
        outer = [[46.7, 24.7], [46.72, 24.7], [46.72, 24.72], [46.7, 24.72], [46.7, 24.7]]
        hole = [[46.705, 24.705], [46.715, 24.705], [46.715, 24.715], [46.705, 24.715], [46.705, 24.705]]
        solid = dm.area_km2({"type": "Polygon", "coordinates": [outer]})
        with_hole = dm.area_km2({"type": "Polygon", "coordinates": [outer, hole]})
        self.assertLess(with_hole, solid)


if __name__ == "__main__":
    unittest.main()
