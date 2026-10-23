import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function targetingHeaders() {
  const password = process.env.TARGETING_PASSWORD
  return password ? { 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') } : null
}

/**
 * Proxies an opaque, short-lived directory tile context. The browser never sees
 * targeting credentials, raw contact fields, or an unbounded directory export.
 * The context is issued only by the authenticated entities search route.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ query: string; z: string; x: string; y: string }> }) {
  const { query, z, x, y } = await context.params
  if (!/^[a-f0-9]{32}$/i.test(query) || !/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y)) {
    return new NextResponse(null, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  const zoom = Number(z)
  if (zoom > 20 || Number(x) >= 2 ** zoom || Number(y) >= 2 ** zoom) {
    return new NextResponse(null, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  const { session, refreshed } = await sessionForRequest(request)
  if (!session || !isTargetingAllowed(session)) return new NextResponse(null, { status: 401, headers: { 'cache-control': 'no-store' } })
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return new NextResponse(null, { status: 503, headers: { 'cache-control': 'no-store' } })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const upstream = await fetch(`${origin}/tiles/${query}/${z}/${x}/${y}.pbf`, { headers, cache: 'no-store', signal: controller.signal })
    if (!upstream.ok) return new NextResponse(null, { status: upstream.status === 410 ? 410 : 502, headers: { 'cache-control': 'no-store' } })
    const response = new NextResponse(await upstream.arrayBuffer(), {
      headers: {
        'content-type': 'application/vnd.mapbox-vector-tile',
        'cache-control': 'private, max-age=60',
        'x-content-type-options': 'nosniff',
      },
    })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return new NextResponse(null, { status: 502, headers: { 'cache-control': 'no-store' } })
  } finally {
    clearTimeout(timeout)
  }
}
