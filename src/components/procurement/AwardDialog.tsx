import { useEffect, useRef, useState } from 'react'
import { ConstructionApiError, createConstructionAward, createConstructionProject, formatRfqTitle, getConstructionComparison, getConstructionProjects, getConstructionRfq, openConstructionRfqEnvelopes, type ConstructionComparison, type ConstructionProject, type ConstructionRfq } from '../../api/constructionClient'
import { awardBlockReason, awardReviewSignature, pricedAwardLineIds, type AwardOffer } from '../../lib/awardFlow'
import { formatMoney, leadTimeLabel, quoteCoverage, taxLabel } from '../../lib/requestFile'

const REASONS = ['أفضل سعر', 'أسرع توريد', 'أفضل مطابقة للمواصفات', 'مورد مفضل', 'أفضل شروط تجارية', 'أخرى'] as const

export default function AwardDialog({ rfq, comparison, offer, coverage, onClose, onDone }: {
  rfq: ConstructionRfq
  comparison: ConstructionComparison
  offer: AwardOffer
  coverage: ReturnType<typeof quoteCoverage>
  onClose: () => void
  onDone: (award: Record<string, unknown>) => void
}) {
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

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="award-review-title" dir="rtl">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[90dvh] overflow-y-auto">
        <div className="text-xs text-neutral-400 mb-1">اختيار العرض ← مراجعة القرار ← ترسية</div>
        <h2 id="award-review-title" className="text-lg font-black text-[#0D1F1D] mb-3">مراجعة وتأكيد الترسية</h2>
        <div className="rounded-xl bg-neutral-50 px-4 py-3 text-sm space-y-2 mb-4">
          <div>المورد: <strong>{name}</strong></div>
          <div>قيمة العرض: <strong>{formatMoney(offer.offer.totals?.total, offer.offer.currency || 'SAR') || 'غير مكتملة'}</strong></div>
          <div className="text-xs text-neutral-600">{coverage?.label || 'تغطية البنود غير مؤكدة'} · {lineIds.length} بند ضمن نطاق الترسية · {taxLabel(offer.offer.prices_include_tax)}</div>
          <div className="text-xs text-neutral-600">مدة التوريد: {leadTimeLabel(offer.offer)}</div>
        </div>
        {partial && <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 mb-4"><input type="checkbox" disabled={busy} checked={partialAccepted} onChange={(e) => setPartialAccepted(e.target.checked)} className="mt-0.5" />أوافق على ترسية البنود المسعّرة فقط ({lineIds.length} بند). البنود المتبقية تحتاج عروضًا وقرارًا مستقلًا.</label>}
        <label className="block text-sm font-bold mb-4">المشروع الذي ستُسجل عليه الترسية
          <select value={projectId} disabled={!projectsLoaded || busy} onChange={(e) => setProjectId(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm">
            <option value="">{projectsLoaded ? 'اختر المشروع' : 'جارٍ تحميل المشاريع…'}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.site_address ? ` — ${p.site_address}` : ''}</option>)}
            <option value="NEW">إنشاء مشروع جديد لهذا الطلب</option>
          </select>
        </label>
        {projectId === 'NEW' && <label className="block text-sm font-bold mb-4">اسم المشروع الجديد<input value={newName} disabled={busy || Boolean(createdProject.current)} onChange={(e) => setNewName(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-3 text-sm" /></label>}
        <div className="text-sm font-bold mb-2">سبب اختيار المورد</div>
        <div className="grid grid-cols-2 gap-2 mb-3">{REASONS.map((r) => <button key={r} disabled={busy} aria-pressed={reason === r} onClick={() => setReason(r)} className={`px-3 py-2 rounded-xl text-xs font-semibold border ${reason === r ? 'border-[#123F3A] bg-[#f0faf7] text-[#123F3A]' : 'border-neutral-200 text-neutral-700'}`}>{r}</button>)}</div>
        {reason === 'أخرى' && <textarea disabled={busy} value={other} onChange={(e) => setOther(e.target.value)} placeholder="اكتب سبب الترسية (5 أحرف على الأقل)" className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mb-3 min-h-[70px]" />}
        {(error || block) && <div role="alert" className="mb-3 rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2">{error || block}</div>}
        <p className="text-xs text-neutral-500 leading-relaxed mb-4">التأكيد يجعل العروض نهائية إن لزم ويسجّل قرار الترسية على المشروع المختار. الترسية لا تعني تنفيذ دفع. تحقق من حالة إشعار المورد في ملف الطلب بعد الحفظ.</p>
        <div className="flex gap-2"><button disabled={!ready || busy} onClick={confirm} className="flex-1 py-3 bg-[#123F3A] text-white font-bold rounded-xl text-sm disabled:opacity-40">{busy ? 'جارٍ تسجيل الترسية…' : 'تأكيد وتسجيل الترسية'}</button><button disabled={busy} onClick={onClose} className="px-5 py-3 border border-neutral-200 rounded-xl text-sm font-semibold">رجوع للمقارنة</button></div>
      </div>
    </div>
  )
}
