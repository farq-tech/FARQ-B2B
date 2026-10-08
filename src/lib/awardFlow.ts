import type { ConstructionComparison, ConstructionRfq } from '../api/constructionClient'
const isHeldOffer = (cell: { status?: string; price_review?: unknown }) => cell.status === 'PRICE_REVIEW' || cell.price_review != null
import { requestState } from './requestFile'

export type AwardOffer = ConstructionComparison['supplier_responses'][number]

export function awardBlockReason(rfq: ConstructionRfq, row: AwardOffer): string | null {
  const state = requestState(rfq).key
  if (state === 'AWARDED') return 'تمت ترسية هذا الطلب بالفعل'
  if (state === 'CANCELLED' || state === 'DRAFT') return 'الطلب غير جاهز للترسية'
  if (state === 'OPEN') return 'أغلق استلام العروض قبل الترسية حتى تصبح العروض نهائية'
  if (!String(row.offer.quoteVersionId || '').trim()) return 'إصدار العرض غير متاح للترسية'
  if (row.eligibility?.eligible === false) return 'العرض يحتاج مراجعة قبل الترسية'
  if ((row.offer.totals as { complete?: boolean } | undefined)?.complete === false) return 'إجمالي العرض غير مكتمل'
  const total = row.offer.totals?.total
  if (total == null || !Number.isFinite(Number(total)) || Number(total) <= 0) return 'إجمالي العرض غير مكتمل'
  return null
}

export function pricedAwardLineIds(comparison: ConstructionComparison, supplierId?: string): string[] {
  return (comparison.quote_matrix?.lines || []).filter((line) => line.offers.some((cell) => cell.supplier_id === supplierId && cell.status === 'PRICED' && !isHeldOffer(cell) && cell.line_total != null && Number.isFinite(Number(cell.line_total)) && Number(cell.line_total) >= 0)).map((line) => line.id)
}

/** Detect a changed offer before an approval is written against an old review. */
export function awardReviewSignature(comparison: ConstructionComparison, row: AwardOffer): string {
  return JSON.stringify({ offer: row.offer, eligibility: row.eligibility, summary: comparison.quote_matrix?.supplier_summaries?.find((s) => s.supplier_id === row.supplier.id), lines: comparison.quote_matrix?.lines.map((line) => ({ id: line.id, offers: line.offers.filter((cell) => cell.supplier_id === row.supplier.id) })) })
}
