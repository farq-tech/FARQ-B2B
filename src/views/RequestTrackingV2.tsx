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
import { Badge, Button, ChannelBadge, Icon, QuoteCard, Stat, Tabs, TimelineStep, Toast, TopBar, channelFromApi, useIsMobile, type BadgeTone, type QuoteFact, type TimelineStatus } from '../ui'

/*
 * «03 · متابعة الطلب» — the Figma «فرق تسعير» request-tracking screen, wired to
 * the real request: invitations, dispatch attempts, quotes and supplier outcomes.
 * Numbers are derived only from recorded data; nothing here is illustrative.
 */

type Offer = ConstructionComparison['supplier_responses'][number]
type Tone = BadgeTone
const POLL_MS = 30_000

function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - Date.parse(iso)
  if (!Number.isFinite(diff) || diff < 0) return ''
  const m = Math.round(diff / 60000)
  if (m < 2) return 'وصل الحين'
  if (m < 60) return `قبل ${m} دقيقة`
  const h = Math.round(m / 60)
  if (h < 24) return `قبل ${h} ${h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : 'ساعات'}`
  const d = Math.round(h / 24)
  return `قبل ${d} ${d === 1 ? 'يوم' : 'أيام'}`
}

function money(value?: number | string | null): string | null {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`
}

function offerChannel(offer: Offer, invites: ConstructionInvitation[]): string | null {
  const inv = invites.find((i) => i.id === String(offer.offer.inviteId || '')) || invites.find((i) => i.supplier_id === String(offer.supplier.id || ''))
  return inv ? invitePreferredChannel(inv) : null
}

/** Maps a recorded offer to the Figma Quote Card. Facts are only what the offer says. */
function OfferCard({ offer, invites, coverage, fresh }: { offer: Offer; invites: ConstructionInvitation[]; coverage: { priced: number; requested: number } | null; fresh: boolean }) {
  const name = offer.supplier.name_ar || offer.supplier.name_en || 'مورد'
  const channel = offerChannel(offer, invites)
  const incl = offer.offer.prices_include_tax
  const lead = leadTimeLabel(offer.offer)
  const facts: QuoteFact[] = []
  if (offer.offer.notes) facts.push({ icon: 'shield', label: String(offer.offer.notes).slice(0, 40) })
  if (lead) facts.push({ icon: 'clock', label: lead })
  if (coverage && coverage.priced === coverage.requested) facts.push({ icon: 'truck', label: 'يغطّي كل البنود' })
  return (
    <QuoteCard
      state={fresh ? 'New' : 'Default'}
      supplier={name}
      meta={[timeAgo(offer.offer.submittedAt), channel === 'WHATSAPP' ? 'واتساب' : channel === 'EMAIL' ? 'إيميل' : channel === 'HARAJ' ? 'حراج' : 'البوابة'].filter(Boolean).join(' · ')}
      amount={money(offer.offer.totals?.total) || '—'}
      amountNote={incl === false ? 'قبل الضريبة' : incl ? 'شامل الضريبة' : undefined}
      coverageLabel={coverage ? `${coverage.priced} من ${coverage.requested} بند` : null}
      facts={facts}
    />
  )
}

type Filter = 'all' | 'quoted' | 'replied' | 'waiting' | 'declined'

export function RequestTrackingV2({ navigate }: NavProps) {
  const { selectedRfqId } = useProcurement()
  const [rfq, setRfq] = useState<ConstructionRfq | null>(null)
  const [comparison, setComparison] = useState<ConstructionComparison | null>(null)
  const [outcomes, setOutcomes] = useState<ConstructionSupplierOutcomeEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [showAll, setShowAll] = useState(false)
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
    const key: Filter = st.key === 'QUOTED' || st.key === 'AWARDED' ? 'quoted' : declined ? 'declined' : opened && st.key === 'SENT' ? 'replied' : st.key === 'SENT' ? 'waiting' : 'waiting'
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
    all: rows.length,
    quoted: rows.filter((r) => r.key === 'quoted').length,
    replied: rows.filter((r) => r.key === 'replied').length,
    waiting: rows.filter((r) => r.key === 'waiting').length,
    declined: rows.filter((r) => r.key === 'declined').length,
  }), [rows])
  const visible = rows.filter((r) => filter === 'all' || r.key === filter)
  const shown = showAll ? visible : visible.slice(0, 8)

  if (!selectedRfqId) return <div className="p-8 text-right">اختر طلبًا من قائمة الطلبات.</div>
  if (error) return <div className="p-8 text-right text-[var(--color-text-danger)]">{error}</div>
  if (!rfq || !progress || !state) return <div className="p-8 text-right" style={{ color: 'var(--color-text-secondary)' }}>جارٍ تحميل الطلب…</div>

  const payload = rfq.current_version?.payload || {}
  const title = rfqProjectName({ delivery: payload.delivery }) || formatRfqTitle({ id: rfq.id, engineering_department: rfq.engineering_department, delivery: payload.delivery, buyer: payload.buyer })
  const delivery = payload.delivery as { city?: string; required_date?: string } | undefined
  const coveredLines = comparison?.quote_matrix?.lines?.filter((l) => (l.offers || []).some((c) => c && c.unit_price != null)).length ?? null
  const reachedNotQuoted = Math.max(0, progress.reached - progress.quoted)
  const repliedCount = progress.quoted + counts.replied
  const stateBadge: { tone: Tone; label: string } = state.key === 'AWARDED' ? { tone: 'Success', label: 'تمت الترسية' } : state.key === 'CLOSED' ? { tone: 'Neutral', label: 'أُغلق الاستلام' } : state.key === 'DRAFT' ? { tone: 'Neutral', label: 'مسودة' } : state.key === 'CANCELLED' ? { tone: 'Danger', label: 'ملغي' } : { tone: 'Success', label: 'يستقبل العروض' }
  const contactStep: TimelineStatus = progress.reached === 0 ? 'Pending' : progress.reached >= invites.length ? 'Done' : 'Active'
  const compareStep: TimelineStatus = state.key === 'AWARDED' ? 'Done' : progress.quoted > 0 ? 'Active' : 'Pending'

  const suppliersSection = (
    <section aria-labelledby="suppliers-h" className="flex min-w-0 flex-1 flex-col items-stretch overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
      <div className="flex w-full flex-col items-start gap-3 px-6 py-5">
        <div className="flex items-baseline gap-2">
          <h2 id="suppliers-h" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">الموردين</h2>
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-tertiary)]">مرتبين حسب حالة الرد</p>
        </div>
        <Tabs className="max-w-full overflow-x-auto" label="تصفية الموردين حسب حالة الرد" value={filter} onChange={(k) => { setFilter(k); setShowAll(false) }}
          items={[{ key: 'all', label: `الكل ${counts.all}` }, { key: 'quoted', label: `أرسلوا سعر ${counts.quoted}` }, { key: 'replied', label: `ردّوا بدون سعر ${counts.replied}` }, { key: 'waiting', label: `بانتظار ${counts.waiting}` }, { key: 'declined', label: `اعتذروا ${counts.declined}` }]} />
      </div>
      {shown.length === 0 ? <p className="w-full p-6 text-start text-[14px] text-[var(--color-text-secondary)]">لا يوجد موردون في هذه الحالة.</p> : null}
      <ul>
        {shown.map(({ inv, badge, channel }) => {
          const name = inv.supplier?.name_ar || inv.supplier?.name_en || 'مورد'
          const ch = channelFromApi(channel)
          return (
            <li key={inv.id} className={`flex w-full items-center border-b border-[var(--color-border-default)] ${mobile ? 'flex-wrap gap-x-3 gap-y-2 px-4 py-3' : 'gap-4 px-5 py-4'}`}>
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] text-[16px] font-medium text-[var(--color-text-secondary)]">{name.trim().charAt(0)}</span>
              <div className={`flex min-w-0 flex-1 flex-col items-start gap-1 ${mobile ? 'basis-[calc(100%-56px)]' : ''}`}>
                <p className="max-w-full truncate text-[16px] leading-[26px] font-medium">{name}</p>
                <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{inv.supplier?.city || '—'}</p>
              </div>
              {ch ? <ChannelBadge channel={ch} /> : null}
              <Badge tone={badge.tone} label={badge.label} />
            </li>
          )
        })}
      </ul>
      {visible.length > shown.length ? (
        <button type="button" onClick={() => setShowAll(true)} className="w-full p-4 text-center text-[14px] leading-[22px] font-medium text-[var(--color-text-link)] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-border-primary)]">عرض {visible.length - shown.length} مورد إضافي</button>
      ) : null}
    </section>
  )
  const timelineSection = (
    <section aria-labelledby="track-h" className="flex w-full flex-col items-start gap-1 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-6 py-5">
      <h2 id="track-h" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">مسار الطلب</h2>
      <ol className="w-full">
        <TimelineStep title="رفع الطلب" detail={`${progress.items} بند`} status="Done" />
        <TimelineStep title="قراءة البنود" detail={`${progress.items} بند جاهز للإرسال`} status="Done" />
        <TimelineStep title="التواصل مع الموردين" detail={progress.reached ? `تم التواصل مع ${progress.reached} مورد` : 'لم يبدأ الإرسال'} status={contactStep} />
        <TimelineStep title="المقارنة والترسية" detail={state.key === 'AWARDED' ? 'تمت الترسية' : progress.quoted ? `تقدر تبدأ الحين — ${progress.quoted} عرض جاهز` : 'بانتظار أول عرض'} status={compareStep} showConnector={false} />
      </ol>
    </section>
  )
  const offersSection = (
    <section aria-labelledby="latest-h" className="flex w-full flex-col items-stretch gap-3">
      <div className="flex items-center gap-2">
        <h2 id="latest-h" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">آخر العروض</h2>
        <button type="button" aria-label="تحديث العروض" title="تحديث" onClick={() => selectedRfqId && void load(selectedRfqId)} className="rounded-[var(--radius-sm)] text-[var(--color-icon-secondary)] outline-none hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-border-primary)]"><Icon name="refresh" size={18} /></button>
      </div>
      {offers.length === 0 ? <p className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5 text-start text-[14px] text-[var(--color-text-secondary)]">ما وصل أي عرض بعد. {reachedNotQuoted ? `${reachedNotQuoted} مورد ما زال يدرس الطلب.` : ''}</p> : null}
      {offers.slice(0, 2).map((o, i) => {
        const cov = summaryBySupplier.get(String(o.supplier.id || ''))?.coverage || null
        return <OfferCard key={String(o.offer.quoteVersionId || o.offer.offerId || i)} offer={o} invites={invites} coverage={cov} fresh={i === 0 && Date.now() - Date.parse(String(o.offer.submittedAt || 0)) < 60 * 60 * 1000} />
      })}
    </section>
  )

  return (
    <div className="pricing-v2 relative min-h-full text-[var(--color-text-primary)]">{/* transparent: the living background (BG / Facets) shows around the cards */}
      <TopBar parent="طلبات التسعير" onParent={() => navigate('rfq-list')} title={title} />

      <div className={mobile ? 'flex flex-col gap-4 p-4 pb-24' : 'flex flex-col gap-6 p-8'}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {/* On phones the title lives in the app bar (Figma M03). */}
              {mobile ? null : <h1 className="truncate font-[family-name:var(--font-display)] text-[32px] leading-[48px] font-bold">{title}</h1>}
              <Badge tone={stateBadge.tone} label={stateBadge.label} />
            </div>
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
              {[rfq.created_at ? `أُنشئ ${timeAgo(rfq.created_at)}` : null, `${progress.items} بند`, delivery?.city ? `التوصيل لـ${delivery.city}${delivery.required_date ? ` قبل ${delivery.required_date}` : ''}` : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          {mobile ? null : <Button variant="Primary" size="L" icon="layers" onClick={() => navigate('comparison')} disabled={!progress.quoted}>قارن العروض ({progress.quoted})</Button>}
        </div>

        <div className={mobile ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-4 gap-4'}>
          <Stat label="تم التواصل معهم" value={progress.reached} basis={`من ${invites.length} مورد مدعو`} />
          <Stat label="ردّوا" value={repliedCount} basis={progress.reached ? `${Math.round((repliedCount / progress.reached) * 100)}% من اللي تواصلنا معهم` : 'لم يُرسل الطلب بعد'} />
          <Stat label="أرسلوا سعر" value={progress.quoted} basis={coveredLines != null ? `يغطّون ${coveredLines} من ${progress.items} بند` : 'عروض مستلمة'} tone="Success" />
          <Stat label="اعتذروا" value={counts.declined} basis={counts.declined ? 'أفادوا بعدم توفر بند أو أكثر' : 'لا اعتذارات حتى الآن'} tone="Danger" />
        </div>
        {mobile ? <Button variant="Primary" size="L" fullWidth icon="layers" onClick={() => navigate('comparison')} disabled={!progress.quoted}>قارن العروض ({progress.quoted})</Button> : null}

        {mobile ? (
          // Figma M03 order: latest offers, then the track, then the supplier list.
          <div className="flex flex-col gap-6">{offersSection}{timelineSection}{suppliersSection}</div>
        ) : (
          <div className="flex items-start gap-6">
            {suppliersSection}
            <div className="flex w-[380px] shrink-0 flex-col gap-6">{timelineSection}{offersSection}</div>
          </div>
        )}
      </div>

      {toast ? <Toast tone="Success" title={toast.title} body={toast.body} onClose={() => setToast(null)} /> : null}
    </div>
  )
}

export default RequestTrackingV2
