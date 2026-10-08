import { useRef, useState } from 'react'
import { ConstructionApiError, closeConstructionRfqSubmissions, openConstructionRfqEnvelopes, type ConstructionRfq } from '../../api/constructionClient'
export default function StepDialog({ openEnvelopes = false, step, rfq, deadlinePassed, quoted, onClose, onDone }: {
  openEnvelopes?: boolean
  step: 'close' | 'open'
  rfq: ConstructionRfq
  deadlinePassed: boolean
  quoted: number
  onClose: () => void
  onDone: (rfq: ConstructionRfq) => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const needsReason = step === 'close' ? (!deadlinePassed || (openEnvelopes && quoted < 2)) : quoted < 2
  const ready = !needsReason || reason.trim().length >= 5

  const lock = useRef(false)
  const confirm = async () => {
    if (!ready || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const updated = step === 'close'
        ? await closeConstructionRfqSubmissions(rfq.id, reason.trim(), openEnvelopes)
        : await openConstructionRfqEnvelopes(rfq.id, reason.trim())
      onDone(updated)
    } catch (err) {
      const status = err instanceof ConstructionApiError ? err.status : 0
      setError(status === 403 ? (step === 'open' ? 'فتح المظاريف يحتاج صلاحية مدير أو معتمد.' : 'الإغلاق يحتاج صلاحية مشتريات أو مدير.') : err instanceof Error ? err.message : 'تعذر التنفيذ')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-black text-[#0D1F1D] mb-2">{step === 'close' ? 'إغلاق استلام العروض' : 'فتح المظاريف'}</h2>
        <p className="text-sm text-neutral-600 mb-4">
          {step === 'close'
            ? `وصل ${quoted} ${quoted === 1 ? 'عرض' : 'عروض'}. بعد الإغلاق لا يُقبل عرض جديد ولا تعديل.`
            : `${quoted} ${quoted === 1 ? 'عرض' : 'عروض'} في الظرف. يُسجَّل الفتح باسمك ووقته.`}
        </p>
        {needsReason && (
          <label className="block text-sm font-bold text-[#0D1F1D] mb-3">
            {step === 'close' ? 'سبب الإغلاق المبكر أو الاكتفاء بالعروض المستلمة' : 'سبب فتح المظاريف بأقل من عرضين'}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm min-h-20" placeholder="خمسة أحرف على الأقل" />
          </label>
        )}
        {error && <div className="mb-3 rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div className="flex gap-2">
          <button disabled={!ready || busy} onClick={confirm} className="flex-1 py-2.5 bg-[#123F3A] text-white font-bold rounded-xl text-sm disabled:opacity-40">
            {busy ? 'جارٍ التنفيذ…' : 'تأكيد'}
          </button>
          <button disabled={busy} onClick={onClose} className="px-5 py-2.5 border border-neutral-200 rounded-xl text-sm font-semibold">إلغاء</button>
        </div>
      </div>
    </div>
  )
}

