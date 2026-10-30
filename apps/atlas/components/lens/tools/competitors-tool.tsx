'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { ltr, numberFormat, percent, postMarket, type DistrictFeature } from '@/lib/insights-api'
import { areaKm2 } from '@/lib/geo-measure'
import { cn } from '@/lib/utils'
import type { DistrictRow } from '../city-data'
import { MapLegend } from './map-legend'
import type { Overlay } from './overlay'
import { OCHRE_STEPS, PALETTE } from '@/lib/palette'
import { Icon3D } from '@/components/shared/icon-3d'
import { useStickyState, useStudiedActivity, type StudiedActivity } from '@/lib/sticky-state'
import { residentsPer } from '@/lib/audience'
import { formatDate } from '@/lib/format'

type Activity = { main_id: string; main_ar: string }
type Count = { district_ar: string; n: number }
type Growth = { since: string | null; before: number; now: number } | null
type Brand = { brand: string; keys: string[]; branches: number; districts: number; share_pct: number | null; by_district: Count[]; growth: Growth }
type Uncovered = { district_ar: string; population: number; businesses: number }
type Brands = { total: number; chains: number; in_chains: number; brands: Brand[]; uncovered?: Uncovered[]; uncovered_by?: string[] }
type Profile = { branches: number; districts: number; activity: { main_ar: string; classified: number; agree: number } | null; activities: { main_ar: string; n: number }[] }

/** «+5 فرعاً منذ 1 سبتمبر 2026», or null while the directory history has one snapshot. */
function growthLine(growth: Growth): string | null {
  if (!growth) return null
  const change = growth.now - growth.before
  const since = growth.since ? ` منذ ${formatDate(growth.since)}` : ''
  return change === 0 ? `بلا تغيير${since}` : `${ltr(`${change > 0 ? '+' : '−'}${numberFormat.format(Math.abs(change))}`)} فرعاً${since}`
}
type Row = { row: DistrictRow; competitors: number; areaKm2: number; perKm2: number; residentsPer: number | null }

const EXAMPLES = ['صيدلية', 'مغسلة ملابس', 'بقالة', 'مطعم', 'صالون حلاقة', 'مقهى']
// competition reads as heat: pale for few competitors per km², deep amber for many
const HEAT = OCHRE_STEPS
const NONE = PALETTE.sage   // no competitor of this activity in the district

/**
 * «المنافسون»: for one activity, how many businesses already serve each district, per km² and per resident. The map
 * shows where competition is dense; a district picked from the list opens its competitors by name.
 */
export function CompetitorsTool({ city, rows, features, onOverlay, onSelect, onActivity, onAllBranches }: {
  city: string
  rows: DistrictRow[]
  features: DistrictFeature[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
  /** The activity being studied, so the competitors of a picked district can be listed by name. */
  onActivity: (activity: string | null) => void
  /** Opens every branch of a chain across the city, for a quote request or campaign to all of them. */
  onAllBranches: (brand: string) => void
}) {
  const [activities, setActivities] = useState<Activity[]>([])
  // the map opens painted with the activity studied in any step; any other activity replaces it
  const [studied, setStudied] = useStudiedActivity()
  const [query, setQuery] = useState(studied.q ?? '')
  const [counts, setCounts] = useState<Count[] | null>(null)
  // the city's count from the service, which includes businesses with no reliable district
  const [cityTotal, setCityTotal] = useState<number | null>(null)
  const [order, setOrder] = useStickyState<'dense' | 'light'>('competitors.order', 'dense')
  const [view, setView] = useStickyState<'districts' | 'brands'>('competitors.view', 'districts')
  const [brands, setBrands] = useState<Brands | null>(null)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [profile, setProfile] = useState<Profile | null | 'error'>(null)

  useEffect(() => {
    if (!brand) return
    let live = true
    setProfile(null)
    postMarket<Profile>('brand-profile', { city, keys: brand.keys })
      .then((data) => { if (live) setProfile(data) })
      .catch(() => { if (live) setProfile('error') })
    return () => { live = false }
  }, [city, brand])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    setCounts(null)
    postMarket<{ summary?: { main_activities?: Activity[] } }>('market-summary', { city })
      .then((payload) => setActivities(payload.summary?.main_activities ?? []))
      .catch(() => setActivities([]))
  }, [city])

  useEffect(() => {
    if (!studied) return
    let live = true
    setStatus('loading')
    setBrand(null)
    onActivity(studied.q ?? studied.label)
    const activity = { city, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) }
    Promise.all([
      postMarket<{ districts?: Count[]; total?: number }>('district-counts', activity),
      // chains are a second reading of the same businesses; the districts still show when they are unavailable
      postMarket<Brands>('brands', { ...activity, limit: 50 }).catch(() => null),
    ])
      .then(([data, chains]) => { if (live) { setCounts(data.districts ?? []); setCityTotal(typeof data.total === 'number' ? data.total : null); setBrands(chains); setStatus('idle') } })
      .catch(() => { if (live) setStatus('error') })
    return () => { live = false }
  }, [city, studied, onActivity])

  const areas = useMemo(() => new Map(features.map((feature) => [String(feature.properties.id), areaKm2(feature.geometry)])), [features])

  const table = useMemo<Row[]>(() => {
    if (!counts) return []
    const byName = new Map(counts.map((count) => [count.district_ar, count.n]))
    return rows.flatMap((row) => {
      const area = areas.get(row.id) ?? 0
      if (area <= 0) return []
      const competitors = byName.get(row.name) ?? 0
      return [{ row, competitors, areaKm2: area, perKm2: competitors / area, residentsPer: residentsPer(row.population, competitors) }]
    })
  }, [counts, rows, areas])

  useEffect(() => {
    if (brand) {
      // one chain: its branches per district, in the same heat scale
      const ids = new Map(rows.map((row) => [row.name, row.id]))
      const counts = brand.by_district.map((item) => item.n).sort((a, b) => a - b)
      const colors = new Map<string, string>()
      for (const item of brand.by_district) {
        const id = ids.get(item.district_ar)
        if (!id) continue
        let below = 0
        while (below < counts.length && counts[below] < item.n) below++
        colors.set(id, HEAT[Math.min(4, Math.floor((5 * below) / counts.length))])
      }
      onOverlay({ colors })
      return
    }
    if (!table.length) { onOverlay({}); return }
    const dense = table.filter((item) => item.competitors > 0).map((item) => item.perKm2).sort((a, b) => a - b)
    const colors = new Map<string, string>()
    for (const item of table) {
      if (!item.competitors) { colors.set(item.row.id, NONE); continue }
      let below = 0
      while (below < dense.length && dense[below] < item.perKm2) below++
      colors.set(item.row.id, HEAT[Math.min(4, Math.floor((5 * below) / dense.length))])
    }
    onOverlay({ colors })
  }, [table, brand, rows, onOverlay])

  const located = counts ? counts.reduce((sum, count) => sum + count.n, 0) : null
  const ranked = [...table].filter((item) => order === 'dense' ? item.competitors > 0 : item.row.population != null)
    .sort((a, b) => (order === 'dense' ? b.perKm2 - a.perKm2 : a.perKm2 - b.perKm2 || (b.row.population ?? 0) - (a.row.population ?? 0)))
  const study = (next: StudiedActivity) => setStudied(next)
  const pickBrand = (next: Brand | null) => {
    setBrand(next)
    // a district picked while a chain is open lists that chain's branches there
    onActivity(next ? next.brand : studied ? studied.q ?? studied.label : null)
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">المنافسون</h2>
      <div className="flex gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && query.trim()) study({ q: query.trim(), label: query.trim() }) }}
          placeholder="اكتب نشاطك: صيدلية، مقهى…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
        <button onClick={() => query.trim() && study({ q: query.trim(), label: query.trim() })} disabled={status === 'loading'}
          className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' ? <Loader2 className="size-5 animate-spin" aria-label="جارٍ الحساب" /> : 'ادرس'}
        </button>
      </div>
      <select value={studied?.main_id ?? ''} onChange={(event) => { const item = activities.find((a) => a.main_id === event.target.value); if (item) { setQuery(''); study({ main_id: item.main_id, label: item.main_ar }) } }}
        className="h-11 rounded-lg border bg-background px-3 text-base">
        <option value="">أو اختر نشاطاً رئيسياً</option>
        {activities.map((item) => <option key={item.main_id} value={item.main_id}>{item.main_ar}</option>)}
      </select>
      <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button key={example} onClick={() => { setQuery(example); study({ q: example, label: example }) }} className="inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-3 text-sm hover:border-primary hover:text-primary"><Icon3D activity={example} />{example}</button>
          ))}
        </div>
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر الحساب.</p>}
      {studied && counts && status !== 'loading' && (
        <>
          <Explained title="المنافسون في المدينة" lines={EXPLAIN.competitors} className="text-base">
            {cityTotal == null ? <>عدد منشآت «{studied.label}» في المدينة غير متاح</> : <><strong>{numberFormat.format(cityTotal)}</strong> منشأة «{studied.label}» في المدينة</>}
            {located != null && cityTotal != null && located < cityTotal && <span className="text-muted-foreground"> · {numberFormat.format(located)} منها بحي معروف</span>}
          </Explained>
          <div className="flex gap-1.5" role="tablist" aria-label="طريقة العرض">
            {([['districts', 'الأحياء'], ['brands', 'السلاسل']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={view === id} onClick={() => { setView(id); if (id === 'districts') pickBrand(null) }}
                className={cn('flex-1 rounded-lg border py-2 text-base font-semibold', view === id ? 'border-primary text-primary' : 'hover:border-primary')}>{label}</button>
            ))}
          </div>
          {view === 'districts' && (
            <>
            <MapLegend from="منافسة قليلة" to="منافسة كثيفة" shades={HEAT} extra={{ color: NONE, label: 'لا منافس' }} />
            <div className="flex gap-1.5" role="group" aria-label="ترتيب الأحياء">
              {([['dense', 'الأكثر تنافساً'], ['light', 'الأقل تنافساً']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setOrder(id)} aria-pressed={order === id}
                  className={cn('flex-1 rounded-lg border py-2 text-sm', order === id ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>{label}</button>
              ))}
            </div>
            <ol className="max-h-[45vh] divide-y overflow-y-auto text-base">
              {ranked.slice(0, 30).map((item) => (
                <li key={item.row.id}>
                  <button onClick={() => onSelect(item.row.id)} className="flex w-full items-center gap-2 py-2 text-start hover:text-primary">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.row.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {item.residentsPer != null ? `ساكن لكل منافس: ${numberFormat.format(Math.round(item.residentsPer))}` : item.competitors ? 'السكان غير متاح' : 'لا منافس في الحي'}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block font-bold">{numberFormat.format(item.competitors)}</span>
                      <span className="block text-sm text-muted-foreground">{numberFormat.format(Math.round(item.perKm2 * 10) / 10)} لكل كم²</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            </>
          )}
          {view === 'brands' && !brands && <p className="text-base text-muted-foreground">السلاسل غير متاحة لهذا النشاط الآن.</p>}
          {view === 'brands' && brands && !brand && (
            <>
              <Explained title="السلاسل" lines={EXPLAIN.brands(brands.total, brands.in_chains)} className="text-base">
                <strong>{numberFormat.format(brands.chains)}</strong> سلسلة تملك {numberFormat.format(brands.in_chains)} من {numberFormat.format(brands.total)} منشأة
                {brands.total ? ` (${percent(Math.round((100 * brands.in_chains) / brands.total))})` : ''}
              </Explained>
              {brands.brands.length === 0 && <p className="text-base text-muted-foreground">لا توجد سلسلة بثلاثة فروع أو أكثر لهذا النشاط؛ السوق كله محلات مستقلة.</p>}
              <ol className="max-h-[45vh] divide-y overflow-y-auto text-base">
                {brands.brands.map((item, index) => (
                  <li key={item.brand}>
                    <button onClick={() => pickBrand(item)} className="flex w-full items-center gap-2 py-2 text-start hover:text-primary">
                      <span className="w-6 shrink-0 text-sm text-muted-foreground">{numberFormat.format(index + 1)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.brand}</span>
                        <span className="block text-sm text-muted-foreground">في {numberFormat.format(item.districts)} حياً{growthLine(item.growth) ? ` · ${growthLine(item.growth)}` : ''}</span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block font-bold">{numberFormat.format(item.branches)} فرعاً</span>
                        <span className="block text-sm text-muted-foreground">{item.share_pct == null ? 'غير متاح' : `${percent(item.share_pct)} من السوق`}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {brands.uncovered && brands.uncovered.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-xl border p-3">
                  <Explained title="أين لم تصل السلاسل" lines={EXPLAIN.uncovered(brands.uncovered_by ?? [])} className="font-semibold">
                    أحياء مأهولة لم تصلها أكبر {numberFormat.format(brands.uncovered_by?.length ?? 0)} سلاسل
                  </Explained>
                  <ol className="max-h-[30vh] divide-y overflow-y-auto text-base">
                    {brands.uncovered.map((item) => {
                      const id = rows.find((row) => row.name === item.district_ar)?.id
                      return (
                        <li key={item.district_ar}>
                          <button disabled={!id} onClick={() => id && onSelect(id)} className="flex w-full items-center justify-between gap-2 py-2 text-start hover:text-primary disabled:hover:text-inherit">
                            <span className="min-w-0 flex-1 truncate">{item.district_ar}</span>
                            <span className="shrink-0 text-end text-sm text-muted-foreground">{numberFormat.format(item.population)} ساكن · {numberFormat.format(item.businesses)} منشأة من النشاط</span>
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )}
            </>
          )}
          {view === 'brands' && brand && (
            <>
              <button onClick={() => pickBrand(null)} className="self-start text-sm font-semibold text-primary underline">كل السلاسل</button>
              <p className="text-base"><strong>{brand.brand}</strong>: {numberFormat.format(brand.branches)} فرعاً في {numberFormat.format(brand.districts)} حياً لهذا النشاط</p>
              <Explained title="توسّع السلسلة" lines={EXPLAIN.chainGrowth} className="self-start text-sm">
                التوسّع: {growthLine(brand.growth) ?? 'غير متاح'}
              </Explained>
              {profile === null && <Loader2 className="size-5 animate-spin" aria-label="جارٍ التحميل" />}
              {profile === 'error' && <p className="text-sm text-muted-foreground">بقية فروع السلسلة غير متاحة الآن.</p>}
              {profile && profile !== 'error' && (
                <div className="flex flex-col gap-1 rounded-xl border p-3 text-base">
                  <p>في المدينة كلها: <strong>{numberFormat.format(profile.branches)}</strong> فرعاً في {numberFormat.format(profile.districts)} حياً</p>
                  {/* a chain is one business with one activity; branches the directory files elsewhere are named, not spread over activities */}
                  <p>النشاط: <strong>{profile.activity?.main_ar ?? 'غير متاح'}</strong></p>
                  {profile.activity && profile.activity.classified > profile.activity.agree && (
                    <Explained title="فروع بتصنيف آخر في الدليل" lines={EXPLAIN.chainActivity(profile.activity.main_ar, profile.activities.filter((item) => item.main_ar !== profile.activity?.main_ar))} className="self-start text-sm text-muted-foreground">
                      {numberFormat.format(profile.activity.classified - profile.activity.agree)} من فروعها مصنفة في الدليل تحت نشاط آخر
                    </Explained>
                  )}
                </div>
              )}
              <button onClick={() => onAllBranches(brand.brand)} className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground">
                طلب تسعير أو حملة لكل الفروع
              </button>
              <MapLegend from="فرع واحد" to="فروع أكثر" shades={HEAT} />
              <ol className="max-h-[40vh] divide-y overflow-y-auto text-base">
                {brand.by_district.map((item) => {
                  const id = rows.find((row) => row.name === item.district_ar)?.id
                  return (
                    <li key={item.district_ar}>
                      <button disabled={!id} onClick={() => id && onSelect(id)} className="flex w-full justify-between py-2 text-start hover:text-primary disabled:hover:text-inherit">
                        <span>{item.district_ar}</span><span className="font-semibold">{numberFormat.format(item.n)}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
          <p className="text-sm text-muted-foreground">{brand ? `اضغط على حي لترى فروع ${brand.brand} فيه.` : 'اضغط على حي لترى منافسيه بالاسم.'}</p>
        </>
      )}
    </section>
  )
}
