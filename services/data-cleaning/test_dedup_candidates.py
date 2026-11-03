# -*- coding: utf-8 -*-
"""Tests for the additive duplicate-merge candidate builder.

Each test writes tiny targets + taxonomy parquet fixtures, runs ``build`` and reads back the
candidate delta. Distances are controlled with latitude offsets (1° lat ≈ 111_320 m); groups are
placed ~1.1 km apart so they never pair across groups.
"""
import csv
import json
import os
import tempfile
import unittest

import duckdb

import dedup_candidates as dc

LAT0, LON0 = 24.70, 46.70
M = 1.0 / 111_320.0  # degrees of latitude per metre


def _row(poi_key, lat_m=0.0, group=0, city='Riyadh', name_ar='', name_en='', phone='',
         lic='', trade_lic='', building='', floor='', gpid='', msk=None, fa=None):
    return {
        'poi_key': poi_key,
        'farq_atlas_id': fa or ('FA-' + poi_key.upper()),
        'city_en': city,
        'name_ar': name_ar, 'name_en': name_en,
        'latitude': LAT0 + group * 0.01 + lat_m * M, 'longitude': LON0,
        'phone_norm': phone, 'commercial_license': lic, 'source_trade_license': trade_lic,
        'building_no': building, 'urbi_floor': floor, 'google_place_id': gpid,
        'merged_source_poi_keys': msk if msk is not None else [poi_key],
    }


def _write_targets(path, rows):
    cols = ['poi_key', 'farq_atlas_id', 'city_en', 'name_ar', 'name_en', 'latitude', 'longitude',
            'phone_norm', 'commercial_license', 'source_trade_license', 'building_no', 'urbi_floor',
            'google_place_id', 'merged_source_poi_keys']
    db = duckdb.connect()
    db.execute("create table t(poi_key varchar, farq_atlas_id varchar, city_en varchar, name_ar varchar, "
               "name_en varchar, latitude double, longitude double, phone_norm varchar, "
               "commercial_license varchar, source_trade_license varchar, building_no varchar, "
               "urbi_floor varchar, google_place_id varchar, merged_source_poi_keys varchar[])")
    db.executemany('insert into t values (' + ','.join('?' * len(cols)) + ')',
                   [[r[c] for c in cols] for r in rows])
    db.execute(f"copy t to '{path}' (format parquet)")
    db.close()


def _write_taxonomy(path, rows):
    db = duckdb.connect()
    db.execute('create table x(poi_key varchar, sub_id varchar, confidence varchar)')
    if rows:
        db.executemany('insert into x values (?,?,?)', rows)
    db.execute(f"copy x to '{path}' (format parquet)")
    db.close()


class DedupCandidateTests(unittest.TestCase):
    def _run(self, rows, taxonomy=None, **kw):
        d = tempfile.mkdtemp()
        tg = os.path.join(d, 'targets.parquet')
        tx = os.path.join(d, 'poi_taxonomy.parquet')
        _write_targets(tg, rows)
        _write_taxonomy(tx, taxonomy or [])
        report = dc.build(tg, tx, os.path.join(d, 'out'), **kw)
        clusters = {}  # poi_key -> cluster_id
        with open(os.path.join(d, 'out', 'candidate_merge_delta.csv'), encoding='utf-8') as fh:
            for r in csv.DictReader(fh):
                clusters[r['source_poi_key']] = r['candidate_cluster_id']
        cluster_rows = []
        with open(os.path.join(d, 'out', 'candidate_clusters.csv'), encoding='utf-8') as fh:
            cluster_rows = list(csv.DictReader(fh))
        return report, clusters, cluster_rows, os.path.join(d, 'out')

    def _merged(self, clusters, a, b):
        return a in clusters and clusters.get(a) == clusters.get(b)

    # ---- Rule A: phone-anchored -------------------------------------------------------------------
    def test_rule_a_merges_shared_mobile_near_with_shared_word(self):
        rows = [_row('pa1', 0, 0, name_ar='مخابز الشهد', phone='0512345678'),
                _row('pa2', 60, 0, name_ar='مخابز الشهد الحديثه', phone='0512345678')]
        _, clusters, _, _ = self._run(rows)
        self.assertTrue(self._merged(clusters, 'pa1', 'pa2'))

    def test_rule_a_merges_when_one_name_is_empty(self):
        rows = [_row('pe1', 0, 0, name_ar='مؤسسة الوفاء', phone='0598765432'),
                _row('pe2', 30, 0, name_ar='', phone='0598765432')]
        _, clusters, _, _ = self._run(rows)
        self.assertTrue(self._merged(clusters, 'pe1', 'pe2'))

    def test_rule_a_skips_toll_free_number(self):
        # share word النور (Rule A name_ok) but different nk (so Rule B cannot catch them either)
        rows = [_row('tf1', 0, 0, name_ar='النور للعطور', phone='920012345'),
                _row('tf2', 30, 0, name_ar='النور للهدايا', phone='920012345')]
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'tf1', 'tf2'))

    def test_rule_a_skips_far_apart(self):
        rows = [_row('pf1', 0, 0, name_ar='عطور الريان', phone='0566667777'),
                _row('pf2', 120, 0, name_ar='عطور الريان', phone='0566667777')]
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'pf1', 'pf2'))

    # ---- Shared guard -----------------------------------------------------------------------------
    def test_guard_blocks_conflicting_license(self):
        rows = [_row('gl1', 0, 0, name_ar='الاتقان', phone='0523456789', lic='1010111111'),
                _row('gl2', 30, 0, name_ar='الاتقان', phone='0523456789', lic='2020222222')]
        report, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'gl1', 'gl2'))
        self.assertGreaterEqual(report['guard_blocked_total'], 1)

    def test_guard_blocks_conflicting_building_or_floor(self):
        rows = [_row('gb1', 0, 0, name_ar='مغسلة الصفا', phone='0511112222', building='12', floor='1'),
                _row('gb2', 20, 0, name_ar='مغسلة الصفا', phone='0511112222', building='12', floor='3')]
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'gb1', 'gb2'))

    def test_guard_blocks_conflicting_google_place_id(self):
        rows = [_row('gp1', 0, 0, name_ar='بيت الحلى', phone='0533334444', gpid='ChIJaaa'),
                _row('gp2', 20, 0, name_ar='بيت الحلى', phone='0533334444', gpid='ChIJbbb')]
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'gp1', 'gp2'))

    # ---- Rule B tier B1: identity-corroborated (<=40 m, shared licence/building/gpid) -------------
    def test_rule_b1_merges_rare_name_with_shared_license(self):
        rows = [_row('rb1', 0, 0, name_ar='بهارات كشمير', lic='4030111111', msk=['rb1', 'old_extra']),
                _row('rb2', 30, 0, name_ar='بهارات كشمير', lic='4030111111', msk=['rb2'])]
        _, clusters, cluster_rows, _ = self._run(rows)
        self.assertTrue(self._merged(clusters, 'rb1', 'rb2'))
        src = json.loads(cluster_rows[0]['candidate_merged_source_poi_keys'])
        self.assertEqual(set(src), {'rb1', 'rb2', 'old_extra'})  # reversible crosswalk

    def test_rule_b1_merges_rare_name_with_shared_building(self):
        rows = [_row('rd1', 0, 0, name_ar='ركن البن الملكي', building='77'),
                _row('rd2', 30, 0, name_ar='ركن البن الملكي', building='77')]
        _, clusters, _, _ = self._run(rows)
        self.assertTrue(self._merged(clusters, 'rd1', 'rd2'))

    def test_rule_b_name_only_without_corroboration_is_not_merged(self):
        # same rare distinctive name, 20 m apart, no shared licence/phone/building/gpid => held out
        rows = [_row('no1', 0, 0, name_ar='عطور دمشق الملكيه'),
                _row('no2', 20, 0, name_ar='عطور دمشق الملكيه')]
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'no1', 'no2'))

    # ---- Rule B tier B2: essentially the same point (<=6 m, long distinctive token) ---------------
    def test_rule_b2_merges_same_point_long_token(self):
        rows = [_row('sp1', 0, 0, name_ar='بهارات كشمير'),
                _row('sp2', 4, 0, name_ar='بهارات كشمير')]
        _, clusters, _, _ = self._run(rows)
        self.assertTrue(self._merged(clusters, 'sp1', 'sp2'))

    def test_rule_b2_skips_short_token_name(self):
        # <=6 m but no distinctive word >=4 chars and no corroboration => not merged
        rows = [_row('st1', 0, 0, name_ar='كيو في'), _row('st2', 4, 0, name_ar='كيو في')]
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'st1', 'st2'))

    def test_rule_b_skips_far_apart(self):
        rows = [_row('rf1', 0, 0, name_ar='عطور دمشق الملكيه', lic='4030222222'),
                _row('rf2', 60, 0, name_ar='عطور دمشق الملكيه', lic='4030222222')]  # corroborated but >40 m
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'rf1', 'rf2'))

    def test_rule_b_skips_different_city(self):
        rows = [_row('rc1', 0, 0, city='Riyadh', name_ar='مكتبة الحكمة الذهبية', lic='4030333333'),
                _row('rc2', 20, 0, city='Dammam', name_ar='مكتبة الحكمة الذهبية', lic='4030333333')]
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'rc1', 'rc2'))

    def test_rule_b_skips_generic_name(self):
        rows = [_row('gn1', 0, 0, name_ar='مطعم', lic='4030444444'),
                _row('gn2', 20, 0, name_ar='مطعم', lic='4030444444')]
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'gn1', 'gn2'))

    def test_rule_b_skips_different_branch_number(self):
        rows = [_row('br1', 0, 0, name_ar='صيدلية الدواء فرع 12', lic='4030555555'),
                _row('br2', 20, 0, name_ar='صيدلية الدواء فرع 34', lic='4030555555')]
        _, clusters, _, _ = self._run(rows)
        self.assertFalse(self._merged(clusters, 'br1', 'br2'))

    def test_rule_b_skips_non_rare_name(self):
        rows = [_row('nr1', 0, 0, name_ar='اركان الذهبيه', lic='4030666666'),
                _row('nr2', 20, 0, name_ar='اركان الذهبيه', lic='4030666666')]
        _, clusters, _, _ = self._run(rows, rare_max=1)  # freq 2 > 1 => not rare
        self.assertFalse(self._merged(clusters, 'nr1', 'nr2'))

    # ---- Subcategory compatibility, not equality --------------------------------------------------
    def test_guard_blocks_conflicting_confident_sub(self):
        rows = [_row('sc1', 0, 0, name_ar='اوركيد الجمال', building='5'),
                _row('sc2', 20, 0, name_ar='اوركيد الجمال', building='5')]  # same building => a tier, sub conflict blocks
        tax = [('sc1', 'beauty.salon', 'high'), ('sc2', 'food.restaurant', 'high')]
        _, clusters, _, _ = self._run(rows, taxonomy=tax)
        self.assertFalse(self._merged(clusters, 'sc1', 'sc2'))

    def test_missing_sub_on_one_side_is_compatible(self):
        rows = [_row('cm1', 0, 0, name_ar='لمسات راقيه للستائر', lic='4030777777'),
                _row('cm2', 20, 0, name_ar='لمسات راقيه للستائر', lic='4030777777')]
        tax = [('cm1', 'home.curtains', 'high')]  # cm2 has no taxonomy row
        _, clusters, _, _ = self._run(rows, taxonomy=tax)
        self.assertTrue(self._merged(clusters, 'cm1', 'cm2'))

    def test_low_confidence_sub_does_not_block(self):
        rows = [_row('lc1', 0, 0, name_ar='واحة الياسمين الخضراء', lic='4030888888'),
                _row('lc2', 20, 0, name_ar='واحة الياسمين الخضراء', lic='4030888888')]
        tax = [('lc1', 'a.x', 'low'), ('lc2', 'b.y', 'low')]  # low confidence => not confident => compatible
        _, clusters, _, _ = self._run(rows, taxonomy=tax)
        self.assertTrue(self._merged(clusters, 'lc1', 'lc2'))

    # ---- Connected components across both rules ---------------------------------------------------
    def test_components_unify_phone_and_name_edges(self):
        rows = [_row('cc_a', 0, 0, name_ar='ركن الاناقه', phone='0534567890'),
                _row('cc_b', 30, 0, name_ar='ركن الاناقه', phone='0534567890', lic='4031000001'),
                _row('cc_c', 45, 0, name_ar='ركن الاناقه', lic='4031000001')]  # no phone; joins cc_b by Rule B1 (shared licence)
        report, clusters, cluster_rows, _ = self._run(rows)
        self.assertTrue(self._merged(clusters, 'cc_a', 'cc_b'))
        self.assertTrue(self._merged(clusters, 'cc_b', 'cc_c'))
        self.assertEqual(len({clusters['cc_a'], clusters['cc_b'], clusters['cc_c']}), 1)
        row = [r for r in cluster_rows if r['canonical_poi_key'] in ('cc_a', 'cc_b', 'cc_c')][0]
        self.assertEqual(int(row['cluster_size']), 3)
        self.assertIn('phone_anchored', row['rules'])
        self.assertIn('rare_name', row['rules'])

    # ---- Cluster-size cap holds big clusters for review -------------------------------------------
    def test_oversized_cluster_is_held_not_auto_merged(self):
        rows = [_row(f'big{i}', i * 10, 0, name_ar='مؤسسة الصقر الذهبي', phone='0540001111')
                for i in range(5)]  # 5 entities, all within ~40m, share phone
        report, clusters, _, out = self._run(rows, cluster_cap=3)
        for i in range(5):
            self.assertNotIn(f'big{i}', clusters)  # none auto-merged
        self.assertEqual(report['held_for_review_over_cap']['clusters'], 1)
        self.assertEqual(report['held_for_review_over_cap']['entities'], 5)
        with open(os.path.join(out, 'held_for_review.csv'), encoding='utf-8') as fh:
            held = list(csv.DictReader(fh))
        self.assertEqual(int(held[0]['cluster_size']), 5)

    # ---- Report shape -----------------------------------------------------------------------------
    def test_report_counts_and_samples(self):
        rows = [_row('pa1', 0, 0, name_ar='مخابز الشهد', phone='0512345678'),
                _row('pa2', 40, 0, name_ar='مخابز الشهد الحديثه', phone='0512345678'),
                _row('rb1', 0, 5, name_ar='بهارات كشمير', lic='4031222222'),
                _row('rb2', 30, 5, name_ar='بهارات كشمير', lic='4031222222')]
        report, _, _, out = self._run(rows)
        self.assertEqual(report['rule_a_phone_anchored']['surviving_edges'], 1)
        self.assertEqual(report['rule_b_rare_name']['surviving_edges'], 1)
        self.assertEqual(report['combined_auto_merge']['safe_additional_merges_excess_rows'], 2)
        self.assertTrue(os.path.exists(os.path.join(out, 'sample_phone_anchored.csv')))
        self.assertTrue(os.path.exists(os.path.join(out, 'sample_rare_name.csv')))


if __name__ == '__main__':
    unittest.main()
