# -*- coding: utf-8 -*-
"""saudi_rhythm.py: prayer times against adhan (tests/fixtures/prayer-umalqura.json, from scripts/gen-prayer-fixture.mjs)
and the owner-approved send rule of 2026-10-16. Run from the repo root: python3 -m unittest discover -s tests/python -v"""
import json, os, sys, unittest
from datetime import date, datetime, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
import saudi_rhythm as sr  # noqa: E402

RIYADH, JEDDAH = sr.CITIES['riyadh'], sr.CITIES['jeddah']
M = lambda n: timedelta(minutes=n)
def ksa(y, mo, d, h, mi): return datetime(y, mo, d, h, mi, tzinfo=sr.KSA).astimezone(sr.UTC)


class AgainstAdhan(unittest.TestCase):
    def test_fixture_times_match_within_a_minute(self):
        with open(os.path.join(ROOT, 'tests', 'fixtures', 'prayer-umalqura.json'), encoding='utf-8') as fh: cases = json.load(fh)['cases']
        self.assertGreater(len(cases), 50)
        self.assertTrue(any(c['ramadan'] for c in cases))
        for c in cases:
            p = sr.prayer_times(date.fromisoformat(c['date']), c['lat'], c['lon'])
            self.assertEqual(p['ramadan'], c['ramadan'], c['date'])
            for k in ('fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'):
                want = datetime.fromisoformat(c[k].replace('Z', '+00:00'))
                self.assertLessEqual(abs((p[k] - want).total_seconds()), 60, f"{c['city']} {c['date']} {k}: {p[k]} vs {want}")


class Windows(unittest.TestCase):
    def test_edges(self):
        d = date(2026, 10, 15)  # Thursday
        p = sr.prayer_times(d, *RIYADH)
        for k in sr.PRAYERS:
            s = p[k]
            self.assertEqual(sr.quiet_window_at(s, *RIYADH)[0], k)
            self.assertEqual(sr.quiet_window_at(s + M(24), *RIYADH)[0], k)
            self.assertIsNone(sr.quiet_window_at(s + M(25), *RIYADH), k)
            self.assertIsNone(sr.quiet_window_at(s - M(1), *RIYADH), k)
            self.assertEqual(sr.next_allowed(s + M(3), *RIYADH), s + M(25))

    def test_friday(self):
        self.assertIsNone(sr.quiet_window_at(ksa(2026, 10, 16, 11, 29), *RIYADH))  # Riyadh Dhuhr is 11:39 that day
        for h, mi in ((11, 30), (11, 39), (13, 29)):
            self.assertEqual(sr.quiet_window_at(ksa(2026, 10, 16, h, mi), *RIYADH)[0], 'jumuah')
        self.assertIsNone(sr.quiet_window_at(ksa(2026, 10, 16, 13, 30), *RIYADH))
        b = sr.block_for_cities(['Riyadh'], ksa(2026, 10, 16, 12, 0))
        self.assertEqual((b['prayer'], b['next_allowed_ar']), ('jumuah', '1:30 م'))
        # Thursday: plain Dhuhr, no Friday window
        dh = sr.prayer_times(date(2026, 10, 15), *RIYADH)['dhuhr']
        self.assertEqual(sr.quiet_window_at(dh + M(1), *RIYADH)[0], 'dhuhr')
        self.assertIsNone(sr.quiet_window_at(ksa(2026, 10, 15, 13, 0), *RIYADH))

    def test_ramadan_isha(self):
        r = sr.prayer_times(date(2027, 2, 20), *RIYADH)  # 13 Ramadan 1448
        self.assertTrue(r['ramadan'])
        self.assertEqual(r['isha'] - r['maghrib'], M(120))
        o = sr.prayer_times(date(2027, 4, 10), *RIYADH)
        self.assertFalse(o['ramadan'])
        self.assertEqual(o['isha'] - o['maghrib'], M(90))
        self.assertTrue(sr.is_ramadan(date(2026, 2, 18)) and sr.is_ramadan(date(2026, 3, 19)))
        self.assertFalse(sr.is_ramadan(date(2026, 2, 17)) or sr.is_ramadan(date(2026, 3, 20)))
        self.assertTrue(sr.is_ramadan(date(2050, 6, 10)))  # tabular fallback outside the table

    def test_message_exact(self):
        asr = sr.prayer_times(date(2026, 10, 15), *RIYADH)['asr']  # 2:58 م
        b = sr.block_for_cities(['Riyadh'], asr + M(3))
        self.assertEqual(b, {'ok': False, 'error': 'PRAYER_WINDOW', 'prayer': 'asr',
                             'message_ar': 'الحين وقت صلاة العصر، فما أرسلنا الحملة. تقدر ترسلها من الساعة 3:23 م.',
                             'next_allowed': '2026-10-15T12:23:00.000Z', 'next_allowed_ar': '3:23 م'})
        self.assertEqual(sr.ksa_clock(ksa(2026, 1, 1, 4, 5)), '4:05 ص')
        self.assertEqual(sr.ksa_clock(ksa(2026, 1, 1, 0, 7)), '12:07 ص')
        self.assertEqual(sr.ksa_clock(ksa(2026, 1, 1, 12, 0)), '12:00 م')

    def test_cities(self):
        asr = sr.prayer_times(date(2026, 10, 15), *RIYADH)['asr']
        at = asr + M(3)
        riyadh = sr.block_for_cities(['Riyadh'], at)
        for unknown in (['Atlantis'], [None], [], None, ['']):
            self.assertEqual(sr.block_for_cities(unknown, at), riyadh, unknown)
        self.assertEqual(sr.block_for_cities(['الرياض'], at), riyadh)
        self.assertEqual(sr.city_coords('Al-Khobar'), sr.CITIES['khobar'])
        self.assertEqual(sr.city_coords('Hafr_Al_Batin'), sr.CITIES['hafar al batin'])
        self.assertEqual(sr.city_coords('مكة'), sr.CITIES['makkah'])
        # Riyadh's window is over, Jeddah's (west, later) is open: one city in a window blocks the send
        jasr = sr.prayer_times(date(2026, 10, 15), *JEDDAH)['asr']
        t = jasr + M(1)
        self.assertLessEqual(asr + M(25), t)
        self.assertIsNone(sr.block_for_cities(['Riyadh'], t))
        b = sr.block_for_cities(['Riyadh', 'Jeddah'], t)
        self.assertEqual(b['prayer'], 'asr')
        self.assertEqual(b['next_allowed'], sr._iso(jasr + M(25)))
        # both in a window: next allowed is after the later one
        b = sr.block_for_cities(['Riyadh', 'Jeddah'], max(asr, jasr))
        self.assertEqual(b['next_allowed'], sr._iso(max(asr, jasr) + M(25)))

    def test_body(self):
        asr = sr.prayer_times(date(2026, 10, 15), *RIYADH)['asr']
        body = json.dumps({'targets': [{'city': 'Jeddah'}, {'city': 'Jeddah'}]}).encode()
        jasr = sr.prayer_times(date(2026, 10, 15), *JEDDAH)['asr']
        self.assertIsNone(sr.block_for_body(body, jasr - M(1)))
        self.assertEqual(sr.block_for_body(body, jasr)['prayer'], 'asr')
        self.assertEqual(sr.block_for_body(b'not json', asr)['prayer'], 'asr')  # unreadable -> Riyadh
        self.assertEqual(sr.block_for_body(None, asr)['prayer'], 'asr')


if __name__ == '__main__':
    unittest.main()
