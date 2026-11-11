import { numberFormat } from './number-format.ts'

export const BELOW_MEDIAN_MAX_DISCOUNT_PCT = 30
export const BELOW_MEDIAN_FILTER_LABEL = `أقل من وسيط الحي (حتى ${numberFormat.format(BELOW_MEDIAN_MAX_DISCOUNT_PCT)}%)`
