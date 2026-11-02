# -*- coding: utf-8 -*-
"""Release quality gate: the POI validator as a ratchet between two releases (owner decision 2026-11-02).

A release is refused when it *regresses* against the release before it, or when it carries defects that must never
reach the service. Coverage gaps the directory has carried for months (names without Arabic, missing categories,
empty mandatory fields) are measured and reported, but they block only when they grow.

Absolute rules (any count fails):
  7_Placeholder  — UNAVAILABLE / UNAPPLICABLE / N/A tokens in cells (owner: empty instead of tokens)
  10_Bbox        — coordinates outside the Kingdom
Ratchet rules (fail when the HIGH count rises above the baseline by more than --max-rise-pct, default 1%):
  every other rule, plus rows_with_high overall.

Usage:
  python3 quality_gate.py TARGETS.parquet --profile directory --out PREFIX [--baseline PREV_gate.json] [--max-rise-pct 1]
Writes PREFIX_issues.parquet, PREFIX_summary.json (validator) and PREFIX_gate.json (this verdict); exit 1 on FAIL.
The gate JSON is what stage_release.py --quality-gate reads and records in the release manifest.
"""
import argparse
import json
import os
import shutil
import sys

import poi_validator

VERSION = 'quality_gate_v1'
ABSOLUTE_RULES = ('7_Placeholder', '10_Bbox')


def _high(by_rule, rule):
    return int((by_rule.get(rule) or {}).get('HIGH', 0))


def _total(by_rule, rule):
    return int((by_rule.get(rule) or {}).get('total', 0))


def decide(summary, baseline=None, max_rise_pct=1.0, slack_rows=100):
    """-> gate dict. `summary` is poi_validator's summary; `baseline` the previous release's gate (or summary) dict."""
    by_rule = summary.get('by_rule', {})
    reasons, absolute, ratchet = [], {}, {}
    for rule in ABSOLUTE_RULES:
        n = _total(by_rule, rule)
        absolute[rule] = n
        if n:
            reasons.append(f'{rule}: {n} rows (must be 0)')
    base_rules = (baseline or {}).get('validator', baseline or {}).get('by_rule', {}) if baseline else {}
    if baseline:
        checks = {rule: (_high(base_rules, rule), _high(by_rule, rule)) for rule in sorted(set(base_rules) | set(by_rule))
                  if rule not in ABSOLUTE_RULES}
        base_rows = int((baseline.get('validator', baseline)).get('rows_with_high', 0))
        checks['rows_with_high'] = (base_rows, int(summary.get('rows_with_high', 0)))
        for key, (before, now) in checks.items():
            limit = before * (1 + max_rise_pct / 100.0) + slack_rows
            ok = now <= limit
            ratchet[key] = {'baseline': before, 'now': now, 'ok': ok}
            if not ok:
                reasons.append(f'{key}: HIGH rows {before} -> {now} (limit {int(limit)})')
    return {
        'version': VERSION,
        'gate': 'FAIL' if reasons else 'PASS',
        'reasons': reasons,
        'absolute': absolute,
        'ratchet': ratchet,
        'baseline_used': bool(baseline),
        'max_rise_pct': max_rise_pct,
        'validator': {k: summary.get(k) for k in ('input', 'profile', 'total_rows', 'total_issues', 'by_severity',
                                                   'by_rule', 'rows_with_high', 'rows_with_any_issue')},
    }


def run(targets, profile, out_prefix, baseline_path=None, max_rise_pct=1.0, threads=2):
    baseline = None
    if baseline_path:
        with open(baseline_path, encoding='utf-8') as fh:
            baseline = json.load(fh)
    temp_dir = os.path.join(os.path.dirname(os.path.abspath(out_prefix)), '.duckdb_tmp')
    try:
        summary = poi_validator.validate(targets, profile, out_prefix, threads=threads, temp_dir=temp_dir)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    gate = decide(summary, baseline, max_rise_pct)
    with open(out_prefix + '_gate.json', 'w', encoding='utf-8') as fh:
        json.dump(gate, fh, ensure_ascii=False, indent=1)
    return gate


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('targets')
    ap.add_argument('--profile', default='directory', choices=sorted(poi_validator.PROFILES))
    ap.add_argument('--out', required=True, help='output prefix')
    ap.add_argument('--baseline', help="previous release's *_gate.json (or validator summary)")
    ap.add_argument('--max-rise-pct', type=float, default=1.0)
    ap.add_argument('--threads', type=int, default=2)
    args = ap.parse_args(argv)
    gate = run(args.targets, args.profile, args.out, args.baseline, args.max_rise_pct, args.threads)
    print(json.dumps({k: gate[k] for k in ('gate', 'reasons', 'absolute', 'baseline_used')}, ensure_ascii=False, indent=1))
    return 1 if gate['gate'] == 'FAIL' else 0


if __name__ == '__main__':
    sys.exit(main())
