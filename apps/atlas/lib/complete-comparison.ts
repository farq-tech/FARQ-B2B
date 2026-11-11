/** A winner is meaningful only when every compared site has a finite measurement. */
export function completeComparisonMaximum(values: readonly (number | null | undefined)[], siteCount: number): number | null {
  if (!Number.isSafeInteger(siteCount) || siteCount < 2 || values.length !== siteCount) return null
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null
  return Math.max(...values as number[])
}
