import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const READ_ONLY: Record<string, readonly string[]> = {
  cities: ['GET'],
  districts: ['GET'],
  'district-counts': ['POST'],
  'market-summary': ['POST'],
  'street-density': ['POST'],
  'street-density/catalog': ['POST'],
  clusters: ['POST'],
}

function targetingHeaders() {
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return {
    'content-type': 'application/json',
    'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex'),
  }
}

export async function proxy(request: NextRequest, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params
  const allowed = READ_ONLY[resource]
  if (!allowed || !allowed.includes(request.method)) {
    return NextResponse.json({ error: 'المسار غير متاح من أطلس.' }, { status: 404 })
  }

  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) {
    return NextResponse.json({ error: 'خدمة بيانات السوق غير مهيأة حالياً.' }, { status: 503 })
  }

  let body: string | undefined
  if (request.method === 'POST') {
    try {
      const input = await request.json()
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid')
      body = JSON.stringify(input)
    } catch {
      return NextResponse.json({ error: 'طلب بيانات السوق غير صالح.' }, { status: 400 })
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const target = new URL(`${origin}/${resource}`)
    if (request.method === 'GET') target.search = request.nextUrl.search
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      signal: controller.signal,
    })
    const text = await upstream.text()
    if (!upstream.ok) {
      return NextResponse.json({ error: 'تعذر تحميل بيانات السوق الحية.' }, { status: upstream.status >= 500 ? 502 : upstream.status })
    }
    return new NextResponse(text, {
      status: 200,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'تعذر الاتصال بخدمة بيانات السوق.' }, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}

export const GET = proxy
export const POST = proxy
