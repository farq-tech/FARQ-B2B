'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, List, Map as MapIcon, Scale, SearchX, SlidersHorizontal, Sparkles } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { ChipRow, PillField, SearchPill, pillControl } from '@/components/shared/search-pill'
import { Chip } from '@/components/ui/chip'
import { Skeleton } from '@/components/ui/skeleton'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { BUDGETS, LISTING_TYPES, PERIOD_WORD, RENT_DEALS, priceLine, toneColor, typeLabel, versusDistrict, type Deal, type Listing, type ListingKind } from '@/lib/real-estate'
import { cn } from '@/lib/utils'
import { AdvisorPanel } from '../lens/advisor-panel'
import { useCityData } from '../lens/city-data'
import { LensMapCanvas, type ListingDot } from '../lens/lens-map-canvas'
import { Gallery, ListingCard } from '../lens/listing-card'

const CITIES = [['Riyadh', 'الرياض'], ['Jeddah', 'جدة'], ['Dammam', 'الدمام'], ['Al Khobar', 'الخبر'], ['Makkah Al Mukarramah', 'مكة المكرمة']] as const
const LIMIT = 1500
const PAGE = 24
const NO_STEPS = new Map<string, number>()

/** One tap above the results, each narrows what is already loaded. */
const CHIPS: { id: string; label: string; keep: (listing: Listing) => boolean }[] = [
  { id: 'below', label: 'أقل من وسيط الحي', keep: (l) => (l.vs_district_pct ?? 0) < 0 && !l.check },
  { id: 'photos', label: 'بصور', keep: (l) => (l.photos?.length ?? 0) > 0 || !!l.photo },
  { id: 'beds', label: '3 غرف فأكثر', keep: (l) => (l.beds ?? 0) >= 3 },
  { id: 'big', label: '150 م² فأكثر', keep: (l) => (l.area_sqm ?? 0) >= 150 },
  { id: 'street', label: 'شارع 20 م فأكثر', keep: (l) => (l.street_width ?? 0) >= 20 },
]

/** «45k» or «1.2M» for a price pin. */
function shortPrice(price: number | null): string | undefined {
  if (!price) return undefined
  return price >= 1_000_000 ? `${numberFormat.format(Math.round(price / 100_000) / 10)}M` : `${numberFormat.format(Math.round(price / 1000))}k`
}

/**
 * «العقار»: current listings as photo cards in two columns beside a map of price pins. The search pill sets the city,
 * the deal and its period, the type and a budget; chips under it narrow the loaded listings; moving the map can limit
 * the cards to what is in view. A card or a pin opens the listing's card over the map; two go to the comparison
 * assistant. Modelled on the search-results-with-map pattern (Screenrove: airbnb-product-results).
 */
export function HomesPage() {
  const [city, setCity] = useState<string>('Riyadh')
  const [kind, setKind] = useState<ListingKind>('rent')
  const [rentDeal, setRentDeal] = useState<Deal | 'all'>('rent_year')
  const [type, setType] = useState('apartment')
  const [budget, setBudget] = useState(0)
  const deal: Deal | null = kind === 'sale' ? 'sale' : rentDeal === 'all' ? null : rentDeal
  const [result, setResult] = useState<{ status: 'loading' | 'ready' | 'error'; available: boolean; total: number; listings: Listing[] }>({ status: 'loading', available: true, total: 0, listings: [] })
  const [chips, setChips] = useState<Set<string>>(new Set())
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

  useEffect(() => { if (!LISTING_TYPES.find((item) => item.id === type)?.kinds.includes(kind)) setType('apartment') }, [kind, type])
  useEffect(() => { setBudget(0) }, [kind, rentDeal])

  useEffect(() => {
    let live = true
    setResult((current) => ({ ...current, status: 'loading' }))
    setActive(null)
    setShown(PAGE)
    postMarket<{ available?: boolean; total?: number; listings?: Listing[] }>('real-estate-listings', {
      city, kind, types: [type], limit: LIMIT, ...(deal ? { deal } : {}), ...(budget && deal ? { max_price: budget } : {}),
    })
      .then((payload) => { if (live) setResult({ status: 'ready', available: payload.available !== false, total: payload.total ?? 0, listings: payload.listings ?? [] }) })
      .catch(() => { if (live) setResult({ status: 'error', available: true, total: 0, listings: [] }) })
    return () => { live = false }
  }, [city, kind, type, deal, budget, attempt])

  // narrowing: the chips first, then (when asked) what the map shows
  const filtered = useMemo(() => {
    const rules = CHIPS.filter((chip) => chips.has(chip.id))
    return result.listings.filter((listing) => rules.every((rule) => rule.keep(listing)))
  }, [result.listings, chips])
  const visible = useMemo(() => {
    if (!inView || !bounds) return filtered
    const [w, s, e, n] = bounds
    return filtered.filter((l) => l.lon >= w && l.lon <= e && l.lat >= s && l.lat <= n)
  }, [filtered, inView, bounds])

  const byId = useMemo(() => new Map(result.listings.map((listing) => [listing.id, listing])), [result.listings])
  const dots = useMemo<ListingDot[]>(() => filtered.map((listing) => ({
    id: listing.id, lon: listing.lon, lat: listing.lat, label: shortPrice(listing.price_sar), active: listing.id === hover || listing.id === active?.id,
    color: toneColor[listing.check ? 'check' : versusDistrict(listing)?.tone ?? 'none'],
  })), [filtered, hover, active])

  const toggleCompare = useCallback((listing: Listing) => setCompare((current) => (
    current.some((item) => item.id === listing.id) ? current.filter((item) => item.id !== listing.id) : [...current.slice(-1), listing]
  )), [])
  const open = (listing: Listing) => { setActive(listing); setFocus({ lon: listing.lon, lat: listing.lat }); setMobileMap(true) }
  const toggleChip = (id: string) => setChips((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const types = LISTING_TYPES.filter((item) => item.kinds.includes(kind))
  const cityAr = CITIES.find(([id]) => id === city)?.[1] ?? city

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col lg:h-[calc(100dvh-4rem)]">
      {/* the search pill and the chip row, one tap above the results */}
      <header className="flex flex-col gap-3 border-b bg-background/70 px-4 py-3 backdrop-blur">
        <SearchPill label="ابحث في العروض">
          <PillField label="المدينة">
            <select value={city} onChange={(event) => setCity(event.target.value)} className={pillControl}>
              {CITIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </PillField>
          <PillField label="إيجار أو شراء">
            <select value={kind === 'sale' ? 'sale' : rentDeal} onChange={(event) => { const value = event.target.value; if (value === 'sale') setKind('sale'); else { setKind('rent'); setRentDeal(value as Deal | 'all') } }}
              className={pillControl}>
              {RENT_DEALS.map((item) => <option key={item.id} value={item.id}>إيجار {item.label}</option>)}
              <option value="all">إيجار بأي مدة</option>
              <option value="sale">شراء</option>
            </select>
          </PillField>
          <PillField label="النوع" className="min-w-[7rem]">
            <select value={type} onChange={(event) => setType(event.target.value)} className={pillControl}>
              {types.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </PillField>
          <PillField label="الميزانية">
            <select value={budget} disabled={!deal} onChange={(event) => setBudget(Number(event.target.value))} className={pillControl}>
              <option value={0}>{deal ? 'أي ميزانية' : 'اختر مدة الإيجار أولاً'}</option>
              {deal && BUDGETS[deal].map((value) => <option key={value} value={value}>حتى {numberFormat.format(value)}{PERIOD_WORD[deal] ? ` ${PERIOD_WORD[deal]}` : ''}</option>)}
            </select>
          </PillField>
        </SearchPill>
        <ChipRow label="تضييق النتائج">
          <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground"><SlidersHorizontal className="size-4" aria-hidden /> تضييق</span>
          {CHIPS.map((chip) => (
            <Chip key={chip.id} active={chips.has(chip.id)} onClick={() => toggleChip(chip.id)}>{chip.label}</Chip>
          ))}
        </ChipRow>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* results: two columns of photo cards */}
        <section className={cn('min-h-0 overflow-y-auto px-4 py-4 lg:px-6', mobileMap && 'hidden lg:block')} aria-label="العروض">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold">
              {result.status === 'ready' ? `${numberFormat.format(visible.length)} عرضاً ${inView && bounds ? 'في ما تُظهره الخريطة' : `في ${cityAr}`}` : `عروض ${cityAr}`}
            </h1>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
            <EmptyState icon={SearchX} title="لا عروض بهذه الشروط" body="حرّك الخريطة، أو أزل بعض الشرائح، أو وسّع الميزانية." />
          )}
          <ul className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2">
            {visible.slice(0, shown).map((listing) => {
              const versus = listing.check ? null : versusDistrict(listing)
              const photos = listing.photos?.length ? listing.photos : listing.photo ? [listing.photo] : []
              const comparing = compare.some((item) => item.id === listing.id)
              return (
                <li key={listing.id} onMouseEnter={() => setHover(listing.id)} onMouseLeave={() => setHover(null)} className="group">
                  <div className="relative overflow-hidden rounded-2xl bg-muted">
                    {photos.length ? <Gallery photos={photos} className="aspect-[20/19]" /> : <div className="grid aspect-[20/19] place-items-center text-sm text-muted-foreground">لا صور في الإعلان</div>}
                    {versus?.tone === 'good' && <span className="absolute start-3 top-3 rounded-full bg-background/90 px-2.5 py-1 text-xs font-semibold shadow-sm">{versus.text}</span>}
                    <button onClick={() => toggleCompare(listing)} aria-pressed={comparing} aria-label={comparing ? 'أزل من المقارنة' : 'أضف للمقارنة'}
                      className={cn('absolute end-3 top-3 grid size-9 place-items-center rounded-full backdrop-blur', comparing ? 'bg-primary text-primary-foreground' : 'bg-background/80 hover:bg-background')}>
                      <Scale className="size-4" aria-hidden />
                    </button>
                  </div>
                  <button onClick={() => open(listing)} className="mt-2 flex w-full flex-col gap-0.5 text-start">
                    <span className="font-semibold">{typeLabel(listing.type)}{listing.district_ar ? ` في ${listing.district_ar}` : ''}</span>
                    <span className="text-sm text-muted-foreground">
                      {[listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : null, listing.beds ? `${numberFormat.format(listing.beds)} غرف` : null, listing.street_width ? `شارع ${numberFormat.format(listing.street_width)} م` : null].filter(Boolean).join(' · ') || 'المساحة غير مذكورة'}
                    </span>
                    <span className="mt-1 font-bold underline-offset-4 group-hover:underline">{priceLine(listing)}</span>
                    {versus && versus.tone !== 'good' && <span className="text-xs text-muted-foreground">{versus.text}</span>}
                    {listing.check && <span className="text-xs text-warning">أرقام الإعلان تحتاج تحققاً</span>}
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
            {active && <ListingCard listing={active} comparing={compare.some((item) => item.id === active.id)} onCompare={() => toggleCompare(active)} onClose={() => setActive(null)} />}
          </div>
        </section>
      </div>

      {/* the comparison tray and the one switch between list and map on a phone */}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex flex-col items-center gap-2 lg:bottom-6">
        {compare.length === 2 && (
          <button onClick={() => setAdvise(true)} className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg">
            <Sparkles className="size-4" aria-hidden /> قارن العرضين مع المساعد
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
