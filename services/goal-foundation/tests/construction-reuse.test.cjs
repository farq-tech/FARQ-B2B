'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createConstructionPort } = require('../construction-port.cjs');
const root = process.env.FARQ_CONSTRUCTION_SOURCE;
assert.ok(root, 'Set FARQ_CONSTRUCTION_SOURCE to the existing construction api directory');
const port = createConstructionPort(root);
const before = port.fingerprint();
const goal = objective => port.analyze({ objective, productText: 'أبواب PVC' });

test('all four directions reuse the exact authoritative resolver and same product', () => {
  const expectations = { purchase: ['buyer', 'seller'], marketing: ['seller', 'buyer'],
    availability: ['buyer', 'seller'], partnership: ['partner', 'partner'] };
  const direct = require(path.join(root, 'lib/construction/line-intent-authority')).bindLineToIntent({ lineText: 'أبواب PVC' });
  for (const [objective, direction] of Object.entries(expectations)) {
    const g = goal(objective);
    // Elapsed time is telemetry, not part of product identity.
    const stable = binding => JSON.parse(JSON.stringify(binding, (key, value) => key === 'elapsed_ms' ? undefined : value));
    assert.deepEqual(stable(g.product), stable(direct));
    assert.equal(g.product.verdict.canonical_intent_id, 'pvc_door');
    assert.deepEqual([g.ownerRole, g.targetRole], direction);
    assert.equal(g.executionEnabled, false);
  }
});
test('unsupported non-construction products abstain without a second ontology', () => {
  for (const productText of ['قهوة', 'أكواب ورقية', 'مستلزمات طبية']) {
    assert.equal(port.analyze({ objective: 'purchase', productText }).state, 'product_coverage_gap');
  }
});
test('service interpretation cannot become goods supplier eligibility', () => {
  const g = port.analyze({ objective: 'service', productText: 'صيانة مصاعد' });
  assert.equal(g.state, 'service_capability_review_required');
  assert.equal(port.sellerGrade(g, {}, 'match', {}).evidence_grade, null);
});
test('existing catalog matcher result preserved; browsing cannot yield discovery ids', () => {
  const items = [{ id: 'door', farq_spec_id: 'pvc_wpc_doors', name_ar: 'أبواب PVC', name_en: 'PVC doors', category: 'doors' }];
  const rows = [{ key: '1', name: 'أبواب PVC' }];
  const result = port.matchCatalog(goal('purchase'), rows, items);
  const direct = port.shared.catalog.suggestBoqMatches(port.shared.catalog.parseBoqMatchRows({ rows }), items);
  assert.deepEqual(result.rows[0].candidates, direct.rows[0].candidates);
  assert.ok(result.rows[0].discoveryCandidateIds.includes('door'));
  assert.deepEqual(port.matchCatalog(goal('marketing'), rows, items).rows[0].discoveryCandidateIds, []);
  const unknown = port.analyze({ objective: 'purchase', productText: 'قهوة' });
  const browse = port.matchCatalog(unknown, [{ key: '2', name: 'اسم مادة غير موجود' }], items);
  assert.equal(browse.rows[0].kind, 'BROWSE');
  assert.deepEqual(browse.rows[0].discoveryCandidateIds, []);
});
test('existing supplier evidence reused but never inverted into buyer evidence', () => {
  const supplier = { prior_quoter: { quotes: 2, match: 'SPEC' } };
  const direct = port.shared.evidence.gradeSupplier(supplier, 'match', { name: 'أبواب PVC' });
  const result = port.sellerGrade(goal('purchase'), supplier, 'match', { name: 'أبواب PVC' });
  assert.equal(result.evidence_grade, direct.evidence_grade);
  assert.deepEqual(result.evidence_sources, direct.evidence_sources);
  assert.equal(result.availability, 'unknown');
  for (const objective of ['marketing', 'partnership']) assert.equal(port.sellerGrade(goal(objective), supplier, 'match', {}).evidence_grade, null);
});
test('history and price memory are the original function objects, not copies', () => {
  assert.equal(port.shared.history.buildPriorQuoteIndex, require(path.join(root, 'lib/construction/supplier-quote-history')).buildPriorQuoteIndex);
  assert.equal(port.shared.memory.eligible, require(path.join(root, 'lib/construction/supplier-price-memory')).eligible);
  assert.equal(port.shared.history.buildPriorQuoteIndex([]).size, 0);
  assert.deepEqual(port.shared.memory.eligible(null, {}), { eligible: false, reason: 'AGE' });
});
test('invalid objective/text rejected and source files unchanged', () => {
  assert.throws(() => port.analyze({ objective: 'broadcast', productText: 'أبواب PVC' }));
  assert.throws(() => port.analyze({ objective: 'purchase', productText: '' }));
  assert.deepEqual(port.fingerprint(), before);
});
