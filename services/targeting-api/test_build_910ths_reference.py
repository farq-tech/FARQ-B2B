import unittest

import build_910ths_reference as ref


def poly(x, y, size=0.01):
    return {'type': 'Polygon', 'coordinates': [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]}


def feature(ident, name, x, y):
    return {'type': 'Feature', 'properties': {'id': ident, 'ar': name, 'city_en': 'Riyadh'}, 'geometry': poly(x, y)}


def sample(ident, name, population, male=50.0, income=9000):
    return {'district_id': ident, 'n910_name': name, 'n910_population': population, 'male_pct': male, 'saudi_pct': 40.0,
            'income_all': income, 'income_male': None, 'income_female': None, 'income_saudi': None, 'income_non_saudi': None}


ATLAS = {'type': 'FeatureCollection', 'features': [
    feature(1, 'الملز', 46.70, 24.66), feature(2, 'الملز', 46.71, 24.66),          # one district drawn in two touching pieces
    feature(3, 'الشهداء', 46.73, 24.78), feature(4, 'الشهداء', 46.59, 24.72),      # two districts 15 km apart
    feature(5, 'الخزامى', 46.61, 24.70), feature(6, 'الخزامى', 46.62, 24.70),      # touching, but two districts in 910ths
    feature(7, 'المنصورة', 46.75, 24.60), feature(8, 'الرابية', 46.90, 24.80),
]}


class ReferenceBuildTests(unittest.TestCase):
    def setUp(self):
        samples = [sample(1, 'الملز', 93100, 71.9), sample(2, 'الملز', 93100, 71.9),
                   sample(3, 'الشهداء', 29600), sample(4, 'الشهداء', 1700),
                   sample(5, 'الخزامى', 9000, 53.1, 17000), sample(6, 'الخزامي', 3400, 51.0, None),
                   sample(7, 'حي المنصورة (خنشليلة)', 20000), sample(8, 'المرجان', 1700)]
        self.table, self.skipped, self.combined = ref.build(samples, ATLAS, 'Riyadh', '910ths.sa', '2026-10-27')
        self.rows = {row['district_ar']: row for row in self.table['cities']['Riyadh']}

    def test_pieces_of_one_district_give_one_row(self):
        self.assertEqual((self.rows['الملز']['population'], self.rows['الملز']['polygon_ids']), (93100, ['1', '2']))

    def test_separate_districts_sharing_a_name_keep_their_own_figures(self):
        self.assertEqual(self.rows['الشهداء (شرق)']['population'], 29600)
        self.assertEqual(self.rows['الشهداء (غرب)']['population'], 1700)

    def test_two_910ths_districts_in_one_atlas_district_add_up_without_inventing_income(self):
        row = self.rows['الخزامى']
        self.assertEqual(row['population'], 12400)
        self.assertAlmostEqual(row['male_pct'], round(100 * (9000 * 0.531 + 3400 * 0.51) / 12400, 1))
        self.assertIsNone(row['income_all'], 'an average income per worker cannot be combined without worker counts')
        self.assertEqual(self.combined[0]['district_ar'], 'الخزامى')

    def test_a_parenthesised_alias_still_matches_and_a_different_district_is_skipped(self):
        self.assertEqual(self.rows['المنصورة']['population'], 20000)
        self.assertNotIn('الرابية', self.rows)
        self.assertEqual(self.skipped, [{'polygon': '8', 'atlas': 'الرابية', '910ths': 'المرجان'}])


class LinkedNameTests(unittest.TestCase):
    """Reviewed links from district_corrections.json ("n910_names") for districts 910ths names differently."""

    def test_a_reviewed_spelling_is_accepted_and_one_district_drawn_as_two_shares_its_figure(self):
        atlas = {'type': 'FeatureCollection', 'features': [
            feature(1, 'الشعلة', 46.70, 24.66), feature(2, 'جرهم الشمالي', 46.80, 24.70), feature(3, 'جرهم الجنوبي', 46.80, 24.60)]}
        samples = [sample(1, 'الشله', 54400), sample(2, 'حي جرهم', 71500), sample(3, 'حي جرهم', 71500)]
        links = {('Riyadh', '1'): 'الشله', ('Riyadh', '2'): 'حي جرهم', ('Riyadh', '3'): 'حي جرهم'}
        table, skipped, _ = ref.build(samples, atlas, 'Riyadh', '910ths.sa', '2026-10-27', links)
        rows = {row['district_ar']: row for row in table['cities']['Riyadh']}
        self.assertEqual((rows['الشعلة']['population'], rows['الشعلة'].get('shared_with')), (54400, None))
        self.assertEqual(rows['جرهم الشمالي']['shared_with'], ['جرهم الجنوبي', 'جرهم الشمالي'])
        self.assertEqual(rows['جرهم الجنوبي']['population'], 71500, 'each part names the whole figure; golden splits it')
        self.assertEqual(skipped, [])
        _, skipped, _ = ref.build(samples, atlas, 'Riyadh', '910ths.sa', '2026-10-27', {})
        self.assertEqual(len(skipped), 3, 'without a reviewed link a different name is never matched')


if __name__ == '__main__':
    unittest.main()
