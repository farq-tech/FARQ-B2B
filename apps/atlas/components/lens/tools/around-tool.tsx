'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { LoadError } from '@/components/shared/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { EXPLAIN } from '@/lib/explanations'
import { formatDistance, numberFormat, postMarket, type DistrictFeature } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import { circlePolygon, type Area, type Site } from '../lens-map-canvas'
import type { Overlay, SiteComparison } from './overlay'
import { PALETTE, readableOn } from '@/lib/palette'
import { areaKm2, containsPoint, districtAt } from '@/lib/geo-measure'
import { stickyHas, useStickyState, useStudiedActivity, type StudiedActivity } from '@/lib/sticky-state'
import { SiteCard, type SiteCardData, type SiteCardState } from './site-card'
import { attractionScores, placeSite, sitesVerdict } from './tool-answers'
import { Verdict } from './verdict'
import { useSlow } from './use-answer'
import { trackDecisionMoment } from '@/lib/commercial-metrics'
import { Choice, StillWorking } from './choice'
import type { DistrictRow } from '../city-data'

type Within = { population: number | null; dwellings: number | null; businesses: number | null; residents_per: number | null; top_activities: { activity: string; n: number }[] }
type Point = { lon: number; lat: number }
type Geometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
type Reach = { kind: 'radius'; metres: number } | { kind: 'drive'; minutes: number }
type Result = { status: 'loading' | 'ready' | 'error'; message?: string; geometry?: Geometry; figures?: Within; card?: SiteCardState }

const REACHES: Reach[] = [
  { kind: 'radius', metres: 500 }, { kind: 'radius', metres: 1000 }, { kind: 'radius', metres: 2000 },
  { kind: 'drive', minutes: 5 }, { kind: 'drive', minutes: 10 }, { kind: 'drive', minutes: 15 },
]
const COLORS = [PALETTE.olive, PALETTE.ochre, PALETTE.slate]
const MAX_SITES = 3
const reachLabel = (reach: Reach) => (reach.kind === 'radius'
  ? formatDistance(reach.metres)
  : `${numberFormat.format(reach.minutes)} د بالسيارة`)
const show = (value: number | null | undefined) => (value == null ? 'غير متاح' : numberFormat.format(Math.round(value)))

/** A point inside a district to stand a sample site on: its bounding box's centre, else its outline's mean, else a corner. */
function insidePoint(geometry: DistrictFeature['geometry']): Point {
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0]
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  const centre = { lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 }
  if (containsPoint(geometry, centre)) return centre
  const mean = { lon: lons.reduce((a, b) => a + b, 0) / lons.length, lat: lats.reduce((a, b) => a + b, 0) / lats.length }
  return containsPoint(geometry, mean) ? mean : { lon: ring[0][0], lat: ring[0][1] }
}

/** The site card for one range (/api/market/site-card, signed-in only because it names competitors). */
async function cardFor(city: string, point: Point, geometry: Geometry, activity: { q?: string; main_id?: string }): Promise<SiteCardState> {
  const response = await fetch('/api/market/site-card', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ city, geometry, centre: [point.lon, point.lat], ...(activity.q ? { q: activity.q } : activity.main_id ? { main_id: activity.main_id } : {}) }),
  })
  const body = await response.json().catch(() => null)
  // the card names competitors, so it needs a signed-in, allowed account; retrying would not change that
  if (response.status === 401 || response.status === 403) {
    return { status: 'denied', signIn: response.status === 401, message: body?.error || (response.status === 401 ? 'سجّل الدخول لعرض بطاقة الموقع.' : 'حسابك غير مخول لعرض بطاقة الموقع.') }
  }
  if (!response.ok || !body) return { status: 'error', message: body?.error || 'تعذر حساب بطاقة الموقع.' }
  return { status: 'ready', data: body as SiteCardData }
}

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
export function AroundTool({ city, onOverlay, districts, features, seed, next, siteAction }: {
  city: string; onOverlay: (overlay: Overlay) => void; districts: DistrictRow[]; features: DistrictFeature[]
  /** The district «أين ينقص نشاطي؟» put first (its id), so «ابدأ من هنا» stands the first site where the gap is. */
  seed?: string | null
  /** The step after the verdict (shops for rent near the best site, a request), given by the map shell. */
  next?: ReactNode
  /** The step under each site's card (a request from the businesses around it), given by the map shell. */
  siteAction?: (site: { label: string; lon: number; lat: number }) => ReactNode
}) {
  const [studied] = useStudiedActivity()
  // the site card counts competitors of the activity the customer chose; with none chosen it counts every business,
  // and says so, instead of the default nobody picked
  const chosen = stickyHas('activity')
  const activity = useMemo<StudiedActivity>(() => (chosen ? studied : { label: 'كل المنشآت' }), [chosen, studied])
  // each site keeps its slot (its number and colour) while it is on the map; see placeSite
  const [sites, setSites] = useState<(Point & { id: number; slot: number })[]>([])
  const [reach, setReach] = useStickyState<Reach>('around.reach', REACHES[1])
  const [results, setResults] = useState<Record<string, Result>>({})
  const nextId = useRef(1)
  const requested = useRef(new Set<string>())
  const mounted = useRef(true)
  // set again on every mount: a remount (React's development double mount, or the panel shown again) left it false,
  // and every site's figures were dropped as if the tool had gone, a table of skeletons for ever
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  // a new site takes the lowest free number; a fourth tap replaces the oldest site, in its number and colour
  const pick = useCallback((point: Point) => {
    const id = nextId.current++
    setSites((current) => placeSite(current, { ...point, id }, MAX_SITES))
  }, [])

  // keyed by what is asked (the reach and the activity as strings), never by their objects; the objects are read from
  // refs when a request starts, so a new object for the same reach or activity asks nothing again
  const reachKey = reach.kind === 'radius' ? `r${reach.metres}` : `d${reach.minutes}`
  const activityKey = `${activity.q ?? ''}|${activity.main_id ?? ''}`
  const asking = useRef({ reach, activity })
  useEffect(() => { asking.current = { reach, activity } })
  const keyOf = useCallback((site: { id: number }) => `${site.id}|${reachKey}|${city}|${activityKey}`, [reachKey, city, activityKey])

  // each site × reach is worked out once; results are keyed by both, so a late answer never lands on the wrong site
  useEffect(() => {
    const { reach, activity } = asking.current
    for (const site of sites) {
      const key = keyOf(site)
      if (requested.current.has(key)) continue
      requested.current.add(key)
      setResults((current) => ({ ...current, [key]: { status: 'loading' } }))
      const settle = (result: Result) => { if (mounted.current) setResults((current) => ({ ...current, [key]: result })) }
      areaFor(site, reach)
        .then(async (geometry) => {
          // the comparison figures and the card arrive separately, so a card that needs sign-in never blocks the table
          const card = cardFor(city, site, geometry, activity).catch((): SiteCardState => ({ status: 'error', message: 'تعذر حساب بطاقة الموقع.' }))
          settle({ status: 'ready', geometry, figures: await postMarket<Within>('population-within', { geometry }), card: { status: 'loading' } })
          const ready = await card
          if (mounted.current) setResults((current) => (current[key] ? { ...current, [key]: { ...current[key], card: ready } } : current))
        })
        .catch((error: Error) => settle({ status: 'error', message: error.message || 'تعذر الحساب.' }))
    }
  }, [sites, keyOf, city])

  // a failed card is asked again on the same area; the comparison figures already on screen stay as they are
  const retryCard = useCallback((site: Point & { id: number }) => {
    const key = keyOf(site)
    const geometry = results[key]?.geometry
    if (!geometry) return
    const put = (card: SiteCardState) => { if (mounted.current) setResults((current) => (current[key] ? { ...current, [key]: { ...current[key], card } } : current)) }
    put({ status: 'loading' })
    cardFor(city, site, geometry, asking.current.activity).then(put, (): void => put({ status: 'error', message: 'تعذر حساب بطاقة الموقع.' }))
  }, [keyOf, results, city])

  // «ابدأ من هنا»: one tap stands two sites, the district the gaps step put first (where the activity is short) against
  // the city's most populous other district; with no gap answered yet, the two most populous districts
  const sample = useMemo(() => {
    const outline = new Map(features.map((feature) => [String(feature.properties.id), feature.geometry]))
    const populous = districts
      .filter((row) => row.population != null && outline.has(row.id))
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    const gap = seed ? districts.find((row) => row.id === seed && outline.has(row.id)) : undefined
    const chosen = gap ? [gap, ...populous.filter((row) => row.id !== gap.id).slice(0, 1)] : populous.slice(0, 2)
    return chosen.map((row, index) => ({
      name: row.name, point: insidePoint(outline.get(row.id)!),
      why: gap && index === 0 ? `الأكبر نقصاً في «${activity.label}»` : 'الأكثر سكاناً',
    }))
  }, [districts, features, seed, activity.label])

  // in slot order, each with the number and colour of its slot
  const labelled = useMemo(() => [...sites].sort((a, b) => a.slot - b.slot)
    .map((site) => ({ ...site, label: numberFormat.format(site.slot + 1), color: COLORS[site.slot], result: results[keyOf(site)] })), [sites, results, keyOf])
  // a drive area or a busy range can take a while: said once, under the table, after a few seconds
  const slow = useSlow(labelled.some((site) => !site.result || site.result.status === 'loading'))
  // sites whose area or figures failed: said once above the table, and asked again together (a new list of the same
  // sites runs the request effect once more; the sites that worked stay as they are)
  const failed = labelled.filter((site) => site.result?.status === 'error')
  const retryFailed = () => {
    for (const site of failed) requested.current.delete(keyOf(site))
    setSites((current) => [...current])
  }

  // «جاذبية الموقع»: a 0–100 score comparing the chosen sites on equal factors — audience (population in reach),
  // purchasing power (income where published, else villa share, of the حي the pin sits in), and lightness of
  // competition (fewest establishments per km²). Each factor is scaled to the best site, and the score is their mean,
  // over the factors every site has (attractionScores); a factor one site lacks is left out for all, and said.
  const { scoreById, factors, topScore, byIncome, verdict, factored } = useMemo(() => {
    const byIncome = districts.some((row) => row.income != null)
    const districtById = new Map(districts.map((row) => [row.id, row]))
    const spendingOf = (point: Point): number | null => {
      const row = districtById.get(districtAt(point, features) ?? '')
      if (!row) return null
      return byIncome ? row.income : row.villaShare
    }
    const factored = labelled
      .filter((site) => site.result?.status === 'ready' && site.result.figures)
      .map((site) => {
        const figures = site.result!.figures!
        const area = site.result!.geometry ? areaKm2(site.result!.geometry) : 0
        return {
          id: site.id,
          audience: figures.population,
          spending: spendingOf(site),
          density: figures.businesses != null && area > 0 ? figures.businesses / area : null,
        }
      })
    const attraction = attractionScores(factored)
    const scoreById = attraction.scores
    const scores = [...scoreById.values()]
    // the answer in one line: the best site and the factors it leads or trails on, or that two are level; it waits for
    // every site, so it never names a winner while another site is still being counted
    // (a failed site is said above the table with its retry, so no verdict stands on the sites that worked)
    const settled = labelled.every((site) => site.result?.status === 'ready')
    const label = new Map(labelled.map((site) => [site.id, site.label]))
    const verdict = settled ? sitesVerdict(factored.map((item) => ({ ...item, label: label.get(item.id) ?? '', population: item.audience })), attraction, byIncome) : null
    return { scoreById, factors: attraction.factors, topScore: scores.length ? Math.max(...scores) : null, byIncome, verdict, factored }
  }, [labelled, districts, features])
  // the shop owner's decision moment (foundation §7): two or more sites scored side by side, once per set of sites and
  // reach; only how many, never where
  const scoredKey = `${[...scoreById.keys()].sort().join(',')}|${reachKey}`
  useEffect(() => { if (scoreById.size >= 2) trackDecisionMoment('sites_compared', { lens: 'shops', city, count: scoreById.size }) },
    // keyed by the scored sites and the reach as a string
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoredKey, city])

  useEffect(() => {
    const areas: Area[] = labelled.flatMap((site) => (site.result?.geometry ? [{ id: String(site.id), color: site.color, geometry: site.result.geometry }] : []))
    const markers: Site[] = labelled.map((site) => ({ id: String(site.id), label: site.label, color: site.color, lon: site.lon, lat: site.lat }))
    // the step's own line: the site with the most people inside its reach, from the figures as returned
    const counts = labelled.flatMap((site) => (site.result?.status === 'ready' && site.result.figures?.population != null ? [{ label: site.label, people: site.result.figures.population }] : []))
    const best = counts.sort((a, b) => b.people - a.people)[0]
    const people = best?.people ?? null
    const summary = best && people != null
      ? (labelled.length === 1 ? `الموقع ${best.label}: ${numberFormat.format(people)} ساكن في ${reachLabel(reach)}` : `الأكثر سكاناً: الموقع ${best.label}، ${numberFormat.format(people)} ساكن في ${reachLabel(reach)}`)
      : null
    const busy = labelled.some((site) => !site.result || site.result.status === 'loading')
    // the sites side by side for the journey's closing card: each site's district, its score (attractionScores, the
    // same numbers as the table) and its three factors, as measured; a missing one stays null («غير متاح»)
    const label = new Map(labelled.map((site) => [site.id, site]))
    const comparison: SiteComparison[] = factored.map((item) => {
      const site = label.get(item.id)!
      const district = districts.find((row) => row.id === districtAt(site, features))
      return { label: site.label, district: district?.name ?? null, score: scoreById.get(item.id) ?? null, audience: item.audience, spending: item.spending, density: item.density }
    })
    onOverlay({ onPick: pick, areas, sites: markers, summary: verdict?.lead ?? summary, comparison: comparison.length ? { sites: comparison, reach: reachLabel(reach), byIncome } : null,
      ...(busy && !summary ? { state: 'loading' as const, slow } : {}) })
  }, [labelled, pick, onOverlay, reach, slow, factored, scoreById, verdict, byIncome, districts, features])

  const rows: { label: string; value: (f: Within) => number | null; explain: string[]; higherIsBetter?: boolean }[] = [
    { label: 'السكان', value: (f) => f.population, explain: EXPLAIN.aroundPeople, higherIsBetter: true },
    { label: 'الوحدات السكنية', value: (f) => f.dwellings, explain: EXPLAIN.aroundHomes, higherIsBetter: true },
    { label: 'المنشآت', value: (f) => f.businesses, explain: EXPLAIN.aroundBusinesses },
    {
      label: 'ساكن لكل منشأة',
      value: (f) => f.residents_per,
      explain: EXPLAIN.aroundResidentsPer,
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
      <h2 className="text-xl font-bold max-lg:-order-2">قارن المواقع</h2>
      <p className="text-base text-muted-foreground">اضغط على الخريطة لإضافة موقع، حتى {numberFormat.format(MAX_SITES)} مواقع.</p>
      <Choice label="نطاق كل موقع" size="base" className="grid grid-cols-3" value={reachKey}
        onChange={(id) => { const next = REACHES.find((value) => (value.kind === 'radius' ? `r${value.metres}` : `d${value.minutes}`) === id); if (next) setReach(next) }}
        options={REACHES.map((value) => ({ id: value.kind === 'radius' ? `r${value.metres}` : `d${value.minutes}`, label: reachLabel(value) }))} />
      {sites.length === 0 && sample.length === 2 && (
        <button type="button" onClick={() => sample.forEach((item) => pick(item.point))}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary px-3 py-2 text-base font-semibold text-primary hover:bg-primary/10">
          <span>
            ابدأ من هنا: قارن {sample[0].name} و{sample[1].name}
            {sample[0].why !== sample[1].why && <span className="block text-sm font-normal">{sample[0].name}: {sample[0].why} · {sample[1].name}: {sample[1].why}</span>}
          </span>
        </button>
      )}
      {reach.kind === 'drive' && (
        <Explained title="منطقة الوصول بالسيارة" lines={EXPLAIN.driveArea(reach.minutes)} className="text-sm text-muted-foreground">
          المنطقة: كل ما تصله السيارة في {numberFormat.format(reach.minutes)} دقائق على الطرق.
        </Explained>
      )}
      {failed.length > 0 && (
        <LoadError what="المواقع" title={`تعذر حساب ${failed.length === 1 ? 'الموقع' : 'المواقع'} ${failed.map((site) => site.label).join('، ')}.`}
          detail={failed[0].result?.message} onRetry={retryFailed} />
      )}
      <Verdict lift verdict={verdict} next={verdict && scoreById.size ? next : undefined} />
      {labelled.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-base tabular-nums">
            <thead>
              <tr className="text-sm text-muted-foreground">
                <th className="py-1.5 text-start font-medium" />
                {labelled.map((site) => (
                  <th key={site.id} className="py-1.5 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-flex size-6 items-center justify-center rounded-full text-sm font-bold" style={{ background: site.color, color: readableOn(site.color) }}>{site.label}</span>
                      <button onClick={() => setSites((current) => current.filter((item) => item.id !== site.id))} aria-label={`إزالة الموقع ${site.label}`} className="text-muted-foreground hover:text-foreground">
                        <X className="size-4" aria-hidden />
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr className="bg-muted/40">
                <th className="py-2.5 text-start text-sm font-semibold">جاذبية الموقع</th>
                {labelled.map((site) => {
                  const result = site.result
                  if (!result || result.status === 'loading') return <td key={site.id} className="py-2.5 text-center" aria-busy="true"><Skeleton className="mx-auto h-5 w-12" aria-hidden /><span className="sr-only">جارٍ الحساب</span></td>
                  // the reason and the retry are said once, above the table (it was said twice, and read out twice);
                  // the column only marks that this site failed
                  if (result.status === 'error') return <td key={site.id} className="py-2.5 text-center text-sm font-semibold text-destructive">تعذر الحساب</td>
                  const value = scoreById.get(site.id)
                  return (
                    <td key={site.id} className="py-2.5 text-center">
                      <Explained title="جاذبية الموقع" lines={EXPLAIN.siteAttraction(byIncome, factors)} className={cn('text-lg font-bold', topScore != null && value === topScore && 'text-primary')}>
                        {value == null ? 'غير متاح' : `${numberFormat.format(value)}/100`}
                      </Explained>
                    </td>
                  )
                })}
              </tr>
              {rows.map((row) => {
                const top = best(row)
                return (
                  <tr key={row.label}>
                    <th className="py-2 text-start text-sm font-medium text-muted-foreground">{row.label}</th>
                    {labelled.map((site) => {
                      const result = site.result
                      if (!result || result.status === 'loading') return <td key={site.id} className="py-2 text-center" aria-busy="true"><Skeleton className="mx-auto h-4 w-10" aria-hidden /><span className="sr-only">جارٍ الحساب</span></td>
                      if (result.status === 'error') return <td key={site.id} className="py-2 text-center text-sm text-muted-foreground">غير متاح</td>
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
      {slow && <StillWorking>{reach.kind === 'drive' ? 'منطقة الوصول بالسيارة تُحسب على الطرق وتأخذ وقتاً أطول.' : 'نعدّ السكان والمنشآت داخل كل نطاق.'}</StillWorking>}
      {ready.length > 0 && (
        <div className="space-y-3">
          {ready.map((site) => (
            <SiteCard key={site.id} label={site.label} color={site.color} reach={reachLabel(reach)} activity={activity.label} state={site.result!.card} onRetry={() => retryCard(site)} action={siteAction?.(site)} />
          ))}
        </div>
      )}
    </section>
  )
}
