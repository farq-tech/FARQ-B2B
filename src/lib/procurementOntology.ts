/**
 * Compositional Procurement Ontology (CPO) — resolver cascade.
 *
 *   BOQ LINE → Normalization → Lexicon/Dictionary → Family Resolver → Intent Resolver
 *           → Facet Extraction → Supplier Archetypes → Veto/Negative Rules → Retrieval
 *
 * Division of responsibility:
 *   Dictionary = the language · Ontology = the thing · Facets = the specs
 *   Supplier archetypes = who sells it · Veto = who cannot sell it
 *
 * Four EXPLICIT levels on every resolution: sector → family → category → intent.
 *
 * Three-tier term rule (enforced here, not only in the data):
 *   - a STRONG term may decide on its own
 *   - a WEAK term may decide only together with a CONTEXT term
 *   - a WEAK term alone NEVER decides
 *
 * Terms, archetypes and veto rules INHERIT down sector → family → category →
 * intent. An intent adds only its own exceptions, so tightening one sector does
 * not mean editing hundreds of entries.
 */
import ontologyData from './procurementOntology.data.json'

/* ------------------------------ types ---------------------------------- */

/**
 * THREE levels. This is the contract the AI gate and the retrieval lane both
 * read, so it must not grow a fourth member.
 *
 *   A = specific_intent — exact intent
 *   B = family          — family resolved, usable WITHOUT AI
 *   C = unresolved      — unresolved locally; AI runs only here, and only after
 *                         every local attempt has failed
 */
/**
 * The B value is `local_resolved`, NOT `family`.
 *
 * It used to be `family`, and that name was a lie: a semantic-recovery line is
 * Level B yet carries `family === null`. Two sibling lanes read `level` and
 * reached opposite conclusions from it — one counted B as 384, the other as 329
 * — so the field is now named after what it actually guarantees (resolved
 * locally, no model needed) rather than after a field that may be null.
 *
 * To decide whether a line has a real family to pool on, read `poolable`.
 */
export type ResolutionLevel = 'specific_intent' | 'local_resolved' | 'unresolved'

/** A/B/C, so a consumer never has to pattern-match on the value strings. */
export type LevelCode = 'A' | 'B' | 'C'

/**
 * Metadata *inside* Level C. These are not levels: every C line is unresolved,
 * and these fields only describe what happened to it after that.
 *   ai_eligible — lexical AND ontology AND semantic resolution all failed, so
 *                 the model may be called
 *   rejected    — nothing identifiable (or not a supply line); never sent
 *
 * There is no `semantic_recovered` bucket: a successful local semantic recovery
 * terminates locally and is Level B, never C.
 */
export type UnresolvedBucket = 'ai_eligible' | 'rejected'

export type AiResult = 'accepted' | 'rejected' | 'not_run'

/**
 * HOW a line resolved. On Level B this distinguishes a decisive ontology match
 * from a semantic recovery — the distinction stays visible without becoming a
 * separate level.
 */
export type ResolutionSource =
  | 'lexicon'
  | 'ontology_intent'
  | 'ontology_family'
  | 'semantic_recovery'
  | 'ai'
  | 'unresolved'

export type DecisionTier = 'strong' | 'weak_with_context' | 'none'

export type FacetValues = Record<string, string>

export type ResolvedFacet = { name: string; value: string; supplier_pool_affecting: boolean }

export type OntologyResolution = {
  level: ResolutionLevel
  source: ResolutionSource
  /** A/B/C for the same `level`, so no lane parses value strings. */
  level_code: LevelCode
  /**
   * True only when a CONFIDENT family or intent was resolved, i.e. `pool_key`
   * is set. This is the flag that governs CONSUMPTION: only a poolable line may
   * key a supplier pool, a cache entry, or `intent_supplier_map`. A Level B
   * semantic recovery is `poolable: false` — it reports as resolved and costs
   * no AI call, but it must never pin a supplier pool to a guessed trade.
   */
  poolable: boolean
  /** The four explicit levels. */
  sector: string | null
  family: string | null
  category: string | null
  intent: string | null
  domain: string
  facets: FacetValues
  resolved_facets: ResolvedFacet[]
  /** Only pool-affecting facets belong in a retrieval / cache key. */
  pool_affecting_facets: FacetValues
  search_terms: string[]
  supplier_terms: string[]
  preferred_archetypes: string[]
  allowed_archetypes: string[]
  soft_conflicts: string[]
  hard_conflicts: string[]
  negative_terms: string[]
  confidence: number
  raw: string
  head_concept: string
  /** Batch dedupe key: intent when specific, else family. */
  pool_key: string | null
  /** Cache key for the sibling AI/cache lane: version + pool + pool-affecting facets. */
  cache_key: string | null
  /** Level C metadata. `null` on Level A and B — those never reach the model. */
  unresolved_bucket: UnresolvedBucket | null
  /** The AI gate reads this. True only inside Level C. */
  ai_eligible: boolean
  /** Every Level C line has had the local semantic pass run on it first. */
  semantic_attempted: boolean
  ai_result: AiResult
  debug: {
    normalized: string
    matched_term: string | null
    decided_by: DecisionTier
    elapsed_ms: number
    not_supply?: boolean
    /** Set when the chain was derived upward from a unique strong intent term. */
    derived_from_intent?: string
  }
}

/**
 * A condition attached to specific terms, so a term can be decisive in one
 * context and inert in another WITHOUT splitting it into a new alias.
 *
 * The three-tier rule (strong decides / weak+context decides / weak alone never
 * decides) turned out to be necessary but not sufficient. Measuring 10,219 real
 * tender lines produced 434 confident-but-wrong resolutions, and all of them
 * share one shape: a term that is genuinely strong for its family fired on a
 * line where the surrounding words said it was something else. «قطاع» is
 * decisive for steel sections and inert on a 0.45 mm gypsum stud; «كابل» is
 * decisive for power cable and inert on a fibre line; «حريق» is a product for
 * fire fighting and an ADJECTIVE on fire-rated MDF.
 *
 * A guard expresses that directly:
 *   require_any     — the term is inert unless one of these appears in the line
 *   block_any       — the term is inert if any of these appears in the line
 *   blocked_by_head — the term is inert when the PRODUCT HEAD is one of these,
 *                     i.e. the term is the object being acted on, not the
 *                     product being bought («عزل مواسير» is insulation,
 *                     «حامل ماسورة» is a support — neither is a pipe)
 *
 * Guards are ontology CONTENT, declared in the data and inherited down the
 * chain like terms are. They are not per-line patches.
 */
type TermGuard = {
  terms: string[]
  require_any?: string[]
  block_any?: string[]
  blocked_by_head?: string[]
  note?: string
}

type TermTiers = {
  strong_terms?: string[]
  weak_terms?: string[]
  context_terms?: string[]
  term_guards?: TermGuard[]
}

type ArchetypeRules = {
  preferred_archetypes?: string[]
  allowed_archetypes?: string[]
  soft_conflicts?: string[]
  hard_conflicts?: string[]
  hard_conflict_exceptions?: string[]
  soft_conflict_exceptions?: string[]
  negative_terms?: string[]
  supplier_terms?: string[]
}

type FacetRef = { name: string; supplier_pool_affecting?: boolean }

type RawFacet = {
  kind: 'enum' | 'measure'
  label_ar: string
  supplier_pool_affecting?: boolean
  pattern?: string
  values?: Record<string, string[]>
}

type RawIntent = TermTiers &
  ArchetypeRules & {
    id: string
    label_ar?: string
    requires?: string[]
    facets?: FacetRef[]
    confidence?: number
  }

type RawCategory = TermTiers &
  ArchetypeRules & {
    id: string
    label_ar?: string
    facets?: FacetRef[]
    intents?: RawIntent[]
  }

type RawFamily = TermTiers &
  ArchetypeRules & {
    id: string
    sector: string
    label_ar?: string
    facets?: FacetRef[]
    categories?: RawCategory[]
    intents?: RawIntent[]
  }

type RawSector = TermTiers & ArchetypeRules & { domain: string }

/**
 * An opener adopted on one or two observations is not a measured rule, and the
 * distinction has to survive in the artifact rather than in a handoff note —
 * hence `provisional` and `observations` on the payload side of this type.
 */
/** Which register a piece of text belongs to. The question is shared; the rule is not. */
export type ClauseRegister = 'boq_line' | 'supplier_prose'

export type ClauseRule = {
  register: ClauseRegister
  opens_at_index_0: boolean
  provisional_review?: { after_booklet_lines: number; booklet_lines_seen: number }
  attribute_clause_keys: { register: string; keys: string[] }
  preposition_clause_keys: {
    register: string
    keys: Array<{ key: string; observations: number; provisional: boolean }>
  }
  proclitic_clause_openers: {
    register: string
    openers: Array<{
      prefix: string
      min_stem: number
      observations: number
      provisional: boolean
      evidence: string
    }>
  }
  rejected_openers: {
    openers: Array<{ prefix?: string; key?: string; observations: number; reason: string }>
  }
}

const DATA = ontologyData as unknown as {
  version: string
  learning: { promote_after_occurrences: number }
  clause_rule: ClauseRule
  supplier_clause_rule: ClauseRule
  archetypes: Record<string, { label_ar: string; patterns: string[] }>
  facets: Record<string, RawFacet>
  sectors: Record<string, RawSector>
  families: RawFamily[]
}

export const ONTOLOGY_VERSION = DATA.version
export const ARCHETYPES = DATA.archetypes
export const FAMILIES = DATA.families
export const SECTORS = DATA.sectors
export const FACET_DEFS = DATA.facets
/** Exported so a consumer can derive the clause vocabulary instead of mirroring it. */
export const CLAUSE_RULE = DATA.clause_rule
export const SUPPLIER_CLAUSE_RULE = DATA.supplier_clause_rule
const CLAUSE_RULES: Record<ClauseRegister, ClauseRule> = {
  boq_line: DATA.clause_rule,
  supplier_prose: DATA.supplier_clause_rule,
}

/* --------------------------- normalization ------------------------------ */

const ARABIC_INDIC = /[\u0660-\u0669]/g

/**
 * Superscript digits, which carry real meaning in this domain: a cable is sized
 * in «مم²» and concrete in «م³». Left unfolded, «مم²» never matched the «مم2»
 * vocabulary, so the cross-section — the strongest evidence that a line is a
 * cable at all — was invisible on every cable line in a 10,219-line catalogue.
 */
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
}

/** Matching-only normalization. Never rewrites the buyer's visible line. */
export function normalizeProcurementText(text: string): string {
  return String(text || '')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (d) => SUPERSCRIPT_DIGITS[d])
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[×xX*ｘ]/g, 'x')
    // A decimal point inside a number is part of the number: «2.5mm2» is a
    // 2.5 mm² cable, not a 2 and a 5.
    .replace(/(\d)\.(\d)/g, '$1\u0001$2')
    .replace(/[-–—_/\\،,.:;()[\]{}"'“”«»]+/g, ' ')
    .replace(/\u0001/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(UNIT_GLUED, '$1 $2')
    .replace(PREFIX_GLUED, '$1 $2')
    .trim()
}

/**
 * Technical shorthand is written both ways: «35mm2» and «35 mm2», «220V» and
 * «220 V», «DN110» and «DN 110», «2kW» and «2 kW». Terms and lines both pass
 * through here, so the two spellings meet on one form, and a unit written
 * against its number («220v») still counts as the context word «v» that the
 * three-tier rule needs. Only unit words follow a number; «cat6», «om3»,
 * «ip54» and «m20» are product names and stay whole.
 */
const UNIT_GLUED = /(\d)(mm2|sqmm|mm|cm|kva|kv|kw|hp|hz|rpm|bar|inch|v|a|w)\b/g
const PREFIX_GLUED = /\b(dn|pn|sch|nps)(\d)/g

const LEAD_VERBS =
  /^(?:و?توريد\s+وتركيب|و?توريد|و?تركيب|و?تنفيذ|اعمال|عمل|شراء|supply\s+and\s+install|supply\s*&\s*install|supply|install(?:ation)?\s+of|install)\s+/

const PURE_SERVICE =
  /(?:اجور\s*تركيب\s*فقط|اجور\s*فقط|صيانه\s*فقط|عماله\s*(?:بلا|بدون)\s*ماده|labor\s*only|installation\s*only|اختبار\s*وتشغيل\s*فقط)/

/**
 * Earthwork is work, not a material. «حفر وردم ودك» used to resolve to sand
 * fill at Level A on the strength of «ردم», and a sand supplier was asked to
 * price an excavation. A line that names earthwork and no material or supply
 * word is refused like any other labour-only line. «توريد رمل ردم» still buys
 * sand: it names the material.
 */
const EARTHWORK =
  /(?:^|\s)(?:اعمال\s+)?(?:حفر|حفريات|ردم|دك|هدم|ازاله|ازالات|تسويه|excavation|excavating|backfill|backfilling|compaction|demolition|earthworks?)(?:\s|$)/
const NAMES_A_MATERIAL = /(?:توريد|supply|رمل|بحص|تربه|مواد|خرسانه|اسفلت|بلوك|حجر|sand|gravel|aggregate|soil|material)/
function isWorkOnly(normalized: string): boolean {
  return PURE_SERVICE.test(normalized) || (EARTHWORK.test(normalized) && !NAMES_A_MATERIAL.test(normalized))
}

/** Boilerplate tails the booklets append after the product name. */
const BOILERPLATE_MARKERS = [
  'واجهه تشغيل رقميه',
  'ملحقات التشغيل الاساسيه',
  'دقه مناسبه للاستخدام المهني',
  'مطابقه لمواصفات الشركه المصنعه',
  'نسخه مختبريه',
  'نسخه مؤسسيه',
  'مطابق لمعايير التشغيل',
  'مزود بخصايص التكرار',
  'واجهه اداره امنه',
  'اطوال تجاريه',
  'عرض قياسي',
  'شهاده مطابقه',
  'حسب المواصفات',
]

/** Generic tokens that can never be a head concept on their own. */
const NON_CONCEPT_TOKENS = new Set([
  'جهاز', 'وحده', 'منصه', 'طقم', 'نظام', 'مجموعه', 'عدد', 'نوع', 'موديل', 'قطعه',
  'مقاس', 'حسب', 'مع', 'من', 'الى', 'او', 'فقط', 'كامل', 'كامله', 'صناعي', 'صناعيه',
  'محمول', 'ثنايي', 'رباعي', 'مزدوج', 'قياسي', 'عالي', 'متعدد', 'متعدده', 'بارتفاع',
  'سعه', 'بطول', 'سماكه', 'دعم', 'set', 'kit', 'type', 'unit', 'model', 'and', 'for',
  'with', 'the', 'complete', 'standard', 'industrial', 'high', 'dual', 'quad',
])

export function cutBoilerplate(normalized: string): string {
  let out = normalized
  for (const marker of BOILERPLATE_MARKERS) {
    const at = out.indexOf(marker)
    if (at > 0) out = out.slice(0, at)
  }
  return out.trim()
}

/** Head concept = what is being procured, with supply verb and tail removed. */
export function extractHeadConcept(normalized: string): string {
  let head = cutBoilerplate(normalized)
  for (let i = 0; i < 3; i++) {
    const next = head.replace(LEAD_VERBS, '')
    if (next === head) break
    head = next
  }
  return head.trim()
}

/* ---------------------------- term matching ----------------------------- */

const ARABIC_LETTER = /[\u0621-\u064A]/

/**
 * Arabic proclitics: the conjunctions و/ف and the definite article in its
 * attached forms. Declared once so «تجليد» matches «وتجليد», «الأدوات الصحية»
 * matches the «ادوات صحيه» vocabulary, and «رفوف» matches «للرفوف» — instead of
 * hand-writing an «ال» variant per term.
 */
const AR_PROCLITIC = '(?:[وف]?(?:بال|كال|لل|ال|ب|ك|ل)?)'

/**
 * Full-phrase boundaries. JavaScript `\b` is ASCII-only and silently fails
 * before Arabic letters, so boundaries are expressed as explicit Unicode
 * character classes. The leading guard is written as a consumed alternation
 * `(?:^|[^\p{L}\p{N}])` rather than a lookbehind, for runtime compatibility;
 * the real term is capture group 1 and its offset is derived from the match.
 */
const LEAD_GUARD = '(?:^|[^\\p{L}\\p{N}])'
const TRAIL_GUARD = '(?![\\p{L}\\p{N}])'

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type CompiledTerm = { re: RegExp; probe: string }

const termCache = new Map<string, CompiledTerm>()

/**
 * One matching rule for every term, Arabic or Latin, single word or phrase:
 * optional proclitics on each Arabic word, whitespace-flexible joins, and hard
 * boundaries at both ends.
 */
/**
 * THE NISBA SUFFIX, which turns a material noun into the adjective naming the
 * thing made of it: «خشب» wood → «خشبي» wooden, «معدن» metal → «معدني»,
 * «زجاج» glass → «زجاجي». Arabic BOQs use the two interchangeably, so «باب
 * خشب» and «باب خشبي» are one product written two ways — and before this the
 * first stopped at the family while the second reached `wooden_door`, a whole
 * intent lost to one letter. Handling it as morphology rather than as an alias
 * per phrase is what makes it generalise: the proclitics above are prefixes,
 * this is the matching enclitic.
 */
/*
 * ARABIC MORPHOLOGY, TREATED AS A CLASS (the cpo-v10 rule, now on the line
 * side as well as the supply side — see `morphology_rule` in the payload).
 *
 *   INFLECTION changes the form of a word and keeps its meaning, so it is
 *   generated freely: proclitics, and the sound feminine plural, which
 *   REPLACES the taa marbuta rather than following it («لوحه» → «لوحات»).
 *   A rule that only appended could never reach it.
 *
 *   DERIVATION — the nisba — builds a new word that may name a different
 *   product: «خشب» wood → «خشبي» wooden, but «معدن» metal → «معدني», which
 *   also means mineral. So a bare word derives only where no family owns the
 *   derived form without also owning the base, computed from this payload's
 *   own vocabulary. Inside a multi-word term the neighbouring word has already
 *   pinned the trade, so derivation is free there: «باب زجاج» reaches «باب
 *   زجاجي», while «زجاج» alone never reaches «صوف زجاجي».
 *
 * Three rounds lost an intent to Arabic morphology and each was closed on its
 * own («باب خشب / خشبي», «ارضيات» reduced to «ارض», «لوحات» unreachable from
 * «لوحه»); this is the distinction that closes them together.
 */
const AR_NISBA_FORMS = ['يات', 'يين', 'يه', 'ي'] as const
const AR_SOUND_PLURAL = 'ات'

/**
 * The stem a nisba adjective is built on, or the word unchanged.
 *
 * Only the singular «ي» is stripped. Stripping the plural «يات» as well looked
 * symmetric and was wrong: it reduced «ارضيات» (floors) to «ارض» (ground), so
 * the floor-tiling family's strong term started matching «أرضية إيبوكسي» and
 * took epoxy flooring off an industrial coatings supplier. A plural suffix is
 * not a nisba, and shortening a stem is the only direction of this rule that
 * can manufacture a match.
 */
function nisbaStem(word: string): string {
  if (!word.endsWith('ي')) return word
  const stem = word.slice(0, -1)
  // A floor of three letters keeps words whose ending merely looks like a
  // nisba — «ري», «مايي» — from being shortened into a near-wildcard.
  return stem.length >= 3 ? stem : word
}

/**
 * WHO OWNS A WORD, so derivation is gated by measurement and not by a list:
 * every word of a deciding term, mapped to the families using it, plus the
 * bases whose feminine singular is also vocabulary («لوح» sheet beside «لوحه»
 * board, so «لوحات» belongs to the feminine and is withheld from the base).
 */
type MorphIndex = { owners: Map<string, Set<string>>; hasFeminine: Set<string> }
let morphIndexCache: MorphIndex | null = null

function morphIndex(): MorphIndex {
  if (morphIndexCache) return morphIndexCache
  const owners = new Map<string, Set<string>>()
  const add = (familyId: string, terms: string[] | undefined) => {
    for (const term of terms || []) {
      for (const word of normalizeProcurementText(term).split(' ')) {
        if (!word) continue
        let set = owners.get(word)
        if (!set) owners.set(word, (set = new Set()))
        set.add(familyId)
      }
    }
  }
  for (const family of DATA.families) {
    const walk = (node: { strong_terms?: string[]; weak_terms?: string[] }) => {
      add(family.id, node.strong_terms)
      add(family.id, node.weak_terms)
    }
    walk(family)
    for (const intent of family.intents || []) walk(intent)
    for (const category of family.categories || []) {
      walk(category)
      for (const intent of category.intents || []) walk(intent)
    }
  }
  const hasFeminine = new Set<string>()
  for (const word of owners.keys()) {
    if (word.endsWith('ه') && owners.has(word.slice(0, -1))) hasFeminine.add(word.slice(0, -1))
  }
  morphIndexCache = { owners, hasFeminine }
  return morphIndexCache
}

/** May `base` be derived into `form`? Only if no family owns the form but not the base. */
function derivationAllowed(base: string, form: string): boolean {
  const { owners } = morphIndex()
  const ownersOfForm = owners.get(form)
  if (!ownersOfForm) return true
  const ownersOfBase = owners.get(base)
  for (const family of ownersOfForm) {
    if (!ownersOfBase?.has(family)) return false
  }
  return true
}

/** Every surface form one Arabic vocabulary word may match, longest first. */
function arabicSurfaceForms(word: string, constrained: boolean): string[] {
  const stem = nisbaStem(word)
  const forms = new Set<string>([word, stem])
  // INFLECTION — free, because the meaning does not move.
  if (word.endsWith('ه')) {
    forms.add(`${word.slice(0, -1)}${AR_SOUND_PLURAL}`)
  } else if (!morphIndex().hasFeminine.has(stem)) {
    // Loanwords take the sound plural on the bare noun — «كابل» → «كابلات».
    forms.add(`${stem}${AR_SOUND_PLURAL}`)
  }
  // DERIVATION — free inside a phrase, gated when the word stands alone.
  for (const suffix of AR_NISBA_FORMS) {
    const derived = `${stem}${suffix}`
    if (constrained || derivationAllowed(stem, derived)) forms.add(derived)
  }
  return [...forms].sort((a, b) => b.length - a.length)
}

/** Longest prefix shared by every string, so it is safe to prefilter on. */
function commonPrefix(values: string[]): string {
  if (!values.length) return ''
  let prefix = values[0]!
  for (const value of values.slice(1)) {
    let i = 0
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i += 1
    prefix = prefix.slice(0, i)
    if (!prefix) break
  }
  return prefix
}

function compileTerm(term: string): CompiledTerm {
  const cached = termCache.get(term)
  if (cached) return cached
  const words = term.split(' ').filter(Boolean)
  // A neighbouring word is itself disambiguation, so a word inside a phrase is
  // allowed derivations that the same word alone is not.
  const constrained = words.length > 1
  const body = words
    .map((word) =>
      ARABIC_LETTER.test(word[0] || '')
        ? `${AR_PROCLITIC}(?:${arabicSurfaceForms(word, constrained).map(escapeRegex).join('|')})`
        : escapeRegex(word),
    )
    .join('\\s+')
  // The cheap necessary condition has to hold for EVERY form the word may
  // match, so it is the longest common PREFIX of those forms rather than the
  // stem: «لوحه» is not a substring of «لوحات», and probing the stem rejected
  // the text before the pattern could ever match the plural.
  const probe = words.reduce((longest, word) => {
    const candidate = ARABIC_LETTER.test(word[0] || '') ? commonPrefix(arabicSurfaceForms(word, constrained)) : word
    return candidate.length > longest.length ? candidate : longest
  }, '')
  const compiled: CompiledTerm = {
    re: new RegExp(`${LEAD_GUARD}(${body})${TRAIL_GUARD}`, 'u'),
    probe,
  }
  termCache.set(term, compiled)
  return compiled
}

/**
 * Matching is only meaningful on normalized text, because normalization is what
 * folds hamza, taa marbuta and yaa (الأدوات → الادوات, الصحية → الصحيه,
 * الإنشائي → الانشايي). Normalizing here rather than trusting callers makes the
 * guarantee real; the memo keeps the repeated head/full/supplier calls cheap.
 */
const haystackMemo = new Map<string, string>()
const termMemo = new Map<string, string>()

function ensureNormalized(text: string): string {
  const hit = haystackMemo.get(text)
  if (hit !== undefined) return hit
  const value = normalizeProcurementText(text)
  if (haystackMemo.size > 64) haystackMemo.clear()
  haystackMemo.set(text, value)
  return value
}

/** Vocabulary is a fixed finite set, so its normalization is cached for good. */
function normalizeTerm(term: string): string {
  const hit = termMemo.get(term)
  if (hit !== undefined) return hit
  const value = normalizeProcurementText(term)
  termMemo.set(term, value)
  return value
}

/** Index of `term` in `haystack`, or -1. Both sides are normalized first. */
export function termIndex(rawHaystack: string, rawTerm: string): number {
  const haystack = ensureNormalized(rawHaystack)
  const term = normalizeTerm(rawTerm)
  if (!term || !haystack) return -1

  const { re, probe } = compileTerm(term)
  if (probe && haystack.indexOf(probe) < 0) return -1
  const match = re.exec(haystack)
  if (!match) return -1
  return match.index + (match[0].length - match[1]!.length)
}

type TermHit = { term: string; index: number; score: number; inHead: boolean }

/**
 * ATTRIBUTE CLAUSES ARE DESCRIPTION, NOT PRODUCT.
 *
 * A Saudi BOQ line names the product first and then lists its attributes, each
 * one introduced by an explicit keyword: «وصلة PPR Elbow مقاس 50 مم **ربط**
 * Solvent Cement», «VCD Opposed Blade **مادة** Aluminium», «Backflow Preventer
 * **توصيل** Lug». The word after the keyword describes the product — it is not
 * the product.
 *
 * Treating that text as decidable is a single defect with many faces, and it
 * was the whole of a 5.84% confident-wrong rate on truly held-out batches:
 * `solvent` sent 1,984 pipe fittings to lubricants, `aluminium` sent 331 dampers
 * to façade systems, `lug` sent 64 backflow preventers to cable terminations.
 * The perverse consequence is that a MORE detailed line resolved WORSE, because
 * every added attribute was another chance for a stray word to win — the
 * opposite of what more text should do.
 *
 * The rule is positional, not a keyword blacklist: a term may decide only if
 * its match STARTS outside every attribute clause. That distinction is what
 * keeps «مقياس ضغط» working — the term starts at «مقياس», before the «ضغط»
 * clause opens — while refusing a bare «ضغط» that appears only as a value.
 */
const ATTRIBUTE_CLAUSE_KEYS = (register: ClauseRegister) =>
  CLAUSE_RULES[register].attribute_clause_keys.keys

/**
 * THE SAME CONSTRUCTION, SPOKEN THE OTHER WAY.
 *
 * The keyword list above was learned from generated archives, which introduce
 * an attribute with an explicit noun («... **مادة** الخرسانة المسلحة»). Real
 * booklets introduce the same attribute with a PREPOSITION («حديد تسليح
 * **للخرسانة** المسلحة»), and the proof that this is one construction rather
 * than two is that inserting the archive's keyword into the booklet's sentence
 * made it resolve correctly. The rule was right; its vocabulary came from one
 * register and was verified only there.
 *
 * Both lists, the refusals that shaped them, and each opener's observation
 * count now live in the PAYLOAD under `clause_rule` — not here. Two openers
 * rest on very little («بال» on 2 observations, «لال» on exactly 1) and are
 * flagged `provisional` there, where a future reader cannot mistake them for
 * measured rules. Keeping the vocabulary in versioned data also means a
 * consumer reads it rather than hand-copying it, which is how the supply side
 * came to be running v6's clause words against v7's payload.
 */
const PROCLITIC_CLAUSE_OPENERS = (register: ClauseRegister): Array<{ prefix: string; minStem: number }> =>
  CLAUSE_RULES[register].proclitic_clause_openers.openers.map((o) => ({
    prefix: o.prefix,
    minStem: o.min_stem,
  }))

/** Standalone prepositions, which can never be a product head. See `clause_rule`. */
const PREPOSITION_CLAUSE_KEYS = (register: ClauseRegister) =>
  CLAUSE_RULES[register].preposition_clause_keys.keys.map((k) => k.key)

/** Every occurrence of `term` in already-normalized `text`. */
function allTermIndices(text: string, term: string): number[] {
  const out: number[] = []
  let from = 0
  while (from < text.length) {
    const at = termIndex(text.slice(from), term)
    if (at < 0) break
    out.push(from + at)
    from += at + Math.max(term.length, 1)
  }
  return out
}

/**
 * Half-open character ranges holding attribute VALUES. A keyword at position 0
 * is the product itself («مقاس 100» as a whole line is not a description of
 * anything), so only openers with content before them open a clause.
 *
 * AN OPENER IS NOT PART OF THE VALUE IT INTRODUCES. The first version started
 * each region AT the keyword, which meant a term whose first word happened to
 * be a keyword could never decide anywhere except position 0 — «كابل تيار خفيف
 * 2x1.5» is an ordinary booklet line, and `voltage transformer`, `material
 * lift`, `thickness gauge`, `height rescue kit`, «ماده رابطه» and «ماده معالجه»
 * were all suppressed the same way. The supply side found this by implementing
 * the rule independently and testing it back against this resolver. So a
 * separate-token opener contributes its END as the value start, while a
 * PROCLITIC is glued to its value and contributes its own start.
 */
function attributeRegions(rawText: string, register: ClauseRegister): Array<[number, number]> {
  const text = ensureNormalized(rawText)
  if (!text) return []
  const rule = CLAUSE_RULES[register]
  // An empty vocabulary is a derived answer for supplier prose, not a gap.
  if (
    !rule.attribute_clause_keys.keys.length &&
    !rule.preposition_clause_keys.keys.length &&
    !rule.proclitic_clause_openers.openers.length
  ) {
    return []
  }
  // [where the clause is anchored, where its value begins]
  const opened: Array<[number, number]> = []

  const pushToken = (key: string) => {
    const normalized = normalizeTerm(key)
    if (!normalized) return
    for (const at of allTermIndices(text, normalized)) {
      if (at < 0) continue
      if (at === 0 && !rule.opens_at_index_0) continue
      opened.push([at, at + normalized.length])
    }
  }
  for (const key of ATTRIBUTE_CLAUSE_KEYS(register)) pushToken(key)
  for (const key of PREPOSITION_CLAUSE_KEYS(register)) pushToken(key)

  // Proclitics are recognised on word starts, and only when what follows is
  // long enough to be a noun rather than the rest of an ordinary word.
  for (const { prefix, minStem } of PROCLITIC_CLAUSE_OPENERS(register)) {
    let from = 0
    for (;;) {
      const at = text.indexOf(prefix, from)
      if (at < 0) break
      from = at + prefix.length
      if (at === 0 && !rule.opens_at_index_0) continue
      const before = text[at - 1]!
      if (/[\p{L}\p{N}]/u.test(before)) continue
      let end = at + prefix.length
      while (end < text.length && /[\u0621-\u064A]/.test(text[end]!)) end++
      if (end - (at + prefix.length) < minStem) continue
      // The value carries the proclitic, so a term matching it — which
      // `termIndex` reports at the proclitic's own position — falls inside.
      opened.push([at, at])
    }
  }

  if (!opened.length) return []
  opened.sort((a, b) => a[0] - b[0])
  const regions: Array<[number, number]> = []
  for (let i = 0; i < opened.length; i++) {
    const [anchor, valueStart] = opened[i]!
    // A clause runs to the next clause's anchor, or to end of line.
    let end = text.length
    for (let j = i + 1; j < opened.length; j++) {
      if (opened[j]![0] > anchor) {
        end = opened[j]![0]
        break
      }
    }
    if (valueStart < end) regions.push([valueStart, end])
  }
  return regions
}

const regionMemo = new Map<string, Array<[number, number]>>()
function attributeRegionsMemo(text: string, register: ClauseRegister): Array<[number, number]> {
  const memoKey = `${register}\u0000${text}`
  const hit = regionMemo.get(memoKey)
  if (hit !== undefined) return hit
  const value = attributeRegions(text, register)
  if (regionMemo.size > 64) regionMemo.clear()
  regionMemo.set(memoKey, value)
  return value
}

function startsInsideAttribute(index: number, regions: Array<[number, number]>): boolean {
  for (const [from, to] of regions) {
    if (index >= from && index < to) return true
  }
  return false
}

/**
 * PRODUCT-HEAD RULE. Arabic and English both put the product before the thing
 * it acts on: «عزل مواسير تكييف» is insulation for pipes, «Clevis Hanger
 * لمواسير DN100» is a hanger for pipes. Neither is a pipe. So a concept that
 * appears EARLIER in the head than the matched term identifies the product, and
 * the matched term is merely the object being described.
 *
 * Position, not mere presence, is what makes this general: «ماسورة معزولة»
 * (pre-insulated pipe) still resolves as a pipe, because there the pipe leads.
 */
function precededInHead(head: string, term: string, concepts: string[]): boolean {
  const termAt = termIndex(head, normalizeTerm(term))
  for (const concept of concepts) {
    const normalized = normalizeTerm(concept)
    if (!normalized) continue
    const at = termIndex(head, normalized)
    if (at < 0) continue
    // The term may sit outside the head entirely; any leading concept wins then.
    if (termAt < 0 || at < termAt) return true
  }
  return false
}

/** A term is inert when its guard's conditions are not met. */
function guardAllows(term: string, head: string, full: string, guards: TermGuard[]): boolean {
  const normalizedTerm = normalizeTerm(term)
  for (const guard of guards) {
    if (!guard.terms.some((t) => normalizeTerm(t) === normalizedTerm)) continue
    if (guard.require_any && !guard.require_any.some((t) => termIndex(full, normalizeTerm(t)) >= 0)) {
      return false
    }
    if (guard.block_any?.some((t) => termIndex(full, normalizeTerm(t)) >= 0)) return false
    if (guard.blocked_by_head && precededInHead(head, term, guard.blocked_by_head)) return false
  }
  return true
}

function bestHit(
  head: string,
  full: string,
  terms: string[] | undefined,
  guards?: TermGuard[],
  /**
   * Attribute clauses are skipped for DECIDING hits and honoured for the
   * fallback retry, so a term buried in a description still proves the line
   * speaks known vocabulary (Level B semantic recovery) without being allowed
   * to name the product.
   */
  allowAttributeText = false,
  /** Supplier prose is asked the same question under a different rule. */
  register: ClauseRegister = 'boq_line',
): TermHit | null {
  if (!terms?.length) return null
  const headRegions = allowAttributeText ? [] : attributeRegionsMemo(head, register)
  const fullRegions = allowAttributeText ? [] : attributeRegionsMemo(full, register)
  let best: TermHit | null = null
  for (const term of terms) {
    const normalized = normalizeTerm(term)
    if (!normalized) continue
    if (guards?.length && !guardAllows(term, head, full, guards)) continue
    let index = termIndex(head, normalized)
    const inHead = index >= 0
    if (index >= 0 && startsInsideAttribute(index, headRegions)) continue
    if (index < 0) {
      index = termIndex(full, normalized)
      if (index >= 0 && startsInsideAttribute(index, fullRegions)) continue
    }
    if (index < 0) continue
    const score = (inHead ? 1000 : 300) - index * 2 + normalized.length * 3
    if (!best || score > best.score) best = { term, index, score, inHead }
  }
  return best
}

/**
 * THE ENTIRE SHARED SURFACE, IN ONE FUNCTION.
 *
 * Both sides are asking one question — may this term name a product in this
 * text? — and five rules answer it: normalization, Arabic term compilation
 * (nisba and sound plurals), the attribute-clause regions, the opener-is-not-
 * part-of-the-value correction, and the position-0 exemption. A consumer that
 * reimplements the question reimplements all five, and the supply side is the
 * proof: it currently runs v6's clause words against a v7 payload, having
 * drifted on vocabulary alone while agreeing on the algorithm.
 *
 * This is what `fixtures/ontology/attribute-rule-conformance.json` publishes,
 * and it is the same code path the resolver itself uses — not a summary of it.
 * Depending on this function is one import; mirroring it is five rules and a
 * vocabulary that changes every version.
 */
export function termDecidesIn(
  text: string,
  term: string,
  register: ClauseRegister = 'boq_line',
): boolean {
  return bestHit(text, text, [term], undefined, false, register) !== null
}

export type TierDecision = { decided: boolean; tier: DecisionTier; hit: TermHit | null; score: number }

/**
 * The three-tier decision rule. Context terms may appear anywhere in the line;
 * strong and weak terms are preferred in the head concept.
 */
export function decideByTiers(head: string, full: string, tiers: TermTiers): TierDecision {
  // Guards apply to the positive signal only: a guarded term that is inert here
  // must not decide, but it may still provide context for some other family.
  const guards = tiers.term_guards
  const strong = bestHit(head, full, tiers.strong_terms, guards)
  if (strong) return { decided: true, tier: 'strong', hit: strong, score: strong.score + 400 }

  const weak = bestHit(head, full, tiers.weak_terms, guards)
  if (!weak) {
    // A guard removes a term's right to DECIDE, not the fact that the line
    // speaks known vocabulary. Returning the guarded-out hit keeps the line in
    // semantic recovery (honest Level B, searchable, never poolable) instead of
    // dropping it to an unresolved C — «Band Saw» is still a saw even where the
    // tool context needed to commit to a supplier pool is absent.
    // The retry drops BOTH eligibility rules — guards and the attribute-clause
    // rule — because both remove the right to DECIDE, not the fact that the
    // line speaks known vocabulary. It covers the STRONG tier too: a strong
    // term buried in an attribute clause («... ربط Solvent Cement») is
    // suppressed for exactly the same reason, and without this it would fall
    // past recovery into a false unknown.
    const guardedOut =
      bestHit(head, full, tiers.weak_terms, undefined, true) ??
      bestHit(head, full, tiers.strong_terms, undefined, true)
    return { decided: false, tier: 'none', hit: guardedOut, score: 0 }
  }

  // A TERM MAY NOT BE ITS OWN CONTEXT. Several families list a word in both
  // weak_terms and context_terms, which quietly promoted "weak alone" to
  // "weak + context" and defeated the three-tier rule: bare «filter» satisfied
  // itself and sent an irrigation filter disc to respirator filters, and bare
  // «حريق» sent a fire-RATED MDF board to fire fighting. Context must be a
  // SECOND, different signal.
  const weakTerm = normalizeTerm(weak.term)
  const contextTerms = tiers.context_terms?.filter((t) => normalizeTerm(t) !== weakTerm)
  // CONTEXT IS DESCRIPTION BY DEFINITION, so it is read from the whole line
  // including attribute clauses. «... مادة Aluminium» must not let `aluminium`
  // NAME the product, yet it is exactly the evidence that a weak «قطاع» is a
  // façade profile. The attribute rule restricts deciding, never corroborating.
  const context = bestHit(full, full, contextTerms, undefined, true)
  if (context) {
    return { decided: true, tier: 'weak_with_context', hit: weak, score: weak.score }
  }
  // Weak alone never decides — but it proves the line is not noise.
  return { decided: false, tier: 'none', hit: weak, score: 0 }
}

/* ------------------------ inheritance of rules -------------------------- */

function mergeTiers(...layers: (TermTiers | undefined)[]): TermTiers {
  const strong: string[] = []
  const weak: string[] = []
  const context: string[] = []
  const guards: TermGuard[] = []
  for (const layer of layers) {
    if (!layer) continue
    if (layer.strong_terms) strong.push(...layer.strong_terms)
    if (layer.weak_terms) weak.push(...layer.weak_terms)
    if (layer.context_terms) context.push(...layer.context_terms)
    // Guards inherit like veto does: declare once high, refine below.
    if (layer.term_guards) guards.push(...layer.term_guards)
  }
  return { strong_terms: strong, weak_terms: weak, context_terms: context, term_guards: guards }
}

type MergedRules = {
  preferred: string[]
  allowed: string[]
  soft: string[]
  hard: string[]
  negative: string[]
  supplier: string[]
}

/**
 * Veto is declared once at sector/family level and inherited. A lower level may
 * add its own conflicts, or drop an inherited one via *_exceptions.
 */
function mergeRules(...layers: (ArchetypeRules | undefined)[]): MergedRules {
  const preferred: string[] = []
  const allowed: string[] = []
  let soft: string[] = []
  let hard: string[] = []
  const negative: string[] = []
  const supplier: string[] = []

  for (const layer of layers) {
    if (!layer) continue
    if (layer.preferred_archetypes) preferred.push(...layer.preferred_archetypes)
    if (layer.allowed_archetypes) allowed.push(...layer.allowed_archetypes)
    if (layer.soft_conflicts) soft.push(...layer.soft_conflicts)
    if (layer.hard_conflicts) hard.push(...layer.hard_conflicts)
    if (layer.negative_terms) negative.push(...layer.negative_terms)
    if (layer.supplier_terms) supplier.push(...layer.supplier_terms)
    if (layer.hard_conflict_exceptions) {
      hard = hard.filter((a) => !layer.hard_conflict_exceptions!.includes(a))
    }
    if (layer.soft_conflict_exceptions) {
      soft = soft.filter((a) => !layer.soft_conflict_exceptions!.includes(a))
    }
  }

  const dedupe = (values: string[]) => [...new Set(values)]
  const preferredSet = dedupe(preferred)
  const allowedSet = dedupe(allowed).filter((a) => !preferredSet.includes(a))
  // Being preferred or allowed always wins over an inherited conflict.
  const qualified = new Set([...preferredSet, ...allowedSet])
  return {
    preferred: preferredSet,
    allowed: allowedSet,
    soft: dedupe(soft).filter((a) => !qualified.has(a)),
    hard: dedupe(hard).filter((a) => !qualified.has(a)),
    negative: dedupe(negative),
    supplier: dedupe(supplier),
  }
}

function mergeFacets(...layers: (FacetRef[] | undefined)[]): FacetRef[] {
  const byName = new Map<string, FacetRef>()
  for (const layer of layers) {
    if (!layer) continue
    for (const ref of layer) byName.set(ref.name, ref)
  }
  return [...byName.values()]
}

/* --------------------------- facet extraction --------------------------- */

const measureCache = new Map<string, RegExp>()

function measureRegex(pattern: string): RegExp {
  let re = measureCache.get(pattern)
  if (!re) {
    re = new RegExp(pattern, 'iu')
    measureCache.set(pattern, re)
  }
  return re
}

/**
 * Facets absorb the variation. `RHS 100x50x5 S355 galvanized` yields
 * section_type/dimensions/grade/finish — no alias per size.
 */
export function extractFacets(normalized: string, refs: FacetRef[]): ResolvedFacet[] {
  const out: ResolvedFacet[] = []
  for (const ref of refs) {
    const def = FACET_DEFS[ref.name]
    if (!def) continue
    const poolAffecting = ref.supplier_pool_affecting ?? def.supplier_pool_affecting ?? false

    if (def.kind === 'enum' && def.values) {
      let winner: { value: string; score: number } | null = null
      for (const [value, terms] of Object.entries(def.values)) {
        // An attribute clause is exactly where a facet value LIVES, so facets
        // read it. Without this, «باب صناعي مادة ألمنيوم» — which states its
        // material outright — yielded no material facet while «باب صناعي
        // ألمنيوم» did, so the explicit line split a pool-affecting facet LESS
        // than the implicit one. Facets describe; they never decide.
        const hit = bestHit(normalized, normalized, terms, undefined, true)
        if (hit && (!winner || hit.score > winner.score)) winner = { value, score: hit.score }
      }
      if (winner) out.push({ name: ref.name, value: winner.value, supplier_pool_affecting: poolAffecting })
      continue
    }
    if (def.pattern) {
      const match = measureRegex(def.pattern).exec(normalized)
      if (match) {
        const captured = match.slice(1).find((g) => g !== undefined)
        out.push({
          name: ref.name,
          value: String(captured ?? match[0]).trim(),
          supplier_pool_affecting: poolAffecting,
        })
      }
    }
  }
  return out
}

/* ------------------------- lexicon (dictionary) ------------------------- */

/**
 * Lexical layer: vocabulary, acronyms and Arabic↔English equivalents that make
 * the ontology understand the *language*. Every entry points at a family/intent
 * that already exists in the ontology — it holds no product SKUs.
 *
 * Lexicon entries are STRONG by definition; ambiguous vocabulary belongs in the
 * ontology's weak_terms instead.
 */
export type LexiconEntry = {
  terms: string[]
  family: string
  intent?: string
  confidence?: number
}

export const LEXICON: LexiconEntry[] = [
  // cladding vocabulary (كسوة / تجليد / تلبيس / cladding / covering)
  { terms: ['تجليد اعمده', 'كسوه اعمده', 'column cladding', 'تلبيس اعمده'], family: 'architectural_cladding', intent: 'column_cladding', confidence: 0.98 },
  { terms: ['تجليد', 'كسوه', 'تلبيس', 'cladding', 'كلادينج', 'الوكبوند'], family: 'architectural_cladding', intent: 'surface_cladding' },
  // fire vocabulary — «حنفية حريق» is fire fighting, never plumbing
  { terms: ['حنفيه حريق', 'fire hydrant', 'pillar hydrant', 'landing valve'], family: 'fire_fighting', intent: 'fire_hydrant', confidence: 0.96 },
  { terms: ['طفايه', 'طفايات', 'fire extinguisher'], family: 'fire_fighting', intent: 'fire_extinguisher' },
  { terms: ['sprinkler', 'رشاش حريق', 'esfr'], family: 'fire_fighting', intent: 'fire_sprinkler' },
  { terms: ['مضخه حريق', 'fire pump', 'jockey pump'], family: 'fire_fighting', intent: 'fire_pump_set' },
  // steel acronyms
  { terms: ['rhs', 'shs', 'chs', 'upn', 'upe', 'ipe', 'ipn', 'heb', 'hea', 'rectangular hollow section', 'square hollow section', 'circular hollow section'], family: 'structural_steel', intent: 'structural_steel_section' },
  // pump vocabulary (مضخة غاطسة ↔ submersible pump)
  { terms: ['مضخه غاطسه', 'submersible pump', 'dewatering pump', 'مضخه نزح'], family: 'pumps', intent: 'industrial_pump' },
  // measuring acronyms
  { terms: ['متر ليزر', 'laser distance meter', 'laser meter'], family: 'measuring_instruments', intent: 'laser_distance_meter' },
  { terms: ['clamp meter', 'كلامب ميتر', 'multimeter', 'افوميتر', 'megger'], family: 'measuring_instruments', intent: 'electrical_tester' },
  // ICT acronyms
  { terms: ['ups', 'uninterruptible power supply'], family: 'ups_power_backup' },
  { terms: ['pdu', 'rack pdu'], family: 'rack_power_distribution' },
  { terms: ['siem', 'edr', 'xdr', 'soar', 'hsm', 'pam', 'dlp'], family: 'cybersecurity_platforms' },
  { terms: ['qsfp', 'sfp', 'transceiver'], family: 'optical_transceivers' },
  { terms: ['nvr', 'network video recorder'], family: 'physical_security', intent: 'nvr' },
  { terms: ['kvm', 'kvm switch'], family: 'it_peripherals', intent: 'kvm_console' },
  // safety vocabulary
  { terms: ['ppe', 'personal protective equipment'], family: 'protective_clothing' },
  { terms: ['srl', 'self retracting lifeline', 'fall arrest'], family: 'fall_protection' },
]

/* --------------------------- index building ----------------------------- */

const FAMILY_BY_ID = new Map<string, RawFamily>(DATA.families.map((f) => [f.id, f]))

type IntentNode = { intent: RawIntent; category: RawCategory | null; family: RawFamily }

const INTENTS_BY_FAMILY = new Map<string, IntentNode[]>()
for (const family of DATA.families) {
  const nodes: IntentNode[] = []
  for (const intent of family.intents || []) nodes.push({ intent, category: null, family })
  for (const category of family.categories || []) {
    for (const intent of category.intents || []) nodes.push({ intent, category, family })
  }
  INTENTS_BY_FAMILY.set(family.id, nodes)
}

const INTENT_INDEX = new Map<string, IntentNode>()
const ALL_INTENT_NODES: IntentNode[] = []
for (const nodes of INTENTS_BY_FAMILY.values()) {
  for (const node of nodes) {
    INTENT_INDEX.set(node.intent.id, node)
    ALL_INTENT_NODES.push(node)
  }
}

/**
 * ANCESTOR DERIVATION — general rule, no per-intent special cases.
 *
 * A strong term that belongs to exactly one intent in the whole ontology
 * identifies that intent, and therefore identifies its whole chain:
 *
 *   «ptz camera» → DATACENTER_ICT → physical_security → video_surveillance → ptz_camera
 *
 * So the resolver derives sector/family/category upward from the intent instead
 * of requiring the term to be repeated at every level. Terms are declared once,
 * at the most specific level where they are true.
 */
const UNIQUE_STRONG_TERMS = new Map<string, IntentNode>()
{
  const owners = new Map<string, Set<string>>()
  for (const node of ALL_INTENT_NODES) {
    for (const term of node.intent.strong_terms || []) {
      const key = normalizeProcurementText(term)
      if (!key) continue
      if (!owners.has(key)) owners.set(key, new Set())
      owners.get(key)!.add(node.intent.id)
    }
  }
  for (const [key, intentIds] of owners) {
    if (intentIds.size !== 1) continue
    const node = INTENT_INDEX.get([...intentIds][0]!)
    if (node) UNIQUE_STRONG_TERMS.set(key, node)
  }
}

/** True when `term` is a strong term of exactly one intent in the ontology. */
export function isUniqueStrongTerm(term: string): boolean {
  return UNIQUE_STRONG_TERMS.has(normalizeProcurementText(term))
}

/* ----------------------- ID surface for sibling lanes ------------------- */

/**
 * THE ID CONTRACT.
 *
 * Two sibling lanes consume these lists and MUST NOT hardcode them:
 *   - the AI/cache lane validates model proposals against real vocabulary
 *     (`isKnownIntentId` / `isKnownFamilyId`), and
 *   - the Phase 2 lane keys `intent_supplier_map.intent_key` on `listIntentIds()`.
 *
 * A hardcoded copy in either lane rots silently the next time an intent splits.
 * `scripts/ontology-ids.mjs` emits the whole surface as JSON for lanes that
 * cannot import TypeScript directly.
 */

/** Every intent id the ontology can emit. Sorted, stable ordering. */
export function listIntentIds(): string[] {
  return [...INTENT_INDEX.keys()].sort()
}

/** Every family id the ontology can emit. Sorted, stable ordering. */
export function listFamilyIds(): string[] {
  return DATA.families.map((f) => f.id).sort()
}

export function listSectorIds(): string[] {
  return Object.keys(DATA.sectors).sort()
}

export function listCategoryIds(): string[] {
  const ids = new Set<string>()
  for (const family of DATA.families) {
    for (const category of family.categories || []) ids.add(category.id)
  }
  return [...ids].sort()
}

export function listArchetypeIds(): string[] {
  return Object.keys(DATA.archetypes).sort()
}

/** Validation helpers for the AI lane — reject anything not in the ontology. */
export function isKnownIntentId(id: string): boolean {
  return INTENT_INDEX.has(id)
}

export function isKnownFamilyId(id: string): boolean {
  return FAMILY_BY_ID.has(id)
}

export function isKnownArchetypeId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DATA.archetypes, id)
}

/** The full chain for an intent id, so a lane never has to infer ancestors. */
export function describeIntent(
  id: string,
): { sector: string; family: string; category: string | null; intent: string } | null {
  const node = INTENT_INDEX.get(id)
  if (!node) return null
  return {
    sector: node.family.sector,
    family: node.family.id,
    category: node.category?.id || null,
    intent: node.intent.id,
  }
}

/**
 * One serializable snapshot of the whole ID surface, versioned so a consumer can
 * detect drift instead of discovering it through a silently empty join.
 */
export function listOntologyIds(): {
  ontology_version: string
  sectors: string[]
  families: string[]
  categories: string[]
  intents: string[]
  archetypes: string[]
  intent_chains: Array<{ sector: string; family: string; category: string | null; intent: string }>
} {
  return {
    ontology_version: ONTOLOGY_VERSION,
    sectors: listSectorIds(),
    families: listFamilyIds(),
    categories: listCategoryIds(),
    intents: listIntentIds(),
    archetypes: listArchetypeIds(),
    intent_chains: listIntentIds().map((id) => describeIntent(id)!),
  }
}

function uniq(values: (string | undefined | null)[], limit = 28): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const term = String(raw || '').replace(/\s+/g, ' ').trim()
    if (!term || term.length < 2) continue
    const key = normalizeProcurementText(term)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(term)
    if (out.length >= limit) break
  }
  return out
}

/* ------------------------------ resolver -------------------------------- */

/**
 * Level C. Unresolved locally — lexical, ontology AND semantic resolution have
 * all failed. There is no fourth level, and nothing that resolved locally can
 * land here. `ai_eligible` is the single flag the AI gate reads.
 */
function unresolvedResolution(
  raw: string,
  normalized: string,
  head: string,
  started: number,
  bucket: UnresolvedBucket,
  searchTerms: string[] = [],
): OntologyResolution {
  return {
    level: 'unresolved',
    source: 'unresolved',
    level_code: 'C',
    poolable: false,
    sector: null,
    family: null,
    category: null,
    intent: null,
    domain: 'unknown',
    facets: {},
    resolved_facets: [],
    pool_affecting_facets: {},
    search_terms: searchTerms,
    supplier_terms: [],
    preferred_archetypes: [],
    allowed_archetypes: [],
    soft_conflicts: [],
    hard_conflicts: [],
    negative_terms: [],
    confidence: 0,
    raw,
    head_concept: head,
    pool_key: null,
    cache_key: null,
    unresolved_bucket: bucket,
    // Only a line with nothing left to try locally may reach the model.
    ai_eligible: bucket === 'ai_eligible',
    semantic_attempted: true,
    ai_result: 'not_run',
    debug: {
      normalized,
      matched_term: null,
      decided_by: 'none',
      elapsed_ms: Date.now() - started,
      not_supply: bucket === 'rejected' && isWorkOnly(normalized),
    },
  }
}

/**
 * Level B via semantic recovery. Known ontology vocabulary fired but never
 * reached a decision, so the line is searchable on its own recovered terms and
 * terminates LOCALLY — it is never an AI candidate.
 *
 * `family` stays null on purpose. A weak term alone must not decide a family
 * any more than it may decide an intent: promoting a bare «كاميرا» into
 * `physical_security` would put a line of unknown domain into a security
 * supplier pool, which is the exact false positive the weak tier exists to
 * prevent. B here means "resolved locally and searchable", and `source`
 * records that it got there by recovery rather than by an ontology match.
 */
function semanticRecoveryResolution(
  raw: string,
  normalized: string,
  head: string,
  started: number,
  recoveredTerm: string,
  searchTerms: string[],
): OntologyResolution {
  return {
    level: 'local_resolved',
    source: 'semantic_recovery',
    // Reported as B, but NOT poolable: there is no family to pool on.
    level_code: 'B',
    poolable: false,
    sector: null,
    family: null,
    category: null,
    intent: null,
    domain: 'unknown',
    facets: {},
    resolved_facets: [],
    pool_affecting_facets: {},
    search_terms: uniq([recoveredTerm, ...searchTerms]),
    supplier_terms: [],
    preferred_archetypes: [],
    allowed_archetypes: [],
    soft_conflicts: [],
    hard_conflicts: [],
    negative_terms: [],
    confidence: 0.4,
    raw,
    head_concept: head,
    pool_key: null,
    cache_key: null,
    // Level B carries no C metadata: it never reaches the model.
    unresolved_bucket: null,
    ai_eligible: false,
    semantic_attempted: false,
    ai_result: 'not_run',
    debug: {
      normalized,
      matched_term: recoveredTerm,
      // Nothing decisive fired — `source` is what records the recovery.
      decided_by: 'none',
      elapsed_ms: Date.now() - started,
      not_supply: false,
    },
  }
}

function contentTokens(head: string): string[] {
  return head
    .split(' ')
    .filter((token) => token.length >= 3 && !NON_CONCEPT_TOKENS.has(token) && !/^\d/.test(token))
}

function buildCacheKey(poolKey: string | null, poolFacets: FacetValues): string | null {
  if (!poolKey) return null
  const parts = Object.keys(poolFacets)
    .sort()
    .map((name) => `${name}=${poolFacets[name]}`)
  return [ONTOLOGY_VERSION, poolKey, ...parts].join('|')
}

function buildProfile(
  family: RawFamily,
  node: IntentNode | null,
  raw: string,
  normalized: string,
  head: string,
  matchedTerm: string | null,
  decidedBy: DecisionTier,
  source: ResolutionSource,
  started: number,
  confidenceOverride?: number,
  derivedFromIntent?: string,
): OntologyResolution {
  const sector = SECTORS[family.sector] || { domain: 'general' }
  const category = node?.category || null
  const intent = node?.intent || null

  const tiers = mergeTiers(sector, family, category || undefined, intent || undefined)
  const rules = mergeRules(sector, family, category || undefined, intent || undefined)
  const facetRefs = mergeFacets(family.facets, category?.facets, intent?.facets)

  const resolvedFacets = extractFacets(normalized, facetRefs)
  const facets: FacetValues = {}
  const poolFacets: FacetValues = {}
  for (const facet of resolvedFacets) {
    facets[facet.name] = facet.value
    if (facet.supplier_pool_affecting) poolFacets[facet.name] = facet.value
  }

  // Retrieval terms: strong vocabulary first, then weak, never bare context.
  const searchTerms = uniq([
    ...(intent?.strong_terms || []),
    ...(category?.strong_terms || []),
    ...(family.strong_terms || []),
    ...(tiers.weak_terms || []),
  ])

  const level: ResolutionLevel = intent ? 'specific_intent' : 'local_resolved'
  const poolKey = intent?.id || family.id
  const confidence = confidenceOverride ?? intent?.confidence ?? (intent ? 0.9 : 0.82)

  return {
    level,
    source,
    level_code: intent ? 'A' : 'B',
    // A real family/intent was resolved, so this line may key a pool.
    poolable: true,
    sector: family.sector,
    family: family.id,
    category: category?.id || null,
    intent: intent?.id || null,
    domain: sector.domain,
    facets,
    resolved_facets: resolvedFacets,
    pool_affecting_facets: poolFacets,
    search_terms: searchTerms,
    supplier_terms: uniq(rules.supplier),
    preferred_archetypes: rules.preferred,
    allowed_archetypes: rules.allowed,
    soft_conflicts: rules.soft,
    hard_conflicts: rules.hard,
    negative_terms: rules.negative,
    confidence,
    raw,
    head_concept: head,
    pool_key: poolKey,
    cache_key: buildCacheKey(poolKey, poolFacets),
    // Level A and B are usable without AI, so no C metadata applies.
    unresolved_bucket: null,
    ai_eligible: false,
    semantic_attempted: false,
    ai_result: 'not_run',
    debug: {
      normalized,
      matched_term: matchedTerm,
      decided_by: decidedBy,
      elapsed_ms: Date.now() - started,
      derived_from_intent: derivedFromIntent,
    },
  }
}

/** Accumulated tiers for a family (sector + family) or an intent (full chain). */
function familyTiers(family: RawFamily): TermTiers {
  return mergeTiers(SECTORS[family.sector], family)
}

function intentTiers(node: IntentNode): TermTiers {
  return mergeTiers(
    SECTORS[node.family.sector],
    node.family,
    node.category || undefined,
    node.intent,
  )
}

/**
 * Most specific intent inside a family, under the three-tier rule.
 * Intent-level strong/weak terms are evaluated with inherited context.
 */
function resolveIntentNode(
  family: RawFamily,
  head: string,
  full: string,
): { node: IntentNode; decision: TierDecision } | null {
  const nodes = INTENTS_BY_FAMILY.get(family.id) || []
  if (!nodes.length) return null

  const decisions = new Map<string, TierDecision>()
  for (const node of nodes) {
    // Own terms only for the positive signal; context inherited down the chain.
    const inherited = intentTiers(node)
    const own: TermTiers = {
      strong_terms: node.intent.strong_terms,
      weak_terms: node.intent.weak_terms,
      context_terms: inherited.context_terms,
      term_guards: inherited.term_guards,
    }
    const decision = decideByTiers(head, full, own)
    if (decision.decided) decisions.set(node.intent.id, decision)
  }

  let winner: { node: IntentNode; decision: TierDecision; rank: number } | null = null
  for (const node of nodes) {
    const decision = decisions.get(node.intent.id)
    if (!decision) continue
    // `requires` encodes composition: column_cladding only counts when the
    // parent surface_cladding vocabulary matched too.
    const requires = node.intent.requires || []
    if (requires.some((id) => !decisions.has(id))) continue
    const rank = decision.score + requires.length * 500
    if (!winner || rank > winner.rank) winner = { node, decision, rank }
  }
  return winner ? { node: winner.node, decision: winner.decision } : null
}

/**
 * Resolve one BOQ line through the full cascade.
 *
 *   Normalization → Lexicon → Family → Intent → Facets → Archetypes → Veto
 *
 * Every local attempt runs before a line is allowed to fall to Level C.
 */
export function resolveOntology(lineName: string): OntologyResolution {
  const started = Date.now()
  const raw = String(lineName || '').replace(/\s+/g, ' ').trim()
  const normalized = normalizeProcurementText(raw)
  if (!normalized) return unresolvedResolution(raw, normalized, '', started, 'rejected')
  if (isWorkOnly(normalized)) {
    return unresolvedResolution(raw, normalized, '', started, 'rejected')
  }

  const head = extractHeadConcept(normalized) || normalized
  // Matching runs on the product text only. The booklets append vendor
  // boilerplate («مطابق لمعايير التشغيل في مراكز البيانات», «واجهة إدارة آمنة»)
  // which would otherwise hand a weak term the context term it needs to decide.
  const body = cutBoilerplate(normalized) || normalized

  // 1 — lexicon / direct intent (lexicon terms are strong by definition)
  let lexBest: { entry: LexiconEntry; hit: TermHit } | null = null
  for (const entry of LEXICON) {
    // THE LEXICON IS A SHORTCUT INTO A FAMILY, NOT A LICENCE TO IGNORE IT.
    // This path ran with no guards at all, which made every guard in the
    // ontology conditional on the word being absent from the legacy
    // dictionary. That is the real reason «Irrigation Sprinkler Head» kept
    // reaching fire_fighting at 0.90 after the guard was written, tested and
    // verified: Arabic «رشاش» is not a lexicon term so it went through the
    // ontology and was refused, while English `sprinkler` is, and skipped the
    // three-tier layer entirely. The asymmetry looked like a language gap
    // three times over because the lexicon is overwhelmingly English.
    const declared = entry.intent ? INTENT_INDEX.get(entry.intent) : null
    const family = FAMILY_BY_ID.get(entry.family)
    const guards = declared
      ? intentTiers(declared).term_guards
      : family
        ? familyTiers(family).term_guards
        : undefined
    const hit = bestHit(head, body, entry.terms, guards)
    if (hit && (!lexBest || hit.score > lexBest.hit.score)) lexBest = { entry, hit }
  }

  // 2 — ANCESTOR DERIVATION. A strong term owned by exactly one intent in the
  // whole ontology identifies that intent, so the sector/family/category chain
  // is derived upward from it. No term is repeated at a higher level.
  // The BEST unique strong hit derives, not merely the first one found: a more
  // specific term («كاميرا حراريه امنيه») must beat a shorter unique one
  // («كاميرا حراريه») that lives in a different family.
  let derived: { node: IntentNode; hit: TermHit } | null = null
  for (const node of ALL_INTENT_NODES) {
    // Derivation must honour guards too, or a term that is inert for its own
    // family would still drag in the whole ancestor chain from the side.
    const hit = bestHit(head, body, node.intent.strong_terms, intentTiers(node).term_guards)
    if (!hit || !UNIQUE_STRONG_TERMS.has(normalizeTerm(hit.term))) continue
    if (!derived || hit.score > derived.hit.score) derived = { node, hit }
  }
  if (derived) {
    // Composition still outranks a bare unique term, and `requires` must hold.
    const composed = resolveIntentNode(derived.node.family, head, body)
    const requires = derived.node.intent.requires || []
    const winner =
      composed && (requires.length || composed.decision.score > derived.hit.score)
        ? composed.node
        : derived.node
    if (!requires.length || composed) {
      return buildProfile(
        winner.family,
        winner,
        raw, normalized, head,
        derived.hit.term,
        'strong', 'ontology_intent', started, undefined,
        winner.intent.id,
      )
    }
  }

  // 3 — compositional family resolution under the three-tier rule. A deciding
  // descendant intent also decides its family: the tier rule is a property of
  // the term, not of the level it happens to be declared at.
  let famBest: {
    family: RawFamily
    decision: TierDecision
    node: { node: IntentNode; decision: TierDecision } | null
  } | null = null
  // A weak term that never reached a decision is the semantic-recovery signal:
  // it yields searchable vocabulary, but not a family.
  let weakBest: TermHit | null = null
  for (const family of DATA.families) {
    const decision = decideByTiers(head, body, familyTiers(family))
    const node = resolveIntentNode(family, head, body)
    if (!decision.decided && !node) {
      if (decision.hit && (!weakBest || decision.hit.score > weakBest.score)) {
        weakBest = decision.hit
      }
      continue
    }
    const score = Math.max(decision.decided ? decision.score : 0, node?.decision.score ?? 0)
    if (!famBest || score > famBest.decision.score) {
      famBest = {
        family,
        decision: decision.decided ? { ...decision, score } : { ...node!.decision, score },
        node,
      }
    }
  }

  // The lexicon wins only when at least as specific as the ontology hit.
  if (lexBest && (!famBest || lexBest.hit.score + 400 >= famBest.decision.score)) {
    const family = FAMILY_BY_ID.get(lexBest.entry.family)
    if (family) {
      const declared = lexBest.entry.intent ? INTENT_INDEX.get(lexBest.entry.intent) || null : null
      const composed = resolveIntentNode(family, head, body)
      const node =
        composed && declared && composed.node.intent.id !== declared.intent.id
          ? composed.node
          : declared || composed?.node || null
      return buildProfile(
        family,
        node,
        raw,
        normalized,
        head,
        lexBest.hit.term,
        'strong',
        'lexicon',
        started,
        lexBest.entry.confidence,
      )
    }
  }

  if (famBest) {
    const node = famBest.node
    return buildProfile(
      famBest.family,
      node?.node || null,
      raw,
      normalized,
      head,
      node?.decision.hit?.term || famBest.decision.hit?.term || null,
      node?.decision.tier || famBest.decision.tier,
      node ? 'ontology_intent' : 'ontology_family',
      started,
    )
  }

  const tokens = contentTokens(head)

  // 4 — SEMANTIC RECOVERY, and it is the last LOCAL step. Known ontology
  // vocabulary appeared but never reached a decision, so the line is still
  // searchable on the recovered terms. That is a local success: Level B.
  if (weakBest) {
    return semanticRecoveryResolution(
      raw,
      normalized,
      head,
      started,
      weakBest.term,
      tokens.slice(0, 4),
    )
  }

  // LEVEL C — lexical, ontology AND semantic resolution all failed.
  if (tokens.length) {
    return unresolvedResolution(raw, normalized, head, started, 'ai_eligible', tokens.slice(0, 4))
  }
  return unresolvedResolution(raw, normalized, head, started, 'rejected')
}

/* ---------------------------- batch + pools ----------------------------- */

export type OntologyPool = {
  pool_key: string
  cache_key: string | null
  level: ResolutionLevel
  sector: string | null
  family: string | null
  category: string | null
  intent: string | null
  domain: string
  search_terms: string[]
  supplier_terms: string[]
  preferred_archetypes: string[]
  allowed_archetypes: string[]
  soft_conflicts: string[]
  hard_conflicts: string[]
  negative_terms: string[]
  pool_affecting_facets: FacetValues
  line_ids: string[]
}

export type OntologyBatch = {
  lines: Array<{ line_id: string; name: string; resolution: OntologyResolution }>
  pools: OntologyPool[]
  /** THREE levels only. */
  counts: Record<ResolutionLevel, number>
  /** HOW each Level B line resolved. Sums to counts.local_resolved. Not levels. */
  family_by_method: Record<'ontology_family' | 'semantic_recovery' | 'lexicon', number>
  /**
   * Lines carrying a CONFIDENT family or intent — the only ones that may key a
   * supplier pool, a cache entry, or `intent_supplier_map`. Always
   * `counts.specific_intent + counts.local_resolved - semantic_recovery`.
   */
  poolable: number
  /** Metadata inside Level C — these sum to counts.unresolved, they are not levels. */
  unresolved_breakdown: Record<UnresolvedBucket, number>
  /** Lines the AI gate is allowed to call on. Always ⊆ Level C. */
  ai_eligible: number
  not_supply: number
  line_count: number
  elapsed_ms: number
}

/**
 * Same pool key → one supplier retrieval, then per-line rank.
 * Pool-affecting facets split the pool; decorative facets never do.
 */
export function resolveOntologyBatch(
  items: Array<string | { id?: string | number; name?: string; name_ar?: string }>,
): OntologyBatch {
  const started = Date.now()
  const lines: OntologyBatch['lines'] = []
  const pools = new Map<string, OntologyPool>()
  const counts: OntologyBatch['counts'] = {
    specific_intent: 0,
    local_resolved: 0,
    unresolved: 0,
  }
  let poolable = 0
  const familyByMethod: OntologyBatch['family_by_method'] = {
    ontology_family: 0,
    semantic_recovery: 0,
    lexicon: 0,
  }
  const unresolvedBreakdown: OntologyBatch['unresolved_breakdown'] = { ai_eligible: 0, rejected: 0 }
  let aiEligible = 0
  let notSupply = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const name = typeof item === 'string' ? item : String(item?.name_ar || item?.name || '')
    const lineId = typeof item === 'object' && item ? String(item.id ?? i) : String(i)
    const resolution = resolveOntology(name)
    lines.push({ line_id: lineId, name, resolution })
    counts[resolution.level] += 1
    if (resolution.poolable) poolable += 1
    if (resolution.level === 'local_resolved' && resolution.source in familyByMethod) {
      familyByMethod[resolution.source as keyof OntologyBatch['family_by_method']] += 1
    }
    if (resolution.unresolved_bucket) unresolvedBreakdown[resolution.unresolved_bucket] += 1
    if (resolution.ai_eligible) aiEligible += 1
    if (resolution.debug.not_supply) notSupply += 1

    const key = resolution.cache_key || (resolution.search_terms.length ? `line:${lineId}` : null)
    if (!key) continue
    if (!pools.has(key)) {
      pools.set(key, {
        pool_key: resolution.pool_key || `line:${lineId}`,
        cache_key: resolution.cache_key,
        level: resolution.level,
        sector: resolution.sector,
        family: resolution.family,
        category: resolution.category,
        intent: resolution.intent,
        domain: resolution.domain,
        search_terms: resolution.search_terms,
        supplier_terms: resolution.supplier_terms,
        preferred_archetypes: resolution.preferred_archetypes,
        allowed_archetypes: resolution.allowed_archetypes,
        soft_conflicts: resolution.soft_conflicts,
        hard_conflicts: resolution.hard_conflicts,
        negative_terms: resolution.negative_terms,
        pool_affecting_facets: resolution.pool_affecting_facets,
        line_ids: [],
      })
    }
    pools.get(key)!.line_ids.push(lineId)
  }

  return {
    lines,
    pools: [...pools.values()],
    counts,
    family_by_method: familyByMethod,
    poolable,
    unresolved_breakdown: unresolvedBreakdown,
    ai_eligible: aiEligible,
    not_supply: notSupply,
    line_count: lines.length,
    elapsed_ms: Date.now() - started,
  }
}

/* --------------------- supplier archetypes + veto ----------------------- */

export type SupplierVerdict = 'PREFERRED' | 'ALLOWED' | 'SOFT_DEMOTED' | 'HARD_VETO' | 'NO_MATCH'

export type SupplierEvaluation = {
  verdict: SupplierVerdict
  /** Soft/broad matches are shown unticked and never swept by «تحديد الكل». */
  auto_tick: boolean
  score: number
  archetypes: string[]
  matched_terms: string[]
  reasons: string[]
}

export type SupplierProfile = Pick<
  OntologyResolution,
  | 'search_terms'
  | 'supplier_terms'
  | 'preferred_archetypes'
  | 'allowed_archetypes'
  | 'soft_conflicts'
  | 'hard_conflicts'
  | 'negative_terms'
>

/**
 * THE SUPPLY SIDE'S CHOKEPOINT.
 *
 * Every positive claim a supplier makes about itself is filtered here, for the
 * same reason BOQ lines are: an attribute clause is description, not product.
 * Without this, the four supply-side paths decided on raw `termIndex` and so
 * ran none of the clause rule — a paint factory writing «مصنع دهانات **تصنيف**
 * رشاش حريق» went from HARD_VETO to PREFERRED with `auto_tick`, and an
 * irrigation contractor writing «شبكات ري **مادة** رشاش حريق» did the same, on
 * a fire-sprinkler line. Both were demonstrated live against production.
 *
 * Negative terms deliberately do NOT come through here. A positive claim must
 * be clause-clean to count; a negative signal counts wherever it appears. That
 * asymmetry is the same fail-closed direction the term guards already use, and
 * it is chosen so that a supplier can never earn its way past an exclusion by
 * burying the disqualifying word inside a clause.
 */
function supplierClaims(hay: string, terms: string[] | undefined): string[] {
  if (!terms?.length) return []
  return terms.filter((term) => bestHit(hay, hay, [term], undefined, false, 'supplier_prose') !== null)
}

/**
 * Classify a supplier from its own words (name / activity / category) into the
 * standalone archetype vocabulary. No company-name blacklist anywhere.
 */
export function classifySupplierArchetypes(haystack: string): string[] {
  const hay = normalizeProcurementText(haystack)
  if (!hay) return []
  const out: string[] = []
  for (const [id, def] of Object.entries(ARCHETYPES)) {
    if (supplierClaims(hay, def.patterns).length) out.push(id)
  }
  return out
}

/**
 * Structural veto: family/intent × supplier archetype, inherited from the
 * sector. Never a keyword that merely appears in a supplier description.
 */
export function evaluateSupplier(haystack: string, profile: SupplierProfile): SupplierEvaluation {
  const hay = normalizeProcurementText(haystack)
  const archetypes = classifySupplierArchetypes(hay)
  const reasons: string[] = []
  const matched: string[] = []

  const preferred = archetypes.filter((a) => profile.preferred_archetypes.includes(a))
  const allowed = archetypes.filter((a) => profile.allowed_archetypes.includes(a))
  const hard = archetypes.filter((a) => profile.hard_conflicts.includes(a))
  const soft = archetypes.filter((a) => profile.soft_conflicts.includes(a))

  // A conflicting archetype is only fatal when nothing qualifies the supplier —
  // «سباكة ومكافحة حريق» still serves a fire line.
  if (hard.length && !preferred.length && !allowed.length) {
    return {
      verdict: 'HARD_VETO',
      auto_tick: false,
      score: 0,
      archetypes,
      matched_terms: [],
      reasons: [`hard_conflict:${hard.join(',')}`],
    }
  }

  if (!preferred.length && !allowed.length && profile.negative_terms.length) {
    // Raw on purpose — see `supplierClaims`. An exclusion is not a claim.
    const negative = profile.negative_terms.find((t) => termIndex(hay, t) >= 0)
    if (negative) {
      return {
        verdict: 'HARD_VETO',
        auto_tick: false,
        score: 0,
        archetypes,
        matched_terms: [],
        reasons: [`negative_term:${negative}`],
      }
    }
  }

  let score = 0
  for (const term of supplierClaims(hay, profile.search_terms)) {
    score += 3
    matched.push(term)
  }
  for (const term of supplierClaims(hay, profile.supplier_terms)) {
    score += 2
    matched.push(term)
  }
  score += preferred.length * 6 + allowed.length * 3

  if (preferred.length) {
    reasons.push(`preferred:${preferred.join(',')}`)
    return { verdict: 'PREFERRED', auto_tick: true, score, archetypes, matched_terms: matched, reasons }
  }
  if (allowed.length) {
    reasons.push(`allowed:${allowed.join(',')}`)
    return { verdict: 'ALLOWED', auto_tick: true, score, archetypes, matched_terms: matched, reasons }
  }
  if (soft.length) {
    reasons.push(`soft_conflict:${soft.join(',')}`)
    return {
      verdict: 'SOFT_DEMOTED',
      auto_tick: false,
      score: Math.min(score, 2),
      archetypes,
      matched_terms: matched,
      reasons,
    }
  }
  if (score > 0) {
    reasons.push('broad_term_match')
    return {
      verdict: 'SOFT_DEMOTED',
      auto_tick: false,
      score: Math.min(score, 3),
      archetypes,
      matched_terms: matched,
      reasons,
    }
  }
  return { verdict: 'NO_MATCH', auto_tick: false, score: 0, archetypes, matched_terms: [], reasons: ['no_signal'] }
}

const VERDICT_RANK: Record<SupplierVerdict, number> = {
  PREFERRED: 3,
  ALLOWED: 2,
  SOFT_DEMOTED: 1,
  NO_MATCH: 0,
  HARD_VETO: -1,
}

/** Rank candidates: verdict class first, then score. Hard vetoes are dropped. */
export function rankSuppliers<T>(
  candidates: T[],
  haystackOf: (candidate: T) => string,
  profile: SupplierProfile,
): Array<{ candidate: T; evaluation: SupplierEvaluation }> {
  return candidates
    .map((candidate) => ({ candidate, evaluation: evaluateSupplier(haystackOf(candidate), profile) }))
    .filter((row) => row.evaluation.verdict !== 'HARD_VETO' && row.evaluation.verdict !== 'NO_MATCH')
    .sort(
      (a, b) =>
        VERDICT_RANK[b.evaluation.verdict] - VERDICT_RANK[a.evaluation.verdict] ||
        b.evaluation.score - a.evaluation.score,
    )
}

/* -------------------------- learning candidates ------------------------- */

/**
 * Contract for the open system. The AI/cache lane is owned by a sibling agent;
 * this module only defines the handoff shape and the local recurrence counter.
 */
export type LearningCandidate = {
  candidate_id: string
  head_concept: string
  normalized: string
  suggested_family: string | null
  suggested_intent: string | null
  facets: FacetValues
  occurrences: number
  first_seen: string
  last_seen: string
  status: 'pending' | 'promoted' | 'rejected'
  source: 'local_semantic' | 'ai'
}

export const PROMOTE_AFTER_OCCURRENCES = DATA.learning.promote_after_occurrences

/** Step 4 handoff shape — the sibling agent implements the call and the cache. */
export const AI_HANDOFF_CONTRACT = Object.freeze({
  step: 4,
  when: 'level === "unresolved" && ai_eligible === true',
  never: 'Level A and Level B never reach the model; Level B is usable without it, '
    + 'including source === "semantic_recovery" which terminates locally',
  ontology_version: ONTOLOGY_VERSION,
  // Read these from listIntentIds()/listFamilyIds()/listArchetypeIds() — never a
  // hardcoded copy, which rots the next time an intent splits.
  id_source: 'listOntologyIds()',
  cache_key: 'resolution.cache_key — ontology_version | pool_key | pool-affecting facets only',
  request: Object.freeze({
    head_concept: 'string',
    normalized: 'string',
    known_families: 'string[] (ontology family ids)',
    known_intents: 'string[] (ontology intent ids)',
    known_archetypes: 'string[] (archetype ids)',
  }),
  response: Object.freeze({
    suggested_family: 'string | null',
    suggested_intent: 'string | null',
    suggested_archetypes: 'string[]',
    confidence: 'number',
  }),
  rules: Object.freeze([
    'called at most once per distinct head concept; sibling lane caches',
    'never receives the supplier table',
    'result enters the ontology only after approval via learning candidates',
    'decorative (non pool-affecting) facets must not enter the cache key',
  ]),
})

const candidateStore = new Map<string, LearningCandidate>()

function candidateId(head: string): string {
  let hash = 0
  for (let i = 0; i < head.length; i++) hash = (Math.imul(31, hash) + head.charCodeAt(i)) | 0
  return `cpo-${(hash >>> 0).toString(16)}`
}

/** Record an unresolved head concept so recurring gaps surface for approval. */
export function recordLearningCandidate(
  resolution: OntologyResolution,
  suggestion?: { family?: string | null; intent?: string | null; source?: LearningCandidate['source'] },
): LearningCandidate {
  const head = resolution.head_concept || resolution.debug.normalized
  const id = candidateId(head)
  const now = new Date().toISOString()
  const existing = candidateStore.get(id)
  const next: LearningCandidate = existing
    ? { ...existing, occurrences: existing.occurrences + 1, last_seen: now }
    : {
        candidate_id: id,
        head_concept: head,
        normalized: resolution.debug.normalized,
        suggested_family: suggestion?.family ?? null,
        suggested_intent: suggestion?.intent ?? null,
        facets: resolution.facets,
        occurrences: 1,
        first_seen: now,
        last_seen: now,
        status: 'pending',
        source: suggestion?.source ?? 'local_semantic',
      }
  candidateStore.set(id, next)
  return next
}

/** Candidates that recurred enough to be proposed as a new subtype/alias. */
export function listLearningCandidates(options: { minOccurrences?: number } = {}): LearningCandidate[] {
  const min = options.minOccurrences ?? PROMOTE_AFTER_OCCURRENCES
  return [...candidateStore.values()]
    .filter((c) => c.occurrences >= min && c.status === 'pending')
    .sort((a, b) => b.occurrences - a.occurrences)
}

export function resetLearningCandidates(): void {
  candidateStore.clear()
}
