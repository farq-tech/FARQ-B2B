import { counted, numberFormat } from '../../../lib/insights-api.ts'

/**
 * The line the card on a clicked district leads with (Overlay.facts), one per tool, built from the figures the tool
 * already loaded: nothing is recomputed or estimated. A district the answer says nothing about is left out of the map,
 * so the card reads «غير متاح» for it, never a zero. Tested in district-facts.test.ts.
 */

/** District name → id, as the tools match the service's district_ar to the map's rows. */
type Ids = Map<string, string>

/** The districts a street runs through: every one the service names, else the one it was filed under. */
const streetDistricts = (street: { district_ar?: string; districts_ar?: string[] }) =>
  street.districts_ar?.length ? street.districts_ar : street.district_ar ? [street.district_ar] : []

/**
 * Per district, the street the tool ranks highest among those running through it (`rank`, as the service returned
 * it), with the line `line` writes for it. Ties keep the service's order.
 */
function strongestStreet<T extends { district_ar?: string; districts_ar?: string[] }>(streets: T[], ids: Ids, rank: (street: T) => number, line: (street: T) => string) {
  const best = new Map<string, T>()
  for (const street of streets) {
    for (const name of streetDistricts(street)) {
      const id = ids.get(name)
      if (!id) continue
      const held = best.get(id)
      if (!held || rank(street) > rank(held)) best.set(id, street)
    }
  }
  return new Map([...best].map(([id, street]) => [id, line(street)]))
}

/** «شوارع النشاط · أين يتجمع»: «أقوى شارع: طريق نجد (45 محلاً)», the street with most shops of the activity. */
export function corridorFacts(corridors: { street_ar: string; district_ar: string; districts_ar?: string[]; n: number }[], ids: Ids) {
  return strongestStreet(corridors, ids, (street) => street.n, (street) => `أقوى شارع: ${street.street_ar} (${counted(street.n, 'shop')})`)
}

/** «شوارع النشاط · أين الفرصة»: «أقوى فرصة: طريق الملك فهد (82/100)», the street the service scores highest. */
export function opportunityFacts(streets: { street_ar: string; districts_ar: string[]; score: number }[], ids: Ids) {
  return strongestStreet(streets, ids, (street) => street.score, (street) => `أقوى فرصة: ${street.street_ar} (${numberFormat.format(street.score)}/100)`)
}

/** «المناطق والمسار»: «المندوب 3 · منطقته 1,250 منشأة», the rep whose territory holds the district, and its share. */
export function territoryFacts(groups: { weight: number; districts: { district_ar: string; district_id: string | number }[] }[], ids: Ids, weight: 'population' | 'businesses') {
  const facts = new Map<string, string>()
  groups.forEach((group, index) => {
    const share = weight === 'population' ? `${numberFormat.format(Math.round(group.weight))} ساكن` : counted(Math.round(group.weight), 'business')
    for (const district of group.districts) facts.set(ids.get(district.district_ar) ?? String(district.district_id), `المندوب ${numberFormat.format(index + 1)} · منطقته ${share}`)
  })
  return facts
}

/** The listing types as the district medians group them (build_real_estate_reference.py GROUPS); a room has none. */
const MEDIAN_GROUP: Record<string, string> = {
  apartment: 'residential', floor: 'residential', villa: 'residential', studio: 'studio',
  store: 'commercial', showroom: 'commercial', office: 'office', warehouse: 'warehouse', land: 'land',
}
const DEAL_WORD: Record<string, string> = { rent_year: 'إيجار المتر السنوي', rent_month: 'إيجار المتر الشهري', sale: 'سعر المتر' }

/**
 * The district median the homes tool's search is measured against: the deal and group key of DistrictRow.realEstate
 * (`rent_year_residential` …), or null when the search has no single one (a room, or rents of every period mixed;
 * a shop's rent mixed is its yearly one, as the service files a shop rent that states no period).
 */
export function homesMedianKey(kind: 'rent' | 'sale', deal: string | null, type: string): string | null {
  const group = MEDIAN_GROUP[type]
  if (!group) return null
  const period = kind === 'sale' ? 'sale' : deal ?? (group === 'commercial' ? 'rent_year' : null)
  return period && DEAL_WORD[period] ? `${period}_${group}` : null
}

/** «اختر عقاراً»: «وسيط إيجار المتر السنوي: 450 ريال (12 عرضاً)» from the district row's own median for the search's type. */
export function homesFacts(rows: { id: string; realEstate: Partial<Record<string, { median: number; listings: number }>> }[], key: string | null) {
  if (!key) return null
  const word = DEAL_WORD[key.slice(0, key.lastIndexOf('_'))]
  const facts = new Map<string, string>()
  for (const row of rows) {
    const median = row.realEstate[key]
    if (median?.median != null) facts.set(row.id, `وسيط ${word}: ${numberFormat.format(Math.round(median.median))} ريال (${counted(median.listings, 'listing')})`)
  }
  return facts
}
