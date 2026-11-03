// with extensions, so node --test can load this file for lib/access-request.test.ts
import { LENS_GOALS, type LensId } from '../components/lens/lenses.ts'

/**
 * «اطلب حساباً»: what a new customer tells Farq to be given an Atlas account, checked the same way in the form and in
 * the server route (app/api/access-request/route.ts), and checked again where it is stored
 * (services/targeting-api/access_requests.py). Nothing here sends anything: Farq reviews every request by hand.
 */
export type AccessCategory = LensId | 'supplier'

/** The customer groups, worded as the landing page's goals (LENS_GOALS, then the search's own card). */
export const ACCESS_CATEGORIES: { id: AccessCategory; label: string }[] = [
  ...(Object.keys(LENS_GOALS) as LensId[]).map((id) => ({ id, label: LENS_GOALS[id] })),
  { id: 'supplier', label: 'أبحث عن مورد' },
]

export type AccessRequestInput = {
  name: string
  company: string
  /** A work email or a Saudi mobile, as typed. */
  contact: string
  /** The city's English name from the shared city list (lib/insights-api.ts useCities). */
  city: string
  category: string
  purpose: string
}

export type AccessField = keyof AccessRequestInput
export type AccessErrors = Partial<Record<AccessField, string>>

const LIMITS = { name: [2, 80], company: [2, 120], purpose: [0, 500] } as const
const ARABIC_DIGITS = /[٠-٩۰-۹]/g
const EMAIL = /^[^\s@<>"']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/
const CITY = /^[A-Za-z][A-Za-z .'-]{0,79}$/

/** A typed line: control characters and angle brackets dropped, spaces folded. */
export function cleanLine(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim() : ''
}

/** Digits typed in Arabic-Indic or Persian forms, as 0-9. */
// U+0660…0669 and U+06F0…06F9: the low four bits are the digit
const englishDigits = (value: string) => value.replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) & 0xf))

/** The contact as it is stored: a lower-case email, or a Saudi mobile as +9665XXXXXXXX; null when it is neither. */
export function normalizeContact(raw: unknown): { kind: 'email' | 'mobile'; value: string } | null {
  if (typeof raw !== 'string') return null
  const text = englishDigits(raw).trim()
  if (text.includes('@')) {
    const email = text.toLowerCase()
    return email.length <= 254 && EMAIL.test(email) ? { kind: 'email', value: email } : null
  }
  const match = /^(?:\+?966|00966|0)?(5\d{8})$/.exec(text.replace(/[\s\-()]/g, ''))
  return match ? { kind: 'mobile', value: `+966${match[1]}` } : null
}

/**
 * Every field that does not pass, with what to fix in plain Arabic. `cities` (English names) limits the city when
 * the list has loaded; without it any well-formed name passes here and the service checks it against its own list.
 */
export function validateAccessRequest(input: Partial<Record<AccessField, unknown>>, cities?: readonly string[]): AccessErrors {
  const errors: AccessErrors = {}
  const name = cleanLine(input.name)
  if (!name) errors.name = 'اكتب اسمك.'
  else if (name.length < LIMITS.name[0] || name.length > LIMITS.name[1]) errors.name = 'اكتب اسمك في 2 إلى 80 حرفاً.'
  const company = cleanLine(input.company)
  if (!company) errors.company = 'اكتب اسم الجهة التي تعمل فيها.'
  else if (company.length < LIMITS.company[0] || company.length > LIMITS.company[1]) errors.company = 'اكتب اسم الجهة في 2 إلى 120 حرفاً.'
  const contact = typeof input.contact === 'string' ? input.contact.trim() : ''
  if (!contact) errors.contact = 'اكتب بريد العمل أو رقم الجوال.'
  else if (!normalizeContact(contact)) errors.contact = contact.includes('@') ? 'البريد غير صحيح. مثال: name@company.sa' : 'رقم الجوال غير صحيح. مثال: 05XXXXXXXX'
  const city = typeof input.city === 'string' ? input.city : ''
  if (!city || !CITY.test(city) || (cities && cities.length && !cities.includes(city))) errors.city = 'اختر مدينتك من القائمة.'
  if (!ACCESS_CATEGORIES.some((category) => category.id === input.category)) errors.category = 'اختر ما يصف عملك.'
  if (cleanLine(input.purpose).length > LIMITS.purpose[1]) errors.purpose = 'اختصر ما تريد في 500 حرف أو أقل.'
  return errors
}

/** The request as it is sent: cleaned lines, the contact as typed (the service keeps its normalized form). */
export function accessRequestBody(input: AccessRequestInput, next: string | null) {
  return {
    name: cleanLine(input.name),
    company: cleanLine(input.company),
    contact: input.contact.trim(),
    city: input.city,
    category: input.category,
    purpose: cleanLine(input.purpose),
    next: safeNext(next),
  }
}

/** A return address inside Atlas, or null. */
export function safeNext(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && value.length <= 500 ? value : null
}

/** The order the fields appear in, so the first one to fix gets the focus. */
export const ACCESS_FIELD_ORDER: AccessField[] = ['name', 'company', 'contact', 'city', 'category', 'purpose']

/**
 * The category the person most likely is, read from where they came from: the map's group (`lens=`) or the
 * supplier search (`goal=find-supplier`). Only a suggestion, preselected in the form; '' when the address says nothing.
 */
export function categoryFromNext(next: string | null | undefined): AccessCategory | '' {
  const safe = safeNext(next)
  if (!safe) return ''
  const query = new URLSearchParams(safe.split('?')[1] ?? '')
  const lens = query.get('lens')
  if (lens && Object.hasOwn(LENS_GOALS, lens)) return lens as LensId
  return query.get('goal') === 'find-supplier' ? 'supplier' : ''
}

export const REQUEST_ACCESS_PATH = '/request-access'
/** «احذف بياناتي»: asks Farq to delete what an account request holds (app/api/access-request/deletion). */
export const DELETE_DETAILS_PATH = '/request-access/delete'

/** The «اطلب حساباً» page, told where to send the person back once the request is sent (same rule as the login's). */
export function requestAccessHref(here: string | null | undefined): string {
  const next = safeNext(here)
  return next && next !== REQUEST_ACCESS_PATH ? `${REQUEST_ACCESS_PATH}?next=${encodeURIComponent(next)}` : REQUEST_ACCESS_PATH
}
