"""Classification merge and contractor family on synthetic rows:
python3 -m unittest test_merge_classification (from services/data-cleaning)."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from contract_family import Tagger  # noqa: E402

ONTO = {
    'version': 'test-v1',
    # MEP vetoes paint-only suppliers; the tiles family lifts that veto for itself
    'sectors': {'MEP': {'hard_conflicts': ['paint_only_supplier']}, 'SAFETY': {'negative_terms': ['خرسانه']}},
    'families': [
        {'id': 'hvac_equipment', 'label_ar': 'تكييف', 'sector': 'MEP', 'strong_terms': ['تكييف', 'air conditioning']},
        {'id': 'structural_steel', 'label_ar': 'حديد إنشائي', 'sector': 'METALS', 'strong_terms': ['قطاع'],
         'context_terms': ['steel', 'حديد'],
         'intents': [{'id': 'gi_coil', 'strong_terms': ['لفه صاج']}],
         'categories': [{'id': 'sections', 'strong_terms': ['steel section'],
                         'intents': [{'id': 'cold', 'strong_terms': ['cold formed section', 'مرازب'],
                                      'term_guards': [{'terms': ['مرازب'], 'block_any': ['خشب']}]}]}],
         'term_guards': [{'terms': ['قطاع'], 'require_any': ['حديد'], 'block_any': ['جبس']}]},
        {'id': 'sanitary_ware', 'label_ar': 'أدوات صحية', 'sector': 'MEP', 'strong_terms': ['مغاسل'],
         'negative_terms': ['سيارات'], 'preferred_archetypes': ['sanitary_ware_supplier']},
        {'id': 'paints', 'label_ar': 'دهانات', 'sector': 'FIN', 'strong_terms': ['دهانات'],
         'preferred_archetypes': ['paint_only_supplier'], 'hard_conflicts': ['sanitary_ware_supplier']},
        {'id': 'tiles', 'label_ar': 'بلاط', 'sector': 'MEP', 'strong_terms': ['بلاط'],
         'term_guards': [{'terms': ['بلاط'], 'block_any': ['سيراميك صحي'], 'blocked_by_head': ['لاصق', 'عزل']}],
         'preferred_archetypes': ['tile_supplier'], 'hard_conflict_exceptions': ['paint_only_supplier']},
        {'id': 'ict', 'label_ar': 'شبكات', 'sector': 'ICT', 'strong_terms': ['الن']},
        {'id': 'first_aid', 'label_ar': 'إسعافات', 'sector': 'SAFETY', 'strong_terms': ['دش طوارئ']},
        {'id': 'fire', 'label_ar': 'إطفاء', 'sector': 'SAFETY', 'strong_terms': ['نظام اطفاء']},
        {'id': 'lab_fitout', 'label_ar': 'مختبرات', 'sector': 'LAB', 'strong_terms': ['دش طوارئ', 'مختبرات']},
    ],
}


class TaggerTests(unittest.TestCase):
    def setUp(self):
        self.t = Tagger(ONTO)

    def fam(self, name):
        f, status, _ = self.t.tag(name)
        return (f and f['id']), status

    def test_strong_term_with_proclitic_and_phrase(self):
        self.assertEqual(self.fam('مؤسسة النور للتكييف'), ('hvac_equipment', 'strong_term'))
        self.assertEqual(self.fam('Gulf Air Conditioning Co'), ('hvac_equipment', 'strong_term'))
        self.assertEqual(self.fam('مؤسسة بنظام اطفاء'), ('fire', 'strong_term'), 'a proclitic on a phrase\'s first word')

    def test_no_substring_match(self):
        self.assertEqual(self.fam('مقاولات النابغة'), (None, 'no_strong_term'), 'a short term never matches inside a word')

    def test_guard_needs_its_evidence(self):
        self.assertEqual(self.fam('قطاع حديد الرياض'), ('structural_steel', 'strong_term'))
        self.assertEqual(self.fam('قطاع الخليج'), (None, 'guarded_out'), 'a guarded term alone does not decide')
        self.assertEqual(self.fam('قطاع حديد جبس'), (None, 'guarded_out'), 'a block word drops the match')

    def test_negative_term_and_hard_conflict(self):
        self.assertEqual(self.fam('مغاسل سيارات توب'), (None, 'guarded_out'), 'a car wash is not sanitary ware')
        self.assertEqual(self.fam('مغاسل ودهانات'), (None, 'ambiguous_conflict'),
                         'each vetoes the archetype the other prefers (family and inherited sector vetoes)')
        self.assertEqual(self.fam('دهانات وبلاط'), ('paints', 'strong_term'),
                         'a sector veto lifted by the family\'s own exception is no conflict')

    def test_guard_without_require_only_blocks(self):
        self.assertEqual(self.fam('مؤسسة بلاط الشرق'), ('tiles', 'strong_term'), 'no require_any: the term decides')
        self.assertEqual(self.fam('بلاط سيراميك صحي'), (None, 'guarded_out'))

    def test_descendant_terms_name_the_family(self):
        self.assertEqual(self.fam('Gulf Cold Formed Section Steel'), ('structural_steel', 'strong_term'))
        self.assertEqual(self.fam('مصنع مرازب حديد'), ('structural_steel', 'strong_term'))
        self.assertEqual(self.fam('مرازب حديد خشب'), (None, 'guarded_out'), 'an intent\'s own guard applies to its term')
        self.assertEqual(self.fam('مرازب الرياض'), (None, 'guarded_out'), 'below the family a term needs its context')
        self.assertEqual(self.fam('مؤسسة لفه صاج حديد'), ('structural_steel', 'strong_term'), 'a direct family intent')

    def test_blocked_by_head(self):
        self.assertEqual(self.fam('شركة لاصق بلاط'), (None, 'guarded_out'), 'an adhesive for tiles is not tiles')
        self.assertEqual(self.fam('شركة عزل ارضيات وبلاط'), (None, 'guarded_out'))
        self.assertEqual(self.fam('بلاط ولاصق'), ('tiles', 'strong_term'), 'a head word after the term does not block it')

    def test_shared_term_is_ambiguous(self):
        self.assertEqual(self.fam('مؤسسة دش طوارئ'), (None, 'ambiguous_shared_term'))
        self.assertEqual(self.fam('دش طوارئ مختبرات'), ('lab_fitout', 'strong_term'), 'more evidence tells them apart')
        self.assertEqual(self.fam('تكييف ومغاسل'), (None, 'ambiguous_shared_term'),
                         'equally long evidence for two families is a tie, not a pick by ontology order')
        self.assertEqual(self.fam('مقاولات عامة'), (None, 'no_strong_term'))
        self.assertEqual(self.fam('نظام اطفاء وخرسانه'), (None, 'guarded_out'), 'a sector\'s negative term is inherited')


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute('create table t(poi_key varchar, name_ar varchar, name_en varchar, sub_id varchar, cls_confidence varchar, '
                   'description_ar varchar)')
        db.executemany('insert into t values (?, ?, ?, ?, ?, null)', [
            ('a', 'مخبز الصباح', None, 'food.bakery', 'high'),           # directory wins, model agrees
            ('b', 'مخبز الحي', None, 'food.bakery', 'medium'),           # directory wins, model disagrees -> review
            ('c', 'حلاق النخبة', None, 'unc.unknown', 'low'),            # model fills the sub
            ('d', 'مؤسسة الريان', None, None, None),                     # model main only
            ('e', 'False', 'null', None, None),                          # broken name: no estimate
            ('f', 'محل مغلق', None, 'food.grocery', 'high'),             # vacant: stays «شاغر»
            ('g', 'مؤسسة التبريد للتكييف', None, 'contract.hvac', 'high'),
            ('h', 'مقاولات النابغة', None, 'contract.general', 'medium'),
            ('j', 'صالون الأناقة', None, 'food.grocery', 'medium'),       # medium, the model names another main at 0.9
            ('k', 'مخبز الشروق', None, 'food.bakery', 'low'),            # low, the model gives the same sub
            ('l', 'مخبز الغروب', None, 'food.bakery', 'low'),            # low, the model gives the same main only
            ('m', 'مؤسسة البيان', None, 'food.bakery', 'low'),           # low, the model does not agree: dropped
            ('n', 'False', None, 'food.bakery', 'low'),                  # a broken name confirms nothing
            ('p', 'null', None, 'food.grocery', 'medium'),               # nor overrides anything
        ])
        # no usable name, but a descriptive description the classifier also reads: its estimate is kept
        db.execute("insert into t values ('i', 'NULL', 'False', null, null, 'مخبز ومعجنات طازجة')")
        db.execute(f"copy t to '{self.tmp / 'targets.parquet'}' (format parquet)")
        db.execute('create table e(poi_key varchar, cls_main_estimate varchar, cls_main_confidence double, '
                   'cls_sub_estimate varchar, cls_sub_confidence double, cls_estimate_source varchar)')
        db.executemany("insert into e values (?, ?, ?, ?, ?, 'model_name_tfidf')", [
            ('a', 'أغذية ومشروبات', 0.9, 'food.bakery', 0.9), ('b', 'أغذية ومشروبات', 0.9, 'food.sweets', 0.85),
            ('c', 'تجميل وعناية شخصية', 0.95, 'beauty.barber', 0.9), ('d', 'خدمات أعمال ومهنية', 0.7, None, None),
            ('e', 'أغذية ومشروبات', 0.97, 'food.restaurant', 0.9), ('f', 'أغذية ومشروبات', 0.7, 'food.grocery', 0.8),
            ('i', 'أغذية ومشروبات', 0.9, 'food.bakery', 0.85),
            ('j', 'تجميل وعناية شخصية', 0.9, 'beauty.barber', 0.85), ('k', 'أغذية ومشروبات', 0.9, 'food.bakery', 0.85),
            ('l', 'أغذية ومشروبات', 0.7, None, 0.4), ('m', 'خدمات أعمال ومهنية', 0.65, None, 0.3),
            ('n', 'أغذية ومشروبات', 0.9, 'food.bakery', 0.9), ('p', 'تجميل وعناية شخصية', 0.95, 'beauty.barber', 0.9)])
        db.execute(f"copy e to '{self.tmp / 'est.parquet'}' (format parquet)")
        db.execute("create table v as select 'f' poi_key, 'vacant' AS source union all select 'a', 'activity'")
        db.execute(f"copy v to '{self.tmp / 'vac.parquet'}' (format parquet)")
        tax = {'subs': [{'sub_id': s, 'main_ar': m} for s, m in (
            ('food.bakery', 'أغذية ومشروبات'), ('food.sweets', 'أغذية ومشروبات'), ('food.grocery', 'أغذية ومشروبات'),
            ('beauty.barber', 'تجميل وعناية شخصية'), ('contract.hvac', 'مقاولات وخدمات إنشائية'),
            ('contract.general', 'مقاولات وخدمات إنشائية'))]}
        (self.tmp / 'tax.json').write_text(json.dumps(tax, ensure_ascii=False), encoding='utf-8')
        (self.tmp / 'onto.json').write_text(json.dumps(ONTO, ensure_ascii=False), encoding='utf-8')

    def merge(self, out):
        return subprocess.run([sys.executable, str(HERE / 'merge_classification.py'), '--targets', str(self.tmp / 'targets.parquet'),
                               '--estimates', str(self.tmp / 'est.parquet'), '--taxonomy', str(self.tmp / 'tax.json'),
                               '--vacancy', str(self.tmp / 'vac.parquet'), '--out', str(out)], capture_output=True, text=True)

    def test_merge_order_and_flags(self):
        out = self.tmp / 'merged.parquet'
        r = self.merge(out)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = {k: v for k, *v in duckdb.sql(f"""select poi_key, final_sub, final_main, final_source, needs_review, invalid_name
                                               from read_parquet('{out}')""").fetchall()}
        self.assertEqual(got['a'], ['food.bakery', 'أغذية ومشروبات', 'directory_high', False, False])
        self.assertEqual(got['b'], ['food.bakery', 'أغذية ومشروبات', 'directory_medium', True, False],
                         'the directory sub is kept when the model disagrees, and the row is flagged')
        self.assertEqual(got['c'], ['beauty.barber', 'تجميل وعناية شخصية', 'model_estimate', False, False])
        self.assertEqual(got['d'], [None, 'خدمات أعمال ومهنية', 'model_estimate_main_only', False, False])
        self.assertEqual(got['e'], [None, None, 'none', False, True], 'a broken name takes no estimate')
        self.assertEqual(got['f'], [None, None, 'vacant', False, True], 'a vacant unit stays «شاغر», and its name says nothing')
        self.assertEqual(got['i'], ['food.bakery', 'أغذية ومشروبات', 'model_estimate', False, False],
                         'an estimate read from the description is kept even when both names are placeholders')
        self.assertEqual(got['j'], ['beauty.barber', 'تجميل وعناية شخصية', 'model_estimate', True, False],
                         'a medium sub the model contradicts at 0.80+ gives way to the model, and is flagged')
        self.assertEqual(got['k'], ['food.bakery', 'أغذية ومشروبات', 'directory_low_confirmed', False, False],
                         'a low sub the model repeats is kept')
        self.assertEqual(got['l'], [None, 'أغذية ومشروبات', 'directory_low_main_confirmed', False, False],
                         'a low sub whose main the model repeats keeps that main only')
        self.assertEqual(got['m'], [None, 'خدمات أعمال ومهنية', 'model_estimate_main_only', False, False],
                         'a low sub the model does not repeat is not shown')
        self.assertEqual(got['n'], [None, None, 'none', False, True], 'an estimate for a broken name confirms nothing')
        self.assertEqual(got['p'], ['food.grocery', 'أغذية ومشروبات', 'directory_medium', False, True],
                         'an estimate for a broken name never overrides the directory')
        rep = json.loads((self.tmp / 'merged.report.json').read_text(encoding='utf-8'))
        self.assertEqual((rep['rows'], rep['model_added_sub'], rep['needs_review'], rep['vacant_kept'], rep['overridden']),
                         (15, 3, 2, 1, 1))
        sample = duckdb.sql(f"select bucket, count(*) from read_csv('{self.tmp / 'merged_review_sample.csv'}') group by 1").fetchall()
        self.assertEqual(dict(sample), {'model_added': 3, 'needs_review': 2, 'invalid_name': 4},
                         'every bucket is sampled from its own rows')
        self.assertNotEqual(self.merge(out).returncode, 0, 'an existing output is never overwritten')

    def test_agreement_reads_the_ungated_top_main(self):
        # the estimate's display gate (0.95 here) hid the main, but the top main still confirms a low row and overrides
        # a medium one at the merge's own thresholds
        db = duckdb.connect()
        db.execute("create table e2 as select *, cls_main_estimate cls_main_top, cls_main_confidence cls_main_top_confidence "
                   f"from read_parquet('{self.tmp / 'est.parquet'}')")
        db.execute("update e2 set cls_main_estimate = null, cls_sub_estimate = null where cls_main_confidence < 0.95")
        db.execute(f"copy e2 to '{self.tmp / 'est_top.parquet'}' (format parquet)")
        out = self.tmp / 'merged_top.parquet'
        r = subprocess.run([sys.executable, str(HERE / 'merge_classification.py'), '--targets', str(self.tmp / 'targets.parquet'),
                            '--estimates', str(self.tmp / 'est_top.parquet'), '--taxonomy', str(self.tmp / 'tax.json'),
                            '--vacancy', str(self.tmp / 'vac.parquet'), '--out', str(out)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = {k: v for k, *v in duckdb.sql(f"select poi_key, final_main, final_source from read_parquet('{out}')").fetchall()}
        self.assertEqual(got['l'], ['أغذية ومشروبات', 'directory_low_main_confirmed'], 'a top main at 0.7 confirms')
        self.assertEqual(got['j'], ['أغذية ومشروبات', 'directory_medium'],
                         'with no gated estimate to replace it, a contradicted medium label is kept, not dropped')

    def test_an_english_only_name_needs_the_stricter_gates(self):
        # the same agreement that confirms or overrides an Arabic-named place is not enough when the model read an
        # English name alone; a place with an Arabic name too keeps the ordinary gates
        db = duckdb.connect()
        db.execute('create table t(poi_key varchar, name_ar varchar, name_en varchar, sub_id varchar, cls_confidence varchar, '
                   'description_ar varchar)')
        db.executemany('insert into t values (?, ?, ?, ?, ?, null)', [
            ('q', None, 'Elegance Salon', 'food.grocery', 'medium'),   # model contradicts at 0.85: below 0.90, kept
            ('r', None, 'Sunrise Bakery', 'food.bakery', 'low'),       # model agrees at 0.7: below 0.80, not confirmed
            ('s', None, 'Sunset Bakery', 'food.bakery', 'low'),        # model agrees at 0.85: confirmed
            ('u', 'مخبز الفجر', 'Dawn Bakery', 'food.bakery', 'low'),  # Arabic too: 0.7 confirms
            ('w', None, 'Oasis Salon', 'food.grocery', 'medium')])     # model contradicts at 0.95: overridden
        db.execute(f"copy t to '{self.tmp / 'en_targets.parquet'}' (format parquet)")
        db.execute('create table e(poi_key varchar, cls_main_estimate varchar, cls_main_confidence double, '
                   'cls_sub_estimate varchar, cls_sub_confidence double, cls_estimate_source varchar)')
        db.executemany("insert into e values (?, ?, ?, null, 0.3, 'model_name_tfidf')", [
            ('q', 'تجميل وعناية شخصية', 0.85), ('r', 'أغذية ومشروبات', 0.7), ('s', 'أغذية ومشروبات', 0.85),
            ('u', 'أغذية ومشروبات', 0.7), ('w', 'تجميل وعناية شخصية', 0.95)])
        db.execute(f"copy e to '{self.tmp / 'en_est.parquet'}' (format parquet)")
        out = self.tmp / 'merged_en.parquet'
        r = subprocess.run([sys.executable, str(HERE / 'merge_classification.py'), '--targets', str(self.tmp / 'en_targets.parquet'),
                            '--estimates', str(self.tmp / 'en_est.parquet'), '--taxonomy', str(self.tmp / 'tax.json'),
                            '--out', str(out)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = dict(duckdb.sql(f"select poi_key, final_source from read_parquet('{out}')").fetchall())
        self.assertEqual(got, {'q': 'directory_medium', 'r': 'model_estimate_main_only', 's': 'directory_low_main_confirmed',
                               'u': 'directory_low_main_confirmed', 'w': 'model_estimate_main_only'})
        self.assertEqual(json.loads((self.tmp / 'merged_en.report.json').read_text(encoding='utf-8'))['english_only'], 4)

    def test_family_only_for_contractors(self):
        merged = self.tmp / 'merged.parquet'
        self.assertEqual(self.merge(merged).returncode, 0)
        out = self.tmp / 'fam.parquet'
        r = subprocess.run([sys.executable, str(HERE / 'contract_family.py'), '--merged', str(merged),
                            '--ontology', str(self.tmp / 'onto.json'), '--out', str(out)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = {k: v for k, *v in duckdb.sql(f"""select poi_key, family_id, family_source, family_status
                                               from read_parquet('{out}')""").fetchall()}
        self.assertEqual(set(got), {'g', 'h'}, 'only contract.* rows are read')
        self.assertEqual(got['g'], ['hvac_equipment', 'procurement_ontology:test-v1', 'strong_term'])
        self.assertEqual(got['h'], [None, None, 'no_strong_term'])
        rep = json.loads((self.tmp / 'fam.report.json').read_text(encoding='utf-8'))
        self.assertEqual((rep['ontology_version'], rep['contract_rows'], rep['tagged']), ('test-v1', 2, 1))


if __name__ == '__main__':
    unittest.main()
