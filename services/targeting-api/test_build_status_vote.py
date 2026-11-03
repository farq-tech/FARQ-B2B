# -*- coding: utf-8 -*-
"""Tests for build_status_vote: the vote priority, freshness, and Python/SQL agreement."""
import datetime
import unittest

import build_status_vote as bsv


class TestVotePriority(unittest.TestCase):
    def test_company_status_closed_wins(self):
        self.assertEqual(bsv.vote_row({"company_status": "permanently_closed"}),
                         ("closed_permanent", "company_status", "high"))
        self.assertEqual(bsv.vote_row({"company_status": "temporarily_closed"}),
                         ("closed_temporary", "company_status", "high"))

    def test_lifecycle_closed_wins(self):
        self.assertEqual(bsv.vote_row({"company_status": "unknown", "lifecycle_state": "closed"}),
                         ("closed_permanent", "company_status", "high"))

    def test_temp_closed_flag(self):
        self.assertEqual(bsv.vote_row({"company_status": "unknown", "temp_closed": True}),
                         ("closed_temporary", "temp_closed", "high"))

    def test_closed_outranks_temp_closed_and_license(self):
        # explicit permanently_closed beats a conflicting temp_closed / active license
        self.assertEqual(
            bsv.vote_row({"company_status": "permanently_closed", "temp_closed": True,
                          "license_expired": False})[0],
            "closed_permanent")

    def test_license_expired_inactive(self):
        self.assertEqual(bsv.vote_row({"license_expired": True}),
                         ("inactive", "commercial_license", "low"))

    def test_license_expired_outranks_open_signals(self):
        self.assertEqual(
            bsv.vote_row({"license_expired": True, "surveyor_verified_at": "2025-06-15 10:00:00+03",
                          "reviews_count": 50})[0],
            "inactive")

    def test_surveyor_open(self):
        self.assertEqual(bsv.vote_row({"surveyor_verified_at": "2025-06-15 23:18:40.787+03"}),
                         ("open", "surveyor", "medium"))
        # empty string is not "present"
        self.assertEqual(bsv.vote_row({"surveyor_verified_at": "   "})[0], "unknown_empty")

    def test_active_license_open(self):
        self.assertEqual(bsv.vote_row({"license_expired": False}),
                         ("open", "commercial_license", "low"))

    def test_google_signals_open(self):
        self.assertEqual(bsv.vote_row({"reviews_count": 3}), ("open", "google_signals", "low"))
        self.assertEqual(bsv.vote_row({"rating": 4.5}), ("open", "google_signals", "low"))
        self.assertEqual(bsv.vote_row({"reviews_count": 0})[0], "unknown_empty")

    def test_unknown_invalid_vs_empty(self):
        self.assertEqual(bsv.vote_row({"company_status": "unknown"}),
                         ("unknown_invalid", "company_status", "none"))
        self.assertEqual(bsv.vote_row({"company_status": None}),
                         ("unknown_empty", "none", "none"))
        self.assertEqual(bsv.vote_row({}), ("unknown_empty", "none", "none"))

    def test_vote_always_in_policy_vocabulary(self):
        vocab = {"closed_permanent", "closed_temporary", "inactive", "open",
                 "unknown_empty", "unknown_invalid"}
        for row in [{}, {"company_status": "weird value"}, {"license_expired": True},
                    {"reviews_count": 9}, {"surveyor_verified_at": "2025-01-01 00:00:00"}]:
            self.assertIn(bsv.vote_row(row)[0], vocab)


class TestFreshness(unittest.TestCase):
    def test_last_seen_from_surveyor(self):
        self.assertEqual(bsv.last_seen_at({"surveyor_verified_at": "2025-06-15 23:18:40.787+03"}),
                         datetime.date(2025, 6, 15))

    def test_last_seen_from_status_source(self):
        self.assertEqual(bsv.last_seen_at({"company_status_source": "hudhud_cr:2025-08-15"}),
                         datetime.date(2025, 8, 15))

    def test_last_seen_picks_newest(self):
        self.assertEqual(
            bsv.last_seen_at({"surveyor_verified_at": "2025-06-15 10:00:00+03",
                              "company_status_source": "hudhud_cr:2025-08-15"}),
            datetime.date(2025, 8, 15))

    def test_last_seen_none(self):
        self.assertIsNone(bsv.last_seen_at({}))
        self.assertIsNone(bsv.last_seen_at({"company_status_source": "hudhud_cr"}))

    def test_is_stale(self):
        asof = datetime.date(2026, 11, 2)
        self.assertTrue(bsv.is_stale(datetime.date(2025, 8, 15), asof))   # >365d
        self.assertFalse(bsv.is_stale(datetime.date(2026, 10, 1), asof))  # <365d
        self.assertIsNone(bsv.is_stale(None, asof))                       # unknown stays unknown


class TestPythonSqlAgreement(unittest.TestCase):
    """The SQL ladder must produce the same vote/source/confidence as vote_row for every row."""

    def test_agreement(self):
        try:
            import duckdb
        except ImportError:
            self.skipTest("duckdb not installed")
        rows = [
            {"poi_key": "a", "company_status": "permanently_closed"},
            {"poi_key": "b", "company_status": "temporarily_closed"},
            {"poi_key": "c", "company_status": "unknown", "lifecycle_state": "closed"},
            {"poi_key": "d", "company_status": "unknown", "temp_closed": True},
            {"poi_key": "e", "license_expired": True},
            {"poi_key": "f", "surveyor_verified_at": "2025-06-15 23:18:40.787+03"},
            {"poi_key": "g", "license_expired": False},
            {"poi_key": "h", "reviews_count": 5},
            {"poi_key": "i", "rating": 4.1},
            {"poi_key": "j", "company_status": "unknown"},
            {"poi_key": "k", "company_status": None},
            {"poi_key": "l", "company_status": "something odd"},
        ]
        cols = ["poi_key", "company_status", "lifecycle_state", "temp_closed",
                "license_expired", "surveyor_verified_at", "reviews_count", "rating",
                "company_status_source"]
        conn = duckdb.connect()
        conn.execute(
            "create table t (poi_key varchar, company_status varchar, lifecycle_state varchar, "
            "temp_closed boolean, license_expired boolean, surveyor_verified_at varchar, "
            "reviews_count double, rating double, company_status_source varchar)")
        for r in rows:
            conn.execute("insert into t values (?,?,?,?,?,?,?,?,?)",
                         [r.get(k) for k in cols])
        got = conn.execute(
            f"select poi_key, ({bsv.VOTE_SQL}) v, ({bsv.SOURCE_SQL}) s, "
            f"({bsv.CONFIDENCE_SQL}) c from t order by poi_key").fetchall()
        conn.close()
        by_key = {r["poi_key"]: r for r in rows}
        for poi_key, v, s, cf in got:
            self.assertEqual((v, s, cf), bsv.vote_row(by_key[poi_key]),
                             msg=f"mismatch on {poi_key}")


if __name__ == "__main__":
    unittest.main()
