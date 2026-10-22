import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest } from '@/lib/atlas-session'
import { isMapQuery } from '@/lib/live-directory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function targetingHeaders() {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

export async function GET(request: NextRequest, context: { params: Promise<{ query: string; z: string; x: string; y: string }> }) {
  // Tile requests are frequent. The encrypted Atlas session and allow-list are
  // checked locally here; profile and directory APIs additionally verify the
  // upstream account session before exposing an entity record.
  const { session } = await sessionForRequest(request)
  if (!session || !isTargetingAllowed(session)) return new NextResponse(null, { status: 401, headers: { 'cache-control': 'private, no-store' } })
  const { query, z, x, y } = await context.params
  if (!isMapQuery(query) || !/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y)) return new NextResponse(null, { status: 400 })
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return new NextResponse(null, { status: 503 })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const upstream = await fetch(`${origin}/tiles/${query}/${z}/${x}/${y}.pbf`, { headers, cache: 'no-store', signal: controller.signal })
    if (!upstream.ok) return new NextResponse(null, { status: upstream.status >= 500 ? 502 : upstream.status, headers: { 'cache-control': 'private, no-store' } })
    return new NextResponse(await upstream.arrayBuffer(), { status: 200, headers: { 'content-type': 'application/vnd.mapbox-vector-tile', 'cache-control': 'private, no-store' } })
  } catch {
    return new NextResponse(null, { status: 502, headers: { 'cache-control': 'private, no-store' } })
  } finally {
    clearTimeout(timeout)
  }
}
