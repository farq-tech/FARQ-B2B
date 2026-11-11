/** Normalize Arabic district labels with the same equivalences used by the targeting service. */
export function districtKey(name: string): string {
  return name.replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/^(حي|حى)\s+/, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ').trim()
}

/**
 * Join source metrics to map districts only when the normalized name is unique on both sides.
 * A missing row is safer than silently assigning a metric to the wrong polygon.
 */
export function uniqueDistrictJoin<T extends { district_ar: string }>(targetNames: readonly string[], sourceRows: readonly T[]): Map<string, T> {
  const targetCounts = new Map<string, number>()
  for (const name of targetNames) {
    const key = districtKey(name)
    if (key) targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1)
  }

  const sourceCounts = new Map<string, number>()
  const sourceByKey = new Map<string, T>()
  for (const row of sourceRows) {
    const key = districtKey(row.district_ar)
    if (!key) continue
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1)
    sourceByKey.set(key, row)
  }

  const matches = new Map<string, T>()
  for (const [key, row] of sourceByKey) {
    if (sourceCounts.get(key) === 1 && targetCounts.get(key) === 1) matches.set(key, row)
  }
  return matches
}

/** Join canonical metrics by the district identity. Numeric and text IDs share the same canonical string key. */
export function uniqueDistrictIdJoin<T extends { district_id: string | number }>(targetIds: readonly (string | number)[], sourceRows: readonly T[]): Map<string, T> {
  const targetCounts = new Map<string, number>()
  for (const id of targetIds) {
    const key = String(id).trim()
    if (key) targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1)
  }

  const sourceCounts = new Map<string, number>()
  const sourceById = new Map<string, T>()
  for (const row of sourceRows) {
    const key = String(row.district_id).trim()
    if (!key) continue
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1)
    sourceById.set(key, row)
  }

  const matches = new Map<string, T>()
  for (const [key, row] of sourceById) {
    if (sourceCounts.get(key) === 1 && targetCounts.get(key) === 1) matches.set(key, row)
  }
  return matches
}

/** Prefer an exact canonical ID; allow a unique-name join only for legacy rows that omit the ID field. */
export function joinDistrictByIdOrUniqueName<T extends { district_id?: string | number | null; district_ar: string }>(
  targets: readonly { id: string | number; name: string }[],
  sourceRows: readonly T[],
): Map<string, T> {
  const byId = uniqueDistrictIdJoin(targets.map((row) => row.id), sourceRows.filter(
    (row): row is T & { district_id: string | number } => row.district_id != null,
  ))
  const byName = uniqueDistrictJoin(targets.map((row) => row.name), sourceRows.filter((row) => !Object.hasOwn(row, 'district_id')))
  return new Map(targets.map((row) => [String(row.id), byId.get(String(row.id)) ?? byName.get(districtKey(row.name))]).filter(
    (entry): entry is [string, T] => entry[1] != null,
  ))
}
