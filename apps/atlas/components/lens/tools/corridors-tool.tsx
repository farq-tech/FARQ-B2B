'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { NoResult, NotAvailable } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { Explained } from '@/components/shared/explained'
import { Skeleton } from '@/components/ui/skeleton'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'
import { EXPLAIN } from '@/lib/explanations'
import { counted, formatDistance, numberFormat, percent, postMarket } from '@/lib/insights-api'
import { isPublishable, priceLine, sar, toneColor, typeLabel, versusDistrict, type Listing } from '@/lib/real-estate'
import { ListingCard } from '../listing-card'
import { OCHRE_STEPS } from '@/lib/palette'
import { stickyHas, useStudiedActivity } from '@/lib/sticky-state'
import { ActivityPicker } from '@/components/shared/activity-picker'
import { waiting, type Overlay } from './overlay'
import { activityBody, activityKey, studiedFrom, useActivities, type ActivityQuery } from '@/lib/activities'
import { StreetOpportunities } from './street-opportunities'
import { useAnswer } from './use-answer'
import { Choice } from './choice'
import { corridorVerdict, oversizedShop } from './tool-answers'
import { Examples } from './examples'
import { Verdict } from './verdict'
import { corridorFacts } from './district-facts'
import type { DistrictRow } from '../city-data'

type Corridor = {
  sub_ar: string; street_ar: string; district_ar: string; /** Absent from a service older than the road-network corridors. */ districts_ar?: string[]; n: number; n_wholesale: number
  length_m: number; per_100m: number; lift: number | null; road_class?: 'main' | 'secondary' | null
}
type Result = { type: 'FeatureCollection'; features: { geometry: GeoJSON.LineString | GeoJSON.MultiLineString; properties: Corridor }[]; basis?: string; /** false when the service could not read the activity typed. */ understood?: boolean
  /** false when the streets cannot be told apart at the picked specialty («برجر»): nothing is drawn under its name. */ specialty_available?: boolean }

/** A commercial unit on the picked street, with its distance to the street's line. */
type Unit = Listing & { distance_m?: number }
type RentLevel = { units: number; median_annual_sar: number | null; per_sqm_units: number; median_annual_sar_per_sqm: number | null }
/** The street's asking rent against the units around it (insights.rent_summary); absent from an older service. */
type RentSummary = { street: RentLevel; around: RentLevel; around_m: number; min_units: number; vs_around_pct: { annual: number | null; per_sqm: number | null } }
type Units = { status: 'loading' | 'ready' | 'error'; available: boolean; total: number; listings: Unit[]; rent?: RentSummary }
// shops, showrooms and offices within this distance of the corridor's own line (insights.COMMERCIAL_TYPES)
const UNIT_TYPES = ['store', 'showroom', 'office']
const UNIT_METERS = 60
const UNITS_SHOWN = 5
// a street median from fewer ads than this is a small sample (lenses.RELIABLE_LISTINGS)
const THIN_SAMPLE = 10

const EXAMPLES = ['أدوات صحية', 'ورش سيارات', 'قطع غيار سيارات', 'صالون حلاقة', 'خياطة', 'مفروشات', 'أغراض مواليد']
// more shops on the street reads as a deeper colour, in five even groups of the corridors shown
const HEAT = OCHRE_STEPS
const ROAD: Record<'main' | 'secondary', string> = { main: 'شارع رئيسي', secondary: 'شارع فرعي' }

/**
 * The question «شوارع النشاط» asks for an activity: its key, its cache name and its one request. The map asks the same
 * question ahead of time (one request, when the page is idle), so the step opens on its answer (lens-map prefetch).
 */
export function streetsQuestion(city: string, studied: ActivityQuery) {
  return {
    key: `${city}|${activityKey(studied)}`,
    cache: 'streets',
    run: () => postMarket<Result>('street-density', { city, ...activityBody(studied) }),
  }
}

/**
 * «شوارع النشاط»: the streets an activity lines, drawn along the streets themselves. Typing «أدوات صحية» or
 * «ورش سيارات» shows where that trade gathers, how many shops on how many metres, and whether it is a main road.
 */
export function CorridorsTool({ city, rows = [], onOverlay, next }: {
  city: string; rows?: DistrictRow[]; onOverlay: (overlay: Overlay) => void
  /** The step after the verdict (units for rent on the street, a request), given by the map shell. */
  next?: ReactNode
}) {
  const activities = useActivities(city)
  const [studied, setStudied] = useStudiedActivity()
  // no street is drawn for an activity nobody picked: the step waits for one (here, another step, or a link)
  const chosen = stickyHas('activity')
  const [query, setQuery] = useState(chosen ? studied.q ?? '' : '')
  const [active, setActive] = useState<number | null>(null)
  const [unit, setUnit] = useState<Unit | null>(null)
  const [focus, setFocus] = useState<{ lon: number; lat: number } | null>(null)
  // «أين يتجمع» lists the streets the activity lines; «أين الفرصة» the busy streets that lack it (street-opportunities.tsx)
  const [mode, setMode] = useState<'cluster' | 'gap'>('cluster')

  // the streets of one activity; a new activity clears the last one's streets at once, and its picked street with them
  const question = streetsQuestion(city, studied)
  const streetsKey = question.key
  const answer = useAnswer<Result>(chosen ? streetsKey : null, question.run, { cache: question.cache })
  const result = answer.data
  const status = answer.status === 'loading' ? 'loading' : answer.status === 'error' ? 'error' : 'idle'
  useEffect(() => { setActive(null) }, [streetsKey])

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
  // keyed by the street picked (its place in this answer), not by the feature object
  const unitsAnswer = useAnswer<Units>(picked ? `${streetsKey}|${active}` : null, () => postMarket<{ available?: boolean; total?: number; listings?: Unit[]; rent_summary?: RentSummary }>('real-estate-listings', {
    city, types: UNIT_TYPES, near: { geometry: picked!.geometry, meters: UNIT_METERS }, limit: 200,
  }).then((data): Units => {
    const listings = (data.listings ?? []).filter(isPublishable)
    return { status: 'ready', available: data.available !== false, total: Math.max(data.total ?? 0, listings.length), listings, rent: data.rent_summary }
  }))
  // one object per answer, so the map's overlay is not handed a new one on every render
  const hasPicked = picked != null
  const units = useMemo<Units | null>(() => (!hasPicked ? null
    : unitsAnswer.status === 'ready' && unitsAnswer.data ? unitsAnswer.data
      : { status: unitsAnswer.status === 'error' ? 'error' : 'loading', available: true, total: 0, listings: [] }), [hasPicked, unitsAnswer.status, unitsAnswer.data])
  useEffect(() => { setUnit(null); setFocus(null) }, [streetsKey, active])

  const clusters = useMemo(() => corridors.map((item) => ({ geometry: item.geometry, street_ar: item.properties.street_ar })), [corridors])
  // the card on a clicked district: the corridor with most shops running through it, as the service counted them
  const facts = useMemo(() => (corridors.length ? corridorFacts(corridors.map((item) => item.properties), new Map(rows.map((row) => [row.name, row.id]))) : null), [corridors, rows])

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
      : top ? `${counted(corridors.length, 'street')} لـ«${studied.label}» · الأعلى: ${top.street_ar} ${counted(top.n, 'shop')}`
        : result.understood === false || result.specialty_available === false ? null : `لا شارع يتجمع فيه «${studied.label}»`
    onOverlay({
      ...(result ? {} : waiting(answer)),
      summary, facts, streets, onStreet: (id) => setActive(Number(id)), legend: streets.length ? { from: 'محلات أقل', to: 'محلات أكثر', shades: HEAT } : null,
      listings, onListing: (id) => { const item = units?.listings.find((listing) => listing.id === id); if (item) setUnit(item) },
      focus,
      popup: unit ? <ListingCard listing={unit} comparing={false} onClose={() => setUnit(null)} /> : null,
    })
    // answer.retry is stable; slow is what the no-answer overlay says
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, corridors, colors, active, onOverlay, units, unit, focus, status, result, studied.label, facts, answer.slow])

  // a long list draws 30 streets at a time; a street picked on the map further down is drawn so it can come into view
  // a shortlist first: the verdict names the top two, the rest are one tap away
  const [limit, showMore] = useShowMore(10, `${city}|${activityKey(studied)}`)
  const visible = Math.max(limit, active != null ? active + 1 : 0)

  // a corridor picked on the map comes into view in the list
  useEffect(() => {
    if (active != null) document.getElementById(`corridor-${active}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const study = (text: string) => { if (text) setStudied({ q: text, label: text }) }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold max-lg:-order-2">شوارع النشاط</h2>
      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); study(query.trim()) }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="النشاط" enterKeyHint="search"
          placeholder="اكتب النشاط: أدوات صحية، ورش سيارات…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
        <button type="submit" disabled={status === 'loading'} className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' ? <Loader2 className="size-5 animate-spin" aria-label="جارٍ البحث" /> : 'اعرض'}
        </button>
      </form>
      <ActivityPicker activities={activities} value={studied.q ? null : studied} placeholder="أو اختر تخصصاً: مغسلة ملابس، برجر…"
        onPick={(item) => { if (item) { setQuery(''); setStudied(studiedFrom(item)) } }} />
      <Examples examples={EXAMPLES} active={chosen ? studied.q ?? null : null} collapse={chosen && status === 'idle' && corridors.length > 0} onPick={(example) => { setQuery(example); study(example) }} />
      <Choice label="طريقة العرض" size="base" value={mode} onChange={setMode} options={[{ id: 'cluster', label: 'أين يتجمع' }, { id: 'gap', label: 'أين الفرصة' }]} />
      {!chosen && <p className="text-base text-muted-foreground">اختر النشاط لترى الشوارع التي يتجمع فيها، أو التي ينقصها.</p>}
      {mode === 'gap' && chosen && <StreetOpportunities city={city} rows={rows} studied={studied} clusters={clusters} onOverlay={onOverlay} />}
      {mode === 'cluster' && status === 'error' && <LoadError what="الشوارع" onRetry={answer.retry} />}
      {mode === 'cluster' && status === 'idle' && result?.understood === false && <NoResult title={`لم نتعرف على «${studied.label}»`} body="جرّب اسماً آخر للنشاط، أو اختر تخصصاً من القائمة." />}
      {mode === 'cluster' && status === 'idle' && result?.specialty_available === false && (
        <NotAvailable what="شوارع التخصص" where={`«${studied.label}»`} body="شوارع هذا التخصص الدقيق لم تُحسب بعد. اختر تخصصه الأعم (مثل «وجبات سريعة») لترى شوارعه." />
      )}
      {mode === 'cluster' && status === 'idle' && result && result.understood !== false && result.specialty_available !== false && !corridors.length && (
        <NoResult title={`لا شارع يتجمع فيه «${studied.label}»`} body="يُحسب الشارع حين يكون عليه 5 محلات أو أكثر من النشاط. جرّب نشاطاً آخر أو «أين الفرصة»." />
      )}
      {mode === 'cluster' && status === 'loading' && (
        <>
          <Skeleton className="h-4 w-3/4" aria-hidden />
          <ResultRowsSkeleton rows={6} sub valueSub leading="swatch" />
        </>
      )}
      {mode === 'cluster' && status !== 'loading' && corridors.length > 0 && (
        <>
          <Verdict lift verdict={corridorVerdict(corridors.map((item) => item.properties), studied.label)} next={next} />
          <p className="text-sm text-muted-foreground">{counted(corridors.length, 'street')} يتجمع {corridors.length === 1 ? 'فيه' : 'فيها'} «{studied.label}»، الأكثر محلات أولاً. اضغط شارعاً لترى المحلات المتاحة عليه وإيجارها.</p>
          <ol className="divide-y text-base lg:max-h-[45vh] lg:overflow-y-auto">
            {corridors.slice(0, visible).map(({ properties: corridor }, index) => (
              <ResultRow key={index} id={`corridor-${index}`} active={index === active} onClick={() => setActive(index)}
                leading={<span className="h-3 w-5 shrink-0 rounded-sm" style={{ background: colors[index] }} aria-hidden />}
                title={corridor.street_ar}
                sub={`${(corridor.districts_ar?.length ? corridor.districts_ar : [corridor.district_ar]).filter(Boolean).join('، ')}${corridor.road_class ? ` · ${ROAD[corridor.road_class]}` : ''}${corridor.n_wholesale ? ` · ${numberFormat.format(corridor.n_wholesale)} جملة` : ''}`}
                aside={(
                  <Explained title={`${corridor.street_ar} · ${corridor.sub_ar}`} lines={EXPLAIN.corridor(corridor)} className="text-end">
                    <span>
                      <span className="block font-bold text-primary">{counted(corridor.n, 'shop')}</span>
                      <span className="block text-sm text-muted-foreground">{numberFormat.format(Math.round(corridor.per_100m * 10) / 10)} لكل 100 م</span>
                    </span>
                  </Explained>
                )} />
            ))}
          </ol>
          <MoreRows shown={Math.min(visible, corridors.length)} total={corridors.length} noun="street" onMore={showMore} />
          {picked && units && <StreetUnits street={picked.properties.street_ar} units={units} onRetry={unitsAnswer.retry} onOpen={(item) => { setUnit(item); setFocus({ lon: item.lon, lat: item.lat }) }} />}
        </>
      )}
    </section>
  )
}

/** «محلات متاحة على هذا الشارع»: the shops, showrooms and offices offered now within 60 m of the picked street. */
function StreetUnits({ street, units, onOpen, onRetry }: { street: string; units: Units; onOpen: (unit: Unit) => void; onRetry: () => void }) {
  const [limit, showMore] = useShowMore(UNITS_SHOWN, street)
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Explained title={`محلات متاحة على ${street}`} lines={EXPLAIN.streetListings} className="text-base font-semibold">محلات متاحة على هذا الشارع</Explained>
        {units.status === 'ready' && units.available && units.total > 0 && <span className="shrink-0 font-bold text-primary">{numberFormat.format(units.total)}</span>}
      </div>
      {units.status === 'loading' && <ResultRowsSkeleton label="جارٍ البحث عن الوحدات" rows={3} sub />}
      {units.status === 'error' && <LoadError what="الوحدات المعروضة" onRetry={onRetry} />}
      {units.status === 'ready' && !units.available && <NotAvailable what="الوحدات المعروضة" where="هذه المدينة" body="الشوارع وعدد محلات النشاط عليها تبقى في القائمة أعلاه." />}
      {units.status === 'ready' && units.available && !units.total && <NoResult title="لا وحدات معروضة على هذا الشارع الآن" body="جرّب شارعاً آخر من القائمة." />}
      {units.status === 'ready' && units.available && units.rent && <StreetRent street={street} rent={units.rent} />}
      {units.status === 'ready' && units.total > 0 && (
        <>
          <ol className="divide-y text-base">
            {units.listings.slice(0, limit).map((item) => (
              <ResultRow key={item.id} onClick={() => onOpen(item)}
                title={`${typeLabel(item.type)}${item.kind === 'sale' ? ' للبيع' : item.kind === 'rent' ? ' للإيجار' : ''}`}
                sub={`${item.area_sqm != null ? `${numberFormat.format(item.area_sqm)} م²` : 'المساحة غير متاحة'}${item.distance_m != null ? ` · ${formatDistance(item.distance_m)} من الشارع` : ''}${oversizedShop(item.type, item.area_sqm) ? ` · ${oversizedShop(item.type, item.area_sqm)}` : ''}`}
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

/** «أعلى من محيطه بـ 12%» / «أقل …» / «قريب من محيطه», or null without both medians. */
function versusAround(pct: number | null): string | null {
  if (pct == null) return null
  if (Math.abs(pct) < 5) return 'قريب من محيطه'
  return `${pct > 0 ? 'أعلى' : 'أقل'} من محيطه بـ ${percent(Math.abs(pct))}`
}

/** «مستوى الإيجار على هذا الشارع»: the median asking rent a year, and per m², on the street and around it. */
function StreetRent({ street, rent }: { street: string; rent: RentSummary }) {
  const rows = [
    { label: 'الإيجار السنوي', here: rent.street.median_annual_sar, there: rent.around.median_annual_sar, pct: rent.vs_around_pct.annual,
      n: rent.street.units, m: rent.around.units },
    { label: 'سعر المتر سنوياً', here: rent.street.median_annual_sar_per_sqm, there: rent.around.median_annual_sar_per_sqm, pct: rent.vs_around_pct.per_sqm,
      n: rent.street.per_sqm_units, m: rent.around.per_sqm_units },
  ]
  const value = (figure: number | null, count: number) => (
    <span className="block">
      <span className="block font-semibold">{figure == null ? 'غير متاح' : sar(figure)}</span>
      <span className="block text-xs text-muted-foreground">{count ? counted(count, 'listing') : 'لا عروض'}</span>
    </span>
  )
  return (
    <div className="flex flex-col gap-1.5 border-b pb-2">
      <Explained title={`مستوى الإيجار على ${street}`} lines={EXPLAIN.streetRent} className="text-base font-semibold">مستوى الإيجار على هذا الشارع</Explained>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 text-start font-normal" />
            <th className="py-1 text-start font-normal">هذا الشارع</th>
            <th className="py-1 text-start font-normal">المحيط ({numberFormat.format(rent.around_m)} م)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="align-top">
              <td className="py-1 pe-2">{row.label}</td>
              <td className="py-1 pe-2">{value(row.here, row.n)}</td>
              <td className="py-1">{value(row.there, row.m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.map((row) => versusAround(row.pct) && (
        <p key={row.label} className="text-sm font-medium text-primary">{row.label}: {versusAround(row.pct)}</p>
      ))}
      {/* a median from a handful of ads is shown, and said to be one */}
      {rent.street.units > 0 && rent.street.units < THIN_SAMPLE && (
        <p className="text-sm text-warning">عينة صغيرة: {counted(rent.street.units, 'listing')} فقط على الشارع، فعرض واحد يغيّر الوسيط كثيراً.</p>
      )}
    </div>
  )
}
