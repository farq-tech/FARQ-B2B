export type ListingRoomFactsInput = {
  area_sqm?: number | null
  beds?: number
  livings?: number
  wc?: number
}

export type ListingRoomFact = { kind: 'area' | 'beds' | 'livings' | 'wc'; value: number }

/** Explicit room counts, including zero, are ad facts; omit only missing counts. */
export function listingRoomFacts(listing: ListingRoomFactsInput): ListingRoomFact[] {
  return [
    listing.area_sqm ? { kind: 'area' as const, value: listing.area_sqm } : null,
    listing.beds != null ? { kind: 'beds' as const, value: listing.beds } : null,
    listing.livings != null ? { kind: 'livings' as const, value: listing.livings } : null,
    listing.wc != null ? { kind: 'wc' as const, value: listing.wc } : null,
  ].filter((item): item is ListingRoomFact => item !== null)
}
