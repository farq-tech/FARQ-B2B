'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket, useMainActivities } from '@/lib/insights-api'
import { isDistrictCountResponse } from '@/lib/district-counts'
import { requestWithDeadline } from '@/lib/optional-source'
import { audienceDataStatus, audienceShadeIndex, audienceSummaryHeading, completeAudienceTotal, districtBusinessCount, incomeCoverageStatus, isAudienceResponse, meetsIncomeThreshold, type AudienceMode, type AudienceDistrict, type Nationality, type Sex } from '@/lib/audience'
import { cn } from '@/lib/utils'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import { MapLegend } from './map-legend'
import type { Overlay } from './overlay'
import { PALETTE } from '@/lib/palette'
import { useStickyState, useStudiedMainId } from '@/lib/sticky-state'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'

// the measured shares plus the segment sizes the service derives from them (population × share): read, never recomputed
type Share = AudienceDistrict
/** Which measured segment a figure rests on; two segments are shown side by side, never multiplied. */
type Segment = 'none' | 'sex' | 'nationality'
type Count = { district_id?: string | null; district_ar: string; n: number }
type Scored = { row: DistrictRow; size: number; score: number }
type AudienceLoad = { city: string; status: 'loading' | 'ready' | 'unavailable' | 'error'; byId: boolean; shares: Map<string, Share> | null }
type BusinessCountLoad = { key: string; status: 'loading' | 'idle' | 'error'; byId: boolean; counts: Map<string, Count> | null; total: number | null; located: number | null }

const INCOMES = [0, 8000, 12000, 16000]
const SEX_WORD: Record<Exclude<Sex, 'all'>, string> = { men: 'رجال', women: 'نساء' }
const NATIONALITY_WORD: Record<Exclude<Nationality, 'all'>, string> = { saudi: 'سعوديون', non_saudi: 'غير سعوديين' }
const show = (value: number) => numberFormat.format(Math.round(value))

function audienceIncome(row: DistrictRow, segment: Segment, sex: Sex, nationality: Nationality): number | null {
  if (segment === 'sex' && sex !== 'all') return sex === 'men' ? row.incomeMale : row.incomeFemale
  if (segment === 'nationality' && nationality !== 'all') return nationality === 'saudi' ? row.incomeSaudi : row.incomeNonSaudi
  return row.income
}

function incomeSubject(segment: Segment, sex: Sex, nationality: Nationality): string {
  if (segment === 'sex' && sex === 'men') return 'الرجال العاملين'
  if (segment === 'sex' && sex === 'women') return 'النساء العاملات'
  if (segment === 'nationality' && nationality === 'saudi') return 'السعوديين العاملين'
  if (segment === 'nationality' && nationality === 'non_saudi') return 'غير السعوديين العاملين'
  return 'العاملين'
}

function Choice<T extends string | number>({ value, options, onChange, disabledIds = [] }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void; disabledIds?: readonly T[] }) {
  return (
    <div className="flex gap-1.5">
      {options.map((option) => (
        <button key={String(option.id)} onClick={() => onChange(option.id)} aria-pressed={value === option.id}
          disabled={disabledIds.includes(option.id)}
          className={cn('min-h-11 flex-1 rounded-lg border px-1.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40', value === option.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Rank districts 0–100 by the audience in each, shade the map by it, and keep a district whose figure is unknown out. */
function score(rows: DistrictRow[], size: (row: DistrictRow) => number | null): { scored: Scored[]; unknown: number } {
  const values = rows.map((row) => ({ row, size: size(row) }))
  const known = values.filter((item): item is { row: DistrictRow; size: number } => item.size != null && Number.isFinite(item.size) && item.size >= 0)
  const largest = Math.max(0, ...known.map((item) => item.size))
  const scored = known
    .map((item) => ({ ...item, score: largest > 0 ? Math.round((100 * item.size) / largest) : 0 }))
    .sort((a, b) => b.size - a.size)
  return { scored, unknown: rows.length - known.length }
}

function summarizeScope(rows: DistrictRow[], size: (row: DistrictRow) => number | null): { unknown: number; total: number | null } {
  const values = rows.map(size)
  return {
    unknown: values.filter((value) => value == null || !Number.isFinite(value) || value < 0).length,
    total: completeAudienceTotal(values),
  }
}

/**
 * «أين جمهوري؟» for marketers (docs/atlas-product-foundation.md §3.2). A consumer marketer filters people by sex,
 * nationality and income; a business marketer filters businesses by activity and WhatsApp reach. The map turns into
 * the best-matching districts and the card gives the audience size in the selected districts, or the whole city.
 */
export function AudienceTool({ city, rows, selected, onOverlay, onSelect, mode, onModeChange, incomeSourceStatus, onRetryIncome }: {
  city: string
  rows: DistrictRow[]
  selected: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
  mode: AudienceMode
  onModeChange: (mode: AudienceMode) => void
  incomeSourceStatus: 'loading' | 'ready' | 'error'
  onRetryIncome: () => void
}) {
  const [sex, setSex] = useStickyState<Sex>('audience.sex', 'all')
  const [nationality, setNationality] = useStickyState<Nationality>('audience.nationality', 'all')
  const [minIncome, setMinIncome] = useStickyState('audience.minIncome', 0)
  const [rankBy, setRankBy] = useStickyState<'sex' | 'nationality'>('audience.rankBy', 'sex')
  const [audienceLoad, setAudienceLoad] = useState<AudienceLoad>({ city, status: 'loading', byId: false, shares: null })
  const sharesStatus = audienceLoad.city === city ? audienceLoad.status : 'loading'
  const shares = audienceLoad.city === city ? audienceLoad.shares : null
  const sharesById = audienceLoad.city === city && audienceLoad.byId
  const [sharesRetry, setSharesRetry] = useState(0)
  const { activities, status: activityStatus, retry: retryActivities } = useMainActivities(city)
  const [mainId, setMainId, mainLabel] = useStudiedMainId(activities)
  const [countLoad, setCountLoad] = useState<BusinessCountLoad | null>(null)
  const [countsRetry, setCountsRetry] = useState(0)
  const countKey = JSON.stringify([city, mainId])
  const countLoadIsCurrent = countLoad?.key === countKey
  const counts = countLoadIsCurrent ? countLoad.counts : null
  const status = mode !== 'businesses' ? 'idle' : countLoadIsCurrent ? countLoad.status : 'loading'

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setAudienceLoad({ city, status: 'loading', byId: false, shares: null })
    requestWithDeadline((signal) => postMarket<unknown>('district-audience', { city }, signal), controller.signal)
      .then((payload) => {
        if (!active) return
        if (!isAudienceResponse(payload, city)) throw new Error('Invalid measured audience data')
        if (payload.available === false) {
          setAudienceLoad({ city, status: 'unavailable', byId: false, shares: new Map() })
          return
        }
        const byId = payload.districts!.some((row) => row.district_id !== undefined)
        const shares = new Map<string, Share>()
        for (const row of payload.districts!) {
          const key = byId ? row.district_id : row.district_ar
          if (key != null) shares.set(key, row)
        }
        setAudienceLoad({ city, status: 'ready', byId, shares })
      })
      .catch(() => { if (active) setAudienceLoad({ city, status: 'error', byId: false, shares: null }) })
    return () => { active = false; controller.abort() }
  }, [city, sharesRetry])

  useEffect(() => {
    if (mode !== 'businesses') return
    let active = true
    const controller = new AbortController()
    setCountLoad({ key: countKey, status: 'loading', byId: false, counts: null, total: null, located: null })
    requestWithDeadline((signal) => postMarket<unknown>('district-counts', { city, ...(mainId ? { main_id: mainId } : {}) }, signal), controller.signal)
      .then((payload) => {
        if (!active) return
        if (!isDistrictCountResponse(payload)) throw new Error('Invalid district counts')
        const data = payload
        const byId = data.districts.some((row) => row.district_id !== undefined)
        const next = new Map<string, Count>()
        for (const row of data.districts) {
          const key = byId ? row.district_id : row.district_ar
          if (key != null) next.set(key, row)
        }
        setCountLoad({ key: countKey, status: 'idle', byId, counts: next, total: data.total, located: data.located ?? null })
      })
      .catch(() => { if (active) setCountLoad({ key: countKey, status: 'error', byId: false, counts: null, total: null, located: null }) })
    return () => { active = false; controller.abort() }
  }, [city, mode, mainId, countKey, countsRetry])

  const both = sex !== 'all' && nationality !== 'all'
  const needsShares = sex !== 'all' || nationality !== 'all'
  const segmentStatus = audienceDataStatus(mode, needsShares, sharesStatus)
  const segmentDataFinished = segmentStatus !== 'loading'
  const ranked: Segment = both ? rankBy : sex !== 'all' ? 'sex' : nationality !== 'all' ? 'nationality' : 'none'
  const measuredIncomeSubject = incomeSubject(ranked, sex, nationality)
  const measuredIncomeDistricts = rows.filter((row) => audienceIncome(row, ranked, sex, nationality) != null).length
  const incomeCoverage = incomeCoverageStatus(incomeSourceStatus, measuredIncomeDistricts, rows.length)
  const incomeThresholdDisabled = incomeCoverage === 'loading' || incomeCoverage === 'error' || incomeCoverage === 'unavailable'
  const scopeRows = useMemo(() => selected.length ? rows.filter((row) => selected.some((item) => item.id === row.id)) : rows,
    [rows, selected])

  /** People of one segment per district, with the income filter; null when a needed figure is not measured. */
  const people = useMemo(() => (segment: Segment) => (row: DistrictRow): number | null => {
    if (row.population == null) return null
    const segmentIncome = audienceIncome(row, segment, sex, nationality)
    if (minIncome > 0 && segmentIncome == null) return null  // no measured segment income: unknown, not excluded as poor
    if (minIncome > 0 && segmentIncome! < minIncome) return 0
    if (segment === 'none') return row.population
    const share = shares?.get(sharesById ? row.id : row.name)
    if (segment === 'sex') return sex === 'all' ? row.population : share ? (sex === 'men' ? share.men : share.women) : null
    return nationality === 'all' ? row.population : share ? (nationality === 'saudi' ? share.saudi : share.non_saudi) : null
  }, [shares, sharesById, sex, nationality, minIncome])

  const businessSize = useCallback((row: DistrictRow) => {
    const count = counts?.get(countLoad?.byId ? row.id : row.name)
    if (!counts) return null
    return districtBusinessCount(countLoadIsCurrent ? countLoad?.total ?? null : null, count?.n)
  }, [counts, countLoadIsCurrent, countLoad?.byId, countLoad?.total])
  const incomeEligibility = useMemo(() => mode === 'people'
    ? new Map(rows.map((row) => [row.id, meetsIncomeThreshold(audienceIncome(row, ranked, sex, nationality), minIncome)]))
    : new Map<string, boolean | null>(),
  [mode, rows, ranked, sex, nationality, minIncome])
  const mapRows = useMemo(() => mode === 'people' ? rows.filter((row) => incomeEligibility.get(row.id) !== false) : rows,
    [mode, rows, incomeEligibility])
  const { scored } = useMemo(() => {
    if (mode === 'people' && needsShares && sharesStatus === 'loading') return { scored: [], unknown: 0 }
    if (mode === 'businesses') {
      return score(rows, businessSize)
    }
    return score(mapRows, people(ranked))
  }, [mode, rows, mapRows, businessSize, people, ranked, needsShares, sharesStatus])

  const primaryScope = useMemo(() => summarizeScope(scopeRows, mode === 'businesses' ? businessSize : people(ranked)),
    [scopeRows, mode, businessSize, people, ranked])

  // With both filters on, each segment is totaled independently and is never multiplied into the other.
  const hasOther = mode === 'people' && both
  const otherScope = useMemo(() => (hasOther ? summarizeScope(scopeRows, people(ranked === 'sex' ? 'nationality' : 'sex')) : null),
    [hasOther, scopeRows, people, ranked])

  useEffect(() => {
    const colors = new Map<string, string>()
    if (mode === 'people' && needsShares && sharesStatus === 'loading') {
      onOverlay({ colors })
      return
    }
    for (const item of scored) {
      const shade = audienceShadeIndex(item.score)
      if (shade != null) colors.set(item.row.id, SHADES[shade])
    }
    if (mode === 'people' && minIncome > 0) {
      for (const row of rows) if (incomeEligibility.get(row.id) === false) colors.set(row.id, PALETTE.pebble)
    }
    onOverlay({ colors })
  }, [scored, mode, needsShares, sharesStatus, minIncome, rows, incomeEligibility, onOverlay])

  const unit = mode === 'people' ? 'شخص' : 'منشأة'
  const audienceScope = selected.length ? `الأحياء المحددة (${counted(selected.length, 'district')})` : 'المدينة'
  const audienceHeading = audienceSummaryHeading(mode, sex !== 'all' || nationality !== 'all', minIncome, audienceScope)
  const segments = both ? 'both' : sex !== 'all' || nationality !== 'all' ? 'one' : 'none'
  const explain = mode === 'people' ? EXPLAIN.audiencePeople(segments, minIncome) : EXPLAIN.audienceBusinesses
  const unknownLine = (count: number) => (count ? [`${numberFormat.format(count)} حياً بلا رقم مقاس فلم تُحسب، وتظهر بلا لون.`] : [])
  const segmentWord = (segment: Segment) => (segment === 'sex' && sex !== 'all' ? SEX_WORD[sex] : segment === 'nationality' && nationality !== 'all' ? NATIONALITY_WORD[nationality] : '')
  /** The card's figures: one, or (both filters on) the sex figure then the nationality figure, each from its own share. */
  const figures = !hasOther
    ? [{ key: 'one', label: '', unknown: primaryScope.unknown, total: primaryScope.total }]
    : (ranked === 'sex'
        ? [
            { key: 'sex', ...primaryScope },
            { key: 'nationality', ...(otherScope ?? { unknown: 0, total: null }) },
          ]
        : [
            { key: 'sex', ...(otherScope ?? { unknown: 0, total: null }) },
            { key: 'nationality', ...primaryScope },
          ]
      ).map((item) => ({ key: item.key, label: segmentWord(item.key as Segment), unknown: item.unknown, total: item.total }))

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">أين جمهوري؟</h2>
      <MapLegend from={mode === 'people' ? 'جمهور أقل' : 'منشآت أقل'} to={mode === 'people' ? 'جمهور أكثر' : 'منشآت أكثر'} shades={SHADES}
        extra={mode === 'people' && minIncome > 0 ? { color: PALETTE.pebble, label: 'دخله دون الحد' } : undefined} />
      <Choice value={mode} onChange={onModeChange} options={[{ id: 'people', label: 'أستهدف أفراداً' }, { id: 'businesses', label: 'أستهدف منشآت' }]} />
      {mode === 'people' ? (
        <>
          <Choice value={sex} onChange={setSex} options={[{ id: 'all', label: 'الكل' }, { id: 'men', label: 'رجال' }, { id: 'women', label: 'نساء' }]} />
          <Choice value={nationality} onChange={setNationality} options={[{ id: 'all', label: 'كل الجنسيات' }, { id: 'saudi', label: 'سعوديون' }, { id: 'non_saudi', label: 'غير سعوديين' }]} />
          {both && (
            <div>
              <p className="mb-1 text-sm text-muted-foreground">رتّب الأحياء ولوّن الخريطة حسب</p>
              <Choice value={rankBy} onChange={setRankBy} options={[{ id: 'sex', label: segmentWord('sex') }, { id: 'nationality', label: segmentWord('nationality') }]} />
            </div>
          )}
          <div>
            <p className="mb-1 text-sm text-muted-foreground">
              متوسط دخل {measuredIncomeSubject} في الحي شهرياً
            </p>
            <Choice value={minIncome} onChange={setMinIncome} disabledIds={incomeThresholdDisabled ? INCOMES.filter((value) => value > 0) : []}
              options={INCOMES.map((value) => ({ id: value, label: value ? `${numberFormat.format(value)}+` : 'أي دخل' }))} />
            {incomeCoverage === 'loading' && <p role="status" className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> جارٍ تحميل قياسات الدخل.</p>}
            {incomeCoverage === 'error' && <p role="alert" className="mt-1 text-sm text-destructive">تعذر تحميل قياسات الدخل. <button type="button" onClick={onRetryIncome} className="font-semibold underline">أعد تحميل بيانات المدينة</button></p>}
            {incomeCoverage === 'unavailable' && <p role="status" className="mt-1 text-sm text-muted-foreground">لا توجد قياسات دخل لـ{measuredIncomeSubject} في هذه المدينة؛ لا يمكن تطبيق حد الدخل.</p>}
            {incomeCoverage === 'partial' && <p role="status" className="mt-1 text-sm text-muted-foreground">دخل {measuredIncomeSubject} مقاس في {numberFormat.format(measuredIncomeDistricts)} من {numberFormat.format(rows.length)} حياً؛ الأحياء الأخرى بلا قياس ولا تدخل في الشريحة عند تطبيق الحد.</p>}
            {(incomeCoverage === 'unavailable' || incomeCoverage === 'error') && minIncome > 0 && <p role="status" className="mt-1 text-sm text-muted-foreground">اختر «أي دخل» لإزالة الحد واستعادة عرض الجمهور.</p>}
          </div>
          {needsShares && sharesStatus === 'loading' && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> جارٍ تحميل نسب السكان</div>}
          {needsShares && sharesStatus === 'unavailable' && <p role="status" className="text-sm text-muted-foreground">بيانات نسب السكان غير متاحة لهذه المدينة.</p>}
          {needsShares && sharesStatus === 'error' && (
            <p role="alert" className="text-sm text-destructive">تعذر تحميل نسب السكان؛ لم نعرضها كأنها غير مقاسة. <button onClick={() => setSharesRetry((value) => value + 1)} className="font-semibold underline">أعد المحاولة</button></p>
          )}
        </>
      ) : (
        <>
          <MainActivityPicker activities={activities} value={mainId} valueLabel={mainLabel} onChange={setMainId} placeholder="نشاط المنشآت" allLabel="كل الأنشطة" status={activityStatus} onRetry={retryActivities} />
        </>
      )}
      {status === 'loading' && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ الحساب" />}
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر تحميل أعداد المنشآت. <button onClick={() => setCountsRetry((value) => value + 1)} className="font-semibold underline">أعد المحاولة</button></p>}
      {status !== 'loading' && segmentDataFinished && (
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-sm text-muted-foreground">{audienceHeading}</p>
          {mode === 'businesses' && countLoadIsCurrent && countLoad?.located != null && countLoad.total != null
            && countLoad.located < countLoad.total && (
              <p className="mt-1 text-sm text-muted-foreground">
                في نطاق البحث الحالي على مستوى المدينة، عُرف الحي لـ {numberFormat.format(countLoad.located)} من {numberFormat.format(countLoad.total)} منشأة؛ ولا تدخل المنشآت الأخرى في تحليل الأحياء.
              </p>
            )}
          {figures.map((figure) => (
            <Explained key={figure.key} title={figure.label ? `حجم الجمهور: ${figure.label}` : 'حجم الجمهور'} lines={[...explain, ...unknownLine(figure.unknown)]} className="mt-0.5 text-xl font-bold">
              {figure.label && <span className="font-normal text-muted-foreground">{figure.label}: </span>}
              {figure.total == null ? 'غير متاح' : `${show(figure.total)} ${unit}`}
            </Explained>
          ))}
        </div>
      )}
      {scored.some((item) => item.size > 0) && status !== 'loading' && segmentDataFinished && (
        <div>
          <Explained title="درجة الحي" lines={EXPLAIN.audienceScore} className="mb-1 text-sm font-semibold text-muted-foreground">أعلى الأحياء مطابقةً</Explained>
          <ol className="divide-y text-base">
            {scored.slice(0, 10).map((item) => (
              <li key={item.row.id}>
                <button onClick={() => onSelect(item.row.id)} className="flex w-full items-center justify-between py-2 text-start hover:text-primary">
                  <span className="font-medium">{item.row.name}</span>
                  <span className="text-sm text-muted-foreground">{show(item.size)} {unit} · <span className="font-bold text-foreground">{numberFormat.format(item.score)}</span>/100</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
