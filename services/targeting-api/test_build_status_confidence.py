# -*- coding: utf-8 -*-
"""Tests for build_status_confidence: who gets upgraded, the guards, and Python/SQL agreement."""
import unittest

import build_status_confidence as bsc


class TestUpgradeRules(unittest.TestCase):
    def test_delivery_signal_upgrades_open_low(self):
        # a live delivery signal lifts an open-low verdict to medium
        self.assertEqual(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "low",
                             "delivery_eta": "30-45 min"}),
            ("medium", "delivery_signal"))
        self.assertEqual(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "low",
                             "delivery_rating": 4.3}),
            ("medium", "delivery_signal"))

    def test_multi_source_upgrades(self):
        self.assertEqual(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "low",
                             "source_count": 2}),
            ("medium", "multi_source"))
        self.assertEqual(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "medium",
                             "source_count": 5}),
            ("high", "multi_source"))

    def test_both_signals_named_but_single_notch(self):
        self.assertEqual(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "low",
                             "delivery_eta": "20 min", "source_count": 3}),
            ("medium", "delivery_signal+multi_source"))

    def test_no_signal_no_upgrade(self):
        self.assertIsNone(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "low",
                             "source_count": 1}))
        self.assertIsNone(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "low",
                             "delivery_eta": "   ", "source_count": None}))

    def test_closed_verdict_never_upgraded(self):
        # a closed/closed_permanent/inactive vote is left untouched even with strong signals
        for verdict in ("closed_permanent", "closed_temporary", "inactive"):
            self.assertIsNone(
                bsc.upgrade_row({"status_voted": verdict, "status_voted_confidence": "high",
                                 "delivery_eta": "20 min", "source_count": 9}),
                msg=verdict)

    def test_base_closed_signal_blocks_upgrade(self):
        # vote says open, but the base carries a direct closed signal -> no upgrade
        self.assertIsNone(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "low",
                             "source_count": 5, "company_status": "permanently_closed"}))
        self.assertIsNone(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "low",
                             "source_count": 5, "lifecycle_state": "closed"}))
        self.assertIsNone(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "low",
                             "delivery_rating": 4.0, "temp_closed": True}))

    def test_high_and_none_confidence_are_not_raised(self):
        self.assertIsNone(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "high",
                             "source_count": 5}))
        self.assertIsNone(
            bsc.upgrade_row({"status_voted": "open", "status_voted_confidence": "none",
                             "source_count": 5}))

    def test_upgrade_only_moves_one_rung(self):
        # the output confidence is always exactly one level above the input
        self.assertEqual(bsc.upgrade_row({"status_voted": "open",
                                          "status_voted_confidence": "low",
                                          "source_count": 2})[0], "medium")
        self.assertEqual(bsc.upgrade_row({"status_voted": "open",
                                          "status_voted_confidence": "medium",
                                          "source_count": 2})[0], "high")


class TestPythonSqlAgreement(unittest.TestCase):
    """The SQL ladder must agree with upgrade_row for every row (upgrade tuple or no row)."""

    def test_agreement(self):
        try:
            import duckdb
        except ImportError:
            self.skipTest("duckdb not installed")
        rows = [
            # eligible
            {"poi_key": "a", "status_voted": "open", "status_voted_confidence": "low",
             "delivery_eta": "30 min"},
            {"poi_key": "b", "status_voted": "open", "status_voted_confidence": "low",
             "delivery_rating": 4.1},
            {"poi_key": "c", "status_voted": "open", "status_voted_confidence": "low",
             "source_count": 2},
            {"poi_key": "d", "status_voted": "open", "status_voted_confidence": "medium",
             "source_count": 7},
            {"poi_key": "e", "status_voted": "open", "status_voted_confidence": "low",
             "delivery_eta": "15 min", "source_count": 4},
            # not eligible
            {"poi_key": "f", "status_voted": "open", "status_voted_confidence": "low",
             "source_count": 1},
            {"poi_key": "g", "status_voted": "open", "status_voted_confidence": "low",
             "delivery_eta": "   ", "source_count": None},
            {"poi_key": "h", "status_voted": "inactive", "status_voted_confidence": "low",
             "source_count": 9},
            {"poi_key": "i", "status_voted": "closed_permanent",
             "status_voted_confidence": "high", "delivery_rating": 4.0, "source_count": 9},
            {"poi_key": "j", "status_voted": "open", "status_voted_confidence": "low",
             "source_count": 9, "company_status": "permanently_closed"},
            {"poi_key": "k", "status_voted": "open", "status_voted_confidence": "low",
             "source_count": 9, "lifecycle_state": "closed"},
            {"poi_key": "l", "status_voted": "open", "status_voted_confidence": "medium",
             "delivery_rating": 3.0, "temp_closed": True},
            {"poi_key": "m", "status_voted": "open", "status_voted_confidence": "high",
             "source_count": 9},
        ]
        cols = ["poi_key", "status_voted", "status_voted_confidence", "delivery_eta",
                "delivery_rating", "source_count", "company_status", "lifecycle_state",
                "temp_closed"]
        conn = duckdb.connect()
        conn.execute(
            "create table t (poi_key varchar, status_voted varchar, "
            "status_voted_confidence varchar, delivery_eta varchar, delivery_rating double, "
            "source_count bigint, company_status varchar, lifecycle_state varchar, "
            "temp_closed boolean)")
        for r in rows:
            conn.execute("insert into t values (?,?,?,?,?,?,?,?,?)", [r.get(k) for k in cols])
        got = {
            poi_key: (up, reason)
            for poi_key, up, reason in conn.execute(
                f"select poi_key, ({bsc.UPGRADED_SQL}) up, ({bsc.REASON_SQL}) reason "
                f"from t where {bsc.ELIGIBLE_SQL}").fetchall()
        }
        conn.close()
        for r in rows:
            py = bsc.upgrade_row(r)
            sql = got.get(r["poi_key"])
            self.assertEqual(py, sql, msg=f"mismatch on {r['poi_key']}: py={py} sql={sql}")


if __name__ == "__main__":
    unittest.main()
