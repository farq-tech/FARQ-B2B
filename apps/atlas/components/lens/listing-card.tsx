'use client'

import { useState } from 'react'
import { BadgeCheck, Check, ChevronDown, ExternalLink, MessageCircle, Phone, Scale } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat } from '@/lib/insights-api'
import { FEATURES, TENANTS_LABEL, ageLabel, daysAgo, perSqmLine, priceLine, signalLines, typeLabel, versusDistrict, type Listing } from '@/lib/real-estate'
import { cn } from '@/lib/utils'
import { ListingSurroundings, type MyPoint } from './listing-surroundings'
import { Lightbox } from '@/components/shared/lightbox'
import { MapWindow } from '@/components/shared/map-window'

const TONE = { good: 'text-primary', even: 'text-muted-foreground', high: 'text-warning' } as const

/** Every photo of the ad, swiped sideways, each once (some ads repeat one); a photo that fails to load drops out. */
export function Gallery({ photos, className = 'h-40' }: { photos: string[]; className?: string }) {
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<number | null>(null)
  const shown = [...new Set(photos)].filter((photo) => !broken.has(photo))
  if (!shown.length) return null
  return (
    <div className="relative">
      <div className={cn('flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)} dir="ltr">
        {shown.map((photo, index) => (
          // the ad's own photos, shown from where they are published; a tap opens them full screen
          <button key={photo} type="button" onClick={(event) => { event.stopPropagation(); setOpen(index) }} aria-label={`افتح الصورة ${numberFormat.format(index + 1)}`}
            className="h-full w-full shrink-0 snap-center cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="" loading="lazy" onError={() => setBroken((current) => new Set(current).add(photo))} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open != null && <Lightbox photos={shown} start={open} onClose={() => setOpen(null)} />}
      {shown.length > 1 && (
        <span className="absolute bottom-2 start-2 rounded-full bg-background/80 px-2 py-0.5 text-sm backdrop-blur">{numberFormat.format(shown.length)} صور</span>
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
        <a href={`tel:+${international}`} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" dir="ltr">
          <Phone className="size-4" aria-hidden /> {state.phone}
        </a>
        <a href={`https://wa.me/${international}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold hover:border-primary">
          <MessageCircle className="size-4" aria-hidden /> واتساب
        </a>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <button onClick={reveal} disabled={state.loading} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        <Phone className="size-4" aria-hidden /> {state.loading ? 'يجلب الرقم…' : 'اعرض رقم المعلن'}
      </button>
      {state.phone === null && <p className="text-sm text-muted-foreground">رقم المعلن غير متاح لهذا العرض.</p>}
      {state.error && <p role="alert" className="text-sm text-warning">{state.error}{/سجّل/.test(state.error) && <> <a href="/login" className="underline">دخول</a></>}</p>}
    </div>
  )
}

/**
 * The card a listing opens on the map: its photos, the price with the period the ad states, the size and how the
 * price per m² stands against the same deal in its district. Two actions only: open the ad itself, or put the
 * listing in the comparison.
 */
export function ListingCard({ listing, comparing, onCompare, compareCount = 0, onCompareNow, onClose, myPoint = null, density = null, className }: {
  listing: Listing
  comparing: boolean
  onCompare: () => void
  /** How many listings are in the comparison, this one included or not. */
  compareCount?: number
  /** Opens the comparison of the two listings in it. */
  onCompareNow?: () => void
  onClose: () => void
  /** The viewer's own point (work, school…), measured from the home. */
  myPoint?: MyPoint | null
  /** Residents per km² of the listing's district. */
  density?: number | null
  /** Where the window sits, when the page floats its own buttons over the foot of the map. */
  className?: string
}) {
  const [around, setAround] = useState(false)
  const versus = listing.check ? null : versusDistrict(listing)
  const perSqm = perSqmLine(listing)
  const rooms = [
    listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : null,
    listing.beds ? `${numberFormat.format(listing.beds)} غرف` : null,
    listing.wc ? `${numberFormat.format(listing.wc)} دورات مياه` : null,
  ].filter(Boolean)
  const photos = listing.photos?.length ? listing.photos : listing.photo ? [listing.photo] : []
  // what the property has, as the ad's form records it; what it lacks shows in the comparison
  const has = FEATURES.filter(([key]) => listing.features?.[key] === 1).map(([, label]) => label)
  const listed = daysAgo(listing.listed_on)

  const tab = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photos[0] && <img src={photos[0]} alt="" className="size-9 shrink-0 rounded-full object-cover" />}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-bold">{priceLine(listing)}</span>
        <span className="truncate text-xs text-muted-foreground">{typeLabel(listing.type)}{listing.district_ar ? ` · ${listing.district_ar}` : ''}</span>
      </span>
    </>
  )

  return (
    <MapWindow label="العرض المختار" onClose={onClose} tab={tab} className={className}>
      <Gallery photos={photos} />
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
            عمر العقار: <span className="font-semibold">{ageLabel(listing.age)}</span>
          </Explained>
        </p>
        {(listing.tenants || has.length > 0) && (
          <ul className="flex flex-wrap gap-1.5" aria-label="مزايا العقار">
            {listing.tenants && <li className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary">{TENANTS_LABEL[listing.tenants]}</li>}
            {has.map((label) => <li key={label} className="rounded-full border px-2.5 py-0.5 text-sm">{label}</li>)}
          </ul>
        )}
        {(listed || listing.licensed) && (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {listed && <span>نُشر {listed}</span>}
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
          className="flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm font-semibold hover:border-primary">
          حول العقار: مدارس، مستشفى، المطار، وسط المدينة{myPoint ? '، نقطتك' : ''}
          <ChevronDown className={cn('size-4 transition-transform', around && 'rotate-180')} aria-hidden />
        </button>
        {around && <ListingSurroundings listing={listing} myPoint={myPoint} density={density} />}
        {listing.has_phone && <ListingPhone id={listing.id} />}
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {listing.has_phone ? null : listing.url ? (
            <a href={listing.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
              <ExternalLink className="size-4" aria-hidden /> اتصل أو راسل المعلن
            </a>
          ) : <span />}
          <button onClick={onCompare} aria-pressed={comparing}
            className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors', listing.has_phone && 'col-span-2', comparing ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary')}>
            {comparing ? <Check className="size-4" strokeWidth={3} aria-hidden /> : <Scale className="size-4" aria-hidden />} {comparing ? 'أُضيف للمقارنة' : 'أضف للمقارنة'}
          </button>
        </div>
        {/* what adding did, said where it was tapped: one more to pick, or the comparison ready to open */}
        {comparing && compareCount < 2 && (
          <p role="status" className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">أُضيف للمقارنة. افتح عقاراً ثانياً من الخريطة أو القائمة وأضفه.</p>
        )}
        {compareCount === 2 && onCompareNow && (
          <button onClick={onCompareNow} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background">
            <Scale className="size-4" aria-hidden /> قارن العقارين جنباً إلى جنب
          </button>
        )}
      </div>
    </MapWindow>
  )
}
