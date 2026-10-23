/**
 * Merge a paginated directory response without changing the authoritative
 * cohort totals returned by the service.  The browser can progressively add
 * every point in a selected district while the list remains deduplicated.
 */
export function appendUniqueDirectoryRows<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(current.map((row) => row.id))
  return [...current, ...incoming.filter((row) => !seen.has(row.id))]
}
