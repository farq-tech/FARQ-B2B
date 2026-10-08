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
import iconCompare from '../assets/pricing-v2/compare.svg'
import iconRefresh from '../assets/pricing-v2/refresh.svg'
import iconWhatsapp from '../assets/pricing-v2/whatsapp.svg'
import iconMail from '../assets/pricing-v2/mail.svg'
import iconShield from '../assets/pricing-v2/shield.svg'
import iconClock from '../assets/pricing-v2/clock.svg'
import iconTruck from '../assets/pricing-v2/truck.svg'
import stepDone from '../assets/pricing-v2/step-done.svg'
import stepActive from '../assets/pricing-v2/step-active.svg'
import stepPending from '../assets/pricing-v2/step-pending.svg'
import iconChevron from '../assets/pricing-v2/chevron.svg'
import iconClose from '../assets/pricing-v2/close.svg'
import iconToast from '../assets/pricing-v2/toast-check.svg'

/*
 * «03 · متابعة الطلب» — the Figma «فرق تسعير» request-tracking screen, wired to
 * the real request: invitations, dispatch attempts, quotes and supplier outcomes.
 * Numbers are derived only from recorded data; nothing here is illustrative.
 */

type Offer = ConstructionComparison['supplier_responses'][number]
type Tone = 'success' | 'info' | 'neutral' | 'warning' | 'danger'
const TONE: Record<Tone, { bg: string; fg: string; dot: string }> = {
  success: { bg: 'var(--color-bg-success)', fg: 'var(--color-text-success)', dot: 'var(--color-icon-success)' },
  info: { bg: 'var(--color-bg-info)', fg: 'var(--color-text-link)', dot: 'var(--color-icon-info)' },
  neutral: { bg: 'var(--color-bg-surface-2)', fg: 'var(--color-text-secondary)', dot: 'var(--color-icon-secondary)' },
  warning: { bg: 'var(--color-bg-warning)', fg: 'var(--color-text-warning)', dot: 'var(--color-icon-warning)' },
  danger: { bg: 'var(--color-bg-danger)', fg: 'var(--color-text-danger)', dot: 'var(--color-icon-danger)' },
}
const POLL_MS = 30_000

function Badge({ tone, label, small }: { tone: Tone; label: string; small?: boolean }) {
  const t = TONE[tone]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${small ? 'text-[12px] leading-[18px]' : 'text-[14px] leading-[22px]'} font-medium whitespace-nowrap`} style={{ background: t.bg, color: t.fg }}>
      <span className="size-1.5 rounded-full" style={{ background: t.dot }} />
      {label}
    </span>
  )
}

function ChannelBadge({ channel }: { channel: string | null }) {
  if (channel === 'WHATSAPP') return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] leading-[18px] font-medium" style={{ background: 'var(--color-bg-success)', color: 'var(--color-text-success)' }}><img src={iconWhatsapp} alt="" width={14} height={14} />واتساب</span>
  if (channel === 'EMAIL') return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] leading-[18px] font-medium" style={{ background: 'var(--color-bg-info)', color: 'var(--color-text-link)' }}><img src={iconMail} alt="" width={14} height={14} />إيميل</span>
  if (channel === 'HARAJ') return <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] leading-[18px] font-medium" style={{ background: 'var(--color-bg-surface-2)', color: 'var(--color-text-secondary)' }}>حراج</span>
  return null
}

function Stat({ label, value, basis, tone = 'neutral' }: { label: string; value: number | string; basis: string; tone?: 'neutral' | 'success' | 'danger' }) {
  const color = tone === 'success' ? 'var(--color-text-success)' : tone === 'danger' ? 'var(--color-text-danger)' : 'var(--color-text-primary)'
  return (
    <div className="flex min-w-0 flex-1 flex-col items-end gap-1 rounded-[16px] border px-5 py-4" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
      <p className="w-full text-right text-[14px] leading-[22px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <p className="font-[Readex_Pro] text-[28px] leading-[40px] font-semibold tabular-nums" style={{ color }}>{value}</p>
      <p className="w-full text-right text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>{basis}</p>
    </div>
  )
}

function TimelineStep({ title, detail, status, last }: { title: string; detail: string; status: 'done' | 'active' | 'pending'; last?: boolean }) {
  return (
    <div className="flex h-[72px] w-full items-start justify-end gap-3">
      <div className="flex min-w-0 flex-1 flex-col items-end gap-1 text-right">
        <p className="text-[16px] leading-[26px] font-medium" style={{ color: status === 'pending' ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}>{title}</p>
        <p className="text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>{detail}</p>
      </div>
      <div className="flex flex-col items-center gap-1">
        {status === 'done' && <span className="flex size-7 items-center justify-center rounded-full" style={{ background: 'var(--color-bg-success)' }}><img src={stepDone} alt="" width={16} height={16} /></span>}
        {status === 'active' && <span className="flex size-7 items-center justify-center rounded-full border-2" style={{ background: 'var(--color-bg-info)', borderColor: 'var(--color-border-primary)' }}><img src={stepActive} alt="" width={16} height={16} /></span>}
        {status === 'pending' && <img src={stepPending} alt="" width={28} height={28} />}
        {!last && <span className="h-9 w-0.5" style={{ background: status === 'done' ? 'var(--color-border-success)' : 'var(--color-border-default)' }} />}
      </div>
    </div>
  )
}

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

function QuoteCard({ offer, invites, coverage, fresh }: { offer: Offer; invites: ConstructionInvitation[]; coverage: { priced: number; requested: number } | null; fresh: boolean }) {
  const name = offer.supplier.name_ar || offer.supplier.name_en || 'مورد'
  const channel = offerChannel(offer, invites)
  const total = money(offer.offer.totals?.total)
  const incl = offer.offer.prices_include_tax
  const lead = leadTimeLabel(offer.offer)
  return (
    <div className="flex w-full flex-col items-end gap-4 rounded-[16px] bg-white p-5" style={fresh ? { border: '1.5px solid var(--color-border-success)', boxShadow: 'var(--glow-success)' } : { border: '1px solid var(--color-border-default)', boxShadow: 'var(--elevation-sm)' }}>
      <div className="flex w-full items-center justify-between gap-3">
        {fresh ? <Badge tone="info" label="جديد" /> : coverage ? <Badge tone="neutral" label={`${coverage.priced} من ${coverage.requested} بند`} /> : <span />}
        <div className="flex min-w-0 flex-col items-end gap-1 text-right">
          <p className="truncate text-[16px] leading-[26px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{name}</p>
          <p className="text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{[timeAgo(offer.offer.submittedAt), channel === 'WHATSAPP' ? 'واتساب' : channel === 'EMAIL' ? 'إيميل' : channel === 'HARAJ' ? 'حراج' : 'البوابة'].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="flex items-baseline justify-end gap-2 text-right">
        <p className="text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{incl === false ? 'قبل الضريبة' : incl ? 'شامل الضريبة' : ''}</p>
        <p className="font-[Readex_Pro] text-[28px] leading-[40px] font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{total || '—'}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-4 text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>
        {offer.offer.notes ? <span className="inline-flex items-center gap-1"><img src={iconShield} alt="" width={16} height={16} />{String(offer.offer.notes).slice(0, 40)}</span> : null}
        {lead ? <span className="inline-flex items-center gap-1"><img src={iconClock} alt="" width={16} height={16} />{lead}</span> : null}
        {coverage && coverage.priced === coverage.requested ? <span className="inline-flex items-center gap-1"><img src={iconTruck} alt="" width={16} height={16} />يغطّي كل البنود</span> : null}
      </div>
    </div>
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
      st.key === 'AWARDED' ? { tone: 'success', label: 'تمت الترسية' }
      : st.key === 'QUOTED' ? { tone: 'success', label: 'أرسل سعر' }
      : declined ? { tone: 'danger', label: 'اعتذر · البند غير متوفر' }
      : opened && st.key === 'SENT' ? { tone: 'info', label: 'فتح الطلب · بانتظار السعر' }
      : st.key === 'SENT' ? { tone: 'warning', label: 'بانتظار الرد' }
      : st.key === 'FAILED' ? { tone: 'danger', label: 'تعذر الإرسال' }
      : st.key === 'MANUAL' ? { tone: 'warning', label: 'بانتظار إرسال واتساب يدويًا' }
      : { tone: 'neutral', label: 'لم يُرسل' }
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
  const stateBadge: { tone: Tone; label: string } = state.key === 'AWARDED' ? { tone: 'success', label: 'تمت الترسية' } : state.key === 'CLOSED' ? { tone: 'neutral', label: 'أُغلق الاستلام' } : state.key === 'DRAFT' ? { tone: 'neutral', label: 'مسودة' } : state.key === 'CANCELLED' ? { tone: 'danger', label: 'ملغي' } : { tone: 'success', label: 'يستقبل العروض' }
  const contactStep: 'done' | 'active' | 'pending' = progress.reached === 0 ? 'pending' : progress.reached >= invites.length ? 'done' : 'active'
  const compareStep: 'done' | 'active' | 'pending' = state.key === 'AWARDED' ? 'done' : progress.quoted > 0 ? 'active' : 'pending'

  return (
    <div className="pricing-v2 relative min-h-full" style={{ background: 'var(--color-bg-canvas)', fontFamily: "'Tajawal', 'Cairo', system-ui, sans-serif", color: 'var(--color-text-primary)' }}>
      <div className="flex h-[72px] items-center justify-between border-b bg-white px-8" style={{ borderColor: 'var(--color-border-default)' }}>
        <div />
        <div className="flex items-center gap-2">
          <p className="text-[16px] leading-[26px] font-medium">{title}</p>
          <img src={iconChevron} alt="" width={16} height={16} />
          <button type="button" onClick={() => navigate('rfq-list')} className="text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>طلبات التسعير</button>
        </div>
      </div>

      <div className="flex flex-col gap-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate('comparison')} disabled={!progress.quoted} className="flex h-12 items-center gap-2 rounded-[12px] px-6 text-[16px] font-medium text-white disabled:opacity-40" style={{ background: 'var(--color-bg-cta)' }}>قارن العروض ({progress.quoted}) <img src={iconCompare} alt="" width={20} height={20} /></button>
          </div>
          <div className="flex min-w-0 flex-col items-end gap-1.5 text-right">
            <div className="flex items-center gap-3">
              <Badge tone={stateBadge.tone} label={stateBadge.label} />
              <h1 className="truncate font-[Readex_Pro] text-[32px] leading-[48px] font-bold">{title}</h1>
            </div>
            <p className="text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>
              {[rfq.created_at ? `أُنشئ ${timeAgo(rfq.created_at)}` : null, `${progress.items} بند`, delivery?.city ? `التوصيل لـ${delivery.city}${delivery.required_date ? ` قبل ${delivery.required_date}` : ''}` : null].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="flex gap-4">
          <Stat label="اعتذروا" value={counts.declined} basis={counts.declined ? 'أفادوا بعدم توفر بند أو أكثر' : 'لا اعتذارات حتى الآن'} tone="danger" />
          <Stat label="أرسلوا سعر" value={progress.quoted} basis={coveredLines != null ? `يغطّون ${coveredLines} من ${progress.items} بند` : 'عروض مستلمة'} tone="success" />
          <Stat label="ردّوا" value={repliedCount} basis={progress.reached ? `${Math.round((repliedCount / progress.reached) * 100)}% من اللي تواصلنا معهم` : 'لم يُرسل الطلب بعد'} />
          <Stat label="تم التواصل معهم" value={progress.reached} basis={`من ${invites.length} مورد مدعو`} />
        </div>

        <div className="flex items-start gap-6">
          <div className="flex w-[380px] shrink-0 flex-col gap-6">
            <div className="flex w-full flex-col items-end gap-1 rounded-[24px] border bg-white px-6 py-5" style={{ borderColor: 'var(--color-border-default)' }}>
              <p className="font-[Readex_Pro] text-[18px] leading-[28px] font-medium">مسار الطلب</p>
              <TimelineStep title="رفع الطلب" detail={`${progress.items} بند`} status="done" />
              <TimelineStep title="قراءة البنود" detail={`${progress.items} بند جاهز للإرسال`} status="done" />
              <TimelineStep title="التواصل مع الموردين" detail={progress.reached ? `تم التواصل مع ${progress.reached} مورد` : 'لم يبدأ الإرسال'} status={contactStep} />
              <TimelineStep title="المقارنة والترسية" detail={state.key === 'AWARDED' ? 'تمت الترسية' : progress.quoted ? `تقدر تبدأ الحين — ${progress.quoted} عرض جاهز` : 'بانتظار أول عرض'} status={compareStep} last />
            </div>
            <div className="flex w-full flex-col items-end gap-3">
              <button type="button" onClick={() => selectedRfqId && void load(selectedRfqId)} className="flex items-center gap-2">
                <img src={iconRefresh} alt="" width={18} height={18} />
                <span className="font-[Readex_Pro] text-[18px] leading-[28px] font-medium">آخر العروض</span>
              </button>
              {offers.length === 0 ? <p className="w-full rounded-[16px] border bg-white p-5 text-right text-[14px]" style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}>ما وصل أي عرض بعد. {reachedNotQuoted ? `${reachedNotQuoted} مورد ما زال يدرس الطلب.` : ''}</p> : null}
              {offers.slice(0, 2).map((o, i) => {
                const cov = summaryBySupplier.get(String(o.supplier.id || ''))?.coverage || null
                return <QuoteCard key={String(o.offer.quoteVersionId || o.offer.offerId || i)} offer={o} invites={invites} coverage={cov} fresh={i === 0 && Date.now() - Date.parse(String(o.offer.submittedAt || 0)) < 60 * 60 * 1000} />
              })}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-end overflow-hidden rounded-[24px] border bg-white" style={{ borderColor: 'var(--color-border-default)' }}>
            <div className="flex w-full flex-col items-end gap-3 px-6 py-5">
              <div className="flex items-baseline gap-2 text-right">
                <p className="text-[12px] leading-[18px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>مرتبين حسب حالة الرد</p>
                <p className="font-[Readex_Pro] text-[18px] leading-[28px] font-medium">الموردين</p>
              </div>
              <div className="flex items-center gap-5">
                {([['declined', `اعتذروا ${counts.declined}`], ['waiting', `بانتظار ${counts.waiting}`], ['replied', `ردّوا بدون سعر ${counts.replied}`], ['quoted', `أرسلوا سعر ${counts.quoted}`], ['all', `الكل ${counts.all}`]] as [Filter, string][]).map(([k, label]) => (
                  <button type="button" key={k} onClick={() => { setFilter(k); setShowAll(false) }} className="flex flex-col items-center gap-2 pt-2.5">
                    <span className={`text-[16px] leading-[26px] ${filter === k ? 'font-medium' : ''}`} style={{ color: filter === k ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>{label}</span>
                    <span className="h-[3px] w-full rounded-[2px]" style={{ background: filter === k ? 'var(--color-bg-brand)' : 'transparent' }} />
                  </button>
                ))}
              </div>
            </div>
            {shown.length === 0 ? <p className="w-full p-6 text-right text-[14px]" style={{ color: 'var(--color-text-secondary)' }}>لا يوجد موردون في هذه الحالة.</p> : null}
            {shown.map(({ inv, badge, channel }) => {
              const name = inv.supplier?.name_ar || inv.supplier?.name_en || 'مورد'
              return (
                <div key={inv.id} className="flex w-full items-center justify-end gap-4 border-b px-5 py-4" style={{ borderColor: 'var(--color-border-default)' }}>
                  <Badge tone={badge.tone} label={badge.label} />
                  <ChannelBadge channel={channel} />
                  <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
                    <p className="truncate text-[16px] leading-[26px] font-medium">{name}</p>
                    <p className="text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>{inv.supplier?.city || '—'}</p>
                  </div>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] text-[16px] font-medium" style={{ background: 'var(--color-bg-surface-2)', color: 'var(--color-text-secondary)' }}>{name.trim().charAt(0)}</span>
                </div>
              )
            })}
            {visible.length > shown.length ? (
              <button type="button" onClick={() => setShowAll(true)} className="w-full p-4 text-center text-[14px] leading-[22px] font-medium" style={{ color: 'var(--color-text-link)' }}>عرض {visible.length - shown.length} مورد إضافي</button>
            ) : null}
          </div>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-8 left-8 flex w-[380px] items-start gap-3 rounded-[16px] border bg-white p-4" style={{ borderColor: 'var(--color-border-default)', boxShadow: 'var(--elevation-lg)' }}>
          <button type="button" onClick={() => setToast(null)} aria-label="إغلاق"><img src={iconClose} alt="" width={18} height={18} /></button>
          <div className="flex min-w-0 flex-1 flex-col items-end gap-1 text-right">
            <p className="text-[16px] leading-[26px] font-medium">{toast.title}</p>
            <p className="text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>{toast.body}</p>
          </div>
          <img src={iconToast} alt="" width={20} height={20} />
        </div>
      ) : null}
    </div>
  )
}

export default RequestTrackingV2
