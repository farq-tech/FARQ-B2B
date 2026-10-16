import { useEffect, useState } from 'react'
import {
  archiveOpportunityRequest, canActOn, cancelOpportunityRequest, hideOpportunityRequest, inFilter, listOpportunityRequests, opportunityRequestAudit,
  organizationAccess, OpportunityRequestsOff, restoreOpportunityRequest, unhideOpportunityRequest,
  type OpportunityAuditEvent, type OpportunityRequest, type OpportunityRequestFilter, type OrganizationAccess,
} from '../../api/opportunityRequestsClient'
import { Badge, Button, Icon } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'
import { hijriLabel } from '../../lib/saudi'

/*
 * «طلباتي» on خريطة الفرص: the organization's requests, compact. A request can be cancelled (confirm + optional
 * reason), hidden / shown, archived (and restored from «المؤرشفة»); «السجل» opens its audit trail. There is no delete.
 * Buttons follow the role: VIEWER reads only, MEMBER acts on its own requests, OWNER / ADMIN on all.
 * While the API flag is off (404) the section says «قريباً» and shows nothing else.
 */

const FILTERS: [OpportunityRequestFilter, string][] = [['all', 'الكل'], ['active', 'النشطة'], ['hidden', 'المخفية'], ['archived', 'المؤرشفة']]
const ACTION: Record<string, string> = { CREATE: 'أنشأ الطلب', UPDATE: 'عدّل الطلب', CANCEL: 'ألغى الطلب', HIDE: 'أخفى الطلب', UNHIDE: 'أظهر الطلب', ARCHIVE: 'أرشف الطلب', RESTORE: 'استرجع الطلب' }
const ROLE: Record<string, string> = { OWNER: 'مالك', ADMIN: 'مدير', MEMBER: 'عضو', VIEWER: 'مشاهد' }
const KIND: Record<string, string> = { BOOKLET: 'كراسة', PURCHASE_REQUEST: 'طلب شراء', SELLER_CATALOG: 'كتالوج', SELLER_PRODUCTS: 'منتجاتي', SEARCH: 'بحث' }
// Gregorian (explicit: ar-SA alone defaults to the Hijri calendar) with the Umm al-Qura date beside it
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' })} · ${hijriLabel(d)}` }
const small = `rounded-full px-2.5 py-1 text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)] disabled:opacity-50 ${FOCUS_RING}`
const tag = (label: string) => <Badge tone="Neutral" showDot={false} label={label} className="px-2 py-0 text-[12px] leading-[18px]" />

export default function MyRequests({ mobile = false, refresh = 0 }: { mobile?: boolean; /** bump to reload (a request was just saved) */ refresh?: number }) {
  const [filter, setFilter] = useState<OpportunityRequestFilter>('all')
  const [who, setWho] = useState<OrganizationAccess | null>(null)
  const [list, setList] = useState<OpportunityRequest[] | null>(null)
  const [off, setOff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [audit, setAudit] = useState<{ req: OpportunityRequest; events: OpportunityAuditEvent[] | null; error?: string } | null>(null)

  useEffect(() => {
    let on = true
    Promise.all([organizationAccess(), listOpportunityRequests(filter)]).then(
      ([access, rows]) => { if (on) { setWho(access); setList(rows); setOff(false); setError(null) } },
      (e) => { if (!on) return; if (e instanceof OpportunityRequestsOff) setOff(true); else setError(e instanceof Error && e.message ? e.message : 'ما قدرنا نجيب طلباتك الحين.') },
    )
    return () => { on = false }
  }, [filter, refresh])
  useEffect(() => {
    if (!audit) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAudit(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [audit])

  const act = async (id: string, run: () => Promise<OpportunityRequest>) => {
    setBusy(id); setError(null)
    try {
      const next = await run()
      setList((cur) => (cur || []).flatMap((r) => (r.id !== id ? [r] : inFilter(next, filter) ? [next] : [])))
      setCancelling(null); setReason('')
    } catch (e) {
      if (e instanceof OpportunityRequestsOff) setOff(true)
      else setError(e instanceof Error && e.message ? e.message : 'ما قدرنا نحفظ التغيير.')
    } finally { setBusy(null) }
  }
  const openAudit = (req: OpportunityRequest) => {
    setAudit({ req, events: null })
    opportunityRequestAudit(req.id).then(
      (events) => setAudit((a) => (a?.req.id === req.id ? { req, events } : a)),
      (e) => setAudit((a) => (a?.req.id === req.id ? { req, events: [], error: e instanceof Error && e.message ? e.message : 'ما قدرنا نجيب السجل.' } : a)),
    )
  }
  const actorOf = (e: OpportunityAuditEvent) => (e.actorUserId && who?.userId && e.actorUserId === who.userId ? 'أنت' : e.actorUserId ? `مستخدم ${e.actorUserId.slice(0, 8)}` : '—')

  return (
    <details className="group border-t border-[var(--color-border-default)] px-5 py-3">
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 text-[14px] leading-[22px] font-medium ${FOCUS_RING}`}>
        <span className="flex items-center gap-2">طلباتي{off ? <span className="text-[12px] font-normal text-[var(--color-text-tertiary)]">قريباً</span> : list ? <span className="text-[12px] font-normal text-[var(--color-text-tertiary)]">{list.length}</span> : null}</span>
        <Icon name="chevron-down" size={16} className="text-[var(--color-icon-secondary)] transition-transform group-open:rotate-180" />
      </summary>
      {off ? (
        <p className="mt-2 text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">قريباً: تتابع هنا طلباتك وتلغيها أو تخفيها أو تؤرشفها.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div role="radiogroup" aria-label="عرض الطلبات" className="flex flex-wrap gap-1">
            {FILTERS.map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={filter === v} onClick={() => setFilter(v)}
                className={`rounded-full border px-3 py-1 text-[12px] leading-[18px] font-medium ${filter === v ? 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary-subtle)] text-[var(--color-text-primary)]' : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)]'} ${FOCUS_RING}`}>{l}</button>
            ))}
          </div>
          {who && who.role === 'VIEWER' ? <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">صلاحيتك مشاهدة فقط.</p> : null}
          {error ? <p role="alert" className="text-[12px] leading-[18px] text-[var(--color-text-danger)]">{error}</p> : null}
          {!list && !error ? <p className="text-[12px] text-[var(--color-text-tertiary)]">نجيب طلباتك…</p> : null}
          {list && !list.length ? <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">ما فيه طلبات هنا.</p> : null}
          <ul className="flex flex-col">
            {(list || []).map((r) => {
              const can = who ? canActOn(who, r) : false
              return (
                <li key={r.id} className="flex flex-col gap-1 border-t border-[var(--color-border-default)] py-2 first:border-t-0">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] leading-[22px] font-medium">{r.title}</span>
                    {r.status === 'CANCELLED' || r.cancelledAt ? tag('ملغي') : null}
                    {r.hidden ? tag('مخفي') : null}
                    {r.status === 'ARCHIVED' ? tag('مؤرشف') : null}
                  </div>
                  <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{[KIND[r.kind] || r.kind, r.payload?.city, when(r.createdAt)].filter(Boolean).join(' · ')}</span>
                  {cancelling === r.id ? (
                    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] p-3">
                      <p className="text-[14px] leading-[22px] font-medium">تلغي «{r.title}»؟</p>
                      <label className="flex flex-col gap-1 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">السبب (اختياري)
                        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={`rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-[14px] text-[var(--color-text-primary)] ${FOCUS_RING}`} />
                      </label>
                      <div className="flex gap-2">
                        <Button variant="Primary" size="S" disabled={busy === r.id} loading={busy === r.id} loadingLabel="نلغي…" onClick={() => void act(r.id, () => cancelOpportunityRequest(r.id, reason.trim() || undefined))}>تأكيد الإلغاء</Button>
                        <Button variant="Ghost" size="S" onClick={() => { setCancelling(null); setReason('') }}>رجوع</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="-ms-2.5 flex flex-wrap gap-0.5">
                      {can && r.status === 'ACTIVE' ? <button type="button" className={small} disabled={busy === r.id} onClick={() => { setCancelling(r.id); setReason('') }}>إلغاء الطلب</button> : null}
                      {can ? <button type="button" className={small} disabled={busy === r.id} onClick={() => void act(r.id, () => (r.hidden ? unhideOpportunityRequest(r.id) : hideOpportunityRequest(r.id)))}>{r.hidden ? 'إظهار' : 'إخفاء'}</button> : null}
                      {can && r.status !== 'ARCHIVED' ? <button type="button" className={small} disabled={busy === r.id} onClick={() => void act(r.id, () => archiveOpportunityRequest(r.id))}>أرشفة</button> : null}
                      {can && r.status === 'ARCHIVED' ? <button type="button" className={small} disabled={busy === r.id} onClick={() => void act(r.id, () => restoreOpportunityRequest(r.id))}>استرجاع</button> : null}
                      <button type="button" className={small} onClick={() => openAudit(r)}>السجل</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {audit ? (
        <div className="fixed inset-0 z-50 flex bg-[var(--color-bg-inverse)]/40" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setAudit(null) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="audit-title"
            className={`flex flex-col gap-3 overflow-y-auto bg-[var(--color-bg-surface)] p-5 shadow-[var(--elevation-lg)] ${mobile ? 'mt-auto max-h-[80dvh] w-full rounded-t-[var(--radius-xl)]' : 'ms-auto h-full w-[400px]'}`}>
            <div className="flex items-center justify-between gap-2">
              <h2 id="audit-title" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">السجل · <bdi>{audit.req.title}</bdi></h2>
              <button type="button" aria-label="إغلاق" autoFocus onClick={() => setAudit(null)} className={`rounded-full p-1 ${FOCUS_RING}`}><Icon name="x" size={18} /></button>
            </div>
            {!audit.events ? <p className="text-[14px] text-[var(--color-text-secondary)]">نجيب السجل…</p> : null}
            {audit.error ? <p role="alert" className="text-[14px] text-[var(--color-text-danger)]">{audit.error}</p> : null}
            {audit.events && !audit.events.length && !audit.error ? <p className="text-[14px] text-[var(--color-text-secondary)]">ما فيه حركات بعد.</p> : null}
            <ol className="flex flex-col">
              {(audit.events || []).map((e) => {
                const why = typeof e.details?.reason === 'string' ? e.details.reason : null
                return (
                  <li key={e.id} className="flex flex-col gap-0.5 border-t border-[var(--color-border-default)] py-2.5 first:border-t-0">
                    <span className="text-[14px] leading-[22px] font-medium">{ACTION[e.action] || e.action}</span>
                    <span className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{[actorOf(e), e.membershipRole ? ROLE[e.membershipRole] || e.membershipRole : null, e.organizationName, e.planCode ? `باقة ${e.planCode}` : null].filter(Boolean).join(' · ')}</span>
                    {why ? <span className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">السبب: {why}</span> : null}
                    <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{when(e.createdAt)}</span>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      ) : null}
    </details>
  )
}
