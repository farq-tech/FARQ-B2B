// Copied from فرق بناء (read-only source): farqconstraction/src/lib/autoPick.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
import type { BOQItem, Supplier } from '../types'

/** How many suppliers the system chooses for a line on its own. */
export const AUTO_PICK = 10

const ACTIVITY_GRADE = 'على مستوى النشاط'

/**
 * What the booklet itself says about each supplier's breadth.
 *
 * `breadth` is the number of DISTINCT material families a supplier was
 * suggested for anywhere in this booklet. A steel supplier suggested on two
 * hundred steel lines has breadth 1; a general-contracting supplier the
 * register lists under every trade has breadth 20. Families, never lines, so
 * being right often is not punished, only being everywhere.
 */
export type PickContext = { breadth: Map<string, number> }

/** The material a line is about, at family granularity where one is known. */
function materialKeyOf(item: BOQItem): string | null {
  return (
    item.mapSuggestion?.family ||
    item.aiSuggestion?.family ||
    item.familySuggestion?.family ||
    item.mapSuggestion?.intent ||
    item.aiSuggestion?.intent ||
    item.farqSpecId ||
    item.lineKey ||
    null
  )
}

function lanesOf(item: BOQItem): Supplier[][] {
  return [
    item.learnedSuggestion?.suppliers || [],
    item.mapSuggestion?.suppliers || [],
    item.suppliers,
    item.aiSuggestion?.suppliers || [],
    item.familySuggestion?.suppliers || [],
  ]
}

/** Read once per booklet, then handed to every `autoPickFor` call. */
export function buildPickContext(items: BOQItem[]): PickContext {
  const families = new Map<string, Set<string>>()
  for (const item of items) {
    if (item.workOnly) continue
    const key = materialKeyOf(item)
    if (!key) continue
    for (const lane of lanesOf(item)) {
      for (const s of lane) {
        if (!s?.id) continue
        let set = families.get(s.id)
        if (!set) families.set(s.id, (set = new Set()))
        set.add(key)
      }
    }
  }
  const breadth = new Map<string, number>()
  for (const [id, set] of families) breadth.set(id, set.size)
  return { breadth }
}

/** Specialists first; equal breadth keeps the server's order. */
function specialistsFirst(lane: Supplier[], context?: PickContext): Supplier[] {
  if (!context || lane.length < 2) return lane
  return lane
    .map((s, i) => ({ s, i, b: context.breadth.get(s.id) ?? 1 }))
    .sort((a, b) => a.b - b.b || a.i - b.i)
    .map((x) => x.s)
}

/**
 * The suppliers the system would choose for a line, best first.
 *
 * One rule, read by both screens. The upload summary used to count only the
 * catalogue's confirmed matches (25 suppliers for 1,514 lines) while the
 * proposals page chose five for every line from every source, so the owner
 * saw two answers to one question.
 *
 * Order: what he chose before, suppliers named for the material, catalogue
 * matches, the named-suggestion lane, suppliers of the activity («مورد
 * محتمل»), then the family and sector. Never one he rejected.
 *
 * Inside every lane except his own choices, the specialist comes before the
 * generalist (see `PickContext`). Without that, a thin confirmed map let the
 * same handful of general suppliers fill the first five slots of nearly every
 * line, whatever the material was («نفس الموردين ثابتين على كل بند»).
 */
export function autoPickFor(item: BOQItem, limit = AUTO_PICK, context?: PickContext): Supplier[] {
  const rejected = new Set(item.rejectedSupplierIds || [])
  const map = item.mapSuggestion?.suppliers || []
  const ordered = [
    ...(item.learnedSuggestion?.suppliers || []),
    ...specialistsFirst(map.filter((s) => s.evidence !== ACTIVITY_GRADE), context),
    ...specialistsFirst(item.suppliers, context),
    ...specialistsFirst(item.aiSuggestion?.suppliers || [], context),
    ...specialistsFirst(map.filter((s) => s.evidence === ACTIVITY_GRADE), context),
    ...specialistsFirst(item.familySuggestion?.suppliers || [], context),
  ]
  const chosen: Supplier[] = []
  const seen = new Set<string>()
  for (const s of ordered) {
    if (!s?.id || seen.has(s.id) || rejected.has(s.id)) continue
    seen.add(s.id)
    chosen.push(s)
    if (chosen.length >= limit) break
  }
  return chosen
}
