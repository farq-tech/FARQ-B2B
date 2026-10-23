/**
 * Merge a paginated directory response without changing the authoritative
 * cohort totals returned by the service.  The browser can progressively add
 * every point in a selected district while the list remains deduplicated.
 */
export function appendUniqueDirectoryRows<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(current.map((row) => row.id))
  return [...current, ...incoming.filter((row) => !seen.has(row.id))]
}

/**
 * Some legacy directory responses have a correct total but omit `next_offset`.
 * The returned total and the page size remain enough to request the next page
 * deterministically, without inventing extra results.
 */
export function nextDirectoryOffset(total: number, loadedRows: number, upstreamNextOffset: number | null | undefined): number | null {
  const offset = typeof upstreamNextOffset === 'number' && upstreamNextOffset >= 0 ? upstreamNextOffset : loadedRows
  return offset < total ? offset : null
}
