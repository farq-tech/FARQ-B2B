'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createConstructionPort } = require('../construction-port.cjs');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/public-evidence.json'), 'utf8'));
const port = createConstructionPort(process.env.FARQ_CONSTRUCTION_SOURCE);
test('public first-party pilot preserves provenance and declares inferred coffee use', () => {
  for (const entity of data.entities) {
    assert.ok(entity.url.startsWith('https://') && entity.section && entity.short_quote && entity.reason_ar);
    assert.ok(entity.does_not_prove.includes('accepts_new_distribution_brand'));
  }
  assert.equal(data.entities.find(e => e.id === 'barns').confidence, 'inferred_from_first_party_menu');
  assert.equal(data.independently_reviewed, false);
});
test('four real goal cases remain blocked when shared product understanding is unresolved', () => {
  for (const c of data.cases) {
    const g = port.analyze({ objective: c.objective, productText: data.subject_label });
    assert.equal(g.state, 'product_coverage_gap');
    assert.equal(g.product.verdict.canonical_intent_id, null);
    assert.equal(g.executionEnabled, false);
    assert.equal(port.sellerGrade(g, { prior_quoter: { quotes: 4, match: 'SPEC' } }, 'match', {}).evidence_grade, null);
  }
});
test('coffee use and distributor status do not become confirmed buyer or partnership intent', () => {
  const marketing = data.cases.find(c => c.objective === 'marketing');
  const partners = data.cases.find(c => c.objective === 'partnership');
  assert.deepEqual(marketing.eligible_relation, []);
  assert.deepEqual(partners.eligible_relation, []);
  assert.ok(marketing.rejected_relation.includes('sulalat'));
  assert.ok(partners.needs_review.includes('tba'));
  assert.ok(!data.entities.find(e => e.id === 'tba').facts.includes('distribution_interest'));
});
