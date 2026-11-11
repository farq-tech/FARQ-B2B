/** Explicit density thresholds use available district densities and exclude districts without a value. */
export function districtsAtMinDensity(rows: { id: string; density: number | null }[], minimum: number | null): string[] | null {
  return minimum == null ? null : rows.filter((row) => row.density != null && row.density >= minimum).map((row) => row.id)
}

/** Count neighborhoods with available boundaries whose density is unavailable. */
export function districtsWithoutDensity(rows: { density: number | null }[]): number {
  return rows.filter((row) => row.density == null).length
}

/** A density filter must wait for the authoritative district-count source before treating no matches as a result. */
export function densityFilterReadiness(minimum: number | null, mapStatus: 'loading' | 'ready' | 'error', summaryStatus: 'loading' | 'ready' | 'error', hasAvailableDensity: boolean): 'ready' | 'loading' | 'unavailable' | 'error' {
  if (minimum == null) return 'ready'
  if (mapStatus === 'error' || summaryStatus === 'error') return 'error'
  if (mapStatus !== 'ready' || summaryStatus === 'loading') return 'loading'
  return hasAvailableDensity ? 'ready' : 'unavailable'
}
