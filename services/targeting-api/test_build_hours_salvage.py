"""Tests for build_hours_salvage — the day-name-leak hours corrector.

All fixtures are real-shaped samples taken from the corrupted ``working_hours``
strings in the base targets table (narrow no-break space U+202F included).
"""
import json
import unittest

from build_hours_salvage import (
    correct_hours_text,
    has_day_leak,
    salvage_row,
    SALVAGE_SOURCE,
)


class TestDayLeakDetection(unittest.TestCase):
    def test_detects_single_digit_leak(self):
        self.assertTrue(has_day_leak("Sun: 9:30 AM–Wed:30 PM"))

    def test_detects_two_digit_leak(self):
        # "1Sun:59" == 11:59  (ones digit clobbered, leading 1 survives)
        self.assertTrue(has_day_leak("Sun: 8 AM–1Sun:59 PM"))

    def test_clean_label_is_not_a_leak(self):
        # real day labels are "Day: " (colon + space), never "Day:" + digit
        self.assertFalse(has_day_leak("Sun: 9:00 AM–5:00 PM; Fri: Closed"))

    def test_plain_empty_is_not_a_leak(self):
        self.assertFalse(has_day_leak("- | - | - | - | - | - | -"))
        self.assertFalse(has_day_leak(""))
        self.assertFalse(has_day_leak(None))


class TestCorrector(unittest.TestCase):
    def test_single_digit_each_day_maps_one_based(self):
        # Sun->1 Mon->2 Tue->3 Wed->4 Thu->5 Fri->6 Sat->7
        self.assertEqual(correct_hours_text("x–Sun:30 PM"), "x–1:30 PM")
        self.assertEqual(correct_hours_text("x–Mon:30 PM"), "x–2:30 PM")
        self.assertEqual(correct_hours_text("x–Tue:30 PM"), "x–3:30 PM")
        self.assertEqual(correct_hours_text("x–Wed:30 PM"), "x–4:30 PM")
        self.assertEqual(correct_hours_text("x–Thu:30 PM"), "x–5:30 PM")
        self.assertEqual(correct_hours_text("x–Fri:30 PM"), "x–6:30 PM")
        self.assertEqual(correct_hours_text("x–Sat:30 PM"), "x–7:30 PM")

    def test_two_digit_hour_keeps_leading_one(self):
        self.assertEqual(correct_hours_text("1Sun:59"), "11:59")
        self.assertEqual(correct_hours_text("1Mon:30"), "12:30")

    def test_label_is_preserved_only_hour_fixed(self):
        src = "Sun: 9:30 AM–Wed:30 PM"
        self.assertEqual(correct_hours_text(src), "Sun: 9:30 AM–4:30 PM")

    def test_both_endpoints_leaked(self):
        src = "Sun: Tue:30–Fri:30 PM"
        self.assertEqual(correct_hours_text(src), "Sun: 3:30–6:30 PM")

    def test_no_leak_only_whitespace_normalised(self):
        self.assertEqual(correct_hours_text("9:00 AM"), "9:00 AM")


class TestSalvageRow(unittest.TestCase):
    def test_full_week_recovers_and_stamps_source(self):
        src = ("Sun: 8 AM–Thu:30 PM; Mon: 8 AM–Thu:30 PM; "
               "Tue: 8 AM–Thu:30 PM; Wed: 8 AM–Thu:30 PM; "
               "Thu: 8 AM–Thu:30 PM; Fri: Closed; Sat: 8 AM–Thu:30 PM")
        res = salvage_row({"working_hours": src})
        self.assertIsNotNone(res)
        self.assertEqual(res["hours_source"], SALVAGE_SOURCE)
        week = json.loads(res["hours_week"])
        # Thu -> 5 : "8 AM – 5:30 PM"
        self.assertEqual(week["sun"], [["08:00", "17:30"]])
        self.assertEqual(week["fri"], [])          # Closed stays closed
        self.assertFalse(res["is_24h"])

    def test_split_shift_and_overnight(self):
        src = ("Sun: 9–1Sun:30 AM, 1Mon:30–6 PM; "
               "Mon: 9–1Sun:30 AM, 1Mon:30–6 PM; Fri: Closed")
        res = salvage_row({"working_hours": src})
        self.assertIsNotNone(res)
        week = json.loads(res["hours_week"])
        # 9–11:30 AM, 12:30–6 PM
        self.assertEqual(week["sun"], [["09:00", "11:30"], ["12:30", "18:00"]])

    def test_overnight_wraps(self):
        # "8 AM–1Mon:10 AM" == 08:00 -> 12:10 AM  (next day, end <= start)
        src = "Sun: 8 AM–1Mon:10 AM; Mon: 8 AM–1Mon:10 AM"
        res = salvage_row({"working_hours": src})
        week = json.loads(res["hours_week"])
        self.assertEqual(week["sun"], [["08:00", "00:10"]])

    def test_row_without_leak_returns_none(self):
        self.assertIsNone(salvage_row({"working_hours": "Sun: 9:00 AM–5:00 PM"}))
        self.assertIsNone(salvage_row({"working_hours": "- | - | - | - | - | - | -"}))
        self.assertIsNone(salvage_row({"working_hours": None}))

    def test_unparseable_after_correction_returns_none(self):
        # leak signature present but nothing time-like around it -> no recovery
        self.assertIsNone(salvage_row({"working_hours": "note Sun:30 note"}))


if __name__ == "__main__":
    unittest.main()
