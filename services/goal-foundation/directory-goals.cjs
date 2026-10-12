'use strict';
// Reuse Construction's directory and evidence repositories. No dispatch/runtime.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createConstructionPort } = require('./construction-port.cjs');
function unifiedPort(apiRoot, artifactRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'manifest.json')));
  if (path.resolve(process.env.CONSTRUCTION_PROCUREMENT_ONTOLOGY_DATA || '') !== path.join(artifactRoot, 'procurement-ontology.data.json')) throw new Error('UNIFIED_PAYLOAD_ENV_REQUIRED_BEFORE_IMPORT');
  for (const [name, hash] of Object.entries(manifest.hashes)) {
    if (crypto.createHash('sha256').update(fs.readFileSync(path.join(artifactRoot, name))).digest('hex') !== hash) throw new Error('CPO_ARTIFACT_MISMATCH');
  }
  for (const [kind, name] of Object.entries({ resolver: 'procurement-ontology.resolver.cjs', payload: 'procurement-ontology.data.json' })) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(apiRoot, 'data/construction', name))).digest('hex');
    if (hash !== manifest.source[kind]) throw new Error('CONSTRUCTION_SOURCE_DRIFT_REBUILD_REQUIRED');
  }
  const resolver = require(path.join(artifactRoot, 'procurement-ontology.resolver.cjs'));
  const port = createConstructionPort(apiRoot, { resolver });
  if (port.shared.ontology.ontologyVersion() !== manifest.version) throw new Error('CPO_VERSION_MISMATCH');
  return port;
}
function createDirectoryGoals({ port, repository, query }) {
  async function discover({ objective, productText, actor }) {
    const goal = port.analyze({ objective, productText });
    const intent = goal.product.verdict.canonical_intent_id;
    // The extension identifies beans, not roast form. Abstain on qualifiers
    // whose commercial compatibility the shared CPO does not encode yet.
    if (intent === 'coffee_beans_product' && /green|roasted|أخضر|اخضر|خضراء|محمص/i.test(productText)) {
      return { goal, candidates: [], state: 'product_form_evidence_gap', executionEnabled: false };
    }
    if (!actor?.actorId || !intent) return { goal, candidates: [], state: 'product_or_identity_gap', executionEnabled: false };
    // Capabilities remain seller-only. Never reverse a seller list into buyers.
    if (goal.targetRole === 'seller') {
      const suppliers = await repository.listEvidenceSuppliers({ intents: [intent], actor });
      const evidence = await repository.loadSupplierEvidence({ supplierIds: suppliers.map(s => s.database_id), intents: [intent], actor });
      return { goal, executionEnabled: false, candidates: suppliers.filter(s => !(evidence.get(s.database_id)?.suppressed.length)).map(s => ({ entity: s, role: 'seller', availability: 'unknown', evidence: evidence.get(s.database_id), classification: 'product_evidence_candidate' })) };
    }
    if (!['buyer', 'partner'].includes(goal.targetRole)) return { goal, candidates: [], executionEnabled: false };
    // Existing neutral profile facts, scoped to the account. SUPPLIER_INFO does
    // not feed Construction's positive product/seller capability tables.
    const relationship = goal.targetRole === 'buyer' ? 'BUYER_USES_PRODUCT' : 'DISTRIBUTES_PRODUCT';
    const rows = await query(`select f.supplier_id::text, f.raw_evidence, f.confidence
      from construction.supplier_profile_facts f join construction.suppliers s on s.id=f.supplier_id
      where f.fact_type='SUPPLIER_INFO' and f.status='OBSERVED' and f.normalized_value=$1
        and f.relationship=$2 and f.scope_owner_user_id=$3::uuid
        and f.expires_at > now() and s.active
        and (s.owner_scope_user_id is null or s.owner_scope_user_id=$3::uuid)
        and not exists (select 1 from construction.intelligence_supplier_state b where b.supplier_id=s.id and b.owner_user_id=$3::uuid and b.blocked)
        and not exists (select 1 from construction.supplier_product_suppressions n where n.supplier_id=s.id and n.product_id=$1 and n.lifted_at is null)`, [intent, relationship, actor.actorId]);
    const directory = await repository.listReviewCandidates({ query: { scope: 'all', limit: 100 }, actor });
    const visible = new Map(directory.suppliers.map(s => [s.database_id, s]));
    const candidates = [];
    for (const row of rows.rows) {
      let evidence;
      try { evidence = JSON.parse(row.raw_evidence); } catch { continue; }
      if (!visible.has(row.supplier_id) || evidence.product !== intent || evidence.relationship !== relationship || !/^https:\/\//.test(evidence.url || '') || !evidence.reason_ar || evidence.productFormVerified !== true) continue;
      candidates.push({ entity: visible.get(row.supplier_id), role: goal.targetRole, classification: 'potential_only', confidence: Number(row.confidence), evidence, purchaseIntent: 'unknown', partnershipAcceptance: 'unknown' });
    }
    return { goal, candidates, executionEnabled: false, coverage: { directoryPageLimited: directory.page.has_more }, state: 'relationship_candidates_require_validation' };
  }
  return { discover };
}
module.exports = { unifiedPort, createDirectoryGoals };
