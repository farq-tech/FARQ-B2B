import json
import os
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

import duckdb

import canonical_data

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'data-cleaning'))
import city_names  # noqa: E402


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

    def test_national_address_city_spellings_resolve_to_canonical_cities(self):
        self.assertEqual(canonical_data.canonical_city('Sabya'), ('Sabya', 'صبيا'))
        self.assertEqual(canonical_data.canonical_city('Al Hafuf'), ('Al Ahsa', 'الأحساء'))
        self.assertEqual(canonical_data.canonical_city('Al Qunfidhah'), ('Al Qunfudhah', 'القنفذة'))
        self.assertEqual(canonical_data.canonical_city('Baljurashi'), ('Biljurashi', 'بلجرشي'))
        for spelling in ('Ahad Rifaydah', 'Ahad Rufaidah', 'أحد رفيدة'):
            self.assertEqual(canonical_data.canonical_city(spelling), ('Ahad Rifaydah', 'احد رفيده'))
            self.assertEqual(city_names.ALIAS[city_names.key(spelling)], ('Ahad Rifaydah', 'احد رفيده'))
        for spelling in ('Al-Saih', 'Al Saih', 'السيح'):
            self.assertEqual(canonical_data.canonical_city(spelling), ('Al Kharj', 'الخرج'))
            self.assertEqual(canonical_data.canonical_city_name(spelling), 'Al Kharj')
            self.assertEqual(city_names.ALIAS[city_names.key(spelling)], ('Al Kharj', 'الخرج'))
        self.assertEqual(canonical_data.canonical_city_name('Al Kharj'), 'Al Kharj')
        self.assertEqual(canonical_data.canonical_city_name('Unknown City'), 'Unknown City')

    def test_city_boundaries_and_reviewed_airbase_correction_use_al_kharj(self):
        ring = [[47.3, 24.15], [47.31, 24.15], [47.31, 24.16], [47.3, 24.15]]
        collection = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': '10101061001', 'city_en': 'Al-Saih', 'ar': 'المصانع'},
             'geometry': {'type': 'Polygon', 'coordinates': [ring]}},
            {'type': 'Feature', 'properties': {'id': '10101061033', 'city_en': 'Riyadh', 'ar': 'قاعدة الامير سلطان الجوية'},
             'geometry': {'type': 'Polygon', 'coordinates': [ring]}},
            {'type': 'Feature', 'properties': {'id': '10101061032', 'city_en': 'Ad Dilam', 'ar': 'المدينة الصناعية بالخرج'},
             'geometry': {'type': 'Polygon', 'coordinates': [ring]}},
        ]}
        corrections = canonical_data.load_corrections()

        result, _ = canonical_data.canonical_districts(collection, corrections)

        self.assertEqual({feature['properties']['city_en'] for feature in result['features']}, {'Al Kharj'})
        self.assertEqual({feature['properties']['city_ar'] for feature in result['features']}, {'الخرج'})
        airbase = next(feature for feature in result['features'] if feature['properties']['id'] == '10101061033')
        self.assertEqual(airbase['properties']['en'], 'Prince Sultan Air Base')
        self.assertEqual(airbase['properties']['moved_from_city_en'], 'Riyadh')
        industrial_city = next(feature for feature in result['features'] if feature['properties']['id'] == '10101061032')
        self.assertEqual(industrial_city['properties']['city_en'], 'Al Kharj')
        self.assertEqual(industrial_city['properties']['en'], 'Al Kharj Industrial City')
        self.assertEqual(industrial_city['properties']['moved_from_city_en'], 'Ad Dilam')

    def test_missing_polygon_city_names_match_the_source_and_rebuild_aliases(self):
        source_spellings = {
            'Al Mudhaylif': ('Al Mudhaylif', 'المظيلف'),
            'Sajir': ('Sajir', 'ساجر'),
            "Muti'ah": ("Muti'ah", 'مطيعة'),
            'Adham': ('Adham', 'أضم'),
            'Bariq': ('Bariq', 'بارق'),
        }
        for spelling, expected in source_spellings.items():
            with self.subTest(city=spelling):
                self.assertEqual(canonical_data.canonical_city(spelling), expected)
                self.assertEqual(canonical_data.canonical_city(expected[1]), expected)
                self.assertEqual(city_names.ALIAS[city_names.key(spelling)], expected)

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

    def test_a_new_atlas_or_correction_rebuilds_the_cached_copy(self):
        paths = canonical_data.prepare(str(self.data), str(self.out))
        first = os.stat(paths['targets.parquet']).st_mtime_ns
        atlas = json.loads((self.data / 'districts.geojson').read_text(encoding='utf-8'))
        atlas['features'].append({'type': 'Feature', 'properties': {'id': 999, 'ar': 'حي جديد', 'city_en': 'Riyadh'}, 'geometry': None})
        (self.data / 'districts.geojson').write_text(json.dumps(atlas, ensure_ascii=False), encoding='utf-8')
        canonical_data.prepare(str(self.data), str(self.out))
        second = os.stat(paths['targets.parquet']).st_mtime_ns
        self.assertNotEqual(second, first, 'district names are matched against the atlas, so a new atlas rebuilds the copy')
        corrections = self.root / 'corrections.json'
        corrections.write_text(json.dumps({'corrections': []}), encoding='utf-8')
        with mock.patch.object(canonical_data, 'CORRECTIONS_PATH', str(corrections)):
            canonical_data.prepare(str(self.data), str(self.out))
        self.assertNotEqual(os.stat(paths['targets.parquet']).st_mtime_ns, second, 'a changed corrections file rebuilds the copy')

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
    def test_district_geometry_sanitizer_repairs_invalid_rings_and_excludes_unusable_features(self):
        invalid = {'type': 'Polygon', 'coordinates': [[[44.0, 26.0], [44.02, 26.02], [44.02, 26.0], [44.0, 26.02], [44.0, 26.0]]]}
        atlas = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': 1, 'ar': 'الروضة', 'city_en': 'Unaizah'}, 'geometry': invalid},
            {'type': 'Feature', 'properties': {'id': 2, 'ar': 'المنطقة غير المتاحة', 'city_en': 'Unaizah'},
             'geometry': {'type': 'Polygon', 'coordinates': [[[44.0, 26.0], [44.01, 26.0], [44.02, 26.0], [44.0, 26.0]]]}},
            {'type': 'Feature', 'properties': {'id': 3, 'city_en': 'Unaizah'}, 'geometry': poly(44.1, 26.1)}
        ]}

        cleaned, repaired, excluded = canonical_data.sanitize_district_geometries(atlas)

        self.assertEqual((repaired, excluded), (1, 2))
        self.assertEqual([feature['properties']['id'] for feature in cleaned['features']], [1])
        self.assertTrue(canonical_data.shapely.geometry.shape(cleaned['features'][0]['geometry']).is_valid)

    def test_corrected_name_joins_its_district_and_same_names_merge(self):
        collection, id_map = canonical_data.canonical_districts(ATLAS, FIX)
        riyadh = {f['properties']['ar']: f for f in collection['features'] if f['properties']['city_en'] == 'Riyadh'}
        self.assertEqual(set(riyadh), {'العليا', 'السليمانية'})
        olaya, sulay = riyadh['العليا'], riyadh['السليمانية']
        self.assertEqual(olaya['properties']['id'], 492, 'the lowest member id names the merged district')
        self.assertEqual(olaya['properties']['member_ids'], [492, 493])
        self.assertEqual(olaya['geometry']['type'], 'Polygon', 'touching pieces of one neighborhood are dissolved into one valid outline')
        self.assertTrue(canonical_data.shapely.geometry.shape(olaya['geometry']).is_valid)
        self.assertEqual(sulay['properties']['member_ids'], [380, 463])
        self.assertEqual(sulay['properties']['en'], 'Al Sulaimaniyah')
        self.assertEqual(id_map['463'], 380)
        self.assertEqual(id_map['493'], 492)

    def test_invalid_polygon_rings_are_repaired_before_they_reach_the_map(self):
        atlas = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': 12, 'ar': 'الروضة', 'city_en': 'Unaizah'},
             'geometry': {'type': 'Polygon', 'coordinates': [[[44.0, 26.0], [44.02, 26.02], [44.02, 26.0], [44.0, 26.02], [44.0, 26.0]]]}}
        ]}

        collection, id_map = canonical_data.canonical_districts(atlas, {})

        self.assertEqual(len(collection['features']), 1)
        self.assertTrue(canonical_data.shapely.geometry.shape(collection['features'][0]['geometry']).is_valid)
        self.assertEqual(id_map['12'], 12)

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

    def test_population_is_unavailable_if_any_merged_polygon_lacks_its_value(self):
        _, id_map = canonical_data.canonical_districts(ATLAS, FIX)
        rows = [
            {'district_id': 492, 'district_ar': 'العليا', 'district_en': 'x', 'population': 100.0, 'coverage_pct': 90.0, 'valid_cells': 90, 'polygon_cells': 100},
            {'district_id': 493, 'district_ar': 'العليا', 'district_en': 'x', 'population': None, 'coverage_pct': 100.0, 'valid_cells': 40, 'polygon_cells': 40},
        ]

        merged = canonical_data.merge_population_rows(rows, id_map, {'492': ('العليا', 'Al Olaya')})[0]

        self.assertIsNone(merged['population'], 'a partial sum must not stand for the whole district')
        self.assertEqual((merged['valid_cells'], merged['polygon_cells']), (130.0, 140.0))
        self.assertAlmostEqual(merged['coverage_pct'], 100 * 130 / 140, places=3)

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

    def test_age_measurement_is_unavailable_if_a_merged_polygon_is_missing(self):
        _, id_map = canonical_data.canonical_districts(ATLAS, FIX)
        rows = [
            {'district_id': 492, 'district_ar': 'العليا', 'district_en': 'x', 'age_code': '00', 'male': 10.0, 'female': 8.0, 'total': 18.0, 'coverage_pct': 80.0},
            {'district_id': 493, 'district_ar': 'العليا', 'district_en': 'x', 'age_code': '00', 'male': 5.0, 'female': 7.0, 'total': None, 'coverage_pct': 100.0},
        ]

        merged = canonical_data.merge_population_rows(rows, id_map, {'492': ('العليا', 'Al Olaya')}, by_age=True)[0]

        self.assertIsNone(merged['total'], 'age data from only part of the district is incomplete')
        self.assertIsNone(merged['coverage_pct'], 'coverage cannot be weighted by an incomplete total')

    def test_same_name_polygons_that_do_not_touch_stay_separate_districts(self):
        # ids outside the reviewed corrections table, so only the touch rule is at work
        atlas = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': 9421, 'ar': 'الشهداء', 'en': 'Ash-Shohda', 'city_en': 'Riyadh'}, 'geometry': poly(46.73, 24.78)},
            {'type': 'Feature', 'properties': {'id': 9547, 'ar': 'الشهداء', 'en': 'Al Shohda', 'city_en': 'Riyadh'}, 'geometry': poly(46.59, 24.72)},   # ~15 km west
        ]}
        collection, id_map = canonical_data.canonical_districts(atlas, {})
        names = {f['properties']['id']: f['properties']['ar'] for f in collection['features']}
        self.assertEqual(names, {9421: 'الشهداء (شرق)', 9547: 'الشهداء (غرب)'}, 'two places with one name are two districts')
        self.assertEqual((id_map['9421'], id_map['9547']), (9421, 9547))
        self.assertTrue(all(f['properties']['name_base_ar'] == 'الشهداء' for f in collection['features']))
        self.assertEqual(collection['features'][1]['properties']['en'], 'Al Shohda (West)')

    def test_records_with_a_shared_name_go_to_the_nearest_part(self):
        atlas = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': 9421, 'ar': 'الشهداء', 'city_en': 'Riyadh'}, 'geometry': poly(46.73, 24.78)},
            {'type': 'Feature', 'properties': {'id': 9547, 'ar': 'الشهداء', 'city_en': 'Riyadh'}, 'geometry': poly(46.59, 24.72)},
        ]}
        root = Path(tempfile.mkdtemp())
        (root / 'data').mkdir()
        (root / 'data' / 'districts.geojson').write_text(json.dumps(atlas, ensure_ascii=False), encoding='utf-8')
        write_parquet(root / 'data' / 'targets.parquet', ['poi_key', 'city_en', 'district_ar', 'latitude', 'longitude'], [
            ('east', 'Riyadh', 'حي الشهداء', 24.785, 46.735), ('west', 'Riyadh', 'الشهداء', 24.725, 46.595), ('nowhere', 'Riyadh', 'الشهداء', None, None)])
        paths = canonical_data.prepare(str(root / 'data'), str(root / 'out'))
        rows = read(paths['targets.parquet'], ['poi_key', 'district_ar'])
        self.assertEqual((rows['east'], rows['west']), (('الشهداء (شرق)',), ('الشهداء (غرب)',)))
        self.assertEqual(rows['nowhere'], ('الشهداء',), 'without coordinates the record is not guessed into either part')

    def test_a_polygon_moved_to_its_own_city_takes_its_records_with_it(self):
        atlas = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': 421, 'ar': 'الشهداء', 'city_en': 'Riyadh'}, 'geometry': poly(46.73, 24.78)},
            {'type': 'Feature', 'properties': {'id': 547, 'ar': 'الشهداء', 'city_en': 'Riyadh'}, 'geometry': poly(46.59, 24.72)},
        ]}
        fix = {('Riyadh', '547'): {'city_en': 'Riyadh', 'id': '547', 'ar': 'الشهداء', 'to_city_en': 'Diriyah', 'to_city_ar': 'الدرعية'}}
        collection, _ = canonical_data.canonical_districts(atlas, fix)
        cities = {f['properties']['id']: (f['properties']['city_en'], f['properties']['ar']) for f in collection['features']}
        self.assertEqual(cities, {421: ('Riyadh', 'الشهداء'), 547: ('Diriyah', 'الشهداء')}, 'one الشهداء per city, no compass word')
        root = Path(tempfile.mkdtemp())
        (root / 'data').mkdir()
        (root / 'data' / 'districts.geojson').write_text(json.dumps(atlas, ensure_ascii=False), encoding='utf-8')
        write_parquet(root / 'data' / 'targets.parquet', ['poi_key', 'city_en', 'city_ar', 'district_ar', 'latitude', 'longitude'], [
            ('riyadh', 'Riyadh', 'الرياض', 'الشهداء', 24.785, 46.735), ('diriyah', 'Riyadh', 'الرياض', 'الشهداء', 24.725, 46.595)])
        with mock.patch.object(canonical_data, 'load_corrections', lambda path=None: fix):
            paths = canonical_data.prepare(str(root / 'data'), str(root / 'out'))
        rows = read(paths['targets.parquet'], ['poi_key', 'city_en', 'city_ar', 'district_ar'])
        self.assertEqual(rows['riyadh'], ('Riyadh', 'الرياض', 'الشهداء'))
        self.assertEqual(rows['diriyah'], ('Diriyah', 'الدرعية', 'الشهداء'))

    def test_an_outline_filed_under_two_cities_is_kept_once_in_the_nearer_city(self):
        atlas = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': 555, 'ar': 'العليا', 'city_en': 'Dammam'}, 'geometry': poly(50.20, 26.28)},
            {'type': 'Feature', 'properties': {'id': 31, 'ar': 'العليا', 'city_en': 'Al Khobar'}, 'geometry': poly(50.20, 26.28)},
        ]}
        self.assertEqual(canonical_data.cross_city_duplicates(atlas), [('Dammam', '555', 'Al Khobar', '31')], 'the same ground in two cities is flagged')
        fix = {('Dammam', '555'): {'city_en': 'Dammam', 'id': '555', 'ar': 'العليا', 'to_city_en': 'Al Khobar', 'to_city_ar': 'الخبر'}}
        collection, id_map = canonical_data.canonical_districts(atlas, fix)
        self.assertEqual([(f['properties']['city_en'], f['properties']['ar']) for f in collection['features']], [('Al Khobar', 'العليا')], 'one district, in one city')
        self.assertEqual(str(id_map['555']), '31', 'records filed under the Dammam copy join the Al Khobar district')
        self.assertEqual(canonical_data.cross_city_duplicates(collection), [])

    def test_district_names_drop_the_word_hay_and_cities_carry_the_table_name(self):
        atlas = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': 600, 'ar': 'حي العمامرة', 'city_en': 'Dammam', 'city_ar': 'الدمام, مدينة, , المنطقة الشرقية , المملكة العربية السعودية'}, 'geometry': poly(50.10, 26.40)},
        ]}
        collection, _ = canonical_data.canonical_districts(atlas, {})
        props = collection['features'][0]['properties']
        self.assertEqual((props['ar'], props['city_ar']), ('العمامرة', 'الدمام'))

    def test_a_reviewed_place_name_tells_same_name_districts_apart(self):
        atlas = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': 9172, 'ar': 'العزيزية', 'en': 'Al Aziziyah', 'city_en': 'Jeddah'}, 'geometry': poly(39.19, 21.55)},
            {'type': 'Feature', 'properties': {'id': 9343, 'ar': 'العزيزية', 'en': 'Al Aziziyah', 'city_en': 'Jeddah'}, 'geometry': poly(39.44, 21.41)},
        ]}
        fix = {('Jeddah', '9343'): {'city_en': 'Jeddah', 'id': '9343', 'ar': 'العزيزية', 'qualifier_ar': 'بحرة', 'qualifier_en': 'Bahra'}}
        collection, _ = canonical_data.canonical_districts(atlas, fix)
        names = {f['properties']['id']: (f['properties']['ar'], f['properties']['en']) for f in collection['features']}
        self.assertEqual(names, {9172: ('العزيزية', 'Al Aziziyah'), 9343: ('العزيزية (بحرة)', 'Al Aziziyah (Bahra)')})
        self.assertTrue(all('_qualifier' not in f['properties'] for f in collection['features']))

    def test_the_reviewed_corrections_table_loads(self):
        table = canonical_data.load_corrections()
        self.assertEqual(table[('Riyadh', '463')]['ar'], 'السليمانية')
        for city, ident in [('Al Khobar', '48'), ('Al Khobar', '49'),
                            ('Dammam', '587'), ('Dammam', '606'), ('Dammam', '622'),
                            ('Dammam', '623'), ('Dammam', '624'), ('Dammam', '627'),
                            ('Dammam', '629'), ('Dammam', '630'), ('Dammam', '631'),
                            ('Dammam', '632'), ('Dammam', '626'), ('Dammam', '628')]:
            self.assertEqual(table[(city, ident)]['to_city_en'], 'Dhahran', (city, ident))
        self.assertEqual(table[('Riyadh', '546')]['to_city_en'], 'Diriyah')
        self.assertEqual(table[('Ad Dilam', '10101061032')]['to_city_en'], 'Al Kharj')


if __name__ == '__main__':
    unittest.main()
