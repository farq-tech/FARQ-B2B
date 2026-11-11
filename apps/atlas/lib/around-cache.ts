/** Cache keys start with a monotonically increasing site id: `siteId|reachKind|reachValue`. */
export function isActiveAroundKey(key: string, activeSiteIds: ReadonlySet<string>): boolean {
  return activeSiteIds.has(key.split('|', 1)[0])
}

/** Keep cached reaches for current sites so switching back is instant, and discard removed sites permanently. */
export function pruneAroundResults<T>(results: Record<string, T>, activeSiteIds: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(results).filter(([key]) => isActiveAroundKey(key, activeSiteIds)))
}
