import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Restaurants on delivery apps per district, from Farq's public per-district aggregate. Both products read the same
 * district atlas (farq-tech/farq ADR 0141), so a row joins by `atlas_district_id`, never by name. A district Farq
 * does not return stays absent and the map shows «غير متاح».
 */
const FARQ_CITY: Record<string, string> = {
  Riyadh: 'riyadh',
  Jeddah: 'jeddah',
  Dammam: 'dammam',
  'Makkah Al Mukarramah': 'makkah',
  'Al Madinah Al Munawwarah': 'madinah',
  'Al Khobar': 'khobar',
}

type FarqDistrict = { properties?: { atlas_district_id?: string | null; places?: number | null } }

export async function GET(request: NextRequest) {
  const key = FARQ_CITY[request.nextUrl.searchParams.get('city') ?? '']
  if (!key) return NextResponse.json({ districts: [] })
  const origin = (process.env.FARQ_API_ORIGIN || 'https://api.farq.sa').replace(/\/$/, '')
  try {
    const response = await fetch(`${origin}/api/intelligence/map/city/${key}/districts`, { next: { revalidate: 3600 } })
    if (!response.ok) return NextResponse.json({ error: 'unavailable' }, { status: 502 })
    const body = (await response.json()) as { features?: FarqDistrict[]; generated_at?: string | null }
    const districts = (body.features ?? [])
      .map((feature) => feature.properties ?? {})
      .filter((p) => p.atlas_district_id && typeof p.places === 'number')
      .map((p) => ({ district_id: String(p.atlas_district_id), restaurants: p.places as number }))
    return NextResponse.json(
      { districts, generated_at: body.generated_at ?? null },
      { headers: { 'cache-control': 'public, max-age=600, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 })
  }
}
