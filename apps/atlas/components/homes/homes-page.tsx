'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, List, Map as MapIcon, Scale, Search, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { Icon3D } from '@/components/shared/icon-3d'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { ChipRow } from '@/components/shared/search-pill'
import { Chip } from '@/components/ui/chip'
import { Skeleton } from '@/components/ui/skeleton'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { LISTING_TYPES, RENT_DEALS, priceLine, toneColor, typeLabel, versusDistrict, type Listing } from '@/lib/real-estate'
import { DEFAULT_FILTERS, activeFilters, applyFilters, dealOf, offersLabel, type HomeFilters } from '@/lib/real-estate-filters'
import { HomesFilters } from './homes-filters'
import { cn } from '@/lib/utils'
import { AdvisorPanel } from '../lens/advisor-panel'
import { useCityData } from '../lens/city-data'
import { LensMapCanvas, type ListingDot } from '../lens/lens-map-canvas'
import { Gallery, ListingCard } from '../lens/listing-card'

const CITIES = [['Riyadh', 'الرياض'], ['Jeddah', 'جدة'], ['Dammam', 'الدمام'], ['Al Khobar', 'الخبر'], ['Makkah Al Mukarramah', 'مكة المكرمة']] as const
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
  const [city, setCity] = useState<string>('Riyadh')
  const [filters, setFilters] = useState<HomeFilters>(DEFAULT_FILTERS)
  const [sheet, setSheet] = useState(false)
  const { kind, types } = filters
  const deal = dealOf(filters)
  const typesKey = types.join(','), districtsKey = filters.districts.join(',')
  const change = useCallback((next: Partial<HomeFilters>) => setFilters((current) => ({ ...current, ...next })), [])
  const [result, setResult] = useState<{ status: 'loading' | 'ready' | 'error'; available: boolean; total: number; listings: Listing[] }>({ status: 'loading', available: true, total: 0, listings: [] })
  const [inView, setInView] = useState(true)
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [active, setActive] = useState<Listing | null>(null)
  const [focus, setFocus] = useState<{ lon: number; lat: number } | null>(null)
  const [compare, setCompare] = useState<Listing[]>([])
  const [advise, setAdvise] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [mobileMap, setMobileMap] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const data = useCityData(city)

  // a type the deal does not offer (land for rent) falls back to a flat; a new city or deal starts its own ranges
  useEffect(() => {
    const kept = types.filter((id) => LISTING_TYPES.find((item) => item.id === id)?.kinds.includes(kind))
    if (kept.length !== types.length) change({ types: kept.length ? kept : ['apartment'] })
  }, [kind, types, change])
  useEffect(() => { setFilters((current) => (current.minPrice == null && current.maxPrice == null ? current : { ...current, minPrice: null, maxPrice: null })) }, [deal])
  useEffect(() => { setFilters((current) => (current.districts.length ? { ...current, districts: [] } : current)) }, [city])

  useEffect(() => {
    let live = true
    setResult((current) => ({ ...current, status: 'loading' }))
    setActive(null)
    setShown(PAGE)
    // the deal, types, districts and (with a deal) the top price go to the service; the other filters narrow its answer
    postMarket<{ available?: boolean; total?: number; listings?: Listing[] }>('real-estate-listings', {
      city, kind, types, deal, limit: LIMIT, ...(filters.maxPrice ? { max_price: filters.maxPrice } : {}),
      ...(filters.districts.length ? { district_ids: filters.districts } : {}),
    })
      .then((payload) => { if (live) setResult({ status: 'ready', available: payload.available !== false, total: payload.total ?? 0, listings: payload.listings ?? [] }) })
      .catch(() => { if (live) setResult({ status: 'error', available: true, total: 0, listings: [] }) })
    return () => { live = false }
  }, [city, kind, typesKey, deal, filters.maxPrice, districtsKey, attempt])

  // narrowing: the filters first, then (when asked) what the map shows
  const filtered = useMemo(() => applyFilters(result.listings, filters), [result.listings, filters])
  const visible = useMemo(() => {
    if (!inView || !bounds) return filtered
    const [w, s, e, n] = bounds
    return filtered.filter((l) => l.lon >= w && l.lon <= e && l.lat >= s && l.lat <= n)
  }, [filtered, inView, bounds])

  const byId = useMemo(() => new Map(result.listings.map((listing) => [listing.id, listing])), [result.listings])
  const dots = useMemo<ListingDot[]>(() => filtered.map((listing) => ({
    id: listing.id, lon: listing.lon, lat: listing.lat, label: shortPrice(listing.price_sar), active: listing.id === hover || listing.id === active?.id,
    color: toneColor[versusDistrict(listing)?.tone ?? 'none'],
  })), [filtered, hover, active])

  const toggleCompare = useCallback((listing: Listing) => setCompare((current) => (
    current.some((item) => item.id === listing.id) ? current.filter((item) => item.id !== listing.id) : [...current.slice(-1), listing]
  )), [])
  const open = (listing: Listing) => { setActive(listing); setFocus({ lon: listing.lon, lat: listing.lat }); setMobileMap(true) }
  const kindTypes = LISTING_TYPES.filter((item) => item.kinds.includes(kind))
  const districtList = useMemo(() => data.rows.map((row) => ({ id: row.id, name: row.name })), [data.rows])
  const districtName = useCallback((id: string) => districtList.find((item) => item.id === id)?.name ?? 'حي', [districtList])
  const applied = activeFilters(filters, districtName)
  const dealLabel = kind === 'sale' ? 'شراء' : `إيجار ${RENT_DEALS.find((item) => item.id === filters.rentDeal)?.label ?? ''}`
  const cityAr = CITIES.find(([id]) => id === city)?.[1] ?? city

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col lg:h-[calc(100dvh-4rem)]">
      {/* the Airbnb header: one search capsule (the city, then the deal and the districts) beside a round filters
          button, and under it the property types as an icon row. Set filters follow as chips, each removed with a tap */}
      <header className="flex flex-col gap-2 border-b bg-background/80 pt-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4">
          <button onClick={() => setSheet(true)} aria-label="ابحث وغيّر الفلاتر"
            className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-full border bg-card px-4 text-start shadow-[0_3px_12px_-4px_rgb(23_42_30/0.25)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/60">
            <Search className="size-5 shrink-0 text-foreground" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold">{cityAr}</span>
              <span className="truncate text-xs text-muted-foreground">{dealLabel} · {filters.districts.length ? filters.districts.map(districtName).join('، ') : 'كل الأحياء'}</span>
            </span>
          </button>
          <button onClick={() => setSheet(true)} aria-label={applied.length ? `الفلاتر، ${numberFormat.format(applied.length)} مطبقة` : 'الفلاتر'}
            className="relative grid size-12 shrink-0 place-items-center rounded-full border bg-card outline-none transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/60">
            <SlidersHorizontal className="size-5" aria-hidden />
            {applied.length > 0 && <span className="absolute -top-1 -end-1 grid size-5 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{numberFormat.format(applied.length)}</span>}
          </button>
        </div>
        <nav aria-label="نوع العقار" className="mx-auto flex w-full max-w-5xl gap-6 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:justify-center">
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
        </nav>
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
        cities={CITIES} city={city} onCity={setCity}
        count={visible.length} loading={result.status === 'loading'} />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* results: two columns of photo cards */}
        <section className={cn('min-h-0 overflow-y-auto px-4 py-4 lg:px-6', mobileMap && 'hidden lg:block')} aria-label="العروض">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold">
              {/* the service sends the best LIMIT of a larger match: then the count is «the best N», never the city's */}
              {result.status === 'ready'
                ? `${result.total > result.listings.length && !(inView && bounds) ? 'أنسب ' : ''}${visible.length ? offersLabel(visible.length) : 'لا عروض'} ${inView && bounds ? 'في ما تُظهره الخريطة' : `في ${cityAr}`}`
                : `عروض ${cityAr}`}
            </h1>
            <label className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
              <input type="checkbox" checked={inView} onChange={(event) => setInView(event.target.checked)} className="size-4 accent-[var(--primary)]" />
              حدّث القائمة عند تحريك الخريطة
            </label>
          </div>
          {result.status === 'loading' && (
            // card-shaped placeholders: the grid keeps its place while the listings load
            <ul className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2" aria-busy="true" aria-label="جارٍ تحميل العروض">
              {Array.from({ length: 4 }, (_, i) => (
                <li key={i} className="flex flex-col gap-2">
                  <Skeleton className="aspect-[20/19] rounded-2xl" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" />
                </li>
              ))}
            </ul>
          )}
          {result.status === 'error' && <LoadError what="العروض" onRetry={() => setAttempt((n) => n + 1)} />}
          {result.status === 'ready' && !result.available && <EmptyState icon={Building2} title="غير متاحة بعد" body={`عروض العقار غير متاحة في ${cityAr} بعد. جرّب الرياض أو جدة.`} />}
          {result.status === 'ready' && result.available && visible.length === 0 && (
            <EmptyState icon={SearchX} title="لا عروض بهذه الشروط" body="جرّب مدة أخرى، أو أزل بعض الفلاتر، أو حرّك الخريطة."
              action={(
                <div className="flex flex-wrap justify-center gap-2">
                  {kind === 'rent' && RENT_DEALS.filter((item) => item.id !== filters.rentDeal).map((item) => (
                    <Chip key={item.id} onClick={() => change({ rentDeal: item.id })}>إيجار {item.label}</Chip>
                  ))}
                  {applied.length > 0 && <Chip onClick={() => change({ ...DEFAULT_FILTERS, kind, rentDeal: filters.rentDeal, types: types.slice(0, 1) })}>مسح الفلاتر</Chip>}
                </div>
              )} />
          )}
          <ul className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2">
            {visible.slice(0, shown).map((listing) => {
              const versus = versusDistrict(listing)
              const photos = listing.photos?.length ? listing.photos : listing.photo ? [listing.photo] : []
              const comparing = compare.some((item) => item.id === listing.id)
              return (
                <li key={listing.id} onMouseEnter={() => setHover(listing.id)} onMouseLeave={() => setHover(null)} className="group">
                  <div className="relative overflow-hidden rounded-2xl bg-muted">
                    <Gallery photos={photos} className="aspect-[20/19]" />
                    {versus?.tone === 'good' && <span className="absolute start-3 top-3 rounded-full bg-background/90 px-2.5 py-1 text-xs font-semibold shadow-sm">{versus.text}</span>}
                    <button onClick={() => toggleCompare(listing)} aria-pressed={comparing} aria-label={comparing ? 'أزل من المقارنة' : 'أضف للمقارنة'}
                      className={cn('absolute end-3 top-3 grid size-9 place-items-center rounded-full backdrop-blur', comparing ? 'bg-primary text-primary-foreground' : 'bg-background/80 hover:bg-background')}>
                      <Scale className="size-4" aria-hidden />
                    </button>
                  </div>
                  <button onClick={() => open(listing)} className="mt-2 flex w-full flex-col gap-0.5 text-start">
                    <span className="font-semibold">{typeLabel(listing.type)}{listing.district_ar ? ` في ${listing.district_ar}` : ''}</span>
                    <span className="text-sm text-muted-foreground">
                      {[listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : null, listing.beds ? `${numberFormat.format(listing.beds)} غرف` : null, listing.street_width ? `شارع ${numberFormat.format(listing.street_width)} م` : null].filter(Boolean).join(' · ')}
                    </span>
                    <span className="mt-1 font-bold underline-offset-4 group-hover:underline">{priceLine(listing)}</span>
                    {versus && versus.tone !== 'good' && <span className="text-xs text-muted-foreground">{versus.text}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          {visible.length > shown && (
            <button onClick={() => setShown((count) => count + PAGE)} className="mx-auto mt-6 block h-10 rounded-full border bg-card px-5 text-sm font-semibold transition-colors outline-none hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/60">
              عرض المزيد ({numberFormat.format(visible.length - shown)})
            </button>
          )}
          {result.status === 'ready' && result.total > result.listings.length && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              <Explained title="أنسب العروض" lines={EXPLAIN.bestListings} className="text-xs">في المدينة {numberFormat.format(result.total)} عرضاً، والمعروض أنسب {numberFormat.format(result.listings.length)} منها</Explained>
            </p>
          )}
        </section>

        {/* the map with price pins; a pin opens the listing's card over it */}
        <section className={cn('relative min-h-0 lg:p-4', !mobileMap && 'hidden lg:block')} aria-label="خريطة العروض">
          <div className="relative h-full min-h-[60vh] overflow-hidden lg:rounded-2xl lg:border">
            <LensMapCanvas features={data.features} steps={NO_STEPS} selected={[]} onToggle={() => {}} listings={dots} focus={focus}
              onListing={(id) => { const listing = byId.get(id); if (listing) setActive(listing) }} onBounds={setBounds} />
            {active && <ListingCard listing={active} comparing={compare.some((item) => item.id === active.id)} onCompare={() => toggleCompare(active)} onClose={() => setActive(null)}
              className="bottom-20 max-h-[calc(100%-6rem)] lg:bottom-3 lg:max-h-[85%]" />}
          </div>
        </section>
      </div>

      {/* the comparison tray and the one switch between list and map on a phone */}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex flex-col items-center gap-2 lg:bottom-6">
        {compare.length === 2 && (
          <button onClick={() => setAdvise(true)} className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg">
            <Scale className="size-4" aria-hidden /> قارن العرضين
          </button>
        )}
        <button onClick={() => setMobileMap((value) => !value)} className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-lg lg:hidden">
          {mobileMap ? <><List className="size-4" aria-hidden /> القائمة</> : <><MapIcon className="size-4" aria-hidden /> الخريطة</>}
        </button>
      </div>
      {advise && compare.length === 2 && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-background/70 p-4 backdrop-blur" role="dialog" aria-label="مقارنة العرضين">
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-4">
            <AdvisorPanel subject={{ kind: 'listings', listings: compare }} rows={data.rows} onClose={() => setAdvise(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
