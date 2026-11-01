/**
 * Audience segment types. The sizes themselves (population × each measured share) are computed once in the service
 * (services/targeting-api/district_metrics.audience_sizes) and read by the map; no screen recomposes them. Two
 * segments are never multiplied together: their overlap (Saudi men, say) is not measured.
 */
export type Sex = 'all' | 'men' | 'women'
export type Nationality = 'all' | 'saudi' | 'non_saudi'
/** Measured per district: percentage of men and of Saudis among residents. */
export type DistrictShare = { male_pct: number; saudi_pct: number }
