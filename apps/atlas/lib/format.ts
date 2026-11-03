import { cityById } from './mock-data'
import type { RequestItem, RequestStatus, RequestType } from './types'

const dateFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Riyadh',
})

const dateTimeFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Riyadh',
})

const numFmt = new Intl.NumberFormat('en-US')

export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso))
export const formatNumber = (n: number) => numFmt.format(n)
export const formatSar = (n: number) => `${numFmt.format(n)} ر.س`

export function formatPhone(p: string | null) {
  if (!p) return 'غير متاح'
  return `${p.slice(0, 4)} ${p.slice(4, 6)} ${p.slice(6, 9)} ${p.slice(9)}`
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: 'مسودات',
  needs_decision: 'تحتاج قرارك',
  ready_manual: 'جاهزة للإرسال',
  awaiting: 'بانتظار الردود',
  completed: 'مكتملة',
}

export const STATUS_SINGULAR: Record<RequestStatus, string> = {
  draft: 'مسودة',
  needs_decision: 'تحتاج قرارك',
  ready_manual: 'جاهزة للإرسال',
  awaiting: 'بانتظار الردود',
  completed: 'مكتمل',
}

/** What the person does next with a request in each status, said on its row so the list reads as a to-do. */
export const NEXT_STEP: Record<RequestStatus, string | null> = {
  draft: 'أكمل المسودة وراجعها',
  needs_decision: 'قارن العروض واختر المورد',
  ready_manual: 'راجعه مرة أخيرة وأرسله بتأكيدك',
  awaiting: 'تابع الردود في الوارد',
  completed: null,
}

export const TYPE_LABEL: Record<RequestType, string> = {
  rfq: 'طلب تسعير',
  list: 'قائمة محفوظة',
  // the status says whether it is still a draft; the type says only what kind of request it is
  campaign: 'حملة واتساب',
}

/**
 * The next step for one request. A ready quote request is shared by the person (Atlas sends nothing for it), a ready
 * campaign goes out one confirmed batch at a time, so «ready» does not read the same for both.
 */
export function nextStep(status: RequestStatus, type: RequestType): string | null {
  if (status === 'ready_manual' && type === 'rfq') return 'انسخ نص الطلب وشاركه بنفسك'
  if (status === 'ready_manual' && type === 'campaign') return 'أرسل الدفعة عبر واتساب بتأكيدك'
  return NEXT_STEP[status]
}

/** The status badge's words for one request: a ready quote request is ready to share, not to send. */
export function statusLabel(status: RequestStatus, type: RequestType): string {
  if (status === 'ready_manual' && type === 'rfq') return 'جاهز للمشاركة'
  if (status === 'ready_manual' && type === 'campaign') return 'جاهزة للإرسال عبر واتساب'
  return STATUS_SINGULAR[status]
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** The city a request was made in, in Arabic: the name saved with it, else the sample list's; undefined when neither knows it. */
export const cityOf = (request: Pick<RequestItem, 'cityId' | 'cityName'>): string | undefined => request.cityName ?? cityById.get(request.cityId)?.name
