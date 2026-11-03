'use client'

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMainActivities } from '@/lib/main-activities'
import { Explained } from '@/components/shared/explained'
import { LoadError } from '@/components/shared/load-error'
import { NoResult } from '@/components/shared/empty-state'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket } from '@/lib/insights-api'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import { waiting, type Overlay } from './overlay'
import { gapsHoverLine, gapsSummary, hiddenCaveatsLine, isShortRow } from './gaps-summary'
import { PALETTE } from '@/lib/palette'
import { stickyHas, useStudiedActivity } from '@/lib/sticky-state'
import { Understood, type Understanding } from '@/components/shared/understood'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'
import { useAnswer } from './use-answer'
import { aroundOf, caveatTag, gapsVerdict, populationKind, rankGapsAround } from './tool-answers'
import { Examples } from './examples'
import { neighbourMap } from '@/lib/geo-measure'
import type { DistrictFeature } from '@/lib/insights-api'
import { Verdict } from './verdict'

/** caveat: the service marks a district that is industrial by its atlas name, or labour housing (nine in ten residents
 * men, measured), and lists it after the residential ones; null or absent is an ordinary district. */
type Gap = { district_ar: string; population: number; businesses: number; expected_businesses: number | null; shortfall: number | null; male_pct?: number | null; caveat?: 'industrial' | 'workers' | 'estimated' | 'campus' | null; population_coverage_pct?: number | null }
/** `population_model_fits` is false when the activity's count does not track population here (wholesale,
 * industrial, B2B, destinations): there is no honest city rate, so `residents_per_business` and every row's
 * `expected_businesses`/`shortfall` are null, and the districts are listed by their real counts only. `fit`
 * (R²) and `covered_districts` say how that was measured, so the decision is auditable. */
type Result = { residents_per_business: number | null; population_model_fits?: boolean; population_model_reason?: 'too_few_districts' | 'weak_relationship'; fit?: number | null; covered_districts?: number; message?: string; districts: Gap[]; understood?: Understanding }

const EXAMPLES = ['صيدلية', 'مغسلة ملابس', 'بقالة', 'مطعم', 'صالون حلاقة', 'مخبز']
const SURPLUS = PALETTE.pebble   // more businesses than the city rate carries
// districts with fewer residents are left out of the answer (a few people make any count look short or full)
const MIN_POPULATION = 5000
/** Short by at least one whole business, as the row reads it («ناقص 1» or more): a shortfall under half a business
 * would read «ناقص 0», so it counts as sufficient on the map, in the list and in the peek line alike. */
const isShort = isShortRow

/** «أين ينقص نشاطي؟»: districts with fewer businesses of an activity than their people carry at the city's rate. */
export function GapsTool({ city, cityName, rows, features = [], onOverlay, onSelect, selected = [], onHover, next }: {
  city: string
  /** The city's Arabic name, for the line that says its districts have no population. */
  cityName?: string
  rows: DistrictRow[]
  /** The city's district outlines, for the top district's neighbours (a gap next to a surplus may be served from it). */
  features?: DistrictFeature[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
  /** The districts picked on the map or anywhere else: their rows are marked. */
  selected?: string[]
  /** The row under the pointer or keyboard focus, so the map can outline its district. */
  onHover?: (id: string | null) => void
  /** The step after the answer (a request, a price, the competitors), under the verdict; given by the map shell. */
  next?: ReactNode
}) {
  const activities = useMainActivities(city)
  // the activity is shared with the other steps, so «المنافسون» opens on the one picked here
  const [studied, setStudied] = useStudiedActivity()
  // nothing is worked out until an activity is chosen (here, in another step or by a shared link): the tool used to
  // run its default activity on arrival, alongside the page's first heavy requests, and timed out into «تعذر الحساب»
  const chosen = stickyHas('activity')
  const [query, setQuery] = useState(chosen ? studied.q ?? '' : '')
  // an activity set from elsewhere (a shared link, another step) shows in the box too
  useEffect(() => { if (stickyHas('activity')) setQuery(studied.q ?? '') }, [studied.q])
  // the map is painted with the chosen activity; any other activity replaces it, and its answer goes at once
  const answer = useAnswer<Result>(chosen ? `${city}|${studied.q ?? ''}|${studied.main_id ?? ''}` : null, () => {
    const body: Record<string, unknown> = { city, min_population: MIN_POPULATION, limit: 200, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) }
    // a shared link runs this while the page's first heavy requests still hold the service, and the proxy gives up
    // after 12 seconds: one quiet second try after a pause, then the error with «أعد المحاولة»
    const load = () => postMarket<Result>('market-gaps', body)
    return load().catch(() => new Promise<Result>((resolve, reject) => { setTimeout(() => { load().then(resolve, reject) }, 2000) }))
  // kept for the visit by city and activity: the half-minute answer is not asked twice (answer-cache.ts)
  }, { cache: 'gaps' })
  const result = answer.data
  const status = answer.status === 'loading' ? 'loading' : answer.status === 'error' ? 'error' : 'idle'

  const label = studied.label
  // a city none of whose districts has a population (most small cities today): no activity can be worked out there,
  // so the panel says why instead of «not enough data for this activity», which sent the visitor trying others
  const noPeople = rows.length > 0 && rows.every((row) => row.population == null)
  // the activity's count does not track population here (wholesale, industrial, B2B, destinations): no shortfall
  // is honest, so the map is not shaded by one. It keeps its own shading; a clicked district shows its real
  // directory count, and the summary says why no «ناقص» appears.
  const notPopulationDriven = result?.population_model_fits === false
  // the districts' neighbours by outline, once per city, and the top of the list reordered by each gap net of the
  // surplus next door (rankGapsAround): the verdict, the peek line and «أرني الأعلى» name the same district
  const neighbours = useMemo(() => (features.length ? neighbourMap(features.map((feature) => ({ id: String(feature.properties.id), geometry: feature.geometry }))) : null), [features])
  const gapRanked = useMemo(() => {
    if (!result || result.residents_per_business == null) return []
    const byName = new Map(result.districts.map((row) => [row.district_ar, row]))
    const nameOf = new Map(rows.map((row) => [row.id, row.name]))
    const idOf = new Map(rows.map((row) => [row.name, row.id]))
    return rankGapsAround(result.districts.filter((row) => isShort(row)), (row) => {
      const id = idOf.get(row.district_ar)
      return id ? aroundOf(id, neighbours, (other) => {
        const near = byName.get(nameOf.get(other) ?? '')
        return near && near.expected_businesses != null ? { name: near.district_ar, n: near.businesses - Math.round(near.expected_businesses) } : null
      }) : null
    })
  }, [result, rows, neighbours])
  useEffect(() => {
    // no answer yet: the request's own state (working, slow, failed), so the map says it instead of the step's ask
    if (!result) { onOverlay(waiting(answer)); return }
    if (notPopulationDriven) {
      const ids = new Map(rows.map((row) => [row.name, row.id]))
      const answered = new Map(result.districts.map((row) => [row.district_ar, row]))
      const facts = new Map<string, string>()
      const hover = new Map<string, string>()
      for (const [name, id] of ids) {
        const row = answered.get(name)
        const text = row ? (row.businesses > 0 ? `${numberFormat.format(row.businesses)} ${label}` : 'لا منشآت في الدليل') : 'غير متاح'
        facts.set(id, text)
        hover.set(id, text)
      }
      onOverlay({ summary: `«${label}»: لا يتبع عدد السكان هنا`, facts, hover })
      return
    }
    if (noPeople && result.residents_per_business == null) { onOverlay({ summary: 'سكان الأحياء غير متاحين هنا، فالنقص لا يُحسب' }); return }
    // no city rate, no shortfall anywhere: the map keeps its own shading instead of a blank city under «نقص …» while
    // the panel says there is not enough data
    if (result.residents_per_business == null) { onOverlay({ summary: `لا توجد بيانات كافية لـ«${label}»` }); return }
    const ids = new Map(rows.map((row) => [row.name, row.id]))
    const short = result.districts.filter((row) => isShort(row))
    const largest = Math.max(1, ...short.map((row) => row.shortfall ?? 0))
    const colors = new Map<string, string>()
    for (const row of result.districts) {
      const id = ids.get(row.district_ar)
      if (!id) continue
      colors.set(id, isShort(row) ? SHADES[Math.min(4, Math.floor((5 * (row.shortfall ?? 0)) / (largest + 1e-9)))] : SURPLUS)
    }
    const top = gapRanked[0] ?? short[0]
    const summary = gapsSummary(result, counted, gapRanked[0] ?? null)
    const answered = new Map(result.districts.map((row) => [row.district_ar, row]))
    const hover = new Map(rows.map((row) => [row.id, gapsHoverLine(answered.get(row.name), row.population, MIN_POPULATION, counted, numberFormat)]))
    // the card on a clicked district reads its row as the list does: «ناقص N» (needed at the city rate − present), or
    // «مكتفٍ» as the map colours it; a district the answer does not list stays out («غير متاح»)
    const facts = new Map<string, string>()
    for (const row of result.districts) {
      const id = ids.get(row.district_ar)
      if (id) facts.set(id, isShort(row) ? `ناقص ${numberFormat.format(Math.round(row.expected_businesses ?? 0) - row.businesses)} ${label}` : 'مكتفٍ')
    }
    onOverlay({ summary, hover, facts, lead: top ? ids.get(top.district_ar) ?? null : null, colors, legend: { title: `نقص «${label}» في الأحياء`, from: 'نقص قليل', to: 'نقص كبير', shades: SHADES, extra: { color: SURPLUS, label: 'مكتفٍ' } } })
    // answer.retry is stable; status and slow are what the no-answer overlay says
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, rows, onOverlay, label, noPeople, notPopulationDriven, answer.status, answer.slow, gapRanked])

  const study = (text: string) => { if (text) setStudied({ q: text, label: text }) }

  const ids = new Map(rows.map((row) => [row.name, row.id]))
  // the service lists industrial and labour-housing districts after the residential ones; kept in that order
  const gaps = result?.districts.filter((row) => isShort(row)) ?? []
  const firstCaveat = gaps.findIndex((row) => row.caveat)
  // the bar only scales each row's shortfall, as the API returned it, against the largest in the list
  const widest = Math.max(0, ...gaps.map((row) => row.shortfall ?? 0))
  // a shortlist first: the verdict names the top three, the next rows are one tap away
  const [limit, showMore] = useShowMore(10, `${city}|${label}`)
  // the top district's population kind (counted, from buildings, or a density grid), so a guessed population is said
  const first = gapRanked[0]
  const topSource = first ? rows.find((row) => row.name === first.district_ar)?.populationSource ?? null : null
  // the neighbours' surplus beside each top gap: the list keeps the service's order, the verdict the net one
  const verdict = result?.residents_per_business != null
    ? gapsVerdict(gapRanked, label, result.residents_per_business, populationKind(topSource), first?.around ?? null, Boolean(first && gaps[0] && first.district_ar !== gaps[0].district_ar))
    : null
  // the industrial and labour-housing districts come last, usually past the first rows shown: a line under the visible
  // rows counts them, and a click shows the list down to them
  const [reveal, setReveal] = useState(false)
  useEffect(() => { setReveal(false) }, [city, label])
  const shownRows = reveal ? gaps.length : limit
  const caveatsLine = firstCaveat >= shownRows ? hiddenCaveatsLine(gaps.length - firstCaveat, numberFormat, gaps.some((row) => row.caveat === 'estimated')) : null
  const showCaveats = () => {
    setReveal(true)
    window.setTimeout(() => document.getElementById('gaps-caveats')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold max-lg:-order-2">أين ينقص نشاطي؟</h2>
      {/* a search form like the other steps': a named field, the phone keyboard's «بحث» key, Enter submits */}
      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); study(query.trim()) }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="نشاطك" enterKeyHint="search"
          placeholder="اكتب نشاطك: صيدلية، مغسلة ملابس…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
        <button type="submit" disabled={status === 'loading'} className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' ? 'جارٍ الحساب' : 'احسب'}
        </button>
      </form>
      <MainActivityPicker activities={activities} value={studied.main_id ?? ''} placeholder="أو اختر نشاطاً رئيسياً"
        onChange={(id) => { const item = activities.find((a) => a.main_id === id); if (item) { setQuery(''); setStudied({ main_id: item.main_id, label: item.main_ar }) } }} />
      {/* the example being studied is marked, as in «المنافسون» and «شوارع النشاط»; once chosen they fold away */}
      <Examples examples={EXAMPLES} active={chosen ? studied.q ?? null : null} collapse={chosen && verdict != null} onPick={(example) => { setQuery(example); study(example) }} />
      {!chosen && status === 'idle' && <p className="text-base text-muted-foreground">اختر نشاطك لتظهر الأحياء الناقصة.</p>}
      {status === 'error' && (
        <LoadError what="النقص" title="تعذر حساب النقص الآن." detail="الخدمة مشغولة أو انقطع الاتصال. أعد المحاولة بعد لحظات."
          onRetry={answer.retry} />
      )}
      {/* the shape of the answer while it is worked out: district rows, each with its bar line */}
      {status === 'loading' && <ResultRowsSkeleton rows={5} sub label="جارٍ حساب النقص" />}
      {status !== 'loading' && chosen && studied.q && result && <Understood value={result.understood} />}
      {/* the activity's count is not population-driven here: «غير متاح» for the shortfall, and the districts by
          their real directory counts only — never a fabricated «+N» */}
      {status !== 'loading' && result && notPopulationDriven && (
        <>
          <div role="status" className="flex flex-col gap-1 rounded-xl bg-muted/40 p-3 text-base">
            <p className="font-semibold">نقص «{label}»: غير متاح</p>
            <p className="text-sm text-muted-foreground">{result.message ?? 'هذا النشاط لا يتبع عدد السكان في هذه المدينة، فلا يمكن تقدير النقص؛ تُعرض الأحياء بأعدادها الفعلية فقط.'}</p>
            {/* the measured r is shown only when it was measured over enough districts to mean anything; with too
                few covered districts r is unreliable, so only the count is shown and the message says why */}
            {result.population_model_reason === 'weak_relationship' && result.fit != null && result.covered_districts != null && (
              <p className="text-sm text-muted-foreground tabular-nums">قيس على {numberFormat.format(result.covered_districts)} حي يحمل سكاناً ومنشآت: ارتباط العدد بالسكان r = {numberFormat.format(result.fit)}.</p>
            )}
            {result.population_model_reason === 'too_few_districts' && result.covered_districts != null && (
              <p className="text-sm text-muted-foreground tabular-nums">الأحياء التي تحمل سكاناً ومنشآت لهذا النشاط: {numberFormat.format(result.covered_districts)} فقط.</p>
            )}
          </div>
          {result.districts.length > 0 && (
            <>
              <p className="text-base text-muted-foreground">الأحياء بأعداد «{label}» الفعلية في الدليل، الأكثر أولاً:</p>
              <ol className="divide-y text-base lg:max-h-[45vh] lg:overflow-y-auto" aria-label={`أحياء «${label}» بأعدادها الفعلية`}>
                {result.districts.slice(0, shownRows).map((row) => {
                  const id = ids.get(row.district_ar)
                  const tag = caveatTag(row)
                  return (
                    <ResultRow key={row.district_ar}
                      title={tag ? <>{row.district_ar} <span className="ms-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{tag}</span></> : row.district_ar}
                      active={id != null && selected.includes(id)}
                      onClick={id ? () => onSelect(id) : undefined} onHover={(on) => onHover?.(on && id ? id : null)}
                      sub={(
                        <span className="tabular-nums">
                          {row.businesses > 0
                            ? <>{numberFormat.format(row.businesses)} موجودة · {numberFormat.format(row.population)} ساكن</>
                            : <>لا منشآت في الدليل · {numberFormat.format(row.population)} ساكن</>}
                        </span>
                      )}
                      aside={(
                        <Explained title={`لماذا لا يُحسب النقص لـ«${label}»`} lines={EXPLAIN.gapNotPopulation(result.population_model_reason, result.fit, result.covered_districts)} className="p-2">
                          <span className="sr-only">لماذا لا يُحسب</span>
                        </Explained>
                      )} />
                  )
                })}
              </ol>
              <MoreRows shown={Math.min(shownRows, result.districts.length)} total={result.districts.length} noun="district" onMore={showMore} />
            </>
          )}
        </>
      )}
      {status !== 'loading' && result && !notPopulationDriven && result.residents_per_business == null && (noPeople ? (
        <div role="status" className="flex flex-col gap-1 rounded-xl bg-muted/40 p-3 text-base">
          <p className="font-semibold">سكان أحياء {cityName ?? 'هذه المدينة'}: غير متاح بعد</p>
          <p className="text-sm text-muted-foreground">النقص يُحسب من سكان كل حي، فلا يُحسب هنا لأي نشاط. «المنافسون» و«شوارع النشاط» يعملان فيها من المنشآت.</p>
        </div>
      ) : <NoResult title={`لا توجد منشآت «${label}» في أحياء معروفة السكان`} body="جرّب اسماً آخر للنشاط، أو اختر نشاطاً رئيسياً." />)}
      {status !== 'loading' && result && result.residents_per_business != null && (
        <>
          {/* the answer first (the district, what it has and needs at the city rate, the next two), then the evidence */}
          <Verdict lift verdict={verdict} next={next} />
          {gaps.length > 0 && (
            <p className="text-sm font-semibold text-muted-foreground">{counted(gaps.length, 'district')} {gaps.length === 1 ? 'فيه' : 'فيها'} نقص، الأكبر أولاً</p>
          )}
          {/* the measured strength of the population→count relationship, so the city rate is auditable */}
          {result.fit != null && result.covered_districts != null && (
            <p className="text-sm text-muted-foreground tabular-nums">يتبع العدد السكان هنا (الارتباط r = {numberFormat.format(result.fit)} على {numberFormat.format(result.covered_districts)} حي).</p>
          )}
          {/* every district carries its share at the city rate: said once, never as «0 حي» over an empty list */}
          {gaps.length === 0 && <NoResult title={`لا حي ينقصه «${label}»`} body="كل حي معروف السكان فيه ما يكفيه بمعدل المدينة. جرّب نشاطاً آخر، أو «المنافسون» لترى أين المنافسة أخف." />}
          <ol className="divide-y text-base lg:max-h-[45vh] lg:overflow-y-auto" aria-label="الأحياء الأكثر نقصاً">
            {gaps.slice(0, shownRows).map((row, index) => {
              const id = ids.get(row.district_ar)
              const need = Math.round(row.expected_businesses ?? 0)
              const tag = caveatTag(row)
              return (
                <Fragment key={row.district_ar}>
                  {index === firstCaveat && (
                    <li id="gaps-caveats" className="pt-4 pb-1 text-sm text-muted-foreground">
                      <span className="block font-semibold text-foreground">مناطق صناعية أو سكن عمال أو حرم مغلق أو سكان مقدّرون</span>
                      اسمها يدل على منطقة صناعية، أو 90% فأكثر من سكانها رجال كما في سكن العمال، أو حرم جامعة أو قاعدة له خدماته داخله، أو سكانها تقدير من خرائط الكثافة يغطي أقل من نصف مساحتها، فنقصها بعدد السكان لا يُعتمد. لذلك تأتي بعد الأحياء السكنية.
                    </li>
                  )}
                  <ResultRow title={tag ? <>{row.district_ar} <span className="ms-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{tag}</span></> : row.district_ar}
                    active={id != null && selected.includes(id)}
                    onClick={id ? () => onSelect(id) : undefined} onHover={(on) => onHover?.(on && id ? id : null)}
                    sub={(
                      // one plain line: present · needed at the city rate · missing; the bar scales the missing count
                      // against the list's largest
                      <span className="flex flex-col gap-1">
                        <span className="tabular-nums">
                          {numberFormat.format(row.businesses)} موجودة · يحتاج {numberFormat.format(need)} · <strong className="font-semibold text-primary">ناقص {numberFormat.format(need - row.businesses)}</strong>
                        </span>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span className="block h-full rounded-full bg-primary/70" style={{ width: `${widest > 0 ? (100 * (row.shortfall ?? 0)) / widest : 0}%` }} />
                        </span>
                      </span>
                    )}
                    aside={(
                      <Explained title={`كيف حُسب «يحتاج» في ${row.district_ar}`} lines={EXPLAIN.gap(row.population, row.expected_businesses ?? 0, row.businesses, result.residents_per_business as number, result.fit, result.covered_districts)} className="p-2">
                        <span className="sr-only">كيف حُسب</span>
                      </Explained>
                    )} />
                </Fragment>
              )
            })}
          </ol>
          {caveatsLine && (
            <button type="button" onClick={showCaveats}
              className="rounded-md pt-1.5 text-start text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">{caveatsLine}</button>
          )}
          <MoreRows shown={Math.min(shownRows, gaps.length)} total={gaps.length} noun="district" onMore={showMore} />
        </>
      )}
    </section>
  )
}
