'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NoResult, NotAvailable } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { Explained } from '@/components/shared/explained'
import { Skeleton } from '@/components/ui/skeleton'
import { EXPLAIN } from '@/lib/explanations'
import { counted, formatDistance, numberFormat, postMarket } from '@/lib/insights-api'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'
import { OLIVE_STEPS, PALETTE } from '@/lib/palette'
import type { StudiedActivity } from '@/lib/sticky-state'
import type { Overlay } from './overlay'
import { useAnswer } from './use-answer'
import { opportunityVerdict } from './tool-answers'
import { Verdict } from './verdict'
import { opportunityFacts } from './district-facts'
import type { DistrictRow } from '../city-data'

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

function requestedLine(item: Opportunity, kinds: number): string {
  if (item.requested_n != null) return `${counted(item.requested_n, 'shop')} منه`
  if (item.requested_below != null) return `أقل من ${numberFormat.format(item.requested_below)} منه${kinds > 1 ? ' من كل نوع' : ''}`
  return 'عدده غير متاح'
}

/**
 * «أين الفرصة»: named streets with strong commercial life where the studied activity is absent or thin against the
 * street's size, scored out of 100 within the city. The evidence is shown; the choice stays with the viewer.
 */
export function StreetOpportunities({ city, rows = [], studied, clusters, onOverlay, next }: {
  city: string; rows?: DistrictRow[]; studied: StudiedActivity; clusters: Cluster[]; onOverlay: (overlay: Overlay) => void
  /** The step after the verdict (units for rent on the street, a request), given by the map shell. */
  next?: ReactNode
}) {
  const [active, setActive] = useState<number | null>(null)
  // keyed by what is asked, not by the prop object: a new object for the same activity asks nothing again, and a new
  // activity drops the last one's streets at once, so the map never draws them beside the new skeleton
  const answerKey = `${city}|${studied.q ?? ''}|${studied.main_id ?? ''}`
  const answer = useAnswer<Result>(answerKey, () => postMarket<Result>('street-opportunities', { city, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) }))
  const result = answer.data
  const status = answer.status === 'loading' ? 'loading' : answer.status === 'error' ? 'error' : 'idle'
  useEffect(() => { setActive(null) }, [answerKey])

  const streets = useMemo(() => result?.features ?? [], [result])
  const kinds = result?.requested_kinds ?? 1

  // the reference streets are a prop array: the overlay follows their names, and reads the latest list from a ref
  const clustersRef = useRef(clusters)
  clustersRef.current = clusters
  const clustersKey = clusters.map((item) => item.street_ar).join('|')
  useEffect(() => {
    const reference = clustersRef.current.map((item, index) => ({ id: `c${index}`, color: CLUSTER, geometry: item.geometry, label: item.street_ar }))
    // the strongest opportunities are drawn last, so they sit on top where streets cross
    const drawn = streets
      .map((item, index) => ({ id: `o${index}`, color: shade(item.properties.score), geometry: item.geometry, label: item.properties.street_ar, active: index === active }))
      .reverse()
    // the step's answer in one line for the phone's peeking sheet, from the service's own figures
    const top = streets[0]?.properties
    const summary = status !== 'idle' || !result || result.understood === false || result.available === false ? null
      : top ? `${counted(streets.length, 'street')} ${streets.length === 1 ? 'ينقصه' : 'ينقصها'} «${studied.label}» · الأعلى: ${top.street_ar} ${numberFormat.format(top.score)}/100`
        : `لا شارع تجاري نشط ينقصه «${studied.label}»`
    // the card on a clicked district: the opportunity the service scores highest among the streets through it
    const facts = streets.length ? opportunityFacts(streets.map((item) => item.properties), new Map(rows.map((row) => [row.name, row.id]))) : null
    onOverlay({
      summary,
      facts,
      streets: [...reference, ...drawn],
      onStreet: (id) => { if (id.startsWith('o')) setActive(Number(id.slice(1))) },
      legend: drawn.length ? { from: 'فرصة أقل', to: 'فرصة أكبر', shades: SHADES, ...(reference.length ? { extra: { color: CLUSTER, label: 'يتجمع فيه النشاط الآن' } } : {}) } : null,
    })
  }, [streets, clustersKey, active, onOverlay, status, result, studied.label, rows])

  // 30 streets at a time; one picked on the map further down is drawn so it can come into view
  // a shortlist first: the verdict names the top street, the rest are one tap away
  const [limit, showMore] = useShowMore(10, `${city}|${studied.q ?? studied.main_id}`)
  const visible = Math.max(limit, active != null ? active + 1 : 0)

  useEffect(() => {
    if (active != null) document.getElementById(`opportunity-${active}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  if (status === 'loading') {
    return (
      <>
        <Skeleton className="h-5 w-3/4" aria-hidden />
        <ResultRowsSkeleton label="جارٍ البحث عن الفرص" rows={6} leading="swatch" sub valueSub />
      </>
    )
  }
  if (status === 'error') return <LoadError what="فرص الشوارع" onRetry={answer.retry} />
  if (result?.understood === false) return <NoResult title={`لم نتعرف على «${studied.label}»`} body="جرّب اسماً آخر للنشاط، أو اختر نشاطاً رئيسياً." />
  if (result?.available === false) return <NotAvailable what="فرص الشوارع" where="هذه المدينة" body="جرّب «أين يتجمع» لترى الشوارع التي يتجمع فيها النشاط." />
  if (!streets.length) return <NoResult title={`لا شارع تجاري نشط ينقصه «${studied.label}»`} body="النشاط موجود في الشوارع التجارية النشطة. جرّب «أين يتجمع»." />

  return (
    <>
      <Verdict lift verdict={opportunityVerdict(streets.map((item) => item.properties), studied.label, result?.population_used !== false, formatDistance)} next={next} />
      <p className="text-sm text-muted-foreground">{counted(streets.length, 'street')} {streets.length === 1 ? 'تجاري نشط ينقصه' : 'تجارية نشطة ينقصها'} «{studied.label}»، الأقوى فرصة أولاً. اضغط الدرجة لترى كيف حُسبت.</p>
      <ol className="divide-y text-base lg:max-h-[45vh] lg:overflow-y-auto">
        {streets.slice(0, visible).map(({ properties: item }, index) => (
          <ResultRow key={index} id={`opportunity-${index}`} active={index === active} onClick={() => setActive(index)}
            leading={<span className="h-3 w-5 shrink-0 rounded-sm" style={{ background: shade(item.score) }} aria-hidden />}
            title={item.street_ar}
            sub={(
              <>
                <span className="block truncate">{item.districts_ar.join('، ')}{item.road_class ? ` · ${ROAD[item.road_class]}` : ''}</span>
                <span className="block truncate text-foreground">{counted(item.total, 'shop')} على الشارع · {requestedLine(item, kinds)}</span>
                <span className="block truncate">
                  {item.nearest ? `أقرب تجمع: ${item.nearest.street_ar} (${counted(item.nearest.n, 'shop')}) ${item.nearest.distance_m < 30 ? 'يتقاطع معه أو يلاصقه' : `على ${formatDistance(item.nearest.distance_m)}`}` : 'لا يوجد تجمع للنشاط في المدينة'}
                </span>
              </>
            )}
            aside={(
              <Explained title={`${item.street_ar} · ${studied.label}`} lines={EXPLAIN.streetOpportunity(item, result?.population_used === true, kinds)} className="text-end">
                <span>
                  <span className="block font-bold text-primary">{numberFormat.format(item.score)}</span>
                  <span className="block text-sm text-muted-foreground">من 100</span>
                </span>
              </Explained>
            )} />
        ))}
      </ol>
      <MoreRows shown={Math.min(visible, streets.length)} total={streets.length} noun="street" onMore={showMore} />
    </>
  )
}
