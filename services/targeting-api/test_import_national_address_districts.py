import unittest

from import_national_address_districts import (
    introduced_cross_city_overlaps,
    repair_existing_geometries,
    repair_invalid_geometries_from_source,
    supplement_missing_city_districts,
)


def polygon(points):
    return {"type": "Polygon", "coordinates": [points]}


class NationalAddressDistrictImportTests(unittest.TestCase):
    def setUp(self):
        self.city_rows = [
            {"city_id": "80", "name_en": "Unayzah", "name_ar": "عنيزة"},
            {"city_id": "3", "name_en": "Riyadh", "name_ar": "الرياض"},
            {"city_id": "999", "name_en": "Unknown Test Town", "name_ar": "مدينة اختبار"},
        ]
        self.source = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"district_id": 10400080001, "city_id": 80, "name_ar": "حي الروابي", "name_en": "Ar Rawabi"},
                    "geometry": polygon([[44.0, 26.0], [44.01, 26.0], [44.01, 26.01], [44.0, 26.0]]),
                },
                {
                    "type": "Feature",
                    "properties": {"district_id": 10400080002, "city_id": 80, "name_ar": "حي النخيل", "name_en": "An Nakhil"},
                    "geometry": polygon([[44.0, 26.0], [44.01, 26.01], [44.01, 26.0], [44.0, 26.01], [44.0, 26.0]]),
                },
                {
                    "type": "Feature",
                    "properties": {"district_id": 3, "city_id": 3, "name_ar": "حي العليا", "name_en": "Al Olaya"},
                    "geometry": polygon([[46.0, 24.0], [46.01, 24.0], [46.01, 24.01], [46.0, 24.0]]),
                },
                {
                    "type": "Feature",
                    "properties": {"district_id": 999, "city_id": 999, "name_ar": "حي الاختبار", "name_en": "Test"},
                    "geometry": polygon([[45.0, 24.0], [45.01, 24.0], [45.01, 24.01], [45.0, 24.0]]),
                },
            ],
        }
        self.base = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {"id": "riyadh-1", "city_en": "Riyadh"}, "geometry": polygon([[46, 24], [46.1, 24], [46.1, 24.1], [46, 24]])}],
        }

    def test_adds_only_missing_canonical_cities_and_repairs_invalid_shapes(self):
        added, report = supplement_missing_city_districts(self.source, self.city_rows, self.base)

        self.assertEqual(len(added), 2)
        self.assertEqual({feature["properties"]["city_en"] for feature in added}, {"Unaizah"})
        self.assertEqual(report["skipped_city_already_in_atlas"], 1)
        self.assertEqual(report["skipped_unmapped_city"], 1)
        self.assertEqual(report["repaired_geometry"], 1)
        self.assertEqual(report["cities"], {"Unaizah": 2})
        from shapely.geometry import shape
        self.assertTrue(all(shape(feature["geometry"]).is_valid for feature in added))

    def test_rejects_coordinates_outside_saudi_bounds(self):
        source = {"features": [dict(self.source["features"][0], geometry=polygon([[24, 46], [24.01, 46], [24.01, 46.01], [24, 46]]))]}

        added, report = supplement_missing_city_districts(source, self.city_rows, self.base)

        self.assertEqual(added, [])
        self.assertEqual(report["skipped_invalid_or_out_of_bounds_geometry"], 1)

    def test_refuses_source_id_collision(self):
        base = {"features": [{"type": "Feature", "properties": {"id": "10400080001", "city_en": "Riyadh"}, "geometry": polygon([[46, 24], [46.1, 24], [46.1, 24.1], [46, 24]])}]}

        with self.assertRaisesRegex(ValueError, "district id collision"):
            supplement_missing_city_districts(self.source, self.city_rows, base)

    def test_exact_source_id_and_geometry_counts_as_coverage_despite_stale_city_label(self):
        source_feature = self.source["features"][0]
        base = {"features": [{
            "type": "Feature",
            "properties": {"id": str(source_feature["properties"]["district_id"]), "city_en": "روضة سدير"},
            "geometry": source_feature["geometry"],
        }]}

        added, report = supplement_missing_city_districts(self.source, self.city_rows, base)

        self.assertEqual([feature["properties"]["source_district_id"] for feature in added], [10400080002])
        self.assertEqual(report["source_boundary_matches_existing"], 1)
        self.assertEqual(report["source_cities_with_matching_boundaries"], ["Unaizah"])
        self.assertEqual(report["skipped_duplicate_source_id"], 1)

    def test_imports_missing_ids_for_a_partially_covered_city(self):
        source_features = self.source["features"][:2]
        base = {"features": [{
            "type": "Feature",
            "properties": {"id": str(source_features[0]["properties"]["district_id"]), "city_en": "Unaizah"},
            "geometry": source_features[0]["geometry"],
        }]}

        added, report = supplement_missing_city_districts(
            {"features": source_features}, self.city_rows, base,
        )

        self.assertEqual([feature["properties"]["source_district_id"] for feature in added], [10400080002])
        self.assertEqual(report["skipped_duplicate_source_id"], 1)
        self.assertEqual(report["imported"], 1)

    def test_repairs_invalid_base_shape_when_area_change_is_below_threshold(self):
        geometry = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[44, 26], [44.1, 26], [44.1, 26.1], [44, 26.1], [44, 26]]],
                [[[44.04, 26.04], [44.041, 26.04], [44.041, 26.041], [44.04, 26.041], [44.04, 26.04]]],
            ],
        }
        collection = {"features": [{"type": "Feature", "properties": {"id": "small-fix"}, "geometry": geometry}]}

        repaired, report = repair_existing_geometries(collection)

        from shapely.geometry import shape
        self.assertTrue(shape(repaired["features"][0]["geometry"]).is_valid)
        self.assertFalse(shape(collection["features"][0]["geometry"]).is_valid)
        self.assertEqual(report["repaired_ids"], ["small-fix"])

    def test_leaves_invalid_base_shape_unchanged_when_area_change_is_large(self):
        geometry = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[44, 26], [44.1, 26], [44.1, 26.1], [44, 26.1], [44, 26]]],
                [[[44.02, 26.02], [44.03, 26.02], [44.03, 26.03], [44.02, 26.03], [44.02, 26.02]]],
            ],
        }
        collection = {"features": [{"type": "Feature", "properties": {"id": "large-fix"}, "geometry": geometry}]}

        repaired, report = repair_existing_geometries(collection)

        self.assertEqual(repaired["features"][0]["geometry"], geometry)
        self.assertEqual(report["skipped_large_area_change"][0]["id"], "large-fix")

    def test_replaces_invalid_outline_only_with_unique_valid_same_city_name_source_match(self):
        invalid = polygon([[44.0, 26.0], [44.02, 26.02], [44.02, 26.0], [44.0, 26.02], [44.0, 26.0]])
        official = polygon([[44.0, 26.0], [44.02, 26.0], [44.02, 26.02], [44.0, 26.02], [44.0, 26.0]])
        base = {"features": [{
            "type": "Feature", "properties": {"id": "atlas-65", "ar": "الروابي", "city_en": "Unayzah"},
            "geometry": invalid,
        }]}
        source = {"features": [{
            "type": "Feature", "properties": {"district_id": "official-1", "city_id": "80", "name_ar": "حي الروابي"},
            "geometry": official,
        }]}

        repaired, report = repair_invalid_geometries_from_source(base, source, self.city_rows)

        properties = repaired["features"][0]["properties"]
        from shapely.geometry import shape
        self.assertTrue(shape(repaired["features"][0]["geometry"]).equals(shape(official)))
        self.assertEqual(properties["id"], "atlas-65")
        self.assertEqual(properties["geometry_source_district_id"], "official-1")
        self.assertEqual(report["replaced_count"], 1)
        self.assertGreaterEqual(report["replaced"][0]["overlap_ratio"], 0.95)

    def test_leaves_invalid_outline_when_source_name_and_city_do_not_uniquely_match(self):
        invalid = polygon([[44.0, 26.0], [44.02, 26.02], [44.02, 26.0], [44.0, 26.02], [44.0, 26.0]])
        remote = polygon([[45.0, 26.0], [45.02, 26.0], [45.02, 26.02], [45.0, 26.02], [45.0, 26.0]])
        base = {"features": [{
            "type": "Feature", "properties": {"id": "atlas-65", "ar": "الروابي", "city_en": "Unayzah"},
            "geometry": invalid,
        }]}
        source = {"features": [{
            "type": "Feature", "properties": {"district_id": "official-1", "city_id": "80", "name_ar": "حي الروابي"},
            "geometry": remote,
        }]}

        repaired, report = repair_invalid_geometries_from_source(base, source, self.city_rows)

        self.assertEqual(repaired["features"][0]["geometry"], invalid)
        self.assertEqual(report["replaced_count"], 0)
        self.assertEqual(report["skipped"][0]["reason"], "no_unique_source_match")

    def test_reports_overlaps_introduced_with_another_city(self):
        base = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature", "properties": {"id": "riyadh-1", "ar": "الربيع", "city_en": "Riyadh"},
                "geometry": polygon([[46.0, 24.0], [46.01, 24.0], [46.01, 24.01], [46.0, 24.0]]),
            }],
        }
        candidate = {"type": "FeatureCollection", "features": [*base["features"], {
            "type": "Feature", "properties": {"id": "unaizah-1", "ar": "الربيع", "city_en": "Unaizah"},
            "geometry": base["features"][0]["geometry"],
        }]}

        overlaps = introduced_cross_city_overlaps(base, candidate)

        self.assertEqual(len(overlaps), 1)
        self.assertEqual(set(overlaps[0][::2]), {"Riyadh", "Unaizah"})

    def test_skips_source_copy_of_a_boundary_after_canonical_city_correction(self):
        points = [[50.0, 26.0], [50.01, 26.0], [50.01, 26.01], [50.0, 26.0]]
        source = {"features": [{
            "type": "Feature",
            "properties": {"district_id": 10500227001, "city_id": "dhahran", "name_ar": "الدوحة الجنوبية", "name_en": "Ad Dawhah Al Janubiyah"},
            "geometry": polygon(points),
        }]}
        base = {"features": [{
            "type": "Feature", "properties": {"id": "48", "ar": "الدوحة الجنوبية", "city_en": "Al Khobar"},
            "geometry": polygon(points),
        }]}
        city_rows = [{"city_id": "dhahran", "name_en": "Dhahran", "name_ar": "الظهران"}]

        added, report = supplement_missing_city_districts(source, city_rows, base)

        self.assertEqual(added, [])
        self.assertEqual(report["skipped_duplicate_canonical_boundary"], 1)
        self.assertEqual(report.get("skipped_ambiguous_cross_city_overlap", 0), 0)

    def test_spelling_variants_of_one_city_do_not_create_a_cross_city_overlap(self):
        points = [[43.75, 18.3], [43.76, 18.3], [43.76, 18.31], [43.75, 18.3]]
        source = {"features": [{
            "type": "Feature",
            "properties": {"district_id": 10600065013, "city_id": "ahad", "name_ar": "حي الرونه", "name_en": "Ar Rawnah"},
            "geometry": polygon(points),
        }]}
        base = {"features": [{
            "type": "Feature", "properties": {"id": "legacy-rawnah", "ar": "الرونه", "city_en": "Ahad Rufaidah"},
            "geometry": polygon(points),
        }]}
        city_rows = [{"city_id": "ahad", "name_en": "Ahad Rifaydah", "name_ar": "احد رفيده"}]

        added, report = supplement_missing_city_districts(source, city_rows, base)

        self.assertEqual(added, [])
        self.assertEqual(report["skipped_duplicate_canonical_boundary"], 1)
        self.assertEqual(report.get("skipped_ambiguous_cross_city_overlap", 0), 0)

    def test_skips_and_reports_unmatched_boundary_that_overlaps_another_city(self):
        base_shape = polygon([[46.4, 24.9], [46.7, 24.9], [46.7, 25.1], [46.4, 25.1], [46.4, 24.9]])
        source_shape = polygon([[46.5, 25.0], [46.52, 25.0], [46.52, 25.03], [46.5, 25.03], [46.5, 25.0]])
        source = {"features": [{
            "type": "Feature",
            "properties": {"district_id": "diriyah-77", "city_id": "diriyah", "name_ar": "سلطانة", "name_en": "Sultanah"},
            "geometry": source_shape,
        }]}
        base = {"features": [{
            "type": "Feature", "properties": {"id": "516", "ar": "بنبان", "city_en": "Riyadh"},
            "geometry": base_shape,
        }]}
        city_rows = [{"city_id": "diriyah", "name_en": "Ad Dir'iyah", "name_ar": "الدرعية"}]

        added, report = supplement_missing_city_districts(source, city_rows, base)

        self.assertEqual(added, [])
        self.assertEqual(report["skipped_ambiguous_cross_city_overlap"], 1)
        self.assertEqual(report["overlap_conflicts"][0]["overlap_city"], "Riyadh")


if __name__ == "__main__":
    unittest.main()
