import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { NavProps } from '../types'
import { useProcurement } from '../procurementContext'
import {
  formatRfqTitle,
  getConstructionComparison,
  getConstructionRfq,
  invitePreferredChannel,
  type ConstructionComparison,
  type ConstructionRfq,
} from '../api/constructionClient'
import { CELL_LABEL, cheapestPerLineTotal, leadTimeLabel, lowestPerLine, matrixTotals, quoteCoverage } from '../lib/requestFile'
import { rfqProjectName } from '../lib/rfqIdentity'
import { awardBlockReason, type AwardOffer } from '../lib/awardFlow'
import AwardConfirmSheet from '../pages/award/AwardConfirmSheet'
import { Badge, Button, Chip, DualDate, Icon, Money, PriceCell, RiyalSign, TopBar, useIsMobile, type PriceCellState, type VatBasis } from '../ui'

/*
 * «مقارنة العروض» — Figma B2B M04 `18371:23206` / W04 `18430:3016` opens on a summary: the request, its items,
 * the received offers ranked complete-cheapest first with every price made tax-inclusive (VAT 15 % added where an
 * offer was before tax, and said so), the partial offer explained («ناقص 3 · ≈ …»), then «قارن البنود بنداً بنداً»
 * (primary) and the award (secondary). «قارن البنود» opens the line-by-line matrix below.
 *
 * «04 · وش الفرق؟» — the line-by-line comparison on the real quote matrix.
 * Every number comes from recorded offers: the per-line winner follows
 * lowestPerLine (one tax basis, one currency, no ties), the totals follow
 * matrixTotals, and the split basket follows cheapestPerLineTotal.
 */

type Matrix = NonNullable<ConstructionComparison['quote_matrix']>
type Line = Matrix['lines'][number]
type Cell = Line['offers'][number]
type Filter = 'all' | 'big' | 'incomparable' | 'none'

const BIG_DIFF = 0.1
const VAT = 0.15

/** Wraps a left-to-right run (signed amount, percentage) so RTL text keeps it in order. */
const ltr = (s: string) => `\u2066${s}\u2069`

/** The tax basis a price was given on: `prices_include_tax` true / false; null = the offer did not say. */
type Basis = VatBasis | null
const basisOf = (v: boolean | null | undefined): Basis => (v === true ? 'incl' : v === false ? 'excl' : null) // null: VAT basis unknown in the API for this offer — nothing is claimed
/** One basis for a set of cells, or null when they differ or any is unstated. */
function commonBasis(values: Array<boolean | null | undefined>): Basis {
  const set = new Set(values.map((v) => v ?? null))
  return set.size === 1 ? basisOf([...set][0]) : null
}

/** A price: number + riyal sign (+ «شامل الضريبة ١٥٪» / «قبل الضريبة» when the basis is known). */
function money(n?: number | null, currency = 'SAR', vat: Basis = null, noteClassName?: string): ReactNode {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  if (currency && currency !== 'SAR') return `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  return <Money amount={Number(n)} vat={vat} noteClassName={noteClassName} />
}
/** A signed difference «+1,234.00 ⃁ (2.2%)», kept left-to-right. */
const plus = (v: number, pct: number | null, decimals = 2, currency = 'SAR') => (
  <bdi dir="ltr" className="inline-flex items-baseline gap-1 whitespace-nowrap">+{v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{currency === 'SAR' || !currency ? <RiyalSign /> : ` ${currency}`}{pct != null ? ` (${(pct * 100).toFixed(1)}%)` : ''}</bdi>
)

function cellState(cell: Cell | undefined, winner: string | null, best: number | null): { state: PriceCellState; delta: ReactNode } {
  if (!cell || cell.status === 'NOT_QUOTED') return { state: 'Pending', delta: 'بانتظار الرد' }
  if (cell.status === 'UNAVAILABLE') return { state: 'Pending', delta: 'ما عنده البند' }
  if (cell.status === 'NOT_REQUESTED') return { state: 'Pending', delta: 'لم يُطلب منه' }
  if (cell.status !== 'PRICED' || cell.line_total == null) return { state: 'Not comparable', delta: CELL_LABEL[cell.status] || 'غير قابل للمقارنة' }
  if (!winner || best == null) return { state: 'Not comparable', delta: 'لا تُقارن: ضريبة أو عملة مختلفة' }
  if (cell.supplier_id === winner) return { state: 'Best', delta: 'الأقل سعرًا' }
  const diff = Number(cell.line_total) - best
  const pct = best > 0 ? diff / best : 0
  return { state: pct >= BIG_DIFF ? 'Higher' : 'Normal', delta: plus(Number(diff), pct, 2, cell.currency) }
}

function MatrixCell({ cell, winner, best, fluid }: { cell: Cell | undefined; winner: string | null; best: number | null; fluid?: boolean }) {
  const { state, delta } = cellState(cell, winner, best)
  return <PriceCell fluid={fluid} state={state} delta={delta} price={cell && cell.line_total != null ? money(cell.line_total, cell.currency, basisOf(cell.prices_include_tax)) : null} />
}

export function ComparisonV2({ navigate }: NavProps) {
  const { selectedRfqId } = useProcurement()
  const [rfq, setRfq] = useState<ConstructionRfq | null>(null)
  const [comparison, setComparison] = useState<ConstructionComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [showAll, setShowAll] = useState(false)
  const [awarding, setAwarding] = useState<AwardOffer | null>(null)
  const [mode, setMode] = useState<'summary' | 'lines'>('summary')
  const [notice, setNotice] = useState<string | null>(null)
  const mobile = useIsMobile()

  const load = useCallback(async (id: string) => {
    try {
      const [r, c] = await Promise.all([getConstructionRfq(id), getConstructionComparison(id)])
      setRfq(r); setComparison(c); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل العروض. أعد المحاولة أو افتح المظاريف إذا كان الطلب مغلقًا.')
    }
  }, [])
  useEffect(() => { if (selectedRfqId) void load(selectedRfqId) }, [selectedRfqId, load])

  const matrix = comparison?.quote_matrix || null
  const lines = useMemo(() => matrix?.lines || [], [matrix])
  const winners = useMemo(() => lowestPerLine(matrix), [matrix])
  const { totals, lowest } = useMemo(() => matrixTotals(matrix), [matrix])
  const basket = useMemo(() => cheapestPerLineTotal(matrix, winners, totals), [matrix, winners, totals])
  const responses = comparison?.supplier_responses || []
  const nameOf = useCallback((id: string) => {
    const r = responses.find((x) => String(x.supplier.id) === id)
    return r?.supplier.name_ar || r?.supplier.name_en || 'مورد'
  }, [responses])
  const channelOf = useCallback((id: string) => {
    const inv = (rfq?.invitations || []).find((i) => i.supplier_id === id || i.supplier?.id === id)
    const ch = inv ? invitePreferredChannel(inv) : null
    return ch === 'WHATSAPP' ? 'واتساب' : ch === 'EMAIL' ? 'إيميل' : ch === 'HARAJ' ? 'حراج' : 'البوابة'
  }, [rfq])
  const summaryBySupplier = useMemo(() => new Map((matrix?.supplier_summaries || []).map((s) => [String(s.supplier_id), s])), [matrix])
  const supplierIds = useMemo(() => {
    const ids: string[] = []
    for (const line of lines) for (const c of line.offers || []) if (c && !ids.includes(c.supplier_id)) ids.push(c.supplier_id)
    // cheapest complete total first, then by how many lines were priced
    const pricedOf = (id: string) => totals.find((t) => t.supplier_id === id)?.priced || 0
    return ids.sort((a, b) => (a === lowest ? -1 : b === lowest ? 1 : pricedOf(b) - pricedOf(a)))
  }, [lines, totals, lowest])

  // The basis each figure was stated on, from the cells it adds up (null when they differ or are unstated).
  const supplierBasis = useCallback((id: string): Basis => commonBasis(lines.flatMap((l) => (l.offers || []).filter((c) => c && c.supplier_id === id && c.status === 'PRICED' && c.line_total != null).map((c) => c.prices_include_tax))), [lines])
  const basketBasis = useMemo((): Basis => commonBasis(lines.flatMap((l) => { const w = winners.get(l.id); const c = w ? (l.offers || []).find((x) => x && x.supplier_id === w) : null; return c && c.line_total != null ? [c.prices_include_tax] : [] })), [lines, winners])

  const bestOfLine = useCallback((line: Line): number | null => {
    const w = winners.get(line.id)
    if (!w) return null
    const cell = (line.offers || []).find((c) => c && c.supplier_id === w)
    return cell && cell.line_total != null ? Number(cell.line_total) : null
  }, [winners])

  const classify = useCallback((line: Line): { big: boolean; incomparable: boolean; none: boolean } => {
    const priced = (line.offers || []).filter((c): c is Cell => Boolean(c) && c.status === 'PRICED' && c.line_total != null)
    const none = priced.length === 0
    const incomparable = !none && (!winners.get(line.id) || (line.offers || []).some((c) => c && ['QUANTITY_MISMATCH', 'AMBIGUOUS', 'UNPRICED'].includes(c.status)))
    const best = bestOfLine(line)
    const big = best != null && priced.some((c) => (Number(c.line_total) - best) / best >= BIG_DIFF)
    return { big, incomparable, none }
  }, [winners, bestOfLine])

  const counts = useMemo(() => {
    const c = { all: lines.length, big: 0, incomparable: 0, none: 0 }
    for (const l of lines) { const k = classify(l); if (k.big) c.big++; if (k.incomparable) c.incomparable++; if (k.none) c.none++ }
    return c
  }, [lines, classify])
  const visible = useMemo(() => lines.filter((l) => { const k = classify(l); return filter === 'all' || (filter === 'big' && k.big) || (filter === 'incomparable' && k.incomparable) || (filter === 'none' && k.none) }), [lines, filter, classify])
  const shown = showAll ? visible : visible.slice(0, 8)

  const complete = totals.filter((t) => t.complete)
  const highest = complete.length ? complete.reduce((a, b) => (b.total > a.total ? b : a)) : null
  const bestSingle = lowest ? totals.find((t) => t.supplier_id === lowest) || null : null
  const basketLines = useMemo(() => {
    const per = new Map<string, number>()
    for (const l of lines) { const w = winners.get(l.id); if (w) per.set(w, (per.get(w) || 0) + 1) }
    return [...per.entries()].sort((a, b) => b[1] - a[1])
  }, [lines, winners])
  const savingVsHighest = basket && highest ? highest.total - basket.total : bestSingle && highest ? highest.total - bestSingle.total : null
  const savingPct = savingVsHighest != null && highest && highest.total > 0 ? (savingVsHighest / highest.total) * 100 : null
  const pricedLines = lines.filter((l) => (l.offers || []).some((c) => c && c.status === 'PRICED' && c.line_total != null)).length
  const offerForSupplier = (id: string): AwardOffer | null => responses.find((r) => String(r.supplier.id) === id) || null

  function exportCsv() {
    const head = ['البند', 'الكمية', 'الوحدة', ...supplierIds.map(nameOf)]
    const rows = lines.map((l) => [l.name_ar, String(l.quantity ?? ''), l.uom || '', ...supplierIds.map((id) => { const c = (l.offers || []).find((x) => x && x.supplier_id === id); return c && c.line_total != null ? String(c.line_total) : (c ? CELL_LABEL[c.status] || c.status : '') })])
    const csv = '﻿' + [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `comparison-${selectedRfqId?.slice(0, 8) || 'rfq'}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  if (!selectedRfqId) return <div className="p-8 text-right">اختر طلبًا أولًا.</div>
  if (error) return <div className="p-8 text-right text-[var(--color-text-danger)]">{error}</div>
  if (!rfq || !comparison) return <div className="p-8 text-right" style={{ color: 'var(--color-text-secondary)' }}>جارٍ تحميل العروض…</div>

  const payload = rfq.current_version?.payload || {}
  const title = rfqProjectName({ delivery: payload.delivery }) || formatRfqTitle({ id: rfq.id, engineering_department: rfq.engineering_department, delivery: payload.delivery, buyer: payload.buyer })
  const currency = basket?.currency || bestSingle?.currency || 'SAR'
  const bestOffer = lowest ? offerForSupplier(lowest) : null
  // 05 entry: why «ترسية» is off. The rule is unchanged (matrixTotals names a supplier only with ≥ 2
  // complete offers); with exactly one complete offer the reason now says so instead of «no complete offer».
  const blocked = bestOffer ? awardBlockReason(rfq, bestOffer)
    : complete.length === 1 ? 'نحتاج عرضين كاملين على الأقل للمقارنة — وصل عرض واحد'
    : complete.length >= 2 ? 'العروض الكاملة لا تُقارن (ضريبة أو عملة مختلفة)'
    : 'لا يوجد مورد سعّر كل البنود بعد'

  const onInverse = 'text-[var(--color-text-on-inverse-secondary)]'
  // «الوفر» is a difference of two totals: it has a basis only when both totals share one.
  const savingFrom: Basis = basket ? basketBasis : bestSingle ? supplierBasis(bestSingle.supplier_id) : null
  const savingBasis: Basis = highest && savingFrom === supplierBasis(highest.supplier_id) ? savingFrom : null
  const chips: Array<[Filter, string]> = [['all', `كل البنود ${counts.all}`], ['big', `فيها فرق كبير ${counts.big}`], ['incomparable', `غير قابلة للمقارنة ${counts.incomparable}`], ['none', `ما وصلها عرض ${counts.none}`]]
  const figures: Array<{ label: string; value: ReactNode; basis: string; mint: boolean }> = [
    { label: 'أوفر توزيعة', value: basket ? money(basket.total, basket.currency, basketBasis, onInverse) : '—', basis: basket ? `${basket.suppliers} موردين · ${basket.covered} من ${basket.requested} بند` : 'لا يوجد بند له أوفر مورد مؤكد', mint: true },
    { label: 'أوفر مورد واحد', ...(bestSingle
      ? { value: money(bestSingle.total, bestSingle.currency, supplierBasis(bestSingle.supplier_id), onInverse), basis: `${nameOf(bestSingle.supplier_id)} · ${bestSingle.priced} بند` }
      : complete.length === 1
        // matrixTotals needs two complete offers to name a cheapest one; say so instead of a blank figure.
        ? { value: 'عرض كامل واحد', basis: `نحتاج عرضين كاملين على الأقل للمقارنة — وصل عرض واحد (${nameOf(complete[0].supplier_id)})` }
        : complete.length >= 2
          ? { value: '—', basis: 'العروض الكاملة لا تُقارن (ضريبة أو عملة مختلفة)' }
          : { value: 'لا يوجد بعد', basis: 'نحتاج عرضين كاملين على الأقل للمقارنة — ما وصل أي عرض كامل' }), mint: false },
    { label: 'أعلى عرض', value: highest ? money(highest.total, highest.currency, supplierBasis(highest.supplier_id), onInverse) : '—', basis: highest ? `${nameOf(highest.supplier_id)} · على كل البنود` : 'لا يوجد عرض كامل بعد', mint: false },
  ]

  const recommendation = (
    <>
      <Badge tone="Success" label="التوصية" showDot={false} />
      {basket && basket.suppliers > 1 ? (
        <>
          <p className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">وزّع على {basket.suppliers} موردين</p>
          <p className="w-full text-[14px] leading-[22px] text-[var(--color-text-secondary)]">كل بند يروح لأوفر مورد سعّره على نفس الأساس. {basket.covered < basket.requested ? `${basket.requested - basket.covered} بند بلا أوفر مؤكد.` : ''}</p>
          <ul className="flex w-full flex-col gap-3">
            {basketLines.map(([id, n]) => (
              <li key={id} className="flex w-full items-center justify-between gap-3">
                <p className="min-w-0 truncate text-[14px] leading-[22px] font-medium">{nameOf(id)}</p>
                <p className="shrink-0 font-[family-name:var(--font-display)] text-[16px] leading-[24px] font-semibold">{n} {n === 1 ? 'بند' : n === 2 ? 'بندان' : n <= 10 ? 'بنود' : 'بند'}</p>
              </li>
            ))}
          </ul>
          <span className="h-px w-full bg-[var(--color-border-default)]" />
          <p className="w-full text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{basket.bestSingle && basket.saving != null ? <>البديل الأبسط: مورد واحد ({nameOf(basket.bestSingle.supplier_id)}) بزيادة {money(basket.saving, basket.currency, basketBasis === supplierBasis(basket.bestSingle.supplier_id) ? basketBasis : null)}.</> : 'لا يوجد مورد واحد سعّر كل البنود حتى الآن.'}</p>
        </>
      ) : bestSingle ? (
        <>
          <p className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">مورد واحد يكفي</p>
          <p className="w-full text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{nameOf(bestSingle.supplier_id)} هو الأوفر على كل البنود المسعّرة.</p>
        </>
      ) : (
        <>
          <p className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">بانتظار عروض أكثر</p>
          <p className="w-full text-[14px] leading-[22px] text-[var(--color-text-secondary)]">تظهر التوصية عندما يصل عرضان قابلان للمقارنة على نفس البند.</p>
        </>
      )}
    </>
  )
  const awardLabel = bestSingle ? `رسِّ على ${nameOf(bestSingle.supplier_id)}` : 'ترسية'
  const awardDialog = awarding ? (
    <AwardConfirmSheet rfq={rfq} comparison={comparison} offer={awarding} coverage={quoteCoverage(summaryBySupplier.get(String(awarding.supplier.id)), lines.length)} onClose={() => setAwarding(null)}
      onDone={async () => { setAwarding(null); setNotice(`تم بحمد الله، سُجّلت الترسية على ${awarding.supplier.name_ar || awarding.supplier.name_en}.`); await load(rfq.id).catch(() => {}) }} />
  ) : null

  // ── Summary (Figma M04): one tax basis for every total. ──
  const inclusive = (c: Cell) => c.prices_include_tax === false ? Number(c.line_total) * (1 + VAT) : Number(c.line_total)
  const offerRows = supplierIds.map((id) => {
    let total = 0, priced = 0, addedTax = false, unknownTax = false
    const missing: Line[] = []
    for (const l of lines) {
      const c = (l.offers || []).find((x) => x && x.supplier_id === id)
      if (c && c.status === 'PRICED' && c.line_total != null) { total += inclusive(c); priced++; if (c.prices_include_tax === false) addedTax = true; if (c.prices_include_tax == null) unknownTax = true }
      else missing.push(l)
    }
    // «≈ لو كمّلتها»: this offer plus the cheapest tax-inclusive price another supplier gave for each missing line.
    let completed: number | null = missing.length ? total : null
    for (const l of missing) {
      const others = (l.offers || []).filter((c): c is Cell => Boolean(c) && c.status === 'PRICED' && c.line_total != null && c.prices_include_tax != null)
      if (!others.length || completed == null) { completed = null; break }
      completed += Math.min(...others.map(inclusive))
    }
    return { id, total: Math.round(total * 100) / 100, priced, complete: lines.length > 0 && priced === lines.length, missing: missing.length, completed, addedTax, unknownTax }
  }).filter((r) => r.priced > 0)
  const comparable = offerRows.filter((r) => r.complete && !r.unknownTax).sort((a, b) => a.total - b.total)
  const ranked = [...comparable, ...offerRows.filter((r) => !comparable.includes(r))]
  const cheapest = comparable[0] || null
  const anyAddedTax = offerRows.some((r) => r.addedTax)
  const invited = rfq.invitations || []
  const waitingNames = invited.filter((i) => !responses.some((r) => String(r.supplier.id) === i.supplier_id)).map((i) => i.supplier?.name_ar || i.supplier?.name_en || 'مورد')
  const lead = (id: string) => { const o = offerForSupplier(id); return o ? leadTimeLabel(o.offer) : null }
  // Summary totals are made tax-inclusive above (15 % added to before-tax lines); a row with an unstated line has no basis.
  const sar = (v: number, known: boolean) => <Money amount={Math.round(v)} decimals={0} vat={known ? 'incl' : null} className="justify-end" />
  const submittedOf = (id: string) => offerForSupplier(id)?.offer.submittedAt || null

  if (mode === 'summary') {
    return (
      <div className="pricing-v2 min-h-full text-[var(--color-text-primary)]">
        <TopBar parent={title} onParent={() => navigate('rfq-detail')} title="مقارنة العروض" />
        <div className={`mx-auto flex w-full max-w-[720px] flex-col gap-4 ${mobile ? 'p-4 pb-24' : 'p-8'}`}>
          {mobile ? null : <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-[44px] font-semibold">مقارنة العروض · {title}</h1>}
          {notice ? <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-4 py-3 text-[14px] text-[var(--color-text-success)]">{notice}</p> : null}
          <section aria-label="الطلب" className="flex flex-col gap-1 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-[family-name:var(--font-display)] text-[20px] leading-[32px] font-semibold">{title}</h2>
              <Badge tone="Warning" showDot={false} label={`${responses.length} من ${invited.length || supplierIds.length} · ${lines.length} بنداً`} />
            </div>
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">أُرسل إلى <bdi dir="ltr">{invited.length}</bdi> موردين{waitingNames.length ? ` · بانتظار: ${waitingNames.slice(0, 3).join('، ')}${waitingNames.length > 3 ? ` و${waitingNames.length - 3} غيرهم` : ''}` : ''}</p>
          </section>

          <section aria-labelledby="items-h" className="flex flex-col gap-2 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="items-h" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-semibold">البنود</h2>
              <button type="button" onClick={() => setMode('lines')} className="min-h-11 px-2 text-[14px] text-[var(--color-text-link)] underline">عرض الكل</button>
            </div>
            <ul className="flex flex-col gap-2">
              {lines.slice(0, 3).map((l) => <li key={l.id} className="flex items-center justify-between gap-3 text-[14px] leading-[22px]"><span className="min-w-0">{l.name_ar}</span><span className="shrink-0 text-[var(--color-text-secondary)]"><bdi dir="ltr">{l.quantity}</bdi> {l.uom}</span></li>)}
            </ul>
            {lines.length > 3 ? <p className="text-[14px] text-[var(--color-text-secondary)]">+ <bdi dir="ltr">{lines.length - 3}</bdi> بنود أخرى</p> : null}
          </section>

          <section aria-labelledby="offers-h" className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <h2 id="offers-h" className="font-[family-name:var(--font-display)] text-[20px] leading-[32px] font-semibold">العروض المستلمة</h2>
                <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">الأرخص المكتمل أولاً · شامل الضريبة</p>
              </div>
              <p className="shrink-0 text-[14px] text-[var(--color-text-secondary)]"><bdi dir="ltr">{responses.length}</bdi> عروض من <bdi dir="ltr">{invited.length || supplierIds.length}</bdi></p>
            </div>
            {ranked.length === 0 ? <p className="text-[14px] text-[var(--color-text-secondary)]">ما وصل أي سعر للحين، وأول ما يوصل نعرضه هنا.</p> : null}
            <ul className="flex flex-col gap-2">
              {ranked.map((r) => {
                const isBest = cheapest?.id === r.id
                const diff = cheapest && r.complete && !isBest && !r.unknownTax ? r.total - cheapest.total : null
                const pct = diff != null && cheapest!.total > 0 ? diff / cheapest!.total : null
                const sent = submittedOf(r.id)
                const meta = [<bdi key="n" dir="ltr">{r.priced}/{lines.length}</bdi>, lead(r.id)].filter(Boolean)
                return (
                  <li key={r.id} className={`flex items-start justify-between gap-3 rounded-[var(--radius-lg)] p-4 ${isBest ? 'border-2 border-[var(--color-text-primary)] bg-[var(--color-bg-primary-subtle)]' : ''}`}>
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-[16px] leading-[26px] font-medium">{nameOf(r.id)}</p>
                      <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
                        {r.complete ? meta.map((m, k) => <span key={k}>{k ? ' · ' : ''}{m}</span>) : <>ناقص <bdi dir="ltr">{r.missing}</bdi>{r.completed != null ? <> · ≈ <Money amount={Math.round(r.completed)} decimals={0} vat={r.unknownTax ? null : 'incl'} /> لو كمّلتها</> : null}</>}
                        {r.addedTax ? ' · + ضريبة' : ''}{r.unknownTax ? ' · الضريبة غير واضحة' : ''}
                      </p>
                      {sent ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">وصل العرض <DualDate value={sent} /></p> : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-semibold tabular-nums">{sar(r.total, !r.unknownTax)}</div>
                      {isBest ? <Badge tone="Success" showDot={false} label={comparable.length > 1 ? 'الأرخص المكتمل ✓' : 'الوحيد المكتمل'} />
                        : !r.complete ? <Badge tone="Warning" showDot={false} label="عرض ناقص" />
                        : diff != null && pct != null ? (
                          <span className="flex items-center gap-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
                            <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-bg-surface-2)]"><span className="block h-full bg-[var(--color-bg-delta,var(--color-bg-warning))]" style={{ width: `${Math.min(100, pct * 400)}%` }} /></span>
                            {plus(Math.round(diff), pct, 0)}
                          </span>
                        ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
            {anyAddedTax ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">«+ ضريبة»: العرض وصل قبل الضريبة، وحسبناه شامل 15%.</p> : null}
          </section>

          <div className="flex flex-col gap-2">
            <Button variant="Primary" size="L" fullWidth onClick={() => setMode('lines')}>قارن البنود بنداً بنداً</Button>
            <Button variant="Secondary" size="L" fullWidth disabled={Boolean(blocked)} onClick={() => bestOffer && setAwarding(bestOffer)}>{awardLabel}</Button>
            {blocked ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{blocked}</p> : null}
            <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">العرض الناقص ما يدخل في «الأرخص المكتمل»، لكن تقدر تقارن بنوده.</p>
          </div>
        </div>
        {awardDialog}
      </div>
    )
  }

  const backToSummary = <Button variant="Ghost" size="S" icon="chevron-forward" onClick={() => setMode('summary')}>الملخص</Button>

  if (mobile) {
    // Figma M04 (58:216): summary card, filter chips, one card per item, award bar above the bottom nav.
    return (
      <div className="pricing-v2 min-h-full text-[var(--color-text-primary)]">{/* transparent: the living background (BG / Facets) shows around the cards */}
        <TopBar parent={title} onParent={() => navigate('rfq-detail')} title="وش الفرق؟" />
        <div className="flex flex-col gap-4 p-4 pb-40">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{responses.length} عرض من {supplierIds.length} موردين · {pricedLines} من {lines.length} بند وصلها سعر</p>
            <span className="flex items-center gap-1">{backToSummary}<Button variant="Ghost" size="S" icon="file" onClick={exportCsv}>تصدير</Button></span>
          </div>
          {notice ? <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-4 py-3 text-[14px] text-[var(--color-text-success)]">{notice}</p> : null}
          <section aria-label="ملخص الأسعار" data-tone="deep" className="flex flex-col gap-3 rounded-[var(--radius-xl)] bg-[var(--color-bg-inverse)] p-4">
            <div className="flex flex-col items-start gap-0.5">
              <p className="text-[14px] font-medium text-[var(--color-text-on-inverse-secondary)]">{figures[0].label}</p>
              <div className="font-[family-name:var(--font-display)] text-[28px] leading-[40px] font-semibold tabular-nums text-[var(--color-bg-brand)]">{figures[0].value}</div>
              <p className="text-[12px] font-medium text-[var(--color-text-on-inverse-secondary)]">{figures[0].basis}</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-bg-brand)] px-4 py-3 text-[var(--color-text-on-brand)]">
              <div className="flex flex-wrap items-baseline gap-x-1.5 text-[14px] font-medium">الوفر <span className="font-[family-name:var(--font-display)] text-[16px] font-semibold tabular-nums">{savingVsHighest != null ? money(savingVsHighest, currency, savingBasis, 'text-[var(--color-text-on-brand)]') : '—'}</span></div>
              <p className="font-[family-name:var(--font-display)] text-[16px] font-semibold tabular-nums">{savingPct != null ? ltr(`${savingPct.toFixed(1)}%`) : '—'}</p>
            </div>
            {/* Not in the Figma phone frame; kept so the phone shows the same figures as the desktop. */}
            <dl className="grid grid-cols-2 gap-3">
              {figures.slice(1).map((f) => (
                <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-[12px] font-medium text-[var(--color-text-on-inverse-secondary)]">{f.label}</dt>
                  <dd className="min-w-0 font-[family-name:var(--font-display)] text-[16px] font-semibold tabular-nums text-[var(--color-text-on-inverse)]">{f.value}</dd>
                  <dd className="text-[11px] leading-[16px] text-[var(--color-text-on-inverse-secondary)]">{f.basis}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-label="الموردين" className="flex flex-col divide-y divide-[var(--color-border-default)] rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
            {supplierIds.map((id) => {
              const cov = quoteCoverage(summaryBySupplier.get(id), lines.length)
              return (
                <div key={id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <p className="min-w-0 truncate text-[14px] font-medium">{nameOf(id)}</p>
                  <p className="shrink-0 text-[12px] font-medium text-[var(--color-text-tertiary)]">{channelOf(id)} · {cov ? `${cov.priced} بند` : '—'}</p>
                </div>
              )
            })}
          </section>
          <div role="group" aria-label="تصفية البنود" className="-mx-4 flex gap-2 overflow-x-auto px-4">
            {chips.map(([k, label]) => <Chip key={k} label={label} selected={filter === k} onClick={() => { setFilter(k); setShowAll(false) }} />)}
          </div>
          {shown.length === 0 ? <p className="text-[14px] text-[var(--color-text-secondary)]">لا يوجد بنود في هذا التصنيف.</p> : null}
          {shown.map((line) => {
            const winner = winners.get(line.id) || null
            const best = bestOfLine(line)
            return (
              <section key={line.id} aria-label={line.name_ar} className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-[16px] leading-[26px] font-medium">{line.name_ar}</p>
                  <p className="shrink-0 text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{line.quantity} {line.uom}</p>
                </div>
                <ul className="flex flex-col gap-2">
                  {supplierIds.map((id) => (
                    <li key={id} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-[13px] leading-[18px] font-medium text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{nameOf(id)}</span>
                      <MatrixCell fluid cell={(line.offers || []).find((c) => c && c.supplier_id === id)} winner={winner} best={best} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {visible.length > shown.length ? <Button variant="Ghost" fullWidth onClick={() => setShowAll(true)}>عرض {visible.length - shown.length} بند إضافي</Button> : null}
          <aside aria-label="التوصية" className="flex flex-col items-start gap-4 rounded-[var(--radius-xl)] border-[1.5px] border-[var(--color-border-success)] bg-[var(--color-bg-surface)] p-4 text-start">{recommendation}</aside>
          {blocked ? <p className="text-[12px] text-[var(--color-text-secondary)]">{blocked}</p> : null}
        </div>
        <div className="fixed inset-x-0 bottom-[72px] z-10 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3">
          <Button variant="Primary" size="L" icon="award" fullWidth disabled={Boolean(blocked)} onClick={() => bestOffer && setAwarding(bestOffer)}>{awardLabel}</Button>
        </div>
        {awardDialog}
      </div>
    )
  }

  return (
    <div className="pricing-v2 min-h-full text-[var(--color-text-primary)]">{/* transparent: the living background (BG / Facets) shows around the cards */}
      <TopBar parent={title} onParent={() => navigate('rfq-detail')} title="مقارنة العروض" />

      <div className="flex flex-col gap-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col items-start gap-1">
            <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-[48px] font-bold">وش الفرق؟</h1>
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{responses.length} عرض من {supplierIds.length} موردين · {pricedLines} من {lines.length} بند وصلها سعر</p>
          </div>
          <div className="flex items-center gap-3">
            {backToSummary}
            <Button variant="Secondary" size="L" icon="file" onClick={exportCsv}>تصدير</Button>
            <Button variant="Primary" size="L" icon="award" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => bestOffer && setAwarding(bestOffer)}>ترسية</Button>
          </div>
        </div>

        {notice ? <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-4 py-3 text-start text-[14px] text-[var(--color-text-success)]">{notice}</p> : null}

        <section aria-label="ملخص الأسعار" data-tone="deep" className="flex items-start gap-6 rounded-[var(--radius-xl)] bg-[var(--color-bg-inverse)] px-8 py-7 text-start">
          {figures.map((f) => (
            <div key={f.label} className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <p className="text-[14px] leading-[22px] font-medium text-[var(--color-text-on-inverse-secondary)]">{f.label}</p>
              <div className="font-[family-name:var(--font-display)] text-[28px] leading-[40px] font-semibold tabular-nums" style={{ color: f.mint ? 'var(--color-bg-brand)' : 'var(--color-text-on-inverse)' }}>{f.value}</div>
              <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-on-inverse-secondary)]">{f.basis}</p>
            </div>
          ))}
          <div className="flex flex-col items-start gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-brand)] px-5 py-4 text-[var(--color-text-on-brand)]">
            <p className="text-[14px] leading-[22px] font-medium">الوفر</p>
            <div className="font-[family-name:var(--font-display)] text-[28px] leading-[40px] font-semibold tabular-nums">{savingVsHighest != null ? money(savingVsHighest, currency, savingBasis, 'text-[var(--color-text-on-brand)]') : '—'}</div>
            <p className="text-[12px] leading-[18px] font-medium">{savingPct != null ? `${ltr(`${savingPct.toFixed(1)}%`)} أقل من أعلى عرض` : 'يُحسب عند اكتمال عرضين على الأقل'}</p>
          </div>
        </section>

        <div className="flex items-center gap-1.5">
          <Icon name="info" size={16} className="text-[var(--color-icon-secondary)]" />
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">الأرقام هنا إجمالي البنود المسعّرة كما وردت من المورد ({matrix?.basis === 'INCLUSIVE' ? 'شاملة الضريبة' : 'حسب ما ذكره كل مورد'})؛ التوصيل والضريبة النهائية في بطاقة كل عرض. الفرق محسوب مقابل أوفر عرض قابل للمقارنة لنفس البند.</p>
        </div>

        <div role="group" aria-label="تصفية البنود" className="flex items-center gap-2">
          {chips.map(([k, label]) => <Chip key={k} label={label} selected={filter === k} onClick={() => { setFilter(k); setShowAll(false) }} />)}
        </div>

        <div className="flex items-start gap-6">
          <div className="flex min-w-0 flex-1 flex-col items-stretch overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]" role="table" aria-label="مقارنة الأسعار لكل بند">
            <div role="row" className="flex w-full min-w-max items-center bg-[var(--color-bg-surface-2)]">
              <div role="columnheader" className="flex h-16 w-[200px] shrink-0 items-center p-3"><p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">البند</p></div>
              {supplierIds.map((id) => {
                const cov = quoteCoverage(summaryBySupplier.get(id), lines.length)
                return (
                  <div role="columnheader" key={id} className="flex h-16 w-[196px] shrink-0 flex-col items-start justify-center gap-0.5 p-3">
                    <p className="max-w-full truncate text-[14px] leading-[22px] font-medium">{nameOf(id)}</p>
                    <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-tertiary)]">{channelOf(id)} · {cov ? `${cov.priced} بند` : '—'}</p>
                  </div>
                )
              })}
            </div>
            {shown.length === 0 ? <p className="w-full p-6 text-start text-[14px] text-[var(--color-text-secondary)]">لا يوجد بنود في هذا التصنيف.</p> : null}
            {shown.map((line) => {
              const winner = winners.get(line.id) || null
              const best = bestOfLine(line)
              return (
                <div role="row" key={line.id} className="flex w-full min-w-max items-center border-t border-[var(--color-border-default)]">
                  <div role="rowheader" className="flex min-h-24 w-[200px] shrink-0 flex-col items-start justify-center gap-0.5 p-3">
                    <p className="max-w-full truncate text-[16px] leading-[26px] font-medium" title={line.name_ar}>{line.name_ar}</p>
                    <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{line.quantity} {line.uom}</p>
                  </div>
                  {supplierIds.map((id) => (
                    <div role="cell" key={id} className="flex min-h-24 w-[196px] shrink-0 items-center p-3">
                      <MatrixCell cell={(line.offers || []).find((c) => c && c.supplier_id === id)} winner={winner} best={best} />
                    </div>
                  ))}
                </div>
              )
            })}
            {visible.length > shown.length ? <button type="button" onClick={() => setShowAll(true)} className="w-full p-4 text-center text-[14px] font-medium text-[var(--color-text-link)] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-border-primary)]">عرض {visible.length - shown.length} بند إضافي</button> : null}
          </div>

          <aside aria-label="التوصية" className="flex w-[300px] shrink-0 flex-col items-start gap-4 rounded-[var(--radius-xl)] border-[1.5px] border-[var(--color-border-success)] bg-[var(--color-bg-surface)] p-6 text-start">
            {recommendation}
            <Button variant="Primary" size="L" icon="check" fullWidth disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => bestOffer && setAwarding(bestOffer)}>
              {bestSingle ? `رسِّ على ${nameOf(bestSingle.supplier_id)}` : 'ترسية'}
            </Button>
            {blocked ? <p className="w-full text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{blocked}</p> : null}
            {basket && basket.suppliers > 1 ? <p className="w-full text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">الترسية هنا على مورد واحد؛ التوزيعة على عدة موردين تحتاج ترسية لكل مورد على حدة.</p> : null}
          </aside>
        </div>
      </div>

      {awardDialog}
    </div>
  )
}

export default ComparisonV2
