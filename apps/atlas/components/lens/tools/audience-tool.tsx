'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import { Explained } from '@/components/shared/explained'
import { LoadError } from '@/components/shared/load-error'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { NotAvailable } from '@/components/shared/empty-state'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'
import { EXPLAIN } from '@/lib/explanations'
import { counted, ltr, numberFormat, postMarket } from '@/lib/insights-api'
import { type DistrictShare, type Nationality, type Sex } from '@/lib/audience'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import type { Overlay } from './overlay'
import { PALETTE } from '@/lib/palette'
import { useStickyState, useStudiedMainId } from '@/lib/sticky-state'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import { audienceMissing, audienceSummary, audienceVerdict, audienceWhere } from './tool-answers'
import { Verdict } from './verdict'
import { useAnswer } from './use-answer'
import { Choice } from './choice'
import { useMainActivities } from '@/lib/main-activities'

type Mode = 'people' | 'businesses'
// the measured shares plus the segment sizes the service derives from them (population × share): read, never recomputed
type Share = DistrictShare & { district_ar: string; men: number | null; women: number | null; saudi: number | null; non_saudi: number | null }
/** Which measured segment a figure rests on; two segments are shown side by side, never multiplied. */
type Segment = 'none' | 'sex' | 'nationality'
type Count = { district_ar: string; n: number }
type Scored = { row: DistrictRow; size: number; score: number }

const INCOMES = [0, 8000, 12000, 16000]
const SEX_WORD: Record<Exclude<Sex, 'all'>, string> = { men: 'رجال', women: 'نساء' }
const NATIONALITY_WORD: Record<Exclude<Nationality, 'all'>, string> = { saudi: 'سعوديون', non_saudi: 'غير سعوديين' }
const show = (value: number) => numberFormat.format(Math.round(value))
const NO_SHARES = new Map<string, Share>()

/** Rank districts 0–100 by the audience in each, shade the map by it, and keep a district whose figure is unknown out. */
function score(rows: DistrictRow[], size: (row: DistrictRow) => number | null): { scored: Scored[]; unknown: number } {
  const known = rows.map((row) => ({ row, size: size(row) })).filter((item): item is { row: DistrictRow; size: number } => item.size != null)
  const largest = Math.max(0, ...known.map((item) => item.size))
  const scored = known
    .map((item) => ({ ...item, score: largest > 0 ? Math.round((100 * item.size) / largest) : 0 }))
    .sort((a, b) => b.size - a.size)
  return { scored, unknown: rows.length - known.length }
}

/**
 * «أين جمهوري؟» for marketers (docs/atlas-product-foundation.md §3.2). A consumer marketer filters people by sex,
 * nationality and income; a business marketer filters businesses by activity and WhatsApp reach. The map turns into
 * the best-matching districts and the card gives the audience size in the selected districts, or the whole city.
 */
export function AudienceTool({ city, rows, selected, onOverlay, onSelect, onHover, next }: {
  city: string
  rows: DistrictRow[]
  selected: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
  /** The district a row points at (pointer or keyboard), outlined on the map; null when it leaves. */
  onHover?: (id: string | null) => void
  /** The step after the answer (a campaign to the top districts), under the verdict; given by the map shell. */
  next?: ReactNode
}) {
  const [mode, setMode] = useStickyState<Mode>('audience.mode', 'people')
  const [sex, setSex] = useStickyState<Sex>('audience.sex', 'all')
  const [nationality, setNationality] = useStickyState<Nationality>('audience.nationality', 'all')
  const [minIncome, setMinIncome] = useStickyState('audience.minIncome', 0)
  const [rankBy, setRankBy] = useStickyState<'sex' | 'nationality'>('audience.rankBy', 'sex')
  const activities = useMainActivities(city)
  const [mainId, setMainId] = useStudiedMainId(activities)

  // the measured shares of the city; those of a city left behind never land on the next one. null while they load;
  // a failure leaves none (a sex or nationality figure then says so, with a retry, instead of «غير متاح»)
  const sharesAnswer = useAnswer(city, () => postMarket<{ districts?: Share[] }>('district-audience', { city })
    .then((data) => new Map((data.districts ?? []).map((row) => [row.district_ar, row]))))
  const shares = sharesAnswer.status === 'error' ? NO_SHARES : sharesAnswer.data
  const sharesFailed = sharesAnswer.status === 'error'

  // the activity's counts, asked only in «منشآت»: leaving it drops them, so the people card never waits on them, and a
  // new activity clears the last one's at once, so the map never shades districts for a different activity
  const countsAnswer = useAnswer(mode === 'businesses' ? `${city}|${mainId}` : null, () =>
    postMarket<{ districts?: Count[]; total?: number; located?: number }>('district-counts', { city, ...(mainId ? { main_id: mainId } : {}) })
      .then((data) => ({
        counts: new Map((data.districts ?? []).map((row) => [row.district_ar, row])),
        // the city's own count of the activity (district-counts total), and how many of it fell in a known district
        cityCount: { total: typeof data.total === 'number' ? data.total : null, located: typeof data.located === 'number' ? data.located : null },
      })))
  const counts = countsAnswer.data?.counts ?? null
  const cityCount = countsAnswer.data?.cityCount ?? null
  const status = countsAnswer.status === 'loading' ? 'loading' : countsAnswer.status === 'error' ? 'error' : 'idle'

  const both = sex !== 'all' && nationality !== 'all'
  const ranked: Segment = both ? rankBy : sex !== 'all' ? 'sex' : nationality !== 'all' ? 'nationality' : 'none'

  /** People of one segment per district, with the income filter; null when a needed figure is not measured. */
  const people = useMemo(() => (segment: Segment) => (row: DistrictRow): number | null => {
    if (row.population == null) return null
    if (minIncome > 0 && row.income == null) return null   // no measured income: unknown, not excluded as poor
    if (minIncome > 0 && row.income! < minIncome) return 0
    if (segment === 'none') return row.population
    const share = shares?.get(row.name)
    if (segment === 'sex') return sex === 'all' ? row.population : share ? (sex === 'men' ? share.men : share.women) : null
    return nationality === 'all' ? row.population : share ? (nationality === 'saudi' ? share.saudi : share.non_saudi) : null
  }, [shares, sex, nationality, minIncome])

  const { scored, unknown } = useMemo(() => {
    if (mode === 'businesses') {
      return score(rows, (row) => {
        const count = counts?.get(row.name)
        if (!counts) return null
        return count ? count.n : 0
      })
    }
    return score(rows, people(ranked))
  }, [mode, rows, counts, people, ranked])

  // With both filters on, the other segment is its own figure in the card, never multiplied into the ranked one.
  const other = useMemo(() => (mode === 'people' && both ? score(rows, people(ranked === 'sex' ? 'nationality' : 'sex')) : null),
    [mode, both, rows, people, ranked])

  // the map hands a new array of the same districts on every render, so the overlay follows their ids, not the array
  const selectedKey = selected.map((row) => row.id).join('|')
  // the people figures of one segment wait for the measured shares; until then the map has no answer to give
  // and nothing is said before the city's districts arrive: an empty table is still loading, not «غير متاح»
  const pending = rows.length === 0 || status === 'loading' || (mode === 'people' && (sex !== 'all' || nationality !== 'all') && shares == null)
  useEffect(() => {
    const colors = new Map<string, string>()
    for (const item of scored) colors.set(item.row.id, item.score > 0 ? SHADES[Math.min(4, Math.floor(item.score / 20))] : PALETTE.pebble)
    // the card's first figure in one line for the peeking sheet: the same sum of the service's figures, and the top district
    const ids = new Set(selectedKey ? selectedKey.split('|') : [])
    const list = ids.size ? scored.filter((item) => ids.has(item.row.id)) : scored
    const segment = both ? (ranked === 'sex' ? SEX_WORD[sex] : NATIONALITY_WORD[nationality]) : ''
    const summary = pending ? null
      : audienceSummary({ selected: ids.size, scope: ids.size || rows.length, segment, sizes: list.map((item) => item.size), unit: mode === 'people' ? 'شخص' : 'منشأة', top: scored[0]?.row.name ?? null,
        ...(mode === 'businesses' ? { cityTotal: cityCount?.total ?? null } : {}) })
    // «أرني الأعلى» opens the best-matching district, the first of the ranking
    // a district's own figure, as its row in the ranking shows it; one without a measured figure is left out («غير متاح»)
    const facts = pending ? null : new Map(scored.map((item) => [item.row.id, `${show(item.size)} ${mode === 'people' ? 'شخص' : 'منشأة'} · ${numberFormat.format(item.score)}/100`] as [string, string]))
    // the key the map corner draws: the same five shades by score, and the grey of a district the filters leave empty
    const legend = scored.length ? { from: 'تطابق أقل', to: 'تطابق أكثر', shades: SHADES, extra: { color: PALETTE.pebble, label: 'لا جمهور بهذه الفلاتر' } } : null
    onOverlay({ colors, facts, summary, legend, lead: pending ? null : scored[0]?.row.id ?? null })
  }, [scored, onOverlay, selectedKey, both, ranked, sex, nationality, mode, pending, rows.length, cityCount])

  const [limit, showMore] = useShowMore(10, `${city}|${mode}|${sex}|${nationality}|${minIncome}|${rankBy}|${mainId}`)
  const inScope = (list: Scored[]) => (selected.length ? list.filter((item) => selected.some((row) => row.id === item.row.id)) : list)
  const scope = inScope(scored)
  const unit = mode === 'people' ? 'شخص' : 'منشأة'
  const segments = both ? 'both' : sex !== 'all' || nationality !== 'all' ? 'one' : 'none'
  const explain = mode === 'people' ? EXPLAIN.audiencePeople(segments, minIncome) : EXPLAIN.audienceBusinesses
  const unknownLine = (count: number) => (count ? [`${numberFormat.format(count)} حياً بلا رقم مقاس فلم تُحسب، وتظهر بلا لون.`] : [])
  const segmentWord = (segment: Segment) => (segment === 'sex' && sex !== 'all' ? SEX_WORD[sex] : segment === 'nationality' && nationality !== 'all' ? NATIONALITY_WORD[nationality] : '')
  /** The card's figures: one, or (both filters on) the sex figure then the nationality figure, each from its own share. */
  const figures = !other
    ? [{ key: 'one', label: '', list: scope, unknown }]
    : (ranked === 'sex'
        ? [{ key: 'sex', list: scope, unknown }, { key: 'nationality', list: inScope(other.scored), unknown: other.unknown }]
        : [{ key: 'sex', list: inScope(other.scored), unknown: other.unknown }, { key: 'nationality', list: scope, unknown }]
      ).map((item) => ({ ...item, label: segmentWord(item.key as Segment) }))

  const segmented = mode === 'people' && (sex !== 'all' || nationality !== 'all')
  const sharesError = segmented && sharesFailed
  // a sex or nationality figure waits for the measured shares, so it never reads «غير متاح» while they load
  const busy = pending
  // asked, and no district has the figure measured (a city without sex and nationality shares, or without income):
  // said once with what is missing and what still works, never a card of «غير متاح» over an empty ranking
  const gap = mode === 'people' && !busy && !sharesError ? audienceMissing({ rows, scored: scored.length, sex, nationality, minIncome }) : null

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold max-lg:-order-2">أين جمهوري؟</h2>
      <Choice label="من تستهدف" value={mode} onChange={setMode} options={[{ id: 'people', label: 'أستهدف أفراداً' }, { id: 'businesses', label: 'أستهدف منشآت' }]} />
      {mode === 'people' ? (
        <>
          <Choice label="الجنس" value={sex} onChange={setSex} options={[{ id: 'all', label: 'الكل' }, { id: 'men', label: 'رجال' }, { id: 'women', label: 'نساء' }]} />
          <Choice label="الجنسية" value={nationality} onChange={setNationality} options={[{ id: 'all', label: 'كل الجنسيات' }, { id: 'saudi', label: 'سعوديون' }, { id: 'non_saudi', label: 'غير سعوديين' }]} />
          {both && (
            <div>
              <p className="mb-1 text-sm text-muted-foreground">رتّب الأحياء ولوّن الخريطة حسب</p>
              <Choice label="رتّب حسب" value={rankBy} onChange={setRankBy} options={[{ id: 'sex', label: segmentWord('sex') }, { id: 'nationality', label: segmentWord('nationality') }]} />
            </div>
          )}
          <div>
            <p className="mb-1 text-sm text-muted-foreground">متوسط دخل الحي الشهري</p>
            <Choice label="متوسط دخل الحي الشهري" value={minIncome} onChange={setMinIncome} options={INCOMES.map((value) => ({ id: value, label: value ? ltr(`${numberFormat.format(value)}+`) : 'أي دخل' }))} />
          </div>
        </>
      ) : (
        <>
          <MainActivityPicker activities={activities} value={mainId} onChange={setMainId} placeholder="نشاط المنشآت" allLabel="كل الأنشطة" />
        </>
      )}
      {busy && (
        <>
          <SkeletonStatus label="جارٍ الحساب" className="flex flex-col gap-2 rounded-xl bg-muted/40 px-3 py-2.5">
            <Skeleton className="h-4 w-40" />
            {figures.map((figure) => <Skeleton key={figure.key} className="h-7 w-36" />)}
          </SkeletonStatus>
          <ResultRowsSkeleton label="جارٍ الحساب" rows={5} valueSub />
        </>
      )}
      {status === 'error' && <LoadError what="منشآت الأحياء" onRetry={countsAnswer.retry} />}
      {sharesError && <LoadError what="نسب الجنس والجنسية" onRetry={sharesAnswer.retry} />}
      {gap && <NotAvailable what={gap.what} where="هذه المدينة" body={gap.body} />}
      {!busy && status === 'idle' && mode === 'businesses' && !selected.length && (
        // the whole city: the service's city count (with the businesses no district holds), the same as «المنافسون»
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-sm text-muted-foreground">حجم الجمهور</p>
          <Explained title="حجم الجمهور" lines={[...explain, ...unknownLine(unknown)]} className="mt-0.5 text-xl font-bold tabular-nums">
            <span>{cityCount?.total == null ? 'غير متاح' : `${numberFormat.format(cityCount.total)} ${unit}`}</span>
          </Explained>
          {cityCount?.total != null && (
            <p className="text-sm text-muted-foreground">
              في المدينة{cityCount.located != null && cityCount.located < cityCount.total ? ` · ${numberFormat.format(cityCount.located)} منها بحي معروف` : ''}
            </p>
          )}
        </div>
      )}
      {!busy && status === 'idle' && !sharesError && !gap && !(mode === 'businesses' && !selected.length) && (
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-sm text-muted-foreground">حجم الجمهور</p>
          {figures.map((figure) => (
            <div key={figure.key}>
            <Explained title={figure.label ? `حجم الجمهور: ${figure.label}` : 'حجم الجمهور'} lines={[...explain, ...unknownLine(figure.unknown)]} className="mt-0.5 text-xl font-bold tabular-nums">
              <span>
                {figure.label && <span className="font-normal text-muted-foreground">{figure.label}: </span>}
                {figure.list.length ? `${show(figure.list.reduce((sum, item) => sum + item.size, 0))} ${unit}` : 'غير متاح'}
              </span>
            </Explained>
            {/* the same scope words as the peek summary: a sum over part of the districts says so */}
            {figure.list.length > 0 && <p className="text-sm text-muted-foreground">{audienceWhere({ selected: selected.length, measured: figure.list.length, scope: selected.length || rows.length })}</p>}
            </div>
          ))}
        </div>
      )}
      {scored.length > 0 && !busy && status === 'idle' && !sharesError && (
        <Verdict lift verdict={audienceVerdict(scope.map((item) => ({ name: item.row.name, size: item.size })), unit, segmentWord(ranked))} next={next} />
      )}
      {scored.length > 0 && !busy && status === 'idle' && !sharesError && (
        <div>
          <Explained title="درجة الحي" lines={EXPLAIN.audienceScore} className="mb-1 text-sm font-semibold text-muted-foreground">أعلى الأحياء مطابقةً</Explained>
          <ol className="divide-y text-base">
            {scored.slice(0, limit).map((item) => (
              <ResultRow key={item.row.id} onClick={() => onSelect(item.row.id)} onHover={(on) => onHover?.(on ? item.row.id : null)} title={item.row.name}
                active={selected.some((row) => row.id === item.row.id)}
                // the audience itself leads; the score is its place against the top district
                value={`${show(item.size)} ${unit}`} valueSub={`${numberFormat.format(item.score)}/100`} />
            ))}
          </ol>
          <MoreRows shown={Math.min(limit, scored.length)} total={scored.length} noun="district" onMore={showMore} />
        </div>
      )}
    </section>
  )
}
