import type { LiveBusinessSnapshot, RequestItem } from './types'

/**
 * Businesses picked on the map, added to a request that is still a draft: each business once (one already on the list
 * is not added again), its directory snapshot saved beside it, and for a campaign those that can receive WhatsApp
 * join its recipients (the review still decides). A request past its draft is not changed: null, and nothing added.
 */
export function mergeIntoRequest(request: RequestItem, businesses: readonly LiveBusinessSnapshot[]): { patch: Partial<RequestItem>; added: number } | null {
  if (request.status !== 'draft') return null
  const have = new Set(request.businessIds)
  const fresh = [...new Map(businesses.filter((business) => !have.has(business.id)).map((business) => [business.id, business])).values()]
  if (!fresh.length) return { patch: {}, added: 0 }
  const patch: Partial<RequestItem> = {
    businessIds: [...request.businessIds, ...fresh.map((business) => business.id)],
    liveBusinesses: [...(request.liveBusinesses ?? []), ...fresh],
  }
  if (request.campaign) {
    const included = new Set(request.campaign.included)
    patch.campaign = { ...request.campaign, included: [...request.campaign.included, ...fresh.filter((business) => business.whatsapp && !included.has(business.id)).map((business) => business.id)] }
  }
  return { patch, added: fresh.length }
}

/** The drafts a map pick can join: still drafts, made in the same city, the latest first. */
export function draftsFor(requests: readonly RequestItem[], cityId: string): RequestItem[] {
  const city = cityId.toLowerCase()
  return requests.filter((request) => request.status === 'draft' && request.cityId.toLowerCase() === city)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
