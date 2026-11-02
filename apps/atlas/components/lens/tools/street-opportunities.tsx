'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import { OLIVE_STEPS, PALETTE } from '@/lib/palette'
import type { StudiedActivity } from '@/lib/sticky-state'
import type { Overlay } from './overlay'

type Opportunity = {
  street_ar: string; districts_ar: string[]; road_class: 'main' | 'secondary' | null; total: number; others: number; activities: number
  /** Shops of the requested activity on the street; null when it has no cluster there (see requested_below) or the count is unknown. */
  requested_n: number | null
  /** Set when the activity has fewer than this many shops on the street: no cluster of it there. */
  requested_below: number | null
  expected: number; population: number | null; score: number
  nearest: { street_ar: string; n: number; distance_m: number } | null
}
type Result = {
  type: 'FeatureCollection'; features: { geometry: GeoJSON.MultiLineString; properties: Opportunity }[]
  understood?: boolean; available?: boolean; population_used?: boolean; requested_kinds?: number
}
/** A street where the activity already gathers, drawn quietly beside the opportunities for reference. */
export type Cluster = { geometry: GeoJSON.LineString | GeoJSON.MultiLineString; street_ar: string }

// a stronger opportunity reads as a deeper olive, set apart from the ochre of «أين يتجمع»
const SHADES = OLIVE_STEPS.slice(1)
const CLUSTER = PALETTE.stone
const ROAD: Record<'main' | 'secondary', string> = { main: 'شارع رئيسي', secondary: 'شارع فرعي' }

const shade = (score: number) => SHADES[Math.min(SHADES.length - 1, Math.floor((score / 100) * SHADES.length))]
const distance = (meters: number) => (meters >= 1000 ? `${numberFormat.format(Math.round(meters / 100) / 10)} كم` : `${numberFormat.format(meters)} م`)

function requestedLine(item: Opportunity, kinds: number): string {
  if (item.requested_n != null) return `${numberFormat.format(item.requested_n)} محل منه`
  if (item.requested_below != null) return `أقل من ${numberFormat.format(item.requested_below)} منه${kinds > 1 ? ' من كل نوع' : ''}`
  return 'عدده غير متاح'
}

/**
 * «أين الفرصة»: named streets with strong commercial life where the studied activity is absent or thin against the
 * street's size, scored out of 100 within the city. The evidence is shown; the choice stays with the viewer.
 */
export function StreetOpportunities({ city, studied, clusters, onOverlay }: {
  city: string; studied: StudiedActivity; clusters: Cluster[]; onOverlay: (overlay: Overlay) => void
}) {
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    setStatus('loading')
    setActive(null)
    postMarket<Result>('street-opportunities', { city, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) })
      .then((data) => { if (live) { setResult(data); setStatus('idle') } })
      .catch(() => { if (live) setStatus('error') })
    return () => { live = false }
  }, [city, studied])

  const streets = useMemo(() => result?.features ?? [], [result])
  const kinds = result?.requested_kinds ?? 1

  useEffect(() => {
    const reference = clusters.map((item, index) => ({ id: `c${index}`, color: CLUSTER, geometry: item.geometry, label: item.street_ar }))
    // the strongest opportunities are drawn last, so they sit on top where streets cross
    const drawn = streets
      .map((item, index) => ({ id: `o${index}`, color: shade(item.properties.score), geometry: item.geometry, label: item.properties.street_ar, active: index === active }))
      .reverse()
    onOverlay({
      streets: [...reference, ...drawn],
      onStreet: (id) => { if (id.startsWith('o')) setActive(Number(id.slice(1))) },
      legend: drawn.length ? { from: 'فرصة أقل', to: 'فرصة أكبر', shades: SHADES, ...(reference.length ? { extra: { color: CLUSTER, label: 'يتجمع فيه النشاط الآن' } } : {}) } : null,
    })
  }, [streets, clusters, active, onOverlay])

  useEffect(() => {
    if (active != null) document.getElementById(`opportunity-${active}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  if (status === 'loading') return <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="جارٍ البحث" />
  if (status === 'error') return <p role="alert" className="text-base text-destructive">تعذر جلب فرص الشوارع.</p>
  if (result?.understood === false) return <p className="text-base text-muted-foreground">لم نتعرف على «{studied.label}». جرّب اسماً آخر للنشاط أو اختر نشاطاً رئيسياً.</p>
  if (result?.available === false) return <p className="text-base text-muted-foreground">غير متاح</p>
  if (!streets.length) return <p className="text-base text-muted-foreground">لا يوجد شارع تجاري نشط في المدينة ينقصه «{studied.label}».</p>

  return (
    <>
      <p className="text-base">{numberFormat.format(streets.length)} شارعاً تجارياً نشطاً ينقصه «{studied.label}»، مرتبة بالدرجة. اضغط الدرجة لترى كيف حُسبت.</p>
      <ol className="max-h-[45vh] divide-y overflow-y-auto text-base">
        {streets.map(({ properties: item }, index) => (
          <li key={index} id={`opportunity-${index}`}>
            <div className={cn('flex items-start gap-2 py-2', index === active && 'text-primary')}>
              <span className="mt-1.5 h-3 w-5 shrink-0 rounded-sm" style={{ background: shade(item.score) }} aria-hidden />
              <button onClick={() => setActive(index)} className="min-w-0 flex-1 text-start">
                <span className="block truncate font-medium">{item.street_ar}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {item.districts_ar.join('، ')}{item.road_class ? ` · ${ROAD[item.road_class]}` : ''}
                </span>
                <span className="block text-sm">
                  {numberFormat.format(item.total)} محل على الشارع · {requestedLine(item, kinds)}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {item.nearest ? `أقرب تجمع: ${item.nearest.street_ar} (${numberFormat.format(item.nearest.n)} محل) على ${distance(item.nearest.distance_m)}` : 'لا يوجد تجمع للنشاط في المدينة'}
                </span>
              </button>
              <Explained title={`${item.street_ar} · ${studied.label}`} lines={EXPLAIN.streetOpportunity(item, result?.population_used === true, kinds)} className="shrink-0 text-end">
                <span className="block font-bold text-primary">{numberFormat.format(item.score)}</span>
                <span className="block text-sm text-muted-foreground">من 100</span>
              </Explained>
            </div>
          </li>
        ))}
      </ol>
    </>
  )
}
