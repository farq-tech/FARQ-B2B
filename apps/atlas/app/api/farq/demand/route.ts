import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Unmet demand per district from Farq's located searches (farq-tech/farq ADR 0142). Farq returns only districts and
 * terms with enough searches on enough days; a district it leaves out shows «غير متاح», never zero. Rows join by
 * `atlas_district_id`.
 */
const FARQ_CITY: Record<string, string> = {
  Riyadh: 'riyadh',
  Jeddah: 'jeddah',
  Dammam: 'dammam',
  'Makkah Al Mukarramah': 'makkah',
  'Al Madinah Al Munawwarah': 'madinah',
  'Al Khobar': 'khobar',
}

type Term = { term: string; searches: number; empty_results: number }
type FarqRow = { atlas_district_id?: string | null; searches: number; empty_results: number; top_unmet_terms?: Term[]; top_terms?: Term[] }

export async function GET(request: NextRequest) {
  const key = FARQ_CITY[request.nextUrl.searchParams.get('city') ?? '']
  if (!key) return NextResponse.json({ districts: [] })
  const origin = (process.env.FARQ_API_ORIGIN || 'https://api.farq.sa').replace(/\/$/, '')
  try {
    const response = await fetch(`${origin}/api/intelligence/demand/city/${key}/districts`, { next: { revalidate: 900 } })
    if (!response.ok) return NextResponse.json({ error: 'unavailable' }, { status: 502 })
    const body = (await response.json()) as { status?: string; districts?: FarqRow[]; min_searches?: number; min_days?: number; window_days?: number }
    if (body.status !== 'ok') return NextResponse.json({ error: 'unavailable' }, { status: 502 })
    const districts = (body.districts ?? [])
      .filter((row) => row.atlas_district_id)
      .map((row) => ({
        district_id: String(row.atlas_district_id),
        searches: row.searches,
        unmet: row.empty_results,
        unmetTerms: (row.top_unmet_terms ?? []).map((t) => ({ term: t.term, searches: t.searches, unmet: t.empty_results })),
        terms: (row.top_terms ?? []).map((t) => ({ term: t.term, searches: t.searches, unmet: t.empty_results })),
      }))
    return NextResponse.json(
      { districts, minSearches: body.min_searches ?? null, minDays: body.min_days ?? null, windowDays: body.window_days ?? null },
      { headers: { 'cache-control': 'public, max-age=600, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 })
  }
}
