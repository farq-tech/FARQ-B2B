// Copied from فرق بناء (read-only source): farqconstraction/src/lib/lineResolution.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
/**
 * WHAT EACH LINE IS, WORKED OUT ONCE AND OFF THE PAGE.
 *
 * Naming a line's material costs 4-6 ms, and the match path did it three times
 * per line (its own name, its description, the line above for context): about
 * 15-20 s for a 1,514-line booklet on a laptop and over a minute on a phone,
 * all of it on the page's only thread. The phone browser killed the frozen tab
 * and reloaded it («الصفحة تقفل وتبدأ من جديد»). The same rules now run once
 * per line in a Web Worker; without a worker they run in small slices that
 * hand the screen back between them.
 */
import { buildOntologyResolution, type OntologyResolutionWire } from './canonicalIntent'

export type LineInput = { name: string; spec?: string }
export type LineResolution = OntologyResolutionWire | null

const CONTEXT_REACH = 8

function named(r: LineResolution): boolean {
  return Boolean(r?.canonical_intent_id || r?.family)
}

const CONTINUATION_OPENERS =
  /^(?:نفس|مثل|كما|كذلك|مثله|ذات|بنفس|بمقاس|مقاس|قطر|بقطر|سماكه|سماكة|بسماكه|بسماكة|طول|بطول|عرض|بعرض|ارتفاع|بارتفاع|لون|بلون|قياس|بقياس|حجم|بحجم|سعه|سعة|بسعه|بسعة|same|ditto|idem|as above|do\.)(?:\s|$)/i
const SIZE_ONLY =
  /^[\d\s.,×x*\/\-–]+(?:مم|سم|م|ملم|انش|بوصه|بوصة|كجم|كغم|لتر|mm|cm|m|inch|in|kg|l|kw|v|a|hp|w)?\.?\s*$/i

/**
 * A line that only varies the line above it: «نفس البند السابق مقاس 200»,
 * «بقطر 4 بوصة», «200 x 100 مم». Only such a line borrows the material named
 * above it. A bare weak word («كاميرا») or an unknown product («SD-WAN») after
 * a cable line is not a cable, however close it sits: measured, the old rule
 * named eight bare words after one cable line «cable accessories» at Level A.
 */
export function looksLikeContinuation(name: string): boolean {
  const text = String(name || '')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return false
  return CONTINUATION_OPENERS.test(text) || SIZE_ONLY.test(text)
}

/** The rules the match request used to apply per row, applied once per line. */
export function resolveLinesSync(lines: LineInput[], onEach?: (i: number) => void): LineResolution[] {
  const out: LineResolution[] = []
  let last: { name: string; at: number } | null = null
  lines.forEach((line, i) => {
    const own = buildOntologyResolution(line.name)
    let resolved: LineResolution = own
    if (!named(own)) {
      resolved = buildOntologyResolution([line.name, line.spec].filter(Boolean).join(' ').slice(0, 400)) || own
    }
    const context = last && i - last.at <= CONTEXT_REACH ? last.name : ''
    if (named(own)) last = { name: line.name, at: i }
    if (!named(resolved) && !resolved?.not_supply && context && looksLikeContinuation(line.name)) {
      const inherited = buildOntologyResolution(`${context} ${line.name}`.slice(0, 400))
      if (named(inherited)) resolved = { ...(inherited as OntologyResolutionWire), inherited_from_line_above: true } as LineResolution
    }
    out.push(resolved)
    onEach?.(i)
  })
  return out
}

/** Main-thread fallback that yields every few lines so the page never freezes. */
async function resolveLinesSliced(lines: LineInput[]): Promise<LineResolution[]> {
  const out: LineResolution[] = []
  const SLICE = 15
  for (let i = 0; i < lines.length; i += SLICE) {
    // Context crosses slice boundaries, so resolve with the previous lines in view.
    const from = Math.max(0, i - CONTEXT_REACH)
    const part = resolveLinesSync(lines.slice(from, i + SLICE))
    out.push(...part.slice(i - from))
    await new Promise((r) => setTimeout(r, 0))
  }
  return out
}

export async function resolveLinesOffThread(lines: LineInput[]): Promise<LineResolution[]> {
  if (!lines.length) return []
  if (typeof Worker === 'undefined') return resolveLinesSliced(lines)
  try {
    const worker = new Worker(new URL('./lineResolution.worker.ts', import.meta.url), { type: 'module' })
    const result = await new Promise<LineResolution[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker timeout')), 180_000)
      worker.onmessage = (event: MessageEvent<{ resolutions?: LineResolution[]; error?: string }>) => {
        clearTimeout(timer)
        if (event.data.error || !event.data.resolutions) reject(new Error(event.data.error || 'worker failed'))
        else resolve(event.data.resolutions)
      }
      worker.onerror = (event) => {
        clearTimeout(timer)
        reject(new Error(event.message || 'worker error'))
      }
      worker.postMessage({ lines })
    })
    worker.terminate()
    return result
  } catch {
    return resolveLinesSliced(lines)
  }
}
