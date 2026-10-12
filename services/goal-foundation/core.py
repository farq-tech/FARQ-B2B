"""Phase 0 contracts and evidence gate. No network, credentials, RFQ or sends."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
import re


class Objective(str, Enum):
    MARKETING = 'marketing'
    PURCHASE = 'purchase'
    AVAILABILITY = 'availability'
    SERVICE = 'service'
    PARTNERSHIP = 'partnership'
    COMPARISON = 'comparison'
    NEGOTIATION = 'negotiation'


class Role(str, Enum):
    BUYER = 'buyer'
    SELLER = 'seller'
    SERVICE_PROVIDER = 'service_provider'
    PARTNER = 'partner'
    UNKNOWN = 'unknown'


# The direction is an invariant of a goal, not a permanent label on a business.
DIRECTIONS = {
    Objective.MARKETING: (Role.SELLER, Role.BUYER, 'uses_product'),
    Objective.PURCHASE: (Role.BUYER, Role.SELLER, 'offers_product'),
    Objective.AVAILABILITY: (Role.BUYER, Role.SELLER, 'offers_product'),
    Objective.SERVICE: (Role.BUYER, Role.SERVICE_PROVIDER, 'provides_service'),
    Objective.PARTNERSHIP: (Role.PARTNER, Role.PARTNER, 'distribution_interest'),
}
SECTORS = frozenset({'company', 'shop', 'factory', 'healthcare', 'hospitality',
                    'construction', 'services', 'government', 'quasi_government', 'nonprofit'})


def normalize(text):
    return re.sub(r'\s+', ' ', re.sub(r'[ً-ْـ]', '', text.lower().translate(
        str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي'})))).strip()


@dataclass(frozen=True)
class Goal:
    id: str
    owner_id: str
    sector: str
    objective: Objective
    subject_id: str
    city_id: str
    owner_role: Role
    target_role: Role
    success_measure: str

    def __post_init__(self):
        if self.sector not in SECTORS or not all((self.id, self.owner_id, self.subject_id, self.city_id, self.success_measure)):
            raise ValueError('incomplete_goal')
        expected = DIRECTIONS.get(self.objective)
        if not expected or (self.owner_role, self.target_role) != expected[:2]:
            raise ValueError('invalid_relationship_direction')


@dataclass(frozen=True)
class Evidence:
    id: str
    entity_id: str
    subject_id: str
    predicate: str
    source_kind: str
    source_ref: str
    source_excerpt: str
    observed_at: datetime
    expires_at: datetime
    owner_scope: str | None = None
    negative: bool = False


@dataclass(frozen=True)
class Entity:
    id: str
    name: str
    city_id: str
    # Classification and name are candidate retrieval hints, never proof.
    activity: str
    evidence: tuple[Evidence, ...]
    owner_scope: str | None = None
    active: bool = True


def eligible(goal, entity, now):
    """Reject unsupported directions, unknown provenance, expired and private facts."""
    if not entity.active or entity.city_id != goal.city_id:
        return None, 'inactive_or_wrong_city'
    if entity.owner_scope not in (None, goal.owner_id):
        return None, 'private_entity'
    predicate = DIRECTIONS[goal.objective][2]
    facts = [e for e in entity.evidence
             if e.entity_id == entity.id and e.subject_id == goal.subject_id
             and e.predicate == predicate and e.owner_scope in (None, goal.owner_id)
             and e.source_ref.strip() and e.source_excerpt.strip()
             and e.observed_at.tzinfo and e.expires_at.tzinfo
             and e.observed_at <= now < e.expires_at]
    if any(e.negative for e in facts):
        return None, 'contradictory_evidence'
    facts = [e for e in facts if not e.negative and e.source_kind in
             {'first_party_statement', 'recorded_transaction', 'owner_confirmed'}]
    if not facts:
        return None, 'no_goal_linked_evidence'
    # Website claims support a suggestion; they do not prove stock or eligibility.
    e = max(facts, key=lambda e: (e.source_kind == 'recorded_transaction', e.observed_at))
    return {
        'entity_id': entity.id, 'name': entity.name, 'target_role': goal.target_role.value,
        'reason': e.source_excerpt, 'subject_id': e.subject_id, 'predicate': e.predicate,
        # Use of a product only suggests a potential buyer, even if observed in a transaction.
        'confidence': 'supported' if e.source_kind == 'recorded_transaction' and goal.objective != Objective.MARKETING else 'suggested',
        'evidence_id': e.id, 'source_kind': e.source_kind, 'source_ref': e.source_ref,
        'observed_at': e.observed_at.isoformat(), 'expires_at': e.expires_at.isoformat(),
        'availability': 'unknown', 'institutional_qualification': 'not_assessed',
    }, None


def discover(goal, entities, now=None):
    now = now or datetime.now(timezone.utc)
    rows, rejected, seen = [], [], set()
    for entity in entities:
        if entity.id in seen:
            continue
        seen.add(entity.id)
        match, reason = eligible(goal, entity, now)
        if match:
            rows.append(match)
        else:
            rejected.append({'entity_id': entity.id, 'reason': reason})
    rows.sort(key=lambda r: (r['confidence'] != 'supported', r['entity_id']))
    return {'goal_id': goal.id, 'rows': rows, 'rejected': rejected,
            'coverage': 'supported_candidates' if rows else 'evidence_gap',
            'execution_enabled': False}


def policy_requirements(sector):
    if sector not in SECTORS:
        raise ValueError('unknown_sector')
    return {'discovery_allowed': True, 'execution_enabled': False,
            'required_before_execution': ['actor_authorization', 'plan_version_approval',
                                         'channel_policy', 'approved_cost_source'] + (
                ['institution_policy', 'delegation_record', 'official_procedure_review']
                if sector in {'government', 'quasi_government'} else
                ['nonprofit_authority_and_purpose'] if sector == 'nonprofit' else []),
            'compliance_status': 'not_assessed'}


def city_catalog(rows):
    """All source cities, no size cutoff. Conflicting aliases never guessed."""
    catalog, aliases = {}, {}
    for city_id, name_ar, count in rows:
        if not city_id or not str(city_id).strip():
            continue
        catalog[city_id] = {'id': city_id, 'name_ar': name_ar or city_id, 'records': count}
        for name in (city_id, name_ar):
            if name:
                aliases.setdefault(normalize(name), set()).add(city_id)
    return catalog, aliases


def resolve_city(name, catalog, aliases):
    ids = aliases.get(normalize(name), set())
    return catalog[next(iter(ids))] if len(ids) == 1 else None
