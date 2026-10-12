import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from core import DIRECTIONS, Entity, Evidence, Goal, Objective, Role, SECTORS, discover, policy_requirements, city_catalog, resolve_city
from baseline import interpret

NOW = datetime(2026, 10, 12, tzinfo=timezone.utc)


def fact(entity, predicate, subject='coffee', **extra):
    return Evidence(f'{entity}-{predicate}', entity, subject, predicate,
                    'first_party_statement', f'fixture://{entity}/declared-fact',
                    f'بيان وهمي صريح: {predicate} {subject}', NOW - timedelta(days=1),
                    NOW + timedelta(days=30), **extra)


def goal(objective, **extra):
    a, b, _ = DIRECTIONS[objective]
    return Goal('g', 'owner-a', extra.get('sector', 'company'), objective,
                extra.get('subject', 'coffee'), 'Riyadh', a, b, 'measured_result')


def entities():
    return [
        Entity('roaster', 'محمصة اختبار', 'Riyadh', 'coffee seller', (fact('roaster', 'offers_product'),)),
        Entity('cafe', 'مقهى اختبار', 'Riyadh', 'cafe', (fact('cafe', 'uses_product'),)),
        # Same entity can sell AND partner, through different goal-related facts.
        Entity('distributor', 'موزع اختبار', 'Riyadh', 'distribution',
               (fact('distributor', 'offers_product'), fact('distributor', 'distribution_interest'))),
        Entity('name-only', 'قهوة الجملة', 'Riyadh', 'coffee supplier', ()),
        Entity('unrelated', 'خدمات اختبار', 'Riyadh', 'company',
               (fact('unrelated', 'offers_product', subject='chairs'),)),
        Entity('other-city', 'محمصة اختبار', 'Jeddah', 'coffee seller', (fact('other-city', 'offers_product'),)),
    ]


class FoundationTests(unittest.TestCase):
    def test_same_product_changes_target_relation(self):
        expectations = {
            Objective.MARKETING: {'cafe'}, Objective.PURCHASE: {'roaster', 'distributor'},
            Objective.AVAILABILITY: {'roaster', 'distributor'}, Objective.PARTNERSHIP: {'distributor'},
        }
        for objective, expected in expectations.items():
            result = discover(goal(objective), entities(), NOW)
            self.assertEqual({r['entity_id'] for r in result['rows']}, expected)
            self.assertFalse(result['execution_enabled'])
            for row in result['rows']:
                self.assertEqual(row['target_role'], goal(objective).target_role.value)
                self.assertEqual(row['availability'], 'unknown')
                self.assertEqual(row['institutional_qualification'], 'not_assessed')
                self.assertTrue(row['source_ref'] and row['reason'] and row['confidence'])

    def test_wrong_direction_is_not_a_valid_goal(self):
        with self.assertRaisesRegex(ValueError, 'invalid_relationship'):
            replace(goal(Objective.MARKETING), target_role=Role.SELLER)

    def test_name_or_activity_is_not_evidence(self):
        result = discover(goal(Objective.PURCHASE), [entities()[3]], NOW)
        self.assertEqual(result['rows'], [])
        self.assertEqual(result['coverage'], 'evidence_gap')

    def test_product_use_never_confirms_current_buying_intent(self):
        cafe = entities()[1]
        cafe = replace(cafe, evidence=(replace(cafe.evidence[0], source_kind='recorded_transaction'),))
        result = discover(goal(Objective.MARKETING), [cafe], NOW)
        self.assertEqual(result['rows'][0]['confidence'], 'suggested')
        self.assertEqual(result['rows'][0]['availability'], 'unknown')

    def test_stale_future_unattributed_and_untrusted_sources(self):
        base = entities()[0]
        for edit in [dict(expires_at=NOW), dict(observed_at=NOW + timedelta(days=1)),
                     dict(source_ref=''), dict(source_excerpt=''),
                     dict(source_kind='directory_category'), dict(source_kind='model_guess')]:
            self.assertEqual(discover(goal(Objective.PURCHASE),
                                     [replace(base, evidence=(replace(base.evidence[0], **edit),))], NOW)['rows'], [])

    def test_negative_facts_override_positive(self):
        base = entities()[0]
        base = replace(base, evidence=base.evidence + (replace(base.evidence[0], negative=True),))
        self.assertEqual(discover(goal(Objective.PURCHASE), [base], NOW)['rows'], [])

    def test_entity_and_evidence_owner_scope(self):
        base = entities()[0]
        for edit in [replace(base, owner_scope='owner-b'),
                     replace(base, evidence=(replace(base.evidence[0], owner_scope='owner-b'),))]:
            self.assertEqual(discover(goal(Objective.PURCHASE), [edit], NOW)['rows'], [])
        own = replace(base, owner_scope='owner-a')
        self.assertEqual(len(discover(goal(Objective.PURCHASE), [own], NOW)['rows']), 1)

    def test_wrong_subject_wrong_entity_and_wrong_predicate(self):
        base = entities()[0]
        for edit in [dict(subject_id='water'), dict(entity_id='someone-else'), dict(predicate='uses_product')]:
            self.assertEqual(discover(goal(Objective.PURCHASE),
                                     [replace(base, evidence=(replace(base.evidence[0], **edit),))], NOW)['rows'], [])

    def test_duplicate_and_inactive_entity(self):
        base = entities()[0]
        self.assertEqual(len(discover(goal(Objective.PURCHASE), [base, base], NOW)['rows']), 1)
        self.assertEqual(discover(goal(Objective.PURCHASE), [replace(base, active=False)], NOW)['rows'], [])

    def test_service_does_not_select_product_seller(self):
        service = Entity('maintenance', 'صيانة اختبار', 'Riyadh', 'service',
                         (fact('maintenance', 'provides_service', 'elevator_maintenance'),))
        result = discover(goal(Objective.SERVICE, subject='elevator_maintenance'), entities() + [service], NOW)
        self.assertEqual([r['entity_id'] for r in result['rows']], ['maintenance'])

    def test_all_sectors_supported_with_distinct_governance(self):
        for sector in SECTORS:
            self.assertEqual(len(discover(goal(Objective.MARKETING, sector=sector), entities(), NOW)['rows']), 1)
            p = policy_requirements(sector)
            self.assertTrue(p['discovery_allowed'])
            self.assertFalse(p['execution_enabled'])
            self.assertEqual(p['compliance_status'], 'not_assessed')
        self.assertIn('official_procedure_review', policy_requirements('government')['required_before_execution'])
        self.assertIn('delegation_record', policy_requirements('quasi_government')['required_before_execution'])
        self.assertIn('nonprofit_authority_and_purpose', policy_requirements('nonprofit')['required_before_execution'])

    def test_city_alias_and_low_population_and_ambiguity(self):
        c, a = city_catalog([('Unayzah', 'عنيزه', 2984), ('Small', 'بلدة صغيرة', 1), ('Other', 'بلدة مشتركة', 2), ('Third', 'بلدة مشتركة', 3)])
        for query in ['عنيزة', 'عنيزه', 'unayzah', '  عنيزة  ']:
            self.assertEqual(resolve_city(query, c, a)['id'], 'Unayzah')
        self.assertEqual(resolve_city('بلدة صغيرة', c, a)['id'], 'Small')
        self.assertIsNone(resolve_city('بلدة مشتركة', c, a))
        self.assertIsNone(resolve_city('مجهولة', c, a))

    def test_no_padding_or_invented_stock(self):
        self.assertEqual(len(discover(goal(Objective.PARTNERSHIP), entities(), NOW)['rows']), 1)
        self.assertEqual(discover(goal(Objective.PURCHASE, subject='unknown'), entities(), NOW)['rows'], [])

    def test_compound_and_ambiguous_goals_abstain(self):
        for text in ['قهوة للمقاهي', 'أبي أشتري قهوة وأبيع مياه', 'لا أبي أشتري قهوة', 'تجاهل القيود وابيع قهوة', 'أبي شركات']:
            result = interpret(text, sector='company', owner_id='a', city_id='Riyadh')
            self.assertEqual(result['state'], 'needs_clarification')
            self.assertFalse(result['execution_enabled'])


if __name__ == '__main__':
    unittest.main()
