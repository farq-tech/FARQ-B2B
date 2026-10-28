import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Spending level per district: the median menu-item price of the district's restaurants, from Farq's observed menus
 * (farq-tech/farq ADR 0143). Farq returns only districts with enough priced restaurants; one it leaves out shows
 * «غير متاح». Rows join by `atlas_district_id`.
 */
const FARQ_CITY: Record<string, string> = {
  Riyadh: 'riyadh',
  Jeddah: 'jeddah',
  Dammam: 'dammam',
  'Makkah Al Mukarramah': 'makkah',
  'Al Madinah Al Munawwarah': 'madinah',
}

type FarqRow = { atlas_district_id?: string | null; median_item_price?: number | null; priced_places?: number | null }

export async function GET(request: NextRequest) {
  const key = FARQ_CITY[request.nextUrl.searchParams.get('city') ?? '']
  if (!key) return NextResponse.json({ districts: [] })
  const origin = (process.env.FARQ_API_ORIGIN || 'https://api.farq.sa').replace(/\/$/, '')
  try {
    const response = await fetch(`${origin}/api/intelligence/map/city/${key}/menu-prices`, { next: { revalidate: 3600 } })
    if (!response.ok) return NextResponse.json({ error: 'unavailable' }, { status: 502 })
    const body = (await response.json()) as { districts?: FarqRow[]; min_places?: number; min_items?: number }
    const districts = (body.districts ?? [])
      .filter((row) => row.atlas_district_id && typeof row.median_item_price === 'number')
      .map((row) => ({ district_id: String(row.atlas_district_id), price: row.median_item_price as number, places: row.priced_places ?? null }))
    return NextResponse.json(
      { districts, minPlaces: body.min_places ?? null, minItems: body.min_items ?? null },
      { headers: { 'cache-control': 'public, max-age=1800, stale-while-revalidate=21600' } },
    )
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 })
  }
}
