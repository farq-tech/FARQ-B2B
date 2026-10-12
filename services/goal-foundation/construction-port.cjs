'use strict';

// Phase 0: only existing pure construction modules; no runtime/server, DB or sending.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const FILES = [
  'lib/construction/line-intent-authority.js',
  'lib/construction/procurement-ontology-port.js',
  'data/construction/procurement-ontology.data.json',
  'data/construction/procurement-ontology.resolver.cjs',
  'lib/construction/boq-catalog-matching.js',
  'lib/construction/supplier-evidence-grade.js',
  'lib/construction/supplier-quote-history.js',
  'lib/construction/supplier-price-memory.js',
];
const DIRECTIONS = Object.freeze({
  purchase: ['buyer', 'seller'], availability: ['buyer', 'seller'],
  marketing: ['seller', 'buyer'], partnership: ['partner', 'partner'],
  service: ['buyer', 'service_provider'],
});

function createConstructionPort(apiRoot) {
  if (!path.isAbsolute(apiRoot || '')) throw new Error('EXPLICIT_ABSOLUTE_API_ROOT_REQUIRED');
  const load = file => require(path.join(apiRoot, file));
  const authority = load(FILES[0]), ontology = load(FILES[1]);
  if (!authority.serverResolver()) throw new Error('PAIRED_CONSTRUCTION_RESOLVER_REQUIRED');
  const catalog = load(FILES[4]), evidence = load(FILES[5]);
  const history = load(FILES[6]), memory = load(FILES[7]);
  const fingerprint = () => Object.fromEntries(FILES.map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(apiRoot, file))).digest('hex')]));

  function analyze({ objective, productText }) {
    if (!Object.hasOwn(DIRECTIONS, objective)) throw new Error('UNSUPPORTED_OBJECTIVE');
    if (typeof productText !== 'string' || !productText.trim() || productText.length > 1000) throw new Error('INVALID_PRODUCT_TEXT');
    // productText is the product span; free-text goal extraction belongs to Phase 1.
    const binding = authority.bindLineToIntent({ lineText: productText });
    const named = binding.authority === 'SERVER_RESOLVED' &&
      ['CANONICAL', 'FAMILY_ONLY'].includes(binding.verdict.status);
    const [ownerRole, targetRole] = DIRECTIONS[objective];
    return {
      objective, ownerRole, targetRole, product: binding,
      ontologyVersion: ontology.ontologyVersion(), executionEnabled: false,
      state: !named ? 'product_coverage_gap' : objective === 'service' ? 'service_capability_review_required' :
        ['marketing', 'partnership'].includes(objective) ? 'relationship_evidence_gap' : 'product_resolved',
      availability: 'unknown',
    };
  }

  function matchCatalog(goal, rows, items) {
    const result = catalog.suggestBoqMatches(catalog.parseBoqMatchRows({ rows }), items);
    // BROWSE/GENERAL are suggestions to browse, never established product matches.
    return { ...result, executionEnabled: false, rows: result.rows.map(row => ({ ...row,
      discoveryCandidateIds: goal.state === 'product_resolved' && !['BROWSE', 'GENERAL', 'REJECT_NOT_SUPPLY'].includes(row.kind)
        ? row.automatic_candidate_ids : [],
    })) };
  }

  function sellerGrade(goal, supplier, lane, line) {
    if (goal.targetRole !== 'seller' || goal.state !== 'product_resolved') {
      return { state: 'relationship_evidence_gap', evidence_grade: null, executionEnabled: false };
    }
    // Same grading function as construction, retained as a supplier signal;
    // it cannot prove stock, buyer intent, or institutional approval.
    return { ...evidence.gradeSupplier(supplier, lane, line), availability: 'unknown', executionEnabled: false };
  }

  return { analyze, matchCatalog, sellerGrade, fingerprint,
    // Identity exports allow tests to prove reuse rather than copied algorithms.
    shared: { authority, ontology, catalog, evidence, history, memory } };
}
module.exports = { createConstructionPort, DIRECTIONS, FILES };
