import { businessById, districtById } from './mock-data'
import type { RequestItem } from './types'

/**
 * A business as a request knows it: the directory snapshot saved with the request when it came from the map (its
 * name, activity and district as the map showed them), else the sample directory. The same name on the map, in the
 * request, in its replies and in the inbox; «غير متاح» only when neither knows it. Never a contact.
 */
export function requestBusiness(id: string, request?: Pick<RequestItem, 'liveBusinesses'> | null): { name: string | null; category: string | null; district: string | null } {
  const live = request?.liveBusinesses?.find((business) => business.id === id)
  if (live) return { name: live.name || null, category: live.category || null, district: live.district || null }
  const sample = businessById.get(id)
  if (sample) return { name: sample.name, category: sample.category, district: districtById.get(sample.districtId)?.name ?? null }
  return { name: null, category: null, district: null }
}

export const businessName = (id: string, request?: Pick<RequestItem, 'liveBusinesses'> | null) => requestBusiness(id, request).name ?? 'غير متاح'
