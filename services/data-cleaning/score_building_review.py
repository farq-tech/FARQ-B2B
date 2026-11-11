"""Accuracy of the reviewed building-link sample (exported from building_review_page.py), per stratum.

Accuracy = same / (same + different); «cannot tell» is reported and left out of the denominator. The 95% Wilson lower
bound is compared with the threshold of docs/establishment-lifecycle.md 8.2 (0.95 for rules other than merges). Prints
JSON. Usage: python3 score_building_review.py answers.csv [--threshold 0.95]
"""
import argparse
import collections
import csv
import json
import math
import sys

Z = 1.959964   # two-sided 95%


def wilson(successes, n):
    """95% Wilson interval for a proportion; None for an empty sample."""
    if not n:
        return None
    p = successes / n
    centre = (p + Z * Z / (2 * n)) / (1 + Z * Z / n)
    half = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / (1 + Z * Z / n)
    return round(centre - half, 4), round(centre + half, 4)


def score(rows, threshold=0.95):
    counts = collections.defaultdict(collections.Counter)
    for row in rows:
        counts[row['stratum']][row.get('review_same_building') or 'not_reviewed'] += 1
    out = {}
    for stratum, c in sorted(counts.items()):
        judged = c['same'] + c['different']
        bounds = wilson(c['same'], judged)
        out[stratum] = {'same': c['same'], 'different': c['different'], 'cannot_tell': c['cannot_tell'], 'not_reviewed': c['not_reviewed'],
                        'accuracy': round(c['same'] / judged, 4) if judged else None, 'wilson_95': bounds,
                        'passes': None if bounds is None or c['not_reviewed'] else bounds[0] >= threshold}
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('answers')
    parser.add_argument('--threshold', type=float, default=0.95)
    args = parser.parse_args()
    rows = list(csv.DictReader(open(args.answers, encoding='utf-8-sig')))
    print(json.dumps({'threshold': args.threshold, 'by_stratum': score(rows, args.threshold),
                      'note': 'passes is null until every row of the stratum is reviewed'}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.exit(main())
