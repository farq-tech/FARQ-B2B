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
        self.assertTrue(all(Path(path).parent == self.out for path in paths.values() if os.path.isfile(path)))
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


if __name__ == '__main__':
    unittest.main()
