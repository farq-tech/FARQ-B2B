import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { CELL_LABEL, cheapestPerLineTotal, lowestPerLine, matrixTotals, quoteCoverage } from '../lib/requestFile'
import { rfqProjectName } from '../lib/rfqIdentity'
import { awardBlockReason, type AwardOffer } from '../lib/awardFlow'
import AwardDialog from '../components/procurement/AwardDialog'
import iconBest from '../assets/pricing-v2/best.svg'
import iconNotComparable from '../assets/pricing-v2/not-comparable.svg'
import iconChipCheck from '../assets/pricing-v2/chip-check.svg'
import iconAward from '../assets/pricing-v2/award.svg'
import iconExport from '../assets/pricing-v2/export.svg'
import iconInfo from '../assets/pricing-v2/info.svg'
import iconAwardCheck from '../assets/pricing-v2/award-check.svg'
import iconChevron from '../assets/pricing-v2/chevron.svg'

/*
 * «04 · وش الفرق؟» — the Figma comparison screen on the real quote matrix.
 * Every number comes from recorded offers: the per-line winner follows
 * lowestPerLine (one tax basis, one currency, no ties), the totals follow
 * matrixTotals, and the split basket follows cheapestPerLineTotal.
 */

type Matrix = NonNullable<ConstructionComparison['quote_matrix']>
type Line = Matrix['lines'][number]
type Cell = Line['offers'][number]
type Filter = 'all' | 'big' | 'incomparable' | 'none'
type CellState = 'best' | 'normal' | 'higher' | 'incomparable' | 'pending'

const BIG_DIFF = 0.1

function money(n?: number | null, currency = 'SAR'): string {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'SAR' ? 'ر.س' : currency}`
}

function cellState(cell: Cell | undefined, winner: string | null, best: number | null): { state: CellState; delta: string } {
  if (!cell || cell.status === 'NOT_QUOTED') return { state: 'pending', delta: 'بانتظار الرد' }
  if (cell.status === 'UNAVAILABLE') return { state: 'pending', delta: 'ما عنده البند' }
  if (cell.status === 'NOT_REQUESTED') return { state: 'pending', delta: 'لم يُطلب منه' }
  if (cell.status !== 'PRICED' || cell.line_total == null) return { state: 'incomparable', delta: CELL_LABEL[cell.status] || 'غير قابل للمقارنة' }
  if (!winner || best == null) return { state: 'incomparable', delta: 'لا تُقارن: ضريبة أو عملة مختلفة' }
  if (cell.supplier_id === winner) return { state: 'best', delta: 'الأقل سعرًا' }
  const diff = Number(cell.line_total) - best
  const pct = best > 0 ? diff / best : 0
  return { state: pct >= BIG_DIFF ? 'higher' : 'normal', delta: `+${money(diff, cell.currency)} (${(pct * 100).toFixed(1)}%)` }
}

function PriceCell({ cell, winner, best }: { cell: Cell | undefined; winner: string | null; best: number | null }) {
  const { state, delta } = cellState(cell, winner, best)
  const box = state === 'best' ? { background: 'var(--color-bg-success)', borderColor: 'var(--color-border-success)' } : state === 'incomparable' ? { background: 'var(--color-bg-surface-2)', borderColor: 'var(--color-border-default)' } : { background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }
  const price = cell && cell.line_total != null ? money(cell.line_total, cell.currency) : null
  return (
    <div className="flex w-[176px] flex-col items-end gap-1 rounded-[12px] border px-4 py-3 text-right" style={box}>
      {state === 'pending' ? (
        <>
          <p className="text-[14px] leading-[22px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>{delta}</p>
          <p className="text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>—</p>
        </>
      ) : (
        <>
          <p className="font-[Readex_Pro] text-[16px] leading-[24px] font-semibold tabular-nums" style={{ color: state === 'incomparable' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)' }}>{price}</p>
          <div className="flex w-full items-center justify-end gap-1">
            {state === 'best' ? <img src={iconBest} alt="" width={14} height={14} /> : state === 'incomparable' ? <img src={iconNotComparable} alt="" width={14} height={14} /> : null}
            <p className="min-w-0 flex-1 text-[12px] leading-[18px] font-medium" style={{ color: state === 'best' ? 'var(--color-text-success)' : state === 'higher' ? 'var(--color-text-danger)' : state === 'normal' ? 'var(--color-text-warning)' : 'var(--color-text-secondary)' }}>{delta}</p>
          </div>
        </>
      )}
    </div>
  )
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-full border px-4 py-2 text-[14px] leading-[22px] font-medium" style={selected ? { background: 'var(--color-bg-info)', borderColor: 'var(--color-border-primary)', color: 'var(--color-text-link)' } : { background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}>
      {label}
      {selected ? <img src={iconChipCheck} alt="" width={16} height={16} /> : null}
    </button>
  )
}

export function ComparisonV2({ navigate }: NavProps) {
  const { selectedRfqId } = useProcurement()
  const [rfq, setRfq] = useState<ConstructionRfq | null>(null)
  const [comparison, setComparison] = useState<ConstructionComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [showAll, setShowAll] = useState(false)
  const [awarding, setAwarding] = useState<AwardOffer | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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
  const blocked = bestOffer ? awardBlockReason(rfq, bestOffer) : 'لا يوجد مورد سعّر كل البنود بعد'

  return (
    <div className="pricing-v2 min-h-full" style={{ background: 'var(--color-bg-canvas)', fontFamily: "'Tajawal', 'Cairo', system-ui, sans-serif", color: 'var(--color-text-primary)' }}>
      <div className="flex h-[72px] items-center justify-between border-b bg-white px-8" style={{ borderColor: 'var(--color-border-default)' }}>
        <div />
        <div className="flex items-center gap-2">
          <p className="text-[16px] leading-[26px] font-medium">وش الفرق؟</p>
          <img src={iconChevron} alt="" width={16} height={16} />
          <button type="button" onClick={() => navigate('rfq-detail')} className="text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>{title}</button>
        </div>
      </div>

      <div className="flex flex-col gap-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => bestOffer && setAwarding(bestOffer)} className="flex h-12 items-center gap-2 rounded-[12px] px-6 text-[16px] font-medium text-white disabled:opacity-40" style={{ background: 'var(--color-bg-cta)' }}>ترسية <img src={iconAward} alt="" width={20} height={20} /></button>
            <button type="button" onClick={exportCsv} className="flex h-12 items-center gap-2 rounded-[12px] border bg-white px-6 text-[16px] font-medium" style={{ borderColor: 'var(--color-border-strong)' }}>تصدير <img src={iconExport} alt="" width={20} height={20} /></button>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <h1 className="font-[Readex_Pro] text-[32px] leading-[48px] font-bold">وش الفرق؟</h1>
            <p className="text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>{responses.length} عرض من {supplierIds.length} موردين · {pricedLines} من {lines.length} بند وصلها سعر</p>
          </div>
        </div>

        {notice ? <p className="rounded-[12px] px-4 py-3 text-right text-[14px]" style={{ background: 'var(--color-bg-success)', color: 'var(--color-text-success)' }}>{notice}</p> : null}

        <div className="flex items-start justify-end gap-6 rounded-[24px] px-8 py-7 text-right" style={{ background: 'var(--color-bg-cta)' }}>
          <div className="flex flex-col items-end gap-1 rounded-[16px] px-5 py-4" style={{ background: 'var(--color-bg-brand)', color: 'var(--color-text-on-brand)' }}>
            <p className="text-[14px] leading-[22px] font-medium">الوفر</p>
            <p className="font-[Readex_Pro] text-[28px] leading-[40px] font-semibold tabular-nums">{savingVsHighest != null ? money(savingVsHighest, currency) : '—'}</p>
            <p className="text-[12px] leading-[18px] font-medium">{savingPct != null ? `${savingPct.toFixed(1)}% أقل من أعلى عرض` : 'يُحسب عند اكتمال عرضين على الأقل'}</p>
          </div>
          {[
            { label: 'أعلى عرض', value: highest ? money(highest.total, highest.currency) : '—', basis: highest ? `${nameOf(highest.supplier_id)} · على كل البنود` : 'لا يوجد عرض كامل بعد', mint: false },
            { label: 'أوفر مورد واحد', value: bestSingle ? money(bestSingle.total, bestSingle.currency) : '—', basis: bestSingle ? `${nameOf(bestSingle.supplier_id)} · ${bestSingle.priced} بند` : lowest === null && complete.length >= 2 ? 'العروض الكاملة لا تُقارن (ضريبة/عملة مختلفة)' : 'لا يوجد مورد سعّر كل البنود', mint: false },
            { label: 'أوفر توزيعة', value: basket ? money(basket.total, basket.currency) : '—', basis: basket ? `${basket.suppliers} موردين · ${basket.covered} من ${basket.requested} بند` : 'لا يوجد بند له أوفر مورد مؤكد', mint: true },
          ].map((s) => (
            <div key={s.label} className="flex min-w-0 flex-1 flex-col items-end gap-1">
              <p className="text-[14px] leading-[22px] font-medium" style={{ color: 'var(--color-text-on-inverse-secondary)' }}>{s.label}</p>
              <p className="font-[Readex_Pro] text-[28px] leading-[40px] font-semibold tabular-nums" style={{ color: s.mint ? 'var(--color-bg-brand)' : 'var(--color-text-on-inverse)' }}>{s.value}</p>
              <p className="text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-on-inverse-secondary)' }}>{s.basis}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <img src={iconInfo} alt="" width={16} height={16} />
          <p className="text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>الأرقام هنا إجمالي البنود المسعّرة كما وردت من المورد ({matrix?.basis === 'INCLUSIVE' ? 'شاملة الضريبة' : 'حسب ما ذكره كل مورد'})؛ التوصيل والضريبة النهائية في بطاقة كل عرض. الفرق محسوب مقابل أوفر عرض قابل للمقارنة لنفس البند.</p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Chip label={`ما وصلها عرض ${counts.none}`} selected={filter === 'none'} onClick={() => { setFilter('none'); setShowAll(false) }} />
          <Chip label={`غير قابلة للمقارنة ${counts.incomparable}`} selected={filter === 'incomparable'} onClick={() => { setFilter('incomparable'); setShowAll(false) }} />
          <Chip label={`فيها فرق كبير ${counts.big}`} selected={filter === 'big'} onClick={() => { setFilter('big'); setShowAll(false) }} />
          <Chip label={`كل البنود ${counts.all}`} selected={filter === 'all'} onClick={() => { setFilter('all'); setShowAll(false) }} />
        </div>

        <div className="flex items-start justify-end gap-6">
          <div className="flex w-[300px] shrink-0 flex-col items-end gap-4 rounded-[24px] bg-white p-6 text-right" style={{ border: '1.5px solid var(--color-border-success)' }}>
            <span className="rounded-full px-2.5 py-1 text-[14px] font-medium" style={{ background: 'var(--color-bg-success)', color: 'var(--color-text-success)' }}>التوصية</span>
            {basket && basket.suppliers > 1 ? (
              <>
                <p className="font-[Readex_Pro] text-[20px] leading-[30px] font-semibold">وزّع على {basket.suppliers} موردين</p>
                <p className="w-full text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>كل بند يروح لأوفر مورد سعّره على نفس الأساس. {basket.covered < basket.requested ? `${basket.requested - basket.covered} بند بلا أوفر مؤكد.` : ''}</p>
                {basketLines.map(([id, n]) => (
                  <div key={id} className="flex w-full items-center justify-between">
                    <p className="font-[Readex_Pro] text-[16px] leading-[24px] font-semibold">{n} {n === 1 ? 'بند' : n === 2 ? 'بندان' : n <= 10 ? 'بنود' : 'بند'}</p>
                    <p className="text-[14px] leading-[22px] font-medium">{nameOf(id)}</p>
                  </div>
                ))}
                <span className="h-px w-full" style={{ background: 'var(--color-border-default)' }} />
                <p className="w-full text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{basket.bestSingle && basket.saving != null ? `البديل الأبسط: مورد واحد (${nameOf(basket.bestSingle.supplier_id)}) بزيادة ${money(basket.saving, basket.currency)}.` : 'لا يوجد مورد واحد سعّر كل البنود حتى الآن.'}</p>
              </>
            ) : bestSingle ? (
              <>
                <p className="font-[Readex_Pro] text-[20px] leading-[30px] font-semibold">مورد واحد يكفي</p>
                <p className="w-full text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>{nameOf(bestSingle.supplier_id)} هو الأوفر على كل البنود المسعّرة.</p>
              </>
            ) : (
              <>
                <p className="font-[Readex_Pro] text-[20px] leading-[30px] font-semibold">بانتظار عروض أكثر</p>
                <p className="w-full text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>تظهر التوصية عندما يصل عرضان قابلان للمقارنة على نفس البند.</p>
              </>
            )}
            <button type="button" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => bestOffer && setAwarding(bestOffer)} className="flex h-12 w-full items-center justify-center gap-2 rounded-[12px] text-[16px] font-medium text-white disabled:opacity-40" style={{ background: 'var(--color-bg-cta)' }}>
              {bestSingle ? `رسِّ على ${nameOf(bestSingle.supplier_id)}` : 'ترسية'} <img src={iconAwardCheck} alt="" width={20} height={20} />
            </button>
            {basket && basket.suppliers > 1 ? <p className="w-full text-[12px] leading-[18px]" style={{ color: 'var(--color-text-tertiary)' }}>الترسية هنا على مورد واحد؛ التوزيعة على عدة موردين تحتاج ترسية لكل مورد على حدة.</p> : null}
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-end overflow-x-auto rounded-[24px] border bg-white" style={{ borderColor: 'var(--color-border-default)' }}>
            <div className="flex w-full min-w-max items-center justify-end" style={{ background: 'var(--color-bg-surface-2)' }}>
              {[...supplierIds].reverse().map((id) => {
                const cov = quoteCoverage(summaryBySupplier.get(id), lines.length)
                return (
                  <div key={id} className="flex h-16 w-[196px] shrink-0 flex-col items-end justify-center gap-0.5 p-3 text-right">
                    <p className="truncate text-[14px] leading-[22px] font-medium">{nameOf(id)}</p>
                    <p className="text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>{channelOf(id)} · {cov ? `${cov.priced} بند` : '—'}</p>
                  </div>
                )
              })}
              <div className="flex h-16 w-[200px] shrink-0 items-center justify-end p-3"><p className="text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>البند</p></div>
            </div>
            {shown.length === 0 ? <p className="w-full p-6 text-right text-[14px]" style={{ color: 'var(--color-text-secondary)' }}>لا يوجد بنود في هذا التصنيف.</p> : null}
            {shown.map((line) => {
              const winner = winners.get(line.id) || null
              const best = bestOfLine(line)
              return (
                <div key={line.id} className="flex w-full min-w-max items-center justify-end border-t" style={{ borderColor: 'var(--color-border-default)' }}>
                  {[...supplierIds].reverse().map((id) => (
                    <div key={id} className="flex h-24 w-[196px] shrink-0 items-center justify-end p-3">
                      <PriceCell cell={(line.offers || []).find((c) => c && c.supplier_id === id)} winner={winner} best={best} />
                    </div>
                  ))}
                  <div className="flex h-24 w-[200px] shrink-0 flex-col items-end justify-center gap-0.5 p-3 text-right">
                    <p className="truncate text-[16px] leading-[26px] font-medium" title={line.name_ar}>{line.name_ar}</p>
                    <p className="text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{line.quantity} {line.uom}</p>
                  </div>
                </div>
              )
            })}
            {visible.length > shown.length ? <button type="button" onClick={() => setShowAll(true)} className="w-full p-4 text-center text-[14px] font-medium" style={{ color: 'var(--color-text-link)' }}>عرض {visible.length - shown.length} بند إضافي</button> : null}
          </div>
        </div>
      </div>

      {awarding ? (
        <AwardDialog rfq={rfq} comparison={comparison} offer={awarding} coverage={quoteCoverage(summaryBySupplier.get(String(awarding.supplier.id)), lines.length)} onClose={() => setAwarding(null)}
          onDone={async () => { setAwarding(null); setNotice(`تمت الترسية على ${awarding.supplier.name_ar || awarding.supplier.name_en}.`); await load(rfq.id).catch(() => {}) }} />
      ) : null}
    </div>
  )
}

export default ComparisonV2
