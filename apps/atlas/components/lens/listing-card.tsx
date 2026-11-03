'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { BadgeCheck, Building2, Calculator, Check, ChevronDown, ExternalLink, MapPinned, MessageCircle, Phone, Scale } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat } from '@/lib/insights-api'
import { FEATURES, LISTING_TYPES, shownPhotos, TENANTS_LABEL, ageLabel, daysAgo, perSqmLine, priceLine, signalLines, typeLabel, versusDistrict, type Listing } from '@/lib/real-estate'
import { cn } from '@/lib/utils'
import { loginHref, priceAsk, priceHref } from '@/lib/handoff'
import { askVsRange } from '@/lib/ask-vs-range'
import { ESTIMATE_CACHE, estimateKey, keepEstimate } from '@/lib/estimate-key'
import { postMarket, useCities } from '@/lib/insights-api'
import { useAnswer } from './tools/use-answer'
import { OfficesRequest, VALUERS } from '@/components/shared/offices-request'
import { Skeleton } from '@/components/ui/skeleton'
import { Chip } from '@/components/ui/chip'
import { requestAccessHref } from '@/lib/access-request'
import { ListingSurroundings, type MyPoint } from './listing-surroundings'
import { Lightbox } from '@/components/shared/lightbox'
import { MapWindow } from '@/components/shared/map-window'
import { Icon3D } from '@/components/shared/icon-3d'
import { ListingFace } from '@/components/shared/listing-face'

const TONE = { good: 'text-primary', even: 'text-muted-foreground', high: 'text-warning' } as const

/**
 * What stands where an ad's photo would: the property type's own icon on a quiet tile, so a listing without photos
 * reads as one by design, not as a picture that failed. `caption` adds the words for a tile large enough to hold them.
 */
export function NoPhoto({ type, caption = false, className }: { type: string; caption?: boolean; className?: string }) {
  return (
    <span className={cn('flex flex-col items-center justify-center gap-1 bg-gradient-to-b from-muted/60 to-muted text-muted-foreground', className)}>
      {/* a type outside the search's list (an «other» ad) has no 3D icon of its own */}
      {LISTING_TYPES.some((item) => item.id === type)
        ? <Icon3D type={type} className={caption ? 'size-12' : 'size-8'} />
        : <Building2 className={cn('opacity-50', caption ? 'size-10' : 'size-6')} aria-hidden />}
      {caption ? <span className="text-xs">لا صورة متاحة</span> : <span className="sr-only">لا صورة متاحة</span>}
    </span>
  )
}

/**
 * Every photo of the ad, swiped sideways, each once (some ads repeat one); a photo that fails to load drops out.
 * With `type`, an ad with no photo left shows the type's tile at the same height, so cards side by side stay level.
 */
export function Gallery({ photos, className = 'h-40', type, fallbackClassName, fallback, priority = false }: {
  photos: string[]
  className?: string
  /** What takes the slot when no photo is left (a ListingFace); wins over `type`. Given as a function it learns whether
   * the ad had photos that all failed to load, so it can say so rather than «no photos». */
  fallback?: ReactNode | ((failed: boolean) => ReactNode)
  type?: string
  /** The tile's height when it differs from the photos' (a card gives a missing photo less room). */
  fallbackClassName?: string
  /** A card in the first screen: its first photo is fetched ahead of the rest of the page. */
  priority?: boolean
}) {
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<number | null>(null)
  const shown = [...new Set(photos)].filter((photo) => !broken.has(photo))
  if (!shown.length) {
    if (fallback) return <>{typeof fallback === 'function' ? fallback(photos.length > 0) : fallback}</>
    return type ? <NoPhoto type={type} caption className={cn('w-full', fallbackClassName ?? className)} /> : null
  }
  return (
    <div className="relative">
      <div className={cn('flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)} dir="ltr">
        {shown.map((photo, index) => (
          // the ad's own photos, shown from where they are published; a tap opens them full screen. Until a photo
          // arrives its slot pulses, so a slow photo reads as loading, not as an empty frame under a photo count.
          <button key={photo} type="button" onClick={(event) => { event.stopPropagation(); setOpen(index) }} aria-label={`افتح الصورة ${numberFormat.format(index + 1)}`}
            className={cn('h-full w-full shrink-0 snap-center cursor-zoom-in bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', !loaded.has(photo) && 'animate-pulse')}>
            {/* the first photo is the one in sight: fetched at once, not lazily. A lazy image inside a sideways
                scroller could wait for a scroll that never came, leaving the card's slot empty. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="" loading={index === 0 ? 'eager' : 'lazy'} fetchPriority={index === 0 && priority ? 'high' : undefined} decoding="async"
              // a photo already in the cache can be complete before its load event is heard: read it off the element too
              ref={(node) => { if (node?.complete && node.naturalWidth && !loaded.has(photo)) setLoaded((current) => new Set(current).add(photo)) }}
              onLoad={() => setLoaded((current) => (current.has(photo) ? current : new Set(current).add(photo)))}
              onError={() => setBroken((current) => new Set(current).add(photo))}
              className={cn('h-full w-full object-cover transition-opacity duration-200', loaded.has(photo) ? 'opacity-100' : 'opacity-0')} />
          </button>
        ))}
      </div>
      {open != null && <Lightbox photos={shown} start={open} onClose={() => setOpen(null)} />}
      {shown.length > 1 && (
        <span className="absolute bottom-2 start-2 rounded-full bg-background/80 px-2 py-0.5 text-sm backdrop-blur">{counted(shown.length, 'photo')}</span>
      )}
    </div>
  )
}

/** The advertiser's number, asked for one listing at a time by a signed-in person; a call and a WhatsApp link. */
function ListingPhone({ id }: { id: string }) {
  const [state, setState] = useState<{ phone?: string | null; error?: string; loading?: boolean }>({})
  const reveal = async () => {
    setState({ loading: true })
    const response = await fetch('/api/market/listing-phone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null)
    const payload = await response?.json().catch(() => null) as { phone?: string | null; error?: string } | null
    if (!response?.ok) setState({ error: payload?.error || 'تعذر جلب الرقم الآن.' })
    else setState({ phone: payload?.phone ?? null })
  }
  if (state.phone) {
    const international = `966${state.phone.slice(1)}`
    return (
      <div className="grid grid-cols-2 gap-1.5">
        <a href={`tel:+${international}`} className="inline-flex items-center justify-center gap-1.5 pointer-coarse:min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" dir="ltr">
          <Phone className="size-4" aria-hidden /> {state.phone}
        </a>
        <a href={`https://wa.me/${international}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 pointer-coarse:min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold hover:border-primary">
          <MessageCircle className="size-4" aria-hidden /> واتساب
        </a>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <button onClick={reveal} disabled={state.loading} className="inline-flex items-center justify-center gap-1.5 pointer-coarse:min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        <Phone className="size-4" aria-hidden /> {state.loading ? 'يجلب الرقم…' : 'اعرض رقم المعلن'}
      </button>
      {state.phone === null && <p className="text-sm text-muted-foreground">رقم المعلن غير متاح لهذا العرض.</p>}
      {state.error && <p role="alert" className="text-sm text-warning">{state.error}{/سجّل/.test(state.error) && <> <a href={loginHref(`${window.location.pathname}${window.location.search}`)} className="underline">دخول</a> أو <a href={requestAccessHref(`${window.location.pathname}${window.location.search}`)} className="underline">اطلب حساباً</a></>}</p>}
    </div>
  )
}

/**
 * The card a listing opens on the map: its photos, the price with the period the ad states, the size and how the
 * price per m² stands against the same deal in its district. Two actions only: open the ad itself, or put the
 * listing in the comparison.
 */
export function ListingCard({ listing, comparing, onCompare, compareCount = 0, onCompareNow, onClose, myPoint = null, density = null, districtHref = null, className }: {
  listing: Listing
  comparing: boolean
  /** Absent where there is no comparison (a street's units): the card then has no compare button. */
  onCompare?: () => void
  /** How many listings are in the comparison, this one included or not. */
  compareCount?: number
  /** Opens the comparison of the two listings in it. */
  onCompareNow?: () => void
  onClose: () => void
  /** The viewer's own point (work, school…), measured from the home. */
  myPoint?: MyPoint | null
  /** Residents per km² of the listing's district. */
  density?: number | null
  /** The listing's district on the map («تعرّف على الحي»), where the card is not already on the map. */
  districtHref?: string | null
  /** Where the window sits, when the page floats its own buttons over the foot of the map. */
  className?: string
}) {
  const [around, setAround] = useState(false)
  const versus = listing.check ? null : versusDistrict(listing)
  const perSqm = perSqmLine(listing)
  const rooms = [
    listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : null,
    listing.beds ? counted(listing.beds, 'room') : null,
    listing.wc ? counted(listing.wc, 'bathroom') : null,
  ].filter(Boolean)
  const photos = shownPhotos(listing)
  // «is this price right?»: the price page with this listing's own facts as the answers (null when it cannot price it)
  const priced = priceHref(listing)
  // the ad's price read against what Atlas expects for the same answers (the price page's estimate), asked once per listing
  const ask = listing.check || listing.price_sar == null ? null : priceAsk(listing)
  // one cache with «سعّر عقارك» (lib/estimate-key.ts): the price page opened from this card shows the same estimate at once
  const estimate = useAnswer<{ available: boolean; price?: { low: number; mid: number; high: number } }>(ask ? estimateKey(ask) : null,
    () => postMarket('price-estimate', ask!), { cache: ESTIMATE_CACHE, keep: keepEstimate })
  const versusExpected = estimate.data?.available && estimate.data.price ? askVsRange(listing.price_sar, estimate.data.price) : null
  const cities = useCities()
  const cityName = cities.find((item) => item.en === listing.city)?.ar || listing.city
  // what the property has, as the ad's form records it; what it lacks shows in the comparison
  const has = FEATURES.filter(([key]) => listing.features?.[key] === 1).map(([, label]) => label)
  const listed = daysAgo(listing.listed_on)
  // an ad up for a year may have been touched last week: its last update says whether it is still current
  const updated = listing.updated_on && listing.updated_on !== listing.listed_on ? daysAgo(listing.updated_on) : null

  const tab = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photos[0] ? <img src={photos[0]} alt="" className="size-9 shrink-0 rounded-full object-cover" /> : <NoPhoto type={listing.type} className="size-9 shrink-0 rounded-full [&_img]:size-6" />}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-bold">{priceLine(listing)}</span>
        <span className="truncate text-xs text-muted-foreground">{typeLabel(listing.type)}{listing.district_ar ? ` · ${listing.district_ar}` : ''}</span>
      </span>
    </>
  )

  return (
    <MapWindow label="العرض المختار" onClose={onClose} tab={tab} className={className}>
      <Gallery photos={photos} fallback={<ListingFace size="band" type={listing.type} url={listing.url} facts={[listing.district_ar, listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : null]} />} />
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-sm text-muted-foreground">
          {typeLabel(listing.type)} {listing.kind === 'rent' ? 'للإيجار' : listing.kind === 'sale' ? 'للبيع' : ''}{listing.district_ar ? ` · ${listing.district_ar}` : ''}
        </p>
        <p className="text-xl font-bold">{priceLine(listing)}</p>
        {listing.signal && (
          <p className="text-sm">
            <Explained title={listing.signal.label} lines={signalLines(listing.signal, listing.type)}
              className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary">{listing.signal.label}</Explained>
          </p>
        )}
        {rooms.length > 0 && <p className="text-base">{rooms.join(' · ')}</p>}
        <p className="text-sm">
          <Explained title="عمر العقار" lines={EXPLAIN.listingAge(listing.age_source)} className="text-sm">
            <span>عمر العقار: <span className="font-semibold">{ageLabel(listing.age)}</span></span>
          </Explained>
        </p>
        {(listing.tenants || has.length > 0) && (
          <ul className="flex flex-wrap gap-1.5" aria-label="مزايا العقار">
            {listing.tenants && <li className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary">{TENANTS_LABEL[listing.tenants]}</li>}
            {has.map((label) => <li key={label} className="rounded-full border px-2.5 py-0.5 text-sm">{label}</li>)}
          </ul>
        )}
        {(listed || updated || listing.licensed) && (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {listed && <span>نُشر {listed}</span>}
            {updated && updated !== listed && <span>· حُدّث {updated}</span>}
            {listing.licensed && <span className="inline-flex items-center gap-1"><BadgeCheck className="size-4 text-primary" aria-hidden /> إعلان مرخّص</span>}
          </p>
        )}
        {perSqm && (
          <p className="text-sm">
            <Explained title="سعر المتر" lines={EXPLAIN.listingPerSqm(listing.deal)} className="font-semibold">{perSqm}</Explained>
            {versus && (
              <>
                {' · '}
                <Explained title="مقارنة بالحي" lines={EXPLAIN.listingVersusDistrict} className={cn('font-semibold', TONE[versus.tone])}>{versus.text}</Explained>
              </>
            )}
          </p>
        )}
        <button onClick={() => setAround((open) => !open)} aria-expanded={around}
          className="flex items-center justify-between pointer-coarse:min-h-11 rounded-lg border px-3 py-1.5 text-sm font-semibold hover:border-primary">
          حول العقار: مدارس، مستشفى، المطار، وسط المدينة{myPoint ? '، نقطتك' : ''}
          <ChevronDown className={cn('size-4 transition-transform', around && 'rotate-180')} aria-hidden />
        </button>
        {around && <ListingSurroundings listing={listing} myPoint={myPoint} density={density} />}
        {/* against the expected price: the line from the two figures, «غير متاح» without an estimate, a retry when it failed */}
        {ask && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm" aria-live="polite">
            <span className="text-muted-foreground">مقارنة بالسعر المتوقع:</span>
            {estimate.status === 'loading' ? <Skeleton className="h-4 w-28" aria-label="جارٍ حساب السعر المتوقع" />
              : estimate.status === 'error' ? <>تعذّر التحميل <Chip onClick={estimate.retry}>أعد المحاولة</Chip></>
                : versusExpected ? <Explained title="مقارنة بالسعر المتوقع" lines={EXPLAIN.listingVersusExpected(estimate.data!.price!.low, estimate.data!.price!.high)}
                  className={cn('font-semibold', versusExpected.tone === 'inside' ? '' : versusExpected.tone === 'below' ? 'text-primary' : 'text-warning')}>{versusExpected.text}</Explained>
                  : <span className="text-muted-foreground">غير متاح</span>}
          </div>
        )}
        {/* the next questions about this listing, each opening its page on this listing's own facts */}
        {/* a listing the price page cannot price (a shop, an office): «like this» goes straight to the district's offices,
            in a reviewed draft that names this listing and its asking price */}
        {!priced && listing.deal && listing.deal !== 'rent_unstated' && listing.district_ar && (
          <OfficesRequest compact className="" cityName={cityName}
            asked={{ city: listing.city, districtName: listing.district_ar, deal: listing.deal, kind: listing.type, area: listing.area_sqm ? Math.round(listing.area_sqm) : null }}
            fromListing={{ id: listing.id, ask: listing.price_sar }} />
        )}
        {(priced || districtHref) && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {priced && (
              <Link href={priced} className="inline-flex items-center gap-1.5 rounded-lg py-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
                <Calculator className="size-4" aria-hidden />سعّر عقاراً مثله
              </Link>
            )}
            {/* a sale is valued: the district's valuers, in a draft that names this listing (reviewed, never sent by itself) */}
            {listing.kind === 'sale' && priced && listing.district_ar && listing.area_sqm && (
              <OfficesRequest compact to={VALUERS} className="" cityName={cityName}
                asked={{ city: listing.city, districtName: listing.district_ar, deal: 'sale', kind: listing.type, area: Math.round(listing.area_sqm) }}
                price={estimate.data?.available ? estimate.data.price?.mid : undefined} fromListing={{ id: listing.id, ask: listing.price_sar }} />
            )}
            {districtHref && listing.district_ar && (
              <Link href={districtHref} className="inline-flex items-center gap-1.5 rounded-lg py-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
                <MapPinned className="size-4" aria-hidden />تعرّف على {listing.district_ar}
              </Link>
            )}
          </div>
        )}
        {listing.has_phone && <ListingPhone key={listing.id} id={listing.id} />}
        {/* with the number on file the main button asks for it, and the ad itself stays one tap away */}
        {listing.has_phone && listing.url && (
          <a href={listing.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 pointer-coarse:min-h-11 rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/5">
            <ExternalLink className="size-4" aria-hidden /> شاهد الإعلان<span className="sr-only">، يفتح في نافذة جديدة</span>
          </a>
        )}
        {(onCompare || (!listing.has_phone && listing.url)) && (
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            {listing.has_phone ? null : listing.url ? (
              <a href={listing.url} target="_blank" rel="noopener noreferrer"
                className={cn('inline-flex items-center justify-center gap-1.5 pointer-coarse:min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground', !onCompare && 'col-span-2')}>
                <ExternalLink className="size-4" aria-hidden /> اتصل أو راسل المعلن
              </a>
            ) : onCompare ? <span /> : null}
            {onCompare && (
              <button onClick={onCompare} aria-pressed={comparing}
                className={cn('inline-flex items-center justify-center gap-1.5 pointer-coarse:min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors', listing.has_phone && 'col-span-2', comparing ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary')}>
                {comparing ? <Check className="size-4" strokeWidth={3} aria-hidden /> : <Scale className="size-4" aria-hidden />} {comparing ? 'أُضيف للمقارنة' : 'أضف للمقارنة'}
              </button>
            )}
          </div>
        )}
        {/* what adding did, said where it was tapped: one more to pick, or the comparison ready to open */}
        {comparing && compareCount < 2 && (
          <p role="status" className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">أُضيف للمقارنة. افتح عقاراً ثانياً من الخريطة أو القائمة وأضفه.</p>
        )}
        {compareCount === 2 && onCompareNow && (
          <button onClick={onCompareNow} className="inline-flex items-center justify-center gap-1.5 pointer-coarse:min-h-11 rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background">
            <Scale className="size-4" aria-hidden /> قارن العقارين جنباً إلى جنب
          </button>
        )}
      </div>
    </MapWindow>
  )
}
