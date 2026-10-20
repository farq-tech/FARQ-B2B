import { useEffect, useState } from 'react'
import { getConstructionReports, type ConstructionReports } from '../../api/constructionClient'

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

/**
 * Company-recorded commercial outcomes, deliberately separate from map clicks.
 * It lets the owner see whether discovery is reaching quotes, awards, and savings.
 */
export function CommercialImpact() {
  const [state, setState] = useState<State>({ state: 'loading' })

  useEffect(() => {
    let active = true
    getConstructionReports({ days: 90 })
      .then((report) => { if (active) setState({ state: 'ready', report }) })
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
  const savingsNote = report.savings.note?.trim()

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
      {priorities.length ? <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-bg-warning)] px-3 py-2" role="status"><p className="m-0 text-[13px] font-medium">أولوية اليوم</p><ul className="m-1 mt-2 list-disc space-y-1 pr-4 text-[13px] text-[var(--color-text-secondary)]">{priorities.map((priority) => <li key={priority}>{priority}</li>)}</ul></div> : null}
      {savingsNote ? <p className="mb-0 mt-3 text-[12px] text-[var(--color-text-secondary)]">طريقة القياس: {savingsNote}</p> : null}
    </section>
  )
}
