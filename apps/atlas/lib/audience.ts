/**
 * District audience figures, one rule each, so no screen recomposes them (docs/golden-data.md).
 * A segment is a measured share of a district's population. Two segments are never multiplied together: their overlap
 * (Saudi men, say) is not measured, so the product would be an estimate presented as a measurement.
 */
export type Sex = 'all' | 'men' | 'women'
export type Nationality = 'all' | 'saudi' | 'non_saudi'
/** Measured per district (910ths): percentage of men and of Saudis among residents. */
export type DistrictShare = { male_pct: number; saudi_pct: number }

/** Residents for each business (or competitor) of a district; null when either figure is unknown or there are none. */
export function residentsPer(population: number | null | undefined, count: number | null | undefined): number | null {
  return population != null && count ? population / count : null
}

/** Residents of one sex; the whole population for 'all'; null without a measured share. */
export function sexAudience(population: number, share: DistrictShare | undefined, sex: Sex): number | null {
  if (sex === 'all') return population
  if (!share) return null
  return (population * (sex === 'men' ? share.male_pct : 100 - share.male_pct)) / 100
}

/** Residents of one nationality group; the whole population for 'all'; null without a measured share. */
export function nationalityAudience(population: number, share: DistrictShare | undefined, nationality: Nationality): number | null {
  if (nationality === 'all') return population
  if (!share) return null
  return (population * (nationality === 'saudi' ? share.saudi_pct : 100 - share.saudi_pct)) / 100
}
