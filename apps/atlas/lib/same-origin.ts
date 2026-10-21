import type { NextRequest } from 'next/server'

const DEFAULT_PUBLIC_ORIGINS = ['https://atlas.farq.sa']

function configuredOrigins() {
  const configured = process.env.ATLAS_PUBLIC_ORIGINS
  if (!configured) return DEFAULT_PUBLIC_ORIGINS
  return configured.split(',').map((value) => value.trim()).filter(Boolean)
}

/**
 * Confirms that a state-changing browser request came from Atlas itself.
 * The explicit public origin is needed behind the Railway reverse proxy,
 * where Next's internal request origin can differ from the visitor's domain.
 */
export function isTrustedAtlasRequest(request: NextRequest) {
  const source = request.headers.get('origin') || request.headers.get('referer')
  if (!source) return false

  try {
    const sourceOrigin = new URL(source).origin
    return new Set([request.nextUrl.origin, ...configuredOrigins()]).has(sourceOrigin)
  } catch {
    return false
  }
}
