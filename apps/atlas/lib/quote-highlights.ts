import type { QuoteLine } from './types'

export type QuoteFacts = { id: string; quote?: { lines: QuoteLine[]; deliveryDays?: number | null } }

/** A quote's total as the supplier sent it: Σ unit price × quantity over its own lines. */
export const quoteTotal = (q: QuoteFacts) => q.quote?.lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0) ?? 0

/**
 * Which quotes stand out, from the suppliers' own figures only. A highlight needs at least two quotes to compare
 * (one quote is neither the cheapest nor the fastest of anything); a tie marks every quote that shares the best value;
 * delivery is compared only among the quotes that state it. `overLowest` is how much more each quote costs than the
 * lowest total (0 for the lowest).
 */
export function quoteHighlights(quotes: QuoteFacts[]) {
  const lowest = new Set<string>()
  const fastest = new Set<string>()
  const overLowest = new Map<string, number>()
  if (quotes.length < 2) return { lowest, fastest, overLowest }
  const min = Math.min(...quotes.map(quoteTotal))
  for (const q of quotes) {
    const total = quoteTotal(q)
    overLowest.set(q.id, total - min)
    if (total === min) lowest.add(q.id)
  }
  const timed = quotes.filter((q) => typeof q.quote?.deliveryDays === 'number')
  if (timed.length >= 2) {
    const quickest = Math.min(...timed.map((q) => q.quote!.deliveryDays as number))
    // all quotes promising the same time is no distinction
    if (timed.some((q) => q.quote!.deliveryDays !== quickest)) for (const q of timed) if (q.quote!.deliveryDays === quickest) fastest.add(q.id)
  }
  if (lowest.size === quotes.length) lowest.clear()   // every total equal: nothing is «the lowest»
  return { lowest, fastest, overLowest }
}
