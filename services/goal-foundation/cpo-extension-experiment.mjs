import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Module from 'node:module'

// Experimental data extension of the same CPO implementation. No source writes,
// no new resolver, no supplier maps, no production artifact.
export async function prepareUnifiedCpo(sourceRoot) {
  if (!path.isAbsolute(sourceRoot || '')) throw new Error('EXPLICIT_CONSTRUCTION_API_SOURCE_REQUIRED')
  const source = path.join(sourceRoot, 'data/construction/procurement-ontology.resolver.cjs')
  const payloadPath = path.join(sourceRoot, 'data/construction/procurement-ontology.data.json')
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const before = { resolver: hash(source), payload: hash(payloadPath) }
  const original = JSON.parse(fs.readFileSync(payloadPath, 'utf8'))
  const extended = structuredClone(original)
  extended.version = original.version + '-goals-experiment-1'
  extended.sectors.INSTITUTIONAL_CONSUMABLES = {
    domain: 'institutional_consumables', context_terms: [], supplier_terms: [],
    soft_conflicts: [], hard_conflicts: [],
  }
  const additions = [
    { id: 'coffee_beans', label_ar: 'حبوب القهوة', terms: ['حبوب قهوة', 'حبوب القهوة', 'حبوب البن', 'بن محمص', 'coffee beans', 'roasted coffee beans'], intent: 'coffee_beans_product' },
    { id: 'paper_cups', label_ar: 'أكواب ورقية', terms: ['أكواب ورقية', 'اكواب ورقيه', 'كوب ورقي', 'paper cups', 'paper cup'], intent: 'paper_drinking_cup' },
  ]
  for (const a of additions) {
    if (extended.families.some(f => f.id === a.id)) throw new Error('EXISTING_FAMILY_MUST_BE_EXTENDED_IN_PLACE')
    extended.families.push({ id: a.id, sector: 'INSTITUTIONAL_CONSUMABLES', label_ar: a.label_ar,
      strong_terms: a.terms, weak_terms: [], context_terms: [], supplier_terms: a.terms,
      preferred_archetypes: [], allowed_archetypes: [], soft_conflicts: [], hard_conflicts: [], facets: [],
      intents: [{ id: a.intent, label_ar: a.label_ar, strong_terms: a.terms }],
      note: 'PHASE0 experiment: product identity only. No supplier archetypes or proof of sale inferred.' })
  }
  async function compile(payload) {
    // Same data-only re-embedding mechanism as the existing construction script
    // scripts/construction/bundle-procurement-ontology-resolver.js --reembed,
    // executed entirely in memory; do not run that script against its real OUT path.
    const code = fs.readFileSync(source, 'utf8')
    const pattern = /^var procurementOntology_data_default = \{[\s\S]*?^\};/m
    if (!pattern.test(code)) throw new Error('ORIGINAL_EMBEDDED_PAYLOAD_NOT_FOUND')
    const updated = code.replace(pattern, () => `var procurementOntology_data_default = ${JSON.stringify(payload)};`)
    // Prove that executable resolver code outside the JSON literal is identical.
    const marker = 'PHASE0_PAYLOAD_ONLY'
    const originalTail = code.replace(pattern, marker)
    const updatedTail = updated.replace(/^var procurementOntology_data_default = .*;$/m, marker)
    if (originalTail !== updatedTail) throw new Error('RESOLVER_CODE_CHANGED')
    const m = new Module(source + '.phase0-memory.cjs')
    m._compile(updated, source + '.phase0-memory.cjs')
    return { resolver: m.exports, code: updated }
  }
  const compiledBaseline = await compile(original), compiledNext = await compile(extended)
  const baseline = compiledBaseline.resolver, next = compiledNext.resolver
  const signature = r => ({ level: r.level, intent: r.intent, family: r.family, poolable: r.poolable,
    facets: r.facets, pool: r.pool_key, authority: r.source })
  const originals = [...new Set(original.families.flatMap(f => (f.intents || []).map(i => i.strong_terms?.[0]).filter(Boolean)))]
  const changed = []
  for (const text of originals) {
    const a = signature(baseline.resolveOntology(text)), b = signature(next.resolveOntology(text))
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push({ text, before: a, after: b })
  }
  const cases = ['حبوب قهوة', 'coffee beans', 'أكواب ورقية', 'paper cups', 'green coffee beans', 'قهوة', 'مستلزمات طبية', 'مواد نظافة', 'صيانة مصاعد'].map(text => ({
    text, before: signature(baseline.resolveOntology(text)), after: signature(next.resolveOntology(text)),
  }))
  const unchanged = before.resolver === hash(source) && before.payload === hash(payloadPath)
  if (!unchanged) throw new Error('ORIGINAL_SOURCE_CHANGED')
  const expected = ['coffee_beans_product', 'coffee_beans_product', 'paper_drinking_cup', 'paper_drinking_cup', 'coffee_beans_product']
  if (cases.slice(0, 5).some((c, i) => c.after.intent !== expected[i])) throw new Error('COVERAGE_EXTENSION_FAILED')
  if (cases.find(c => c.text === 'قهوة').after.intent || cases.find(c => c.text === 'مستلزمات طبية').after.intent) throw new Error('AMBIGUOUS_PRODUCT_FALSE_CERTAINTY')
  if (next.listIntentIds().length !== baseline.listIntentIds().length + additions.length) throw new Error('INTENT_IDS_CHANGED_UNEXPECTEDLY')
  const report = { originalVersion: baseline.ONTOLOGY_VERSION, experimentalVersion: next.ONTOLOGY_VERSION,
    same_resolver_source: true, original_source_hashes: before, originals_unchanged: unchanged,
    regression_probe_count: originals.length, changed_originals: changed,
    cases, unresolved_supplier_mapping: additions.map(a => a.intent),
    deployed: false, approved_vocabulary: false, phase1_ready: false }
  return { payload: extended, code: compiledNext.code, resolver: next, report }
}

export async function experiment(sourceRoot) {
  return (await prepareUnifiedCpo(sourceRoot)).report
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const result = await experiment(process.env.FARQ_CONSTRUCTION_SOURCE)
  console.log(JSON.stringify(result, null, 2))
  if (result.changed_originals.length) process.exitCode = 1
}
