'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createConstructionPort } = require('./construction-port.cjs');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/public-evidence.json'), 'utf8'));
const port = createConstructionPort(process.env.FARQ_CONSTRUCTION_SOURCE);
// Compare annotated relational expectations to existing supplier capability;
// these are diagnostic annotations, not retrieved production results or gold precision.
const cases = data.cases.map(c => {
  const g = port.analyze({ objective: c.objective, productText: data.subject_label });
  return { ...c, product_state: g.state, canonical_id: g.product.verdict.canonical_intent_id,
    owner_role: g.ownerRole, target_role: g.targetRole,
    production_targets: [], blocked: ['CPO_PRODUCT_COVERAGE', 'GEOGRAPHY_UNVERIFIED', 'INDEPENDENT_REVIEW_PENDING'],
    availability: 'unknown', execution_enabled: false };
});
console.log(JSON.stringify({ dataset: data.dataset_kind, cases, sources: data.entities.map(e => ({ id: e.id, url: e.url })),
  independently_reviewed: 0, production_entity_precision: 'NOT_MEASURED',
  relation_annotations_are_not_engine_discovery: true, phase1_gate: 'NOT_PASSED' }, null, 2));
