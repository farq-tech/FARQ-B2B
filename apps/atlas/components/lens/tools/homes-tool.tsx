'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Scale, X } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket } from '@/lib/insights-api'
import { distanceKm } from '@/lib/geo-measure'
import { BUDGETS, LISTING_TYPES, PERIOD_WORD, RENT_DEALS, isPublishable, priceLine, toneColor, typeLabel, versusDistrict, type Deal, type Listing, type ListingKind } from '@/lib/real-estate'
import { cn } from '@/lib/utils'
import { AdvisorPanel, type AdvisorSubject } from '../advisor-panel'
import type { DistrictRow } from '../city-data'
import { ListingCard } from '../listing-card'
import { ListingCompare } from '../listing-compare'
import type { MyPoint } from '../listing-surroundings'
import type { Overlay } from './overlay'
import { Icon3D } from '@/components/shared/icon-3d'
import { useStickyState } from '@/lib/sticky-state'

type Result = { status: 'loading' | 'ready' | 'error'; available: boolean; total: number | null; listings: Listing[] }
const LIMIT = 1500
const BEST = 8
const MY_POINT_KEY = 'atlas.myPoint'

function readPoint(): MyPoint | null {
  try {
    const value = JSON.parse(localStorage.getItem(MY_POINT_KEY) ?? 'null') as MyPoint | null
    return value && typeof value.lon === 'number' && typeof value.lat === 'number' ? value : null
  } catch { return null }
}
function savePoint(point: MyPoint | null) {
  try { if (point) localStorage.setItem(MY_POINT_KEY, JSON.stringify(point)); else localStorage.removeItem(MY_POINT_KEY) } catch { /* the point stays for this visit */ }
}

/** The ad's first photo, small, beside its line in the list; nothing when it fails to load. */
function Thumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <span className="size-14 shrink-0 rounded-lg bg-muted" aria-hidden />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="size-14 shrink-0 rounded-lg object-cover" />
}

/**
 * «اختر عقاراً»: the current listings that match a deal, a property type and a budget, as dots on the map coloured by
 * price against their district (in the selected districts, or the whole city). A dot opens one card; the side list
 * puts the best value first; two listings, or two selected districts, go to the comparison assistant.
 */
export function HomesTool({ city, rows, selected, onOverlay, preset }: {
  city: string
  rows: DistrictRow[]
  selected: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  /** Where the search starts: a shop owner looks for a shop to rent, whatever period its ad states. */
  preset?: { kind: ListingKind; type: string; deal?: Deal | 'all' }
}) {
  // the shops lens opens on store rents, so its choices are kept apart from the homes lens's
  const sticky = `homes.${preset ? 'preset' : 'plain'}`
  const [kind, setKind] = useStickyState<ListingKind>(`${sticky}.kind`, preset?.kind ?? 'rent')
  const [type, setType] = useStickyState(`${sticky}.type`, preset?.type ?? 'apartment')
  // a rent is searched in one period at a time, the one its ad states; «all» mixes them, so it takes no budget
  const [rentDeal, setRentDeal] = useStickyState<Deal | 'all'>(`${sticky}.rentDeal`, preset?.deal ?? 'rent_year')
  const [budget, setBudget] = useStickyState(`${sticky}.budget`, 0)
  const deal: Deal | null = kind === 'sale' ? 'sale' : rentDeal === 'all' ? null : rentDeal
  const [result, setResult] = useState<Result>({ status: 'loading', available: true, total: null, listings: [] })
  const [active, setActive] = useState<Listing | null>(null)
  const [focus, setFocus] = useState<{ lon: number; lat: number } | null>(null)
  const [compare, setCompare] = useState<Listing[]>([])
  const [advisor, setAdvisor] = useState<AdvisorSubject | null>(null)
  const [sideBySide, setSideBySide] = useState(false)
  // the viewer's own point (work, a school…): kept in this browser only, measured from every home
  const [myPoint, setMyPoint] = useState<MyPoint | null>(null)
  const [picking, setPicking] = useState(false)
  const [nearest, setNearest] = useState(false)
  useEffect(() => { setMyPoint(readPoint()) }, [])
  // residents per km², computed once in the service (server.py enrich_district_counts); read here per district
  const density = useMemo(() => new Map(rows.map((row) => [row.id, row.density])), [rows])
  const districtIds = selected.map((row) => row.id)
  const districtKey = districtIds.join('|')

  useEffect(() => { if (!LISTING_TYPES.find((item) => item.id === type)?.kinds.includes(kind)) setType('apartment') }, [kind, type])
  useEffect(() => { setBudget(0) }, [kind, rentDeal])

  useEffect(() => {
    let live = true
    setResult((current) => ({ ...current, status: 'loading' }))
    setActive(null)
    postMarket<{ available?: boolean; total?: number; listings?: Listing[] }>('real-estate-listings', {
      city, kind, types: [type], limit: LIMIT,
      ...(deal ? { deal } : {}),
      ...(budget && deal ? { max_price: budget } : {}),
      ...(districtKey ? { district_ids: districtKey.split('|') } : {}),
    })
      .then((data) => { if (live) setResult({ status: 'ready', available: data.available !== false, total: data.total ?? null, listings: (data.listings ?? []).filter(isPublishable) }) })
      .catch(() => { if (live) setResult({ status: 'error', available: true, total: null, listings: [] }) })
    return () => { live = false }
  }, [city, kind, type, deal, budget, districtKey])

  const byId = useMemo(() => new Map(result.listings.map((listing) => [listing.id, listing])), [result.listings])
  const toggleCompare = useCallback((listing: Listing) => setCompare((current) => (
    current.some((item) => item.id === listing.id) ? current.filter((item) => item.id !== listing.id) : [...current.slice(-1), listing]
  )), [])
  const open = useCallback((listing: Listing) => { setActive(listing); setFocus({ lon: listing.lon, lat: listing.lat }) }, [])

  useEffect(() => {
    const dots = result.listings.map((listing) => ({
      id: listing.id, lon: listing.lon, lat: listing.lat,
      color: toneColor[versusDistrict(listing)?.tone ?? 'none'],
    }))
    onOverlay({
      listings: dots,
      onListing: (id) => { const listing = byId.get(id); if (listing) setActive(listing) },
      focus,
      popup: active ? <ListingCard listing={active} comparing={compare.some((item) => item.id === active.id)} onCompare={() => toggleCompare(active)} onClose={() => setActive(null)}
        compareCount={compare.length} onCompareNow={() => { setActive(null); setSideBySide(true) }}
        myPoint={myPoint} density={active.district_id ? density.get(active.district_id) ?? null : null} /> : null,
      start: myPoint,
      onPick: picking ? (point) => { setMyPoint(point); savePoint(point); setPicking(false); setNearest(true) } : null,
    })
  }, [result.listings, byId, active, focus, compare, toggleCompare, onOverlay, myPoint, picking, density])

  // the list in the server's best-value order, or nearest to the viewer's point first
  const shown = useMemo(() => (nearest && myPoint
    ? [...result.listings].sort((a, b) => distanceKm(a, myPoint) - distanceKm(b, myPoint))
    : result.listings).slice(0, BEST), [result.listings, nearest, myPoint])

  const where = selected.length ? (selected.length === 1 ? `في ${selected[0].name}` : `في ${counted(selected.length, 'district')}`) : 'في المدينة'
  const types = LISTING_TYPES.filter((item) => item.kinds.includes(kind))

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">اختر عقاراً</h2>
      <div className="flex gap-1.5">
        {([['rent', 'إيجار'], ['sale', 'شراء']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setKind(id)} aria-pressed={kind === id}
            className={cn('flex-1 rounded-lg border py-2 text-sm', kind === id ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>{label}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {types.map((item) => (
          <button key={item.id} onClick={() => setType(item.id)} aria-pressed={type === item.id}
            className={cn('inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-3 text-sm', type === item.id ? 'border-primary text-primary' : 'text-muted-foreground hover:text-foreground')}><Icon3D type={item.id} />{item.label}</button>
        ))}
      </div>
      {kind === 'rent' && (
        <div className="flex flex-wrap gap-1.5" aria-label="مدة الإيجار">
          {[...RENT_DEALS, { id: 'all' as const, label: 'الكل' }].map((item) => (
            <button key={item.id} onClick={() => setRentDeal(item.id)} aria-pressed={rentDeal === item.id}
              className={cn('rounded-full border px-3 py-1.5 text-sm', rentDeal === item.id ? 'border-primary text-primary' : 'text-muted-foreground hover:text-foreground')}>{item.label}</button>
          ))}
        </div>
      )}
      {deal && (
        <select aria-label="الميزانية" value={budget} onChange={(event) => setBudget(Number(event.target.value))} className="rounded-lg border bg-background px-3 py-2 text-base">
          <option value={0}>أي ميزانية</option>
          {BUDGETS[deal].map((value) => <option key={value} value={value}>حتى {numberFormat.format(value)} ريال{PERIOD_WORD[deal] ? ` ${PERIOD_WORD[deal]}` : ''}</option>)}
        </select>
      )}

      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border p-2">
        <MapPin className="size-4 text-primary" aria-hidden />
        {picking ? (
          <>
            <span className="text-sm font-semibold">اضغط على الخريطة في مكان عملك أو أي نقطة تهمك</span>
            <button onClick={() => setPicking(false)} className="text-sm text-muted-foreground underline">إلغاء</button>
          </>
        ) : myPoint ? (
          <>
            <span className="text-sm">نقطتك محددة</span>
            <button onClick={() => setNearest((value) => !value)} aria-pressed={nearest}
              className={cn('rounded-full border px-3 py-1 text-sm', nearest ? 'border-primary text-primary' : 'hover:border-primary')}>الأقرب لنقطتي أولاً</button>
            <button onClick={() => setPicking(true)} className="text-sm text-muted-foreground underline">غيّرها</button>
            <button onClick={() => { setMyPoint(null); savePoint(null); setNearest(false) }} className="text-sm text-muted-foreground underline">احذفها</button>
          </>
        ) : (
          <button onClick={() => setPicking(true)} className="text-sm font-semibold text-primary">حدد نقطتك (عملك، مدرسة أولادك…) لنقيس المسافة منها</button>
        )}
      </div>

      {result.status === 'loading' && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ التحميل" />}
      {result.status === 'error' && <p role="alert" className="text-base text-destructive">تعذر تحميل العروض.</p>}
      {result.status === 'ready' && !result.available && <p className="text-base text-muted-foreground">عروض العقار غير متاحة لهذه المدينة بعد.</p>}
      {result.status === 'ready' && result.available && (
        <>
          <p className="text-sm text-muted-foreground">
            {result.total != null ? `${numberFormat.format(result.total)} عرضاً ${where}` : `عدد العروض غير متاح ${where}`}
            {result.total != null && result.total > result.listings.length ? ` · على الخريطة أنسب ${numberFormat.format(result.listings.length)}` : ''}
          </p>
          {result.listings.length > 0 && (
            <div>
              <Explained title={nearest && myPoint ? 'الأقرب لنقطتك' : 'أنسب العروض'} lines={EXPLAIN.bestListings} className="mb-1 text-sm font-semibold text-muted-foreground">{nearest && myPoint ? 'الأقرب لنقطتك' : 'أنسب العروض'}</Explained>
              <ol className="divide-y">
                {shown.map((listing) => {
                  const versus = versusDistrict(listing)
                  return (
                    <li key={listing.id}>
                      <button onClick={() => open(listing)} className={cn('flex w-full items-center justify-between gap-2 py-2 text-start hover:text-primary', active?.id === listing.id && 'text-primary')}>
                        <Thumb src={listing.photo} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{[typeLabel(listing.type), listing.district_ar, listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : null].filter(Boolean).join(' · ')}</span>
                          {versus && <span className={cn('block text-sm', versus.tone === 'good' ? 'text-primary' : 'text-muted-foreground')}>{versus.text}</span>}
                          {myPoint && <span className="block text-sm text-muted-foreground">{numberFormat.format(Math.round(distanceKm(listing, myPoint) * 10) / 10)} كم من نقطتك</span>}
                        </span>
                        <span className="shrink-0 text-sm font-semibold">{priceLine(listing)}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </>
      )}

      {compare.length > 0 && (
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><Scale className="size-4" aria-hidden /> للمقارنة</p>
          <ul className="space-y-1 text-sm">
            {compare.map((listing) => (
              <li key={listing.id} className="flex items-center justify-between gap-2">
                <button onClick={() => open(listing)} className="truncate text-start hover:text-primary">{typeLabel(listing.type)}{listing.district_ar ? ` في ${listing.district_ar}` : ""} · {priceLine(listing)}</button>
                <button onClick={() => toggleCompare(listing)} aria-label="إزالة من المقارنة" className="text-muted-foreground hover:text-foreground"><X className="size-4" aria-hidden /></button>
              </li>
            ))}
          </ul>
          {compare.length < 2 && <p className="mt-1 text-sm text-muted-foreground">أضف عرضاً ثانياً من الخريطة.</p>}
        </div>
      )}
      {compare.length === 2 && (
        <button onClick={() => setSideBySide(true)}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-base font-semibold text-primary-foreground">
          <Scale className="size-4" aria-hidden /> قارن العرضين
        </button>
      )}
      {selected.length === 2 && (
        <button onClick={() => setAdvisor({ kind: 'districts', rows: selected })}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary px-3 py-2 text-base font-semibold text-primary">
          <Scale className="size-4" aria-hidden /> قارن {selected[0].name} و{selected[1].name}
        </button>
      )}
      {sideBySide && compare.length === 2 && (
        <ListingCompare listings={[compare[0], compare[1]]} onClose={() => setSideBySide(false)} onRemove={toggleCompare}
          onAdvisor={() => { setSideBySide(false); setAdvisor({ kind: 'listings', listings: compare }) }} />
      )}
      {advisor && <AdvisorPanel key={JSON.stringify(advisor.kind === 'listings' ? advisor.listings.map((item) => item.id) : advisor.rows.map((row) => row.id))} subject={advisor} rows={rows} onClose={() => setAdvisor(null)} />}
    </section>
  )
}
