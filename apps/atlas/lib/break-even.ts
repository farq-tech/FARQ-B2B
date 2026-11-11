export type BreakEvenInputs = {
  monthlyCosts: number | null
  averageOrder: number | null
  contributionMarginPercent: number | null
  operatingDays: number | null
}

/** Required whole orders per day to cover user-entered fixed monthly costs; this is not a sales forecast. */
export function breakEvenOrdersPerDay({ monthlyCosts, averageOrder, contributionMarginPercent, operatingDays }: BreakEvenInputs): number | null {
  if (monthlyCosts == null || averageOrder == null || contributionMarginPercent == null || operatingDays == null) return null
  if (![monthlyCosts, averageOrder, contributionMarginPercent, operatingDays].every(Number.isFinite)) return null
  if (monthlyCosts <= 0 || averageOrder <= 0 || contributionMarginPercent <= 0 || contributionMarginPercent > 100 || !Number.isInteger(operatingDays) || operatingDays < 1 || operatingDays > 31) return null
  const dailyOrders = monthlyCosts / (averageOrder * contributionMarginPercent / 100 * operatingDays)
  if (!Number.isFinite(dailyOrders) || dailyOrders <= 0 || dailyOrders > Number.MAX_SAFE_INTEGER) return null
  return Math.ceil(dailyOrders)
}
