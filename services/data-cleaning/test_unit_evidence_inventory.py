"""Building-layer checks of the unit-evidence inventory on synthetic rows: python3 -m unittest test_unit_evidence_inventory
(from services/data-cleaning)."""
import argparse
import pathlib
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from unit_evidence_inventory import building_ids, floor_of, geography  # noqa: E402

A, B = '70030076000000011', '70030076000000012'


def square(x, y, side=0.001):
    return f'POLYGON(({x} {y}, {x + side} {y}, {x + side} {y + side}, {x} {y + side}, {x} {y}))'


class GeographyTests(unittest.TestCase):
    def run_geo(self, points, evidence):
        temp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute('LOAD spatial')
        db.execute(f"""copy (select * from (values ('{A}', '1111', '12345', 'Shop', null, null, '1', ST_AsHEXWKB(ST_GeomFromText('{square(46.0, 24.0)}'))),
                                                   ('{B}', '2222', null, 'Villa', null, null, '2', ST_AsHEXWKB(ST_GeomFromText('{square(46.01, 24.0)}'))))
                        t(HouseId, Number, PostIndex, Purpose, Apartments, Entrances, Elevation, geometry_wkb_hex)) to '{temp / 'b.parquet'}' (format parquet)""")
        db.execute("create table r(poi_key varchar, city_en varchar, latitude double, longitude double)")
        db.executemany("insert into r values (?, 'Riyadh', ?, ?)", points)
        db.execute(f"copy r to '{temp / 'r.parquet'}' (format parquet)")
        args = argparse.Namespace(buildings=str(temp / 'b.parquet'), release=str(temp / 'r.parquet'), card_links=None, urbi=None,
                                  osm=None, sample_out=None, data=str(temp))
        release = {k: ('Riyadh', None) for k, *_ in points}
        explicit = lambda ids: ids
        level_of = lambda key: 'building' if evidence.get(key) else 'none'
        return geography(duckdb.connect(), args, release, evidence, level_of, lambda key: 'Riyadh', explicit)

    def test_footprint_agreement_and_gain(self):
        points = [('same', 24.0005, 46.0005), ('other', 24.0005, 46.0105), ('bare', 24.0005, 46.0005), ('far', 25.0, 47.0)]
        evidence = {'same': {'urbi_card_building': [({'urbi_building': A}, None)]},
                    'other': {'urbi_card_building': [({'urbi_building': A}, None)]}}
        geo = self.run_geo(points, evidence)
        self.assertEqual(dict(geo['explicit_urbi_vs_footprint_at_point_by_source']['urbi_card_building']), {'same': 1, 'different': 1})
        gain = geo['net_gain_for_businesses_without_evidence']
        self.assertEqual(gain['containment_one_building']['Riyadh'], 1, 'a footprint is a candidate for a business without evidence')
        self.assertEqual(gain['no_footprint']['Riyadh'], 1)
        self.assertEqual(geo['layer_fields_filled']['number_and_post_index'], 1)
        self.assertEqual(geo['urbi_ids_found_in_layer_by_source']['urbi_card_building'], {'in_layer': 2})


class FieldTests(unittest.TestCase):
    def test_floor_spellings_and_ground(self):
        self.assertEqual([floor_of({'floor': v}) for v in (0, '0.0', 'GF', 'ground', 'L2', 'first', 'x', None)],
                         ['0', '0', '0', '0', '2', '1', None, None])

    def test_card_building_id_is_an_urbi_building(self):
        self.assertEqual(building_ids({'urbi_building_id': A}), {'urbi_building': A})
        self.assertEqual(building_ids({'urbi_building_id': '7.0030076e+16'}), {})


if __name__ == '__main__':
    unittest.main()
