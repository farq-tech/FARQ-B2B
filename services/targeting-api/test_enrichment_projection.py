"""The v13 enrichment columns (operating-status vote + freshness, canonical weekly hours, WhatsApp state) reach the
search row dict the same guarded way the v7 description/delivery columns do: projected when the release carries them,
NULL when an older release does not — never dropped, never guessed."""
import pathlib
import sys
import tempfile
import unittest

import duckdb

SERVICE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))
import taxonomy_search  # noqa: E402
import trial_search  # noqa: E402
from trial_search import Directory  # noqa: E402

# the columns the native name-search SELECT needs, beyond the enrichment ones under test
BASE_COLUMNS = """poi_key varchar, name_ar varchar, name_en varchar, category varchar, category_ar varchar,
    secondary_category varchar, category_l3 varchar, google_category varchar, district_ar varchar, district_en varchar,
    completeness_pct double, phone_norm varchar, phone_kind varchar, email varchar, website varchar,
    latitude double, longitude double, location_precision varchar, city_en varchar, region_ar varchar,
    region_en varchar, has_whatsapp boolean, source_count integer, company_status varchar, lifecycle_state varchar"""
# one coffee shop whose Arabic name carries the query, so objective='name' matches it on the native path
BASE_VALUES = ("'poi-coffee','متجر البن',NULL,'coffee','بن','','','','العليا','Olaya',90,'966500000000','mobile',"
               "NULL,NULL,24.7,46.7,'point','Riyadh','الرياض','Riyadh',true,2,'open',NULL")
ENRICH_COLUMNS = ("status_voted varchar, status_voted_confidence varchar, last_seen_at date, is_stale boolean, "
                  "hours_week varchar, whatsapp_state varchar")
ENRICH_VALUES = "'open','high',DATE '2026-10-15',false,'{\"mon\":[[\"09:00\",\"23:00\"]]}','source_flag_unverified'"


def _fixture(directory, columns, values):
    path = pathlib.Path(directory) / 'targets.parquet'
    db = duckdb.connect()
    db.execute(f'create table t({columns})')
    db.execute(f'insert into t values ({values})')
    db.execute('copy t to ? (format parquet)', [str(path)])
    db.close()
    return str(path)


class EnrichmentProjectionTests(unittest.TestCase):
    def setUp(self):
        # objective='name' runs the native trial_search path; keep the taxonomy hook out of the way regardless of data
        self._orig = taxonomy_search.directory_search
        taxonomy_search.directory_search = lambda *a, **k: None

    def tearDown(self):
        taxonomy_search.directory_search = self._orig

    def _search_one(self, path):
        result = Directory(path).search('متجر البن', 'Riyadh', 'name', limit=5, offset=0)
        self.assertTrue(result['rows'], 'the fixture coffee shop should be found by name')
        return result['rows'][0]

    def test_release_with_enrichment_columns_is_projected(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = self._search_one(_fixture(tmp, BASE_COLUMNS + ', ' + ENRICH_COLUMNS, BASE_VALUES + ', ' + ENRICH_VALUES))
        self.assertEqual(row['status_voted'], 'open')
        self.assertEqual(row['status_voted_confidence'], 'high')
        self.assertEqual(str(row['last_seen_at']), '2026-10-15')
        self.assertIs(row['is_stale'], False)
        self.assertEqual(row['hours_week'], '{"mon":[["09:00","23:00"]]}')
        self.assertEqual(row['whatsapp_state'], 'source_flag_unverified')

    def test_older_release_without_the_columns_yields_nulls_not_missing_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = self._search_one(_fixture(tmp, BASE_COLUMNS, BASE_VALUES))
        for key in ('status_voted', 'status_voted_confidence', 'last_seen_at', 'is_stale', 'hours_week', 'whatsapp_state'):
            self.assertIn(key, row, f'{key} must be present (guarded projection), never dropped')
            self.assertIsNone(row[key], f'{key} must be NULL on a release that lacks the column')


if __name__ == '__main__':
    unittest.main()
