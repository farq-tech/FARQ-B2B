// with extensions, so node --test can load this file for lib/ask-vs-range.test.ts
import { numberFormat } from './insights-api.ts'

/**
 * A listing's asking price against the expected range Atlas worked out for the same answers, in one line from those
 * two figures only: inside the range, or above or below it by how much (as a share of the nearer end). Null when either
 * figure is missing, so nothing is said that the page cannot show.
 */
export function askVsRange(ask: number | null | undefined, range: { low: number; high: number } | null | undefined): { tone: 'inside' | 'above' | 'below'; text: string } | null {
  if (ask == null || !range || !(ask > 0) || !(range.low > 0) || !(range.high >= range.low)) return null
  if (ask < range.low) return { tone: 'below', text: `أقل من المدى المتوقع بـ ${numberFormat.format(Math.round((100 * (range.low - ask)) / range.low))}%` }
  if (ask > range.high) return { tone: 'above', text: `أعلى من المدى المتوقع بـ ${numberFormat.format(Math.round((100 * (ask - range.high)) / range.high))}%` }
  return { tone: 'inside', text: 'ضمن المدى المتوقع' }
}
