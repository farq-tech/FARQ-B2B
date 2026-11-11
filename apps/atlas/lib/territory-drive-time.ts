export type TerritoryCentre = { district_ar: string; district_id: string | number; lon: number; lat: number }
export type DriveTerritory = { territory: number; weight: number; districts: TerritoryCentre[] }
export type TerritoryCentrePayload = { centres: TerritoryCentre[]; totalDistricts: number; unweightedDistricts: number }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Validate the centroid catalog before sending coordinates to the authenticated routing service. */
export function parseTerritoryCentres(value: unknown): TerritoryCentrePayload {
  if (!isRecord(value) || !Array.isArray(value.centres)) throw new Error('Invalid territory centres')
  const totalDistricts = value.total_districts
  const unweightedDistricts = value.unweighted_districts
  if (!Number.isSafeInteger(totalDistricts) || (totalDistricts as number) < 0
      || !Number.isSafeInteger(unweightedDistricts) || (unweightedDistricts as number) < 0) throw new Error('Invalid territory coverage')
  const seen = new Set<string>()
  const centres = value.centres.map((item): TerritoryCentre => {
    if (!isRecord(item) || typeof item.district_ar !== 'string' || !item.district_ar.trim()
        || !(typeof item.district_id === 'string' || (typeof item.district_id === 'number' && Number.isSafeInteger(item.district_id)))
        || typeof item.lon !== 'number' || !Number.isFinite(item.lon) || item.lon < 34 || item.lon > 56
        || typeof item.lat !== 'number' || !Number.isFinite(item.lat) || item.lat < 16 || item.lat > 33) throw new Error('Invalid territory centre')
    if (seen.has(item.district_ar)) throw new Error('Duplicate territory centre')
    seen.add(item.district_ar)
    return { district_ar: item.district_ar, district_id: item.district_id, lon: item.lon, lat: item.lat }
  })
  if (centres.length + (unweightedDistricts as number) !== totalDistricts) throw new Error('Inconsistent territory coverage')
  return { centres, totalDistricts: totalDistricts as number, unweightedDistricts: unweightedDistricts as number }
}

/** Read consecutive road durations from Valhalla's matrix response; one unreachable leg invalidates this balance. */
export function parseDiagonalDriveTimes(value: unknown, expected: number): number[] {
  if (!isRecord(value) || !Number.isInteger(expected) || expected < 1) throw new Error('Invalid road-time matrix')
  const matrix = value.sources_to_targets
  if (Array.isArray(matrix)) {
    if (matrix.length !== expected) throw new Error('Incomplete road-time matrix')
    return matrix.map((row, index) => {
      if (!Array.isArray(row) || row.length !== expected) throw new Error('Incomplete road-time matrix')
      const cell = row[index]
      const seconds = isRecord(cell) ? cell.time : null
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error('Unreachable district-centre leg')
      return seconds
    })
  }
  const durations = value.durations
  if (Array.isArray(durations) && durations.length === expected) {
    return durations.map((row, index) => {
      if (!Array.isArray(row) || row.length !== expected) throw new Error('Incomplete road-time matrix')
      const seconds = row[index]
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error('Unreachable district-centre leg')
      return seconds
    })
  }
  throw new Error('Incomplete road-time matrix')
}

/** Partition the compact district-centre sweep into contiguous runs minimizing the slowest territory's measured time. */
export function balanceTerritoriesByDriveTime(centres: TerritoryCentre[], edgeTimes: number[], requestedCount: number): DriveTerritory[] {
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || edgeTimes.length !== Math.max(0, centres.length - 1)
      || edgeTimes.some((seconds) => !Number.isFinite(seconds) || seconds < 0)) throw new Error('Invalid territory drive times')
  const n = centres.length
  const groups = Math.min(requestedCount, n)
  if (groups < 1 || edgeTimes.reduce((sum, seconds) => sum + seconds, 0) <= 0) return []

  const prefix = [0]
  for (const seconds of edgeTimes) prefix.push(prefix[prefix.length - 1] + seconds)
  const segmentTime = (start: number, end: number) => prefix[end - 1] - prefix[start]
  const best = Array.from({ length: groups + 1 }, () => Array<number>(n + 1).fill(Number.POSITIVE_INFINITY))
  const split = Array.from({ length: groups + 1 }, () => Array<number>(n + 1).fill(-1))
  best[0][0] = 0
  for (let group = 1; group <= groups; group += 1) {
    for (let end = group; end <= n - (groups - group); end += 1) {
      for (let start = group - 1; start < end; start += 1) {
        const previous = best[group - 1][start]
        if (!Number.isFinite(previous)) continue
        const candidate = Math.max(previous, segmentTime(start, end))
        if (candidate < best[group][end]) {
          best[group][end] = candidate
          split[group][end] = start
        }
      }
    }
  }
  if (!Number.isFinite(best[groups][n])) return []

  const ranges: [number, number][] = []
  let end = n
  for (let group = groups; group > 0; group -= 1) {
    const start = split[group][end]
    if (start < 0) return []
    ranges.push([start, end])
    end = start
  }
  ranges.reverse()
  return ranges.map(([start, end], index) => ({
    territory: index + 1,
    weight: segmentTime(start, end),
    districts: centres.slice(start, end),
  }))
}
