/** A listing is below its district median only when the service measured a negative difference. */
export const isBelowDistrictMedian = (difference: number | null | undefined) => difference != null && difference < 0
