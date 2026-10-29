"""Review page and scorer for the building-link sample: python3 -m unittest test_building_review (from services/data-cleaning)."""
import csv
import pathlib
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from building_review_page import links  # noqa: E402
from score_building_review import score, wilson  # noqa: E402


class ScoreTests(unittest.TestCase):
    def test_wilson_matches_the_section_8_allowance(self):
        self.assertGreaterEqual(wilson(293, 300)[0], 0.95, 'seven errors in 300 pass 0.95')
        self.assertLess(wilson(292, 300)[0], 0.95, 'eight do not')
        self.assertIsNone(wilson(0, 0))

    def test_cannot_tell_is_left_out_and_unfinished_strata_do_not_pass(self):
        rows = [{'stratum': 'a', 'review_same_building': 'same'}] * 300 + [{'stratum': 'a', 'review_same_building': 'cannot_tell'}]
        rows += [{'stratum': 'b', 'review_same_building': 'same'}, {'stratum': 'b', 'review_same_building': ''}]
        out = score(rows)
        self.assertEqual((out['a']['accuracy'], out['a']['cannot_tell'], out['a']['passes']), (1.0, 1, True))
        self.assertIsNone(out['b']['passes'])


class PageTests(unittest.TestCase):
    def test_links_carry_the_building_and_its_neighbours(self):
        temp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute('LOAD spatial')
        square = lambda x: f"ST_AsHEXWKB(ST_GeomFromText('POLYGON(({x} 24, {x + 0.0002} 24, {x + 0.0002} 24.0002, {x} 24.0002, {x} 24))'))"
        db.execute(f"""copy (select * from (values ('A', '1', '12345', 'تجاري', '2', {square(46.0)}), ('B', null, null, null, '1', {square(46.0003)}),
                                                   ('C', null, null, null, '1', {square(46.5)}))
                        t(HouseId, Number, PostIndex, building_use_ar, Elevation, geometry_wkb_hex)) to '{temp / 'b.parquet'}' (format parquet)""")
        with open(temp / 's.csv', 'w', newline='', encoding='utf-8') as handle:
            writer = csv.writer(handle)
            writer.writerow(['stratum', 'poi_key', 'city_en', 'name_ar', 'name_en', 'latitude', 'longitude', 'proposed_house_id'])
            writer.writerow(['containment_only', 'k1', 'Riyadh', 'محل', '', '24.0001', '46.0001', 'A'])
            writer.writerow(['card_crosswalk_only', 'k2', 'Riyadh', 'محل', '', '24.0001', '46.0001', 'missing'])
        first, second = links(str(temp / 's.csv'), str(temp / 'b.parquet'))
        self.assertEqual((first['number'], first['post'], first['use']), ('1', '12345', 'تجاري'))
        self.assertEqual(len(first['near']), 1, 'B is a neighbour; C is too far')
        self.assertIsNone(second['building'], 'a building missing from the layer is shown as unavailable, not guessed')


if __name__ == '__main__':
    unittest.main()
