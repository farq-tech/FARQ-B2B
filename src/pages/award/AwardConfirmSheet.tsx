import { useEffect, useId, useRef, useState } from 'react'
import { ConstructionApiError, createConstructionAward, createConstructionProject, formatRfqTitle, getConstructionComparison, getConstructionProjects, getConstructionRfq, openConstructionRfqEnvelopes, type ConstructionComparison, type ConstructionProject, type ConstructionRfq } from '../../api/constructionClient'
import { awardBlockReason, awardReviewSignature, pricedAwardLineIds, type AwardOffer } from '../../lib/awardFlow'
import { leadTimeLabel, quoteCoverage, taxLabel } from '../../lib/requestFile'
import { Button, Chip, DualDate, Icon, Input, Money, useIsMobile, useNow } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'

/*
 * «05 · تأكيد الترسية» — Figma Confirm Sheet (49:2168 desktop, M05 58:356 phone).
 * Replaces the copied AwardDialog in the UI. The decision logic and the API calls
 * are AwardDialog's (فرق بناء ios-app@5147808) line for line: same reads before the
 * write, same guards, same order, same payloads. Only the presentation is new.
 * Proof: docs/qa/screens-b/award-calls.md (requests intercepted before/after).
 *
 * Figma's body copy promises things the API does not do (notifying the other
 * suppliers, a 30-minute undo). Those lines are not shown; the sheet says what
 * the confirm button actually records.
 */

const REASONS = ['أفضل سعر', 'أسرع توريد', 'أفضل مطابقة للمواصفات', 'مورد مفضل', 'أفضل شروط تجارية', 'أخرى'] as const

/** The offer total with the riyal sign; the basis is the offer's own `prices_include_tax`. null: VAT basis unknown in the API — nothing claimed. */
const money = (n: number | null | undefined, currency: string, includesTax: boolean | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? null
    : currency && currency !== 'SAR' ? `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
      : <Money amount={Number(n)} vat={includesTax === true ? 'incl' : includesTax === false ? 'excl' : null} className="justify-end" />

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type AwardConfirmSheetProps = {
  rfq: ConstructionRfq
  comparison: ConstructionComparison
  offer: AwardOffer
  coverage: ReturnType<typeof quoteCoverage>
  onClose: () => void
  onDone: (award: Record<string, unknown>) => void
}

export default function AwardConfirmSheet({ rfq, comparison, offer, coverage, onClose, onDone }: AwardConfirmSheetProps) {
  // ── state and guards: identical to AwardDialog ──
  const [reason, setReason] = useState('')
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ConstructionProject[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [newName, setNewName] = useState(() => formatRfqTitle({ id: rfq.id, delivery: rfq.current_version?.payload?.delivery, engineering_department: rfq.engineering_department, buyer: rfq.current_version?.payload?.buyer }))
  const [partialAccepted, setPartialAccepted] = useState(false)
  const createdProject = useRef<ConstructionProject | null>(null)
  const projectCreationAttempted = useRef(false)
  const name = offer.supplier.name_ar || offer.supplier.name_en || 'مورد'
  const lineIds = pricedAwardLineIds(comparison, offer.supplier.id)
  const block = awardBlockReason(rfq, offer) || (!lineIds.length ? 'لا توجد بنود مسعّرة قابلة للترسية في هذا العرض. حدّث المقارنة وراجع البنود.' : null)
  const partial = !coverage?.complete || lineIds.length < (rfq.current_version?.payload?.lines?.length || comparison.quote_matrix?.requested_line_count || 0)
  const ready = !block && lineIds.length > 0 && projectsLoaded && Boolean(projectId) && (projectId !== 'NEW' || Boolean(newName.trim())) && Boolean(reason) && (reason !== 'أخرى' || other.trim().length >= 5) && (!partial || (partialAccepted && lineIds.length > 0))

  useEffect(() => {
    let alive = true
    getConstructionProjects().then((r) => {
      if (!alive) return
      setProjects(r.projects || [])
      setProjectsLoaded(true)
    }).catch(() => { if (alive) setError('تعذر تحميل المشاريع. أغلق المراجعة وأعد فتحها للمحاولة.') })
    return () => { alive = false }
  }, [])

  const confirm = async () => {
    if (!ready || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      // A quote can be revised, cancelled or awarded while this dialog is open.
      const [latestRfq, latestComparison] = await Promise.all([getConstructionRfq(rfq.id), getConstructionComparison(rfq.id)])
      const latest = latestComparison.supplier_responses.find((row) => row.offer.quoteVersionId === offer.offer.quoteVersionId)
      if (!latest) throw new Error('تغيّر إصدار العرض. أغلق المراجعة وحدّث العروض ثم اختر العرض من جديد.')
      const latestBlock = awardBlockReason(latestRfq, latest)
      if (latestBlock) throw new Error(latestBlock)
      if (awardReviewSignature(comparison, offer) !== awardReviewSignature(latestComparison, latest)) throw new Error('تغيّرت بيانات العرض. أغلق المراجعة وحدّث العروض قبل التأكيد.')
      // Older closed requests may predate combined close-and-finalize.
      if (latestRfq.submission_closed_at && !latestRfq.envelopes_opened_at) {
        await openConstructionRfqEnvelopes(rfq.id, reason === 'أخرى' ? other.trim() : reason)
      }
      let targetId = projectId
      if (projectId === 'NEW') {
        if (!createdProject.current) {
          if (projectCreationAttempted.current) throw new Error('لم نتأكد من نتيجة إنشاء المشروع. أغلق المراجعة وأعد فتحها، ثم تحقق من قائمة المشاريع قبل إنشاء مشروع آخر.')
          projectCreationAttempted.current = true
          createdProject.current = await createConstructionProject({ name: newName.trim(), site_address: rfq.current_version?.payload?.delivery?.site_address || rfq.current_version?.payload?.delivery?.city })
        }
        if (!createdProject.current.id) throw new Error('تعذر التحقق من المشروع الجديد. أعد فتح المراجعة وراجع قائمة المشاريع.')
        targetId = createdProject.current.id
      }
      const selectionReason = reason === 'أخرى' ? other.trim() : reason
      const award = await createConstructionAward({ rfq_id: rfq.id, project_id: targetId, supplier_quote_version_id: offer.offer.quoteVersionId, selection_reason: selectionReason, awarded_line_ids: lineIds, approval_note: selectionReason })
      onDone(award)
    } catch (err) {
      const status = err instanceof ConstructionApiError ? err.status : 0
      setError(status === 403 ? 'الترسية تحتاج صلاحية مدير أو معتمد في شركتك.' : err instanceof Error ? err.message : 'تعذرت الترسية')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  // ── presentation: Figma Confirm Sheet, dialog semantics ──
  const mobile = useIsMobile()
  const titleId = useId()
  const descId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy }, [onClose, busy])

  // Focus moves into the sheet on open and returns to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    heading.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  // Escape closes (not while saving); Tab and Shift+Tab stay inside the sheet.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (!busyRef.current) closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !panel.current.contains(active)
      if (e.shiftKey && (outside || active === first || active === heading.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (outside || active === last)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const amount = money(offer.offer.totals?.total, offer.offer.currency || 'SAR', offer.offer.prices_include_tax)
  const today = useNow()
  const requestedCount = rfq.current_version?.payload?.lines?.length || comparison.quote_matrix?.requested_line_count || 0
  const fieldCls = `w-full rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-[14px] leading-[22px] text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] disabled:opacity-50 ${FOCUS_RING}`

  return (
    <div className={`fixed inset-0 z-[60] flex justify-center bg-[var(--color-bg-inverse)]/40 ${mobile ? 'items-end' : 'items-center p-4'}`} role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}
        className={`flex max-h-[92dvh] w-full flex-col overflow-y-auto bg-[var(--color-bg-surface)] text-start text-[var(--color-text-primary)] shadow-[var(--elevation-lg)] ${mobile ? 'rounded-t-[var(--radius-xl)] px-6 pt-3 pb-6' : 'max-w-[520px] rounded-[var(--radius-xl)] px-6 pt-3 pb-6'}`}>
        <span aria-hidden className="mx-auto mb-5 h-1 w-10 shrink-0 rounded-full bg-[var(--color-border-strong)]" />
        <h2 id={titleId} ref={heading} tabIndex={-1} className="font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold outline-none">تأكيد الترسية</h2>
        <p id={descId} className="mt-2 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
          التأكيد يجعل العروض نهائية إن لزم ويسجّل قرار الترسية على المشروع المختار. الترسية لا تعني تنفيذ دفع. تحقق من حالة إشعار المورد في ملف الطلب بعد الحفظ.
        </p>

        <dl className="mt-5 flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface-2)] p-4">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">المورد</dt><dd className="min-w-0 truncate text-[14px] leading-[22px] font-medium">{name}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">البنود</dt><dd className="text-[14px] leading-[22px] font-medium">{lineIds.length} بند ضمن نطاق الترسية{requestedCount ? ` من ${requestedCount}` : ''}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">التغطية</dt><dd className="text-[14px] leading-[22px] font-medium">{coverage?.label || 'تغطية البنود غير مؤكدة'}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">مدة التوريد</dt><dd className="text-[14px] leading-[22px] font-medium">{leadTimeLabel(offer.offer)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">الإجمالي{offer.offer.prices_include_tax == null ? ` (${taxLabel(null)})` : ''}</dt><dd className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-semibold tabular-nums">{amount || 'غير مكتملة'}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">تاريخ الترسية</dt><dd className="text-end text-[14px] leading-[22px] font-medium"><DualDate value={today} /></dd></div>
        </dl>

        {partial ? (
          <label className="mt-4 flex items-start gap-3 rounded-[var(--radius-md)] bg-[var(--color-bg-warning)] p-3 text-[14px] leading-[22px] text-[var(--color-text-warning)]">
            <input type="checkbox" disabled={busy} checked={partialAccepted} onChange={(e) => setPartialAccepted(e.target.checked)} className={`mt-1 size-4 shrink-0 accent-[var(--color-bg-primary)] ${FOCUS_RING}`} />
            <span>أوافق على ترسية البنود المسعّرة فقط ({lineIds.length} بند). البنود المتبقية تحتاج عروضًا وقرارًا مستقلًا.</span>
          </label>
        ) : null}

        <label className="mt-5 flex flex-col gap-2 text-[14px] leading-[22px] font-medium">
          المشروع الذي ستُسجل عليه الترسية
          <select value={projectId} disabled={!projectsLoaded || busy} onChange={(e) => setProjectId(e.target.value)} className={fieldCls}>
            <option value="">{projectsLoaded ? 'اختر المشروع' : 'جارٍ تحميل المشاريع…'}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.site_address ? ` — ${p.site_address}` : ''}</option>)}
            <option value="NEW">إنشاء مشروع جديد لهذا الطلب</option>
          </select>
        </label>
        {projectId === 'NEW' ? <Input className="mt-4" label="اسم المشروع الجديد" value={newName} disabled={busy || Boolean(createdProject.current)} onChange={(e) => setNewName(e.target.value)} /> : null}

        <fieldset className="mt-5">
          <legend className="mb-2 text-[14px] leading-[22px] font-medium">سبب اختيار المورد</legend>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => <Chip key={r} label={r} selected={reason === r} disabled={busy} onClick={() => setReason(r)} />)}
          </div>
        </fieldset>
        {reason === 'أخرى' ? (
          <label className="mt-3 flex flex-col gap-2 text-[14px] leading-[22px] font-medium">
            سبب الترسية
            <textarea disabled={busy} value={other} onChange={(e) => setOther(e.target.value)} placeholder="اكتب سبب الترسية (5 أحرف على الأقل)" className={`min-h-[72px] ${fieldCls}`} />
          </label>
        ) : null}

        {error || block ? (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />{error || block}
          </p>
        ) : null}

        <div className="mt-6 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Button variant="Primary" size="L" icon="award" fullWidth disabled={!ready || busy} loading={busy} loadingLabel="جارٍ تسجيل الترسية…" onClick={() => void confirm()}>
              {mobile ? 'نعم، رسِّ الطلب' : `نعم، رسِّ على ${name}`}
            </Button>
          </div>
          <Button variant="Secondary" size="L" disabled={busy} onClick={onClose}>رجوع</Button>
        </div>
      </div>
    </div>
  )
}
