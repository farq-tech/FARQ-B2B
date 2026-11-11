'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { NoResult, NotAvailable } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { Explained } from '@/components/shared/explained'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'
import { EXPLAIN } from '@/lib/explanations'
import { counted, ltr, nounAfter, numberFormat, percent, postMarket } from '@/lib/insights-api'
import type { DistrictRow } from '../city-data'
import { waiting, type Overlay } from './overlay'
import { OCHRE_STEPS, PALETTE } from '@/lib/palette'
import { stickyHas, useStickyState, useStudiedActivity, type StudiedActivity } from '@/lib/sticky-state'
import { Understood, type Understanding } from '@/components/shared/understood'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import { ActivityCompare } from './activity-compare'
import { areaLine, aroundOf, brandsVerdict, competitorsSummary, competitorsVerdict, densestDistrict, rankCompetition, rankLightAround, THIN, type AroundArea } from './tool-answers'
import { Examples } from './examples'
import { distanceKm, neighbourMap, outlineCentre } from '@/lib/geo-measure'
import type { DistrictFeature } from '@/lib/insights-api'
import { Verdict } from './verdict'
import { useMainActivities } from '@/lib/main-activities'
import { useAnswer } from './use-answer'
import { Choice } from './choice'

// per_km2 (businesses ÷ km²) and residents_per (residents ÷ businesses) come ready from the service for the activity's
// counts; a brand's by_district carries only n
type Count = { district_ar: string; n: number; per_km2?: number | null; residents_per?: number | null }
type Growth = { since: string | null; before: number; now: number } | null
type Brand = { brand: string; keys: string[]; branches: number; districts: number; share_pct: number | null; by_district: Count[]; growth: Growth }
type Uncovered = { district_ar: string; population: number; businesses: number }
type Brands = { total: number; chains: number; in_chains: number; brands: Brand[]; uncovered?: Uncovered[]; uncovered_by?: string[] }
type Profile = { branches: number; districts: number; activity: { main_ar: string; classified: number; agree: number } | null; activities: { main_ar: string; n: number }[] }

/** «+5 فروع», or null until the service has a long enough directory history (market_analytics.chain_growth). */
function growthLine(growth: Growth): string | null {
  if (!growth) return null
  const change = growth.now - growth.before
  return change === 0 ? 'بلا تغيير' : `${ltr(`${change > 0 ? '+' : '−'}${numberFormat.format(Math.abs(change))}`)} ${nounAfter(change, 'branch')}`
}
type Row = { row: DistrictRow; competitors: number; perKm2: number | null; residentsPer: number | null; area?: AroundArea | null }

const EXAMPLES = ['صيدلية', 'مغسلة ملابس', 'بقالة', 'مطعم', 'صالون حلاقة', 'مقهى']
// competition reads as heat: pale for few competitors per km², deep amber for many
const HEAT = OCHRE_STEPS
const NONE = PALETTE.sage   // no competitor of this activity in the district

/**
 * «المنافسون»: for one activity, how many businesses already serve each district, per km² and per resident. The map
 * shows where competition is dense; a district picked from the list opens its competitors by name.
 */
export function CompetitorsTool({ city, rows, onOverlay, onSelect, onActivity, onAllBranches, onHover, next, features = [] }: {
  city: string
  rows: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
  /** The activity being studied, so the competitors of a picked district can be listed by name. */
  onActivity: (activity: string | null) => void
  /** Opens every branch of a chain across the city, for a quote request or campaign to all of them. */
  onAllBranches: (brand: string) => void
  /** The district a row points at (pointer or keyboard), outlined on the map; null when it leaves. */
  onHover?: (id: string | null) => void
  /** The step after the answer (a request, a site comparison), under the verdict; given by the map shell. */
  next?: ReactNode
  /** The city's district outlines, for the top district's neighbours (no competitor inside, many next door). */
  features?: DistrictFeature[]
}) {
  const activities = useMainActivities(city)
  // the map opens painted with the activity studied in any step; any other activity replaces it
  const [studied, setStudied] = useStudiedActivity()
  // nothing is counted until the customer names an activity (here, in another step, or by a link): the default
  // nobody picked is never computed, and never named in the list or the map's key
  const chosen = stickyHas('activity')
  const [query, setQuery] = useState(chosen ? studied.q ?? '' : '')
  // a shop owner looks for where competition is light first; the choice is kept once made
  const [order, setOrder] = useStickyState<'dense' | 'light'>('competitors.order', 'light')
  const [view, setView] = useStickyState<'districts' | 'brands'>('competitors.view', 'districts')
  const [brand, setBrand] = useState<Brand | null>(null)

  // the activity's districts and chains, keyed by its q or main_id: a new activity drops the last one's answer at once,
  // so the map clears instead of shading districts for a different query
  const studiedKey = `${city}|${studied.q ?? ''}|${studied.main_id ?? ''}`
  const answer = useAnswer(chosen ? studiedKey : null, () => {
    const activity = { city, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) }
    return Promise.all([
      postMarket<{ districts?: Count[]; total?: number; located?: number; understood?: Understanding }>('district-counts', activity),
      // chains are a second reading of the same businesses; the districts still show when they are unavailable
      postMarket<Brands>('brands', { ...activity, limit: 50 }).catch(() => null),
    ]).then(([data, chains]) => ({
      counts: data.districts ?? [],
      // the city's count from the service, which includes businesses with no reliable district
      cityTotal: typeof data.total === 'number' ? data.total : null,
      // businesses that fell in a known district (Σ n), summed once in the service
      located: typeof data.located === 'number' ? data.located : null,
      understood: data.understood ?? null,
      brands: chains,
    }))
  // kept for the visit by city and activity, unless the chains failed (then asked again next time)
  }, { cache: 'competitors', keep: (data) => data.brands != null })
  const counts = answer.data?.counts ?? null
  const cityTotal = answer.data?.cityTotal ?? null
  const located = answer.data?.located ?? null
  const understood: Understanding = answer.data?.understood ?? null
  const brands = answer.data?.brands ?? null
  const status = answer.status === 'loading' ? 'loading' : answer.status === 'error' ? 'error' : 'idle'
  useEffect(() => {
    setBrand(null)
    onActivity(chosen ? studied.q ?? studied.label : null)
    // once per activity asked, not per object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studiedKey, chosen, onActivity])

  // one chain's spread across the city, keyed by the chain's name
  const profileAnswer = useAnswer(brand ? `${city}|${brand.brand}` : null, () => postMarket<Profile>('brand-profile', { city, keys: brand!.keys }))
  const profile: Profile | null | 'error' = profileAnswer.status === 'error' ? 'error' : profileAnswer.data

  const table = useMemo<Row[]>(() => {
    if (!counts) return []
    const byName = new Map(counts.map((count) => [count.district_ar, count]))
    return rows.map((row) => {
      const count = byName.get(row.name)
      return { row, competitors: count?.n ?? 0, perKm2: count?.per_km2 ?? null, residentsPer: count?.residents_per ?? null }
    })
  }, [counts, rows])

  // the districts' neighbours by outline, once per city: the lightest competition counts them (rankLightAround)
  const neighbours = useMemo(() => (features.length ? neighbourMap(features.map((feature) => ({ id: String(feature.properties.id), geometry: feature.geometry }))) : null), [features])
  // sorted once per answer and order, not on every render (a hover or a show-more re-renders the whole tool)
  // each district's centre, so a neighbour far across a long edge counts less than one next door
  const centres = useMemo(() => new Map(features.map((feature) => [String(feature.properties.id), outlineCentre(feature.geometry)])), [features])
  const ranked = useMemo<Row[]>(() => (order === 'light'
    ? rankLightAround(table, neighbours, (a, b) => { const p = centres.get(a); const q = centres.get(b); return p && q ? distanceKm(p, q) : null })
    : rankCompetition(table, order)), [table, order, neighbours, centres])

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
      const most = brand.by_district.reduce<Count | null>((top, item) => (!top || item.n > top.n ? item : top), null)
      // a district without a branch of the chain is not in its list: the card says «غير متاح» rather than a zero
      const facts = new Map(brand.by_district.flatMap((item) => { const id = ids.get(item.district_ar); return id ? [[id, `${counted(item.n, 'branch')} لـ${brand.brand}`] as [string, string]] : [] }))
      onOverlay({ colors, facts, lead: most ? ids.get(most.district_ar) ?? null : null, legend: { from: 'فرع واحد', to: 'فروع أكثر', shades: HEAT }, summary: `${brand.brand}: ${counted(brand.branches, 'branch')} في ${counted(brand.districts, 'district')}` })
      return
    }
    if (!table.length) { onOverlay(waiting(answer)); return }
    // the city's count as the service gives it, and the district where the activity is densest per km²
    // the district the verdict names for the chosen order: the densest, or the lightest populated one
    const top = order === 'light' ? ranked[0] ?? null : densestDistrict(table)
    const summary = competitorsSummary(cityTotal, studied.label, top, order)
    const dense = table.flatMap((item) => (item.competitors > 0 && item.perKm2 != null ? [item.perKm2] : [])).sort((a, b) => a - b)
    const colors = new Map<string, string>()
    for (const item of table) {
      if (!item.competitors || item.perKm2 == null) { colors.set(item.row.id, NONE); continue }
      let below = 0
      while (below < dense.length && dense[below] < item.perKm2) below++
      colors.set(item.row.id, HEAT[Math.min(4, Math.floor((5 * below) / Math.max(1, dense.length)))])
    }
    // the same count the district's colour and the list read (a district the service lists no business in is «لا منافس»)
    const facts = new Map(table.map((item) => [item.row.id, item.competitors ? `${counted(item.competitors, 'business')} من «${studied.label}»` : 'لا منافس'] as [string, string]))
    // «أرني الأعلى» opens the district the summary names
    // the chains are a second reading of the same businesses: an answer without them is said partial in the journey
    onOverlay({ colors, facts, summary, lead: top?.row.id ?? null, partial: brands == null ? 'السلاسل' : null, legend: { from: 'منافسة قليلة', to: 'منافسة كثيفة', shades: HEAT, extra: { color: NONE, label: 'لا منافس' } } })
    // answer.retry is stable; status and slow are what the no-answer overlay says
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, brand, rows, onOverlay, cityTotal, studied.label, order, answer.status, answer.slow, ranked, brands])

  // the service counted the activity and found none: a city total of 0, or no district and no total
  const noneFound = counts != null && (cityTotal === 0 || (cityTotal == null && counts.length === 0))
  const idByName = useMemo(() => new Map(rows.map((row) => [row.name, row.id])), [rows])
  const hover = (id: string | undefined) => (on: boolean) => onHover?.(on && id ? id : null)
  // a shortlist first: the verdict names the top district, the rest are one tap away
  const [limit, showMore] = useShowMore(10, `${city}|${studied.q ?? studied.main_id}|${order}`)
  // the top district's neighbours by outline and the competitors they hold, from the same counts as the list
  const verdict = useMemo(() => {
    const top = ranked[0]
    const byId = new Map(table.map((item) => [item.row.id, item]))
    const around = top ? aroundOf(top.row.id, neighbours, (id) => { const item = byId.get(id); return item ? { name: item.row.name, n: item.competitors } : null }) : null
    return competitorsVerdict(ranked, order, studied.label, cityTotal, located, around)
  }, [ranked, order, studied.label, cityTotal, located, table, neighbours])
  // the two lists whose length is the service's: districts no chain reaches, and one chain's districts
  const [uncoveredLimit, showMoreUncovered] = useShowMore(15, `${city}|${studied.q ?? studied.main_id}`)
  const [branchLimit, showMoreBranches] = useShowMore(20, `${city}|${brand?.brand ?? ''}`)
  const study = (next: StudiedActivity) => setStudied(next)
  const pickBrand = (next: Brand | null) => {
    setBrand(next)
    // a district picked while a chain is open lists that chain's branches there
    onActivity(next ? next.brand : studied ? studied.q ?? studied.label : null)
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold max-lg:-order-2">المنافسون</h2>
      <form role="search" className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (query.trim()) study({ q: query.trim(), label: query.trim() }) }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="نشاطك" enterKeyHint="search"
          placeholder="اكتب نشاطك: صيدلية، مقهى…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
        <button type="submit" disabled={status === 'loading'}
          className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' ? <Loader2 className="size-5 animate-spin" aria-label="جارٍ الحساب" /> : 'ادرس'}
        </button>
      </form>
      <MainActivityPicker activities={activities} value={studied.main_id ?? ''} placeholder="أو اختر نشاطاً رئيسياً"
        onChange={(id) => { const item = activities.find((a) => a.main_id === id); if (item) { setQuery(''); study({ main_id: item.main_id, label: item.main_ar }) } }} />
      <Examples examples={EXAMPLES} active={chosen ? studied.q ?? null : null} collapse={chosen && verdict != null && !noneFound} onPick={(example) => { setQuery(example); study({ q: example, label: example }) }} />
      {!chosen && <p className="text-base text-muted-foreground">اختر نشاطك لترى منافسيك في كل حي.</p>}
      {status === 'error' && <LoadError what={`منشآت «${studied.label}»`} onRetry={answer.retry} />}
      {status === 'loading' && (
        <>
          <Skeleton className="h-5 w-3/4" aria-hidden />
          <div className="flex gap-1.5" aria-hidden><Skeleton className="h-10 flex-1 rounded-lg" /><Skeleton className="h-10 flex-1 rounded-lg" /></div>
          <ResultRowsSkeleton label="جارٍ الحساب" rows={6} sub valueSub />
        </>
      )}
      {status !== 'loading' && chosen && studied.q && <Understood value={understood} />}
      {/* asked, and the city has none of it: said once, with what to try, instead of a list of empty districts */}
      {studied && counts && status !== 'loading' && noneFound && (
        <NoResult title={`لا منشأة «${studied.label}» في المدينة`} body="جرّب اسماً آخر للنشاط، أو اختر نشاطاً رئيسياً من القائمة." />
      )}
      {studied && counts && status !== 'loading' && !noneFound && (
        <>
          {/* one span: the trigger is a flex box, and loose parts became three side-by-side columns that wrapped apart */}
          <Explained title="المنافسون في المدينة" lines={EXPLAIN.competitors} className="text-base">
            <span>
              {cityTotal == null ? <>عدد منشآت «{studied.label}» في المدينة غير متاح</> : <><strong>{numberFormat.format(cityTotal)}</strong> منشأة «{studied.label}» في المدينة</>}
              {located != null && cityTotal != null && located < cityTotal && <span className="text-muted-foreground"> · {numberFormat.format(located)} منها بحي معروف</span>}
            </span>
          </Explained>
          {/* two views of one result, switched in place: pressed buttons, not tabs (there is no tab panel to move to) */}
          <Choice label="طريقة العرض" variant="outline" size="base" value={view} onChange={(id) => { setView(id); if (id === 'districts') pickBrand(null) }}
            options={[{ id: 'districts', label: 'الأحياء' }, { id: 'brands', label: 'السلاسل' }]} />
          {view === 'districts' && (
            <>
            {/* the question first (where is it lightest, or densest), then its answer, then the districts behind it */}
            <Choice label="ترتيب الأحياء" value={order} onChange={setOrder} options={[{ id: 'light', label: 'أين المنافسة أخف؟' }, { id: 'dense', label: 'أين أشدها؟' }]} />
            <Verdict lift verdict={verdict} next={next} />
            <ol className="divide-y text-base lg:max-h-[45vh] lg:overflow-y-auto">
              {ranked.slice(0, limit).map((item) => (
                <ResultRow key={item.row.id} onClick={() => onSelect(item.row.id)} onHover={hover(item.row.id)} title={item.row.name}
                  sub={[
                    item.residentsPer != null ? `ساكن لكل منافس: ${numberFormat.format(Math.round(item.residentsPer))}` : item.competitors ? 'السكان غير متاح' : 'لا منافس في الحي',
                    // the light order ranks by the district with its neighbours: the row says what that is
                    order === 'light' ? areaLine(item.area ?? null) : null,
                    item.row.settledPct != null && item.row.settledPct < THIN.sparse ? (item.row.settledPct < 1 ? 'غير مأهول تقريباً' : `مأهول في ${numberFormat.format(item.row.settledPct)}% من مساحته`) : null,
                  ].filter(Boolean).join(' · ')}
                  value={counted(item.competitors, 'business')}
                  // a district with none has no density to show, and its area is not what is missing
                  valueSub={item.perKm2 != null ? `${numberFormat.format(Math.round(item.perKm2 * 10) / 10)} لكل كم²` : item.competitors ? 'المساحة غير متاحة' : undefined} />
              ))}
            </ol>
            <MoreRows shown={Math.min(limit, ranked.length)} total={ranked.length} noun="district" onMore={showMore} />
            <ActivityCompare city={city} rows={rows} activities={activities} first={studied} firstCounts={counts} firstTotal={cityTotal} onSelect={onSelect} onHover={onHover} />
            </>
          )}
          {view === 'brands' && !brands && <NotAvailable what="السلاسل" where={`«${studied.label}»`} body="الأحياء وعدد المنافسين فيها متاحة من «الأحياء»." />}
          {view === 'brands' && brands && !brand && (
            <>
              <Verdict lift verdict={brandsVerdict(brands)} />
              <Explained title="السلاسل" lines={EXPLAIN.brands(brands.total, brands.in_chains)} className="text-base">
                <span>
                  <strong>{counted(brands.chains, 'chain')}</strong> {brands.chains === 1 ? 'تملك' : 'تملك معاً'} {numberFormat.format(brands.in_chains)} من {numberFormat.format(brands.total)} منشأة
                  {brands.total ? ` (${percent(Math.round((100 * brands.in_chains) / brands.total))})` : ''}
                </span>
              </Explained>
              {brands.brands.length === 0 && <NoResult title="لا سلسلة لهذا النشاط" body="السلسلة ثلاثة فروع أو أكثر، والسوق هنا كله محلات مستقلة. اعرض «الأحياء» بدلاً منها." />}
              <ol className="divide-y text-base lg:max-h-[45vh] lg:overflow-y-auto">
                {brands.brands.map((item, index) => (
                  <ResultRow key={item.brand} onClick={() => pickBrand(item)} title={item.brand}
                    leading={<span className="w-6 shrink-0 text-sm text-muted-foreground">{numberFormat.format(index + 1)}</span>}
                    sub={`في ${counted(item.districts, 'district')}${growthLine(item.growth) ? ` · ${growthLine(item.growth)}` : ''}`}
                    value={counted(item.branches, 'branch')}
                    valueSub={item.share_pct == null ? 'غير متاح' : `${percent(item.share_pct)} من السوق`} />
                ))}
              </ol>
              {brands.uncovered && brands.uncovered.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-xl border p-3">
                  <Explained title="أين لم تصل السلاسل" lines={EXPLAIN.uncovered(brands.uncovered_by ?? [])} className="font-semibold">
                    أحياء مأهولة لم تصلها {(brands.uncovered_by?.length ?? 0) === 1 ? 'أكبر سلسلة' : (brands.uncovered_by?.length ?? 0) === 2 ? 'أكبر سلسلتين' : `أكبر ${counted(brands.uncovered_by?.length ?? 0, 'chain')}`}
                  </Explained>
                  <ol className="divide-y text-base lg:max-h-[30vh] lg:overflow-y-auto">
                    {brands.uncovered.slice(0, uncoveredLimit).map((item) => {
                      const id = idByName.get(item.district_ar)
                      return (
                        <ResultRow key={item.district_ar} disabled={!id} onClick={() => id && onSelect(id)} onHover={hover(id)} title={item.district_ar}
                          valueSub={`${numberFormat.format(item.population)} ساكن · ${numberFormat.format(item.businesses)} منشأة من النشاط`} />
                      )
                    })}
                  </ol>
                  <MoreRows shown={Math.min(uncoveredLimit, brands.uncovered.length)} total={brands.uncovered.length} noun="district" onMore={showMoreUncovered} />
                </div>
              )}
            </>
          )}
          {view === 'brands' && brand && (
            <>
              <button onClick={() => pickBrand(null)} className="self-start text-sm font-semibold text-primary underline">كل السلاسل</button>
              <p className="text-base"><strong>{brand.brand}</strong>: {counted(brand.branches, 'branch')} في {counted(brand.districts, 'district')} لهذا النشاط</p>
              <Explained title="توسّع السلسلة" lines={EXPLAIN.chainGrowth} className="self-start text-sm">
                التوسّع: {growthLine(brand.growth) ?? 'غير متاح'}
              </Explained>
              {profile === null && (
                <SkeletonStatus className="flex flex-col gap-2 rounded-xl border p-3">
                  <Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-1/2" />
                </SkeletonStatus>
              )}
              {profile === 'error' && <p className="text-sm text-muted-foreground">بقية فروع السلسلة غير متاحة الآن.</p>}
              {profile && profile !== 'error' && (
                <div className="flex flex-col gap-1 rounded-xl border p-3 text-base">
                  <p>في المدينة كلها: <strong>{counted(profile.branches, 'branch')}</strong> في {counted(profile.districts, 'district')}</p>
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
              <ol className="divide-y text-base lg:max-h-[40vh] lg:overflow-y-auto">
                {brand.by_district.slice(0, branchLimit).map((item) => {
                  const id = idByName.get(item.district_ar)
                  return <ResultRow key={item.district_ar} disabled={!id} onClick={() => id && onSelect(id)} onHover={hover(id)} title={item.district_ar} value={numberFormat.format(item.n)} />
                })}
              </ol>
              <MoreRows shown={Math.min(branchLimit, brand.by_district.length)} total={brand.by_district.length} noun="district" onMore={showMoreBranches} />
            </>
          )}
          <p className="text-sm text-muted-foreground">{brand ? `اضغط على حي لترى فروع ${brand.brand} فيه.` : 'اضغط على حي لترى منافسيه بالاسم.'}</p>
        </>
      )}
    </section>
  )
}
