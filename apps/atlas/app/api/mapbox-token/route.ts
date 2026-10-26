import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token || !token.startsWith('pk.')) {
    return NextResponse.json({ error: 'خريطة Mapbox غير مهيأة.' }, { status: 503 })
  }

  return NextResponse.json({ token }, {
    headers: { 'cache-control': 'private, max-age=300' },
  })
}
