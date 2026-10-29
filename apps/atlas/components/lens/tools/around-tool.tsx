'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import { circlePolygon, type Area, type Site } from '../lens-map-canvas'
import type { Overlay } from './overlay'
import { PALETTE } from '@/lib/palette'
import { residentsPer } from '@/lib/audience'

type Within = { population: number | null; dwellings: number | null; businesses: number | null; top_activities: { activity: string; n: number }[] }
type Point = { lon: number; lat: number }
type Geometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
type Reach = { kind: 'radius'; metres: number } | { kind: 'drive'; minutes: number }
type Result = { status: 'loading' | 'ready' | 'error'; message?: string; geometry?: Geometry; figures?: Within }

const REACHES: Reach[] = [
  { kind: 'radius', metres: 500 }, { kind: 'radius', metres: 1000 }, { kind: 'radius', metres: 2000 },
  { kind: 'drive', minutes: 5 }, { kind: 'drive', minutes: 10 }, { kind: 'drive', minutes: 15 },
]
const COLORS = [PALETTE.olive, PALETTE.ochre, PALETTE.slate]
const MAX_SITES = 3
const reachLabel = (reach: Reach) => (reach.kind === 'radius'
  ? (reach.metres < 1000 ? `${reach.metres} م` : `${reach.metres / 1000} كم`)
  : `${reach.minutes} د بالسيارة`)
const sameReach = (a: Reach, b: Reach) => a.kind === b.kind && (a.kind === 'radius' ? a.metres === (b as typeof a).metres : a.minutes === (b as typeof a).minutes)
const show = (value: number | null | undefined) => (value == null ? 'غير متاح' : numberFormat.format(Math.round(value)))

/** The area a site reaches: a circle on the ground, or the roads a car covers in the time (Valhalla isochrone). */
async function areaFor(point: Point, reach: Reach): Promise<Geometry> {
  if (reach.kind === 'radius') return circlePolygon({ ...point, radius_m: reach.metres }).geometry
  const response = await fetch('/api/routing/isochrone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locations: [point], costing: 'auto', contours_minutes: [reach.minutes] }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || 'تعذر حساب منطقة الوصول.')
  const geometry = (body?.features ?? []).map((feature: GeoJSON.Feature) => feature.geometry).find((g: GeoJSON.Geometry) => g?.type === 'Polygon' || g?.type === 'MultiPolygon')
  if (!geometry) throw new Error('تعذر حساب منطقة الوصول.')
  return geometry
}

/**
 * «قارن المواقع»: tap up to three candidate sites and compare who lives and what operates within the same reach of
 * each, by distance or by drive time on the real road network. Every figure is the same golden count as the rest of
 * Atlas, only the boundary differs.
 */
export function AroundTool({ onOverlay }: { onOverlay: (overlay: Overlay) => void }) {
  const [sites, setSites] = useState<(Point & { id: number })[]>([])
  const [reach, setReach] = useState<Reach>(REACHES[1])
  const [results, setResults] = useState<Record<string, Result>>({})
  const nextId = useRef(1)
  const requested = useRef(new Set<string>())
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  // a fourth tap replaces the oldest site
  const pick = useCallback((point: Point) => {
    const id = nextId.current++
    setSites((current) => [...current.slice(-(MAX_SITES - 1)), { ...point, id }])
  }, [])

  const keyOf = useCallback((site: { id: number }) => `${site.id}|${reach.kind}|${reach.kind === 'radius' ? reach.metres : reach.minutes}`, [reach])

  // each site × reach is worked out once; results are keyed by both, so a late answer never lands on the wrong site
  useEffect(() => {
    for (const site of sites) {
      const key = keyOf(site)
      if (requested.current.has(key)) continue
      requested.current.add(key)
      setResults((current) => ({ ...current, [key]: { status: 'loading' } }))
      const settle = (result: Result) => { if (mounted.current) setResults((current) => ({ ...current, [key]: result })) }
      areaFor(site, reach)
        .then(async (geometry) => settle({ status: 'ready', geometry, figures: await postMarket<Within>('population-within', { geometry }) }))
        .catch((error: Error) => settle({ status: 'error', message: error.message || 'تعذر الحساب.' }))
    }
  }, [sites, reach, keyOf])

  const labelled = useMemo(() => sites.map((site, index) => ({ ...site, label: String(index + 1), color: COLORS[index], result: results[keyOf(site)] })), [sites, results, keyOf])

  useEffect(() => {
    const areas: Area[] = labelled.flatMap((site) => (site.result?.geometry ? [{ id: String(site.id), color: site.color, geometry: site.result.geometry }] : []))
    const markers: Site[] = labelled.map((site) => ({ id: String(site.id), label: site.label, color: site.color, lon: site.lon, lat: site.lat }))
    onOverlay({ onPick: pick, areas, sites: markers })
  }, [labelled, pick, onOverlay])

  const rows: { label: string; value: (f: Within) => number | null; explain: string[]; higherIsBetter?: boolean }[] = [
    { label: 'السكان', value: (f) => f.population, explain: EXPLAIN.aroundPeople, higherIsBetter: true },
    { label: 'الوحدات السكنية', value: (f) => f.dwellings, explain: EXPLAIN.aroundHomes, higherIsBetter: true },
    { label: 'المنشآت', value: (f) => f.businesses, explain: EXPLAIN.aroundBusinesses },
    {
      label: 'ساكن لكل منشأة',
      value: (f) => residentsPer(f.population, f.businesses),
      explain: ['السكان داخل المنطقة ÷ المنشآت داخلها.', 'كلما ارتفع الرقم قلّت المنشآت التي تخدم السكان، أي منافسة أقل.'],
      higherIsBetter: true,
    },
  ]
  const ready = labelled.filter((site) => site.result?.status === 'ready' && site.result.figures)
  const best = (row: (typeof rows)[number]) => {
    if (!row.higherIsBetter || ready.length < 2) return null
    const values = ready.map((site) => row.value(site.result!.figures!)).filter((v): v is number => v != null)
    return values.length ? Math.max(...values) : null
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">قارن المواقع</h2>
      <p className="text-base text-muted-foreground">اضغط على الخريطة لإضافة موقع، حتى {numberFormat.format(MAX_SITES)} مواقع.</p>
      <div className="grid grid-cols-3 gap-1.5">
        {REACHES.map((value) => (
          <button key={reachLabel(value)} onClick={() => setReach(value)} aria-pressed={sameReach(reach, value)}
            className={cn('rounded-lg border py-2 text-base', sameReach(reach, value) ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
            {reachLabel(value)}
          </button>
        ))}
      </div>
      {reach.kind === 'drive' && (
        <Explained title="منطقة الوصول بالسيارة" lines={EXPLAIN.driveArea(reach.minutes)} className="text-sm text-muted-foreground">
          المنطقة: كل ما تصله السيارة في {numberFormat.format(reach.minutes)} دقائق على الطرق.
        </Explained>
      )}
      {labelled.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="text-sm text-muted-foreground">
                <th className="py-1.5 text-start font-medium" />
                {labelled.map((site) => (
                  <th key={site.id} className="py-1.5 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-flex size-6 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: site.color }}>{site.label}</span>
                      <button onClick={() => setSites((current) => current.filter((item) => item.id !== site.id))} aria-label={`إزالة الموقع ${site.label}`} className="text-muted-foreground hover:text-foreground">
                        <X className="size-4" aria-hidden />
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const top = best(row)
                return (
                  <tr key={row.label}>
                    <th className="py-2 text-start text-sm font-medium text-muted-foreground">{row.label}</th>
                    {labelled.map((site) => {
                      const result = site.result
                      if (!result || result.status === 'loading') return <td key={site.id} className="py-2 text-center"><Loader2 className="mx-auto size-4 animate-spin text-primary" aria-label="جارٍ الحساب" /></td>
                      if (result.status === 'error') return <td key={site.id} className="py-2 text-center text-sm text-destructive">{result.message}</td>
                      const value = row.value(result.figures!)
                      return (
                        <td key={site.id} className="py-2 text-center">
                          <Explained title={row.label} lines={row.explain} className={cn('font-bold', top != null && value === top && 'text-primary')}>{show(value)}</Explained>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {ready.length > 0 && (
        <div className="space-y-2">
          {ready.map((site) => site.result!.figures!.top_activities.length > 0 && (
            <div key={site.id}>
              <p className="mb-1 text-sm font-semibold text-muted-foreground">أكثر الأنشطة حول الموقع {site.label}</p>
              <ul className="space-y-1 text-base">
                {site.result!.figures!.top_activities.slice(0, 4).map((row) => (
                  <li key={row.activity} className="flex justify-between"><span>{row.activity}</span><span className="font-semibold">{numberFormat.format(row.n)}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
