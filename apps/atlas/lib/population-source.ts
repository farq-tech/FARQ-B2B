export type PopulationSourceKind = 'measured' | 'buildings' | 'worldpop' | 'unknown'

/** Recognize only the source labels emitted by the golden population table. */
export function populationSourceKind(source: string | null | undefined): PopulationSourceKind {
  if (source?.startsWith('910ths')) return 'measured'
  if (source === 'farq_buildings_v3') return 'buildings'
  if (source === 'WorldPop 2025') return 'worldpop'
  return 'unknown'
}
