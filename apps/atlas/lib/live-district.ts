/**
 * The aggregate service accepts the Arabic district name while map geometry
 * has a provider-specific identifier. Keep both values together at the UI
 * boundary; no component may assume `properties.id` is the only identifier.
 */
export type DistrictFeatureLike = { id?: string | number; properties?: Record<string, unknown> | null }

export function stableDistrictId(feature: DistrictFeatureLike): string | null {
  const properties = feature.properties ?? {}
  const value = properties.id ?? properties.district_id ?? properties.district_en ?? feature.id
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

export function districtDisplayName(feature: DistrictFeatureLike): string | null {
  const properties = feature.properties ?? {}
  const value = properties.ar ?? properties.name_ar ?? properties.district_ar ?? properties.name
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeDistrictName(value: string) {
  return value.trim().replace(/^حي\s+/, '').replace(/\s+/g, ' ')
}

export function districtNameById(features: readonly DistrictFeatureLike[]) {
  return new Map(features.flatMap((feature) => {
    const id = stableDistrictId(feature)
    const name = districtDisplayName(feature)
    return id && name ? [[id, name] as const] : []
  }))
}

export function findDistrictByName<T extends DistrictFeatureLike>(features: readonly T[], name: string): T | null {
  const wanted = normalizeDistrictName(name)
  return features.find((feature) => {
    const candidate = districtDisplayName(feature)
    return candidate ? normalizeDistrictName(candidate) === wanted : false
  }) ?? null
}
