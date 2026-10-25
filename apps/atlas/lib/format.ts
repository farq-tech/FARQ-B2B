import type { RequestStatus, RequestType } from './types'

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
  if (!p) return 'غير متوفر'
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

export const TYPE_LABEL: Record<RequestType, string> = {
  rfq: 'طلب تسعير',
  list: 'قائمة محفوظة',
  campaign: 'مسودة حملة',
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
