// Copied from فرق بناء (read-only source): farqconstraction/src/lib/lineResolution.worker.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
/// <reference lib="webworker" />
import { resolveLinesSync, type LineInput } from './lineResolution'

self.onmessage = (event: MessageEvent<{ lines: LineInput[] }>) => {
  try {
    const resolutions = resolveLinesSync(event.data.lines)
    ;(self as unknown as Worker).postMessage({ resolutions })
  } catch (error) {
    ;(self as unknown as Worker).postMessage({ error: error instanceof Error ? error.message : 'resolution failed' })
  }
}
