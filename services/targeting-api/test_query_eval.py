"""Query understanding eval: everyday Saudi Arabic requests (query_eval.json) through the resolvers the endpoints use.

- 'understand': taxonomy_search.Taxonomy.understand(q, objective)['targets'], read by the directory search (/trial-search,
  /market/entities), /clusters and every market analytics tool (market-summary, district-counts, district-insights,
  market-gaps, brands, site card).
- 'corridor': market_analytics.corridor_subs(tx, q, objective), read by /street-density.

Uses the taxonomy checked into the repo (docs/qa/targeting/taxonomy, the same files the release ships). Never calls the model.
The floors are a ratchet: raise them when the resolver improves, never lower them to make a change pass.
"""
import json
import os
import unittest

import activity_groups
import market_analytics
import taxonomy_search

HERE = os.path.dirname(os.path.abspath(__file__))
TAX = os.path.join(HERE, '..', '..', 'docs', 'qa', 'targeting', 'taxonomy')
EVAL = os.path.join(HERE, 'query_eval.json')

# measured accuracy (share of cases passed); a change may raise these, never lower them
FLOORS = {'understand': 0.988, 'corridor': 0.988}   # 2026-11-02: 70.4% / 84.6% before the shared trade reading, 98.8% / 98.8% after


def load_cases():
    with open(EVAL, encoding='utf-8') as f:
        return json.load(f)['cases']


def expand(subs):
    out = set()
    for sub in subs:
        out |= set(activity_groups.GROUPS[sub]['subs']) if sub in activity_groups.GROUPS else {sub}
    return out


def passes(case, resolved):
    got, expect = expand(resolved), expand(case['expect'])
    if not got & expect or got & expand(case.get('not', ())):
        return False
    if case['objective'] == 'marketing':
        return True
    return got <= expect | expand(case.get('also', ()))


def resolvers(tx):
    return {
        'understand': lambda q, objective: list(tx.understand(q, objective)['targets']),
        'corridor': lambda q, objective: market_analytics.corridor_subs(tx, q, objective),
    }


def run(tx, cases):
    report = {}
    for name, resolve in resolvers(tx).items():
        failures = []
        for case in cases:
            resolved = resolve(case['q'], case['objective'])
            if not passes(case, resolved):
                failures.append((case['q'], case['objective'], case['expect'], resolved))
        report[name] = (1 - len(failures) / len(cases), failures)
    return report


@unittest.skipUnless(os.path.isfile(os.path.join(TAX, 'farq_taxonomy.json')), 'repo taxonomy not present')
class QueryEval(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.pop('ANTHROPIC_API_KEY', None)   # the eval measures the deterministic resolver only
        cls.tx = taxonomy_search.Taxonomy(TAX, '/dev/null')
        cls.cases = load_cases()

    def test_eval_ids_exist(self):
        known = set(self.tx.subs) | set(activity_groups.GROUPS)
        for case in self.cases:
            self.assertIn(case['objective'], ('purchase', 'marketing'), case['q'])
            for key in ('expect', 'also', 'not'):
                for sub in case.get(key, ()):
                    self.assertIn(sub, known, f"{case['q']}: {sub}")

    def test_production_misreads_stay_fixed(self):   # seen on production 2026-11: every tool must read these the same way
        for q, expect in [('ورش سيارات', {'auto.workshop'}), ('حلاق', {'beauty.barber'}),
                          ('أطفال', {'retail.baby', 'fashion.kids', 'retail.toys'}), ('أغراض مواليد', {'retail.baby', 'fashion.kids', 'retail.toys'})]:
            self.assertEqual(set(self.tx.understand(q, 'purchase')['targets']), expect, q)
            self.assertEqual(expand(market_analytics.corridor_subs(self.tx, q, 'purchase')), expect, q)
        # asking for supplies keeps the supplies reading
        self.assertEqual(list(self.tx.understand('مستلزمات حلاقين', 'purchase')['targets']), ['beauty.salon_supplies'])
        self.assertEqual(list(self.tx.understand('معدات ورش', 'purchase')['targets']), ['equip.workshop_equipment'])

    def test_accuracy_ratchet(self):
        report = run(self.tx, self.cases)
        lines = [f'query eval: {len(self.cases)} cases']
        for name, (accuracy, failures) in report.items():
            lines.append(f'  {name:<10} {accuracy:.1%}  ({len(failures)} failures)')
        print('\n' + '\n'.join(lines))
        for name, (accuracy, failures) in report.items():
            detail = '\n'.join(f'  {q} [{obj}] expected {exp} got {got[:6]}' for q, obj, exp, got in failures)
            self.assertGreaterEqual(round(accuracy, 4), FLOORS[name], f'{name} accuracy {accuracy:.1%} fell below {FLOORS[name]:.1%}:\n{detail}')


if __name__ == '__main__':
    tx = taxonomy_search.Taxonomy(TAX, '/dev/null')
    for name, (accuracy, failures) in run(tx, load_cases()).items():
        print(f'== {name}: {accuracy:.1%}')
        for q, obj, exp, got in failures:
            print(f'  {q} [{obj}] expected {exp} got {got[:6]}')
