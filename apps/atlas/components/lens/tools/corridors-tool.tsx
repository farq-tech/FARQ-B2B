'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { Skeleton } from '@/components/ui/skeleton'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'
import { EXPLAIN } from '@/lib/explanations'
import { formatDistance, numberFormat, postMarket } from '@/lib/insights-api'
import { isPublishable, priceLine, toneColor, typeLabel, versusDistrict, type Listing } from '@/lib/real-estate'
import { ListingCard } from '../listing-card'
import { cn } from '@/lib/utils'
import { OCHRE_STEPS } from '@/lib/palette'
import { Icon3D } from '@/components/shared/icon-3d'
import { useStudiedActivity } from '@/lib/sticky-state'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import type { Overlay } from './overlay'
import { useMainActivities } from '@/lib/main-activities'
import { StreetOpportunities } from './street-opportunities'

type Corridor = {
  sub_ar: string; street_ar: string; district_ar: string; /** Absent from a service older than the road-network corridors. */ districts_ar?: string[]; n: number; n_wholesale: number
  length_m: number; per_100m: number; lift: number | null; road_class?: 'main' | 'secondary' | null
}
type Result = { type: 'FeatureCollection'; features: { geometry: GeoJSON.LineString | GeoJSON.MultiLineString; properties: Corridor }[]; basis?: string; /** false when the service could not read the activity typed. */ understood?: boolean }

/** A commercial unit on the picked street, with its distance to the street's line. */
type Unit = Listing & { distance_m?: number }
type Units = { status: 'loading' | 'ready' | 'error'; available: boolean; total: number; listings: Unit[] }
// shops, showrooms and offices within this distance of the corridor's own line (insights.COMMERCIAL_TYPES)
const UNIT_TYPES = ['store', 'showroom', 'office']
const UNIT_METERS = 60
const UNITS_SHOWN = 5

const EXAMPLES = ['أدوات صحية', 'ورش سيارات', 'قطع غيار سيارات', 'صالون حلاقة', 'خياطة', 'مفروشات', 'أغراض مواليد']
// more shops on the street reads as a deeper colour, in five even groups of the corridors shown
const HEAT = OCHRE_STEPS
const ROAD: Record<'main' | 'secondary', string> = { main: 'شارع رئيسي', secondary: 'شارع فرعي' }

/**
 * «شوارع النشاط»: the streets an activity lines, drawn along the streets themselves. Typing «أدوات صحية» or
 * «ورش سيارات» shows where that trade gathers, how many shops on how many metres, and whether it is a main road.
 */
export function CorridorsTool({ city, onOverlay }: { city: string; onOverlay: (overlay: Overlay) => void }) {
  const activities = useMainActivities(city)
  const [studied, setStudied] = useStudiedActivity()
  const [query, setQuery] = useState(studied.q ?? '')
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [active, setActive] = useState<number | null>(null)
  const [units, setUnits] = useState<Units | null>(null)
  const [unit, setUnit] = useState<Unit | null>(null)
  const [focus, setFocus] = useState<{ lon: number; lat: number } | null>(null)
  // «أين يتجمع» lists the streets the activity lines; «أين الفرصة» the busy streets that lack it (street-opportunities.tsx)
  const [mode, setMode] = useState<'cluster' | 'gap'>('cluster')

  useEffect(() => {
    let live = true
    setStatus('loading')
    setActive(null)
    // drop the last query's streets now, so the map never shows them beside the skeleton of a different query
    setResult(null)
    postMarket<Result>('street-density', { city, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) })
      .then((data) => { if (live) { setResult(data); setStatus('idle') } })
      .catch(() => { if (live) setStatus('error') })
    return () => { live = false }
  }, [city, studied])

  const corridors = useMemo(() => result?.features ?? [], [result])
  const colors = useMemo(() => {
    const counts = corridors.map((item) => item.properties.n).sort((a, b) => a - b)
    return corridors.map((item) => {
      let below = 0
      while (below < counts.length && counts[below] < item.properties.n) below++
      return HEAT[Math.min(4, Math.floor((5 * below) / Math.max(1, counts.length)))]
    })
  }, [corridors])

  // the units for rent or sale along the picked street, nearest to it first
  const picked = active != null ? corridors[active] ?? null : null
  useEffect(() => {
    setUnit(null)
    setFocus(null)
    if (!picked) { setUnits(null); return }
    let live = true
    setUnits({ status: 'loading', available: true, total: 0, listings: [] })
    postMarket<{ available?: boolean; total?: number; listings?: Unit[] }>('real-estate-listings', {
      city, types: UNIT_TYPES, near: { geometry: picked.geometry, meters: UNIT_METERS }, limit: 200,
    })
      .then((data) => {
        if (!live) return
        const listings = (data.listings ?? []).filter(isPublishable)
        setUnits({ status: 'ready', available: data.available !== false, total: Math.max(data.total ?? 0, listings.length), listings })
      })
      .catch(() => { if (live) setUnits({ status: 'error', available: true, total: 0, listings: [] }) })
    return () => { live = false }
  }, [city, picked])

  const clusters = useMemo(() => corridors.map((item) => ({ geometry: item.geometry, street_ar: item.properties.street_ar })), [corridors])

  useEffect(() => {
    if (mode === 'gap') return
    // the strongest corridors are drawn last, so they sit on top where streets cross
    const streets = corridors
      .map((item, index) => ({ id: String(index), color: colors[index], geometry: item.geometry, label: item.properties.street_ar, active: index === active }))
      .reverse()
    const listings = (units?.listings ?? []).map((item) => ({
      id: item.id, lon: item.lon, lat: item.lat, color: toneColor[versusDistrict(item)?.tone ?? 'none'], active: item.id === unit?.id,
    }))
    const top = corridors[0]?.properties
    const summary = mode !== 'cluster' || status === 'loading' || !result ? null
      : top ? `${numberFormat.format(corridors.length)} شارعاً لـ«${studied.label}» · الأعلى: ${top.street_ar} ${numberFormat.format(top.n)} محل`
        : result.understood === false ? null : `لا شارع يتجمع فيه «${studied.label}»`
    onOverlay({
      summary, streets, onStreet: (id) => setActive(Number(id)), legend: streets.length ? { from: 'محلات أقل', to: 'محلات أكثر', shades: HEAT } : null,
      listings, onListing: (id) => { const item = units?.listings.find((listing) => listing.id === id); if (item) setUnit(item) },
      focus,
      popup: unit ? <ListingCard listing={unit} comparing={false} onClose={() => setUnit(null)} /> : null,
    })
  }, [mode, corridors, colors, active, onOverlay, units, unit, focus, status, result, studied.label])

  // a corridor picked on the map comes into view in the list
  useEffect(() => {
    if (active != null) document.getElementById(`corridor-${active}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const study = (text: string) => { if (text) setStudied({ q: text, label: text }) }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">شوارع النشاط</h2>
      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); study(query.trim()) }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="النشاط" enterKeyHint="search"
          placeholder="اكتب النشاط: أدوات صحية، ورش سيارات…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
        <button type="submit" disabled={status === 'loading'} className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' ? <Loader2 className="size-5 animate-spin" aria-label="جارٍ البحث" /> : 'اعرض'}
        </button>
      </form>
      <MainActivityPicker activities={activities} value={studied.main_id ?? ''} placeholder="أو اختر نشاطاً رئيسياً"
        onChange={(id) => { const item = activities.find((a) => a.main_id === id); if (item) { setQuery(''); setStudied({ main_id: item.main_id, label: item.main_ar }) } }} />
      <div role="group" aria-label="أمثلة" className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button key={example} onClick={() => { setQuery(example); study(example) }} aria-pressed={studied.q === example}
            className={cn('inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-3 text-sm', studied.q === example ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:border-primary hover:text-primary')}><Icon3D activity={example} />{example}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg border p-1" role="group" aria-label="طريقة العرض">
        {([['cluster', 'أين يتجمع'], ['gap', 'أين الفرصة']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setMode(key)} aria-pressed={mode === key}
            className={cn('h-10 rounded-md text-base font-semibold', mode === key ? 'bg-primary text-primary-foreground' : 'hover:text-primary')}>{label}</button>
        ))}
      </div>
      {mode === 'gap' && <StreetOpportunities city={city} studied={studied} clusters={clusters} onOverlay={onOverlay} />}
      {mode === 'cluster' && status === 'error' && <p role="alert" className="text-base text-destructive">تعذر جلب الشوارع.</p>}
      {mode === 'cluster' && status === 'idle' && result?.understood === false && <p className="text-base text-muted-foreground">لم نتعرف على «{studied.label}». جرّب اسماً آخر للنشاط أو اختر نشاطاً رئيسياً.</p>}
      {mode === 'cluster' && status === 'idle' && result && result.understood !== false && !corridors.length && <p className="text-base text-muted-foreground">لا يوجد شارع يتجمع فيه هذا النشاط في المدينة (5 محلات على الأقل على الشارع نفسه).</p>}
      {mode === 'cluster' && status === 'loading' && (
        <>
          <Skeleton className="h-4 w-3/4" aria-hidden />
          <ResultRowsSkeleton rows={6} sub valueSub leading="swatch" />
        </>
      )}
      {mode === 'cluster' && status !== 'loading' && corridors.length > 0 && (
        <>
          <p className="text-base">{numberFormat.format(corridors.length)} شارعاً يتجمع فيه «{studied.label}»، مرتبة بعدد المحلات. اضغط شارعاً لتراه كاملاً على الخريطة.</p>
          <ol className="max-h-[45vh] divide-y overflow-y-auto text-base">
            {corridors.map(({ properties: corridor }, index) => (
              <ResultRow key={index} id={`corridor-${index}`} active={index === active} onClick={() => setActive(index)}
                leading={<span className="h-3 w-5 shrink-0 rounded-sm" style={{ background: colors[index] }} aria-hidden />}
                title={corridor.street_ar}
                sub={`${(corridor.districts_ar?.length ? corridor.districts_ar : [corridor.district_ar]).filter(Boolean).join('، ')}${corridor.road_class ? ` · ${ROAD[corridor.road_class]}` : ''}${corridor.n_wholesale ? ` · ${numberFormat.format(corridor.n_wholesale)} جملة` : ''}`}
                aside={(
                  <Explained title={`${corridor.street_ar} · ${corridor.sub_ar}`} lines={EXPLAIN.corridor(corridor)} className="text-end">
                    <span>
                      <span className="block font-bold text-primary">{numberFormat.format(corridor.n)} محل</span>
                      <span className="block text-sm text-muted-foreground">{numberFormat.format(corridor.per_100m)} لكل 100 م</span>
                    </span>
                  </Explained>
                )} />
            ))}
          </ol>
          {picked && units && <StreetUnits street={picked.properties.street_ar} units={units} onOpen={(item) => { setUnit(item); setFocus({ lon: item.lon, lat: item.lat }) }} />}
        </>
      )}
    </section>
  )
}

/** «محلات متاحة على هذا الشارع»: the shops, showrooms and offices offered now within 60 m of the picked street. */
function StreetUnits({ street, units, onOpen }: { street: string; units: Units; onOpen: (unit: Unit) => void }) {
  const [limit, showMore] = useShowMore(UNITS_SHOWN, street)
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Explained title={`محلات متاحة على ${street}`} lines={EXPLAIN.streetListings} className="text-base font-semibold">محلات متاحة على هذا الشارع</Explained>
        {units.status === 'ready' && units.available && units.total > 0 && <span className="shrink-0 font-bold text-primary">{numberFormat.format(units.total)}</span>}
      </div>
      {units.status === 'loading' && <ResultRowsSkeleton label="جارٍ البحث عن الوحدات" rows={3} sub />}
      {units.status === 'error' && <p role="alert" className="text-sm text-destructive">تعذر جلب الوحدات المعروضة.</p>}
      {units.status === 'ready' && !units.available && <p className="text-sm text-muted-foreground">غير متاح</p>}
      {units.status === 'ready' && units.available && !units.total && <p className="text-sm text-muted-foreground">لا توجد وحدات معروضة الآن على هذا الشارع</p>}
      {units.status === 'ready' && units.total > 0 && (
        <>
          <ol className="divide-y text-base">
            {units.listings.slice(0, limit).map((item) => (
              <ResultRow key={item.id} onClick={() => onOpen(item)}
                title={`${typeLabel(item.type)}${item.kind === 'sale' ? ' للبيع' : item.kind === 'rent' ? ' للإيجار' : ''}`}
                sub={`${item.area_sqm != null ? `${numberFormat.format(item.area_sqm)} م²` : 'المساحة غير متاحة'}${item.distance_m != null ? ` · ${formatDistance(item.distance_m)} من الشارع` : ''}`}
                value={<span className="text-sm">{priceLine(item)}</span>} />
            ))}
          </ol>
          {/* the service names up to 200; the count above is its total, so «more» stops at what it named */}
          <MoreRows shown={Math.min(limit, units.listings.length)} total={units.total} noun="listing"
            canMore={limit < units.listings.length} onMore={showMore} />
        </>
      )}
    </div>
  )
}
