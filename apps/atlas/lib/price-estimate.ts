import type { Deal, Listing } from './real-estate'

/** The deals an office can price: a rent with its stated period, or a sale. */
export type EstimateDeal = Exclude<Deal, 'rent_unstated'>

/** Where the comparables came from, narrowest first (insights.price_estimate). */
export type EstimateScope = 'district_rooms' | 'district' | 'nearby'

/** The service's answer (POST price-estimate). */
export type PriceEstimate = {
  available: boolean
  retrieved?: string | null
  scope?: EstimateScope | null
  comparables_found?: number
  min_comparables?: number
  reliable?: boolean
  area_band_pct?: number
  radius_m?: number
  estimate?: {
    low_sar: number
    mid_sar: number
    high_sar: number
    median_sar_per_sqm: number
    low_sar_per_sqm: number
    high_sar_per_sqm: number
  } | null
  comparables?: Listing[]
}

export const ESTIMATE_DEALS: { id: EstimateDeal; label: string }[] = [
  { id: 'rent_year', label: 'إيجار سنوي' },
  { id: 'rent_month', label: 'إيجار شهري' },
  { id: 'sale', label: 'بيع' },
]

/** «في الحي نفسه بعدد الغرف نفسه» and the like, for the line under the range. */
export function scopeLabel(scope: EstimateScope, district: string | null, radiusM: number): string {
  if (scope === 'district_rooms') return `في ${district ?? 'الحي'} بعدد الغرف نفسه`
  if (scope === 'district') return `في ${district ?? 'الحي'}`
  return `في دائرة ${(radiusM / 1000).toLocaleString('en-US')} كم حول ${district ?? 'الموقع'}`
}
