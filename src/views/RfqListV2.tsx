import { useEffect, useState } from 'react'
import type { NavProps } from '../types'
import { useProcurement } from '../procurementContext'
import { listBuyerRfqs, formatRfqTitle, type ConstructionRfqSummary } from '../api/constructionClient'
import { listOpportunityRequests, type OpportunityRequest } from '../api/opportunityRequestsClient'
import { rfqProjectName } from '../lib/rfqIdentity'
import { farqSession } from '../api/farqSession'
import { Button, Greeting, Icon, ListRow, ListSection, type BadgeTone, type IconName } from '../ui'
import { gregorianLabel } from '../lib/saudi'
import { CommercialImpact } from '../components/procurement/CommercialImpact'

/*
 * Figma M02 `18371:22940` / W02 `18371:288`: requests grouped by what the owner has to do next
 * («يحتاج قرارك · قيد الإرسال · بانتظار العروض · منتهية · مسودات»), one Row Entity Badge per request.
 * Empty M02 `18402:2300` (three ways in + «طلب جديد»), loading = skeleton rows `18402:2397`.
 */
type Group = 'decide' | 'sending' | 'waiting' | 'done' | 'draft'
const GROUPS: { key: Group; title: string }[] = [
  { key: 'decide', title: 'يحتاج قرارك' },
  { key: 'sending', title: 'قيد الإرسال' },
  { key: 'waiting', title: 'بانتظار الردود' },
  { key: 'done', title: 'منتهية' },
  { key: 'draft', title: 'مسودات' },
]

/** Saudi-local Gregorian date only. */
const day = (iso?: string | null) => {
  if (!iso) return null
  const label = gregorianLabel(iso)
  return label || null
}
const n = (v: number | null | undefined) => <bdi dir="ltr">{v ?? 0}</bdi>
const isDraft = (r: OpportunityRequest) => r.payload?.filters?.draft === true
const draftCount = (r: OpportunityRequest) => { const value = r.payload?.filters?.recipientCount; return typeof value === 'number' && Number.isFinite(value) ? value : null }
const marketCaption = (r: OpportunityRequest) => [isDraft(r) ? 'حملة واتساب محفوظة' : 'طلب سوق', draftCount(r) != null ? `${draftCount(r)!.toLocaleString('en-US')} جهة` : null, r.payload?.city].filter(Boolean).join(' · ')

function classify(r: ConstructionRfqSummary): { group: Group; tone: BadgeTone; label: string } {
  if (r.award_status === 'APPROVED') return { group: 'done', tone: 'Success', label: 'تمت الترسية' }
  switch (r.status) {
    case 'DRAFT_NOT_SENT': return { group: 'draft', tone: 'Info', label: 'مسودة' }
    case 'PARTIALLY_SENT': return { group: 'sending', tone: 'Warning', label: 'أُرسل جزئياً' }
    case 'CANCELLED': return { group: 'done', tone: 'Danger', label: 'ملغي' }
    case 'SENT': return r.response_count > 0 ? { group: 'decide', tone: 'Warning', label: 'عرض جديد · قرّر' } : { group: 'waiting', tone: 'Info', label: 'يستقبل العروض' }
    case 'CLOSED': return r.response_count > 0 ? { group: 'decide', tone: 'Warning', label: 'أُغلق · قرّر' } : { group: 'done', tone: 'Neutral', label: 'أُغلق الاستلام' }
    default: return { group: 'waiting', tone: 'Neutral', label: 'قيد المتابعة' }
  }
}

function caption(r: ConstructionRfqSummary, group: Group) {
  const date = day(r.created_at)
  const deadline = day(r.quote_deadline)
  const offers = <>{n(r.response_count)} عروض من {n(r.supplier_count)}</>
  if (r.status === 'PARTIALLY_SENT') return <>أُرسل لـ {n(r.sent_count)} من {n(r.supplier_count)} جهة · كمّل الإرسال</>
  if (group === 'draft') return <>{n(r.line_count)} بنود · لم يُرسل{date ? <> · {date}</> : null}</>
  if (group === 'waiting') return <>{offers}{deadline ? <> · آخر موعد {deadline}</> : null}</>
  if (group === 'done') return <>{r.award_status === 'APPROVED' ? 'تمت الترسية · ' : ''}{n(r.response_count)} عروض{date ? <> · {date}</> : null}</>
  return <>{offers} · {n(r.line_count)} بنداً{date ? <> · {date}</> : null}</>
}

const WAYS: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'file', title: 'ارفع الكراسة', detail: 'PDF أو Excel' },
  { icon: 'list', title: 'اكتب الطلبات', detail: 'سطر لكل بند' },
  { icon: 'camera', title: 'صوّرها', detail: 'كراسة ورقية أو قطعة' },
]

function Empty({ onNew }: { onNew: () => void }) {
  return (
    <section className="mx-auto flex w-full max-w-[420px] flex-col items-center gap-6 py-8 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold">ابدأ أول طلب تسعير</h2>
        <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">ارفع الكراسة أو اكتب البنود، ونرسلها لموردين مناسبين. ما يطلع شي قبل ما تراجع.</p>
      </div>
      <ul className="flex w-full flex-col">
        {WAYS.map((w) => (
          <li key={w.title}>
            <button type="button" onClick={onNew} className="flex min-h-16 w-full items-center gap-4 rounded-[var(--radius-md)] px-4 py-3 text-start hover:bg-[var(--color-bg-primary-subtle)]">
              <Icon name={w.icon} size={24} className="text-[var(--color-text-primary)]" />
              <span className="flex flex-col">
                <span className="text-[16px] leading-[26px] font-medium">{w.title}</span>
                <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{w.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="Primary" size="L" fullWidth onClick={onNew}>طلب جديد</Button>
    </section>
  )
}

function Skeleton() {
  return (
    <div role="status" aria-label="جارٍ تحميل الطلبات" className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex min-h-16 items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] px-6 py-3">
          <span className="flex flex-1 flex-col gap-2"><span className="h-4 w-1/2 animate-pulse rounded bg-[var(--color-bg-surface-2)]" /><span className="h-3 w-2/3 animate-pulse rounded bg-[var(--color-bg-surface-2)]" /></span>
          <span className="h-7 w-24 animate-pulse rounded-full bg-[var(--color-bg-surface-2)]" />
        </div>
      ))}
    </div>
  )
}

export function RfqListV2({ navigate }: NavProps) {
  const { setSelectedRfqId, navigate: go } = useProcurement()
  const [rows, setRows] = useState<ConstructionRfqSummary[] | null>(null)
  const [marketRows, setMarketRows] = useState<OpportunityRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setError(null)
    listBuyerRfqs().then((o) => { if (active) setRows(o.rfqs || []) }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'تعذر تحميل الطلبات') })
    listOpportunityRequests('active').then((items) => { if (active) setMarketRows(items) }).catch(() => { if (active) setMarketRows([]) })
    return () => { active = false }
  }, [reload])
  const titleOf = (r: ConstructionRfqSummary) => rfqProjectName({ delivery: r.delivery }) || formatRfqTitle(r)
  const q = query.trim().toLocaleLowerCase('ar')
  const shown = (rows || []).filter((r) => titleOf(r).toLocaleLowerCase('ar').includes(q))
  const shownMarket = (marketRows || []).filter((r) => r.title.toLocaleLowerCase('ar').includes(q))
  const rfqDrafts = shown.map((r) => ({ r, c: classify(r) })).filter((x) => x.c.group === 'draft')
  const marketingDrafts = shownMarket.filter(isDraft)
  const marketRequests = shownMarket.filter((r) => !isDraft(r))
  const grouped = GROUPS.filter((g) => g.key !== 'draft').map((g) => ({ ...g, rows: shown.map((r) => ({ r, c: classify(r) })).filter((x) => x.c.group === g.key) })).filter((g) => g.rows.length)
  const decide = grouped.find((g) => g.key === 'decide')?.rows.length ?? 0
  const total = (rows?.length || 0) + (marketRows?.length || 0)
  const open = (id: string) => { setSelectedRfqId(id); navigate('rfq-detail') }
  const onNew = () => navigate('create-upload')
  const openMarketDraft = (id: string) => { window.location.assign(`/opportunity-map#draft=${encodeURIComponent(id)}`) }
  const openMarketReview = (id: string) => { window.location.assign(`/opportunity-map#review=${encodeURIComponent(id)}`) }
  // «صباح الخير، سارة» — only a real display name, never the e-mail.
  const firstName = (farqSession.getUser()?.displayName || '').trim().split(/\s+/)[0] || null
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Greeting name={firstName} className="text-[13px] leading-[20px]" />
          <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold sm:text-[28px] sm:leading-[44px]">الطلبات</h1>
          {rows && marketRows && total ? <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{n(total)} طلبات{decide ? <> · {n(decide)} تحتاج قرارك</> : null} · تسعير وسوق ومسودات في مكان واحد</p> : null}
        </div>
        {rows && marketRows && total ? <Button variant="Primary" size="M" onClick={onNew}>طلب جديد</Button> : null}
      </header>
      <CommercialImpact onOpenRfq={(id) => { setSelectedRfqId(id); navigate('rfq-detail') }} />
      {rows && marketRows && total > 3 ? (
        <div><label htmlFor="request-search" className="sr-only">ابحث عن طلب</label><input id="request-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم الطلب" className="min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3" /></div>
      ) : null}
      {error ? <div role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-4 py-3 text-[var(--color-text-danger)]"><p>ما قدرنا نجيب طلباتك الحين. {error}</p><button type="button" onClick={() => setReload((x) => x + 1)} className="mt-2 min-h-11 underline">حاول مرة ثانية</button></div> : null}
      {(!rows || !marketRows) && !error ? <Skeleton /> : null}
      {rows && marketRows && total === 0 ? <Empty onNew={onNew} /> : null}
      {grouped.map((g) => (
        <ListSection key={g.key} title={g.title} count={g.rows.length}>
          {g.rows.map(({ r, c }) => <ListRow key={r.id} title={titleOf(r)} caption={caption(r, c.group)} status={{ tone: c.tone, label: c.label }} onClick={() => open(r.id)} />)}
        </ListSection>
      ))}
      {(rfqDrafts.length || marketingDrafts.length) ? <ListSection title="مسودات" count={rfqDrafts.length + marketingDrafts.length}>
        {rfqDrafts.map(({ r, c }) => <ListRow key={r.id} title={titleOf(r)} caption={caption(r, c.group)} status={{ tone: c.tone, label: c.label }} onClick={() => open(r.id)} />)}
        {marketingDrafts.map((r) => <ListRow key={`market-${r.id}`} title={r.title} caption={marketCaption(r)} status={{ tone: 'Info', label: 'مسودة' }} onClick={() => openMarketDraft(r.id)} />)}
      </ListSection> : null}
      {marketRequests.length ? <ListSection title="طلبات السوق" count={marketRequests.length}>
        {marketRequests.map((r) => <ListRow key={`market-${r.id}`} title={r.title} caption={marketCaption(r)} status={{ tone: 'Neutral', label: 'قيد المتابعة' }} onClick={() => openMarketReview(r.id)} />)}
      </ListSection> : null}
      {rows && marketRows && total > 0 && shown.length + shownMarket.length === 0 ? <div className="flex flex-col items-start gap-2"><p>ما لقينا طلب بهذا الاسم.</p><button type="button" onClick={() => setQuery('')} className="min-h-11 text-[var(--color-text-link)] underline">امسح البحث</button></div> : null}
      {rows ? <p className="text-[14px] text-[var(--color-text-secondary)]">تدوّر على موردين أو مشترين بدون طلب؟ <button type="button" onClick={() => go('targeting')} className="min-h-11 text-[var(--color-text-link)] underline">افتح خريطة الفرص</button></p> : null}
    </div>
  )
}
