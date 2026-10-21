import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Public readiness signal for hosting and domain cutovers.
 * It deliberately exposes only booleans: environment values and session data
 * remain private.
 */
export function GET() {
  const marketDataReady = Boolean(process.env.TARGETING_ORIGIN && process.env.TARGETING_PASSWORD)
  const authenticationReady = Boolean(process.env.ATLAS_SESSION_SECRET && process.env.FARQ_API_ORIGIN)

  return NextResponse.json({
    ok: marketDataReady && authenticationReady,
    service: 'farq-atlas',
    marketDataReady,
    authenticationReady,
  }, {
    status: marketDataReady && authenticationReady ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
