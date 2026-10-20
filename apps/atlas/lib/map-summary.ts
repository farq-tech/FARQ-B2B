import type { Business } from './types'

export type MapLevel = 'districts' | 'clusters' | 'entities'

export const DISTRICT_MAX_ZOOM = 12.5
export const ENTITY_MIN_ZOOM = 14

export const LEVELS: { id: MapLevel; label: string; zoom: number }[] = [
  { id: 'districts', label: 'الأحياء', zoom: 11.9 },
  { id: 'clusters', label: 'التجمعات', zoom: 13.2 },
  { id: 'entities', label: 'المنشآت', zoom: 14.8 },
]

export interface AreaSummary {
  count: number
  selected: number
  reachable: number
  wholesale: number
  topCategories: { name: string; count: number }[]
}

export function summarize(items: Business[], selected: Set<string>): AreaSummary {
  const cats = new Map<string, number>()
  let sel = 0
  let reachable = 0
  let wholesale = 0
  for (const b of items) {
    cats.set(b.category, (cats.get(b.category) ?? 0) + 1)
    if (selected.has(b.id)) sel++
    if (b.whatsapp && b.consent === 'granted') reachable++
    if (b.wholesale) wholesale++
  }
  const topCategories = [...cats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }))
  return { count: items.length, selected: sel, reachable, wholesale, topCategories }
}

/** Relative concentration of matches in an area vs. the densest district in view. */
export function signalFor(intensity: number) {
  if (intensity >= 0.66) return { label: 'تركّز مرتفع', tone: 'high' as const }
  if (intensity >= 0.33) return { label: 'تركّز متوسط', tone: 'mid' as const }
  return { label: 'تركّز منخفض', tone: 'low' as const }
}
