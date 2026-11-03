import type { LiveBusinessSnapshot } from '@/lib/types'

export type PublicDirectoryEntity = LiveBusinessSnapshot & {
  verification: 'verified' | 'unverified' | 'unknown' | null
  roles: string[]
  specialties: string[]
  status: string | null
}

function asText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

// placeholders the directory's free text uses for "no value"; treated as absent so no empty row is shown
const PLACEHOLDER = new Set(['', 'no information', 'n/a', '-', 'null'])
/** A trimmed content string, or '' when the value is missing or a known placeholder. */
function content(value: unknown, max: number) {
  const text = asText(value, max)
  return PLACEHOLDER.has(text.toLowerCase()) ? '' : text
}
/** A non-negative count from a number or a numeric string (targets stores reviews_count as varchar), else null. */
function count(value: unknown): number | null {
  let n: number
  if (typeof value === 'number') n = value
  else if (typeof value === 'string') {
    const digits = value.replace(/[^\d.]/g, '')
    if (!digits) return null
    n = Number(digits)
  } else return null
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}
/** extra_phones may be a delimited string or a list; parse to de-duplicated, blank-free entries. */
function phoneList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;|\/\n]+/) : []
  const out: string[] = []
  for (const item of raw) {
    const text = content(item, 32)
    if (text && !out.includes(text)) out.push(text)
  }
  return out.slice(0, 6)
}

/** Removes contacts and operational source fields from directory rows before the browser sees them. */
export function sanitizeLiveDirectoryEntity(row: Record<string, unknown>): PublicDirectoryEntity {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 8) : []
  const entity: PublicDirectoryEntity = {
    id: asText(row.poi_key, 180),
    name: asText(row.name_ar, 180) || asText(row.name_en, 180) || 'منشأة غير مسماة',
    category: asText(row.category_ar, 120) || asText(row.category, 120) || 'غير مصنّف',
    district: asText(row.district_ar, 120),
    street: asText(row.street_ar, 140),
    latitude: number(row.latitude),
    longitude: number(row.longitude),
    wholesale: row.is_wholesale === true,
    whatsapp: row.has_whatsapp === true,
    verification: ['verified', 'unverified', 'unknown'].includes(String(row.whatsapp_verification_state)) ? row.whatsapp_verification_state as PublicDirectoryEntity['verification'] : null,
    roles: strings(row.role_badges),
    specialties: strings(row.specialties),
    reason: asText(row.reason, 240),
    fit: row.ai === 'L' || row.ai === 'M' || row.ai === 'N' ? row.ai : null,
    brandName: asText(row.brand_name ?? row.urbi_brand_name, 160) || undefined,
    legalName: asText(row.legal_name ?? row.urbi_legal_name, 180) || undefined,
    branchCount: asText(row.branch_count ?? row.urbi_branches_count ?? row.branches_count, 32) || undefined,
    employeeCount: asText(row.employee_count ?? row.urbi_employee_count ?? row.employees_band, 48) || undefined,
    operatingHours: asText(row.operating_hours ?? row.opening_hours ?? row.urbi_working_hours, 500) || undefined,
    paymentMethods: asText(row.payment_methods ?? row.urbi_payment_methods, 160) || undefined,
    serviceLanguages: asText(row.service_languages ?? row.urbi_service_languages, 120) || undefined,
    floor: asText(row.floor ?? row.urbi_floor ?? row.floor_no, 32) || undefined,
    buildingUse: asText(row.building_use ?? row.linked_building_use_ar ?? row.building_use_ar, 100) || undefined,
    makani: asText(row.makani ?? row.urbi_makani, 32) || undefined,
    atlasId: asText(row.farq_atlas_id, 32) || undefined,
    // v7 non-contact directory details: the official description and delivery-app signals (shown as Farq, no source)
    description: asText(row.description, 1200) || undefined,
    deliveryRating: number(row.delivery_rating) ?? undefined,
    deliveryRateCount: number(row.delivery_rate_count) ?? undefined,
    deliveryFee: number(row.delivery_fee) ?? undefined,
    deliveryMinOrder: number(row.delivery_min_order) ?? undefined,
    deliveryEta: asText(row.delivery_eta, 48) || undefined,
    status: ['open', 'closed_temporary', 'inactive', 'hidden', 'unknown_empty', 'unknown_invalid', 'closed_permanent'].includes(String(row.status_class)) ? row.status_class as PublicDirectoryEntity['status'] : null,
    // v13 enrichment: the operating-status vote shown as a line, the canonical weekly hours (for the open-now badge),
    // and the WhatsApp state. Confidence is never shown as a number, only used to dim a low-confidence status.
    statusVoted: ['open', 'closed_temporary', 'closed_permanent', 'inactive', 'unknown_empty', 'unknown_invalid'].includes(String(row.status_voted)) ? String(row.status_voted) : undefined,
    statusConfidence: ['low', 'medium', 'high'].includes(String(row.status_voted_confidence)) ? row.status_voted_confidence as PublicDirectoryEntity['statusConfidence'] : undefined,
    lastSeenAt: asText(row.last_seen_at, 10) || undefined,
    isStale: row.is_stale === true ? true : undefined,
    hoursWeek: asText(row.hours_week, 1200) || undefined,
    whatsappState: ['verified', 'source_flag_unverified', 'not_available'].includes(String(row.whatsapp_state)) ? row.whatsapp_state as PublicDirectoryEntity['whatsappState'] : undefined,
    // listing content already collected by the directory, shown as Farq (no provider named); a missing or placeholder
    // value is left out, so the card renders no empty row for it
    website: content(row.website, 300) || undefined,
    instagram: content(row.instagram, 200) || undefined,
    facebook: content(row.facebook, 200) || undefined,
    snapchat: content(row.snapchat, 200) || undefined,
    tiktok: content(row.tiktok, 200) || undefined,
    xLink: content(row.x_link, 200) || undefined,
    linkedin: content(row.linkedin, 200) || undefined,
    menuLink: content(row.menu_link, 300) || undefined,
    orderLink: content(row.order_link, 300) || undefined,
    reservationLink: content(row.reservation_link, 300) || undefined,
    reviewsCount: count(row.reviews_count) ?? undefined,
    fullAddressAr: content(row.full_address_ar, 300) || undefined,
    fullAddressEn: content(row.full_address_en, 300) || undefined,
    nationalAddress: content(row.national_address, 120) || undefined,
    postalCode: content(row.postal_code, 20) || undefined,
    descriptionEn: content(row.description_en, 1200) || undefined,
    extraPhones: phoneList(row.extra_phones).length ? phoneList(row.extra_phones) : undefined,
  }
  // an optional detail the row does not carry is left out, so the browser gets only the fields that exist
  for (const key of Object.keys(entity) as (keyof PublicDirectoryEntity)[]) if (entity[key] === undefined) delete entity[key]
  return entity
}

export function isMapQuery(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
}
