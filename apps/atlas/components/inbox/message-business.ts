import { inboxBusiness } from '@/lib/inbox-feed'
import { businessById, districtById } from '@/lib/mock-data'
import type { InboxMessage } from '@/lib/types'

/** A message's business as its request saved it (name, activity, district), else the sample directory. Never a contact. */
export function messageBusiness(message: Pick<InboxMessage, 'businessId'>, request: Parameters<typeof inboxBusiness>[1]) {
  const sample = businessById.get(message.businessId)
  return inboxBusiness(message.businessId, request, sample ? { name: sample.name, category: sample.category, district: districtById.get(sample.districtId)?.name ?? null } : null)
}
