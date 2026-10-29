"""Hours normalization on synthetic values: python3 -m unittest test_normalize_hours (from services/data-cleaning)."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from normalize_hours import normalize, shape  # noqa: E402

NNBSP = ' '


def hudhud(*days):
    return json.dumps({'timezone': 'Asia/Riyadh', 'regular_hours': [{'day': d, 'hours': [{'open': o, 'close': c}]} for d, o, c in days]})


class NormalizeTests(unittest.TestCase):
    def test_readable_values_stay_as_they_are(self):
        v = 'Sun: 08:30 - 23:30 | Mon: 08:30 - 13:00, 16:00 - 23:30'
        self.assertEqual(normalize(v), v)
        self.assertEqual(shape(v), 'readable')

    def test_hudhud_json_in_every_wrapping(self):
        self.assertEqual(normalize(hudhud(('Sunday', '08:30', '23:30'), ('Monday', '00:00', '00:00'))),
                         'Sun: 08:30 - 23:30 | Mon: 00:00 - 24:00', '00:00 - 00:00 is open all day (owner)')
        self.assertEqual(normalize('[{"day": "Friday", "hours": [{"open": "14:00", "close": "23:00\\t"}, {"open": "0:00", "close": "2:00"}]}]'),
                         'Fri: 14:00 - 23:00, 00:00 - 02:00')
        self.assertEqual(normalize("{'timezone': 'Asia/Riyadh', 'regular_hours': [{'day': 'Sunday', 'hours': [{'open': '09:00', 'close': '17:00'}]}]}"),
                         'Sun: 09:00 - 17:00', 'a Python repr is read like JSON')
        reply = json.dumps({'success': True, 'data': {'trx': {'opening_hours': "{'timezone': 'Asia/Riyadh', 'regular_hours': "
                                                                               "[{'day': 'Monday', 'hours': [{'open': '10:00', 'close': '22:00'}]}]}"}}})
        self.assertEqual(normalize(reply), 'Mon: 10:00 - 22:00')
        self.assertIsNone(normalize(json.dumps({'success': True, 'data': {'trx': {'opening_hours': None}}})))

    def test_hudhud_json_that_is_not_fully_read_stays(self):
        for v in (hudhud(('Sunday', '08:00', '08:00')),             # an equal pair other than 00:00 has no stated meaning
                  hudhud(('Sunday', '08:00', '17:00'))[:-20],       # cut off
                  hudhud(('Someday', '08:00', '17:00'))):
            self.assertEqual(normalize(v), v)

    def test_urbi(self):
        self.assertEqual(normalize('Sun: 08:00 - 24:00; Mon: {}; Tue: 9:00-17:00'), 'Sun: 08:00 - 24:00 | Tue: 09:00 - 17:00')
        self.assertEqual(normalize('Mon-Thu 9:00-23:00, break 13:00-16:00; Fri Holiday; Sat-Sun 9:00-0:00'),
                         'Mon: 09:00 - 13:00, 16:00 - 23:00 | Tue: 09:00 - 13:00, 16:00 - 23:00 | Wed: 09:00 - 13:00, 16:00 - 23:00 | '
                         'Thu: 09:00 - 13:00, 16:00 - 23:00 | Sat: 09:00 - 00:00 | Sun: 09:00 - 00:00')
        self.assertEqual(normalize('Fri-Sun Open 24 hours'), 'Fri: 00:00 - 24:00 | Sat: 00:00 - 24:00 | Sun: 00:00 - 24:00')
        self.assertEqual(normalize('Mon 9:00-1:00, break 14:00-16:00'), 'Mon: 09:00 - 14:00, 16:00 - 01:00', 'closing after midnight')
        self.assertEqual(normalize('Mon-Sun 9:00-22:00, break 23:00-23:30'), 'Mon-Sun 9:00-22:00, break 23:00-23:30', 'a break outside the day')

    def test_google(self):
        self.assertEqual(normalize(f'1: Open 24 hours|2: 9{NNBSP}AM–5{NNBSP}PM|3: 9–11{NNBSP}PM, 12{NNBSP}AM–1{NNBSP}AM|7: Closed'),
                         'Sun: 00:00 - 24:00 | Mon: 09:00 - 17:00 | Tue: 21:00 - 23:00, 00:00 - 01:00', '1 is Sunday; a closed day is left out')
        self.assertEqual(normalize(f'Sun: 11{NNBSP}AM–12{NNBSP}AM; Fri: Closed'), 'Sun: 11:00 - 00:00')
        self.assertEqual(normalize('{"الأحد": "9ص–11م, 4–9م", "الجمعة": "مغلق", "السبت": "نعمل على مدار 24 ساعة"}'),
                         'Sun: 09:00 - 23:00, 16:00 - 21:00 | Sat: 00:00 - 24:00')
        self.assertEqual(normalize('Su 09:00-23:00; Mo 16:00-00:00'), 'Sun: 09:00 - 23:00 | Mon: 16:00 - 00:00')

    def test_unread_values_stay_and_empty_ones_become_empty(self):
        for v in (f'Sun: 9{NNBSP}AM–9Sun:30{NNBSP}PM', f'1: 9{NNBSP}AM–9{NNBSP}AM', '1: Closed|2: Closed', '09:00-17:00', '24h', 'الرياض',
                  'Sun: 08:00 - 17:00; Sun: 09:00 - 17:00'):
            self.assertEqual(normalize(v), v)
        for v in ('Sun: {}; Mon: {}; Tue: {}', 'Sun:  -  | Mon:  - ', '[]', '{"timezone": "Asia/Riyadh", "regular_hours": []}',
                  'Refused to provide information', 'custom_hours', 'Asia/Riyadh', '[{"id": "1", "media_url": "https://x/y.jpeg"}]'):
            self.assertIsNone(normalize(v), v)
        for v in (None, ''):
            self.assertEqual(normalize(v), v)


class ScriptTests(unittest.TestCase):
    def test_only_working_hours_changes_and_the_input_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, out = f'{tmp}/t.parquet', f'{tmp}/t_hours.parquet'
            db = duckdb.connect()
            db.execute("create table t(poi_key varchar, name_ar varchar, working_hours varchar, sources varchar[])")
            db.executemany("insert into t values (?, ?, ?, ?)", [
                ('a', 'مقهى', hudhud(('Sunday', '08:00', '17:00')), ['crs']), ('b', 'مطعم', 'Refused to provide information', ['urbi']),
                ('c', 'محل', '24h', ['gmb']), ('d', 'صيدلية', None, None), ('e', 'مكتبة', 'Sun: 08:00 - 17:00', ['cleaned_data'])])
            db.execute(f"copy t to '{src}' (format parquet)")
            run = lambda o: subprocess.run([sys.executable, str(HERE / 'normalize_hours.py'), '--targets', src, '--out', o],
                                           capture_output=True, text=True, cwd=HERE)
            self.assertNotEqual(run(src).returncode, 0, 'refuses to overwrite its input')
            result = run(out)
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = dict(db.execute(f"select poi_key, working_hours from read_parquet('{out}')").fetchall())
            self.assertEqual(rows, {'a': 'Sun: 08:00 - 17:00', 'b': None, 'c': '24h', 'd': None, 'e': 'Sun: 08:00 - 17:00'})
            self.assertEqual(db.execute(f"select * exclude (working_hours) from read_parquet('{out}') order by poi_key").fetchall(),
                             db.execute(f"select * exclude (working_hours) from read_parquet('{src}') order by poi_key").fetchall())
            report = json.loads(pathlib.Path(f'{tmp}/t_hours.report.json').read_text(encoding='utf-8'))
            self.assertEqual(report['rows_changed_outside_working_hours'], 0)
            self.assertEqual(report['rows_rewritten'], {'hudhud_json -> readable': 1, 'no_hours_placeholder -> empty': 1})
            self.assertNotEqual(run(out).returncode, 0, 'refuses to overwrite an existing snapshot')


if __name__ == '__main__':
    unittest.main()
