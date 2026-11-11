import os
import unittest

import taxonomy_search


TAXONOMY_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "docs", "qa", "targeting", "taxonomy"
)


class ActivityResolutionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tx = taxonomy_search.Taxonomy(TAXONOMY_DIR, "/dev/null")

    def test_massage_activity_does_not_expand_to_unrelated_specialties(self):
        for query in ("مساج", "محل مساج"):
            with self.subTest(query=query):
                result = self.tx.understand(query, "purchase")
                self.assertEqual(result["targets"], {"beauty.spa_massage": 3.0})
                self.assertEqual(result["specialties"], ["beauty.spa_massage.massage"])

    def test_qualifiers_keep_the_more_specific_massage_activity(self):
        therapeutic = self.tx.understand("مساج علاجي", "purchase")
        self.assertEqual(therapeutic["targets"], {"health.physio": 3.0})
        self.assertEqual(therapeutic["specialties"], ["health.physio.therapeutic_massage"])

        device = self.tx.understand("جهاز مساج", "purchase")
        self.assertEqual(device["targets"], {"health.medical_supply": 3.0})
        self.assertEqual(device["specialties"], ["health.medical_supply.massage_wellness"])


if __name__ == "__main__":
    unittest.main()
