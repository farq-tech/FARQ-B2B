import unittest

from city_catalog import city_rows_with_district_counts


def feature(city, ident, name):
    return {
        "type": "Feature",
        "properties": {"city_en": city, "id": ident, "ar": name},
        "geometry": {"type": "Polygon", "coordinates": []},
    }


class CityCatalogTest(unittest.TestCase):
    def test_keeps_cities_without_boundaries_and_reports_zero_coverage(self):
        rows = city_rows_with_district_counts(
            [("Riyadh", "الرياض", 5000), ("Sajir", "ساجر", 1700)],
            [feature("Riyadh", 1, "حي تجريبي")],
        )

        self.assertEqual(rows, [
            {"en": "Riyadh", "ar": "الرياض", "n": 5000, "districts": 1},
            {"en": "Sajir", "ar": "ساجر", "n": 1700, "districts": 0},
        ])

    def test_counts_multiple_features_and_ignores_missing_city_keys(self):
        rows = city_rows_with_district_counts(
            [("Unaizah", "عنيزة", 2000)],
            [
                feature("Unaizah", 1, "حي أول"),
                feature("Unaizah", 2, "حي ثان"),
                {"properties": {}},
                None,
            ],
        )

        self.assertEqual(rows[0]["districts"], 2)

    def test_excludes_features_that_the_map_cannot_display(self):
        rows = city_rows_with_district_counts(
            [("Makkah Al Mukarramah", "مكة المكرمة", 2000)],
            [
                feature("Makkah Al Mukarramah", 141, "حي مسمى"),
                feature("Makkah Al Mukarramah", 142, None),
                {
                    **feature("Makkah Al Mukarramah", 143, "بلا هندسة"),
                    "geometry": None,
                },
            ],
        )

        self.assertEqual(rows[0]["districts"], 1)


if __name__ == "__main__":
    unittest.main()
