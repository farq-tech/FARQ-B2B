import type { AudienceMode } from './audience'

export type DistrictSummaryMetric =
  | 'population' | 'businesses' | 'residentsPerBusiness' | 'unmetSearch' | 'restaurants'
  | 'sex' | 'nationality' | 'menuPrice' | 'villaShare' | 'income' | 'growth' | 'age'
  | 'registeredDeals' | 'listingPrices' | 'activities' | 'unmetTerms'

const PEOPLE_TARGET_HIDDEN_METRICS = new Set<DistrictSummaryMetric>([
  'businesses', 'residentsPerBusiness', 'unmetSearch', 'restaurants', 'menuPrice', 'growth',
  'registeredDeals', 'listingPrices', 'activities', 'unmetTerms',
])

/** A consumer audience summary focuses on residents and household traits, never business supply or market activity. */
export function showDistrictSummaryMetric(metric: DistrictSummaryMetric, lens: string, audienceMode: AudienceMode): boolean {
  return lens !== 'marketers' || audienceMode !== 'people' || !PEOPLE_TARGET_HIDDEN_METRICS.has(metric)
}
