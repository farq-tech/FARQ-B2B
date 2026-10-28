'use client'

import { useState } from 'react'
import { ExternalLink, Scale, X } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat } from '@/lib/insights-api'
import { priceLine, sar, typeLabel, versusDistrict, type Listing } from '@/lib/real-estate'
import { cn } from '@/lib/utils'

const TONE = { good: 'text-primary', even: 'text-muted-foreground', high: 'text-amber-500' } as const

/**
 * The card a listing opens on the map: one photo, the price, the size and how the price per m² stands against its
 * district. Two actions only: open the ad itself, or put the listing in the comparison.
 */
export function ListingCard({ listing, comparing, onCompare, onClose }: {
  listing: Listing
  comparing: boolean
  onCompare: () => void
  onClose: () => void
}) {
  const [photo, setPhoto] = useState(Boolean(listing.photo))
  const versus = versusDistrict(listing)
  const rooms = [
    listing.beds ? `${numberFormat.format(listing.beds)} غرف` : null,
    listing.wc ? `${numberFormat.format(listing.wc)} دورات مياه` : null,
  ].filter(Boolean)
  return (
    <article aria-label="العرض المختار" className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-sm overflow-hidden rounded-2xl border bg-card shadow-xl">
      <button onClick={onClose} aria-label="إغلاق" className="absolute end-2 top-2 z-10 rounded-full bg-background/80 p-1.5 backdrop-blur hover:bg-background">
        <X className="size-4" aria-hidden />
      </button>
      {photo && listing.photo && (
        // the ad's own photo, shown from where it is published
        // eslint-disable-next-line @next/next/no-img-element
        <img src={listing.photo} alt="" loading="lazy" onError={() => setPhoto(false)} className="h-32 w-full object-cover" />
      )}
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-sm text-muted-foreground">{typeLabel(listing.type)} {listing.kind === 'rent' ? 'للإيجار' : 'للبيع'} · {listing.district_ar}</p>
        <p className="text-xl font-bold">{priceLine(listing)}</p>
        <p className="text-base">{numberFormat.format(listing.area_sqm)} م²{rooms.length ? ` · ${rooms.join(' · ')}` : ''}</p>
        <p className="text-sm">
          <Explained title="سعر المتر" lines={EXPLAIN.listingPerSqm(listing.kind === 'rent')} className="font-semibold">
            {sar(listing.sar_per_sqm)} للمتر{listing.kind === 'rent' ? ' سنوياً' : ''}
          </Explained>
          {versus && (
            <>
              {' · '}
              <Explained title="مقارنة بالحي" lines={EXPLAIN.listingVersusDistrict} className={cn('font-semibold', TONE[versus.tone])}>{versus.text}</Explained>
            </>
          )}
        </p>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {listing.url ? (
            <a href={listing.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
              <ExternalLink className="size-4" aria-hidden /> افتح الإعلان
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
