// Copied from فرق بناء (read-only source): farqconstraction/src/lib/rfqPackages.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
/**
 * Build Farq RFQ packages from per-item supplier selections.
 * Mirrors ConstructionPage materialPackages → createRfq packages so
 * supplierPayload scopes each invite to only that supplier's lines.
 */
import type { BOQItem } from '../types'

export type RfqPackageDraft = {
  id: string
  name: string
  category_keys: string[]
  line_keys: string[]
  selected_supplier_ids: string[]
}

export type RfqLineDraft = {
  line_key: string
  /** Null when no catalog row was CONFIRMED. The line is still sent. */
  farq_spec_id: string | null
  quantity: number
  uom: string | null
  pack: string | null
  name_ar: string
  original_name: string
  original_description: string
}

/**
 * Build the RFQ line payload from BOQ items.
 *
 * A line is sent under ITS OWN name whether or not the catalog matched it.
 * Requiring a `farq_spec_id` used to drop unmatched lines, which left the
 * wrong-name fallback as the only route to a successful send — on
 * ELE-RFQ-51D17AF6 that relabelled ten PPE lines «ألواح أو إس بي».
 */
export function buildRfqLinesFromItems(
  items: BOQItem[],
  input: {
    specIdForLine?: (lineKey: string) => string | null | undefined
    uomForLine?: (lineKey: string) => string | null | undefined
    parseQty?: (qty: string) => number
  } = {},
): RfqLineDraft[] {
  const parseQty = input.parseQty || ((qty: string) => Number(String(qty).replace(/,/g, '')) || 1)
  return items.map((item) => {
    const lineKey = String(item.lineKey || `line-${item.id}`)
    return {
      line_key: lineKey,
      farq_spec_id: item.farqSpecId || input.specIdForLine?.(lineKey) || null,
      quantity: parseQty(String(item.qty)),
      // No invented unit and no invented pack: the API completes both from the
      // catalog item when they are absent, and a supplier must never price
      // «200 عدد» for a line the booklet measured in something else.
      uom: item.unit || input.uomForLine?.(lineKey) || null,
      pack: null,
      name_ar: item.name,
      original_name: item.name,
      original_description: item.spec || '',
    }
  })
}

export function departmentForBoqItem(item: Pick<BOQItem, 'name' | 'spec'>): string | null {
  const hay = `${item.name || ''} ${item.spec || ''}`.toLowerCase()
  if (/كهرب|كابل|كيبل|إنارة|لوحات|قواطع|تيار|اتصالات|solar|cable|electrical|pcb|ليزر|منشار|مولد|generator|makita|osb/.test(hay)) {
    return 'ELECTRICAL'
  }
  if (/ميكاني|تكييف|تهوية|سباكة|صحي|مواسير|أنابيب|مضخ|حريق|hvac|pump|plumbing/.test(hay)) {
    return 'MECHANICAL'
  }
  if (/دهان|عوازل|عازل|عزل|تشطيب|جبس|سيراميك|رخام|أبواب|نوافذ|واجهات|paint|waterproof|coating|جزيرة/.test(hay)) {
    return 'ARCHITECTURAL'
  }
  if (/خرسانة|أسمنت|حديد|بلوك|مدني|رمل|بحص|cement|rebar|concrete|aggregate/.test(hay)) {
    return 'CIVIL'
  }
  // Unknown is unknown. This used to answer ELECTRICAL, so a paint or concrete
  // tender reached suppliers under an electrical reference.
  return null
}

/** Dominant department across ready items (for RFQ.engineering_department). */
export function dominantEngineeringDepartment(
  items: Array<Pick<BOQItem, 'name' | 'spec'>>,
): string | null {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = departmentForBoqItem(item)
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  }
  // null when no line could be classified: the buyer chooses, the app does not guess.
  let best: string | null = null
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

/**
 * One package per BOQ item that has ≥1 selected supplier.
 * Only those lines go into the createRfq payload.
 */
export function buildRfqPackagesFromSelection(input: {
  items: BOQItem[]
  selectedByItem: Record<number, string[]>
  /** Map UI supplier ids → Farq external_key when they differ. */
  resolveSupplierId?: (id: string) => string
  /** The department the buyer chose, used for a line no rule could classify. */
  fallbackDepartment?: string | null
}): { packages: RfqPackageDraft[]; lineKeys: Set<string> } {
  const resolve = input.resolveSupplierId || ((id: string) => id)
  const packages: RfqPackageDraft[] = []
  const lineKeys = new Set<string>()

  for (const item of input.items) {
    const rawIds = [...new Set((input.selectedByItem[item.id] || []).map(String).filter(Boolean))]
    const supplierIds = [...new Set(rawIds.map(resolve).filter(Boolean))]
    if (!supplierIds.length) continue
    const lineKey = String(item.lineKey || `${item.id}:${item.farqSpecId || item.name}`)
    lineKeys.add(lineKey)
    const specId = item.farqSpecId || `item:${item.id}`
    packages.push({
      id: `material:${specId}:${item.id}`,
      name: item.name || specId,
      category_keys: [departmentForBoqItem(item) || input.fallbackDepartment || ''].filter(Boolean),
      line_keys: [lineKey],
      selected_supplier_ids: supplierIds,
    })
  }

  return { packages, lineKeys }
}
