// Copied from فرق بناء (read-only source): farqconstraction/src/lib/parseBoq.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
import type { BOQItem, Supplier } from '../types'
import type { BoqWorkProgress } from './boqEta'
import {
  extractBoqTable,
  foldPdfText,
  pageTextRows,
  unreadableCount,
  type BoqTableResult,
  type PdfGlyph,
} from './boqPdfTable'
import { apiUnreachableAdvice, isProductionBuild } from '../api/apiBase'
import { currentAuthMode } from '../api/constructionAuth'

function normalizeAr(text: string): string {
  // NFKC first: printed Etimad booklets arrive as Arabic Presentation Forms-B
  // (U+FB50–U+FEFF), where `ﺣﺪﻳﺪي` is not `حديدي` and every gate below misses.
  return String(text || '')
    .normalize('NFKC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[×*]/g, 'x')
    .toLowerCase()
}

function cityLabel(city: unknown): string {
  if (!city) return 'المملكة العربية السعودية'
  if (typeof city === 'string') return city.trim() || 'المملكة العربية السعودية'
  if (typeof city === 'object' && city !== null) {
    const o = city as { original?: string; key?: string }
    return String(o.original || o.key || '').trim() || 'المملكة العربية السعودية'
  }
  return 'المملكة العربية السعودية'
}

export type ParsedLine = {
  id: number
  name: string
  qty: string
  unit: string
  spec?: string
  /** The item code the booklet prints for this row, when the read carried one. */
  itemCode?: string
  /** The server checked this row's code and quantity against the printed page. */
  codeVerified?: boolean
  /** Pure work (excavation, backfill…): nothing to buy, so nothing to match. */
  workOnly?: boolean
}

const UNIT_NORMALIZE: Record<string, string> = {
  'متر مربع': 'م²',
  'مربع متر': 'م²',
  'م2': 'م²',
  'م 2': 'م²',
  م٢: 'م²',
  'متر طولي': 'م ط',
  'طولي متر': 'م ط',
  'متر طولى': 'م ط',
  حبة: 'عدد',
  قطعة: 'عدد',
  مجموعة: 'مجموعة',
  م3: 'م³',
  'م 3': 'م³',
  طن: 'طن',
  جهاز: 'جهاز',
  وحدة: 'وحدة',
  طقم: 'طقم',
  كيس: 'كيس',
  عبوة: 'عبوة',
  زوج: 'زوج',
  لفة: 'لفة',
  صندوق: 'صندوق',
  رخصة: 'رخصة',
}

/** Units that appear in Farq test كراسات (مستودع / مركز بيانات / مواقع). */
const BOQ_UNIT_ALT =
  'طن|عدد|وحدة|طقم|كيس|عبوة|زوج|لفة|صندوق|حبة|قطعة|جهاز|رخصة|اشتراك|حزمة|لتر|كجم|متر\\s*طولي|م\\s*ط|م\\s*[23²³]|م[²³]'

/** Page chrome that must never be treated as a BOQ category. */
const BOQ_HEADER_CATEGORY_RE =
  /غير\s*رسمية|كراسة|اختبارية|صفحة|بيانات\s*اختبار|فرق\s*للبناء|توريد\s*فقط|نموذج\s*كراسة/

function normalizeUnit(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  return UNIT_NORMALIZE[t] || t
}

function formatQty(n: number | string): string {
  const num = typeof n === 'number' ? n : Number(String(n).replace(/,/g, ''))
  if (!Number.isFinite(num)) return String(n)
  return num.toLocaleString('en-US')
}

/** Generic Etimad/كراسة shape — shared by many unrelated tenders. */
export function looksLikeEtimadBoq(text: string): boolean {
  return (
    /جدول\s*الكميات|الكميات\s*جدول|كراسة\s*الشروط|منافسة\s*مشروع/i.test(text) ||
    (text.includes('البند') && text.includes('الكمية') && text.includes('الوحدة'))
  )
}

function shortenBoqName(name: string): string {
  let s = name.replace(/\s+/g, ' ').trim()
  s = s.replace(/[،,.\s]+$/g, '').trim()
  const cut = s.search(/[。.]\s/)
  if (cut >= 24 && cut <= 110) s = s.slice(0, cut).trim()
  if (s.length > 110) s = `${s.slice(0, 107).trim()}…`
  return s
}

/**
 * Farq test booklet shape A (مستودع تشغيل):
 *   م | الفئة | البند (توريد…) | المواصفة | الوحدة | الكمية
 * Flattened PDF text: `1 الهياكل المعدنية توريد قطاع حديد … طن 5`
 */
export function parseSupplyFarqTestBoq(text: string): ParsedLine[] {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  if (!flat) return []

  const isValidCategory = (category: string): boolean => {
    const cat = category.replace(/\s+/g, ' ').trim()
    if (cat.length < 3 || cat.length > 48) return false
    if (BOQ_HEADER_CATEGORY_RE.test(cat) || /^غير/.test(cat)) return false
    if (/^\d/.test(cat)) return false
    // Spec fragments leaking into "category" (e.g. "مم PIR … 19 غلاف")
    if (/\d{2,}\s|\s\d{2,}/.test(cat) && !/\bUPS\b/i.test(cat)) return false
    const ar = (cat.match(/[\u0600-\u06FF]/g) || []).length
    const compact = cat.replace(/\s+/g, '')
    if (ar < 3) return false
    if (compact.length > 0 && ar / compact.length < 0.45) return false
    return true
  }

  // Anchor on each "توريد", then look back for "ID category" — avoids page-number
  // false starts that truncate the previous item before its unit/qty.
  const toridRe = /توريد\s+/g
  const beforeRe =
    /(\d{1,3})\s+([\u0600-\u06FF][\u0600-\u06FFA-Za-z0-9\s&/+._-]{1,48})$/
  const trailingIdCatRe =
    /\s+\d{1,3}\s+[\u0600-\u06FF][\u0600-\u06FFA-Za-z0-9\s&/+._-]{1,48}$/
  const unitQtyRe = new RegExp(
    String.raw`^(.*)\s+(${BOQ_UNIT_ALT})\s+([\d,]+(?:\.\d+)?)\s*$`,
    'i',
  )

  type Start = { id: number; toridAt: number }
  const starts: Start[] = []
  let m: RegExpExecArray | null
  while ((m = toridRe.exec(flat))) {
    const before = flat.slice(Math.max(0, m.index - 72), m.index)
    const bm = before.match(beforeRe)
    if (!bm) continue
    const id = Number(bm[1])
    if (!Number.isFinite(id) || id < 1 || id > 500) continue
    if (!isValidCategory(bm[2] || '')) continue
    starts.push({ id, toridAt: m.index })
  }

  const found = new Map<number, ParsedLine>()
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!
    if (found.has(start.id)) continue
    const end = i + 1 < starts.length ? starts[i + 1]!.toridAt : flat.length
    // Slice runs up to the next توريد, so it still holds "UNIT QTY ID category".
    let chunk = flat.slice(start.toridAt, end).trim()
    chunk = chunk.replace(trailingIdCatRe, '').trim()
    const tm = chunk.match(unitQtyRe)
    if (!tm) continue
    const name = shortenBoqName(tm[1] || '')
    if (name.length < 5 || !/^توريد(?:\s|$)/.test(name)) continue
    found.set(start.id, {
      id: start.id,
      name,
      qty: formatQty(tm[3]!),
      unit: normalizeUnit(String(tm[2] || 'عدد')),
    })
  }
  return [...found.values()].sort((a, b) => a.id - b.id)
}

/**
 * Farq test booklet shape B (مركز بيانات / مواقع):
 *   `001 DC- الفئة توريد … 12 جهاز 002 DC- …`
 * Quantity precedes unit.
 */
export function parseCodedFarqTestBoq(text: string): ParsedLine[] {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  if (!flat) return []

  const re = new RegExp(
    String.raw`(\d{3})\s+(DC|SITE)-\s*([\u0600-\u06FF][\u0600-\u06FFA-Za-z0-9\s&/+._-]{1,60}?)\s+(توريد\s+.+?)\s+([\d,]+)\s+(${BOQ_UNIT_ALT})(?=\s+\d{3}\s+(?:DC|SITE)-|$)`,
    'gi',
  )
  const found = new Map<number, ParsedLine>()
  let m: RegExpExecArray | null
  while ((m = re.exec(flat))) {
    const id = Number(m[1])
    if (!Number.isFinite(id) || id < 1) continue
    const name = shortenBoqName(m[4] || '')
    if (name.length < 5) continue
    if (found.has(id)) continue
    found.set(id, {
      id,
      name,
      qty: formatQty(m[5]!),
      unit: normalizeUnit(String(m[6] || 'عدد')),
    })
  }
  return [...found.values()].sort((a, b) => a.id - b.id)
}

/**
 * Parse Farq-generated test كراسات from flattened PDF text.
 * Prefer coded (DC/SITE) when present; otherwise supply-table (مستودع).
 */
export function parseFarqTestBoqText(text: string): ParsedLine[] {
  const coded = parseCodedFarqTestBoq(text)
  if (coded.length >= 5) return coded
  const supply = parseSupplyFarqTestBoq(text)
  if (supply.length >= 5) return supply
  return coded.length >= supply.length ? coded : supply
}

function parseLinesFromText(text: string): ParsedLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const found = new Map<number, ParsedLine>()
  const cleanName = (raw: string) => {
    const trimmed = String(raw || '').replace(/\s+/g, ' ').trim()
    if (!trimmed) return ''
    // A line keeps the name the document printed. Rewriting it to a canned
    // label sends a supplier a material the booklet never asked for.
    return trimmed
  }

  // Pattern: leading id, description, quantity, unit (tabs or multi-space)
  const rowRe =
    /^(\d{1,3})[\s\t|]+(.+?)[\s\t|]+([\d,]+\.?\d*)[\s\t|]+(متر\s*مربع|مربع\s*متر|متر\s*طولي|طولي\s*متر|حبة|قطعة|مجموعة|طن|م[²³23]|م\s*ط|عدد|وحدة|طقم|كيس|عبوة|زوج|جهاز)(?:\s|$)/i

  for (const line of lines) {
    const m = line.match(rowRe)
    if (!m) continue
    const id = Number(m[1])
    if (!Number.isFinite(id) || id < 1 || id > 500) continue
    const name = cleanName(m[2] || '')
    if (name.length < 3) continue
    found.set(id, {
      id,
      name,
      qty: formatQty(m[3]!),
      unit: normalizeUnit(m[4]!),
    })
  }

  // Looser fallback: "N  description  QTY"
  if (found.size < 3) {
    const loose =
      /^(\d{1,3})[\s\t]+(.{4,80}?)[\s\t]+([\d,]{1,7})(?:\s|$)/
    for (const line of lines) {
      if (/صفحة|قسم|الفهرس|المملكة/.test(line)) continue
      const m = line.match(loose)
      if (!m) continue
      const id = Number(m[1])
      if (found.has(id) || id < 1 || id > 200) continue
      const name = cleanName(m[2]!)
      if (!/[\u0600-\u06FF]/.test(name)) continue
      found.set(id, { id, name, qty: formatQty(m[3]!), unit: 'عدد' })
    }
  }

  // Farq test كراسات (مستودع / DC / SITE) flatten to one stream — dedicated parsers.
  {
    const farqTest = parseFarqTestBoqText(text)
    if (farqTest.length > found.size) return farqTest
  }

  return [...found.values()].sort((a, b) => a.id - b.id)
}

/** Image-only / scan PDF — local pdf.js has no text layer to read. */
export const PDF_SCAN_NO_TEXT =
  'الملف صورة ممسوحة بلا نص — ارفع PDF نصي أو استخدم كراسة قابلة للنسخ'

/** Shown when the local pdf.js leg stops responding instead of failing. */
export const PDF_EXTRACT_TIMEOUT =
  'تعذّرت قراءة الملف خلال المدة المتوقعة — أعد المحاولة، أو ارفع صفحات جدول الكميات وحدها'

/** Backstop for the local pdf.js leg. Real booklets measure ~10ms/صفحة. */
const CLIENT_EXTRACT_TIMEOUT_MS = 60_000

/** Real work stages, so the UI never has to guess from a timer. */
export type BoqParseStage = 'open' | 'read' | 'analyze' | 'match'
export type BoqParseProgress = (stage: BoqParseStage) => void

const noWork: BoqWorkProgress = () => {}

/**
 * Hand the main thread back mid-loop so a countdown built on these ticks can
 * actually repaint. Without it the ranking stage is one blocking block: the
 * screen would show a stale number for the whole stage and then jump, which is
 * indistinguishable from the frozen bar this screen used to have.
 */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** Cap the number of yields so a 10,219-line booklet does not pay for 400 of them. */
function chunkSize(total: number): number {
  return Math.max(16, Math.ceil(total / 48))
}

/**
 * Reject a leg that neither resolves nor rejects. `Promise.race` leaves the
 * loser pending, which is fine — it holds no UI state.
 */
async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function isPdfScanNoTextError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'PDF_SCAN_NO_TEXT') {
    return true
  }
  const msg = err instanceof Error ? err.message : String(err)
  return msg === PDF_SCAN_NO_TEXT || /لا نص في الصفحات|صورة ممسوحة بلا نص|PDF_TEXT_REQUIRED|بلا طبقة نص/.test(msg)
}

function pdfScanNoTextError(): Error {
  return Object.assign(new Error(PDF_SCAN_NO_TEXT), { code: 'PDF_SCAN_NO_TEXT' as const })
}

/** What one PDF read yields: flattened text for the text parsers, plus the
 * column-aware table when the document actually carries one. */
export type PdfExtract = {
  text: string
  table: BoqTableResult | null
}

async function extractPdfText(file: File, work: BoqWorkProgress = noWork): Promise<PdfExtract> {
  // Keep a master copy — pdf.js workers transfer/detach the ArrayBuffer passed as `data`.
  const master = new Uint8Array(await file.arrayBuffer())
  if (!master.byteLength) {
    throw new Error('ملف PDF فارغ (0 بايت)')
  }

  const errors: string[] = []

  const collectText = async (
    getDocument: (src: unknown) => {
      promise: Promise<{
        numPages: number
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>
      }>
    },
  ): Promise<{ text: string; table: BoqTableResult | null; empty: boolean }> => {
    // A retry on the legacy engine restarts this leg: the new engine has its own
    // speed, so any rate measured from the first one is void.
    work({ kind: 'start', leg: 'extract', unit: 'page', capMs: CLIENT_EXTRACT_TIMEOUT_MS })
    // Fresh clone per attempt so a prior worker transfer cannot break the next engine.
    const data = master.slice()
    const doc = await getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      verbosity: 0,
    }).promise
    // Page count is only knowable after the document opens, so it arrives as a
    // zero-progress tick rather than being guessed from the file size.
    work({ kind: 'tick', leg: 'extract', done: 0, total: doc.numPages })
    const parts: string[] = []
    const pages: Array<{ page: number; glyphs: PdfGlyph[] }> = []
    let lastTickAt = 0
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const content = await page.getTextContent()
      // Positions, not just strings: this booklet's table has no drawn column
      // rules, so x is the only thing that tells a quantity from a structural
      // code, and y is the only thing that tells one item from the next.
      const glyphs: PdfGlyph[] = []
      for (const item of content.items) {
        if (!item || typeof item !== 'object' || !('str' in item)) continue
        const cell = item as { str?: unknown; width?: unknown; transform?: unknown }
        const str = String(cell.str ?? '')
        if (!str) continue
        const transform = Array.isArray(cell.transform) ? (cell.transform as number[]) : null
        glyphs.push({
          str,
          x: Number(transform?.[4] ?? 0),
          y: Number(transform?.[5] ?? 0),
          width: Number(cell.width ?? 0),
        })
      }
      pages.push({ page: pageNum, glyphs })
      // One line per visual row. A page-per-line stream made every anchored row
      // pattern fail, which is why a real 68-item booklet read as zero items.
      for (const line of pageTextRows(glyphs)) parts.push(line)
      // Real booklets run a few ms/page, so every page would be a wasted render.
      const at = Date.now()
      if (pageNum === doc.numPages || at - lastTickAt >= 120) {
        lastTickAt = at
        work({ kind: 'tick', leg: 'extract', done: pageNum, total: doc.numPages })
      }
    }
    work({ kind: 'end', leg: 'extract' })
    const text = parts.join('\n')
    work({ kind: 'start', leg: 'table', unit: 'page' })
    const table = extractBoqTable(pages)
    work({ kind: 'tick', leg: 'table', done: pages.length, total: pages.length })
    work({ kind: 'end', leg: 'table' })
    return { text, table: table.rows.length || table.issues.length ? table : null, empty: !text.trim() }
  }

  // 1) Modern build + Vite-resolved worker URL (fixes Figma Make / preview worker 404).
  try {
    const pdfjs = await import('pdfjs-dist')
    try {
      const workerMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      const workerSrc = typeof workerMod === 'string' ? workerMod : String((workerMod as { default?: string }).default || '')
      if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
    } catch (e) {
      errors.push(`worker-url: ${e instanceof Error ? e.message : String(e)}`)
      try {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString()
      } catch (e2) {
        errors.push(`worker-fallback: ${e2 instanceof Error ? e2.message : String(e2)}`)
      }
    }
    const result = await collectText((src) => pdfjs.getDocument(src as never))
    if (result.empty) throw pdfScanNoTextError()
    return { text: result.text, table: result.table }
  } catch (e) {
    // Loaded fine but no glyphs — legacy will not invent a text layer; surface scan error.
    if (isPdfScanNoTextError(e)) throw e
    errors.push(`pdfjs-dist: ${e instanceof Error ? e.message : String(e)}`)
  }

  // 2) Legacy build — more tolerant in constrained iframes / Node-like hosts.
  // Only reached on worker/load failures; always use a fresh buffer clone.
  try {
    const legacy = await import('pdfjs-dist/legacy/build/pdf.mjs')
    try {
      const workerMod = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
      const workerSrc =
        typeof workerMod === 'string' ? workerMod : String((workerMod as { default?: string }).default || '')
      if (workerSrc) legacy.GlobalWorkerOptions.workerSrc = workerSrc
    } catch {
      /* legacy may run without a dedicated worker in some hosts */
    }
    const result = await collectText((src) => legacy.getDocument(src as never))
    if (result.empty) throw pdfScanNoTextError()
    return { text: result.text, table: result.table }
  } catch (e) {
    if (isPdfScanNoTextError(e)) throw e
    errors.push(`pdfjs-legacy: ${e instanceof Error ? e.message : String(e)}`)
  }

  throw new Error(`تعذّر استخراج نص PDF (${errors.join(' | ')})`)
}

/**
 * The PDF reader is a lazily loaded chunk whose file name carries a build hash.
 * A tab left open across a deployment still asks for the OLD name, which no
 * longer exists, and every browser words that failure differently. It is not a
 * fact about the booklet — nothing was read — so it must not be reported as
 * «لم نعثر على بنود». Measured 2026-09-17: the owner's tab asked for
 * pdf-BPOO2IQW.js after a redeploy that ships pdf-BCrfgDb5.js; both 404.
 */
export function isStaleBundleError(message: string | null | undefined): boolean {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    String(message || ''),
  )
}

export const STALE_BUNDLE_MESSAGE =
  'نُشرت نسخة أحدث من التطبيق أثناء فتح هذه الصفحة، فلم يعد قارئ الملفات الذي تحمله صفحتك موجودًا. ' +
  'أعد تحميل الصفحة ثم ارفع الكراسة من جديد. لم تُقرأ الكراسة، ولم نُعد استخدام كراسة سابقة.'

async function extractPlainText(file: File, work: BoqWorkProgress = noWork): Promise<PdfExtract> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return extractPdfText(file, work)
  }
  // An .xlsx/.xls is a zip archive; read as text it is bytes, and the buyer
  // was told «لم نعثر على بنود» about a perfectly good booklet. Say what is true.
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    throw new Error('ملفات Excel غير مدعومة. احفظ الكراسة بصيغة PDF وارفعها.')
  }
  // Excel/CSV fallback: read as text (works for simple CSV exports). One blob
  // read with no progress to report — declared opaque rather than faked.
  // These archives are a different shape entirely: standard encoding, one item
  // per line, named headers. They keep the text path, untouched by the columns.
  work({ kind: 'start', leg: 'extract', opaque: true, capMs: CLIENT_EXTRACT_TIMEOUT_MS })
  try {
    return { text: await file.text(), table: null }
  } finally {
    work({ kind: 'end', leg: 'extract' })
  }
}

/** Cap UI proposals so a 10k+ directory response cannot freeze the tab. */
const MATCH_SUPPLIERS_PER_LINE = 20
/** Prefer Farq BOQ match for at most this many lines (API max is 200). */
const MATCH_API_LINE_CAP = 80

function lineKeyFor(line: ParsedLine): string {
  return `line-${line.id}`
}

function mapApiSuppliers(
  rows: Array<{
    id: string
    name_ar?: string
    name_en?: string
    city?: unknown
    evidence?: string
    channel?: string
    learned?: boolean
  }>,
): Supplier[] {
  return rows
    .slice(0, MATCH_SUPPLIERS_PER_LINE)
    .map((s) => {
      const evidence: Supplier['evidence'] =
        s.evidence === 'دليل مباشر' ||
        s.evidence === 'نشاط متطابق' ||
        s.evidence === 'دليل منتج' ||
        s.evidence === 'من الكتالوج' ||
        s.evidence === 'على مستوى النشاط' ||
        s.evidence === 'اختيارك' ||
        s.evidence === 'تسمية آلية' ||
        s.evidence === 'خريطة فرق'
          ? s.evidence
          : // Never grade a supplier by its position in the list.
            'من الكتالوج'
      const channel: Supplier['channel'] =
        s.channel === 'واتساب' ? 'واتساب' : s.channel === 'محادثة' ? 'محادثة' : 'بريد'
      return {
        id: s.id,
        name: String(s.name_ar || s.name_en || s.id).trim(),
        city: cityLabel(s.city),
        evidence,
        learned: s.learned === true ? true : undefined,
        channel,
      }
    })
}

/** Result of the remote match, with its failure kept instead of swallowed. */
type RemoteMatch = {
  hits: Map<string, { farqSpecId?: string | null; suppliers: Supplier[]; aiSuggestion?: BOQItem['aiSuggestion']; mapSuggestion?: BOQItem['mapSuggestion']; learnedSuggestion?: BOQItem['learnedSuggestion']; familySuggestion?: BOQItem['familySuggestion'] }>
  /** Set when the request itself failed, so the screen can stop looking normal. */
  error?: string
}

/**
 * What the reader and the matcher are doing, line by line, so the processing
 * screen can show the work happening instead of a bar and a percentage.
 */
export type BoqActivity =
  | { kind: 'reading'; pagesDone: number; pageCount: number | null; itemCount: number; newNames: string[] }
  | { kind: 'read'; names: string[] }
  | { kind: 'matched'; rows: Array<{ key?: string; name: string; suppliers: number }> }
let emitActivity: ((event: BoqActivity) => void) | null = null

async function matchViaFarqBoqApi(
  lines: ParsedLine[],
  work: BoqWorkProgress = noWork,
): Promise<RemoteMatch> {
  const out = new Map<string, { farqSpecId?: string | null; suppliers: Supplier[]; aiSuggestion?: BOQItem['aiSuggestion']; mapSuggestion?: BOQItem['mapSuggestion']; learnedSuggestion?: BOQItem['learnedSuggestion']; familySuggestion?: BOQItem['familySuggestion'] }>()
  if (!lines.length) return { hits: out }
  let error: string | undefined
  try {
    const { matchConstructionBoqCatalog, CONSTRUCTION_BOQ_MATCH_TIMEOUT_MS } = await import(
      '../api/constructionClient'
    )
    // One request, one response: the API reports no intermediate progress, so
    // this leg can only be bounded by its own timeout, never measured.
    work({
      kind: 'start',
      leg: 'match-remote',
      opaque: true,
      capMs: CONSTRUCTION_BOQ_MATCH_TIMEOUT_MS,
      lines: lines.length,
    })
    // The API takes at most 200 rows a request and this used to send the first
    // 80 and stop: a 325-item booklet had 245 lines that were never matched and
    // read as «مادة غير محدّدة» for a reason that had nothing to do with them.
    // Every line is sent now, in chunks, two at a time so a large booklet does
    // not take every connection the API keeps for construction.
    // «عمل بلا توريد» is the page reader's opinion and nothing on the page can
    // verify it. Measured on موقع الرياض: it said so of plain concrete, a
    // fire-rated block wall, waterproofing and cement plaster — all bought
    // materials — and skipping them here hid their suppliers. Every line is
    // matched; the label survives only where matching found nothing.
    const supplyLines = lines
    const chunks: ParsedLine[][] = []
    for (let i = 0; i < supplyLines.length; i += MATCH_API_LINE_CAP) chunks.push(supplyLines.slice(i, i + MATCH_API_LINE_CAP))
    const matchedRows: Awaited<ReturnType<typeof matchConstructionBoqCatalog>>['rows'] = []
    // One chunk failing must not erase the others. Measured 2026-09-17: two
    // chunks in parallel, one 500, and Promise.all threw away 94 confirmed
    // matches and 37 map suggestions the other chunks had returned — 1,039
    // cards read «مادة غير محدّدة». Chunks now run one at a time (the heavy
    // query did not survive being doubled), each retried once, and a chunk that
    // still fails leaves only ITS lines unmatched and is reported by count.
    let failedLines = 0
    // Every line's material, worked out once and off the page's thread (see
    // lineResolution.ts): this used to freeze a phone long enough to be killed.
    const { resolveLinesOffThread } = await import('./lineResolution')
    const resolutions = await resolveLinesOffThread(supplyLines.map((line) => ({ name: line.name, spec: line.spec })))
    const resolutionOf = new Map(supplyLines.map((line, i) => [line, resolutions[i] ?? null]))
    for (const chunk of chunks) {
      const body = {
        lines: chunk.map((line) => ({
          line_key: lineKeyFor(line),
          name_ar: line.name,
          quantity: Number(String(line.qty).replace(/,/g, '')) || 1,
          uom: line.unit || 'عدد',
          spec: line.spec,
          ontology_resolution: resolutionOf.get(line) ?? null,
        })),
      }
      let part: Awaited<ReturnType<typeof matchConstructionBoqCatalog>> | null = null
      for (let attempt = 0; attempt < 2 && !part; attempt++) {
        try {
          part = await matchConstructionBoqCatalog(body)
        } catch (chunkError) {
          if (attempt === 1) {
            failedLines += chunk.length
            console.warn('Farq BOQ match chunk failed twice', chunkError)
          }
        }
      }
      if (part) {
        matchedRows.push(...(part.rows || []))
        if (emitActivity) {
          const byKey = new Map((part.rows || []).map((row) => [row.line_key, row]))
          emitActivity({
            kind: 'matched',
            rows: chunk.map((line) => {
              const row = byKey.get(lineKeyFor(line))
              const ids = new Set<string>()
              for (const x of row?.suppliers || []) ids.add(String((x as { id?: unknown }).id))
              for (const x of row?.map_suggestion?.suppliers || []) ids.add(String((x as { id?: unknown }).id))
              for (const x of row?.family_suggestion?.suppliers || []) ids.add(String((x as { id?: unknown }).id))
              return { key: lineKeyFor(line), name: line.name, suppliers: Math.min(ids.size, 5) }
            }),
          })
        }
      }
    }
    if (failedLines > 0 && failedLines === supplyLines.length) throw new Error('تعذّرت مطابقة الموردين على الخادم لكل الدفعات.')
    if (failedLines > 0) error = `تعذّرت مطابقة ${failedLines} بندًا من ${supplyLines.length} على الخادم بعد محاولتين؛ بقية البنود طوبقت.`
    const matched = { rows: matchedRows }
    for (const row of matched.rows || []) {
      out.set(row.line_key, {
        farqSpecId: row.farq_spec_id,
        suppliers: mapApiSuppliers(row.suppliers || []),
        // An ontology-named material with the map's suppliers — beside the match, never in it.
        mapSuggestion: row.map_suggestion
          ? {
              intent: row.map_suggestion.intent,
              family: row.map_suggestion.family,
              answeredBy: row.map_suggestion.answered_by,
              // The number shown is the number listed: the card said «12 موردًا»
              // over a list of eight.
              supplierCount: mapApiSuppliers(row.map_suggestion.suppliers || []).length,
              zeroReason: row.map_suggestion.zero_reason,
              suppliers: mapApiSuppliers(row.map_suggestion.suppliers || []),
            }
          : undefined,
        familySuggestion: row.family_suggestion?.family
          ? { family: row.family_suggestion.family, suppliers: mapApiSuppliers(row.family_suggestion.suppliers || []) }
          : undefined,
        learnedSuggestion: row.learned_suggestion?.suppliers?.length
          ? { suppliers: mapApiSuppliers(row.learned_suggestion.suppliers) }
          : undefined,
        // A model-named material rides alongside, never in place of, the match.
        aiSuggestion: row.ai_suggestion
          ? {
              intent: row.ai_suggestion.intent,
              family: row.ai_suggestion.family,
              supplierCount: row.ai_suggestion.suppliers.length,
              zeroReason: row.ai_suggestion.zero_reason,
              suppliers: mapApiSuppliers(row.ai_suggestion.suppliers || []),
            }
          : undefined,
      })
    }
  } catch (err) {
    // Local keyword matching still runs, but a failed match is a fact about the
    // result and is reported, not hidden: a silent `catch` here left the screen
    // looking like a normal successful read.
    error = err instanceof Error ? err.message : String(err)
    console.warn('Farq BOQ match API failed — falling back to local keyword match', err)
  } finally {
    work({ kind: 'end', leg: 'match-remote' })
  }
  return { hits: out, error }
}

export async function matchSuppliersForItems(
  lines: ParsedLine[],
  opts: { onWork?: BoqWorkProgress } = {},
): Promise<{
  items: BOQItem[]
  /** Remote match request failure, if any — surfaced, never swallowed. */
  matchApiError?: string
}> {
  const work = opts.onWork ?? noWork
  const cleanLines = sanitizeBoqLines(lines)
  const remote = await matchViaFarqBoqApi(cleanLines, work)
  const apiHits = remote.hits

  // There is no local supplier search any more, and that is deliberate.
  //
  // What used to happen: the directory was downloaded and every line was padded
  // out to MATCH_SUPPLIERS_PER_LINE from it, scoring each supplier by substring
  // over `name + category + activity + city`. That cannot establish that a
  // business sells the material — those fields describe a registration, not a
  // product list — and it was measured doing exactly what that predicts. On
  // «مرحاض عربي بورسلان» it returned four paint companies and a steel firm,
  // each scoring on the single token «عربي» found inside «المملكة العربية
  // السعودية»: their country. Not one hit on مرحاض or بورسلان.
  //
  // The padding also hid the truth it was papering over. Because it always
  // filled the line to eight, «بلا مورد مؤكد — 0 مورد» could never render, so
  // a material with no supplier in Farq's register was indistinguishable on
  // screen from one with eight. Farq's own answer for those lines is zero.
  //
  // The eligible suppliers the API returns are now the only ones shown. If that
  // is none, the item says none.
  work({ kind: 'start', leg: 'match-rank', unit: 'line', total: cleanLines.length, lines: cleanLines.length })
  const lineChunk = chunkSize(cleanLines.length)
  const items: BOQItem[] = []
  for (const line of cleanLines) {
    const api = apiHits.get(lineKeyFor(line))
    const suppliers = (api?.suppliers || []).slice(0, MATCH_SUPPLIERS_PER_LINE)

    items.push({
      id: line.id,
      name: line.name,
      qty: line.qty,
      unit: line.unit,
      spec: line.spec,
      status: suppliers.length > 0 ? ('ready' as const) : ('searching' as const),
      supplierCount: suppliers.length,
      suppliers,
      farqSpecId: api?.farqSpecId || undefined,
      lineKey: lineKeyFor(line),
      aiSuggestion: api?.aiSuggestion,
      learnedSuggestion: api?.learnedSuggestion,
      familySuggestion: api?.familySuggestion,
      mapSuggestion: api?.mapSuggestion,
      workOnly:
        Boolean(line.workOnly) && suppliers.length === 0 && !api?.mapSuggestion && !api?.aiSuggestion && !api?.learnedSuggestion && !api?.familySuggestion
          ? true
          : undefined,
      itemCode: line.itemCode,
    })

    if (items.length % lineChunk === 0 || items.length === cleanLines.length) {
      work({ kind: 'tick', leg: 'match-rank', done: items.length, total: cleanLines.length })
      await yieldToUi()
    }
  }
  work({ kind: 'end', leg: 'match-rank' })

  return { items, matchApiError: remote.error }
}

export type ParseBoqResult = {
  items: BOQItem[]
  projectName: string
  /** Content-hash / upload identity — lines are bound to this document only. */
  documentId: string
  source: 'pdf-table' | 'pdf-text' | 'empty'
  rawLineCount: number
  /** True when Farq API was unreachable / returned no directory during match. */
  matchDegraded?: boolean
  matchWarning?: string
  /** True when the supplier-match request itself failed (not the directory). */
  matchApiFailed?: boolean
  matchApiError?: string
  /**
   * Items the booklet itself numbers, when it numbers them. `read` is what we
   * produced. Unequal means a partial read, and the caller must say so with the
   * count: returning 31 of 68 lines as though they were the booklet is what
   * turned a parser defect into wrong RFQs instead of a visible error.
   */
  expectedLineCount?: number | null
  unreadableLineCount?: number
  /** Rows the read refused to serve as items — counted, never dropped silently. */
  setAsideCount?: number
  setAsideNote?: string
  setAsideRows?: Array<{ page?: number; quantity?: number | string | null; unit?: string | null; description?: string; reason?: string }>
  /** Arabic, user-facing reasons — one per item we could not read. */
  readIssues?: string[]
  /** Tables found in the document that were deliberately not read as items. */
  skippedTables?: string[]
  /**
   * True when the served descriptions repeat so heavily that they cannot be
   * item names. The count is then not a measure of success: the rows exist and
   * their quantities may be right, but the material is unknown.
   */
  descriptionColumnSuspect?: boolean
  /** Arabic, user-facing: what repeated and how often. */
  descriptionColumnDetail?: string
  /** The document carries far more item codes than rows we read — the read missed the item table. */
  codedItemsSuspect?: boolean
  codedItemsDetail?: string
}

/**
 * Share of rows that must share their name before the description column is
 * called into question. Item names are near-unique per row; category labels are
 * not, so heavy repetition in the name column means it is not the name column.
 *
 * Measured on every booklet fixture, and the two populations do not overlap:
 *
 *   reference-etimad-2020-48   pdf-table    2.9%   (68 rows, «بردورات خرسانة» twice)
 *   warehouse-ops-02           pdf-table    0.0%   (180 rows)
 *   site-or-wh-1__2            pdf-table    0.0%   (180 rows)
 *   datacenter-cyber-01        pdf-text    77.8%   («DC- الإدارة المركزية وتسجيل» ×10)
 *   booklet-02-extra           pdf-text    80.6%   («SITE-» ×19)
 *   site-safety-02             pdf-text    80.6%   («SITE-» ×19)
 *
 * Good reads sit at or under 3%, bad reads at or above 78%. 35% sits in the
 * empty middle: far enough above real repetition that a booklet quoting the
 * same material twice cannot trip it, far enough below the broken reads that
 * they cannot escape it.
 */
const NAME_DUPLICATION_SUSPECT_SHARE = 0.35

/** Below this there is not enough evidence to call duplication a pattern. */
const NAME_DUPLICATION_MIN_ROWS = 8

/**
 * Detect that the reader served a column that is not the description.
 *
 * This exists because the failure it catches wore the costume of a success. On
 * a 180-item booklet the reader returned 180 of 180 items in 12.5 seconds with
 * every quantity and unit correct, and 154 of the 180 descriptions were the
 * neighbouring `الفئة` category plus a fragment of `المواصفة` — the item name
 * was never served at all. Every count-based indicator was green. The only
 * thing that distinguished it from a clean read was that the names repeated.
 */
export function measureNameDuplication(
  lines: Array<Pick<ParsedLine, 'name' | 'itemCode'>>,
): {
  share: number
  repeatedRows: number
  worstName: string
  worstCount: number
} {
  /*
   * A NAME REPEATING IS NOT A FAILURE. THE SAME NAME UNDER MANY ITEMS IS.
   *
   * A BOQ item is priced once per building, per floor, per section: «توريد
   * وتركيب شبكة المياه الباردة والساخنة» is nineteen correct rows under one
   * item code. The failure this guard exists for looks different — one
   * category or one boilerplate sentence spread over DIFFERENT items — so the
   * count is per name across distinct item codes, and rows that carry no code
   * are still counted the old way, because nothing there says they belong
   * together.
   */
  const codesByName = new Map<string, Set<string>>()
  const rowsByName = new Map<string, number>()
  const uncodedByName = new Map<string, number>()
  for (const line of lines) {
    const key = String(line.name || '').replace(/\s+/g, ' ').trim()
    if (!key) continue
    rowsByName.set(key, (rowsByName.get(key) ?? 0) + 1)
    const code = String(line.itemCode || '').trim()
    if (!code) {
      uncodedByName.set(key, (uncodedByName.get(key) ?? 0) + 1)
      continue
    }
    if (!codesByName.has(key)) codesByName.set(key, new Set())
    codesByName.get(key)!.add(code)
  }

  let repeatedRows = 0
  let worstName = ''
  let worstCount = 0
  for (const [name, rows] of rowsByName) {
    const spread = codesByName.get(name)?.size ?? 0
    const uncoded = uncodedByName.get(name) ?? 0
    // Suspicious rows: those sharing a name across more than one item, plus
    // uncoded rows that merely share a name with something.
    const suspicious = (spread > 1 ? rows - uncoded : 0) + (uncoded > 1 ? uncoded : 0)
    if (suspicious > 1) repeatedRows += suspicious
    if (suspicious > worstCount) {
      worstCount = suspicious
      worstName = name
    }
  }
  return {
    share: lines.length > 0 ? repeatedRows / lines.length : 0,
    repeatedRows,
    worstName,
    worstCount,
  }
}

/** SHA-256 hex of file bytes — stable document identity for this upload. */
export async function hashDocumentId(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Node / test fallback without subtle crypto
  let h = 0
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) h = (Math.imul(31, h) + bytes[i]!) | 0
  return `doc-${(h >>> 0).toString(16)}-${bytes.length}`
}

/** A document with fewer codes than this is not judged by them. */
const CODED_ITEMS_MIN = 30
/** Reading under this share of the printed item codes means the item table was missed. */
const CODED_ITEMS_READ_SHARE = 0.5

/**
 * Section totals and carried sums, in the wordings real booklets use. Anchored
 * on the WORD so a product that merely contains it («إجمالي الطول» inside a
 * description) is judged by where it sits: only a name that STARTS or ENDS
 * with the total wording, or is little else, is a total line.
 */
export function isTotalLine(name: string | null | undefined): boolean {
  const n = String(name || '')
    .normalize('NFKC')
    // A PDF that cannot map a glyph emits U+0000 (and friends) in its place.
    // Measured on the MasterFormat site booklets: «إجما\u0000» — the ي is a
    // NUL — so the total word was followed by a character that is neither a
    // letter nor whitespace, and the line slipped through as an item.
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\uFFFD]/g, ' ')
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/\s+/g, ' ')
    .trim()
  if (!n) return false
  // A total WORD, never a prefix of another word: «مجموعة أدوات» is a tool set
  // and «مجموع» is a sum. \b is ASCII-only in JavaScript, so the boundary is
  // spelled out for Arabic letters.
  const AR = '\\u0600-\\u06FF'
  const word = `(?:ال)?(?:اجمال[يى]|اجما|مجموع)(?![${AR}\\w])|(?<![A-Za-z])(?:sub-?total|total|carried (?:forward|to summary))(?![A-Za-z])`
  const starts = new RegExp(`^(?:${word})`, 'i').test(n)
  const ends = new RegExp(`(?:^|[^${AR}\\w])(?:${word})\\s*[:：-]?\\s*$`, 'i').test(n)
  return starts || ends
}

/**
 * Distinct item codes printed in the document: 8-digit MasterFormat numbers
 * (02025001) and hierarchical references (B.02.02.03.01). Read from the text,
 * not from the rows, so it is a count the row reader did not produce.
 */
export function countDistinctItemCodes(text: string | null | undefined): number {
  const t = String(text || '').normalize('NFKC')
  const codes = new Set<string>()
  for (const m of t.matchAll(/(?<!\d)(\d{8})(?!\d)/g)) codes.add(m[1]!)
  for (const m of t.matchAll(/(?<![\w.])([A-Z]\.\d{2}(?:\.\d{2}){2,5})(?![\w.])/g)) codes.add(m[1]!)
  return codes.size
}

/**
 * Pure line-selection for one upload. Never reuses a previous document's lines.
 * The waiting-hall curated list applies only when this document fingerprints as
 * that specific booklet AND text extract is too weak (<20 lines).
 *
 * Client Farq-test parsers (مستودع / DC / SITE) always compete with API rows —
 * a few junk API rows must never block a rich client extract.
 */
export function resolveParsedLines(input: {
  apiLines?: ParsedLine[]
  text?: string
  fileName: string
  /** Column-aware read of a real table, when the document carried one. */
  table?: BoqTableResult | null
}): {
  lines: ParsedLine[]
  source: ParseBoqResult['source']
  projectName: string
  /** How many column-read rows the API could describe, so a booklet read
   *  without its technical text is visible rather than assumed. */
  specsFromApi: number
  /** Set when the names repeat too heavily to be names. */
  descriptionColumnSuspect: boolean
  descriptionColumnDetail: string
  codedItemsSuspect: boolean
  codedItemsDetail: string
} {
  let specsFromApi = 0
  let lines = Array.isArray(input.apiLines) ? [...input.apiLines] : []
  let source: ParseBoqResult['source'] = lines.length > 0 ? 'pdf-text' : 'empty'
  let projectName = input.fileName.replace(/\.[^.]+$/, '')
  const text = String(input.text || '')

  if (text.trim()) {
    const fromText = parseLinesFromText(text)
    const farqTest = parseFarqTestBoqText(text)
    const clientBest =
      farqTest.length >= fromText.length ? farqTest : fromText

    // Prefer the richer set for THIS document only (never a prior upload).
    if (clientBest.length > lines.length) {
      lines = clientBest
      source = clientBest.length > 0 ? 'pdf-text' : source
    } else if (lines.length === 0 && clientBest.length > 0) {
      lines = clientBest
      source = 'pdf-text'
    }

    // Coordinates outrank reading order, and a longer list does not win on
    // length. A text heuristic or an API row set can hold more rows and still be
    // wrong in the way that matters: on the reference booklet the text path
    // produced 31 rows whose quantities were structural codes. Measured here
    // once: with one page of that booklet removed, the column reader returned 51
    // correct items and reported the 17 it could not see, while the text path
    // returned 52 — and preferring the longer list threw away both the correct
    // values and the report of what was missing.
    //
    // The column reader is preferred whenever it read most of the numbering the
    // booklet itself prints. Below that it is not a better reader of this
    // document, so the text path stands and the column reader's complaints are
    // carried out as warnings rather than dropped.
    const tableLines = tableRowsToLines(input.table)
    const expected = input.table?.expectedCount ?? 0
    const tableShare = expected > 0 ? tableLines.length / expected : tableLines.length > 0 ? 1 : 0
    //
    // The share is of the numbering the reader could see. A booklet whose
    // unnumbered pages sit beside numbered ones prints far more numbers than
    // any reader can recover, and the text path is no better at them: measured
    // on a 1,650-row booklet, 569 column rows lost to 47 text lines on share
    // alone. So a column read that dwarfs the text path is preferred as well.
    const tableDwarfsText = tableLines.length >= Math.max(20, 3 * clientBest.length)
    if (tableLines.length > 0 && (tableShare >= TABLE_PREFERENCE_SHARE || tableDwarfsText)) {
      // Winning on values is not the same as carrying everything. The quantities
      // table prints no specification column — the technical text sits in a
      // separate section pages later — so the column reader's rows arrive
      // specless, and a specless line matches by name alone. That is what turns
      // ppr-pipes into pvc-pipe: a different material with different suppliers.
      // The API reads that section, and on the reference booklet the two agree
      // on all 68 quantities, so its text is attached rather than its rows.
      const withSpecs = withApiSpecs(tableLines, input.apiLines)
      specsFromApi = withSpecs.filter((line, i) => line.spec !== tableLines[i]?.spec).length
      lines = withSpecs
      source = 'pdf-table'
    }

    const titleMatch =
      text.match(/مشروع[:\s]+([^\n]{8,80})/) ||
      text.match(/توريد\s+مواد\s+ومعدات\s+ل([^\n-]{8,60})/) ||
      text.match(/كراسة\s+اختبار\s+كبيرة\s+-\s+([^\n]{8,80})/)
    if (titleMatch?.[1]) {
      projectName = titleMatch[1].replace(/\s+/g, ' ').trim()
    }
    // No canned project names and no stored table: a weak read stays a weak
    // read and is reported as one. Quantities are never supplied by the app.
  } else if (lines.length > 0) {
    source = 'pdf-text'
  }

  // A section TOTAL is not an item, and its amount is not a quantity. Measured
  // 2026-09-17 on a MasterFormat site booklet: 18 "items" were read from a
  // document carrying 325 item codes, every one a «… إجمالي» line whose SAR
  // total had landed in the quantity column — and a supplier was proposed for
  // «اعمال خرسانة إجمالي 108,276 عدد». Dropped before anything is matched.
  const beforeTotals = lines.length
  lines = lines.filter((line) => !isTotalLine(line.name))
  const totalLinesDropped = beforeTotals - lines.length

  // Row count is not a denominator the reader may grade itself against. Item
  // codes printed in the document are: when it carries many more distinct codes
  // than rows we read, the item table was missed, whatever else "completed".
  const codedItems = countDistinctItemCodes(text)
  const codedItemsSuspect = codedItems >= CODED_ITEMS_MIN && lines.length < codedItems * CODED_ITEMS_READ_SHARE
  const codedItemsDetail = codedItemsSuspect
    ? `تحمل الوثيقة ${codedItems} كودًا مميّزًا لبنود، وقرأنا ${lines.length} صفًّا فقط` +
      (totalLinesDropped ? ` بعد استبعاد ${totalLinesDropped} سطر إجمالي قُرئ مبلغه ككمية` : '') +
      '. جدول البنود الحقيقي لم يُقرأ. لا تعتمد على هذه البنود ولا على كمياتها.'
    : ''

  // Measured last, on whatever won, because the question is about the text we
  // are about to serve rather than about the path that produced it.
  const dup = measureNameDuplication(lines)
  // This guard exists for reads made by column geometry, which can serve the
  // category column as the item name. A server-verified read names a row by its
  // MATERIAL, tied to a code and a quantity both checked on the printed page —
  // and materials repeat by nature: measured on a site BOQ, «خرسانة مسلحة 30
  // ميجاباسكال» is 44 correct rows (columns, beams, slabs, per building), and
  // the guard called 1,039 verified rows an invalid read.
  const verifiedShare = lines.length ? lines.filter((l) => l.codeVerified).length / lines.length : 0
  const descriptionColumnSuspect =
    verifiedShare < 0.8 &&
    lines.length >= NAME_DUPLICATION_MIN_ROWS &&
    dup.share >= NAME_DUPLICATION_SUSPECT_SHARE
  const descriptionColumnDetail = descriptionColumnSuspect
    ? `${dup.repeatedRows} من ${lines.length} بندًا تحمل وصفًا مكررًا، وأكثر وصف تكرارًا «${dup.worstName}» ظهر ${dup.worstCount} مرة. أسماء البنود لا تتكرر بهذا الشكل، فالأرجح أننا قرأنا عمود الفئة أو المواصفة بدل عمود البند.`
    : ''

  return { lines, source, projectName, specsFromApi, descriptionColumnSuspect, descriptionColumnDetail, codedItemsSuspect, codedItemsDetail }
}

/**
 * Attaches the API's technical specification text to rows the column reader
 * owns. Values are never taken from the API here — only the text the quantities
 * table does not carry.
 *
 * Deliberately not keyed on the API's item number: its rows inherit a page-27
 * aggregate that collides on number 1, and the collision cascades so every
 * later row is numbered one too high. Keyed on the name instead, and attached
 * only where exactly one API row carries that name AND states the same
 * quantity. A specification belonging to the row above is worse than none:
 * it reads as certain and sends a supplier the wrong item's dimensions.
 */
function withApiSpecs(lines: ParsedLine[], apiLines: ParsedLine[] | undefined): ParsedLine[] {
  if (!apiLines?.length) return lines
  const key = (name: string) => normalizeAr(name).replace(/\s+/g, '')
  const qty = (value: string | number) => String(value ?? '').replace(/[,\s،]/g, '')
  const candidates = new Map<string, ParsedLine[]>()
  for (const line of apiLines) {
    if (!String(line.spec || '').trim()) continue
    const k = key(line.name)
    if (!k) continue
    const list = candidates.get(k)
    if (list) list.push(line)
    else candidates.set(k, [line])
  }
  if (!candidates.size) return lines
  return lines.map((line) => {
    const list = candidates.get(key(line.name))
    if (list?.length !== 1) return line
    const [match] = list
    if (qty(match.qty) !== qty(line.qty)) return line
    const spec = String(match.spec || '').trim()
    const existing = String(line.spec || '').trim()
    // The structural code stays, behind the text a supplier can actually quote.
    return { ...line, spec: existing ? `${spec} · ${existing}` : spec }
  })
}

/** Table rows as BOQ lines. The structural code travels as a spec, never as a
 * quantity — reading it as the quantity is what asked suppliers for 2,085 عدد
 * of a handrail whose real quantity is 385 م ط. */
function tableRowsToLines(table: BoqTableResult | null | undefined): ParsedLine[] {
  if (!table?.rows?.length) return []
  return table.rows.map((row) => {
    const spec = [row.spec, row.code ? `رمز إنشائي ${row.code}` : '', row.category]
      .filter(Boolean)
      .join(' · ')
    return {
      id: row.id,
      name: row.name,
      qty: row.qty,
      unit: row.unit,
      spec: spec || undefined,
    }
  })
}

/**
 * How much of a booklet's own numbering the column reader must recover before
 * its rows are preferred over the text path. A partial column read is still
 * reported item by item; this only decides which reader owns the result.
 */
const TABLE_PREFERENCE_SHARE = 0.6

/** Farq parse-pdf always prefixes rows with this header (see api boq-pdf.js). */
const FARQ_BOQ_HEADER = ['اسم المادة', 'الكمية', 'الوحدة', 'المواصفة الفنية', 'موقع التوريد', 'ملاحظات']

const NAME_ALIASES = [
  'اسم المادة بالعربية',
  'اسم المادة',
  'الوصف',
  'البند',
  'description',
  'material name',
  'product name',
  'item_name',
  'name_ar',
  'name',
  'material',
] as const

const QTY_ALIASES = ['الكمية', 'quantity', 'qty'] as const
const UOM_ALIASES = ['الوحدة', 'unit', 'uom'] as const
const SPEC_ALIASES = ['المواصفة الفنية', 'specification', 'spec'] as const
const NOTES_ALIASES = ['ملاحظات', 'notes'] as const
const ID_ALIASES = ['البند', 'item no', 'item #', 'no', '#'] as const

const HEADER_NAME_RE =
  /^(اسم الماده?(?:\s*بالعربيه?)?|اسم الماده? بالانجليزيه?|الوصف|البند|المواصفه?(?:\s*الفنيه?)?|الكميه?|الوحده?|ملاحظات|موقع التوريد|item(?:[_\s-]?name)?|description|material(?:[_\s-]?name)?|product(?:[_\s-]?name)?|name(?:_ar|_en)?|qty|quantity|uom|unit)$/i

/** Fold Arabic spelling variants so header aliases match OCR/Excel drift. */
function foldHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeHeaderCell(value: unknown): string {
  return foldHeader(value)
}

function isHeaderLabel(value: unknown): boolean {
  const raw = String(value ?? '').trim()
  if (!raw) return false
  return HEADER_NAME_RE.test(raw) || HEADER_NAME_RE.test(foldHeader(raw))
}

function isBoqHeaderRow(row: (string | number)[]): boolean {
  const cells = row.map((c) => normalizeHeaderCell(c)).filter(Boolean)
  if (!cells.length) return false
  const joined = cells.join(' ')
  if (
    cells[0] === normalizeHeaderCell(FARQ_BOQ_HEADER[0]) &&
    cells[1] === normalizeHeaderCell(FARQ_BOQ_HEADER[1])
  ) {
    return true
  }
  return (
    /اسم الماده|الوصف|description|material/.test(joined) &&
    /الكميه|quantity|qty/.test(joined)
  )
}

function columnIndex(headers: string[], aliases: readonly string[]): number {
  const norms = aliases.map((a) => normalizeHeaderCell(a)).filter(Boolean)
  if (!norms.length) return -1
  return headers.findIndex((h) => {
    if (!h) return false
    return norms.some((alias) => h === alias || h.includes(alias) || (alias.length >= 3 && alias.includes(h)))
  })
}

function cellAt(row: (string | number)[], index: number): string {
  if (index < 0) return ''
  return String(row[index] ?? '').trim()
}

function pickFromRecord(record: Record<string, unknown>, aliases: readonly string[]): string {
  const entries = Object.entries(record)
  for (const alias of aliases) {
    const want = normalizeHeaderCell(alias)
    if (!want) continue
    for (const [key, value] of entries) {
      const have = normalizeHeaderCell(key)
      if (!have) continue
      if (have === want || have.includes(want) || (want.length >= 3 && want.includes(have))) {
        const text = String(value ?? '').trim()
        if (text) return text
      }
    }
  }
  return ''
}

/**
 * Coerce Farq/Excel row shapes into a cell array.
 * Supports: string[] rows, and objects keyed by Arabic/English column titles
 * (never use Object.keys as cell values — that produced "اسم المادة" cards).
 */
function coerceRow(row: unknown): (string | number)[] | null {
  if (Array.isArray(row)) {
    return row.map((c) => (c == null ? '' : (c as string | number)))
  }
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const name = pickFromRecord(record, NAME_ALIASES)
  const qty = pickFromRecord(record, QTY_ALIASES)
  const unit = pickFromRecord(record, UOM_ALIASES)
  if (name || qty || unit) {
    return [
      name,
      qty || 1,
      unit || 'عدد',
      pickFromRecord(record, SPEC_ALIASES),
      pickFromRecord(record, ['موقع التوريد', 'delivery location', 'location']),
      pickFromRecord(record, NOTES_ALIASES),
    ]
  }
  // Last resort: values only (insertion order), never keys.
  const values = Object.values(record).filter((v) => v != null && String(v).trim() !== '')
  return values.length ? (values as (string | number)[]) : null
}

function extractBoqItemNumber(notes: string): number | null {
  const m = notes.match(/بند\s*الكراسة\s*[:：]?\s*(\d{1,4})/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** True when a parsed line is the Farq/Excel header mistaken for a BOQ item. */
export function isBoqHeaderLabelItem(item: Pick<ParsedLine, 'name' | 'qty' | 'unit'>): boolean {
  if (isHeaderLabel(item.name)) return true
  return isHeaderLabel(item.qty) && isHeaderLabel(item.unit)
}

/** Drop spreadsheet header rows that leaked into BOQ items (e.g. name=اسم المادة). */
export function sanitizeBoqLines<T extends Pick<ParsedLine, 'name' | 'qty' | 'unit'>>(items: T[]): T[] {
  return items.filter((item) => !isBoqHeaderLabelItem(item))
}

/**
 * Card/display binding: prefer real BOQ fields across alternate API/parser keys.
 * Never surface spreadsheet header labels (اسم المادة / الكمية / الوحدة).
 */
export function resolveBoqCardFields(
  item: Record<string, unknown> | Pick<ParsedLine, 'name' | 'qty' | 'unit' | 'spec'>,
): { name: string; qty: string; unit: string; spec?: string } {
  const rec = item as Record<string, unknown>
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = rec[key]
      if (value == null) continue
      const text = String(value).trim()
      if (!text || isHeaderLabel(text)) continue
      return text
    }
    return ''
  }

  // `original_name` first: where it exists it IS the booklet's own text, and a
  // `name_ar` beside it may be a catalog label written over the real item.
  const name =
    pick('original_name', 'name', 'name_ar', 'description', 'material', 'item_name', 'name_en') ||
    'بند بدون اسم'
  const qty = pick('qty', 'quantity') || '1'
  const unit = pick('unit', 'uom') || 'عدد'
  const spec = pick('spec', 'specification', 'original_description') || undefined
  return { name, qty, unit, spec }
}

/**
 * Map Farq / Excel BOQ matrix → line items.
 * Farq API returns HEADER + data rows shaped as:
 *   [اسم المادة, الكمية, الوحدة, المواصفة الفنية, موقع التوريد, ملاحظات]
 * Also accepts object rows keyed by those titles.
 * Positional fallbacks: [name, qty, uom] or [id, name, qty, uom].
 */
/**
 * What the server's verified page reader says about a row, carried in the notes
 * cell it writes: the printed item code, that code and quantity were checked
 * against the page, and whether the row is work with nothing to buy.
 */
function serverReadFacts(notes: string): Pick<ParsedLine, 'itemCode' | 'codeVerified' | 'workOnly'> {
  const text = String(notes || '')
  // Two server reads qualify: the verified extractor, and the column reader,
  // which ties every row to a code and a quantity taken from the printed page
  // by their coordinates. The second used to be treated as unverified, so a
  // booklet read entirely by geometry scored zero and tripped the duplicate
  // guard on its own correct rows.
  if (!/قراءة آلية مُتحقَّق|قراءة جدولية من إحداثيات الصفحة/.test(text)) return {}
  const code = text.match(/بند الكراسة:\s*(\S+)/)?.[1]
  return { itemCode: code || undefined, codeVerified: true, workOnly: /عمل بلا توريد/.test(text) || undefined }
}

export function rowsToLines(rows: unknown[]): ParsedLine[] {
  if (!Array.isArray(rows) || rows.length === 0) return []

  const matrix = rows.map(coerceRow).filter((row): row is (string | number)[] => Array.isArray(row))
  if (!matrix.length) return []

  const headerIndex = matrix.findIndex((row) => isBoqHeaderRow(row))
  const headers =
    headerIndex >= 0 ? (matrix[headerIndex] || []).map((c) => normalizeHeaderCell(c)) : []

  // Prefer Farq's fixed column order when the known HEADER is present.
  const farqShaped =
    headerIndex >= 0 &&
    normalizeHeaderCell(matrix[headerIndex]?.[0]) === normalizeHeaderCell(FARQ_BOQ_HEADER[0]) &&
    normalizeHeaderCell(matrix[headerIndex]?.[1]) === normalizeHeaderCell(FARQ_BOQ_HEADER[1])

  const nameCol = farqShaped ? 0 : headers.length ? columnIndex(headers, NAME_ALIASES) : -1
  const qtyCol = farqShaped ? 1 : headers.length ? columnIndex(headers, QTY_ALIASES) : -1
  const unitCol = farqShaped ? 2 : headers.length ? columnIndex(headers, UOM_ALIASES) : -1
  const specCol = farqShaped ? 3 : headers.length ? columnIndex(headers, SPEC_ALIASES) : -1
  const notesCol = farqShaped ? 5 : headers.length ? columnIndex(headers, NOTES_ALIASES) : -1
  const idCol = farqShaped ? -1 : headers.length ? columnIndex(headers, ID_ALIASES) : -1

  const dataStart = headerIndex >= 0 ? headerIndex + 1 : 0
  const out: ParsedLine[] = []
  const usedIds = new Set<number>()

  for (let i = dataStart; i < matrix.length; i++) {
    const row = matrix[i] || []
    if (!row.some((c) => String(c ?? '').trim())) continue
    if (isBoqHeaderRow(row)) continue

    let name = ''
    let qtyRaw: string | number = 1
    let unitRaw = 'عدد'
    let spec: string | undefined
    let idHint: number | null = null
    let notesText = ''

    if (nameCol >= 0) {
      name = cellAt(row, nameCol)
      qtyRaw = cellAt(row, qtyCol) || 1
      unitRaw = cellAt(row, unitCol) || 'عدد'
      const specVal = cellAt(row, specCol)
      if (specVal && !isHeaderLabel(specVal)) spec = specVal
      const notes = cellAt(row, notesCol)
      notesText = notes
      idHint = extractBoqItemNumber(notes)
      if (idCol >= 0) {
        const rawId = Number(cellAt(row, idCol))
        if (Number.isFinite(rawId) && rawId > 0) idHint = rawId
      }
    } else {
      // Common shapes: [name, qty, uom, …] (Farq) or [id, name, qty, uom]
      const first = String(row[0] ?? '').trim()
      const looksId = /^\d{1,4}$/.test(first)
      name = String(looksId ? row[1] : row[0] ?? '').trim()
      qtyRaw = (looksId ? row[2] : row[1]) ?? 1
      unitRaw = String((looksId ? row[3] : row[2]) ?? 'عدد')
      const specVal = String((looksId ? row[4] : row[3]) ?? '').trim()
      if (specVal && !isHeaderLabel(specVal)) spec = specVal
      const notes = String((looksId ? row[5] : row[4]) ?? '').trim()
      idHint = looksId ? Number(first) : extractBoqItemNumber(notes)
    }

    if (!name || name.length < 2) continue
    if (isHeaderLabel(name)) continue
    if (isHeaderLabel(qtyRaw) && isHeaderLabel(unitRaw)) continue

    // Keep API/Excel cell text as-is.
    const cleanedName = name.replace(/\s+/g, ' ').trim()
    if (!cleanedName || isHeaderLabel(cleanedName)) continue

    // A server-verified row is identified by its printed CODE, which is not a
    // row number: «بند الكراسة: 03300002» parsed as one gave id 330, and the
    // 330th row then took 330 as its positional fallback — the old guard below
    // re-assigned `out.length + 1` without checking that it was free. Duplicate
    // ids are duplicate line keys, and the API refuses the whole request for
    // one («أرسل من 1 إلى 200 بند», its message for ANY invalid body). Seen on
    // a 1,319-row site BOQ: every chunk refused, no supplier shown.
    const facts = serverReadFacts(notesText)
    if (facts.codeVerified) idHint = null
    let id = idHint && !usedIds.has(idHint) ? idHint : 0
    if (!id) {
      id = out.length + 1
      while (usedIds.has(id)) id += 1
    }
    usedIds.add(id)

    out.push({
      id,
      name: cleanedName,
      qty: formatQty(qtyRaw),
      unit: normalizeUnit(String(unitRaw || 'عدد')),
      spec,
      ...facts,
    })
  }
  return sanitizeBoqLines(out)
}

/** What the booklet contains versus what we read, as soon as that is known. */
export type BoqReadFacts = {
  read: number
  expectedLineCount: number | null
  unreadableLineCount: number
  readIssues?: string[]
  skippedTables?: string[]
  /** Rows the read refused to serve as items, counted by reason. */
  setAsideCount?: number
  setAsideNote?: string
  setAsideRows?: Array<{ page?: number; quantity?: number | string | null; unit?: string | null; description?: string; reason?: string }>
  /** Travels with the early facts so the screen can refuse to call this a
   *  complete read before the longest leg even starts. */
  descriptionColumnSuspect?: boolean
  descriptionColumnDetail?: string
  codedItemsSuspect?: boolean
  codedItemsDetail?: string
}

export async function parseBoqFile(
  file: File,
  opts: {
    onStage?: BoqParseProgress
    onWork?: BoqWorkProgress
    /**
     * Fires once the lines are known, before supplier matching starts. Matching
     * is the long leg, and the owner should not spend it believing a partial
     * read is a complete one.
     */
    onRead?: (facts: BoqReadFacts) => void
    /** Line-level activity for the live panel on the processing screen. */
    onActivity?: (event: BoqActivity) => void
  } = {},
): Promise<ParseBoqResult> {
  emitActivity = opts.onActivity ?? null
  try {
    return await parseBoqFileInner(file, opts)
  } finally {
    emitActivity = null
  }
}

async function parseBoqFileInner(
  file: File,
  opts: {
    onStage?: BoqParseProgress
    onWork?: BoqWorkProgress
    onRead?: (facts: BoqReadFacts) => void
  },
): Promise<ParseBoqResult> {
  const stage = opts.onStage ?? (() => {})
  const work = opts.onWork ?? noWork
  stage('open')
  work({ kind: 'start', leg: 'hash', opaque: true })
  const documentId = await hashDocumentId(file)
  work({ kind: 'end', leg: 'hash' })
  let apiLines: ParsedLine[] = []
  let text = ''
  let table: BoqTableResult | null = null
  let extractError = ''

  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  // CRITICAL (live UploadView): extract client text FIRST.
  // Never block local Farq-test parsers behind Farq API queue/OCR (that left SITE
  // booklet at 0 lines when API was slow/empty and pdf worker failed silently).
  stage('read')
  try {
    // pdf.js resolves `getDocument().promise` only after the worker handshakes.
    // A worker chunk that 404s (or goes stale across an HMR reload) leaves that
    // promise pending forever — the whole upload then hangs with a clean console.
    // This is the only unbounded await in the flow, so it gets a hard cap.
    const extract = await withDeadline(
      extractPlainText(file, work),
      CLIENT_EXTRACT_TIMEOUT_MS,
      PDF_EXTRACT_TIMEOUT,
    )
    text = extract.text
    table = extract.table
  } catch (err) {
    extractError = err instanceof Error ? err.message : String(err)
    console.warn('BOQ extract failed', err)
  }

  const clientLooksLikeScan = isPdfScanNoTextError(extractError)

  // A complete column read does not need the API's rows — measured on the
  // reference booklet, the two agree on all 68 quantities — but it does need its
  // specification text, which the quantities table never prints. So the call is
  // still made, on a shorter leash: here we are only waiting for text that makes
  // matching specific, and 68 correctly-valued specless lines beat a longer wait.
  const tableIsComplete = Boolean(
    table &&
      table.rows.length > 0 &&
      table.issues.length === 0 &&
      table.expectedCount === table.rows.length,
  )

  /** Rows the server read but refused to serve as items, with their reason. */
  let setAside: Array<{
    page?: number
    quantity?: number | string | null
    unit?: string | null
    description?: string
    reason?: string
  }> = []

  // Optional API enrichment — capped wait so a hung job cannot strand UploadView.
  // Scanned PDFs: give Farq tender extract (OCR when enabled) more time before giving up.
  if (isPdf) {
    let apiTimer: ReturnType<typeof setTimeout> | undefined
    let serverReadError = ''
    // A coded BOQ (MasterFormat, hierarchical) is one this browser cannot read:
    // measured, it yields a dozen total lines out of hundreds of items. The
    // server reads those page by page with the AI reader, which takes 1-3
    // minutes — so here, as for a scan, the server is not an enrichment but the
    // only chance of a real read. Waiting 12s and then serving the local read
    // is what showed «قراءة غير صالحة» while the server was on page 3 of 36.
    const codedBoq = countDistinctItemCodes(text) >= CODED_ITEMS_MIN
    const apiWaitMs = codedBoq ? 840_000 : clientLooksLikeScan ? 45_000 : tableIsComplete ? 6_000 : 12_000
    // A scan gets the longer wait because OCR is its only chance of any lines at
    // all — the owner must be told which of the two ceilings he is sitting under.
    work({ kind: 'start', leg: 'api-parse', opaque: true, capMs: apiWaitMs })
    try {
      const { parseConstructionBoqPdf } = await import('../api/constructionClient')
      const apiOrTimeout = await Promise.race([
        parseConstructionBoqPdf(file, (p) => emitActivity?.({ kind: 'reading', ...p })).then((api) => ({ kind: 'api' as const, api })),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          apiTimer = setTimeout(() => resolve({ kind: 'timeout' }), apiWaitMs)
        }),
      ])
      if (apiOrTimeout.kind === 'api' && apiOrTimeout.api.rows?.length) {
        apiLines = rowsToLines(apiOrTimeout.api.rows)
        // «لا أريد أي بند يختفي بصمت»: what the read refused, carried to the
        // screen with its reason instead of being dropped without a word.
        setAside = apiOrTimeout.api.set_aside || []
      }
    } catch (err) {
      console.warn('Farq BOQ parse API unavailable, using client parse', err)
      if (!extractError && isPdfScanNoTextError(err)) {
        extractError = PDF_SCAN_NO_TEXT
      }
      serverReadError = err instanceof Error ? err.message : 'تعذّر الوصول إلى الخادم'
    } finally {
      if (apiTimer) clearTimeout(apiTimer)
      work({ kind: 'end', leg: 'api-parse' })
    }
    // A booklet that numbers its own items can only be read by the server. If
    // that read did not arrive, the local one is known in advance to be wrong
    // (20 rows of «ما بند» for 387 printed codes), so it is not shown at all:
    // the buyer gets one sentence and «إعادة المحاولة».
    if (codedBoq && apiLines.length === 0) {
      // The server names an outage in words meant for the buyer («ملفك سليم»);
      // wrapping it in «انقطعت القراءة» would hide that nothing is wrong with
      // his file.
      if (/ملفك سليم/.test(serverReadError)) throw new Error(serverReadError)
      throw new Error(
        `انقطعت قراءة الكراسة على الخادم قبل أن تكتمل${serverReadError ? ` (${serverReadError})` : ''}. لم يُفقد شيء: اضغط «إعادة المحاولة».`,
      )
    }
  }

  stage('analyze')
  work({ kind: 'start', leg: 'resolve' })
  const resolved = resolveParsedLines({
    apiLines,
    text,
    table,
    fileName: file.name,
  })
  const { lines, source, projectName, specsFromApi } = resolved
  work({ kind: 'end', leg: 'resolve' })

  // What the booklet says it contains versus what we produced. Reported on every
  // path below, including the failure paths, so a partial read can never reach
  // the screen dressed as a complete one.
  // Also when nothing was read at all: if the column reader saw a table and
  // failed on every row, that is the most useful thing we know about the file.
  const usedTable = table && (source === 'pdf-table' || lines.length === 0)
  // When the text path won, the column reader's complaints still travel — as a
  // warning, so a table it could not read is never simply forgotten.
  /*
   * THE BROWSER'S OWN READER IS NOT THE READ THE BUYER IS LOOKING AT.
   *
   * This note exists for the case where the LOCAL text path won and the local
   * column reader had complained. When the SERVER read the booklet — which it
   * now does for every coded BOQ — the line «قارئ الأعمدة رأى جدولًا ولم
   * يكمله (0 من 34)» describes a reader whose output is not on screen, and it
   * reads as a verdict on the 1,514 lines that are. It is only shown when the
   * lines actually came from this browser.
   */
  const servedByServer = apiLines.length > 0 && lines.length === apiLines.length
  const shelvedTableNote =
    table && !usedTable && !servedByServer && table.issues.length
      ? `قرأنا هذا الملف بالمسار النصي. قارئ الأعمدة رأى جدولًا ولم يكمله (${table.rows.length} من ${table.expectedCount ?? '؟'}).`
      : ''
  // The quantities table carries no technical column; that text comes from the
  // API. Without it a line matches on its name alone, which is how a «ماسورة»
  // finds the wrong material — so the shortfall is stated, not assumed.
  //
  // It is stated as pending rather than as absent on purpose. The API has not
  // failed here, it has not answered inside the window this screen waits (see
  // the extraction timeout below): on a 6.9 MB booklet the server is still
  // reading while we render. Saying «وصلت لـ 0» invites the reader to conclude
  // the text does not exist, and he then finds technical text on a later
  // screen and concludes the count lied to him.
  // Count the specifications the reader will actually put on screen, from
  // whichever source supplied them. `specsFromApi` counts only the ones the
  // API filled in, and a booklet that prints its own «المواصفة المختصرة»
  // column needs nothing from the API at all — so datacenter-cyber-01, which
  // reads perfectly and shows technical text on every card, was reporting
  // «المواصفات الفنية لم تصل بعد لـ 180 من 180». That is the same false
  // count we have been clearing all day, pointing the other way: it tells the
  // owner everything failed while the evidence in front of him says otherwise.
  const specsPresent = lines.filter((line) => String(line.spec || '').trim()).length
  const specsPending = lines.length - specsPresent
  // Two different causes, and blaming the slow one for the other is how the
  // owner was told a 6-second window was at fault when he simply had no
  // session: the extraction runs on the server, so with no session it never
  // started rather than ran late.
  const specNote =
    source === 'pdf-table' && specsPending > 0
      ? currentAuthMode() === 'demo'
        ? `المواصفات الفنية لم تُستخرج (${specsPending} من ${lines.length} بندًا): استخراجها يجري على خادم فرق ويحتاج تسجيل دخول. الكميات والوحدات مقروءة بالكامل من الكراسة نفسها.`
        : `المواصفات الفنية لم تصل بعد لـ ${specsPending} من ${lines.length} بندًا — استخراجها من الكراسة أبطأ من مهلة هذه الشاشة، فطُوبقت هذه البنود بالاسم والكمية. الكميات والوحدات مقروءة بالكامل.`
      : ''
  const expectedLineCount = usedTable ? table!.expectedCount : null
  const unreadableLineCount = usedTable ? unreadableCount(table!) : 0
  const readIssues = usedTable ? table!.issues.map((issue) => issue.detail) : []
  const skippedTables = usedTable
    ? table!.otherTables.map((t) => `صفحة ${t.page}: جدول آخر لم نقرأه كبنود — «${t.header}»`)
    : []
  /*
   * WHAT THE READ REFUSED TO SERVE, SAID OUT LOUD.
   *
   * «لا أريد أي بند يختفي بصمت». The server sets a row aside when it has no
   * quantity, no readable text, or a number sitting off the quantity column.
   * Those rows are almost always totals and sub-headings — «almost always» is
   * not a reason to delete them without a word, so they are counted by reason
   * and reported beside the read.
   */
  const REASON_AR: Record<string, string> = {
    NO_QUANTITY: 'بلا كمية',
    NO_TEXT: 'بلا نص مقروء',
    OFF_QUANTITY_COLUMN: 'رقمها خارج عمود الكميات',
  }
  const setAsideByReason = new Map<string, number>()
  for (const row of setAside) {
    const key = REASON_AR[String(row.reason || '')] || 'سبب غير معروف'
    setAsideByReason.set(key, (setAsideByReason.get(key) || 0) + 1)
  }
  const setAsideNote = setAside.length
    ? `استبعدنا ${setAside.length} سطرًا من الكراسة ولم نعرضها كبنود: ` +
      [...setAsideByReason.entries()].map(([reason, n]) => `${n} ${reason}`).join('، ') +
      '. غالبها إجماليات وعناوين، راجعها إن كنت تتوقع بنودًا أكثر.'
    : ''

  const readFacts = {
    expectedLineCount,
    unreadableLineCount,
    setAsideCount: setAside.length || undefined,
    setAsideNote: setAsideNote || undefined,
    setAsideRows: setAside.length ? setAside.slice(0, 50) : undefined,
    readIssues: readIssues.length ? readIssues : undefined,
    skippedTables: skippedTables.length ? skippedTables : undefined,
    descriptionColumnSuspect: resolved.descriptionColumnSuspect || undefined,
    descriptionColumnDetail: resolved.descriptionColumnDetail || undefined,
    codedItemsSuspect: resolved.codedItemsSuspect || undefined,
    codedItemsDetail: resolved.codedItemsDetail || undefined,
  }
  opts.onRead?.({ read: lines.length, ...readFacts })
  emitActivity?.({ kind: 'read', names: lines.map((line) => line.name) })

  // Explicit empty — never invent lines from another document / prior session.
  if (lines.length === 0) {
    const detail = clientLooksLikeScan || isPdfScanNoTextError(extractError)
      ? ` ${PDF_SCAN_NO_TEXT}`
      : extractError
        ? ` (استخراج النص: ${extractError})`
        : text.trim()
          ? ` (نص مستخرج ${text.length} حرفًا لكن بلا بنود مجدولة)`
          : ' (لا نص مستخرج من الملف)'
    const tableDetail = readIssues.length
      ? ` وجدنا جدولًا في الصفحات ${table?.pages.join('، ') || '؟'} لكن تعذّرت قراءة صفوفه: ${readIssues[0]}`
      : ''
    return {
      items: [],
      projectName,
      documentId,
      source: 'empty',
      rawLineCount: 0,
      ...readFacts,
      // A stale page cannot say anything about the booklet: it never opened it.
      matchWarning: isStaleBundleError(extractError)
        ? STALE_BUNDLE_MESSAGE
        : `لم نعثر على بنود في هذا الملف. لم نُعد استخدام كراسة سابقة.${detail}${tableDetail}`,
    }
  }

  // Supplier matching must never wipe successfully parsed lines.
  stage('match')
  try {
    const matched = await matchSuppliersForItems(lines, { onWork: work })
    const lineHasSuppliers = (item: BOQItem) =>
      item.suppliers.length > 0 ||
      (item.aiSuggestion?.suppliers.length ?? 0) > 0 ||
      (item.mapSuggestion?.suppliers.length ?? 0) > 0 ||
      (item.familySuggestion?.suppliers.length ?? 0) > 0 ||
      (item.learnedSuggestion?.suppliers.length ?? 0) > 0
    const ready = matched.items.filter(lineHasSuppliers).length
    return {
      items: matched.items,
      projectName,
      documentId,
      source,
      rawLineCount: lines.length,
      ...readFacts,
      matchDegraded: Boolean(matched.matchApiError),
      matchApiFailed: Boolean(matched.matchApiError),
      matchApiError: matched.matchApiError,
      matchWarning:
        [
          // The server is the only source of suppliers now, so when it does not
          // answer there are no suggestions to describe — the old wording
          // promised «اقتراحات أدناه من مطابقة محلية», and there are none.
          matched.matchApiError
            ? currentAuthMode() === 'demo'
              ? 'لم تسجّل الدخول، فلم تصل مطابقة الموردين إلى خادم فرق ولم نعرض أي مورد. سجّل الدخول ثم أعد رفع الكراسة.'
              : `تعذّرت مطابقة الموردين على الخادم (${matched.matchApiError}) ولم نعرض أي مورد — لا نخمّن الموردين محليًا.`
            : ready === 0
              ? `قُرئت البنود بالكامل، ولا يوجد لأي بند مورد مؤكد في سجل فرق.${isProductionBuild() ? '' : ' تأكد أن CONSTRUCTION_READ_ENABLED=1 ثم أعد الرفع.'}`
              : '',
          shelvedTableNote,
          specNote,
        ]
          .filter(Boolean)
          .join(' ') || undefined,
    }
  } catch (err) {
    console.warn('Supplier match failed after successful parse — keeping lines', err)
    return {
      items: lines.map((line) => ({
        id: line.id,
        name: line.name,
        qty: line.qty,
        unit: line.unit,
        spec: line.spec,
        status: 'searching' as const,
        supplierCount: 0,
        suppliers: [],
        lineKey: `line-${line.id}`,
      })),
      projectName,
      documentId,
      source,
      rawLineCount: lines.length,
      ...readFacts,
      matchDegraded: true,
      matchApiFailed: true,
      matchApiError: err instanceof Error ? err.message : String(err),
      matchWarning: 'قُرئت البنود، لكن تعذّرت مطابقة الموردين. يمكنك المتابعة وإعادة المطابقة لاحقًا.',
    }
  }
}
