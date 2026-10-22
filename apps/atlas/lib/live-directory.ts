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

/** Removes contacts and operational source fields from directory rows before the browser sees them. */
export function sanitizeLiveDirectoryEntity(row: Record<string, unknown>): PublicDirectoryEntity {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 8) : []
  return {
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
    status: ['open', 'closed_temporary', 'inactive', 'hidden', 'unknown_empty', 'unknown_invalid', 'closed_permanent'].includes(String(row.status_class)) ? row.status_class as PublicDirectoryEntity['status'] : null,
  }
}

export function isMapQuery(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
}
