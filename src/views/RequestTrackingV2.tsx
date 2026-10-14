import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NavProps } from '../types'
import { useProcurement } from '../procurementContext'
import {
  formatRfqTitle,
  getConstructionComparison,
  getConstructionRfq,
  getConstructionSupplierOutcomes,
  invitePreferredChannel,
  type ConstructionComparison,
  type ConstructionInvitation,
  type ConstructionRfq,
  type ConstructionSupplierOutcomeEvent,
} from '../api/constructionClient'
import { leadTimeLabel, requestProgress, requestState, supplierState } from '../lib/requestFile'
import { rfqProjectName } from '../lib/rfqIdentity'
import { Badge, Button, ListRow, Toast, TopBar, useIsMobile, type BadgeTone } from '../ui'

/*
 * «متابعة الطلب» — Figma B2B M03 `18371:23094` / W03 `18430:2880`: status card with the four-step bar,
 * the request line, one Row (Entity Badge) per supplier that needs a look, Total rows, «قارن العروض».
 * Wired to the real request: invitations, dispatch attempts, quotes and supplier outcomes.
 * Numbers are derived only from recorded data; nothing here is illustrative.
 */

type Tone = BadgeTone
const POLL_MS = 30_000

type Filter = 'quoted' | 'replied' | 'waiting' | 'declined' | 'attention'
const CHANNEL_AR: Record<string, string> = { WHATSAPP: 'واتساب', EMAIL: 'إيميل', HARAJ: 'حراج' }

export function RequestTrackingV2({ navigate }: NavProps) {
  const { selectedRfqId } = useProcurement()
  const [rfq, setRfq] = useState<ConstructionRfq | null>(null)
  const [comparison, setComparison] = useState<ConstructionComparison | null>(null)
  const [outcomes, setOutcomes] = useState<ConstructionSupplierOutcomeEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null)
  const [seenQuotes, setSeenQuotes] = useState<Set<string> | null>(null)
  const mobile = useIsMobile()

  const load = useCallback(async (id: string) => {
    try {
      const [r, c, o] = await Promise.all([
        getConstructionRfq(id),
        getConstructionComparison(id).catch(() => null),
        getConstructionSupplierOutcomes(id).catch(() => ({ events: [] as ConstructionSupplierOutcomeEvent[] })),
      ])
      setRfq(r); setComparison(c); setOutcomes(o.events || []); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل الطلب')
    }
  }, [])

  useEffect(() => {
    if (!selectedRfqId) return
    void load(selectedRfqId)
    const t = window.setInterval(() => void load(selectedRfqId), POLL_MS)
    return () => window.clearInterval(t)
  }, [selectedRfqId, load])

  const invites = useMemo(() => rfq?.invitations || [], [rfq])
  const offers = useMemo(() => [...(comparison?.supplier_responses || [])].sort((a, b) => Date.parse(String(b.offer.submittedAt || 0)) - Date.parse(String(a.offer.submittedAt || 0))), [comparison])
  const summaryBySupplier = useMemo(() => new Map((comparison?.quote_matrix?.supplier_summaries || []).map((s) => [String(s.supplier_id), s])), [comparison])

  // A quote that arrived while the page was open: one toast, one glow — never a loop.
  useEffect(() => {
    const ids = new Set(offers.map((o) => String(o.offer.quoteVersionId || o.offer.offerId || '')))
    if (seenQuotes === null) { if (offers.length || rfq) setSeenQuotes(ids); return }
    const fresh = offers.find((o) => !seenQuotes.has(String(o.offer.quoteVersionId || o.offer.offerId || '')))
    if (fresh) {
      const cov = summaryBySupplier.get(String(fresh.supplier.id || ''))?.coverage
      setToast({ title: 'وصل عرض جديد', body: `${fresh.supplier.name_ar || fresh.supplier.name_en || 'مورد'} أرسل سعر${cov ? ` لـ ${cov.priced} بند` : ''}` })
      setSeenQuotes(ids)
    }
  }, [offers, rfq, seenQuotes, summaryBySupplier])

  const declinedSuppliers = useMemo(() => new Set(outcomes.filter((e) => e.event_type === 'LINE_DECLINED').map((e) => String(e.supplier_id || ''))), [outcomes])
  const progress = rfq ? requestProgress(rfq) : null
  const state = rfq ? requestState(rfq) : null
  const awardedInviteId = useMemo(() => {
    const qv = rfq?.award?.supplier_quote_version_id
    if (!qv) return null
    for (const row of offers) if (String(row.offer.quoteVersionId) === qv) return String(row.offer.inviteId || '') || null
    return null
  }, [rfq, offers])

  const rows = useMemo(() => invites.map((inv) => {
    const st = supplierState(inv, awardedInviteId)
    const declined = declinedSuppliers.has(inv.supplier_id)
    const opened = Boolean(inv.opened_at)
    const key: Filter = st.key === 'QUOTED' || st.key === 'AWARDED' ? 'quoted' : declined ? 'declined' : opened && st.key === 'SENT' ? 'replied' : st.key === 'SENT' ? 'waiting' : 'attention'
    const badge: { tone: Tone; label: string } =
      st.key === 'AWARDED' ? { tone: 'Success', label: 'تمت الترسية' }
      : st.key === 'QUOTED' ? { tone: 'Success', label: 'أرسل سعر' }
      : declined ? { tone: 'Danger', label: 'اعتذر · البند غير متوفر' }
      : opened && st.key === 'SENT' ? { tone: 'Info', label: 'فتح الطلب · بانتظار السعر' }
      : st.key === 'SENT' ? { tone: 'Warning', label: 'بانتظار الرد' }
      : st.key === 'FAILED' ? { tone: 'Danger', label: 'تعذر الإرسال' }
      : st.key === 'MANUAL' ? { tone: 'Warning', label: 'بانتظار إرسال واتساب يدويًا' }
      : { tone: 'Neutral', label: 'لم يُرسل' }
    return { inv, key, badge, channel: invitePreferredChannel(inv) }
  }), [invites, awardedInviteId, declinedSuppliers])

  const counts = useMemo(() => ({
    replied: rows.filter((r) => r.key === 'replied').length,
    declined: rows.filter((r) => r.key === 'declined').length,
  }), [rows])

  if (!selectedRfqId) return <div className="p-8 text-right">اختر طلبًا من قائمة الطلبات.</div>
  if (error) return <div className="p-8 text-right text-[var(--color-text-danger)]">{error}</div>
  if (!rfq || !progress || !state) return <div className="p-8 text-right" style={{ color: 'var(--color-text-secondary)' }}>جارٍ تحميل الطلب…</div>

  const payload = rfq.current_version?.payload || {}
  const title = rfqProjectName({ delivery: payload.delivery }) || formatRfqTitle({ id: rfq.id, engineering_department: rfq.engineering_department, delivery: payload.delivery, buyer: payload.buyer })
  const delivery = payload.delivery as { city?: string; required_date?: string } | undefined
  const repliedCount = progress.quoted + counts.replied + counts.declined
  const stateBadge: { tone: Tone; label: string } = state.key === 'AWARDED' ? { tone: 'Success', label: 'تمت الترسية' } : state.key === 'CLOSED' ? { tone: 'Neutral', label: 'أُغلق الاستلام' } : state.key === 'DRAFT' ? { tone: 'Neutral', label: 'مسودة' } : state.key === 'CANCELLED' ? { tone: 'Danger', label: 'ملغي' } : { tone: 'Success', label: 'يستقبل العروض' }
  // The four steps of the Figma bar: رفع · قرأت البنود · التواصل · المقارنة.
  const contactShare = invites.length ? progress.reached / invites.length : 0
  const filled = Math.min(1, (2 + contactShare + (state.key === 'AWARDED' ? 1 : 0)) / 4)
  const steps = [
    { label: 'رفع', done: true },
    { label: 'قرأت البنود', done: true },
    { label: <>التواصل · <bdi dir="ltr">{progress.reached}</bdi> من <bdi dir="ltr">{invites.length}</bdi></>, done: invites.length > 0 && progress.reached >= invites.length },
    { label: 'المقارنة', done: state.key === 'AWARDED' },
  ]
  const named = rows.filter((r) => r.key !== 'waiting' && r.key !== 'replied')
  const waiting = rows.filter((r) => r.key === 'waiting' || r.key === 'replied')
  const nameOf = (inv: ConstructionInvitation) => inv.supplier?.name_ar || inv.supplier?.name_en || 'مورد'
  const waitingNames = waiting.slice(0, 3).map((r) => nameOf(r.inv)).join('، ') + (waiting.length > 3 ? ` و${waiting.length - 3} غيرهم` : '')
  const supplierCaption = (inv: ConstructionInvitation, channel: string | null) => {
    const offer = offers.find((o) => String(o.offer.inviteId || '') === inv.id || String(o.supplier.id || '') === inv.supplier_id)
    const cov = summaryBySupplier.get(String(inv.supplier_id || ''))?.coverage
    const lead = offer ? leadTimeLabel(offer.offer) : null
    return [channel ? CHANNEL_AR[channel] || null : null, cov ? <><bdi dir="ltr">{cov.priced}</bdi> من <bdi dir="ltr">{cov.requested}</bdi></> : null, lead].filter(Boolean).map((x, k) => <span key={k}>{k ? ' · ' : ''}{x}</span>)
  }
  const badgeFor = (r: typeof rows[number]) => {
    const cov = summaryBySupplier.get(String(r.inv.supplier_id || ''))?.coverage
    if (r.badge.label === 'أرسل سعر' && cov && cov.priced < cov.requested) return { tone: 'Warning' as Tone, label: 'عرض ناقص' }
    return r.badge
  }
  const compareDisabled = !progress.quoted

  return (
    <div className="pricing-v2 relative min-h-full text-[var(--color-text-primary)]">
      <TopBar parent="طلبات التسعير" onParent={() => navigate('rfq-list')} title={mobile ? 'متابعة الطلب' : title} />
      <div className={`mx-auto flex w-full max-w-[720px] flex-col gap-6 ${mobile ? 'p-4 pb-24' : 'p-8'}`}>
        {mobile ? null : <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-[44px] font-semibold">متابعة الطلب · {title}</h1>}

        <section aria-label="حالة الطلب" className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-[family-name:var(--font-display)] text-[20px] leading-[32px] font-semibold">{title}</h2>
            <Badge tone={stateBadge.tone} label={stateBadge.label} showDot={false} />
          </div>
          <div role="progressbar" aria-label="تقدم الطلب" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(filled * 100)} className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-surface-2)]">
            <div className="h-full rounded-full bg-[var(--color-bg-brand)]" style={{ width: `${filled * 100}%` }} />
          </div>
          <ol className="grid grid-cols-4 gap-2 text-[12px] leading-[18px] sm:text-[14px] sm:leading-[22px]">
            {steps.map((s, k) => <li key={k} className={s.done ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}>{s.label}{s.done ? ' ✓' : ''}</li>)}
          </ol>
          <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">ردّ <bdi dir="ltr">{repliedCount}</bdi> من <bdi dir="ltr">{invites.length}</bdi> موردين. «أُرسل» لا يعني أن المورد قرأ الطلب.</p>
        </section>

        <div className="flex flex-col gap-1">
          <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">الطلب</p>
          <p className="text-[18px] leading-[28px] font-semibold"><bdi dir="ltr">{progress.items}</bdi> بنداً{delivery?.city ? ` · التوصيل: ${delivery.city}` : ''}{delivery?.required_date ? <> قبل <bdi dir="ltr">{delivery.required_date}</bdi></> : null}</p>
        </div>

        <section aria-labelledby="suppliers-h" className="flex flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] py-2">
          <h2 id="suppliers-h" className="sr-only">الموردين</h2>
          {invites.length === 0 ? <p className="px-6 py-4 text-[14px] text-[var(--color-text-secondary)]">ما أُرسل الطلب لأي مورد بعد.</p> : null}
          <ul>
            {named.map((r) => <li key={r.inv.id}><ListRow initial={nameOf(r.inv).trim().charAt(0)} title={nameOf(r.inv)} caption={supplierCaption(r.inv, r.channel)} status={badgeFor(r)} /></li>)}
          </ul>
          {invites.length ? (
            <dl className="flex flex-col">
              <div className="flex min-h-16 items-center justify-between gap-3 px-6 py-3"><dt>الموردون</dt><dd className="tabular-nums"><bdi dir="ltr">{invites.length}</bdi></dd></div>
              <div className="flex min-h-16 items-center justify-between gap-3 px-6 py-3"><dt>أرسلوا سعر</dt><dd className="tabular-nums"><bdi dir="ltr">{progress.quoted}</bdi></dd></div>
              {waiting.length ? <div className="flex min-h-16 items-center justify-between gap-3 px-6 py-3"><dt>بانتظار الرد</dt><dd className="text-start"><bdi dir="ltr">{waiting.length}</bdi> · {waitingNames}</dd></div> : null}
            </dl>
          ) : null}
        </section>

        <div className="flex flex-col gap-2">
          <Button variant="Primary" size="L" fullWidth onClick={() => navigate('comparison')} disabled={compareDisabled}>قارن العروض ({progress.quoted})</Button>
          {compareDisabled ? <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">تقدر تقارن أول ما يوصل أول عرض.</p> : null}
          <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">العروض مغلقة: لا يرى المورد أسعار غيره. الأرقام من سجل الطلب فقط.</p>
        </div>
      </div>

      {toast ? <Toast tone="Success" title={toast.title} body={toast.body} onClose={() => setToast(null)} /> : null}
    </div>
  )
}

export default RequestTrackingV2
