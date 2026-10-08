import type { RFQSummary } from '../types'
import {
  formatArDate,
  formatRfqReference,
  mapRfqUiStatus,
  type ConstructionRfqSummary,
} from '../api/constructionClient'

/**
 * How a request is named on screen.
 *
 * Every request used to read «القسم المدني والإنشائي — الرياض» over a raw
 * UUID, so a buyer with five requests could not tell them apart. The project
 * name the buyer typed (or the file it came from) now leads, the department
 * and city follow, and the short reference is the one suppliers see.
 */
export function rfqProjectName(rfq: Pick<ConstructionRfqSummary, 'delivery'>): string {
  const site = String(rfq.delivery?.site_address || '').trim()
  const city = String(rfq.delivery?.city || '').trim()
  const project = site.split(' — ')[0]?.trim() || ''
  if (!project || project === city) return ''
  return project.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
}

export function rfqClosing(deadline?: string | null, time?: string | null): { label?: string; urgent?: boolean } {
  if (!deadline) return {}
  const ts = Date.parse(`${deadline}T${time || '23:59'}:00+03:00`)
  if (Number.isNaN(ts)) return {}
  const hours = (ts - Date.now()) / 3_600_000
  if (hours <= 0) return { label: 'انتهى موعد العروض', urgent: false }
  if (hours < 24) return { label: `يغلق خلال ${Math.max(1, Math.round(hours))} ساعة`, urgent: true }
  const days = Math.ceil(hours / 24)
  return { label: days === 1 ? 'يغلق غدًا' : days === 2 ? 'يغلق بعد يومين' : `يغلق بعد ${days} أيام`, urgent: days <= 2 }
}

export function toRfqSummary(r: ConstructionRfqSummary): RFQSummary {
  const dept = r.engineering_department?.label_ar || ''
  const city = r.delivery?.city || ''
  const project = rfqProjectName(r)
  const closing = rfqClosing(r.quote_deadline, r.quote_deadline_time)
  return {
    id: r.id,
    name: project || dept || 'طلب تسعير',
    reference: formatRfqReference(r.id, r.engineering_department || null),
    subtitle: [project ? dept : '', city].filter(Boolean).join(' · '),
    items: r.line_count || 0,
    offers: r.response_count || 0,
    suppliers: r.supplier_count || 0,
    sent: r.sent_count ?? undefined,
    replied: r.replied_count ?? undefined,
    status: mapRfqUiStatus(r.status, r.award_id),
    date: formatArDate(r.created_at),
    deadline: r.delivery?.required_date ? formatArDate(r.delivery.required_date) : undefined,
    closesLabel: r.award_id ? undefined : closing.label,
    closesUrgent: r.award_id ? false : closing.urgent,
  }
}
