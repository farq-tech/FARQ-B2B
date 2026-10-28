"""Chain consensus on synthetic directory rows: python3 -m unittest test_chain_consensus (from services/data-cleaning)."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from chain_consensus import chain_decisions  # noqa: E402

MAIN_OF = {"health.pharmacy": "health", "health.optics": "health", "retail.cosmetics": "retail",
           "food.restaurant": "food", "finance.bank": "finance", "religion.mosque": "religion"}


def row(poi, name, city="Riyadh", cr=None, name_en=None):
    return (poi, city, name, name_en, None, "العليا", cr)


class ChainConsensusTests(unittest.TestCase):
    def decide(self, rows, taxonomy):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        db = duckdb.connect()
        db.execute("create table t(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, brand_name varchar, district_ar varchar, commercial_license varchar)")
        db.executemany("insert into t values (?, ?, ?, ?, ?, ?, ?)", rows)
        from market_analytics import brand_sql
        columns = {r[0] for r in db.execute("describe t").fetchall()}
        selected = db.execute(f"select p.city_en, {brand_sql(columns)} from t p").fetchall()
        return chain_decisions(selected, taxonomy, MAIN_OF)

    def test_minority_and_unclassified_branches_take_the_chain_activity(self):
        rows = [row(f"n{i}", f"صيدلية النهدي - فرع {i}") for i in range(1, 7)]
        taxonomy = {"n1": ("health.pharmacy", "high"), "n2": ("health.pharmacy", "medium"), "n3": ("health.pharmacy", "high"),
                    "n4": ("retail.cosmetics", "medium"), "n5": ("food.restaurant", "low")}
        changes, chains = self.decide(rows, taxonomy)
        self.assertEqual(set(changes), {"n5", "n6"}, 'the cosmetics branch was classified medium: it keeps its activity')
        self.assertTrue(all(c["sub_id"] == "health.pharmacy" and c["confidence"] == "medium" and c["source"] == "chain_consensus" for c in changes.values()))
        self.assertEqual(json.loads(changes["n5"]["evidence"])["before_sub_id"], "food.restaurant")
        self.assertIsNone(json.loads(changes["n6"]["evidence"])["before_sub_id"])
        self.assertEqual(chains[0]["moved"], 2)

    def test_classified_elsewhere_is_kept(self):
        # a shared name is not proof: a branch a surveyor filed elsewhere at high confidence keeps its activity
        rows = [row(f"r{i}", "مصرف الراجحي") for i in range(1, 6)]
        taxonomy = {f"r{i}": ("finance.bank", "high") for i in range(1, 5)} | {"r5": ("religion.mosque", "high")}
        changes, _ = self.decide(rows, taxonomy)
        self.assertEqual(changes, {})

    def test_no_consensus_no_change(self):
        rows = [row(f"m{i}", "مجموعة الفيصل") for i in range(1, 7)]
        taxonomy = {"m1": ("health.pharmacy", "high"), "m2": ("health.pharmacy", "high"), "m3": ("health.pharmacy", "high"),
                    "m4": ("food.restaurant", "medium"), "m5": ("food.restaurant", "medium"), "m6": (None, None)}
        changes, chains = self.decide(rows, taxonomy)
        self.assertEqual((changes, chains), ({}, []))

    def test_too_few_votes_or_branches(self):
        two = [row("s1", "صيدلية سيف"), row("s2", "صيدلية سيف")]
        changes, _ = self.decide(two, {"s1": ("health.pharmacy", "high"), "s2": ("health.pharmacy", "high")})
        self.assertEqual(changes, {})
        few_votes = [row(f"k{i}", "صيدلية كادي") for i in range(1, 6)]
        changes, _ = self.decide(few_votes, {"k1": ("health.pharmacy", "high"), "k2": ("health.pharmacy", "high")})
        self.assertEqual(changes, {})

    def test_a_mostly_unclassified_name_is_not_decided_by_a_few_votes(self):
        rows = [row(f"c{i}", "مكتب مقاولات عامة") for i in range(1, 21)]
        taxonomy = {f"c{i}": ("food.restaurant", "high") for i in range(1, 5)} | {f"c{i}": ("health.pharmacy", "low") for i in range(5, 21)}
        changes, chains = self.decide(rows, taxonomy)
        self.assertEqual((changes, chains), ({}, []))

    def test_bare_activity_word_and_other_cities_stay_apart(self):
        bare = [row(f"g{i}", "صيدلية") for i in range(1, 6)]
        changes, _ = self.decide(bare, {f"g{i}": ("health.pharmacy", "high") for i in range(1, 4)})
        self.assertEqual(changes, {})
        split = [row(f"a{i}", "صيدلية الدواء") for i in range(1, 4)] + [row("j1", "صيدلية الدواء", city="Jeddah")]
        changes, _ = self.decide(split, {f"a{i}": ("health.pharmacy", "high") for i in range(1, 4)})
        self.assertEqual(changes, {})

    def test_cli_writes_a_new_file_and_never_its_input(self):
        temp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute("create table t(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, brand_name varchar, district_ar varchar, commercial_license varchar)")
        db.executemany("insert into t values (?, ?, ?, ?, ?, ?, ?)", [row(f"n{i}", "صيدلية النهدي") for i in range(1, 5)])
        db.execute(f"copy t to '{temp / 'targets.parquet'}' (format parquet)")
        db.execute("create table x(poi_key varchar, sub_id varchar, source varchar, confidence varchar, evidence varchar)")
        db.executemany("insert into x values (?, 'health.pharmacy', 'rules', 'high', null)", [("n1",), ("n2",), ("n3",)])
        db.execute(f"copy x to '{temp / 'tax.parquet'}' (format parquet)")
        (temp / "subs.json").write_text(json.dumps({"subs": [{"sub_id": k, "main_id": v} for k, v in MAIN_OF.items()]}))
        run = lambda out: subprocess.run([sys.executable, str(HERE / "chain_consensus.py"), "--targets", str(temp / "targets.parquet"),
                                          "--taxonomy", str(temp / "tax.parquet"), "--subs", str(temp / "subs.json"), "--out", str(out)],
                                         capture_output=True, text=True)
        self.assertNotEqual(run(temp / "tax.parquet").returncode, 0)
        result = run(temp / "tax_v2.parquet")
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = db.execute(f"select poi_key, sub_id, source, confidence from read_parquet('{temp / 'tax_v2.parquet'}') order by 1").fetchall()
        self.assertEqual(rows[-1], ("n4", "health.pharmacy", "chain_consensus", "medium"))
        self.assertEqual(len(rows), 4)
        self.assertEqual(json.loads((temp / "tax_v2.report.json").read_text())["rows_moved"], 1)
        self.assertNotEqual(run(temp / "tax_v2.parquet").returncode, 0)


if __name__ == "__main__":
    unittest.main()
