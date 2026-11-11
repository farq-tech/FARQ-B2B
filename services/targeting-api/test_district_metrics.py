# -*- coding: utf-8 -*-
import unittest

import district_metrics as dm


class DistrictMetricsTest(unittest.TestCase):
    def test_rounding_an_optional_count_preserves_zero_and_only_none_is_unavailable(self):
        self.assertEqual(dm.rounded_count(0), 0)
        self.assertEqual(dm.rounded_count(1.6), 2)
        self.assertIsNone(dm.rounded_count(None))

    def test_residents_per_is_none_without_both_figures(self):
        self.assertEqual(dm.residents_per(12000, 40), 300)
        self.assertIsNone(dm.residents_per(None, 40))
        self.assertIsNone(dm.residents_per(12000, 0))
        self.assertIsNone(dm.residents_per(12000, None))

    def test_scope_summary_uses_matching_district_population_and_business_counts(self):
        summary = dm.scope_summary([12000, 8000], [40, 10])
        self.assertEqual(summary, {"population": 20000, "businesses": 50, "residents_per": 400, "districts": 2})

    def test_scope_summary_does_not_fill_missing_population_with_zero(self):
        summary = dm.scope_summary([12000, None], [40, 10])
        self.assertEqual(summary, {"population": None, "businesses": 50, "residents_per": None, "districts": 2})

    def test_scope_summary_is_unavailable_without_a_nonzero_business_denominator(self):
        summary = dm.scope_summary([12000], [0])
        self.assertEqual(summary, {"population": 12000, "businesses": 0, "residents_per": None, "districts": 1})

    def test_scope_business_total_stays_unavailable_when_any_district_identity_is_unresolved(self):
        summary = dm.scope_summary([12000, 8000], [None, None])
        self.assertEqual(summary, {"population": 20000, "businesses": None, "residents_per": None, "districts": 2})

    def test_district_feature_name_resolves_only_when_exactly_unique(self):
        first = {"properties": {"id": "a", "ar": "حي الندى"}}
        second = {"properties": {"id": "b", "ar": "حي الندى"}}
        third = {"properties": {"id": "c", "ar": "حي الربيع"}}
        index = dm.unique_district_features_by_name([first, second, third])
        self.assertIsNone(index['حي الندى'])
        self.assertIs(index['حي الربيع'], third)

    def test_aggregate_rows_get_an_id_only_for_one_exact_official_name(self):
        features = [
            {"properties": {"id": 10, "ar": "حي الندى"}},
            {"properties": {"id": 11, "ar": "حي الندى"}},
            {"properties": {"id": 12, "ar": "حي الربيع"}},
        ]
        rows = [{"district_ar": "حي الندى", "n": 2}, {"district_ar": "حي الربيع", "n": 3}, {"district_ar": "حي الروضة", "n": 1}]
        self.assertEqual(dm.attach_district_ids(rows, features), [
            {"district_ar": "حي الندى", "n": 2, "district_id": None},
            {"district_ar": "حي الربيع", "n": 3, "district_id": "12"},
            {"district_ar": "حي الروضة", "n": 1, "district_id": None},
        ])

    def test_selected_ids_resolve_to_names_only_when_the_name_is_unambiguous(self):
        features = [
            {"properties": {"id": "d1", "ar": "الندى"}},
            {"properties": {"id": "d2", "ar": "الندى"}},
            {"properties": {"id": "d3", "ar": "الربيع"}},
        ]
        self.assertEqual(dm.unique_district_names_by_ids(["d3"], features), ["الربيع"])
        self.assertIsNone(dm.unique_district_names_by_ids(["d1"], features), "ambiguous display names cannot choose route stops")
        self.assertIsNone(dm.unique_district_names_by_ids(["missing"], features), "unknown IDs cannot widen a district query")

    def test_population_and_measured_sex_share_join_by_id_not_duplicate_name(self):
        population = [
            {"district_id": "d1", "district_ar": "الندى", "population": 10000, "source": "910ths.sa"},
            {"district_id": "d2", "district_ar": "الندى", "population": 20000, "source": "910ths.sa"},
            {"district_id": "d3", "district_ar": "الربيع", "population": 5000, "source": "buildings"},
        ]
        audience = [
            {"district_id": "d1", "male_pct": 60},
            {"district_id": "d2", "male_pct": 25},
            {"district_id": None, "male_pct": 99},
        ]
        rows = dm.population_audience_by_id(population, audience)
        self.assertEqual((rows['d1']['male'], rows['d1']['female']), (6000, 4000))
        self.assertEqual((rows['d2']['male'], rows['d2']['female']), (5000, 15000))
        self.assertEqual((rows['d3']['male'], rows['d3']['female']), (None, None))

    def test_duplicate_population_or_audience_ids_do_not_overwrite(self):
        population = [
            {"district_id": "d1", "district_ar": "الندى", "population": 10000},
            {"district_id": "d1", "district_ar": "الندى", "population": 20000},
        ]
        self.assertEqual(dm.population_audience_by_id(population, [{"district_id": "d1", "male_pct": 50}]), {})
        rows = dm.population_audience_by_id(
            [{"district_id": "d2", "district_ar": "الندى", "population": 10000}],
            [{"district_id": "d2", "male_pct": 50}, {"district_id": "d2", "male_pct": 60}],
        )
        self.assertEqual((rows['d2']['male'], rows['d2']['female']), (None, None))

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

    def test_audience_sizes_preserve_measured_zero_shares(self):
        sizes = dm.audience_sizes(10000, 0, 100)
        self.assertEqual((sizes["men"], sizes["women"]), (0, 10000))
        self.assertEqual((sizes["saudi"], sizes["non_saudi"]), (10000, 0))

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
