"""Stable Farq Atlas IDs and legacy POI aliases resolve to the merged profile."""
import tempfile
import threading
import unittest
from pathlib import Path
import duckdb

from directory_tiles import DirectoryTiles


class DirectoryProfileIdentityTests(unittest.TestCase):
    def test_resolves_canonical_farq_id_and_merged_source_key(self):
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / 'targets.parquet'
            db = duckdb.connect()
            db.execute("""create table places(
                poi_key varchar, farq_atlas_id varchar, merged_source_poi_keys varchar[],
                phone_norm varchar, company_status varchar, lifecycle_state varchar,
                is_wholesale boolean, role_badges varchar, specialty_concepts_ar varchar,
                category varchar, category_ar varchar, secondary_category varchar, category_l3 varchar,
                legal_name varchar, name_ar varchar, name_en varchar, brand_name varchar,
                latitude double, longitude double, district_ar varchar, district_reliable boolean,
                street_ar varchar, location_precision varchar)
            """)
            db.execute("insert into places values ('poi-primary','FA-0123456789ABCDEF0123',['poi-primary','poi-alias'],'966500000000','open',null,false,'','', 'Retail','تجارة','','',null,'متجر الرياض','Riyadh Store','Riyadh Brand',24.7,46.7,'الربيع',true,'الملك فهد','point')")
            db.execute('copy places to ? (format parquet)', [str(path)])
            identity_dir = Path(raw) / 'identity'
            identity_dir.mkdir()
            identity = identity_dir / 'source_to_farq_atlas_id.parquet'
            db.execute("create table aliases(source_poi_key varchar,canonical_poi_key varchar,farq_atlas_id varchar)")
            db.execute("insert into aliases values ('poi-primary','poi-primary','FA-0123456789ABCDEF0123'),('poi-alias','poi-primary','FA-0123456789ABCDEF0123')")
            db.execute('copy aliases to ? (format parquet)', [str(identity)])
            tiles = DirectoryTiles.__new__(DirectoryTiles)
            tiles.lock = threading.RLock()
            tiles.contexts = {}
            tiles.context = lambda _key: (9999999999, None, 'Riyadh', {})
            tiles.path = str(path)
            tiles.db = db
            tiles.columns = {row[0] for row in db.execute('describe select * from read_parquet(?)', [str(path)]).fetchall()}
            tiles.identity_path = str(identity)
            tiles.search_sql = 'true'
            tiles.sql = lambda _city, _filters: ('from read_parquet(?) p where true', [str(path)])
            tiles.branch_counts = {}
            by_alias = tiles.profile('a' * 32, 'poi-alias')
            by_farq_id = tiles.profile('a' * 32, 'FA-0123456789ABCDEF0123')
            self.assertEqual(by_alias['poi_key'], 'poi-primary')
            self.assertEqual(by_alias['farq_atlas_id'], 'FA-0123456789ABCDEF0123')
            self.assertEqual(by_farq_id['poi_key'], 'poi-primary')
            db.close()


if __name__ == '__main__':
    unittest.main()
