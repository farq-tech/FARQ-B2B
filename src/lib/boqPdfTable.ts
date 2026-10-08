// Copied from فرق بناء (read-only source): farqconstraction/src/lib/boqPdfTable.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
/**
 * Coordinate-based reader for the Etimad «جدول الكميات».
 *
 * WHY THIS EXISTS. The flattened-text reader gets this booklet catastrophically
 * wrong, and quietly: on the real reference booklet (محكمة حفر الباطن 2020/48,
 * 47 pages, 68 items) it returned zero items, and when rows were separated by
 * hand it recovered 31, dropped 37 in silence, and got 1 fully right. The
 * mechanism is the dangerous part — the `الرمز الإنشائى` column (2001–2107) was
 * read as the quantity and units collapsed to «عدد», so item #1 «درابزين حديدي»
 * became 2,085 عدد instead of 385 م ط, and #14 «بورسلان أرضيات» became 5,600
 * عدد instead of 5,600 م². An RFQ asking for 5,600 *pieces* of floor porcelain
 * is exactly how «غير متوفر» replies are produced.
 *
 * Three facts about this PDF make text-order parsing impossible, and each one is
 * handled here rather than worked around:
 *
 *  1. Glyphs arrive as Arabic Presentation Forms-B (U+FB50–U+FEFF), so
 *     `includes('البند')` is false on the raw extract. Everything is folded
 *     through NFKC first.
 *  2. There are no drawn column rules at all — `get_drawings` yields only the
 *     outer frame. Columns therefore come from the header's own x anchors, read
 *     per page, never from constants.
 *  3. Reading order is not visual order, words inside a cell arrive
 *     right-to-left, units arrive reversed and split («م ط» as «ط م», «م²» as
 *     «2 م»), item text wraps across up to three visual rows with the number on
 *     the middle one, and the header itself is three stacked rows — duplicated
 *     verbatim on page 28.
 *
 * The output separates what was read from what was not. A booklet numbers its
 * own items, so any number in 1..max that we did not produce is reported as a
 * gap. Callers must surface that count: a partial read presented as a complete
 * one is what turned this defect into wrong RFQs instead of a visible error.
 */

/** One text run from `page.getTextContent()`, in PDF user space (y grows up). */
export type PdfGlyph = {
  str: string
  x: number
  y: number
  width: number
}

export type PdfPageGlyphs = {
  page: number
  glyphs: PdfGlyph[]
}

export type BoqTableRow = {
  id: number
  /** Description with visual right-to-left order undone. */
  name: string
  qty: string
  unit: string
  /** Technical specification column, where the table has one. */
  spec?: string
  category?: string
  /** `الرمز الإنشائى` (2001–2107) — carried as a spec, never as a quantity. */
  code?: string
  mandatory?: string
  page: number
  /**
   * The table printed no item number. This id counts rows, above every number
   * the booklet does print, and says nothing about the booklet's numbering:
   * such rows are never reported as gaps and never claim a printed number.
   */
  synthetic?: boolean
}

export type BoqTableIssueKind =
  | 'missing-qty'
  | 'missing-unit'
  | 'unreadable-unit'
  | 'row-without-number'
  | 'duplicate-number'
  | 'gap-in-numbering'

export type BoqTableIssue = {
  kind: BoqTableIssueKind
  page: number | null
  id: number | null
  /** Arabic, user-facing: this text is shown to the owner, not just logged. */
  detail: string
}

export type BoqTableResult = {
  rows: BoqTableRow[]
  issues: BoqTableIssue[]
  /** Pages that carried the six-column BOQ table. */
  pages: number[]
  /** Other tables found and deliberately not read as items (summary, labour). */
  otherTables: Array<{ page: number; header: string }>
  /** Highest item number the booklet itself printed, when it numbers its items. */
  expectedCount: number | null
}

/* -------------------------------------------------------------------------- */
/* Text folding                                                               */
/* -------------------------------------------------------------------------- */

const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g
const TATWEEL = /\u0640/g

/**
 * Fold presentation forms to standard Arabic. This is the single change that
 * makes `includes('الكمية')` true on this booklet; without it every gate and
 * regex in the pipeline misses.
 */
export function foldPdfText(raw: string): string {
  return repairLamAlef(
    String(raw ?? '')
      .normalize('NFKC')
      .replace(ZERO_WIDTH, '')
      .replace(TATWEEL, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A PDF printed from a browser (Chrome, Edge, Google Docs: anything on Skia)
 * writes the lam-alef ligature to the text layer with its two letters in the
 * wrong order: «الإنشائي» arrives as «اإلنشائي», «الاختبار» as «االختبار».
 * Measured with Arial, Tahoma, Times and Geeza Pro alike, so it is the printer,
 * not a font. Only the article-plus-alef shapes are put back: «اا», «اإ», «اأ»
 * and «اآ» never occur in Arabic, so the repair cannot touch a correct word. A
 * ligature inside a word («ملاحظات» → «مالحظات») is left alone, because «مال»
 * is a word too; see `labelKey` for how the header still matches.
 */
function repairLamAlef(text: string): string {
  return text.replace(/ا([اإأآ])ل/g, 'ال$1')
}

/** Compare header labels without spelling drift (أ/ا, ة/ه, ى/ي). */
function foldLabel(raw: string): string {
  return foldPdfText(raw)
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, '')
}

/**
 * The key a header label is matched on. On top of `foldLabel`, every «لا» is
 * written «ال», on the dictionary and on the page alike, so a label whose
 * ligature came out reversed (see `repairLamAlef`) still meets its entry.
 */
function labelKey(raw: string): string {
  return foldLabel(raw).replace(/لا/g, 'ال')
}

/** RTL visual order puts the opening bracket on the right; undo it with the order. */
const MIRRORED: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' }

function mirrorBrackets(text: string): string {
  return text.replace(/[()[\]{}<>]/g, (ch) => MIRRORED[ch] ?? ch)
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/** Same visual row. Measured: the duplicated header sits 1.5pt off itself. */
const ROW_TOLERANCE = 2.5
/**
 * Fallback only. The real threshold is measured per document, because wrapped
 * lines and item spacing differ by booklet: the reference Etimad table wraps at
 * 8.3pt and steps 30pt between items, while the Farq test booklets wrap at 9.4
 * and 18.8pt and step 120pt. A constant that suits one shreds the other.
 */
const BLOCK_GAP_FALLBACK = 15

type Row = { y: number; glyphs: PdfGlyph[] }
type Block = { top: number; bottom: number; rows: Row[] }

function groupRows(glyphs: PdfGlyph[]): Row[] {
  const kept = glyphs.filter((g) => foldPdfText(g.str).length > 0)
  kept.sort((a, b) => b.y - a.y || b.x - a.x)
  const rows: Row[] = []
  for (const glyph of kept) {
    const row = rows.find((r) => Math.abs(r.y - glyph.y) <= ROW_TOLERANCE)
    if (row) row.glyphs.push(glyph)
    else rows.push({ y: glyph.y, glyphs: [glyph] })
  }
  // The `thead` on page 28 is painted twice; identical text at the same x is one cell.
  for (const row of rows) {
    const seen = new Set<string>()
    row.glyphs = row.glyphs
      .sort((a, b) => b.x - a.x)
      .filter((g) => {
        const key = `${foldPdfText(g.str)}@${Math.round(g.x * 10)}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }
  return rows
}

function groupBlocks(rows: Row[], blockGap: number): Block[] {
  const blocks: Block[] = []
  for (const row of rows) {
    const last = blocks[blocks.length - 1]
    if (last && last.bottom - row.y <= blockGap) {
      last.rows.push(row)
      last.bottom = row.y
    } else {
      blocks.push({ top: row.y, bottom: row.y, rows: [row] })
    }
  }
  return blocks
}

/** Text of a whole row / block, in visual right-to-left order. */
function rowText(row: Row): string {
  return row.glyphs
    .slice()
    .sort((a, b) => b.x - a.x)
    .map((g) => foldPdfText(g.str))
    .filter(Boolean)
    .join(' ')
}

function blockText(block: Block): string {
  return block.rows.map(rowText).join(' ')
}

/**
 * One text line per visual row, for the text-shaped parsers.
 *
 * The old code pushed `strs.join(' ')` once per page, so a 47-page booklet
 * became 94 lines and every `^`-anchored row pattern matched nothing. Splitting
 * on the y coordinate restores real lines. Glyph order inside a row is left
 * exactly as pdf.js emitted it: the text parsers downstream were written
 * against that order, and the column-aware reader above is what needs visual
 * order undone.
 */
export function pageTextRows(glyphs: PdfGlyph[]): string[] {
  const kept = glyphs.filter((g) => foldPdfText(g.str).length > 0)
  const rows: Array<{ y: number; parts: string[] }> = []
  for (const glyph of kept) {
    const row = rows.find((r) => Math.abs(r.y - glyph.y) <= ROW_TOLERANCE)
    if (row) row.parts.push(foldPdfText(glyph.str))
    else rows.push({ y: glyph.y, parts: [foldPdfText(glyph.str)] })
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => r.parts.join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/* -------------------------------------------------------------------------- */
/* Columns                                                                    */
/* -------------------------------------------------------------------------- */

type ColumnKey = 'number' | 'desc' | 'qty' | 'unit' | 'spec' | 'category' | 'mandatory' | 'code'

/**
 * Header labels, folded. Two real shapes are read with the same machinery:
 * the Etimad booklet (الرقم · البند · الكمية · الوحدة · منتج من القائمة · الرمز
 * الإنشائى, number column on the right) and the Farq test booklets (م · الفئة ·
 * البند · المواصفة المختصرة · الوحدة · الكمية, number column on the left).
 * Nothing here assumes which side the numbers are on; the x anchors decide.
 */
const HEADER_LABELS_RAW: Record<ColumnKey, string[]> = {
  // «رقم» / «م» / «مسلسل» head the numbering in booklets printed from Excel and
  // Word as often as Etimad's «الرقم» does; «الوصف» / «البيان» / «الصنف» head
  // the description. A header the reader does not recognise is a table it never
  // reads: measured on a clean 1,650-row booklet, 71 rows came back.
  number: ['الرقم', 'م', 'رقمالبند', 'رقم', 'مسلسل', 'رقمالصنف', 'رقمالبند'],
  desc: [
    'البند',
    'وصفالبند',
    'اسمالماده',
    'اسمالمادهبالعربيه',
    'الوصف',
    'البيان',
    'الصنف',
    'اسمالصنف',
    'وصفالاعمال',
    'بيانالاعمال',
    'الوصفوالمواصفات',
  ],
  qty: ['الكميه', 'الكميات', 'كميه', 'الكميهالمطلوبه'],
  unit: ['الوحده', 'وحده', 'وحدهالقياس', 'الوحدات'],
  spec: ['المواصفهالمختصره', 'المواصفهالفنيه', 'المواصفه'],
  category: ['الفئه', 'القسم'],
  mandatory: ['منتج', 'القائمه', 'الالزاميه'],
  code: ['الرمز', 'الانشائي'],
}

/** «الإنشائي» on the label key: the word that marks «الرمز» as a structural code. */
const STRUCTURAL_CODE_LABEL = labelKey('الانشائي')

/** The dictionary on the same key the page's labels are read on. */
const HEADER_LABELS: Record<ColumnKey, string[]> = Object.fromEntries(
  Object.entries(HEADER_LABELS_RAW).map(([key, labels]) => [key, labels.map(labelKey)]),
) as Record<ColumnKey, string[]>

/** Columns whose cells hold short right/centre-aligned tokens. Text columns are
 * allowed to absorb the empty space next to these; the reverse would pull
 * description words into a numeric cell — the original defect. */
const NARROW_COLUMNS: ColumnKey[] = ['number', 'qty', 'unit', 'mandatory', 'code']

/**
 * Page 27 of the reference booklet carries a summary table with an `الاسم`
 * column and two number columns. It is a different shape with one aggregate
 * row, and reading it as an item would invent a 69th item; it is reported as a
 * skipped table instead.
 */
const SUMMARY_TABLE_LABELS = ['الاسم'].map(labelKey)

type Span = { left: number; right: number }
type Columns = Record<ColumnKey, Span | null>

type HeaderMatch = {
  block: Block
  columns: Columns
  boundaries: Array<{ key: ColumnKey; left: number; right: number }>
  /** False when the table prints no item number at all; ids are then counted. */
  numbered: boolean
}

const KNOWN_LABEL_KEYS = new Set([...Object.values(HEADER_LABELS).flat(), ...SUMMARY_TABLE_LABELS])

function dictionaryRole(key: string): ColumnKey | null {
  for (const role of Object.keys(HEADER_LABELS) as ColumnKey[]) {
    if (HEADER_LABELS[role].includes(key)) return role
  }
  return null
}

/**
 * The label keys one header glyph run stands for. A run is usually one label,
 * but a browser print keeps «الرمز الإنشائي» as a single run, which matched
 * neither word and so left the structural code to fall into the description.
 * A run whose words all name the same column is read as those words; a run
 * whose words disagree («رقم البند» is a number, not a description) keeps its
 * joined key.
 */
function headerKeysOf(str: string): string[] {
  const joined = labelKey(str)
  if (KNOWN_LABEL_KEYS.has(joined)) return [joined]
  const words = foldPdfText(str)
    .split(' ')
    .map(labelKey)
    .filter((w) => KNOWN_LABEL_KEYS.has(w))
  if (!words.length) return [joined]
  const roles = new Set(words.map((w) => dictionaryRole(w) ?? `other:${w}`))
  return roles.size === 1 ? words : [joined]
}

function spanOf(glyph: PdfGlyph): Span {
  const width = Number.isFinite(glyph.width) ? glyph.width : 0
  return { left: glyph.x, right: glyph.x + width }
}

function mergeSpan(a: Span | null, b: Span): Span {
  if (!a) return b
  return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) }
}

/**
 * Locate the six-column BOQ header inside a page's blocks.
 * The header spans three stacked rows, so the whole block is searched, not a row.
 */
function findBoqHeader(blocks: Block[]): HeaderMatch | null {
  for (const block of blocks) {
    const labels = block.rows.flatMap((r) => r.glyphs.flatMap((g) => headerKeysOf(g.str).map((label) => ({ g, label }))))
    const has = (key: ColumnKey) => labels.some(({ label }) => HEADER_LABELS[key].includes(label))
    // `الرمز` heads two different columns in the wild, and telling them apart is
    // what decides whether this table is read at all.
    //
    // In the Etimad booklet it is `الرمز الإنشائى`, a structural code (2001–2107)
    // that must never be read as an item number — doing so is the original
    // defect this reader exists to prevent. That booklet also prints `الرقم`.
    //
    // The Farq DC/SITE booklets head their item numbering `الرمز` and print no
    // `الرقم` column at all. Requiring one rejected the whole header, so the
    // table was never read and the flattened-text path ran instead — and that
    // path groups by visual row, so it served the `الفئة` category cell that
    // shares the number's y-band and never served the item name. Measured on
    // datacenter-cyber-01: 180 of 180 rows, correct quantities and units, and
    // 154 descriptions that were the category plus a spec fragment.
    //
    // So: promote `الرمز` to the number column only when the block has no
    // dedicated number label and no `الانشائي` to mark it as a structural code.
    const structuralCode = labels.some(({ label }) => HEADER_LABELS.code.includes(label) && label === STRUCTURAL_CODE_LABEL)
    const codeIsNumber =
      !structuralCode && !has('number') && labels.some(({ label }) => label === 'الرمز')
    const roleOf = (label: string): ColumnKey | null => {
      if (codeIsNumber && label === 'الرمز') return 'number'
      for (const key of Object.keys(HEADER_LABELS) as ColumnKey[]) {
        if (HEADER_LABELS[key].includes(label)) return key
      }
      return null
    }
    // A table with no number column at all is still a table: description,
    // quantity and unit are what a supplier is asked about. Its rows are
    // counted rather than numbered (see `BoqTableRow.synthetic`).
    const numbered = has('number') || codeIsNumber
    if (!(has('desc') && has('qty') && has('unit'))) continue
    // The summary table on page 27 carries الفئة/الاسم/وصف alongside; different shape.
    if (labels.some(({ label }) => SUMMARY_TABLE_LABELS.includes(label))) continue

    const columns: Columns = {
      number: null,
      desc: null,
      qty: null,
      unit: null,
      spec: null,
      category: null,
      mandatory: null,
      code: null,
    }
    for (const { g, label } of labels) {
      const key = roleOf(label)
      if (key) columns[key] = mergeSpan(columns[key], spanOf(g))
    }
    if ((numbered && !columns.number) || !columns.desc || !columns.qty || !columns.unit) continue

    const ordered = (Object.keys(columns) as ColumnKey[])
      .filter((key) => columns[key])
      .sort((a, b) => columns[b]!.left - columns[a]!.left)

    const boundaries: HeaderMatch['boundaries'] = []
    for (let i = 0; i < ordered.length; i++) {
      const key = ordered[i]!
      const self = columns[key]!
      const rightKey = i > 0 ? ordered[i - 1]! : null
      const leftKey = i + 1 < ordered.length ? ordered[i + 1]! : null
      const rightNeighbour = rightKey ? columns[rightKey]! : null
      const leftNeighbour = leftKey ? columns[leftKey]! : null
      // Where a text column meets a narrow one the split goes on the narrow
      // column's own edge, not halfway: free text wraps into the blank space
      // beside a short cell, while a quantity never wanders into a description.
      // Halfway handed «من» from item #23's wrapped description to the quantity
      // column and lost the item; it is also how a structural code became a
      // quantity. Between two columns of the same kind, halfway is right.
      const narrow = NARROW_COLUMNS.includes(key)
      const rightNarrow = rightKey ? NARROW_COLUMNS.includes(rightKey) : false
      const leftNarrow = leftKey ? NARROW_COLUMNS.includes(leftKey) : false
      const right = !rightNeighbour
        ? Number.POSITIVE_INFINITY
        : narrow === rightNarrow
          ? (self.right + rightNeighbour.left) / 2
          : narrow
            ? self.right + 2
            : rightNeighbour.left - 2
      const left = !leftNeighbour
        ? Number.NEGATIVE_INFINITY
        : narrow === leftNarrow
          ? (leftNeighbour.right + self.left) / 2
          : narrow
            ? self.left - 2
            : leftNeighbour.right + 2
      boundaries.push({ key, left, right })
    }
    return { block, columns, boundaries, numbered }
  }
  return null
}

function columnOf(boundaries: HeaderMatch['boundaries'], glyph: PdfGlyph): ColumnKey | null {
  const width = Number.isFinite(glyph.width) ? glyph.width : 0
  const centre = glyph.x + width / 2
  for (const b of boundaries) {
    if (centre >= b.left && centre < b.right) return b.key
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Cell readers                                                               */
/* -------------------------------------------------------------------------- */

/** Units as they really arrive: reversed and split. Measured on the reference. */
const UNIT_FROM_VISUAL: Array<[RegExp, string]> = [
  [/^م\s*[2٢²]$/, 'م²'],
  [/^م\s*[3٣³]$/, 'م³'],
  [/^م\s*ط$/, 'م ط'],
  [/^ط\s*م$/, 'م ط'],
  [/^م\s*[2٢²]\s*\/\s*ط$/, 'م²'],
  [/^مقطوعيه?$/, 'مقطوعية'],
  [/^م$/, 'م ط'],
]

/**
 * Plain single-token units. Reading the token the cell actually holds is not a
 * guess; substituting «عدد» for a cell we failed to understand is, and that
 * substitution is what asked a supplier for 5,600 pieces of floor porcelain.
 */
const PLAIN_UNIT = /^[\u0600-\u06FF]{2,10}$/

export function readVisualUnit(cell: string): string | null {
  const text = foldPdfText(cell)
  if (!text) return null
  for (const [re, unit] of UNIT_FROM_VISUAL) {
    if (re.test(text)) return unit
  }
  if (PLAIN_UNIT.test(text)) return text
  // A reversed two-token unit we do not recognise: try it the other way round
  // before giving up, but never guess «عدد» — that guess is the original bug.
  const parts = text.split(' ').filter(Boolean)
  if (parts.length === 2) {
    const flipped = `${parts[1]} ${parts[0]}`
    for (const [re, unit] of UNIT_FROM_VISUAL) {
      if (re.test(flipped)) return unit
    }
  }
  return null
}

export function readQuantity(cell: string): string | null {
  let text = foldPdfText(cell)
    .replace(/\s/g, '')
    // Arabic-Indic digits and the Arabic decimal mark: «٣٫٥٠٠» is 3.5.
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
  if (!text) return null
  if (/^\d{1,3}(?:[,،]\d{3})+(?:\.\d+)?$/.test(text)) {
    // «1,250.5»: commas group thousands.
    text = text.replace(/[,،]/g, '')
  } else if (/^\d+[,،]\d{1,2}$/.test(text)) {
    // «12,75»: a comma before one or two digits is the decimal mark.
    text = text.replace(/[,،]/, '.')
  } else {
    text = text.replace(/[,،]/g, '')
  }
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const num = Number(text)
  if (!Number.isFinite(num) || num <= 0) return null
  return num.toLocaleString('en-US')
}

const ARABIC_LETTER = /[ء-يٱ-ۓ]/
const LTR_TOKEN = /[A-Za-z0-9]/

/**
 * Words right-to-left, except that a Latin or numeric run inside the line
 * keeps its own left-to-right order. «قطاع حديد IPE 200» is painted with «IPE»
 * left of «200», so a plain right-to-left sort read it as «200 IPE», and
 * «50x50 / Supply» came back as «Supply / 50x50». Neutral marks between two
 * such runs («/», «-») travel with them.
 */
function readingOrder(glyphs: PdfGlyph[]): string[] {
  const byX = glyphs
    .slice()
    .sort((a, b) => b.x - a.x)
    .map((g) => ({ text: foldPdfText(g.str), x: g.x }))
    .filter((g) => g.text)
  const kind = (t: string) => (ARABIC_LETTER.test(t) ? 'rtl' : LTR_TOKEN.test(t) ? 'ltr' : 'neutral')
  const out: string[] = []
  let i = 0
  while (i < byX.length) {
    if (kind(byX[i]!.text) === 'rtl') {
      out.push(byX[i]!.text)
      i++
      continue
    }
    // A run of non-Arabic glyphs: take it whole, then trim neutral edges back
    // to the Arabic side so a dash between Arabic words stays where it was.
    let j = i
    while (j < byX.length && kind(byX[j]!.text) !== 'rtl') j++
    const run = byX.slice(i, j)
    if (run.some((g) => kind(g.text) === 'ltr')) {
      let head = 0
      while (head < run.length && kind(run[head]!.text) === 'neutral') out.push(run[head++]!.text)
      let tail = run.length
      while (tail > head && kind(run[tail - 1]!.text) === 'neutral') tail--
      out.push(
        ...run
          .slice(head, tail)
          .sort((a, b) => a.x - b.x)
          .map((g) => g.text),
      )
      for (let k = tail; k < run.length; k++) out.push(run[k]!.text)
    } else {
      out.push(...run.map((g) => g.text))
    }
    i = j
  }
  return out
}

/** Restore reading order: rows top-down, words right-to-left, brackets mirrored. */
export function readDescription(rows: Array<{ y: number; glyphs: PdfGlyph[] }>): string {
  const ordered = rows
    .slice()
    .sort((a, b) => b.y - a.y)
    .map((row) => readingOrder(row.glyphs).join(' '))
    .filter(Boolean)
  return mirrorBrackets(ordered.join(' '))
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
}

/* -------------------------------------------------------------------------- */
/* Page furniture                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Chrome that must never be read as an item. Matched by pattern, not position:
 * the kingdom/administration block is painted at the top of the page but arrives
 * last in reading order, so trimming the first or last N lines is unreliable.
 */
const FURNITURE = [
  /تاريخ\s*الاصدار|تاريخ\s*الإصدار/,
  /رقم\s*النسخه|رقم\s*النسخة/,
  /رقم\s*الكراسه|رقم\s*الكراسة/,
  /https?:\/\//,
  /^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/,
  /كراسه\s*الشروط|كراسة\s*الشروط/,
  /المملكه\s*العربيه|المملكة\s*العربية/,
  /اسم\s*النموذج|إسم\s*النموذج/,
  /اسم\s*الاداره|إسم\s*الإدارة/,
  /^\s*\d{2}\/\d{2}\/\d{4}/,
]

/**
 * Dropped before rows are grouped into items, not after: on a booklet whose
 * items are spaced widely, the footer would otherwise join the last item's
 * block and could contribute a stray number to a cell.
 */
function isFurniture(text: string): boolean {
  const folded = foldPdfText(text)
  if (!folded) return true
  return FURNITURE.some((re) => re.test(folded))
}

const OTHER_TABLE_LABELS = ['المسمي', 'الوظيفي', 'العدد', 'ساعات', 'العمل', 'الفئه', 'الاسم'].map(labelKey)

/** A different table starting below the BOQ (page 32 carries a labour table). */
function isOtherTableHeader(block: Block): boolean {
  const labels = block.rows.flatMap((r) => r.glyphs.map((g) => labelKey(g.str)))
  const hits = OTHER_TABLE_LABELS.filter((l) => labels.includes(l))
  return hits.length >= 2
}

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

/** Integer in the number column, or null. */
function numberIn(boundaries: HeaderMatch['boundaries'], row: Row): number | null {
  const text = foldPdfText(
    row.glyphs
      .filter((g) => columnOf(boundaries, g) === 'number')
      .sort((a, b) => b.x - a.x)
      .map((g) => g.str)
      .join(''),
  )
  return /^\d{1,3}$/.test(text) ? Number(text) : null
}

/**
 * How far apart two rows must be to belong to different items, measured from
 * this document's own numbered rows rather than assumed. Half the typical step
 * between items sits comfortably above the wrap spacing inside a cell and
 * below the step itself, in both real shapes we have.
 */
function measureBlockGap(pages: PdfPageGlyphs[]): number {
  const steps: number[] = []
  for (const { glyphs } of pages) {
    const rows = groupRows(glyphs)
    const header = findBoqHeader(groupBlocks(rows, BLOCK_GAP_FALLBACK))
    if (!header) continue
    const numbered = rows
      .filter((r) => r.y < header.block.bottom - ROW_TOLERANCE && numberIn(header.boundaries, r) !== null)
      .map((r) => r.y)
      .sort((a, b) => b - a)
    for (let i = 1; i < numbered.length; i++) steps.push(numbered[i - 1]! - numbered[i]!)
  }
  if (!steps.length) return BLOCK_GAP_FALLBACK
  steps.sort((a, b) => a - b)
  const median = steps[Math.floor(steps.length / 2)]!
  return Math.min(200, Math.max(4, median * 0.45))
}

export function extractBoqTable(pages: PdfPageGlyphs[]): BoqTableResult {
  const rows: BoqTableRow[] = []
  const issues: BoqTableIssue[] = []
  const tablePages: number[] = []
  const otherTables: Array<{ page: number; header: string }> = []
  const seenIds = new Map<number, number>()
  const blockGap = measureBlockGap(pages)

  for (const { page, glyphs } of pages) {
    const allRows = groupRows(glyphs)
    // Headers are found on a tight grouping: the stacked three-row header must
    // hold together, but it must not swallow the first item when this document's
    // items are spaced widely.
    const tightBlocks = groupBlocks(allRows, BLOCK_GAP_FALLBACK)
    const header = findBoqHeader(tightBlocks)
    if (!header) {
      const other = tightBlocks.find((b) => isOtherTableHeader(b))
      if (other) otherTables.push({ page, header: blockText(other).slice(0, 120) })
      continue
    }
    tablePages.push(page)

    const headerBottom = header.block.bottom
    // Stop at the next table's header rather than reading its rows as items.
    const nextTable = tightBlocks.find(
      (b) => b.top < headerBottom - ROW_TOLERANCE && isOtherTableHeader(b),
    )
    const floor = nextTable ? nextTable.top : Number.NEGATIVE_INFINITY
    const below = groupBlocks(
      allRows.filter(
        (r) => r.y < headerBottom - ROW_TOLERANCE && r.y > floor && !isFurniture(rowText(r)),
      ),
      blockGap,
    )

    for (const block of below) {
      const text = blockText(block)

      // Classify every glyph in the block by column.
      const cells: Record<ColumnKey, PdfGlyph[]> = {
        number: [],
        desc: [],
        qty: [],
        unit: [],
        spec: [],
        category: [],
        mandatory: [],
        code: [],
      }
      for (const row of block.rows) {
        for (const glyph of row.glyphs) {
          const key = columnOf(header.boundaries, glyph)
          if (key) cells[key].push(glyph)
        }
      }

      const numberText = foldPdfText(
        cells.number
          .slice()
          .sort((a, b) => b.x - a.x)
          .map((g) => g.str)
          .join(''),
      )
      // The number cell is not always alone in its column. In the DC/SITE
      // booklets the category's `DC-` / `SITE-` prefix is printed hard against
      // the numbering and overlaps it by a few points, so the cell reads
      // «001DC-» and an exact-digits test threw the whole row away — 180 rows
      // reported as «صف بلا رقم بند».
      //
      // The trailing `(?!\d)` is load-bearing and must stay: it takes a short
      // number followed by something that is not a digit, and still refuses a
      // longer digit run. That is what keeps the Etimad structural code
      // (2001–2107) from being read as item 208 — reading that column as a
      // number is the defect this reader was written to prevent.
      // Up to four digits: a tender runs past 999 lines (10,219 measured), and
      // a three-digit cap silently turned every later row into «صف بلا رقم».
      const idText = header.numbered ? (numberText.match(/^(\d{1,4})(?!\d)/)?.[1] ?? null) : null
      const idMatch = idText === null ? null : Number(idText)
      const idLabel = idMatch === null ? 'بلا رقم' : String(idMatch)
      // Digits run left to right whatever the page's direction, and a browser
      // print splits «183.5» into three runs; joined right to left they read
      // «5.183». The number cell keeps its right-to-left join because the
      // DC/SITE category prefix must stay AFTER the digits («001DC-»).
      const qty = readQuantity(
        cells.qty
          .slice()
          .sort((a, b) => a.x - b.x)
          .map((g) => g.str)
          .join(''),
      )
      const unitCell = cells.unit
        .slice()
        .sort((a, b) => b.x - a.x)
        .map((g) => foldPdfText(g.str))
        .filter(Boolean)
        .join(' ')
      const unit = readVisualUnit(unitCell)

      const looksLikeData = idMatch !== null || qty !== null || Boolean(unitCell)
      if (!looksLikeData) continue

      if (idMatch === null && header.numbered) {
        // Real values with no number: never guess an id, and never hide the row.
        issues.push({
          kind: 'row-without-number',
          page,
          id: null,
          detail: `صف في الصفحة ${page} فيه كمية/وحدة بلا رقم بند: «${text.slice(0, 60)}»`,
        })
        continue
      }

      const columnRows = (key: ColumnKey) =>
        block.rows
          .map((row) => ({
            y: row.y,
            glyphs: row.glyphs.filter((g) => columnOf(header.boundaries, g) === key),
          }))
          .filter((row) => row.glyphs.length > 0)
      const name = readDescription(columnRows('desc'))
      const spec = readDescription(columnRows('spec'))
      const category = readDescription(columnRows('category'))
      const code = foldPdfText(
        cells.code
          .slice()
          .sort((a, b) => b.x - a.x)
          .map((g) => g.str)
          .join(''),
      )
      const mandatory = foldPdfText(
        cells.mandatory
          .slice()
          .sort((a, b) => b.x - a.x)
          .map((g) => g.str)
          .join(' '),
      )

      if (qty === null) {
        issues.push({
          kind: 'missing-qty',
          page,
          id: idMatch,
          detail: `البند ${idLabel} (صفحة ${page}): لم نقرأ كمية صالحة — لم نستخدم الرمز الإنشائي بدلًا منها`,
        })
        continue
      }
      if (!unitCell) {
        issues.push({
          kind: 'missing-unit',
          page,
          id: idMatch,
          detail: `البند ${idLabel} (صفحة ${page}): خلية الوحدة فارغة`,
        })
        continue
      }
      if (!unit) {
        issues.push({
          kind: 'unreadable-unit',
          page,
          id: idMatch,
          detail: `البند ${idLabel} (صفحة ${page}): وحدة غير معروفة «${unitCell}» — لم نفترض «عدد»`,
        })
        continue
      }

      const previous = idMatch === null ? undefined : seenIds.get(idMatch)
      if (previous !== undefined) {
        issues.push({
          kind: 'duplicate-number',
          page,
          id: idMatch,
          detail: `رقم البند ${idMatch} مكرر (صفحة ${previous} وصفحة ${page})`,
        })
        continue
      }
      if (idMatch !== null) seenIds.set(idMatch, page)

      rows.push({
        id: idMatch ?? 0,
        synthetic: idMatch === null ? true : undefined,
        name,
        qty,
        unit,
        spec: spec || undefined,
        category: category || undefined,
        code: /^\d{3,5}$/.test(code) ? code : undefined,
        mandatory: mandatory || undefined,
        page,
      })
    }
  }

  // Counted rows take the ids above every printed number, in reading order.
  const printed = rows.filter((r) => !r.synthetic)
  const printedMax = maxId(printed, issues) ?? 0
  let next = printedMax
  for (const row of rows) if (row.synthetic) row.id = ++next
  for (const row of rows) if (!row.name) row.name = `بند ${row.id}`

  rows.sort((a, b) => a.id - b.id)

  // The booklet numbers its own items, so a missing number is a dropped item —
  // the difference between an honest partial read and a silent one.
  const expectedCount = printed.length || issues.length ? maxId(printed, issues) : null
  if (expectedCount) {
    const have = new Set(rows.map((r) => r.id))
    const reported = new Set(issues.map((i) => i.id).filter((id): id is number => id !== null))
    const missing: number[] = []
    for (let id = 1; id <= expectedCount; id++) {
      if (!have.has(id) && !reported.has(id)) missing.push(id)
    }
    if (missing.length) {
      issues.push({
        kind: 'gap-in-numbering',
        page: null,
        id: null,
        detail: `أرقام بنود لم نقرأها إطلاقًا (${missing.length}): ${missing.join('، ')}`,
      })
    }
  }

  return { rows, issues, pages: tablePages, otherTables, expectedCount }
}

function maxId(rows: BoqTableRow[], issues: BoqTableIssue[]): number | null {
  let max = 0
  for (const row of rows) max = Math.max(max, row.id)
  for (const issue of issues) if (issue.id) max = Math.max(max, issue.id)
  return max > 0 ? max : null
}

/** Count of items the booklet has that we could not read. */
export function unreadableCount(result: BoqTableResult): number {
  if (!result.expectedCount) return 0
  return Math.max(0, result.expectedCount - result.rows.filter((r) => !r.synthetic).length)
}
