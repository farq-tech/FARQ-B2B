"""Evidence labels: each kind is measured on surveyed businesses and used only when it is accurate enough."""
import json
import pathlib
import tempfile
import unittest

import duckdb

import evidence_classification as ev

HERE = pathlib.Path(__file__).resolve().parent
SUBS = [
    {'main_id': 'health', 'main_ar': 'صحة', 'sub_id': 'health.pharmacy', 'sub_ar': 'صيدلية', 'match_hints': 'Pharmacy|صيدلية'},
    {'main_id': 'food', 'main_ar': 'أغذية', 'sub_id': 'food.restaurant', 'sub_ar': 'مطعم', 'match_hints': 'Restaurant|مطعم'},
    {'main_id': 'retail', 'main_ar': 'تجزئة', 'sub_id': 'retail.grocery', 'sub_ar': 'بقالة', 'match_hints': 'Grocery|بقالة'},
]
TARGETS = ('poi_key varchar, city_en varchar, name_ar varchar, phone_norm varchar, google_categories varchar, '
           'license_activity_en varchar, description_ar varchar, delivery_rating double')


def write(path, schema, rows):
    db = duckdb.connect()
    db.execute(f'create table t({schema})')
    db.executemany(f"insert into t values ({','.join('?' * len(rows[0]))})", rows)
    db.execute('copy t to ? (format parquet)', [str(path)])
    db.close()


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        (self.root / 'tax.json').write_text(json.dumps({'subs': SUBS}, ensure_ascii=False), encoding='utf-8')
        (self.root / 'xw.csv').write_text('raw_activity,raw_ar,rows,whatsapp,sub_id,sub_ar,main_id,confidence,note\n'
                                          'Pharmacy,صيدليات,1,0,health.pharmacy,صيدلية,health,high,\n'
                                          'Restaurant,مطاعم,1,0,food.restaurant,مطعم,food,high,\n', encoding='utf-8')
        targets, taxonomy = [], []
        # 10 surveyed pharmacies, each sharing its phone with one other classified pharmacy: phone evidence is right
        for i in range(10):
            phone = f'05000000{i:02d}'
            targets += [(f's{i}', 'Riyadh', 'صيدلية', phone, 'Pharmacy', None, None, None),
                        (f'o{i}', 'Riyadh', 'صيدلية', phone, None, None, None, None)]
            taxonomy += [(f's{i}', 'health.pharmacy', 'crs_surveyor', 'high'), (f'o{i}', 'health.pharmacy', 'keyword', 'medium')]
        # 10 surveyed groceries described as restaurants: description evidence is wrong for them
        for i in range(10):
            targets.append((f'g{i}', 'Riyadh', 'بقالة', None, None, None, 'مطعم وجبات', 4.0))
            taxonomy.append((f'g{i}', 'retail.grocery', 'crs_surveyor', 'high'))
        # unclassified businesses with each kind of evidence
        targets += [('u_phone', 'Riyadh', 'مؤسسة', '0500000003', None, None, None, None),
                    ('u_google', 'Riyadh', 'مؤسسة', None, 'Pharmacy', None, None, None),
                    ('u_desc', 'Riyadh', 'مؤسسة', None, None, None, 'مطعم شعبي', None),
                    ('u_none', 'Riyadh', 'محمد', None, None, None, None, None)]
        taxonomy += [('u_phone', 'unc.x', 'none', 'low'), ('u_google', 'unc.x', 'none', 'low'),
                     ('u_desc', 'unc.x', 'none', 'low'), ('u_none', 'unc.x', 'none', 'low')]
        write(self.root / 'targets.parquet', TARGETS, targets)
        write(self.root / 'tax.parquet', 'poi_key varchar, sub_id varchar, source varchar, confidence varchar', taxonomy)

    def run_build(self, **kw):
        report = ev.build(self.root / 'targets.parquet', self.root / 'tax.parquet', self.root / 'tax.json', self.root / 'xw.csv',
                          self.root / 'out', min_support=5, **kw)
        rows = duckdb.connect().execute(f"select poi_key, sub_id, main_id, ai_method from read_parquet('{self.root / 'out' / ev.OUT}') "
                                        "order by poi_key").fetchall()
        return report, {r[0]: r[1:] for r in rows}

    def test_accurate_kinds_label_and_inaccurate_ones_do_not(self):
        report, rows = self.run_build()
        self.assertEqual(report['kinds']['shared_phone']['main_accuracy'], 1.0)
        self.assertTrue(report['kinds']['shared_phone']['use_sub'])
        self.assertEqual(report['kinds']['description']['main_accuracy'], 0.0)
        self.assertFalse(report['kinds']['description']['use_main'])
        self.assertEqual(rows['u_phone'], ('health.pharmacy', 'health', 'rules:shared_phone'))
        self.assertEqual(rows['u_google'], ('health.pharmacy', 'health', 'rules:google_categories'))
        self.assertNotIn('u_desc', rows, 'a kind that fails its measurement labels nothing')
        self.assertNotIn('u_none', rows)

    def test_too_little_support_is_not_used(self):
        report, rows = self.run_build(min_accuracy=0.95)
        self.assertFalse(report['kinds']['license_activity']['use_main'], 'no surveyed business carries a licence activity')
        report = ev.build(self.root / 'targets.parquet', self.root / 'tax.parquet', self.root / 'tax.json', self.root / 'xw.csv',
                          self.root / 'out2', min_support=50)
        self.assertEqual(report['labelled'], 0)

    def test_classified_businesses_are_never_relabelled(self):
        _, rows = self.run_build()
        self.assertFalse({key for key in rows if key[0] in 'sog'})

    def test_delivery_signal_is_measured_too(self):
        report, _ = self.run_build()
        self.assertEqual(report['kinds']['delivery_signal']['surveyed_support_main'], 10)
        self.assertFalse(report['kinds']['delivery_signal']['use_main'], 'the surveyed groceries with delivery are not food')

    def test_bundled_crosswalk_matches_the_taxonomy_source(self):
        bundled = (HERE / 'reference' / 'activity_map.csv').read_bytes()
        source = (HERE.parent.parent / 'docs' / 'qa' / 'targeting' / 'taxonomy' / 'activity_map.csv').read_bytes()
        self.assertEqual(bundled, source, 'copy docs/qa/targeting/taxonomy/activity_map.csv to reference/ after editing it')


if __name__ == '__main__':
    unittest.main()
