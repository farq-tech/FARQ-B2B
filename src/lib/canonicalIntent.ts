/**
 * THE PRODUCER FOR THE CANONICAL INTENT CONTRACT.
 *
 * The API has been able to receive the resolver's answer for some time —
 * `adoptResolution` on the API side is written to take it verbatim, with
 * "pooling eligibility is TAKEN, not computed" written into it. Nothing ever
 * sent one. The field appeared only at the consumption site, with zero
 * producers anywhere, so the API always fell through to its own weaker
 * classification, which speaks a different vocabulary: it calls a wooden door
 * `door_wood` where the ontology calls it `wooden_door`.
 *
 * The consequence was measured rather than guessed: across 2,417 real booklet
 * lines, ZERO reached an intent id the supplier map is keyed on. Nothing
 * errored. Both sides were internally consistent and neither had ever asked
 * the other what it called things.
 *
 * This module is the sender. It is deliberately thin — it resolves the line
 * with the resolver that owns the vocabulary and states the answer in the
 * contract's shape. It does not re-implement any part of the resolution, and
 * it never invents an id.
 */

import { FAMILIES, ONTOLOGY_VERSION, isKnownIntentId, normalizeProcurementText, resolveOntology } from './procurementOntology'

/** Bumped when the wire shape changes in a way the receiver must react to. */
export const CANONICAL_INTENT_CONTRACT_VERSION = 1

export type CanonicalIntentStatus =
  /** An intent id the ontology recognises. The only value that may key the map. */
  | 'CANONICAL'
  /** The resolver looked and could not name this line. Still a real product. */
  | 'UNRESOLVED'
  /** The resolver looked and there is nothing to buy here. */
  | 'NOT_SUPPLY'

/**
 * What travels on the wire for one line.
 *
 * This is the resolver's own resolution, plus one field: `canonical_intent_id`,
 * named explicitly so the identity is a CONTRACT and not a field that happens
 * to line up. The rest is passed through unchanged, because the receiver was
 * built to take it verbatim and any reshaping here would be a second place
 * where the two sides could disagree.
 */
export type OntologyResolutionWire = {
  contract_version: number
  ontology_version: string
  /** An id the ontology recognises, or null. Never a locally-invented name. */
  canonical_intent_id: string | null
  canonical_intent_status: CanonicalIntentStatus
  /**
   * TRUE ONLY WHEN THE RESOLVER SAID SO.
   *
   * Carried because the receiver takes it rather than computing it, which is
   * the correct direction: this side is the one that knows.
   */
  poolable: boolean
  not_supply: boolean
} & Record<string, unknown>

/**
 * Resolve one line into the wire shape.
 *
 * Returns `null` when there is no line text to resolve. Sending nothing is a
 * legitimate state the receiver handles as ABSENT — an explicit "I looked and
 * found nothing" is a different claim and must not be manufactured here.
 */
/**
 * WHAT THE LINE IS, NOT WHAT IS BEING DONE TO IT.
 *
 * Saudi booklets open almost every line with «توريد وتركيب واختبار وتشغيل».
 * Those four words say nothing about the material and they are a third of the
 * sentence, so they drag the match score below its floor: «مغسلة جراحية ستانلس
 * بدون لمس» resolves on its own and resolves to NOTHING with the prefix in
 * front of it. Measured on the owner's hospital booklet, that alone accounted
 * for most of the 56 unrecognised lines out of 66.
 *
 * The prefix is removed for RESOLUTION only. The buyer still sees the line as
 * his booklet printed it.
 */
// «و» may stand apart from its verb: booklets print «توريد و تركيب و اختبار»
// as often as «توريد وتركيب واختبار», and the prefix must go either way.
const SUPPLY_PREFIX =
  /^(?:\s*(?:و\s*)?(?:توريد|تركيب|تنفيذ|اختبار|إختبار|أختبار|تشغيل|ضمان|فحص|صيانة|صيانه|تجهيز|توصيل|أعمال|اعمال|عمل)[\s،:.\/-]*)+/

/**
 * THE LAM-ALEF THE PDF TURNED ROUND.
 *
 * Many booklets are exported with the «لا» ligature written back to front, so
 * «بلاط» arrives as «بالط», «سلالم» as «ساللم» and «كابلات» as «كابالت». The
 * letters are all there, in the wrong order, and no term can match them.
 *
 * A blanket swap would break far more than it fixes: «اعمال» and «اتصال» end in
 * the same two letters and are right as printed. So a word is turned back only
 * when it is NOT a word we know and its turned form IS one. The known words are
 * the ontology's own vocabulary, plus the few connectives a booklet wraps
 * around it. Matching only. The buyer still sees the line as printed.
 */
const PROCLITICS = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ب', 'ل', 'ف']

const LAM_ALEF_WORDS: Set<string> = (() => {
  const words = new Set<string>([
    'بلاط', 'بلاطات', 'سلالم', 'سلالم', 'كابلات', 'طاولات', 'طاوله', 'توصيلات', 'وصلات',
    'شاملا', 'كاملا', 'لازمه', 'اللازمه', 'اشعه', 'ارضيات', 'انذار', 'الانذار', 'لانهاء',
    'بلاستيك', 'بلاستيكي', 'زلاجه', 'شلال', 'علاقه', 'علامات', 'اغلاق', 'فلاتر', 'بلاك',
  ])
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(collect)
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.endsWith('_terms') && Array.isArray(value)) {
        for (const term of value) {
          for (const word of normalizeProcurementText(String(term)).split(' ')) {
            if (word.length >= 3) words.add(word)
          }
        }
      } else if (typeof value === 'object') collect(value)
    }
  }
  collect(FAMILIES)
  return words
})()

function isKnownWord(word: string): boolean {
  if (LAM_ALEF_WORDS.has(word)) return true
  for (const p of PROCLITICS) {
    if (word.startsWith(p) && word.length - p.length >= 3 && LAM_ALEF_WORDS.has(word.slice(p.length))) return true
  }
  return false
}

function turnLamAlef(word: string): string {
  if (!word.includes('ال') || isKnownWord(word)) return word
  // «األنذار» → «الأنذار»: the article before an alef word, turned round.
  const article = word.replace(/اال/g, 'الا')
  if (article !== word && isKnownWord(article)) return article
  for (let i = 1; i < word.length - 1; i += 1) {
    if (word[i] !== 'ا' || word[i + 1] !== 'ل') continue
    const turned = word.slice(0, i) + 'لا' + word.slice(i + 2)
    if (isKnownWord(turned)) return turned
  }
  return word
}

export function repairLamAlef(text: string): string {
  const normalized = normalizeProcurementText(text)
  return normalized.split(' ').map(turnLamAlef).join(' ')
}

export function forMatching(lineName: string | null | undefined): string {
  const name = String(lineName || '').trim()
  const stripped = repairLamAlef(name).replace(SUPPLY_PREFIX, '').trim()
  // Never strip a line down to nothing: «أعمال الخرسانة» is all prefix and is
  // still the only thing the line says.
  return stripped.length >= 4 ? stripped : repairLamAlef(name)
}

export function buildOntologyResolution(lineName: string | null | undefined): OntologyResolutionWire | null {
  const name = String(lineName || '').trim()
  if (!name) return null

  const resolution = resolveOntology(forMatching(name))

  /*
   * THREE DISTINCT OUTCOMES, AND THEY MUST STAY DISTINCT.
   *
   * `NOT_SUPPLY` is a positive statement that there is nothing to buy — a
   * heading, a preamble, a subtotal. `UNRESOLVED` says the opposite: this is a
   * real product we could not identify. Collapsing the second into the first
   * would tell a buyer we checked for suppliers and found none, when in truth
   * we never worked out what the line was.
   */
  const notSupply = resolution.debug?.not_supply === true || resolution.intent === 'not_supply'
  const canonical =
    !notSupply && resolution.intent && isKnownIntentId(resolution.intent) ? resolution.intent : null

  return {
    ...resolution,
    contract_version: CANONICAL_INTENT_CONTRACT_VERSION,
    ontology_version: ONTOLOGY_VERSION,
    canonical_intent_id: canonical,
    canonical_intent_status: notSupply ? 'NOT_SUPPLY' : canonical ? 'CANONICAL' : 'UNRESOLVED',
    poolable: resolution.poolable === true,
    not_supply: notSupply,
  }
}

/**
 * Attach the resolver's answer to a set of request lines.
 *
 * Kept as a helper rather than inlined at each call site so that a new caller
 * cannot accidentally ship the un-resolved shape — which is exactly how the
 * field came to have a consumer and no producer.
 */
export function withOntologyResolution<T extends { farq_spec_id?: string; name_ar?: string; name_en?: string }>(
  lines: T[],
): Array<T & { ontology_resolution: OntologyResolutionWire | null }> {
  return lines.map((line) => ({
    ...line,
    ontology_resolution: buildOntologyResolution(line.name_ar || line.name_en),
  }))
}
