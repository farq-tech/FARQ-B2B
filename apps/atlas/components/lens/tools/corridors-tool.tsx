'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton'
import { counted, numberFormat, postMarket } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import { OCHRE_STEPS } from '@/lib/palette'
import { Icon3D } from '@/components/shared/icon-3d'
import { useStudiedActivity } from '@/lib/sticky-state'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import type { Overlay } from './overlay'
import { useMainActivities } from '@/lib/main-activities'

type Corridor = {
  sub_ar: string; street_ar: string; district_ar: string; /** Absent from a service older than the road-network corridors. */ districts_ar?: string[]; n: number; n_wholesale: number
  length_m: number; per_100m: number; lift: number | null; road_class?: 'main' | 'secondary' | null
}
type Result = { type: 'FeatureCollection'; features: { geometry: GeoJSON.LineString | GeoJSON.MultiLineString; properties: Corridor }[]; basis?: string; /** false when the service could not read the activity typed. */ understood?: boolean }

const EXAMPLES = ['أدوات صحية', 'ورش سيارات', 'قطع غيار سيارات', 'صالون حلاقة', 'خياطة', 'مفروشات', 'أغراض مواليد']
// more shops on the street reads as a deeper colour, in five even groups of the corridors shown
const HEAT = OCHRE_STEPS
const ROAD: Record<'main' | 'secondary', string> = { main: 'شارع رئيسي', secondary: 'شارع فرعي' }

/** The explanation behind one corridor's figures. */
function explain(corridor: Corridor): string[] {
  const lines = [
    `${counted(corridor.n, 'business')} من «${corridor.sub_ar}» على ${numberFormat.format(corridor.length_m)} م من الشارع: ${numberFormat.format(corridor.per_100m)} لكل 100 م.`,
    'كل منشأة على أقرب شارع مسمّى لها حتى 60 م، والممر مقاطع الشارع نفسه التي فيها النشاط، متصلة ولو عبرت أكثر من حي.',
  ]
  if (corridor.lift != null) lines.push(`حصة النشاط بين منشآت هذا الممر ${numberFormat.format(corridor.lift)} ضعف حصته في المدينة.`)
  if (corridor.n_wholesale) lines.push(`منها ${counted(corridor.n_wholesale, 'business')} جملة.`)
  return lines
}

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

  useEffect(() => {
    // the strongest corridors are drawn last, so they sit on top where streets cross
    const streets = corridors
      .map((item, index) => ({ id: String(index), color: colors[index], geometry: item.geometry, label: item.properties.street_ar, active: index === active }))
      .reverse()
    onOverlay({ streets, onStreet: (id) => setActive(Number(id)), legend: streets.length ? { from: 'محلات أقل', to: 'محلات أكثر', shades: HEAT } : null })
  }, [corridors, colors, active, onOverlay])

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
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button key={example} onClick={() => { setQuery(example); study(example) }} className="inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-3 text-sm hover:border-primary hover:text-primary"><Icon3D activity={example} />{example}</button>
        ))}
      </div>
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر جلب الشوارع.</p>}
      {status === 'idle' && result?.understood === false && <p className="text-base text-muted-foreground">لم نتعرف على «{studied.label}». جرّب اسماً آخر للنشاط أو اختر نشاطاً رئيسياً.</p>}
      {status === 'idle' && result && result.understood !== false && !corridors.length && <p className="text-base text-muted-foreground">لا يوجد شارع يتجمع فيه هذا النشاط في المدينة (5 محلات على الأقل على الشارع نفسه).</p>}
      {status === 'loading' && (
        <>
          <Skeleton className="h-4 w-3/4" aria-hidden />
          <SkeletonRows rows={6} sub trailing="double" leading="swatch" />
        </>
      )}
      {status !== 'loading' && corridors.length > 0 && (
        <>
          <p className="text-base">{numberFormat.format(corridors.length)} شارعاً يتجمع فيه «{studied.label}»، مرتبة بعدد المحلات. اضغط شارعاً لتراه كاملاً على الخريطة.</p>
          <ol className="max-h-[45vh] divide-y overflow-y-auto text-base">
            {corridors.map(({ properties: corridor }, index) => (
              <li key={index} id={`corridor-${index}`}>
                <div className={cn('flex items-start gap-2 py-2', index === active && 'text-primary')}>
                  <span className="mt-1.5 h-3 w-5 shrink-0 rounded-sm" style={{ background: colors[index] }} aria-hidden />
                  <button onClick={() => setActive(index)} className="min-w-0 flex-1 text-start">
                    <span className="block truncate font-medium">{corridor.street_ar}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {(corridor.districts_ar?.length ? corridor.districts_ar : [corridor.district_ar]).filter(Boolean).join('، ')}
                      {corridor.road_class ? ` · ${ROAD[corridor.road_class]}` : ''}
                      {corridor.n_wholesale ? ` · ${numberFormat.format(corridor.n_wholesale)} جملة` : ''}
                    </span>
                  </button>
                  <Explained title={`${corridor.street_ar} · ${corridor.sub_ar}`} lines={explain(corridor)} className="shrink-0 text-end">
                    <span className="block font-bold text-primary">{numberFormat.format(corridor.n)} محل</span>
                    <span className="block text-sm text-muted-foreground">{numberFormat.format(corridor.per_100m)} لكل 100 م</span>
                  </Explained>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
