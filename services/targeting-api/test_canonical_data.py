import json
import os
import tempfile
import unittest
from pathlib import Path

import duckdb

import canonical_data


OFFICIAL = {
    'type': 'FeatureCollection',
    'features': [
        {'type': 'Feature', 'properties': {'ar': 'أجياد', 'city_en': 'Makkah Al Mukarramah', 'id': 1}, 'geometry': None},
        {'type': 'Feature', 'properties': {'ar': 'الربوة', 'city_en': 'Riyadh', 'id': 2}, 'geometry': None},
    ],
}

ROWS = [
    # poi_key, city_en, city_ar, district_ar, district_reliable
    ('a', 'Mecca', None, 'حي أجياد', True),
    ('b', 'Makkah Al Mukarramah', 'مكة المكرمة', 'اجياد', True),
    ('c', 'Riyadh', 'الرياض', 'الربوه', True),
    ('d', 'Riyadh', 'الرياض', '{"id": null, "name_ar": null}', True),
    ('e', 'Riyadh', 'الرياض', 'False', True),
    ('f', 'Riyadh', 'الرياض', 'King Khalid International Airport', True),
    ('g', 'Riyadh', 'الرياض', 'خشم العان', False),
    ('h', 'Unknown Town', 'بلدة', None, None),
]


def write_parquet(path, columns, rows):
    db = duckdb.connect()
    db.execute('create table t (' + ', '.join(f'{c} varchar' if c != 'district_reliable' else 'district_reliable boolean' for c in columns) + ')')
    db.executemany('insert into t values (' + ', '.join('?' for _ in columns) + ')', rows)
    db.execute('copy t to ? (format parquet)', [str(path)])
    db.close()


def read(path, columns):
    db = duckdb.connect()
    try:
        return {row[0]: row[1:] for row in db.execute(f'select {", ".join(columns)} from read_parquet(?) order by 1', [str(path)]).fetchall()}
    finally:
        db.close()


class CanonicalDataTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.data = self.root / 'data'
        self.out = self.root / 'canonical'
        self.data.mkdir()
        (self.data / 'districts.geojson').write_text(json.dumps(OFFICIAL, ensure_ascii=False), encoding='utf-8')
        write_parquet(self.data / 'targets.parquet', ['poi_key', 'city_en', 'city_ar', 'district_ar', 'district_reliable'], ROWS)
        write_parquet(self.data / 'trade_clusters.parquet', ['label_ar', 'city_en', 'district_ar'], [('x', 'Medina', 'حي العوالي'), ('y', 'Mecca', 'أجياد')])

    def test_city_spellings_merge_into_one_canonical_city(self):
        paths = canonical_data.prepare(str(self.data), str(self.out))
        rows = read(paths['targets.parquet'], ['poi_key', 'city_en', 'city_ar'])
        self.assertEqual(rows['a'], ('Makkah Al Mukarramah', 'مكة المكرمة'))
        self.assertEqual(rows['b'], ('Makkah Al Mukarramah', 'مكة المكرمة'))
        self.assertEqual(rows['h'], ('Unknown Town', 'بلدة'), 'unknown cities are served unchanged')
        clusters = read(paths['trade_clusters.parquet'], ['label_ar', 'city_en', 'district_ar'])
        self.assertEqual(clusters['x'], ('Al Madinah Al Munawwarah', 'العوالي'))
        self.assertEqual(clusters['y'], ('Makkah Al Mukarramah', 'أجياد'))

    def test_district_labels_follow_the_official_atlas_spelling(self):
        paths = canonical_data.prepare(str(self.data), str(self.out))
        rows = read(paths['targets.parquet'], ['poi_key', 'district_ar', 'district_reliable'])
        self.assertEqual(rows['a'], ('أجياد', True), 'the «حي» prefix is dropped and the city alias is resolved before matching')
        self.assertEqual(rows['b'], ('أجياد', True), 'hamza variants match the official spelling')
        self.assertEqual(rows['c'], ('الربوة', True), 'ta marbuta variants match the official spelling')
        self.assertEqual(rows['g'], ('خشم العان', False), 'a real name outside the atlas is kept with its existing reliability')
        self.assertEqual(rows['h'], (None, None))

    def test_values_that_are_not_district_names_become_null_and_unreliable(self):
        paths = canonical_data.prepare(str(self.data), str(self.out))
        rows = read(paths['targets.parquet'], ['poi_key', 'district_ar', 'district_reliable'])
        for key in ('d', 'e', 'f'):
            self.assertEqual(rows[key], (None, False), key)

    def test_mounted_data_is_never_modified_and_copies_are_cached(self):
        before = {name: os.stat(self.data / name).st_mtime_ns for name in ('targets.parquet', 'trade_clusters.parquet')}
        paths = canonical_data.prepare(str(self.data), str(self.out))
        self.assertTrue(all(Path(path).parent == self.out for path in paths.values() if isinstance(path, str) and os.path.isfile(path)))
        self.assertEqual(before, {name: os.stat(self.data / name).st_mtime_ns for name in before})
        first = os.stat(paths['targets.parquet']).st_mtime_ns
        self.assertEqual(canonical_data.prepare(str(self.data), str(self.out)), paths)
        self.assertEqual(os.stat(paths['targets.parquet']).st_mtime_ns, first, 'an unchanged source is not rewritten')

    def test_failure_falls_back_to_the_original_asset(self):
        (self.data / 'targets.parquet').write_bytes(b'not a parquet file')
        paths = canonical_data.prepare(str(self.data), str(self.out))
        self.assertEqual(paths['targets.parquet'], str(self.data / 'targets.parquet'))
        self.assertEqual(Path(paths['trade_clusters.parquet']).parent, self.out)

    def test_canonicalisation_can_be_switched_off(self):
        os.environ['FARQ_TARGETING_CANONICALIZE'] = '0'
        try:
            paths = canonical_data.prepare(str(self.data), str(self.out))
        finally:
            del os.environ['FARQ_TARGETING_CANONICALIZE']
        self.assertEqual(paths['targets.parquet'], str(self.data / 'targets.parquet'))
        self.assertFalse(self.out.exists())


def poly(x, y, size=0.01):
    return {'type': 'Polygon', 'coordinates': [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]}


ATLAS = {'type': 'FeatureCollection', 'features': [
    {'type': 'Feature', 'properties': {'id': 492, 'ar': 'العليا', 'en': 'Al Olaya', 'city_en': 'Riyadh'}, 'geometry': poly(46.68, 24.69)},
    {'type': 'Feature', 'properties': {'id': 463, 'ar': 'العليا', 'en': 'Al Olaya', 'city_en': 'Riyadh'}, 'geometry': poly(46.70, 24.70)},
    {'type': 'Feature', 'properties': {'id': 493, 'ar': 'العليا', 'en': 'Al Olaya', 'city_en': 'Riyadh'}, 'geometry': poly(46.68, 24.70)},
    {'type': 'Feature', 'properties': {'id': 380, 'ar': 'السليمانية', 'en': 'Al Sulaimaniyah', 'city_en': 'Riyadh'}, 'geometry': poly(46.70, 24.71)},
    {'type': 'Feature', 'properties': {'id': 50, 'ar': 'شاطئ نصف القمر', 'city_en': 'Al Khobar'}, 'geometry': poly(50.0, 26.0)},
    {'type': 'Feature', 'properties': {'id': 653, 'ar': 'شاطئ نصف القمر', 'city_en': 'Dammam'}, 'geometry': poly(50.0, 26.0)},
]}
FIX = {('Riyadh', '463'): {'city_en': 'Riyadh', 'id': '463', 'ar': 'السليمانية', 'en': 'Al Sulaimaniyah'}}


class CanonicalDistrictTests(unittest.TestCase):
    def test_corrected_name_joins_its_district_and_same_names_merge(self):
        collection, id_map = canonical_data.canonical_districts(ATLAS, FIX)
        riyadh = {f['properties']['ar']: f for f in collection['features'] if f['properties']['city_en'] == 'Riyadh'}
        self.assertEqual(set(riyadh), {'العليا', 'السليمانية'})
        olaya, sulay = riyadh['العليا'], riyadh['السليمانية']
        self.assertEqual(olaya['properties']['id'], 492, 'the lowest member id names the merged district')
        self.assertEqual(olaya['properties']['member_ids'], [492, 493])
        self.assertEqual(olaya['geometry']['type'], 'MultiPolygon')
        self.assertEqual(len(olaya['geometry']['coordinates']), 2)
        self.assertEqual(sulay['properties']['member_ids'], [380, 463])
        self.assertEqual(sulay['properties']['en'], 'Al Sulaimaniyah')
        self.assertEqual(id_map['463'], 380)
        self.assertEqual(id_map['493'], 492)

    def test_same_name_in_another_city_is_not_merged(self):
        collection, _ = canonical_data.canonical_districts(ATLAS, FIX)
        beach = [f for f in collection['features'] if f['properties']['ar'] == 'شاطئ نصف القمر']
        self.assertEqual(sorted(f['properties']['city_en'] for f in beach), ['Al Khobar', 'Dammam'])
        self.assertTrue(all('member_ids' not in f['properties'] for f in beach))

    def test_population_rows_are_summed_into_the_canonical_district(self):
        _, id_map = canonical_data.canonical_districts(ATLAS, FIX)
        names = {'380': ('السليمانية', 'Al Sulaimaniyah'), '492': ('العليا', 'Al Olaya')}
        rows = [
            {'district_id': 380, 'district_ar': 'السليمانية', 'district_en': 'x', 'population': 1000.0, 'coverage_pct': 90.0, 'valid_cells': 90, 'polygon_cells': 100},
            {'district_id': 463, 'district_ar': 'العليا', 'district_en': 'x', 'population': 500.0, 'coverage_pct': 50.0, 'valid_cells': 25, 'polygon_cells': 50},
            {'district_id': 999, 'district_ar': 'غير مدمج', 'district_en': 'y', 'population': None, 'coverage_pct': None, 'valid_cells': 0, 'polygon_cells': 0},
        ]
        merged = {str(r['district_id']): r for r in canonical_data.merge_population_rows(rows, id_map, names)}
        self.assertEqual(set(merged), {'380', '999'})
        self.assertEqual(merged['380']['population'], 1500.0)
        self.assertEqual(merged['380']['district_ar'], 'السليمانية')
        self.assertAlmostEqual(merged['380']['coverage_pct'], 100 * 115 / 150, places=3)
        self.assertIsNone(merged['999']['population'], 'missing population stays missing, never zero')

    def test_age_rows_merge_per_age_group(self):
        _, id_map = canonical_data.canonical_districts(ATLAS, FIX)
        rows = [
            {'district_id': 492, 'district_ar': 'العليا', 'district_en': 'x', 'age_code': '00', 'male': 10.0, 'female': 8.0, 'total': 18.0, 'coverage_pct': 80.0},
            {'district_id': 493, 'district_ar': 'العليا', 'district_en': 'x', 'age_code': '00', 'male': 5.0, 'female': 7.0, 'total': 12.0, 'coverage_pct': 100.0},
            {'district_id': 493, 'district_ar': 'العليا', 'district_en': 'x', 'age_code': 'ALL', 'male': 50.0, 'female': 40.0, 'total': 90.0, 'coverage_pct': 100.0},
        ]
        merged = canonical_data.merge_population_rows(rows, id_map, {'492': ('العليا', 'Al Olaya')}, by_age=True)
        by_age = {r['age_code']: r for r in merged}
        self.assertEqual((by_age['00']['male'], by_age['00']['female'], by_age['00']['total']), (15.0, 15.0, 30.0))
        self.assertAlmostEqual(by_age['00']['coverage_pct'], (18 * 80 + 12 * 100) / 30, places=3)
        self.assertEqual(by_age['ALL']['district_id'], 492)

    def test_the_reviewed_corrections_table_loads(self):
        table = canonical_data.load_corrections()
        self.assertEqual(table[('Riyadh', '463')]['ar'], 'السليمانية')


if __name__ == '__main__':
    unittest.main()
