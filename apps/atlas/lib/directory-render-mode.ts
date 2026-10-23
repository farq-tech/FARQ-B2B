/**
 * Chooses one live-directory representation at a time.
 *
 * Tiles keep a whole commercial cohort responsive while pages are still
 * streaming. Direct GeoJSON becomes authoritative only after every safe page
 * for the chosen scope has arrived, preventing duplicate or partial pins.
 */
export type DirectoryRenderMode = 'tiles' | 'direct' | 'empty'

export function directoryRenderMode(input: { mapQuery?: string | null; pinCount: number; pinsComplete: boolean }): DirectoryRenderMode {
  if (input.mapQuery && !input.pinsComplete) return 'tiles'
  if (input.pinCount > 0) return 'direct'
  return input.mapQuery ? 'tiles' : 'empty'
}
