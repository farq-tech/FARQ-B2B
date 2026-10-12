"""Explicit-direction benchmark baseline, NOT the phase-1 natural-language engine.

Unknown, negated and compound goals abstain; this baseline never executes.
"""
import re
from core import DIRECTIONS, Goal, Objective, normalize

SIGNALS = {
    Objective.MARKETING: r'اسوق|ابيع|نسوق|نبيع|sell|market my',
    Objective.PURCHASE: r'اشتري|نشتري|شراء|عروض اسعار|buy|purchase',
    Objective.AVAILABILITY: r'استفسر عن توفر|استعلم عن توفر|مين عنده|متوفر|availability|in stock',
    Objective.PARTNERSHIP: r'شركاء|شراكات|شراكه|شراكة|partners|distribute my',
    Objective.SERVICE: r'صيانة|صيانه|مقدمي خدمه|خدمه صيانه|service providers',
}



def interpret(text, *, sector, owner_id, city_id, fixture_subject=None):
    if not isinstance(text, str) or not 3 <= len(text.strip()) <= 1000:
        return {'state': 'needs_clarification', 'reason': 'invalid_input', 'execution_enabled': False}
    q = normalize(text)
    if re.search(r'لا اريد|لا ابي|ما ابي|ليس|not |dont |ignore|تجاهل|لا تشتري', q):
        return {'state': 'needs_clarification', 'reason': 'negation_or_untrusted_instruction', 'execution_enabled': False}
    objectives = [o for o, pattern in SIGNALS.items() if re.search(pattern, q)]
    # Product identity must come from the shared CPO port, never a second ontology.
    # Only the synthetic contract benchmark supplies a pre-labelled fixture subject.
    subjects = [fixture_subject] if fixture_subject else []
    if len(objectives) != 1 or len(subjects) != 1 or not city_id:
        return {'state': 'needs_clarification', 'reason': 'ambiguous_compound_or_unsupported', 'execution_enabled': False}
    objective = objectives[0]
    direction = DIRECTIONS[objective]
    goal = Goal('baseline-only', owner_id, sector, objective, subjects[0], city_id,
                direction[0], direction[1], {
                    Objective.MARKETING: 'qualified_interest', Objective.PURCHASE: 'comparable_offers',
                    Objective.AVAILABILITY: 'attested_availability', Objective.PARTNERSHIP: 'distribution_interest',
                    Objective.SERVICE: 'service_terms_and_visit',
                }[objective])
    return {'state': 'understood', 'goal': goal, 'execution_enabled': False}
