import type { RequestItem } from './types'

/** The one identity a request has on this device and in the account: its cloud id once saved, its local id before. */
export const requestKey = (request: Pick<RequestItem, 'id' | 'remoteId'>) => request.remoteId ?? request.id

/**
 * The account's saved requests joined to what is on screen now. Nothing on screen is replaced or reordered: a request
 * the screen already has (by requestKey) keeps the local copy, with the person's edits; only new ones are added, after.
 * Returns the same array when there is nothing new, so a store can skip the update.
 */
export function mergeCloudRequests<T extends Pick<RequestItem, 'id' | 'remoteId'>>(current: T[], cloud: T[]): T[] {
  const have = new Set(current.map(requestKey))
  const fresh = cloud.filter((request) => {
    const key = requestKey(request)
    if (have.has(key)) return false
    have.add(key)   // the account sending one request twice adds it once
    return true
  })
  return fresh.length ? [...current, ...fresh] : current
}
