import { useEffect, useState } from 'react'
import { getConstructionReportLines, getConstructionReports, type ConstructionReportLine, type ConstructionReports } from '../../api/constructionClient'
import { Button } from '../../ui'

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })

const finite = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const pct = (value: unknown) => {
  if (value == null || value === '') return '—'
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? `${percent.format(parsed)}%` : '—'
}

type State =
  | { state: 'loading' }
  | { state: 'ready'; report: ConstructionReports }
  | { state: 'unavailable' }
type PriorityLines =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; lines: ConstructionReportLine[] }
  | { state: 'unavailable' }

type Props = { onOpenRfq?: (rfqId: string) => void }

// The reports endpoint may be temporarily behind the web deployment. Treat an
// incomplete 200 response as unavailable instead of letting one optional card
// stop the unified requests page from rendering.
const isReport = (value: unknown): value is ConstructionReports => {
  if (!value || typeof value !== 'object') return false
  const report = value as Partial<ConstructionReports>
  return Boolean(
    report.totals && typeof report.totals.projects === 'number'
    && report.savings && typeof report.savings.realized === 'number'
    && report.attention && typeof report.attention.lines_no_offer_48h === 'number',
  )
}

/**
 * Company-recorded commercial outcomes, deliberately separate from map clicks.
 * It lets the owner see whether discovery is reaching quotes, awards, and savings.
 */
export function CommercialImpact({ onOpenRfq }: Props) {
  const [state, setState] = useState<State>({ state: 'loading' })
  const [priorityLines, setPriorityLines] = useState<PriorityLines>({ state: 'idle' })

  useEffect(() => {
    let active = true
    getConstructionReports({ days: 90 })
      .then((report) => { if (active) setState(isReport(report) ? { state: 'ready', report } : { state: 'unavailable' }) })
      .catch(() => { if (active) setState({ state: 'unavailable' }) })
    return () => { active = false }
  }, [])

  if (state.state === 'loading') {
    return <section aria-label="أثر أعمالك" className="rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4"><div className="h-5 w-32 animate-pulse rounded bg-[var(--color-bg-surface-2)]" /></section>
  }
  if (state.state === 'unavailable') return null

  const { report } = state
  const realized = finite(report.savings.realized)
  const potential = finite(report.savings.potential)
  const attention = report.attention
  const hasActivity = report.totals.projects > 0 || report.totals.invited > 0
  if (!hasActivity) return null

  const cards = [
    { label: 'وفورات محققة', value: realized > 0 ? money.format(realized) : '—', detail: realized > 0 ? `${number.format(report.savings.awarded_projects)} ترسية مسجلة` : 'بعد تسجيل الترسية' },
    { label: 'فرق أسعار مرصود', value: potential > 0 ? money.format(potential) : '—', detail: report.savings.potential_percent != null ? `${pct(report.savings.potential_percent)} من أساس المقارنة` : 'يتحدث مع العروض' },
    { label: 'تغطية البنود', value: pct(report.totals.coverage_percent), detail: `${number.format(report.totals.priced_lines)} بند مسعّر` },
    { label: 'معدل العروض', value: pct(report.totals.quote_rate), detail: `${number.format(report.totals.quoted)} عرض من الموردين` },
  ]

  const priorities = [
    attention.lines_no_offer_48h > 0 ? `${number.format(attention.lines_no_offer_48h)} بنود بلا عرض لأكثر من 48 ساعة` : null,
    attention.lines_single_offer > 0 ? `${number.format(attention.lines_single_offer)} بنود لها عرض واحد فقط` : null,
    attention.rfqs_closing_today > 0 ? `${number.format(attention.rfqs_closing_today)} طلبات يغلق استقبال عروضها اليوم` : null,
    attention.suppliers_silent > 0 ? `${number.format(attention.suppliers_silent)} جهات لم ترد بعد` : null,
  ].filter((priority): priority is string => Boolean(priority))
  const canReviewLines = attention.lines_no_offer_48h > 0 || attention.lines_single_offer > 0
  const savingsNote = report.savings.note?.trim()

  const loadPriorityLines = async () => {
    setPriorityLines({ state: 'loading' })
    try {
      const groups = await Promise.all([
        attention.lines_no_offer_48h > 0 ? getConstructionReportLines('no_offer') : Promise.resolve({ lines: [] as ConstructionReportLine[] }),
        attention.lines_single_offer > 0 ? getConstructionReportLines('single_offer') : Promise.resolve({ lines: [] as ConstructionReportLine[] }),
      ])
      const seen = new Set<string>()
      const lines = groups.flatMap((group) => group.lines || []).filter((line) => {
        const key = `${line.rfq_id}:${line.line_id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, 6)
      setPriorityLines({ state: 'ready', lines })
    } catch {
      setPriorityLines({ state: 'unavailable' })
    }
  }

  return (
    <section aria-labelledby="commercial-impact-title" className="rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="commercial-impact-title" className="m-0 text-[17px] font-semibold">أثر أعمالك</h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">آخر 90 يومًا · من الطلبات والعروض والترسيات المسجلة</p>
        </div>
        <span className="rounded-full bg-[var(--color-bg-primary-subtle)] px-2.5 py-1 text-[12px] text-[var(--color-text-primary)]">بيانات منشأتك</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="min-w-0 rounded-[var(--radius-md)] bg-[var(--color-bg-canvas)] p-3">
            <p className="m-0 text-[12px] text-[var(--color-text-secondary)]">{card.label}</p>
            <p className="mt-1 truncate text-[18px] font-semibold" dir="ltr">{card.value}</p>
            <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-secondary)]">{card.detail}</p>
          </div>
        ))}
      </div>
      {priorities.length ? <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-bg-warning)] px-3 py-2" aria-live="polite"><p className="m-0 text-[13px] font-medium">أولوية اليوم</p><ul className="m-1 mt-2 list-disc space-y-1 pr-4 text-[13px] text-[var(--color-text-secondary)]">{priorities.map((priority) => <li key={priority}>{priority}</li>)}</ul>
        {canReviewLines && priorityLines.state === 'idle' ? <Button variant="Ghost" size="S" onClick={() => void loadPriorityLines()}>راجع البنود ذات الأولوية</Button> : null}
        {priorityLines.state === 'loading' ? <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">نجهّز البنود التي تحتاج متابعة…</p> : null}
        {priorityLines.state === 'unavailable' ? <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">تعذّر جلب البنود الآن. افتح الطلبات لمتابعتها.</p> : null}
        {priorityLines.state === 'ready' && priorityLines.lines.length ? <ul className="mt-2 divide-y divide-[var(--color-border-default)] rounded-[var(--radius-sm)] bg-[var(--color-bg-surface)] px-2">{priorityLines.lines.map((line) => <li key={`${line.rfq_id}:${line.line_id}`} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 truncate text-[12px] text-[var(--color-text-primary)]">{line.item_name || 'بند تسعير'}</span>{onOpenRfq ? <button type="button" onClick={() => onOpenRfq(line.rfq_id)} className="shrink-0 text-[12px] font-medium text-[var(--color-text-link)] underline">افتح الطلب</button> : null}</li>)}</ul> : null}
        {priorityLines.state === 'ready' && !priorityLines.lines.length ? <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">لا توجد بنود مفتوحة تحتاج متابعة الآن.</p> : null}
      </div> : null}
      {savingsNote ? <p className="mb-0 mt-3 text-[12px] text-[var(--color-text-secondary)]">طريقة القياس: {savingsNote}</p> : null}
    </section>
  )
}
