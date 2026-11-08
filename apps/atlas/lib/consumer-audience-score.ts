import type { Nationality, Sex } from './audience'

export type AudienceIncomeSegment = 'none' | 'sex' | 'nationality'
export type AudienceIncomeMeasures = {
  income: number | null
  incomeMale?: number | null
  incomeFemale?: number | null
  incomeSaudi?: number | null
  incomeNonSaudi?: number | null
}

/** Return the measured monthly income for the selected worker segment; never substitute a different segment. */
export function incomeForAudience(row: AudienceIncomeMeasures, segment: AudienceIncomeSegment, sex: Sex, nationality: Nationality): number | null {
  if (segment === 'sex' && sex !== 'all') return sex === 'men' ? row.incomeMale ?? null : row.incomeFemale ?? null
  if (segment === 'nationality' && nationality !== 'all') return nationality === 'saudi' ? row.incomeSaudi ?? null : row.incomeNonSaudi ?? null
  return row.income
}

export type ConsumerAudienceScore<T> = {
  row: T
  audience: number
  purchasingPower: number
  score: number
}

/**
 * Compare districts on two separate, measured signals: target audience size and the income/housing proxy available
 * for that district. Each is scaled against its city maximum, then the two relative scores are averaged equally.
 * Missing either signal leaves the score unavailable; this index is not a sales or campaign response forecast.
 */
export function scoreConsumerAudience<T>(rows: { row: T; audience: number | null; purchasingPower: number | null }[]) {
  const audienceMax = Math.max(0, ...rows.map((item) => item.audience ?? 0))
  const purchasingMax = Math.max(0, ...rows.map((item) => item.purchasingPower ?? 0))
  const scored: ConsumerAudienceScore<T>[] = []
  let unknown = 0

  for (const item of rows) {
    if (item.audience == null || item.purchasingPower == null) {
      unknown++
      continue
    }
    const audienceIndex = audienceMax > 0 ? (100 * item.audience) / audienceMax : 0
    const purchasingIndex = purchasingMax > 0 ? (100 * item.purchasingPower) / purchasingMax : 0
    scored.push({
      row: item.row,
      audience: item.audience,
      purchasingPower: item.purchasingPower,
      score: item.audience === 0 ? 0 : Math.round((audienceIndex + purchasingIndex) / 2),
    })
  }

  scored.sort((a, b) => b.score - a.score || b.audience - a.audience)
  return { scored, unknown }
}
