'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ExternalLink, Scale, X } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat } from '@/lib/insights-api'
import { perSqmLine, priceLine, typeLabel, versusDistrict, type Listing } from '@/lib/real-estate'
import { cn } from '@/lib/utils'
import { ListingSurroundings, type MyPoint } from './listing-surroundings'

const TONE = { good: 'text-primary', even: 'text-muted-foreground', high: 'text-warning' } as const

/** Every photo of the ad, swiped sideways; a photo that fails to load drops out. */
export function Gallery({ photos, className = 'h-40' }: { photos: string[]; className?: string }) {
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const shown = photos.filter((photo) => !broken.has(photo))
  if (!shown.length) return null
  return (
    <div className="relative">
      <div className={cn('flex snap-x snap-mandatory overflow-x-auto', className)} dir="ltr">
        {shown.map((photo) => (
          // the ad's own photos, shown from where they are published
          // eslint-disable-next-line @next/next/no-img-element
          <img key={photo} src={photo} alt="" loading="lazy" onError={() => setBroken((current) => new Set(current).add(photo))}
            className="h-full w-full shrink-0 snap-center object-cover" />
        ))}
      </div>
      {shown.length > 1 && (
        <span className="absolute bottom-2 start-2 rounded-full bg-background/80 px-2 py-0.5 text-sm backdrop-blur">{numberFormat.format(shown.length)} صور</span>
      )}
    </div>
  )
}

/**
 * The card a listing opens on the map: its photos, the price with the period the ad states, the size and how the
 * price per m² stands against the same deal in its district. Two actions only: open the ad itself, or put the
 * listing in the comparison.
 */
export function ListingCard({ listing, comparing, onCompare, onClose, myPoint = null, density = null }: {
  listing: Listing
  comparing: boolean
  onCompare: () => void
  onClose: () => void
  /** The viewer's own point (work, school…), measured from the home. */
  myPoint?: MyPoint | null
  /** Residents per km² of the listing's district. */
  density?: number | null
}) {
  const [around, setAround] = useState(false)
  const versus = listing.check ? null : versusDistrict(listing)
  const perSqm = perSqmLine(listing)
  const rooms = [
    listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : 'المساحة غير مذكورة',
    listing.beds ? `${numberFormat.format(listing.beds)} غرف` : null,
    listing.wc ? `${numberFormat.format(listing.wc)} دورات مياه` : null,
  ].filter(Boolean)
  const photos = listing.photos?.length ? listing.photos : listing.photo ? [listing.photo] : []
  return (
    <article aria-label="العرض المختار" className="absolute inset-x-3 bottom-3 z-10 mx-auto max-h-[85%] max-w-sm overflow-y-auto rounded-2xl border bg-card shadow-xl">
      <button onClick={onClose} aria-label="إغلاق" className="absolute end-2 top-2 z-10 rounded-full bg-background/80 p-1.5 backdrop-blur hover:bg-background">
        <X className="size-4" aria-hidden />
      </button>
      <Gallery photos={photos} />
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-sm text-muted-foreground">
          {typeLabel(listing.type)} {listing.kind === 'rent' ? 'للإيجار' : listing.kind === 'sale' ? 'للبيع' : ''}{listing.district_ar ? ` · ${listing.district_ar}` : ''}
        </p>
        <p className="text-xl font-bold">{priceLine(listing)}</p>
        <p className="text-base">{rooms.join(' · ')}</p>
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
        {listing.check && (
          <Explained title="تحقق من الإعلان" lines={EXPLAIN.listingCheck} className="flex items-center gap-1.5 text-sm text-warning no-underline">
            <AlertTriangle className="size-4" aria-hidden /> أرقام هذا الإعلان تحتاج تحققاً
          </Explained>
        )}
        <button onClick={() => setAround((open) => !open)} aria-expanded={around}
          className="flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm font-semibold hover:border-primary">
          حول العقار: مدارس، مستشفى، المطار، وسط المدينة{myPoint ? '، نقطتك' : ''}
          <ChevronDown className={cn('size-4 transition-transform', around && 'rotate-180')} aria-hidden />
        </button>
        {around && <ListingSurroundings listing={listing} myPoint={myPoint} density={density} />}
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {listing.url ? (
            <a href={listing.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
              <ExternalLink className="size-4" aria-hidden /> اتصل أو راسل المعلن
            </a>
          ) : <span />}
          <button onClick={onCompare} aria-pressed={comparing}
            className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold', comparing ? 'border-primary text-primary' : 'hover:border-primary')}>
            <Scale className="size-4" aria-hidden /> {comparing ? 'في المقارنة' : 'أضف للمقارنة'}
          </button>
        </div>
      </div>
    </article>
  )
}
