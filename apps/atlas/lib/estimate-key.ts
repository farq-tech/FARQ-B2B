// with extensions, so node --test can load this file for lib/estimate-key.test.ts

/**
 * One name for one price-estimate question, whoever asks it (a listing card, «سعّر عقارك»): the same answers give the
 * same key whatever order their fields were written in, and an absent answer is the same as one left empty. The visit's
 * answer cache keeps each answer under it, so the price page opened from a card shows the card's estimate at once.
 */
export function estimateKey(ask: Record<string, string | number | null | undefined>): string {
  const fields = Object.entries(ask).filter(([, value]) => value != null && value !== '').map(([key, value]) => [key, String(value)] as const)
  fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `estimate|${fields.map(([key, value]) => `${key}=${value}`).join('&')}`
}

/** The visit cache's name for price estimates (useAnswer's `cache`, and the price page's own ask). */
export const ESTIMATE_CACHE = 'price'

/** An estimate worth keeping for the visit: one that answered (a price or a reason), never a failure. */
export const keepEstimate = (value: unknown) => Boolean(value && typeof value === 'object' && 'available' in value)
