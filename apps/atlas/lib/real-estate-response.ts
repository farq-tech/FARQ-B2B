/** Read the number of listings missing density from a response without turning an omitted field into zero. */
export function densityUnavailableCount(value: unknown, densityFilterActive: boolean): number | null {
  if (!densityFilterActive) return 0
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** A server total is known only when it is a valid count at least as large as the returned page. */
export function listingTotal(value: unknown, received: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= received && received >= 0 ? value : null
}
