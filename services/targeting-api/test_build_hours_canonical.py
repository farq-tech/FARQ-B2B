"""Tests for build_hours_canonical: parsing the four hours schemas and open_now.

open_now is exercised at fixed Asia/Riyadh datetimes so the results are
deterministic regardless of when the suite runs.
"""
import json
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

import build_hours_canonical as H

RIYADH = ZoneInfo("Asia/Riyadh")

# A fixed reference week in 2026:
#   2026-11-01 is a Sunday.  weekday(): Sun=6.
SUN = datetime(2026, 11, 1)   # Sunday
MON = datetime(2026, 11, 2)   # Monday
FRI = datetime(2026, 11, 6)   # Friday
SAT = datetime(2026, 11, 7)   # Saturday


class TestTimeTokens(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(H._to_min("09:00"), 540)
        self.assertEqual(H._to_min("9"), 540)
        self.assertEqual(H._to_min("00:00"), 0)
        self.assertEqual(H._to_min("24:00"), 1440)
        self.assertEqual(H._to_min("23:30"), 1410)

    def test_ampm(self):
        self.assertEqual(H._to_min("9:00a.m"), 540)
        self.assertEqual(H._to_min("12:00p.m"), 720)
        self.assertEqual(H._to_min("12:00a.m"), 0)
        self.assertEqual(H._to_min("11:00p.m"), 1380)
        self.assertEqual(H._to_min("4:30pm"), 990)

    def test_arabic_digits(self):
        self.assertEqual(H._to_min("١٢:٣٠"), 750)

    def test_unparseable(self):
        self.assertIsNone(H._to_min("abc"))
        self.assertIsNone(H._to_min("99:99"))


class TestCellParse(unittest.TestCase):
    def test_simple_range(self):
        self.assertEqual(H._parse_cell("08:00-17:00"), [["08:00", "17:00"]])

    def test_spaces(self):
        self.assertEqual(H._parse_cell("09:00 - 24:00"), [["09:00", "24:00"]])

    def test_all_day(self):
        self.assertEqual(H._parse_cell("00:00-24:00"), [["00:00", "24:00"]])

    def test_closed_markers(self):
        self.assertEqual(H._parse_cell("-"), [])
        self.assertEqual(H._parse_cell("{}"), [])
        self.assertEqual(H._parse_cell(""), [])
        self.assertEqual(H._parse_cell("Closed"), [])

    def test_no_info(self):
        # genuinely unparseable -> None (not "closed")
        self.assertIsNone(H._parse_cell("garbage text"))

    def test_split_shift_comma(self):
        self.assertEqual(
            H._parse_cell("09:00-12:00,16:00-21:00"),
            [["09:00", "12:00"], ["16:00", "21:00"]],
        )

    def test_split_shift_slash_ampm(self):
        self.assertEqual(
            H._parse_cell("9:00a.m-12:00p.m/4:00p.m-11:00p.m"),
            [["09:00", "12:00"], ["16:00", "23:00"]],
        )

    def test_end_midnight_is_2400(self):
        self.assertEqual(H._parse_cell("05:00-00:00"), [["05:00", "24:00"]])

    def test_overnight_kept(self):
        # closes next morning -> overnight, preserved as-is
        self.assertEqual(H._parse_cell("16:00-02:00"), [["16:00", "02:00"]])
        self.assertEqual(H._parse_cell("09:00-03:30"), [["09:00", "03:30"]])

    def test_overlap_merge(self):
        self.assertEqual(
            H._parse_cell("08:00-12:00,11:00-15:00"),
            [["08:00", "15:00"]],
        )


class TestWeekStringParse(unittest.TestCase):
    def test_labelled_pipe(self):
        s = ("Sun: 09:00-17:00 | Mon: 09:00-17:00 | Tue: 09:00-17:00 | "
             "Wed: 09:00-17:00 | Thu: 09:00-17:00")
        w = H.parse_week_string(s)
        self.assertEqual(w["sun"], [["09:00", "17:00"]])
        self.assertEqual(w["fri"], [])   # omitted -> closed
        self.assertEqual(w["sat"], [])

    def test_labelled_semicolon(self):
        s = "Sun: 00:00 - 24:00; Mon: 00:00 - 24:00; Sat: 00:00 - 24:00"
        w = H.parse_week_string(s)
        self.assertEqual(w["sun"], [["00:00", "24:00"]])
        self.assertEqual(w["sat"], [["00:00", "24:00"]])
        self.assertEqual(w["tue"], [])

    def test_positional(self):
        s = ("00:00 - 24:00 | 00:00 - 24:00 | 00:00 - 24:00 | 00:00 - 24:00 | "
             "00:00 - 24:00 | 00:00 - 24:00 | 00:00 - 24:00")
        w = H.parse_week_string(s)
        for d in H.DAYS:
            self.assertEqual(w[d], [["00:00", "24:00"]])

    def test_all_closed_is_none(self):
        self.assertIsNone(H.parse_week_string("- | - | - | - | - | - | -"))


class TestPerDayParse(unittest.TestCase):
    def test_perday(self):
        cells = {"sun": "08:00-17:00", "mon": "08:00-17:00", "tue": "08:00-17:00",
                 "wed": "08:00-17:00", "thu": "08:00-17:00", "fri": "", "sat": "-"}
        w = H.parse_perday(cells)
        self.assertEqual(w["sun"], [["08:00", "17:00"]])
        self.assertEqual(w["fri"], [])
        self.assertEqual(w["sat"], [])

    def test_urbi_empty_tokens(self):
        cells = {d: "{}" for d in H.DAYS}
        self.assertIsNone(H.parse_perday(cells))


class TestCanonicalSelection(unittest.TestCase):
    def test_prefers_clean(self):
        row = {
            "working_hours_clean": "Sun: 10:00-22:00 | Mon: 10:00-22:00",
            "hours_sun": "08:00-17:00", "hours_mon": "08:00-17:00",
            "working_hours": "Sun: 01:00-02:00",
        }
        for d in ["tue", "wed", "thu", "fri", "sat"]:
            row[f"hours_{d}"] = "-"
        res = H.canonical_hours(row)
        self.assertEqual(res["hours_source"], "farq_clean")
        wk = json.loads(res["hours_week"])
        self.assertEqual(wk["sun"], [["10:00", "22:00"]])

    def test_falls_back_to_perday(self):
        row = {d_col: None for d_col in
               ["working_hours_clean", "working_hours", "rcrc_work_hours"]}
        for d in H.DAYS:
            row[f"hours_{d}"] = "09:00-21:00"
            row[f"urbi_{d}_hours"] = None
        res = H.canonical_hours(row)
        self.assertEqual(res["hours_source"], "farq_perday")
        self.assertTrue(json.loads(res["hours_week"])["sun"], [["09:00", "21:00"]])

    def test_rcrc_last(self):
        row = {"working_hours_clean": None, "working_hours": None,
               "rcrc_work_hours": "9:00a.m-12:00p.m/4:00p.m-11:00p.m"}
        for d in H.DAYS:
            row[f"hours_{d}"] = None
            row[f"urbi_{d}_hours"] = None
        res = H.canonical_hours(row)
        self.assertEqual(res["hours_source"], "rcrc")
        self.assertEqual(res["hours_quality"], "low")
        self.assertEqual(json.loads(res["hours_week"])["sun"],
                         [["09:00", "12:00"], ["16:00", "23:00"]])

    def test_is_24h_flag(self):
        row = {"working_hours_clean":
               " | ".join(f"{lbl}: 00:00-24:00" for lbl in
                          ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])}
        res = H.canonical_hours(row)
        self.assertTrue(res["is_24h"])
        self.assertEqual(res["closed_days"], [])
        self.assertEqual(res["hours_quality"], "high")

    def test_closed_days(self):
        row = {"working_hours_clean":
               "Sun: 09:00-17:00 | Mon: 09:00-17:00 | Tue: 09:00-17:00 | "
               "Wed: 09:00-17:00 | Thu: 09:00-17:00"}
        res = H.canonical_hours(row)
        self.assertEqual(set(res["closed_days"]), {"fri", "sat"})

    def test_no_hours_returns_none(self):
        row = {k: None for k in H._SRC_COLS}
        self.assertIsNone(H.canonical_hours(row))


class TestOpenNow(unittest.TestCase):
    def _wk(self, **days):
        w = {d: [] for d in H.DAYS}
        w.update(days)
        return w

    def test_open_within(self):
        wk = self._wk(sun=[["08:00", "17:00"]])
        r = H.open_now(wk, SUN.replace(hour=10))
        self.assertTrue(r["open"])
        self.assertEqual(r["until"], "17:00")
        self.assertIsNone(r["opens_at"])

    def test_closed_before_open_same_day(self):
        wk = self._wk(sun=[["08:00", "17:00"]])
        r = H.open_now(wk, SUN.replace(hour=6))
        self.assertFalse(r["open"])
        self.assertEqual(r["opens_at"], "08:00")

    def test_closed_after_close_rolls_to_next_open_day(self):
        wk = self._wk(sun=[["08:00", "17:00"]], mon=[["09:00", "12:00"]])
        r = H.open_now(wk, SUN.replace(hour=20))
        self.assertFalse(r["open"])
        self.assertEqual(r["opens_at"], "09:00")  # Monday

    def test_split_shift_gap(self):
        wk = self._wk(sun=[["09:00", "12:00"], ["16:00", "21:00"]])
        # 13:00 -> in the gap, closed, opens_at next shift
        r = H.open_now(wk, SUN.replace(hour=13))
        self.assertFalse(r["open"])
        self.assertEqual(r["opens_at"], "16:00")
        # 17:00 -> open in second shift
        r2 = H.open_now(wk, SUN.replace(hour=17))
        self.assertTrue(r2["open"])
        self.assertEqual(r2["until"], "21:00")

    def test_24h(self):
        wk = self._wk(**{d: [["00:00", "24:00"]] for d in H.DAYS})
        r = H.open_now(wk, SUN.replace(hour=3, minute=15))
        self.assertTrue(r["open"])
        self.assertEqual(r["until"], "24:00")

    def test_overnight_after_midnight_from_prev_day(self):
        # Saturday 16:00 -> 02:00 (closes Sunday 02:00)
        wk = self._wk(sat=[["16:00", "02:00"]])
        # Sunday 01:00 -> still open from Saturday's overnight interval
        r = H.open_now(wk, SUN.replace(hour=1))
        self.assertTrue(r["open"])
        self.assertEqual(r["until"], "02:00")
        # Sunday 03:00 -> closed
        r2 = H.open_now(wk, SUN.replace(hour=3))
        self.assertFalse(r2["open"])

    def test_overnight_same_day_evening(self):
        wk = self._wk(sat=[["16:00", "02:00"]])
        r = H.open_now(wk, SAT.replace(hour=20))
        self.assertTrue(r["open"])
        self.assertEqual(r["until"], "02:00")

    def test_closed_day(self):
        wk = self._wk(sun=[["08:00", "17:00"]])  # Fri/Sat closed
        r = H.open_now(wk, FRI.replace(hour=12))
        self.assertFalse(r["open"])
        self.assertEqual(r["opens_at"], "08:00")  # next open day = Sunday

    def test_json_string_input(self):
        wk = json.dumps(self._wk(mon=[["09:00", "17:00"]]))
        r = H.open_now(wk, MON.replace(hour=10))
        self.assertTrue(r["open"])

    def test_tzaware_input_converted(self):
        wk = self._wk(sun=[["08:00", "17:00"]])
        # 07:00 UTC == 10:00 Riyadh on the same Sunday
        aware = SUN.replace(hour=7, tzinfo=ZoneInfo("UTC"))
        r = H.open_now(wk, aware)
        self.assertTrue(r["open"])

    def test_fully_closed_week(self):
        wk = self._wk()
        r = H.open_now(wk, SUN.replace(hour=10))
        self.assertFalse(r["open"])
        self.assertIsNone(r["opens_at"])


if __name__ == "__main__":
    unittest.main()
