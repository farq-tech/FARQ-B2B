'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Explained } from '@/components/shared/explained'
import { LoadError } from '@/components/shared/load-error'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { LISTING_TYPES, PERIOD_WORD, priceLine, sar, typeLabel, type Listing } from '@/lib/real-estate'
import { ESTIMATE_DEALS, scopeLabel, type EstimateDeal, type PriceEstimate } from '@/lib/price-estimate'
import { COUNT_STEPS, offersLabel } from '@/lib/real-estate-filters'
import { cn } from '@/lib/utils'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b py-4 last:border-b-0">
      <h3 className="text-base font-bold">{title}</h3>
      {children}
    </section>
  )
}

/**
 * «تسعير عقار»: for a real-estate office pricing a client's unit. The office gives the deal, type, district, area and
 * rooms; the service answers with a range from the current listings like it (insights.price_estimate), and the
 * comparables it rests on, each opening its card over the map. Too few comparables shows «غير متاح», never a guess.
 */
export function PriceEstimateSheet({ open, onClose, city, cityAr, districts, onComparable }: {
  open: boolean
  onClose: () => void
  city: string
  cityAr: string
  districts: { id: string; name: string }[]
  onComparable: (listing: Listing) => void
}) {
  const [deal, setDeal] = useState<EstimateDeal>('rent_year')
  const [type, setType] = useState('apartment')
  const [district, setDistrict] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [area, setArea] = useState<number | null>(null)
  const [beds, setBeds] = useState(0)
  const [result, setResult] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; data?: PriceEstimate }>({ status: 'idle' })
  const kind = deal === 'sale' ? 'sale' : 'rent'
  const types = LISTING_TYPES.filter((item) => item.kinds.includes(kind) && item.id !== 'room')
  const districtName = districts.find((item) => item.id === district)?.name ?? null
  const shownDistricts = useMemo(() => {
    const text = query.trim()
    return (text ? districts.filter((item) => item.name.includes(text)) : districts).slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [districts, query])
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 64rem)').matches
  const ready = district != null && area != null && area >= 10
  const period = PERIOD_WORD[deal] ? ` ${PERIOD_WORD[deal]}` : ''

  const estimate = () => {
    if (!ready) return
    setResult({ status: 'loading' })
    postMarket<PriceEstimate>('price-estimate', { city, deal, type, district_id: district, area_sqm: area, ...(beds ? { beds } : {}) })
      .then((data) => setResult({ status: 'ready', data }))
      .catch(() => setResult({ status: 'error' }))
  }
  // a changed input makes the last answer stale: it goes until the office asks again
  const edit = <T,>(set: (value: T) => void) => (value: T) => { set(value); setResult({ status: 'idle' }) }
  const data = result.data

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent side={wide ? 'right' : 'bottom'} dir="rtl"
        className={cn('gap-0 p-0', wide ? 'w-full sm:max-w-[28rem]' : 'max-h-[92dvh] rounded-t-3xl')}>
        <SheetHeader className="border-b px-5 py-4 pe-12 text-start">
          <SheetTitle>تسعير عقار</SheetTitle>
          <SheetDescription>نطاق سعر لعقار عميلك من العروض المشابهة في {cityAr}.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <Section title="الصفقة">
            <div className="flex flex-wrap gap-2">
              {ESTIMATE_DEALS.map((item) => (
                <Chip key={item.id} active={deal === item.id} onClick={() => {
                  edit(setDeal)(item.id)
                  // a type the deal does not offer falls back to a flat
                  if (!LISTING_TYPES.find((entry) => entry.id === type)?.kinds.includes(item.id === 'sale' ? 'sale' : 'rent')) setType('apartment')
                }}>{item.label}</Chip>
              ))}
            </div>
          </Section>

          <Section title="نوع العقار">
            <div className="flex flex-wrap gap-2">
              {types.map((item) => <Chip key={item.id} active={type === item.id} onClick={() => edit(setType)(item.id)}>{item.label}</Chip>)}
            </div>
          </Section>

          <Section title="الحي">
            <label className="flex h-11 items-center gap-2 rounded-xl border bg-card px-3 focus-within:ring-2 focus-within:ring-ring/60">
              <Search className="size-4 text-muted-foreground" aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن حي" aria-label="ابحث عن حي"
                className="w-full min-w-0 bg-transparent text-sm outline-none" />
            </label>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {shownDistricts.map((item) => <Chip key={item.id} active={district === item.id} onClick={() => edit(setDistrict)(item.id)}>{item.name}</Chip>)}
              {!shownDistricts.length && <p className="text-sm text-muted-foreground">{districts.length ? 'لا حي بهذا الاسم.' : 'أحياء المدينة غير متاحة الآن.'}</p>}
            </div>
          </Section>

          <Section title="المساحة">
            <label className="flex flex-col gap-1 rounded-xl border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring/60">
              <span className="text-xs text-muted-foreground">مساحة العقار</span>
              <span className="flex items-center gap-1.5">
                <input type="text" inputMode="numeric" dir="ltr" placeholder="170" value={area == null ? '' : numberFormat.format(area)} aria-label="المساحة بالمتر المربع"
                  onChange={(event) => { const digits = event.target.value.replace(/[^0-9]/g, ''); edit(setArea)(digits ? Number(digits) : null) }}
                  className="w-full min-w-0 bg-transparent text-end text-base font-semibold tabular-nums outline-none placeholder:font-normal placeholder:text-muted-foreground" />
                <span className="shrink-0 text-xs text-muted-foreground">م²</span>
              </span>
            </label>
          </Section>

          <Section title="غرف النوم">
            <div className="flex flex-wrap gap-2">
              {COUNT_STEPS.map((step) => <Chip key={step} active={beds === step} onClick={() => edit(setBeds)(step)}>{step ? numberFormat.format(step) : 'غير محدد'}</Chip>)}
            </div>
          </Section>

          <div className="py-4">
            <Button onClick={estimate} disabled={!ready || result.status === 'loading'} className="h-11 w-full rounded-full">
              {result.status === 'loading' ? 'جارٍ التقدير…' : ready ? 'قدّر السعر' : 'اختر الحي واكتب المساحة'}
            </Button>
          </div>

          {result.status === 'loading' && <div className="flex flex-col gap-2 pb-6" aria-busy="true"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
          {result.status === 'error' && <div className="pb-6"><LoadError what="التقدير" onRetry={estimate} /></div>}
          {result.status === 'ready' && data && (
            <div className="flex flex-col gap-4 pb-6" aria-live="polite">
              {!data.available || !data.estimate || !data.scope ? (
                <div className="rounded-2xl border bg-muted/40 p-4">
                  <p className="text-lg font-bold">غير متاح</p>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {!data.available
                      ? `عروض العقار غير متاحة في ${cityAr} بعد.`
                      : `${data.comparables_found ? `في السوق ${offersLabel(data.comparables_found)} فقط بهذه المواصفات` : 'لا عروض بهذه المواصفات'}، والتقدير يحتاج ${numberFormat.format(data.min_comparables ?? 5)} عروض على الأقل. جرّب نوعاً أو مدة أخرى.`}
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border bg-card p-4">
                    <Explained title="تقدير السعر" lines={EXPLAIN.priceEstimate(data.comparables_found ?? 0, data.area_band_pct ?? 30, !!data.reliable)}>
                      <span className="text-2xl font-bold tabular-nums">{numberFormat.format(data.estimate.low_sar)} – {numberFormat.format(data.estimate.high_sar)}</span>
                    </Explained>
                    <p className="text-sm text-muted-foreground">ريال{period}</p>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="text-muted-foreground">الوسيط</dt><dd className="font-semibold">{sar(data.estimate.mid_sar)}</dd></div>
                      <div><dt className="text-muted-foreground">سعر المتر</dt><dd className="font-semibold">{sar(data.estimate.median_sar_per_sqm)}</dd></div>
                    </dl>
                    <p className="mt-3 text-sm">
                      بُني على {offersLabel(data.comparables_found ?? 0)} {scopeLabel(data.scope, districtName, data.radius_m ?? 2500)}
                      {!data.reliable && <span className="text-muted-foreground"> · عينة صغيرة</span>}
                    </p>
                  </div>
                  <section aria-label="العروض المشابهة">
                    <h3 className="mb-2 text-base font-bold">العروض المشابهة</h3>
                    <ul className="flex flex-col divide-y rounded-2xl border">
                      {(data.comparables ?? []).map((listing) => (
                        <li key={listing.id}>
                          <button onClick={() => onComparable(listing)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-sm font-semibold">{typeLabel(listing.type)}{listing.district_ar ? ` في ${listing.district_ar}` : ''}</span>
                              <span className="text-xs text-muted-foreground">
                                {[listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : null, listing.beds ? `${numberFormat.format(listing.beds)} غرف` : null].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-bold">{priceLine(listing)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
