"""Two-level classifier on synthetic rows: python3 -m unittest test_classify_poi (from services/data-cleaning)."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent


class ClassifyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        # two clearly separable activities so a tiny model learns them: bakeries vs barbershops
        bake = [('مخبز ' + n, 'food.bakery') for n in ('الصباح', 'الحي', 'النور', 'الريان', 'المدينة', 'الفجر')]
        barb = [('حلاق ' + n, 'beauty.barber') for n in ('الرجال', 'الأصيل', 'النخبة', 'الملكي', 'الذهبي', 'العصري')]
        rows = bake + barb
        db.execute("create table l(name_ar varchar, name_en varchar, tradename varchar, description_ar varchar, "
                   "deleted boolean, sub_id varchar, sub_confidence varchar)")
        db.executemany("insert into l values (?, null, null, null, false, ?, 'high')", rows)
        db.execute(f"copy l to '{self.tmp / 'labels.parquet'}' (format parquet)")
        db.execute("create table t(poi_key varchar, name_ar varchar, name_en varchar)")
        db.executemany("insert into t values (?, ?, null)",
                       [('hh:1', 'مخبز الفردوس'), ('hh:2', 'حلاق الشباب'), ('hh:3', 'xyz'),
                        ('hh:4', 'False'), ('hh:5', 'محل مغلق'), ('hh:6', '123'), ('hh:7', None)])
        db.execute(f"copy t to '{self.tmp / 'targets.parquet'}' (format parquet)")
        tax = {'subs': [{'sub_id': 'food.bakery', 'main_ar': 'أغذية ومشروبات'},
                        {'sub_id': 'beauty.barber', 'main_ar': 'تجميل وعناية شخصية'}]}
        (self.tmp / 'tax.json').write_text(json.dumps(tax, ensure_ascii=False), encoding='utf-8')

    def run_cli(self, out, extra=()):
        return subprocess.run([sys.executable, str(HERE / 'classify_poi.py'),
                               '--labels', str(self.tmp / 'labels.parquet'), '--targets', str(self.tmp / 'targets.parquet'),
                               '--taxonomy', str(self.tmp / 'tax.json'), '--out', str(out), *extra],
                              capture_output=True, text=True)

    def test_scores_both_levels_and_gates_by_confidence(self):
        out = self.tmp / 'est.parquet'
        r = self.run_cli(out, ('--main-min', '0.0', '--sub-min', '0.0'))
        self.assertEqual(r.returncode, 0, r.stderr)
        cols = {c[0] for c in duckdb.sql(f"describe select * from read_parquet('{out}')").fetchall()}
        self.assertEqual(cols, {'poi_key', 'cls_main_estimate', 'cls_main_confidence', 'cls_sub_estimate',
                                'cls_sub_confidence', 'cls_estimate_source'})
        got = {k: (m, s) for k, m, s in duckdb.sql(
            f"select poi_key, cls_main_estimate, cls_sub_estimate from read_parquet('{out}') order by poi_key").fetchall()}
        self.assertEqual(got['hh:1'], ('أغذية ومشروبات', 'food.bakery'), 'a bakery name lands in the food main and bakery sub')
        self.assertEqual(got['hh:2'], ('تجميل وعناية شخصية', 'beauty.barber'))
        conf = duckdb.sql(f"select min(cls_main_confidence), max(cls_main_confidence) from read_parquet('{out}')").fetchone()
        self.assertTrue(0.0 <= conf[0] and conf[1] <= 1.0)
        src = duckdb.sql(f"select distinct cls_estimate_source from read_parquet('{out}')").fetchall()
        self.assertEqual(src, [('model_name_tfidf',)], 'every row is flagged as a model estimate')
        # a kept sub is always consistent with its main: no row carries a sub whose parent differs from the main
        bad = duckdb.sql(f"""select count(*) from read_parquet('{out}')
            where cls_sub_estimate is not null and cls_main_estimate is null""").fetchone()[0]
        self.assertEqual(bad, 0, 'a sub is never written without its parent main')
        # cls_main_confidence describes the emitted main: for hh:1 (bakery) it is the main model's P(food main)
        c1 = duckdb.sql(f"select cls_main_confidence from read_parquet('{out}') where poi_key = 'hh:1'").fetchone()[0]
        self.assertTrue(0.0 <= c1 <= 1.0)

    def test_no_main_is_emitted_below_its_gate(self):
        out = self.tmp / 'est_gate.parquet'
        self.assertEqual(self.run_cli(out, ('--main-min', '0.5', '--sub-min', '0.0')).returncode, 0)
        # a kept sub forces its parent main, which must itself clear the main gate — so no emitted main is below it
        low = duckdb.sql(f"""select count(*) from read_parquet('{out}')
            where cls_main_estimate is not null and cls_main_confidence < 0.5""").fetchone()[0]
        self.assertEqual(low, 0, 'the main gate holds even when the main is a kept sub\'s parent')

    def test_a_high_gate_keeps_nothing_rather_than_guessing(self):
        out = self.tmp / 'est_hi.parquet'
        r = self.run_cli(out, ('--main-min', '1.01', '--sub-min', '1.01'))
        self.assertEqual(r.returncode, 0, r.stderr)
        kept = duckdb.sql(f"select count(cls_main_estimate), count(cls_sub_estimate) from read_parquet('{out}')").fetchone()
        self.assertEqual(kept, (0, 0), 'above the gate everything is left unclassified, never guessed')
        # the schema stays string even when every estimate is gated out (not an inferred null column)
        types = dict(duckdb.sql(f"select column_name, column_type from (describe select * from read_parquet('{out}'))").fetchall())
        self.assertEqual((types['cls_main_estimate'], types['cls_sub_estimate']), ('VARCHAR', 'VARCHAR'))
        # the confidence is still recorded even when the label is dropped
        self.assertEqual(duckdb.sql(f"select count(cls_main_confidence) from read_parquet('{out}')").fetchone()[0], 3)

    def test_a_name_that_says_nothing_is_not_scored(self):
        out = self.tmp / 'est_blank.parquet'
        self.assertEqual(self.run_cli(out, ('--main-min', '0.0', '--sub-min', '0.0')).returncode, 0)
        got = duckdb.sql(f"""select poi_key, cls_main_estimate, cls_main_confidence, cls_sub_estimate
            from read_parquet('{out}') where poi_key in ('hh:4', 'hh:5', 'hh:6', 'hh:7') order by poi_key""").fetchall()
        # «False», «محل مغلق», digits and no name: no category and no confidence, even with the gates at zero
        self.assertEqual(got, [(k, None, None, None) for k in ('hh:4', 'hh:5', 'hh:6', 'hh:7')])
        report = json.loads((self.tmp / 'est_blank.report.json').read_text(encoding='utf-8'))
        self.assertEqual((report['scored'], report['skipped_non_descriptive']), (3, 4))

    def test_refuses_to_overwrite_an_input_or_an_existing_file(self):
        self.assertNotEqual(self.run_cli(self.tmp / 'labels.parquet').returncode, 0, 'never writes over an input')
        out = self.tmp / 'est.parquet'
        self.assertEqual(self.run_cli(out, ('--main-min', '0.0')).returncode, 0)
        self.assertNotEqual(self.run_cli(out).returncode, 0, 'never writes over an existing file')
        report = json.loads((self.tmp / 'est.report.json').read_text(encoding='utf-8'))
        self.assertEqual(report['scored'], 3)
        self.assertEqual(report['gates'], {'main_min': 0.0, 'sub_min': 0.80})


if __name__ == '__main__':
    unittest.main()
