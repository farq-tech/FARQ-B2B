import type {
  ConstructionComparison,
  ConstructionInvitation,
  ConstructionRfq,
  ConstructionSupplierOutcomeEvent,
} from '../api/constructionClient'

/**
 * The request as one deal file: every figure here is read from what the server
 * returned. Nothing is defaulted, estimated or dated from a neighbouring field.
 */

export type RequestState = { key: 'OPEN' | 'CLOSED' | 'AWARDED' | 'DRAFT' | 'CANCELLED'; label: string; cls: string }

/** The request's state from its own status, closure and award — never from the deadline copy. */
export function requestState(rfq: Pick<ConstructionRfq, 'status' | 'submission_closed_at' | 'award'>): RequestState {
  const status = String(rfq.status || '').toUpperCase()
  if (rfq.award && String(rfq.award.status || '').toUpperCase() !== 'CANCELLED') {
    return { key: 'AWARDED', label: 'تمت الترسية', cls: 'bg-[#CFF5DC] text-[#1a7a45]' }
  }
  if (status === 'CANCELLED') return { key: 'CANCELLED', label: 'ملغى', cls: 'bg-neutral-100 text-neutral-500' }
  if (status === 'CLOSED' || rfq.submission_closed_at) return { key: 'CLOSED', label: 'مغلق', cls: 'bg-neutral-200 text-neutral-700' }
  if (status === 'DRAFT' || status === 'DRAFT_NOT_SENT') return { key: 'DRAFT', label: 'لم يُرسل بعد', cls: 'bg-amber-50 text-amber-700' }
  return { key: 'OPEN', label: 'بانتظار العروض', cls: 'bg-amber-50 text-amber-700' }
}

export type Deadline = { at: number; passed: boolean; label: string } | null

/** The quote deadline the buyer set (Riyadh time), and whether it has passed now. */
export function quoteDeadline(date?: string | null, time?: string | null, now = Date.now()): Deadline {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const hhmm = /^\d{2}:\d{2}$/.test(String(time || '')) ? String(time) : null
  const at = Date.parse(`${date}T${hhmm || '23:59'}:00+03:00`)
  if (Number.isNaN(at)) return null
  const day = new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' })
  let clock = ''
  if (hhmm) {
    const [h, m] = hhmm.split(':').map(Number) as [number, number]
    const period = h < 12 ? 'صباحًا' : 'مساءً'
    clock = ` — ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${period}`
  }
  return { at, passed: at <= now, label: `⁦${day}⁩${clock}` }
}

export type SupplierState = {
  key: 'AWARDED' | 'QUOTED' | 'FAILED' | 'SENT' | 'MANUAL' | 'NOT_SENT'
  label: string
  cls: string
  channel?: string
}

const CHANNEL_AR: Record<string, string> = { EMAIL: 'البريد', WHATSAPP: 'واتساب', HARAJ: 'محادثة' }

/**
 * Where the request stands with one supplier. «Sent» means an attempt the
 * provider accepted (dispatch_attempts.status = SENT); a failed attempt is
 * never counted as reached.
 */
export function supplierState(invite: ConstructionInvitation, awardedInviteId?: string | null): SupplierState {
  const attempts = (invite.dispatch_attempts || []).filter((a) => (a.message_type || 'RFQ') === 'RFQ')
  const sent = attempts.find((a) => a.status === 'SENT')
  if (awardedInviteId && invite.id === awardedInviteId) return { key: 'AWARDED', label: 'تمت الترسية عليه', cls: 'bg-[#CFF5DC] text-[#1a7a45]' }
  if (String(invite.response_status || '').toUpperCase() === 'QUOTED') return { key: 'QUOTED', label: 'تم استلام العرض', cls: 'bg-[#e0efec] text-[#123F3A]' }
  if (sent) return { key: 'SENT', label: 'أُرسل — بانتظار الرد', cls: 'bg-neutral-100 text-neutral-600', channel: CHANNEL_AR[sent.channel] || sent.channel }
  if (attempts.some((a) => a.status === 'DELIVERY_FAILED')) return { key: 'FAILED', label: 'تعذر الإرسال', cls: 'bg-red-50 text-red-700' }
  if (attempts.some((a) => a.status === 'NOT_SENT' && a.channel === 'WHATSAPP')) {
    return { key: 'MANUAL', label: 'بانتظار إرسال واتساب يدويًا', cls: 'bg-amber-50 text-amber-700' }
  }
  return { key: 'NOT_SENT', label: 'لم يُرسل', cls: 'bg-amber-50 text-amber-700' }
}

export type MessageSupplierFilter = 'all' | 'waiting' | 'quoted' | 'unreached'

/** Suppliers a buyer can address after the request is out: by name and by where the invite stands. */
export function invitesForMessage(
  invites: readonly ConstructionInvitation[],
  query: string,
  status: MessageSupplierFilter,
  awardedInviteId?: string | null,
): ConstructionInvitation[] {
  const needle = query.trim().toLowerCase()
  return invites.filter((invite) => {
    const state = supplierState(invite, awardedInviteId).key
    if (status === 'waiting' && state !== 'SENT') return false
    if (status === 'quoted' && state !== 'QUOTED' && state !== 'AWARDED') return false
    if (status === 'unreached' && state !== 'FAILED' && state !== 'NOT_SENT' && state !== 'MANUAL') return false
    if (!needle) return true
    const name = `${invite.supplier?.name_ar || ''} ${invite.supplier?.name_en || ''} ${invite.supplier?.city || ''}`.toLowerCase()
    return name.includes(needle)
  })
}

export type Progress = { items: number; reached: number; quoted: number; percent: number }

/** Header figures: lines requested, suppliers the request reached, suppliers that quoted. */
export function requestProgress(rfq: ConstructionRfq): Progress {
  const invites = rfq.invitations || []
  const reached = invites.filter((i) => (i.dispatch_attempts || []).some((a) => a.status === 'SENT' && (a.message_type || 'RFQ') === 'RFQ')).length
  const quoted = invites.filter((i) => String(i.response_status || '').toUpperCase() === 'QUOTED').length
  const items = (rfq.current_version?.payload?.lines || []).length
  return { items, reached, quoted, percent: reached ? Math.round((Math.min(quoted, reached) / reached) * 100) : 0 }
}

export type Coverage = { requested: number; priced: number; complete: boolean; label: string }

/** «يغطي جميع البنود» or «عرض جزئي — 3 من 5 بنود», against the lines this supplier was asked for. */
export function quoteCoverage(summary?: { coverage?: { requested: number; priced: number; complete: boolean } } | null, requestedLineCount?: number): Coverage | null {
  const raw = summary?.coverage
  const c = raw && { ...raw, requested: requestedLineCount ?? raw.requested, complete: raw.priced >= (requestedLineCount ?? raw.requested) }
  if (!c || !c.requested) return null
  if (c.complete) return { ...c, label: 'يغطي جميع البنود' }
  return { ...c, label: `عرض جزئي — ${c.priced} من ${c.requested} ${c.requested === 1 ? 'بند' : 'بنود'}` }
}

export function taxLabel(pricesIncludeTax?: boolean | null): string {
  if (pricesIncludeTax === true) return 'شامل الضريبة'
  if (pricesIncludeTax === false) return 'غير شامل الضريبة'
  return 'الضريبة غير محددة'
}

/**
 * The supplier's stated lead time (lead_time_days from the quote form), or
 * «لم يحدد مدة التوريد» when the supplier left it empty.
 */
export function leadTimeLabel(offer: Record<string, unknown>): string {
  const days = Number(offer.lead_time_days ?? offer.delivery_days)
  if (Number.isFinite(days) && days > 0) return days === 1 ? 'يوم واحد' : days === 2 ? 'يومان' : `${days} أيام`
  const text = typeof offer.lead_time === 'string' ? offer.lead_time.trim() : ''
  return text || 'لم يحدد مدة التوريد'
}

type Matrix = NonNullable<ConstructionComparison['quote_matrix']>
type Cell = Matrix['lines'][number]['offers'][number]

/**
 * The lowest comparable price on each line. Only PRICED cells compete, and only
 * when every priced cell on the line states tax the same way and in one
 * currency; otherwise no cell is marked, because «cheapest» would be false.
 */
export function lowestPerLine(matrix?: Matrix | null): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const line of matrix?.lines || []) {
    const priced = (line.offers || []).filter((c): c is Cell => Boolean(c) && c.status === 'PRICED' && c.unit_price != null)
    const taxBases = new Set(priced.map((c) => c.prices_include_tax))
    const currencies = new Set(priced.map((c) => c.currency))
    if (priced.length < 2 || taxBases.size > 1 || taxBases.has(null) || currencies.size > 1) {
      out.set(line.id, null)
      continue
    }
    const best = priced.reduce((a, b) => (Number(b.unit_price) < Number(a.unit_price) ? b : a))
    const tie = priced.filter((c) => Number(c.unit_price) === Number(best.unit_price)).length > 1
    out.set(line.id, tie ? null : best.supplier_id)
  }
  return out
}

export type LineSort = { supplierId: string; dir: 'asc' | 'desc' }

/**
 * The comparison lines ordered by what one supplier charges for each.
 *
 * Only priced lines are ordered; a line that supplier did not price has no
 * number to sort by, so it sinks to the bottom in both directions rather than
 * pretending to be the cheapest or the dearest. Without a sort the request's
 * own order is kept, because that is the order of the booklet.
 */
export function sortLinesBySupplier<T extends { id: string; offers?: readonly (Cell | undefined)[] }>(
  lines: readonly T[],
  sort?: LineSort | null,
): T[] {
  const out = [...lines]
  if (!sort) return out
  const valueOf = (line: T): number | null => {
    const cell = (line.offers || []).find((c) => c && c.supplier_id === sort.supplierId)
    if (!cell || cell.status !== 'PRICED' || cell.line_total == null) return null
    return Number(cell.line_total)
  }
  return out
    .map((line, index) => ({ line, index, value: valueOf(line) }))
    .sort((a, b) => {
      if (a.value == null && b.value == null) return a.index - b.index
      if (a.value == null) return 1
      if (b.value == null) return -1
      if (a.value === b.value) return a.index - b.index
      return sort.dir === 'asc' ? a.value - b.value : b.value - a.value
    })
    .map((row) => row.line)
}

/** Click a column: cheapest first, then dearest first, then back to the booklet's order. */
export function nextLineSort(current: LineSort | null, supplierId: string): LineSort | null {
  if (!current || current.supplierId !== supplierId) return { supplierId, dir: 'asc' }
  return current.dir === 'asc' ? { supplierId, dir: 'desc' } : null
}

export type MatrixTotal = {
  supplier_id: string
  total: number
  priced: number
  requested: number
  currency: string
  complete: boolean
}

/**
 * What each supplier's priced lines come to, for the foot of the comparison.
 *
 * This is the goods total of the lines in the table — not the quote's total,
 * which also carries delivery, unloading and tax. A supplier who priced only
 * part of the request naturally shows a smaller sum, so the row states how many
 * lines each total covers, and `lowest` names a supplier only when every line
 * is priced on one tax basis in one currency. A partial offer is never called
 * the cheapest.
 */
export function matrixTotals(matrix?: Matrix | null): { totals: MatrixTotal[]; lowest: string | null } {
  const lines = matrix?.lines || []
  const requested = lines.length
  const bySupplier = new Map<string, { total: number; priced: number; currencies: Set<string>; taxBases: Set<boolean | null> }>()
  for (const line of lines) {
    for (const cell of line.offers || []) {
      if (!cell) continue
      const entry = bySupplier.get(cell.supplier_id)
        || { total: 0, priced: 0, currencies: new Set<string>(), taxBases: new Set<boolean | null>() }
      if (cell.status === 'PRICED' && cell.line_total != null) {
        entry.total += Number(cell.line_total)
        entry.priced += 1
        entry.currencies.add(String(cell.currency || 'SAR'))
        entry.taxBases.add(cell.prices_include_tax ?? null)
      }
      bySupplier.set(cell.supplier_id, entry)
    }
  }

  const totals: MatrixTotal[] = []
  for (const [supplierId, entry] of bySupplier) {
    totals.push({
      supplier_id: supplierId,
      total: Math.round(entry.total * 100) / 100,
      priced: entry.priced,
      requested,
      currency: entry.currencies.size === 1 ? [...entry.currencies][0] : 'SAR',
      complete: requested > 0 && entry.priced === requested,
    })
  }

  // Only complete offers compete on the total, and only when they all state tax
  // the same way in the same currency — the rule the per-line marker follows.
  const full = totals.filter((t) => t.complete)
  const bases = new Set<boolean | null>()
  const currencies = new Set<string>()
  for (const t of full) {
    const entry = bySupplier.get(t.supplier_id)
    for (const base of entry?.taxBases || []) bases.add(base)
    for (const currency of entry?.currencies || []) currencies.add(currency)
  }
  if (full.length < 2 || bases.size > 1 || bases.has(null) || currencies.size > 1) {
    return { totals, lowest: null }
  }
  const best = full.reduce((a, b) => (b.total < a.total ? b : a))
  const tie = full.filter((t) => t.total === best.total).length > 1
  return { totals, lowest: tie ? null : best.supplier_id }
}

export type CheapestBasket = {
  total: number
  currency: string
  covered: number
  requested: number
  suppliers: number
  /** The cheapest single supplier who priced everything, when there is one. */
  bestSingle: { supplier_id: string; total: number } | null
  saving: number | null
}

/**
 * What the request costs if every line is bought from whoever is cheapest on it.
 *
 * Split buying is the buyer's real alternative to one award, so the figure is
 * worth showing — but only where «cheapest» is a fact: a line counts only when
 * `lowestPerLine` named a winner, which already refuses ties, mixed tax bases
 * and mixed currencies. The count of covered lines rides along so a basket
 * built from part of the request is never read as the whole of it, and the
 * saving is stated only against a supplier who priced every line.
 */
export function cheapestPerLineTotal(
  matrix: Matrix | null | undefined,
  best: Map<string, string | null>,
  totals: MatrixTotal[],
): CheapestBasket | null {
  const lines = matrix?.lines || []
  if (!lines.length) return null
  let total = 0
  let covered = 0
  const suppliers = new Set<string>()
  const currencies = new Set<string>()
  for (const line of lines) {
    const winner = best.get(line.id)
    if (!winner) continue
    const cell = (line.offers || []).find((c) => c && c.supplier_id === winner)
    if (!cell || cell.line_total == null) continue
    total += Number(cell.line_total)
    covered += 1
    suppliers.add(winner)
    currencies.add(String(cell.currency || 'SAR'))
  }
  if (!covered || currencies.size > 1) return null

  const full = totals.filter((t) => t.complete)
  const bestSingle = full.length && covered === lines.length
    ? full.reduce((a, b) => (b.total < a.total ? b : a))
    : null
  const rounded = Math.round(total * 100) / 100
  return {
    total: rounded,
    currency: [...currencies][0],
    covered,
    requested: lines.length,
    suppliers: suppliers.size,
    bestSingle: bestSingle ? { supplier_id: bestSingle.supplier_id, total: bestSingle.total } : null,
    saving: bestSingle ? Math.round((bestSingle.total - rounded) * 100) / 100 : null,
  }
}

export const CELL_LABEL: Record<string, string> = {
  NOT_QUOTED: 'لم يسعّر',
  UNAVAILABLE: 'غير متوفر',
  UNPRICED: 'بلا سعر',
  QUANTITY_MISMATCH: 'كمية أو وحدة مختلفة',
  AMBIGUOUS: 'سعر مكرر',
  NOT_REQUESTED: 'لم يُطلب منه',
}

export type TimelineEvent = { key: string; at: string | null; title: string; detail?: string }

const REQUEST_EVENTS: Record<string, string> = {
  RFQ_CREATED: 'تم إنشاء الطلب',
  RFQ_VERSION_CREATED: 'أُنشئت نسخة جديدة من الطلب',
  RFP_SUBMISSIONS_CLOSED: 'أُغلق استلام العروض',
  RFP_ENVELOPES_OPENED: 'فُتحت المظاريف',
  AWARD_DISPATCH_FAILED: 'تعذر إرسال إشعار الترسية',
  AWARD_DISPATCHED: 'أُرسل إشعار الترسية للمورد',
}

/**
 * The request's history. Request-level events come from audit_timeline (each
 * with its own recorded or derived time); supplier events from supplier-outcomes
 * (sent_at, opened_at, attempted_at, quote version created_at, award created_at).
 * Batch send events are replaced by the per-supplier ones. An event without a
 * timestamp is kept undated, never given another event's time.
 */
export function buildTimeline(
  rfq: ConstructionRfq,
  outcomes: ConstructionSupplierOutcomeEvent[],
  supplierName: (supplierId: string | null) => string,
  lineName: (lineId: string) => string | null = () => null,
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const [i, e] of (rfq.audit_timeline || []).entries()) {
    const title = REQUEST_EVENTS[e.event_type]
    if (!title) continue
    events.push({ key: `a${i}`, at: e.created_at || null, title, detail: e.event_type === 'RFQ_CREATED' && e.email_snapshot ? e.email_snapshot : undefined })
  }
  for (const e of outcomes) {
    const who = supplierName(e.supplier_id)
    const channel = CHANNEL_AR[String(e.details?.channel || '')]
    const title = {
      INVITED: `تم إرسال الطلب إلى ${who}${channel ? ` عبر ${channel}` : ''}`,
      OPENED: `${who} فتح الطلب`,
      SEND_FAILED: `تعذر الإرسال إلى ${who}${channel ? ` عبر ${channel}` : ''}`,
      QUOTE_RECEIVED: `تم استلام عرض من ${who}`,
      LINE_DECLINED: `${who} أفاد بعدم توفر ${lineName(String(e.details?.line_id || '')) ? `«${lineName(String(e.details?.line_id || ''))}»` : 'بند'}`,
      AWARDED: `تمت الترسية على ${who}`,
    }[e.event_type]
    if (!title) continue
    events.push({ key: `o${e.id}`, at: e.created_at || null, title })
  }
  return events.sort((a, b) => {
    if (!a.at && !b.at) return 0
    if (!a.at) return 1
    if (!b.at) return -1
    return Date.parse(a.at) - Date.parse(b.at)
  })
}

export function formatEventTime(at: string | null): string | null {
  if (!at) return null
  const ts = Date.parse(at)
  if (Number.isNaN(ts)) return null
  const d = new Date(ts)
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Riyadh' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Riyadh' })
  return `⁦${day} — ${time}⁩`
}

export function formatMoney(value?: number | null, currency = 'SAR'): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null
  const n = Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${n} ${currency === 'SAR' ? 'ريال' : currency}`
}
