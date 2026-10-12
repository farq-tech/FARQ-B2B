import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { prepareUnifiedCpo } from './cpo-extension-experiment.mjs'
const output = path.resolve('services/goal-foundation/.runtime')
const { payload, code, report } = await prepareUnifiedCpo(process.env.FARQ_CONSTRUCTION_SOURCE)
if (report.changed_originals.length) throw new Error('CONSTRUCTION_REGRESSION')
fs.mkdirSync(output, { recursive: true })
const files = { 'procurement-ontology.data.json': JSON.stringify(payload), 'procurement-ontology.resolver.cjs': code }
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(output, name), content)
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ version: payload.version, source: report.original_source_hashes,
  hashes: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, crypto.createHash('sha256').update(content).digest('hex')])), isolated: true }, null, 2))
console.log(JSON.stringify({ output, version: payload.version, unchangedConstructionProbes: report.regression_probe_count }))
