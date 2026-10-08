// Fails when a hard-coded colour appears outside the token file.
// Allowed: src/styles/tokens.css (the definitions), src/dev/** (dev-only harness).
// Legacy (reskinned in M6, tracked): src/components/procurement/**.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
const ALLOW = [/src\/styles\/tokens\.css$/, /src\/dev\//]
// Copied from فرق بناء (headers say so): kept byte-for-byte except the source header.
const LEGACY = [/src\/components\/procurement\//, /src\/lib\/requestFile\.ts$/]
const RX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])|rgba?\(\s*\d/g
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
let bad = 0, legacy = 0
for (const f of walk('src').filter((p) => /\.(tsx?|css)$/.test(p))) {
  if (ALLOW.some((r) => r.test(f))) continue
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const hits = line.match(RX)
    if (!hits) return
    if (LEGACY.some((r) => r.test(f))) { legacy += hits.length; return }
    bad += hits.length
    console.error(`${f}:${i + 1}  ${hits.join(' ')}`)
  })
}
if (legacy) console.warn(`(copied فرق بناء files carry ${legacy} hard-coded colours, unused by the new screens; dialogs reskinned in M6)`)
if (bad) { console.error(`\n${bad} hard-coded colour(s). Use var(--color-…) from src/styles/tokens.css.`); process.exit(1) }
console.log('lint-tokens: clean')
