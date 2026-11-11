"""Closed locations must not inflate current branch counts or branch-only results."""
from pathlib import Path
import tempfile
import unittest

import duckdb

from directory_tiles import DirectoryTiles


class DirectoryTilesStatusTests(unittest.TestCase):
    def test_permanently_closed_locations_do_not_count_as_active_branches(self):
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "targets.parquet"
            db = duckdb.connect()
            db.execute("""create table places(
                poi_key varchar, city_en varchar, name_ar varchar, name_en varchar,
                brand_name varchar, company_status varchar, lifecycle_state varchar,
                latitude double, longitude double
            )""")
            db.executemany("insert into places values (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                ("active-one", "Riyadh", "متجر أ", "Store A", "chain-a", "open", None, 24.7, 46.7),
                ("closed-two", "Riyadh", "متجر أ", "Store A", "chain-a", "closed", None, 24.8, 46.8),
                ("closed-only", "Riyadh", "متجر ب", "Store B", "chain-b", None, "closed", 24.9, 46.9),
            ])
            db.execute("copy places to ? (format parquet)", [str(path)])
            db.close()

            tiles = DirectoryTiles(str(path))
            try:
                self.assertEqual(tiles.branch_counts.get("chain-a"), 1)
                self.assertNotIn("chain-b", tiles.branch_counts)

                sql, params = tiles.sql("Riyadh", {"branches_only": True})
                with tiles.lock:
                    rows = tiles.db.execute("select p.poi_key " + sql, params).fetchall()
                self.assertEqual(rows, [])
            finally:
                tiles.db.close()


if __name__ == "__main__":
    unittest.main()
