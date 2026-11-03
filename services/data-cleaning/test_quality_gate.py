# -*- coding: utf-8 -*-
import unittest

import quality_gate as qg


def summary(by_rule, rows_high=0):
    return {'input': 'x', 'profile': 'directory', 'total_rows': 1000, 'total_issues': 0,
            'by_severity': {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}, 'by_rule': by_rule, 'rows_with_high': rows_high,
            'rows_with_any_issue': rows_high}


class GateTests(unittest.TestCase):
    def test_placeholders_or_out_of_kingdom_fail_without_a_baseline(self):
        g = qg.decide(summary({'7_Placeholder': {'total': 3, 'LOW': 3}}))
        self.assertEqual(g['gate'], 'FAIL')
        self.assertIn('7_Placeholder', g['reasons'][0])
        g = qg.decide(summary({'10_Bbox': {'total': 1, 'HIGH': 1}}))
        self.assertEqual(g['gate'], 'FAIL')

    def test_old_coverage_gaps_pass_when_they_do_not_grow(self):
        before = qg.decide(summary({'3_Categories': {'total': 500, 'HIGH': 500}}, 500))
        now = summary({'3_Categories': {'total': 503, 'HIGH': 503}}, 503)
        g = qg.decide(now, before)
        self.assertEqual(g['gate'], 'PASS', g['reasons'])
        self.assertTrue(g['ratchet']['3_Categories']['ok'])

    def test_a_rule_that_grows_past_the_ratchet_fails(self):
        before = qg.decide(summary({'3_Categories': {'total': 10000, 'HIGH': 10000}}, 10000))
        now = summary({'3_Categories': {'total': 10300, 'HIGH': 10300}}, 10300)
        g = qg.decide(now, before, max_rise_pct=1.0)
        self.assertEqual(g['gate'], 'FAIL')
        self.assertIn('3_Categories', g['reasons'][0])

    def test_a_new_rule_absent_from_the_baseline_counts_from_zero(self):
        before = qg.decide(summary({}))
        g = qg.decide(summary({'5_Website': {'total': 5000, 'HIGH': 5000}}, 5000), before)
        self.assertEqual(g['gate'], 'FAIL')

    def test_without_a_baseline_only_absolute_rules_block(self):
        g = qg.decide(summary({'8_Mandatory': {'total': 2000000, 'HIGH': 2000000}}, 2000000))
        self.assertEqual(g['gate'], 'PASS')
        self.assertFalse(g['baseline_used'])


if __name__ == '__main__':
    unittest.main()
