'use strict';
const { createConstructionPort } = require('./construction-port.cjs');
const port = createConstructionPort(process.env.FARQ_CONSTRUCTION_SOURCE);
const lines = ['كيبل 4×16 مم', 'أبواب PVC', 'قهوة', 'أكواب ورقية', 'مستلزمات طبية', 'مواد نظافة', 'صيانة مصاعد'];
console.log(JSON.stringify({ sourceRoot: process.env.FARQ_CONSTRUCTION_SOURCE,
  sourceHashes: port.fingerprint(), liveFlagsVerified: false, executionEnabled: false,
  cases: lines.map(productText => ({ productText, outcomes: ['purchase', 'marketing', 'availability', 'partnership', 'service'].map(objective => {
    const g = port.analyze({ objective, productText });
    return { objective, ownerRole: g.ownerRole, targetRole: g.targetRole, state: g.state,
      authority: g.product.authority, status: g.product.verdict.status,
      intent: g.product.verdict.canonical_intent_id, family: g.product.resolution?.family ?? null,
      ontologyVersion: g.ontologyVersion };
  }) })) }, null, 2));
