import { useCallback, useEffect, useMemo, useState } from 'react'
import { getConstructionComparison, getConstructionRfq, type ConstructionComparison, type ConstructionRfq } from '../../api/constructionClient'
import { matrixTotals, quoteCoverage } from '../../lib/requestFile'
import { Button } from '../../ui'
import AwardConfirmSheet from './AwardConfirmSheet'

/*
 * «05 · تأكيد الترسية» as a page (/requests/:id/award, wired by the Lead).
 * Loads the request and its comparison (the same two GETs screen 04 makes) and
 * opens the Confirm Sheet on the chosen offer. Screen 04 opens the same sheet
 * in place, so this page is only the deep-link entry.
 *
 * Offer choice: `supplierId` when given, otherwise the cheapest complete offer
 * named by matrixTotals (the rule screen 04 uses; ≥ 2 complete offers needed).
 * Coverage uses the one-argument quoteCoverage (committed form): decision 4 forbids
 * building new calls on the uncommitted second argument.
 */
export type AwardPageProps = {
  rfqId: string
  /** Supplier whose offer is being awarded; defaults to matrixTotals().lowest. */
  supplierId?: string | null
  /** Back to the comparison (screen 04). */
  onBack: () => void
  /** After the award is recorded (receives the API response). */
  onDone: (award: Record<string, unknown>) => void
}

export default function AwardPage({ rfqId, supplierId, onBack, onDone }: AwardPageProps) {
  const [rfq, setRfq] = useState<ConstructionRfq | null>(null)
  const [comparison, setComparison] = useState<ConstructionComparison | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [r, c] = await Promise.all([getConstructionRfq(rfqId), getConstructionComparison(rfqId)])
      setRfq(r); setComparison(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل العروض')
    }
  }, [rfqId])
  useEffect(() => { void load() }, [load])

  const target = useMemo(() => supplierId || matrixTotals(comparison?.quote_matrix).lowest, [supplierId, comparison])
  const offer = useMemo(() => (comparison?.supplier_responses || []).find((r) => String(r.supplier.id) === target) || null, [comparison, target])
  const summary = comparison?.quote_matrix?.supplier_summaries?.find((s) => String(s.supplier_id) === target)

  return (
    <div className="pricing-v2 flex min-h-full flex-col items-start gap-3 bg-transparent p-8 text-start text-[var(--color-text-primary)]">
      {error ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-[16px] leading-[26px] font-medium text-[var(--color-text-danger)]">{error}</p>
          <div className="flex gap-3"><Button variant="Secondary" size="M" icon="refresh" onClick={() => void load()}>أعد المحاولة</Button><Button variant="Ghost" size="M" onClick={onBack}>رجوع للمقارنة</Button></div>
        </div>
      ) : !rfq || !comparison ? (
        <p role="status" className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">جارٍ تحميل العرض…</p>
      ) : !offer ? (
        <div role="status" className="flex flex-col items-start gap-3">
          <p className="text-[16px] leading-[26px] font-medium">لا يوجد عرض جاهز للترسية</p>
          <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{supplierId ? 'هذا المورد ما أرسل عرضًا على الطلب.' : 'نحتاج عرضين كاملين على الأقل للمقارنة قبل اقتراح مورد للترسية.'}</p>
          <Button variant="Secondary" size="M" onClick={onBack}>رجوع للمقارنة</Button>
        </div>
      ) : (
        <AwardConfirmSheet rfq={rfq} comparison={comparison} offer={offer} coverage={quoteCoverage(summary)} onClose={onBack} onDone={onDone} />
      )}
    </div>
  )
}
