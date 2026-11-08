"""A typed specialty («حجامة») answers with its own businesses, not every clinic and spa (owner 2026-11-03: accuracy first).

Directory search (taxonomy_search.search) and the map counts (market_analytics._where) follow the same rule: a business is
the specialty when the directory tags it so or its own name says it; once enough are found, the parent trades drop out.
"""
import os
import pathlib
import sys
import tempfile
import threading
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import market_analytics  # noqa: E402
import taxonomy_search  # noqa: E402
from market_analytics import MarketAnalytics  # noqa: E402

TAX = os.path.join(HERE, '..', '..', 'docs', 'qa', 'targeting', 'taxonomy')
HIJAMA = ['beauty.spa_massage.hijama', 'health.clinic.alternative_medicine']

# (poi_key, name_ar, name_en, sub_id, specialty_ids)
PLACES = [
    ('h1', 'مركز خبراء الحجامة فرع الروابي', None, 'health.clinic', ''),
    ('h2', 'حجامه - مركز خالد الزلال', None, 'health.clinic', ''),
    ('h3', 'أخصائي الحجامة النبوية', None, 'health.clinic', ''),
    ('h4', 'مركز الراحة', 'Hijama Care', 'beauty.spa_massage', ''),
    ('h5', 'مركز النخبة', None, 'health.clinic', 'health.clinic.alternative_medicine'),
    ('c1', 'عيادة الأسنان المتقدمة', None, 'health.clinic', ''),
    ('c2', 'مجمع العيادات الطبية', None, 'health.clinic', ''),
    ('s1', 'سبا الراحة', None, 'beauty.spa_massage', ''),
    ('s2', 'نادي المساج', None, 'beauty.spa_massage', ''),
    ('m1', 'مركز مساج علاجي', None, 'beauty.spa_massage', ''),
    ('m2', 'مساج واسترخاء', None, 'beauty.spa_massage', ''),
]


def write_fixtures(root):
    targets, taxonomy = root / 'targets.parquet', root / 'poi_taxonomy.parquet'
    db = duckdb.connect()
    db.execute("""create table t(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, has_whatsapp boolean,
        phone_norm varchar, phone_kind varchar, is_wholesale boolean, district_ar varchar, district_en varchar,
        district_reliable boolean, location_precision varchar, longitude double, latitude double, commercial_license varchar,
        specialty_ids varchar, category_ar varchar, category varchar, completeness_pct double, region_ar varchar,
        region_en varchar, email varchar, source_count integer, secondary_category varchar, category_l3 varchar,
        company_status varchar, lifecycle_state varchar)""")
    for key, ar, en, _sub, specs in PLACES:
        db.execute("insert into t values (?, 'Riyadh', ?, ?, false, null, null, false, 'النخيل', null, true, 'point', 46.6, 24.7,"
                   " null, ?, null, null, 50, null, null, null, 1, null, null, null, null)", [key, ar, en, specs])
    db.execute('copy t to ? (format parquet)', [str(targets)])
    db.execute('create table c(poi_key varchar, confidence varchar, sub_id varchar)')
    db.executemany("insert into c values (?, 'high', ?)", [(key, sub) for key, _a, _e, sub, _s in PLACES])
    db.execute('copy c to ? (format parquet)', [str(taxonomy)])
    db.close()
    return targets, taxonomy


class NameTermTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tx = taxonomy_search.Taxonomy(TAX, '/dev/null')
        cls.terms = cls.tx.specialty_name_terms(HIJAMA)

    def test_the_specialty_is_read_from_the_name_with_its_article(self):
        for name in ('مركز خبراء الحجامة', 'حجامه - مركز', 'عيادة الطب البديل', 'Hijama Center', 'مركز للحجامة'):
            self.assertTrue(self.tx.names_term(name, self.terms), name)

    def test_other_businesses_and_part_words_are_not(self):
        for name in ('صيدلية النهدي', 'سبا الراحة', 'عيادة الأسنان', 'حجام', 'مطبعة الأحجام الكبيرة'):
            self.assertFalse(self.tx.names_term(name, self.terms), name)

    def test_hijama_is_understood_as_a_specialty(self):
        understood = self.tx.understand('حجامة', 'purchase')
        self.assertEqual(understood['anchor'], 'specialty')
        self.assertEqual(sorted(understood['specialties']), sorted(HIJAMA))


class DirectorySearchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.targets, self.taxonomy = write_fixtures(pathlib.Path(self.temp.name))
        self.tx = taxonomy_search.Taxonomy(TAX, str(self.taxonomy))
        self.originals = (taxonomy_search.classification_layer.served_taxonomy,)
        taxonomy_search.classification_layer.served_taxonomy = lambda path: path

    def tearDown(self):
        taxonomy_search.classification_layer.served_taxonomy = self.originals[0]
        self.temp.cleanup()

    def test_hijama_lists_only_hijama_businesses(self):
        result = self.tx.search(duckdb.connect(), str(self.targets), 'حجامة', 'Riyadh', 'purchase')
        self.assertEqual(sorted(row['poi_key'] for row in result['rows']), ['h1', 'h2', 'h3', 'h4', 'h5'])
        self.assertEqual(result['total'], 5)
        self.assertTrue(all(row['match_level'] == 'specialty' for row in result['rows']))

    def test_massage_family_query_narrows_when_enough_exact_specialties_exist(self):
        result = self.tx.search(duckdb.connect(), str(self.targets), 'مساج', 'Riyadh', 'purchase')
        self.assertEqual(sorted(row['poi_key'] for row in result['rows']), ['m1', 'm2', 's2'])
        self.assertEqual(result['total'], 3)


class MapCountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.targets, self.taxonomy = write_fixtures(pathlib.Path(self.temp.name))
        self.originals = (market_analytics.DATA, market_analytics.POI_TAXONOMY, market_analytics.STREET_DENSITY)
        market_analytics.DATA = str(self.targets)
        market_analytics.POI_TAXONOMY = str(self.taxonomy)
        market_analytics.STREET_DENSITY = str(pathlib.Path(self.temp.name) / 'missing.parquet')
        self.db = duckdb.connect()
        tiles = type('Tiles', (), {})()
        tiles.db, tiles.lock, tiles.search_sql = self.db, threading.RLock(), 'true'
        self.analytics = MarketAnalytics(tiles)
        self.analytics._taxonomy = taxonomy_search.Taxonomy(TAX, '/dev/null')

    def tearDown(self):
        self.db.close()
        market_analytics.DATA, market_analytics.POI_TAXONOMY, market_analytics.STREET_DENSITY = self.originals
        self.temp.cleanup()

    def test_hijama_counts_only_hijama_businesses(self):
        result = self.analytics.district_counts({'city': 'Riyadh', 'q': 'حجامة'})
        self.assertEqual(result['total'], 5, 'tagged or named hijama, not every clinic and spa')

    def test_massage_count_matches_directory_specialty_narrowing(self):
        result = self.analytics.district_counts({'city': 'Riyadh', 'q': 'مساج'})
        self.assertEqual(result['total'], 3, 'same exact specialty matches as directory search')

    def test_a_trade_query_still_counts_the_whole_trade(self):
        result = self.analytics.district_counts({'city': 'Riyadh', 'sub_ids': ['health.clinic']})
        self.assertEqual(result['total'], 6)


if __name__ == '__main__':
    unittest.main()
