'use client'

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, MessageCircle, X } from 'lucide-react'
import { numberFormat } from '@/lib/insights-api'
import { ageLabel, perSqmLine, priceLine, typeLabel, versusDistrict, type Listing } from '@/lib/real-estate'
import { cn } from '@/lib/utils'
import { Gallery } from './listing-card'

const count = (value: number | null | undefined, unit = '') => (value ? `${numberFormat.format(value)}${unit}` : 'غير متاح')

type Row = { label: string; cells: [ReactNode, ReactNode]; better?: 0 | 1 | null }

/** Which side is better on a figure where less (or more) wins; none when either is missing or both are equal. */
function better(a: number | null | undefined, b: number | null | undefined, wins: 'less' | 'more'): 0 | 1 | null {
  if (a == null || b == null || a === b) return null
  return (wins === 'less' ? a < b : a > b) ? 0 : 1
}

/**
 * Two listings side by side, row by row, the better figure of each row in green: price, size, rooms, age, price per
 * m² and how each stands in its district. A figure the ad does not state reads «غير متاح». Price and price per m² are
 * only marked when both ads state the same period, so a yearly rent is never set against a monthly one.
 */
export function ListingCompare({ listings, onClose, onRemove, onAdvisor }: {
  listings: [Listing, Listing]
  onClose: () => void
  onRemove: (listing: Listing) => void
  /** Hands the two to the comparison assistant, for a recommendation by who will live there. */
  onAdvisor?: () => void
}) {
  const [a, b] = listings
  const samePeriod = a.deal === b.deal

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', key)
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', key) }
  }, [onClose])

  const rows: Row[] = [
    { label: 'السعر', cells: [priceLine(a), priceLine(b)], better: samePeriod ? better(a.price_sar, b.price_sar, 'less') : null },
    { label: 'المساحة', cells: [count(a.area_sqm, ' م²'), count(b.area_sqm, ' م²')], better: better(a.area_sqm, b.area_sqm, 'more') },
    { label: 'سعر المتر', cells: [perSqmLine(a) ?? 'غير متاح', perSqmLine(b) ?? 'غير متاح'], better: samePeriod ? better(a.sar_per_sqm, b.sar_per_sqm, 'less') : null },
    { label: 'مقارنة بالحي', cells: [versusDistrict(a)?.text ?? 'غير متاح', versusDistrict(b)?.text ?? 'غير متاح'], better: better(a.vs_district_pct, b.vs_district_pct, 'less') },
    { label: 'الغرف', cells: [count(a.beds), count(b.beds)], better: better(a.beds, b.beds, 'more') },
    { label: 'الصالات', cells: [count(a.livings), count(b.livings)], better: better(a.livings, b.livings, 'more') },
    { label: 'دورات المياه', cells: [count(a.wc), count(b.wc)], better: better(a.wc, b.wc, 'more') },
    { label: 'عمر العقار', cells: [ageLabel(a.age), ageLabel(b.age)], better: better(a.age, b.age, 'less') },
    { label: 'عرض الشارع', cells: [count(a.street_width, ' م'), count(b.street_width, ' م')], better: better(a.street_width, b.street_width, 'more') },
    { label: 'مؤشر الحي', cells: [a.signal?.label ?? 'غير متاح', b.signal?.label ?? 'غير متاح'] },
  ]

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40 animate-in fade-in duration-200 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="مقارنة العقارين" onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:max-w-2xl sm:rounded-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-2">
          <h2 className="ps-2 text-base font-bold">مقارنة العقارين</h2>
          <button onClick={onClose} aria-label="أغلق المقارنة" className="grid size-9 place-items-center rounded-full bg-muted hover:bg-muted/70"><X className="size-5" aria-hidden /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <div className="grid grid-cols-2 gap-2 p-3">
            {listings.map((listing) => (
              <div key={listing.id} className="flex min-w-0 flex-col gap-1">
                <div className="overflow-hidden rounded-xl">
                  <Gallery photos={listing.photos?.length ? listing.photos : listing.photo ? [listing.photo] : []} className="h-28 sm:h-40" />
                </div>
                <p className="truncate text-sm font-semibold">{typeLabel(listing.type)}{listing.district_ar ? ` · ${listing.district_ar}` : ''}</p>
                <button onClick={() => onRemove(listing)} className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">أزل من المقارنة</button>
              </div>
            ))}
          </div>
          <dl className="divide-y border-y">
            {rows.map((row) => (
              <div key={row.label} className="px-3 py-2">
                <dt className="mb-1 text-xs text-muted-foreground">{row.label}</dt>
                <dd className="grid grid-cols-2 gap-2 text-sm">
                  {row.cells.map((cell, index) => (
                    <span key={index} className={cn('min-w-0 break-words', row.better === index && 'font-bold text-primary')}>{cell}</span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          {!samePeriod && <p className="px-3 pt-2 text-xs text-muted-foreground">السعران بمدتين مختلفتين، فلم نحدد الأقل.</p>}
          <div className="grid grid-cols-2 gap-2 p-3">
            {listings.map((listing) => listing.url ? (
              <a key={listing.id} href={listing.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-semibold hover:border-primary">
                <ExternalLink className="size-4" aria-hidden /> الإعلان
              </a>
            ) : <span key={listing.id} />)}
          </div>
          {onAdvisor && (
            <div className="px-3 pb-3">
              <button onClick={onAdvisor} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground">
                <MessageCircle className="size-4" aria-hidden /> أيّهما أنسب لي؟ اسأل المستشار
              </button>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}
