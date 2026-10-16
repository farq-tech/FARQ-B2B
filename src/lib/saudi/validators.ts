/*
 * Saudi company identifiers, checked by their published shape only (no registry lookup):
 *   السجل التجاري — 10 digits.
 *   الرقم الضريبي (ZATCA VAT) — 15 digits, starts with 3 and ends with 3.
 *   العنوان الوطني (SPL) — short address: 4 letters + 4 digits (e.g. RRRD2929); building number 4 digits;
 *   additional number 4 digits; postal code 5 digits; street, district and city as text.
 * Arabic-Indic digits typed on an Arabic keyboard are accepted and stored as Latin digits.
 */
export const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
const digits = (s: string) => toLatinDigits(String(s ?? '')).replace(/[\s-]/g, '')

export const normalizeCr = digits
export const normalizeVat = digits
export const normalizeShortAddress = (s: string) => toLatinDigits(String(s ?? '')).replace(/[\s-]/g, '').toUpperCase()

export const isValidCr = (s: string) => /^\d{10}$/.test(normalizeCr(s))
export const isValidVat = (s: string) => /^3\d{13}3$/.test(normalizeVat(s))
export const isValidShortAddress = (s: string) => /^[A-Z]{4}\d{4}$/.test(normalizeShortAddress(s))
export const isValidBuildingNo = (s: string) => /^\d{4}$/.test(digits(s))
export const isValidAdditionalNo = (s: string) => /^\d{4}$/.test(digits(s))
export const isValidPostalCode = (s: string) => /^\d{5}$/.test(digits(s))

/** Empty is allowed (optional fields); a wrong shape gives the Arabic reason. */
export function crError(s: string): string | null {
  if (!String(s ?? '').trim()) return null
  return isValidCr(s) ? null : 'السجل التجاري ١٠ أرقام.'
}
export function vatError(s: string): string | null {
  if (!String(s ?? '').trim()) return null
  const v = normalizeVat(s)
  if (!/^\d+$/.test(v) || v.length !== 15) return 'الرقم الضريبي ١٥ رقمًا.'
  return isValidVat(v) ? null : 'الرقم الضريبي يبدأ بـ 3 وينتهي بـ 3.'
}

export type NationalAddress = { shortAddress: string; buildingNo: string; street: string; district: string; city: string; postalCode: string; additionalNo: string }
export const EMPTY_NATIONAL_ADDRESS: NationalAddress = { shortAddress: '', buildingNo: '', street: '', district: '', city: '', postalCode: '', additionalNo: '' }

/** Errors per field of a national address; an address left fully empty is valid (optional). */
export function nationalAddressErrors(a: NationalAddress): Partial<Record<keyof NationalAddress, string>> {
  const any = Object.values(a).some((v) => String(v ?? '').trim())
  if (!any) return {}
  const out: Partial<Record<keyof NationalAddress, string>> = {}
  if (!isValidShortAddress(a.shortAddress)) out.shortAddress = 'العنوان المختصر ٤ حروف إنجليزية ثم ٤ أرقام، مثل RRRD2929.'
  if (a.buildingNo.trim() && !isValidBuildingNo(a.buildingNo)) out.buildingNo = 'رقم المبنى ٤ أرقام.'
  if (a.additionalNo.trim() && !isValidAdditionalNo(a.additionalNo)) out.additionalNo = 'الرقم الإضافي ٤ أرقام.'
  if (a.postalCode.trim() && !isValidPostalCode(a.postalCode)) out.postalCode = 'الرمز البريدي ٥ أرقام.'
  if (!a.city.trim()) out.city = 'اكتب المدينة.'
  return out
}

/** One line for documents and the RFQ payload: «RRRD2929 · 2929 شارع … · حي … · الرياض 12345 · 1234». */
export function formatNationalAddress(a: NationalAddress): string {
  const short = normalizeShortAddress(a.shortAddress)
  const line = [short, [digits(a.buildingNo), a.street.trim()].filter(Boolean).join(' '), a.district.trim() ? `حي ${a.district.trim().replace(/^حي\s+/, '')}` : '', [a.city.trim(), digits(a.postalCode)].filter(Boolean).join(' '), digits(a.additionalNo) ? `الرقم الإضافي ${digits(a.additionalNo)}` : '']
  return line.filter(Boolean).join(' · ')
}
