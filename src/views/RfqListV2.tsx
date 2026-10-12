import { useEffect, useState } from 'react'
import type { NavProps } from '../types'
import { useProcurement } from '../procurementContext'
import { listBuyerRfqs, formatRfqTitle, type ConstructionRfqSummary } from '../api/constructionClient'
import { rfqProjectName } from '../lib/rfqIdentity'

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  SENT: { label: 'يستقبل العروض', bg: 'var(--color-bg-success)', fg: 'var(--color-text-success)' },
  PARTIALLY_SENT: { label: 'أُرسل جزئيًا', bg: 'var(--color-bg-warning)', fg: 'var(--color-text-warning)' },
  DRAFT_NOT_SENT: { label: 'مسودة', bg: 'var(--color-bg-surface-2)', fg: 'var(--color-text-secondary)' },
  CLOSED: { label: 'أُغلق الاستلام', bg: 'var(--color-bg-surface-2)', fg: 'var(--color-text-secondary)' },
  AWARDED: { label: 'تمت الترسية', bg: 'var(--color-bg-info)', fg: 'var(--color-text-link)' },
  CANCELLED: { label: 'ملغي', bg: 'var(--color-bg-danger)', fg: 'var(--color-text-danger)' },
}

export function RfqListV2({ navigate }: NavProps) {
  const { setSelectedRfqId, navigate: navigateGoal } = useProcurement()
  const [rows, setRows] = useState<ConstructionRfqSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setError(null)
    listBuyerRfqs().then((o) => { if (active) setRows(o.rfqs || []) }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'تعذر تحميل الطلبات') })
    return () => { active = false }
  }, [reload])
  const status = (r: ConstructionRfqSummary) => r.award_status === 'APPROVED' ? 'AWARDED' : r.status
  const titleOf = (r: ConstructionRfqSummary) => rfqProjectName({ delivery: r.delivery }) || formatRfqTitle(r)
  const shown = (rows || []).filter((r) => (filter === 'all' || status(r) === filter) && titleOf(r).toLocaleLowerCase('ar').includes(query.trim().toLocaleLowerCase('ar')))
  const summaries = [
    { label: 'كل الطلبات', value: rows?.length },
    { label: 'يستقبل العروض', value: rows?.filter((r) => ['SENT', 'PARTIALLY_SENT'].includes(status(r))).length },
    { label: 'المسودات', value: rows?.filter((r) => status(r) === 'DRAFT_NOT_SENT').length },
    { label: 'عروض مستلمة', value: rows?.reduce((n, r) => n + r.response_count, 0) },
  ]
  const open = (id: string) => { setSelectedRfqId(id); navigate('rfq-detail') }
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-right">
          <h1 className="font-[Readex_Pro] text-[28px] leading-[44px] font-bold sm:text-[32px]">الأهداف والطلبات</h1>
          <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">ابحث عن بائعين لاحتياجك أو مشترين لما تقدمه، وتابع طلبات الشراء السابقة.</p>
        </div>
        <button type="button" onClick={() => navigate('create-upload')} className="rounded-[12px] bg-[var(--color-bg-cta)] px-5 py-3 font-medium text-white">طلب تسعير جديد</button>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => { sessionStorage.setItem('farq-target-direction', 'purchase'); navigateGoal('targeting') }} className="rounded-[12px] border border-[var(--color-border-default)] bg-white px-5 py-3">بائعون — أبي أشتري</button>
        <button type="button" onClick={() => { sessionStorage.setItem('farq-target-direction', 'marketing'); navigateGoal('targeting') }} className="rounded-[12px] border border-[var(--color-border-default)] bg-white px-5 py-3">مشترون — أبي أبيع</button>
      </div>
      <h2 className="text-[18px] font-medium">طلبات الشراء الحالية</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="ملخص الطلبات">
        {summaries.map((s) => <div key={s.label} className="rounded-[16px] border border-[var(--color-border-default)] bg-white p-4"><p className="text-[13px] text-[var(--color-text-secondary)]">{s.label}</p><p className="mt-2 text-[28px] font-semibold tabular-nums">{s.value ?? '—'}</p></div>)}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1"><label htmlFor="request-search" className="mb-1 block text-[13px]">ابحث عن طلب</label><input id="request-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم الطلب أو احتياجك" className="w-full rounded-[12px] border border-[var(--color-border-default)] bg-white px-4 py-3" /></div>
        <div><label htmlFor="request-status" className="mb-1 block text-[13px]">حالة الطلب</label><select id="request-status" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full rounded-[12px] border border-[var(--color-border-default)] bg-white px-4 py-3 sm:min-w-[180px]"><option value="all">كل الحالات</option>{Object.entries(STATUS).map(([key, st]) => <option key={key} value={key}>{st.label}</option>)}</select></div>
      </div>
      {error ? <div role="alert" className="rounded-[12px] bg-[var(--color-bg-danger)] px-4 py-3 text-[var(--color-text-danger)]"><p>{error}</p><button type="button" onClick={() => setReload((n) => n + 1)} className="mt-2 underline">إعادة المحاولة</button></div> : null}
      {!rows && !error ? <p role="status" className="text-[var(--color-text-secondary)]">جارٍ تحميل الطلبات…</p> : null}
      {rows ? <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">عرض {shown.length} من {rows.length} طلب</p> : null}
      <div className="flex flex-col overflow-hidden rounded-[24px] border bg-white" style={{ borderColor: 'var(--color-border-default)' }}>
        {shown.map((r) => {
          const st = STATUS[String(r.award_status === 'APPROVED' ? 'AWARDED' : r.status)] || { label: r.status, bg: 'var(--color-bg-surface-2)', fg: 'var(--color-text-secondary)' }
          const title = rfqProjectName({ delivery: r.delivery }) || formatRfqTitle(r)
          return (
            <button key={r.id} type="button" onClick={() => open(r.id)} className="flex w-full flex-wrap items-center gap-3 border-b px-4 py-4 text-right last:border-b-0 hover:bg-[var(--color-bg-canvas)] sm:px-5" style={{ borderColor: 'var(--color-border-default)' }}>
              <span className="rounded-full px-2.5 py-1 text-[14px] font-medium" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              <span className="order-3 w-full text-[13px] tabular-nums sm:order-none sm:w-auto" style={{ color: 'var(--color-text-secondary)' }}>{r.response_count} عرض · {r.supplier_count} مورد · {r.line_count} بند</span>
              <span className="min-w-[120px] flex-1 text-[16px] font-medium">{title}</span>
              <span className="text-[12px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{new Date(r.created_at).toLocaleDateString('ar-SA', { timeZone: 'Asia/Riyadh', calendar: 'gregory' })}</span>
            </button>
          )
        })}
        {rows && rows.length === 0 ? <p className="p-6 text-right" style={{ color: 'var(--color-text-secondary)' }}>ابدأ بأول طلب تسعير، ثم تابع عروض الموردين هنا.</p> : null}
        {rows && rows.length > 0 && shown.length === 0 ? <div className="p-6"><p>لا توجد طلبات تطابق البحث.</p><button type="button" onClick={() => { setQuery(''); setFilter('all') }} className="mt-3 text-[var(--color-text-link)] underline">مسح البحث والفلترة</button></div> : null}
      </div>
    </div>
  )
}
