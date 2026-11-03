'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Building2, Calculator, ChevronDown, List, Map as MapIcon, Scale, Search, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { Icon3D } from '@/components/shared/icon-3d'
import { ListingFace } from '@/components/shared/listing-face'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { ChipRow } from '@/components/shared/search-pill'
import { Chip } from '@/components/ui/chip'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket, useCities } from '@/lib/insights-api'
import { LISTING_TYPES, shownPhotos, RENT_DEALS, daysAgo, flattenSimilar, groupSimilar, priceLine, priceTag, similarLabel, toneColor, typeLabel, versusDistrict, type Listing, ageLabel } from '@/lib/real-estate'
import { DEFAULT_FILTERS, activeFilters, applyFilters, dealOf, offersLabel, type HomeFilters } from '@/lib/real-estate-filters'
import { HomesFilters } from './homes-filters'
import { CopyLinkButton } from '@/components/shared/copy-link'
import { DEFAULT_CITY, backIfReturning, districtMapHref, historyGate, pushedState, priceStartHref, readHomesMax, readHomesQuery, readListing, rememberView, writeHomesQuery } from '@/lib/handoff'
import { cn } from '@/lib/utils'
import { AdvisorPanel } from '../lens/advisor-panel'
import { useCityData } from '../lens/city-data'
import { LensMapCanvas, type BusinessGroup, type ListingDot } from '../lens/lens-map-canvas'
import { Gallery, ListingCard } from '../lens/listing-card'
import { GroupCard } from '../lens/group-card'
import { ListingCompare } from '../lens/listing-compare'

const LIMIT = 1500
const PAGE = 24
const NO_STEPS = new Map<string, number>()

/** «45k» or «1.2M» for a price pin. */
function shortPrice(price: number | null): string | undefined {
  if (!price) return undefined
  return price >= 1_000_000 ? `${numberFormat.format(Math.round(price / 100_000) / 10)}M` : `${numberFormat.format(Math.round(price / 1000))}k`
}

/**
 * «العقار»: current listings as photo cards in two columns beside a map of price pins. Every filter (deal and period,
 * types, districts, price, area, rooms, street, photos, sort) lives in one sheet (HomesFilters); a phone shows the city
 * and one button for it, a wide screen the search pill too, and the set filters are chips under either; moving the map can limit
 * the cards to what is in view. A card or a pin opens the listing's card over the map; two go to the comparison
 * assistant. Modelled on the search-results-with-map pattern (Screenrove: airbnb-product-results).
 */
export function HomesPage() {
  const cities = useCities()
  const cityOptions = useMemo(() => cities.map((item) => [item.en, item.ar || item.en] as const), [cities])
  const [city, setCity] = useState<string>('Riyadh')
  const [filters, setFilters] = useState<HomeFilters>(DEFAULT_FILTERS)
  const [sheet, setSheet] = useState(false)
  const { kind, types } = filters
  const deal = dealOf(filters)
  const typesKey = types.join(','), districtsKey = filters.districts.join(',')
  const change = useCallback((next: Partial<HomeFilters>) => setFilters((current) => ({ ...current, ...next })), [])
  // `key` names the ask the listings answer, so a listing named by the address is looked for in the right answer
  const [result, setResult] = useState<{ status: 'loading' | 'ready' | 'error'; available: boolean; total: number | null; listings: Listing[]; key?: string }>({ status: 'loading', available: true, total: null, listings: [] })
  const [inView, setInView] = useState(true)
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [active, setActive] = useState<Listing | null>(null)
  // a group of listings that was clicked on the map (its card names the cheapest), and where it sits on screen
  const [group, setGroup] = useState<BusinessGroup | null>(null)
  const [groupAt, setGroupAt] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  useEffect(() => { setGroup(null) }, [result.listings])
  const [focus, setFocus] = useState<{ lon: number; lat: number } | null>(null)
  const [compare, setCompare] = useState<Listing[]>([])
  const [sideBySide, setSideBySide] = useState(false)
  const [advise, setAdvise] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [mobileMap, setMobileMap] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // the list follows the map only once the person can see the map: always on a wide screen, and on a phone after they
  // open it. Before that a phone's hidden map still reports bounds, and the list was cut to a view nobody saw.
  const [mapSeen, setMapSeen] = useState(false)
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 64rem)')
    const sync = () => { if (wide.matches) setMapSeen(true) }
    sync()
    wide.addEventListener('change', sync)
    return () => wide.removeEventListener('change', sync)
  }, [])
  useEffect(() => { if (mobileMap) setMapSeen(true) }, [mobileMap])
  const data = useCityData(city)

  // a type the deal does not offer (land for rent) falls back to a flat; a new city or deal starts its own ranges
  // keyed by the types' ids (typesKey), not the array, so a new array with the same types does not re-run it
  useEffect(() => {
    const kept = types.filter((id) => LISTING_TYPES.find((item) => item.id === id)?.kinds.includes(kind))
    if (kept.length !== types.length) change({ types: kept.length ? kept : ['apartment'] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, typesKey, change])
  // a budget the address carries (?max=, from the map's property journey) belongs to the deal it came with: kept while
  // that deal settles in, cleared like any price once the deal changes
  const presetMax = useRef<{ max: number; deal: string | null } | null>(null)
  useEffect(() => {
    const preset = presetMax.current
    if (preset && preset.deal !== deal) presetMax.current = null
    setFilters((current) => (current.minPrice == null && current.maxPrice == null ? current
      : preset && preset.deal === deal && current.maxPrice === preset.max && current.minPrice == null ? current
        : { ...current, minPrice: null, maxPrice: null }))
  }, [deal])
  // a new city starts with no district (a district belongs to the city it was picked in); the city the address opened
  // on keeps the districts the address named
  const lastCity = useRef(city)
  useEffect(() => {
    if (lastCity.current === city) return
    lastCity.current = city
    setFilters((current) => (current.districts.length ? { ...current, districts: [] } : current))
  }, [city])
  // the view lives in the address (lib/handoff.ts): the city, the deal, the types and the districts, so a link from the
  // price page, the map or a person reopens the same listings, and the main navigation comes back to them
  const [hydrated, setHydrated] = useState(false)
  const presetCity = useRef<string | null>(null)
  // the open listing is in the address too (?listing=): it opens once the listings say it is there, and is dropped if not
  const presetListing = useRef<string | null>(null)
  const [listingTick, setListingTick] = useState(0)
  // a change of city, deal, type, district or open listing is one step Back undoes (lib/handoff.ts historyGate)
  const [gate] = useState(() => historyGate())
  // the address as the page reads it: on arrival and when Back or Forward lands on another entry of this page
  const applyAddress = useCallback(() => {
    const view = readHomesQuery(window.location.search, RENT_DEALS.map((item) => item.id), LISTING_TYPES)
    gate.hold()
    lastCity.current = view.city
    if (view.city !== DEFAULT_CITY) presetCity.current = view.city
    setCity(view.city)
    const max = readHomesMax(window.location.search)
    presetMax.current = max != null ? { max, deal: view.kind === 'sale' ? 'sale' : view.rentDeal } : null
    setFilters((current) => {
      const same = current.kind === view.kind && current.rentDeal === view.rentDeal && current.types.join(',') === view.types.join(',') && current.districts.join(',') === view.districts.join(',') && current.maxPrice === (max ?? current.maxPrice)
      return same ? current : { ...current, kind: view.kind, rentDeal: view.rentDeal as HomeFilters['rentDeal'], types: view.types, districts: view.districts, ...(max != null ? { maxPrice: max } : {}) }
    })
    presetListing.current = readListing(window.location.search)
    if (!presetListing.current) setActive(null)
    setListingTick((n) => n + 1)
  }, [gate])
  useEffect(() => {
    applyAddress()
    setHydrated(true)
    const onPop = () => { if (window.location.pathname === '/homes') { gate.reset(); applyAddress() } }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [applyAddress, gate])
  // a city the address names that is not in the list falls back to the default
  useEffect(() => {
    const wanted = presetCity.current
    if (!wanted || cities.length < 2) return
    presetCity.current = null
    if (!cities.some((item) => item.en === wanted)) setCity(DEFAULT_CITY)
  }, [cities])
  // districts the address names that the city does not have are dropped once its districts load
  useEffect(() => {
    if (data.status !== 'ready' || !data.rows.length) return
    const known = new Set(data.rows.map((row) => row.id))
    setFilters((current) => (current.districts.every((id) => known.has(id)) ? current : { ...current, districts: current.districts.filter((id) => known.has(id)) }))
  }, [data.status, data.rows])
  // what one history entry of this page shows (lib/handoff.ts historyGate)
  const homesKey = (listing: string | null | undefined) => JSON.stringify([city, kind, filters.rentDeal, typesKey, districtsKey, listing ?? null])
  // closing a listing opened from the entry before goes Back to it, so «open, close» is undone by one Back, not two
  const closeListing = () => { if (!backIfReturning(homesKey(null))) setActive(null) }
  useEffect(() => {
    if (!hydrated) return
    // a listing still waiting for the listings keeps its place in the address
    const listing = active?.id ?? presetListing.current
    const text = writeHomesQuery({ city, kind, rentDeal: filters.rentDeal, types, districts: filters.districts, listing, max: filters.maxPrice })
    const next = text ? `?${text}` : ''
    rememberView('/homes', next)
    const prev = gate.step(homesKey(listing))
    if (next === window.location.search) return
    if (prev != null) window.history.pushState(pushedState(prev), '', `${window.location.pathname}${next}`)
    else window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the ids, not the arrays
  }, [hydrated, city, kind, filters.rentDeal, typesKey, districtsKey, active?.id, listingTick, filters.maxPrice])

  const askKey = JSON.stringify([city, kind, typesKey, deal, filters.maxPrice, districtsKey, attempt])
  useEffect(() => {
    // the first ask waits for the address, so a shared link does not first load (and flash) the default listings
    if (!hydrated) return
    let live = true
    const key = askKey
    setResult((current) => ({ ...current, status: 'loading' }))
    setActive(null)
    setShown(PAGE)
    // the deal, types, districts and (with a deal) the top price go to the service; the other filters narrow its answer
    postMarket<{ available?: boolean; total?: number; listings?: Listing[] }>('real-estate-listings', {
      // near-identical ads (same district, type, area, rooms, price and advertiser) come folded into one card
      city, kind, types, deal, limit: LIMIT, group_similar: true, ...(filters.maxPrice ? { max_price: filters.maxPrice } : {}),
      ...(filters.districts.length ? { district_ids: filters.districts } : {}),
    })
      // laid out flat, so every filter, count and pin reads one ad at a time; the cards fold them again (groupSimilar)
      .then((payload) => { if (live) setResult({ status: 'ready', available: payload.available !== false, total: payload.total ?? null, listings: flattenSimilar(payload.listings ?? []), key }) })
      .catch(() => { if (live) setResult({ status: 'error', available: true, total: null, listings: [] }) })
    return () => { live = false }
  }, [hydrated, city, kind, typesKey, deal, filters.maxPrice, districtsKey, attempt])

  // narrowing: the filters first, then (when asked) what the map shows
  const filtered = useMemo(() => applyFilters(result.listings, filters), [result.listings, filters])
  const byMap = inView && mapSeen && bounds != null
  const visible = useMemo(() => {
    if (!byMap || !bounds) return filtered
    const [w, s, e, n] = bounds
    return filtered.filter((l) => l.lon >= w && l.lon <= e && l.lat >= s && l.lat <= n)
  }, [filtered, byMap, bounds])

  // one card (and one pin) per set of near-identical ads
  const cards = useMemo(() => groupSimilar(visible), [visible])
  const byId = useMemo(() => new Map(result.listings.map((listing) => [listing.id, listing])), [result.listings])
  const dots = useMemo<ListingDot[]>(() => groupSimilar(filtered).map(({ lead: listing, others }) => ({
    id: listing.id, lon: listing.lon, lat: listing.lat, label: shortPrice(listing.price_sar),
    active: [listing, ...others].some((item) => item.id === hover || item.id === active?.id),
    color: toneColor[versusDistrict(listing)?.tone ?? 'none'],
  })), [filtered, hover, active])

  const toggleCompare = useCallback((listing: Listing) => setCompare((current) => (
    current.some((item) => item.id === listing.id) ? current.filter((item) => item.id !== listing.id) : [...current.slice(-1), listing]
  )), [])
  const open = useCallback((listing: Listing) => { presetListing.current = null; setActive(listing); setFocus({ lon: listing.lon, lat: listing.lat }); setMobileMap(true) }, [])
  // the listing the address names opens once the listings are in; one no longer there is dropped from the address
  useEffect(() => {
    const wanted = presetListing.current
    if (!wanted || result.status === 'loading' || (result.status === 'ready' && result.key !== askKey)) return
    presetListing.current = null
    gate.hold()
    const listing = result.listings.find((item) => item.id === wanted)
    if (listing) open(listing)
    else setListingTick((n) => n + 1)
  }, [result.status, result.listings, result.key, askKey, listingTick, open, gate])
  const compareIds = useMemo(() => new Set(compare.map((item) => item.id)), [compare])
  const kindTypes = LISTING_TYPES.filter((item) => item.kinds.includes(kind))
  const districtList = useMemo(() => data.rows.map((row) => ({ id: row.id, name: row.name })), [data.rows])
  const districtName = useCallback((id: string) => districtList.find((item) => item.id === id)?.name ?? 'حي', [districtList])
  const applied = activeFilters(filters, districtName)
  const dealLabel = kind === 'sale' ? 'شراء' : `إيجار ${RENT_DEALS.find((item) => item.id === filters.rentDeal)?.label ?? ''}`
  const cityAr = cities.find((item) => item.en === city)?.ar || city

  return (
    <main className="flex h-[calc(100dvh-8rem)] flex-col lg:h-[calc(100dvh-4rem)]">
      {/* the Airbnb header: one search capsule (the city, then the deal and the districts) beside a round filters
          button, and under it the property types as an icon row. Set filters follow as chips, each removed with a tap */}
      <header className="flex flex-col gap-2 border-b bg-background/80 pt-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4">
          <button onClick={() => setSheet(true)} aria-label="ابحث وغيّر الفلاتر"
            className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-full border bg-card px-4 text-start shadow-[0_3px_12px_-4px_rgb(23_42_30/0.25)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring">
            <Search className="size-5 shrink-0 text-foreground" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold">{cityAr}</span>
              <span className="truncate text-xs text-muted-foreground">{dealLabel} · {filters.districts.length ? filters.districts.map(districtName).join('، ') : 'كل الأحياء'}</span>
            </span>
          </button>
          <button onClick={() => setSheet(true)} aria-label={applied.length ? `الفلاتر، ${numberFormat.format(applied.length)} مطبقة` : 'الفلاتر'}
            className="relative grid size-12 shrink-0 place-items-center rounded-full border bg-card outline-none transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring">
            <SlidersHorizontal className="size-5" aria-hidden />
            {applied.length > 0 && <span className="absolute -top-1 -end-1 grid size-5 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{numberFormat.format(applied.length)}</span>}
          </button>
          {/* the way from browsing listings to pricing one's own property: the city, a single picked district, the deal
              and the type go with it, so the price page asks only what it does not know yet */}
          <Link href={priceStartHref({ city, district: filters.districts.length === 1 ? filters.districts[0] : null, deal, type: types.length === 1 ? types[0] : null })} aria-label="سعّر عقارك"
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full border bg-card px-3.5 text-sm font-semibold outline-none transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring">
            <Calculator className="size-5 text-primary" aria-hidden /><span className="hidden sm:inline">سعّر عقارك</span>
          </Link>
          {/* the view is in the address, so its link reopens these listings for whoever it is shared with */}
          <CopyLinkButton className="h-12 shrink-0 bg-card shadow-none" description="يفتح العروض نفسها: المدينة والصفقة والنوع والأحياء." />
        </div>
        {/* a row of toggles, not links: a group, not a navigation landmark */}
        {/* on a phone the row is wider than the screen: both edges fade, so a type cut in half reads as «more this way»
            and not as a broken icon */}
        <div role="group" aria-label="نوع العقار" className="mx-auto flex w-full max-w-5xl gap-6 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:[mask-image:linear-gradient(to_left,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)] sm:justify-center">
          {kindTypes.map((item) => {
            const on = types.length === 1 && types[0] === item.id
            return (
              <button key={item.id} onClick={() => change({ types: [item.id] })} aria-pressed={on}
                className={cn('group flex shrink-0 flex-col items-center gap-1 border-b-2 pt-1 pb-2.5 text-xs font-semibold transition-colors outline-none focus-visible:text-foreground',
                  on ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground')}>
                <Icon3D type={item.id} className={cn('size-9 transition-[opacity,transform] duration-200', on ? 'scale-110' : 'opacity-70 group-hover:opacity-100')} />
                {item.label}
              </button>
            )
          })}
        </div>
        {applied.length > 0 && (
          <ChipRow label="الفلاتر المطبقة" className="px-4 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {applied.map((item) => (
              <Chip key={item.id} active onClick={() => change(item.clear)} aria-label={`أزل: ${item.label}`}>
                {item.label}<X className="size-3.5" aria-hidden />
              </Chip>
            ))}
            <Chip onClick={() => change({ ...DEFAULT_FILTERS, kind, rentDeal: filters.rentDeal, types: types.slice(0, 1) })}>مسح الكل</Chip>
          </ChipRow>
        )}
      </header>
      <HomesFilters open={sheet} onClose={() => setSheet(false)} filters={filters} onChange={change} districts={districtList}
        cities={cityOptions} city={city} onCity={setCity}
        count={visible.length} loading={result.status === 'loading'} />

      {/* the map view on a phone hides the list and its h1: the page keeps a heading for screen readers */}
      {mobileMap && <h1 className="sr-only lg:hidden">خريطة عروض {cityAr}</h1>}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* results: two columns of photo cards */}
        {/* the list scrolls on its own: it takes keyboard focus so arrow keys and Page Down scroll it (WCAG 2.1.1) */}
        <section tabIndex={0} className={cn('min-h-0 overflow-y-auto px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:px-6', mobileMap && 'hidden lg:block')} aria-label="العروض">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold">
              {/* the service sends the best LIMIT of a larger match: then the count is «the best N», never the city's */}
              {result.status === 'ready'
                ? `${result.total != null && result.total > result.listings.length && !byMap ? 'أنسب ' : ''}${visible.length ? offersLabel(visible.length) : 'لا عروض'} ${byMap ? 'في ما تُظهره الخريطة' : `في ${cityAr}`}`
                : `عروض ${cityAr}`}
            </h1>
            <label className={cn('min-h-11 items-center gap-2 text-sm text-muted-foreground', mapSeen ? 'flex' : 'hidden')}>
              <input type="checkbox" checked={inView} onChange={(event) => setInView(event.target.checked)} className="size-4 accent-[var(--primary)]" />
              حدّث القائمة عند تحريك الخريطة
            </label>
          </div>
          {result.status === 'loading' && (
            // card-shaped placeholders: the grid keeps its place while the listings load
            <SkeletonStatus label="جارٍ تحميل العروض" className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="aspect-[20/19] rounded-2xl" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </SkeletonStatus>
          )}
          {result.status === 'error' && <LoadError what="العروض" onRetry={() => setAttempt((n) => n + 1)} />}
          {result.status === 'ready' && !result.available && (
            <EmptyState heading="h2" icon={Building2} title="غير متاحة بعد" body={`عروض العقار غير متاحة في ${cityAr} بعد.`}
              action={city !== 'Riyadh' ? <Chip onClick={() => setCity('Riyadh')}>اعرض عروض الرياض</Chip> : undefined} />
          )}
          {/* an empty list says which of the three narrowings emptied it, and offers the one step that undoes it */}
          {result.status === 'ready' && result.available && visible.length === 0 && (
            filtered.length > 0 ? (
              <EmptyState heading="h2" icon={MapIcon} title="لا عروض في ما تُظهره الخريطة" body={`حرّك الخريطة أو صغّرها، أو اعرض كل عروض ${cityAr}.`}
                action={<Chip onClick={() => setInView(false)}>اعرض كل عروض {cityAr}</Chip>} />
            ) : result.listings.length > 0 ? (
              <EmptyState heading="h2" icon={SearchX} title="لا عروض بهذه الفلاتر" body={`في ${cityAr} ${offersLabel(result.listings.length)} بهذه الصفقة والنوع، والفلاتر المطبقة تستبعدها كلها.`}
                action={<Chip onClick={() => change({ ...DEFAULT_FILTERS, kind, rentDeal: filters.rentDeal, types: types.slice(0, 1) })}>مسح الفلاتر</Chip>} />
            ) : (
              <EmptyState heading="h2" icon={SearchX} title="لا عروض حالية من هذا النوع"
                body={kind === 'rent' ? 'جرّب مدة إيجار أخرى أو نوعاً آخر من الأعلى.' : 'جرّب نوعاً آخر من الأعلى.'}
                action={(
                  <div className="flex flex-wrap justify-center gap-2">
                    {kind === 'rent' && RENT_DEALS.filter((item) => item.id !== filters.rentDeal).map((item) => (
                      <Chip key={item.id} onClick={() => change({ rentDeal: item.id })}>إيجار {item.label}</Chip>
                    ))}
                    {filters.districts.length > 0 && <Chip onClick={() => change({ districts: [] })}>كل الأحياء</Chip>}
                  </div>
                )} />
            )
          )}
          <ul className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2">
            {cards.slice(0, shown).map(({ lead, others }, index) => (
              <HomeCard key={lead.id} listing={lead} others={others} priority={index < 4} comparing={compareIds.has(lead.id)} compareIds={compareIds}
                onOpen={open} onCompare={toggleCompare} onHover={setHover} />
            ))}
          </ul>
          {cards.length > shown && (
            <button onClick={() => setShown((count) => count + PAGE)} className="mx-auto mt-6 block h-10 rounded-full border bg-card px-5 text-sm font-semibold transition-colors outline-none hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring">
              {/* what is left, counted in ads as the heading counts them */}
              عرض المزيد ({numberFormat.format(cards.slice(shown).reduce((sum, card) => sum + 1 + card.others.length, 0))})
            </button>
          )}
          {result.status === 'ready' && result.total != null && result.total > result.listings.length && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              <Explained title="أنسب العروض" lines={EXPLAIN.bestListings} className="text-xs">في المدينة {numberFormat.format(result.total)} عرضاً، والمعروض أنسب {numberFormat.format(result.listings.length)} منها</Explained>
            </p>
          )}
        </section>

        {/* the map with price pins; a pin opens the listing's card over it */}
        <section className={cn('relative min-h-0 lg:p-4', !mobileMap && 'hidden lg:block')} aria-label="خريطة العروض">
          <div className="relative h-full min-h-[60vh] overflow-hidden lg:rounded-2xl lg:border">
            <LensMapCanvas features={data.features} steps={NO_STEPS} selected={[]} onToggle={() => {}} listings={dots} focus={focus}
              onListing={(id) => { const listing = byId.get(id); if (listing) { presetListing.current = null; setGroup(null); setActive(listing) } }} onBounds={setBounds}
              onListingGroup={(next) => { setActive(null); setGroup(next) }} pin={!active ? group : null} onPin={setGroupAt} />
            {/* a group of listings names its cheapest, each a tap from its own card, and the zoom that splits it */}
            {!active && group && groupAt && groupAt.x >= 0 && groupAt.y >= 0 && groupAt.x <= groupAt.width && groupAt.y <= groupAt.height && (
              <GroupCard count={group.count} noun="listing" at={groupAt} top={8} bottom={groupAt.height - 8}
                items={group.ids.flatMap((id) => { const listing = byId.get(id); return listing ? [listing] : [] })
                  .sort((a, b) => (a.price_sar ?? Infinity) - (b.price_sar ?? Infinity)).slice(0, 5)
                  .map((listing) => ({ id: listing.id, title: priceLine(listing), sub: [typeLabel(listing.type), listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : null, listing.district_ar].filter(Boolean).join(' · ') }))}
                onOpen={(id) => { const listing = byId.get(id); if (listing) { presetListing.current = null; setGroup(null); setActive(listing) } }}
                onClose={() => setGroup(null)} onExpand={() => { group.expand(); setGroup(null) }} />
            )}
            {active && <ListingCard listing={active} comparing={compare.some((item) => item.id === active.id)} onCompare={() => toggleCompare(active)} onClose={closeListing}
              compareCount={compare.length} onCompareNow={() => { setActive(null); setSideBySide(true) }} districtHref={districtMapHref(city, active.district_id)}
              className="bottom-20 max-h-[calc(100%-6rem)] lg:bottom-3 lg:max-h-[85%]" />}
          </div>
        </section>
      </div>

      {/* the comparison tray and the one switch between list and map on a phone */}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex flex-col items-center gap-2 lg:bottom-6">
        {compare.length === 1 && (
          <p role="status" className="pointer-events-auto inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-semibold shadow-lg">
            <Scale className="size-4 text-primary" aria-hidden /> عقار واحد في المقارنة · أضف الثاني
            <button onClick={() => setCompare([])} aria-label="أفرغ المقارنة" className="-me-1 grid size-7 pointer-coarse:size-9 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3.5" aria-hidden /></button>
          </p>
        )}
        {compare.length === 2 && (
          <button onClick={() => setSideBySide(true)} className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <Scale className="size-4" aria-hidden /> قارن العرضين
          </button>
        )}
        <button onClick={() => setMobileMap((value) => !value)} className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-lg lg:hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {mobileMap ? <><List className="size-4" aria-hidden /> القائمة</> : <><MapIcon className="size-4" aria-hidden /> الخريطة</>}
        </button>
      </div>
      {sideBySide && compare.length === 2 && (
        <ListingCompare listings={[compare[0], compare[1]]} onClose={() => setSideBySide(false)} onRemove={toggleCompare}
          onAdvisor={() => { setSideBySide(false); setAdvise(true) }} />
      )}
      {/* a real modal: Escape and a tap outside close it, focus stays inside while it is open and returns after */}
      <Dialog open={advise && compare.length === 2} onOpenChange={(next) => { if (!next) setAdvise(false) }}>
        <DialogContent showCloseButton={false} aria-label="مقارنة العرضين" className="block max-h-[90dvh] overflow-y-auto rounded-2xl bg-transparent p-0 ring-0 sm:max-w-lg">
          {compare.length === 2 && <AdvisorPanel subject={{ kind: 'listings', listings: compare }} rows={data.rows} onClose={() => setAdvise(false)} />}
        </DialogContent>
      </Dialog>
    </main>
  )
}

/**
 * One result card. Memoised: hovering a card (which lights its pin) re-renders the page, and without this every card in
 * the grid, each with its photo strip, was drawn again on every mouse move between cards. It carries one price tag
 * (priceTag), and the near-identical ads folded into it open under it as short rows.
 */
const HomeCard = memo(function HomeCard({ listing, others, priority, comparing, compareIds, onOpen, onCompare, onHover }: {
  listing: Listing
  /** Near-identical ads folded into this card (same district, type, area, rooms, price and advertiser). */
  others: Listing[]
  /** In the first screen: its first photo is fetched first. */
  priority: boolean
  comparing: boolean
  compareIds: Set<string>
  onOpen: (listing: Listing) => void
  onCompare: (listing: Listing) => void
  onHover: (id: string | null) => void
}) {
  const tag = priceTag(listing)
  const photos = shownPhotos(listing)
  const [expanded, setExpanded] = useState(false)
  const facts = [listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : null, listing.beds ? counted(listing.beds, 'room') : null]
  return (
    <li onMouseEnter={() => onHover(listing.id)} onMouseLeave={() => onHover(null)} className="group">
      <div className="relative overflow-hidden rounded-2xl bg-muted">
        {/* an ad without photos keeps the card's shape, so the compare button never lands on the text */}
        {/* a listing with no photo to show (none in the ad, or none that loads) gets its type's face in the same slot */}
        <Gallery photos={photos} priority={priority} className="aspect-[20/19]" fallback={(failed) => (
          <ListingFace type={listing.type} url={listing.url} failed={failed} className="aspect-[20/19]" facts={facts} />
        )} />
        {tag?.tone === 'good' && <span className="absolute start-3 top-3 rounded-full bg-background/90 px-2.5 py-1 text-xs font-semibold shadow-sm">{tag.text}</span>}
        <button onClick={() => onCompare(listing)} aria-pressed={comparing} aria-label={`${comparing ? 'أزل من المقارنة' : 'أضف للمقارنة'}: ${typeLabel(listing.type)}${listing.district_ar ? ` في ${listing.district_ar}` : ''}`}
          className={cn('absolute end-3 top-3 grid size-9 pointer-coarse:size-11 place-items-center rounded-full outline-none backdrop-blur focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', comparing ? 'bg-primary text-primary-foreground' : 'bg-background/80 hover:bg-background')}>
          <Scale className="size-4" aria-hidden />
        </button>
      </div>
      <button onClick={() => onOpen(listing)} className="mt-2 flex w-full flex-col gap-0.5 rounded-lg text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <span className="font-semibold">{typeLabel(listing.type)}{listing.district_ar ? ` في ${listing.district_ar}` : ''}</span>
        <span className="text-sm text-muted-foreground">
          {[...facts, listing.street_width ? `شارع ${numberFormat.format(listing.street_width)} م` : null, listing.age != null ? (listing.age === 0 ? 'جديد' : `عمره ${ageLabel(listing.age)}`) : null].filter(Boolean).join(' · ')}
        </span>
        <span className="mt-1 font-bold underline-offset-4 group-hover:underline group-focus-within:underline">{priceLine(listing)}</span>
        {tag && tag.tone !== 'good' && (
          tag.tone === 'signal'
            ? <span className="mt-0.5 w-fit rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{tag.text}</span>
            : <span className="text-xs text-muted-foreground">{tag.text}</span>
        )}
      </button>
      {others.length > 0 && (
        <div className="mt-1.5">
          <button onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}
            className="inline-flex min-h-9 items-center gap-1 rounded-full border bg-card px-3 text-xs font-semibold outline-none transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
            {similarLabel(others.length + 1)}
            <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden />
          </button>
          {expanded && (
            // the same district, type, area, rooms, price and advertiser: what tells them apart is the ad itself
            <ul className="mt-1.5 flex flex-col divide-y rounded-xl border bg-card text-sm" aria-label={similarLabel(others.length + 1)}>
              {others.map((item) => {
                const updated = daysAgo(item.updated_on ?? item.listed_on)
                const itemPhotos = shownPhotos(item).length
                return (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-1.5">
                    <button onClick={() => onOpen(item)} className="flex min-h-9 min-w-0 flex-1 flex-col text-start outline-none focus-visible:ring-2 focus-visible:ring-ring rounded pointer-coarse:min-h-11">
                      <span className="font-semibold">{priceLine(item)}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[updated ? `حُدّث ${updated}` : 'تاريخ التحديث غير متاح', item.age != null ? (item.age === 0 ? 'جديد' : `عمره ${ageLabel(item.age)}`) : null,
                          itemPhotos ? counted(itemPhotos, 'photo') : null].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                    <button onClick={() => onCompare(item)} aria-pressed={compareIds.has(item.id)} aria-label={`${compareIds.has(item.id) ? 'أزل من المقارنة' : 'أضف للمقارنة'}: ${priceLine(item)}`}
                      className={cn('grid size-8 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11', compareIds.has(item.id) ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted')}>
                      <Scale className="size-3.5" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  )
})
