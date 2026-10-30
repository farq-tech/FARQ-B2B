'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { nationalityAudience, sexAudience, type DistrictShare, type Nationality, type Sex } from '@/lib/audience'
import { cn } from '@/lib/utils'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import type { Overlay } from './overlay'
import { PALETTE } from '@/lib/palette'
import { useStickyState, useStudiedMainId } from '@/lib/sticky-state'

type Mode = 'people' | 'businesses'
type Share = DistrictShare & { district_ar: string }
/** Which measured segment a figure rests on; two segments are shown side by side, never multiplied. */
type Segment = 'none' | 'sex' | 'nationality'
type Activity = { main_id: string; main_ar: string }
type Count = { district_ar: string; n: number }
type Scored = { row: DistrictRow; size: number; score: number }

const INCOMES = [0, 8000, 12000, 16000]
const SEX_WORD: Record<Exclude<Sex, 'all'>, string> = { men: 'رجال', women: 'نساء' }
const NATIONALITY_WORD: Record<Exclude<Nationality, 'all'>, string> = { saudi: 'سعوديون', non_saudi: 'غير سعوديين' }
const show = (value: number) => numberFormat.format(Math.round(value))

function Choice<T extends string | number>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map((option) => (
        <button key={String(option.id)} onClick={() => onChange(option.id)} aria-pressed={value === option.id}
          className={cn('flex-1 rounded-lg border py-2 text-sm', value === option.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

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
export function AudienceTool({ city, rows, selected, onOverlay, onSelect }: {
  city: string
  rows: DistrictRow[]
  selected: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
}) {
  const [mode, setMode] = useStickyState<Mode>('audience.mode', 'people')
  const [sex, setSex] = useStickyState<Sex>('audience.sex', 'all')
  const [nationality, setNationality] = useStickyState<Nationality>('audience.nationality', 'all')
  const [minIncome, setMinIncome] = useStickyState('audience.minIncome', 0)
  const [rankBy, setRankBy] = useStickyState<'sex' | 'nationality'>('audience.rankBy', 'sex')
  const [shares, setShares] = useState<Map<string, Share> | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [mainId, setMainId] = useStudiedMainId(activities)
  const [counts, setCounts] = useState<Map<string, Count> | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    setShares(null)
    postMarket<{ districts?: Share[] }>('district-audience', { city })
      .then((data) => setShares(new Map((data.districts ?? []).map((row) => [row.district_ar, row]))))
      .catch(() => setShares(new Map()))
    postMarket<{ summary?: { main_activities?: Activity[] } }>('market-summary', { city })
      .then((data) => setActivities(data.summary?.main_activities ?? []))
      .catch(() => setActivities([]))
  }, [city])

  useEffect(() => {
    if (mode !== 'businesses') return
    let active = true
    setStatus('loading')
    postMarket<{ districts?: Count[] }>('district-counts', { city, ...(mainId ? { main_id: mainId } : {}) })
      .then((data) => { if (active) { setCounts(new Map((data.districts ?? []).map((row) => [row.district_ar, row]))); setStatus('idle') } })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [city, mode, mainId])

  const both = sex !== 'all' && nationality !== 'all'
  const ranked: Segment = both ? rankBy : sex !== 'all' ? 'sex' : nationality !== 'all' ? 'nationality' : 'none'

  /** People of one segment per district, with the income filter; null when a needed figure is not measured. */
  const people = useMemo(() => (segment: Segment) => (row: DistrictRow): number | null => {
    if (row.population == null) return null
    if (minIncome > 0 && row.income == null) return null   // no measured income: unknown, not excluded as poor
    if (minIncome > 0 && row.income! < minIncome) return 0
    if (segment === 'none') return row.population
    const share = shares?.get(row.name)
    return segment === 'sex' ? sexAudience(row.population, share, sex) : nationalityAudience(row.population, share, nationality)
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

  useEffect(() => {
    const colors = new Map<string, string>()
    for (const item of scored) colors.set(item.row.id, item.score > 0 ? SHADES[Math.min(4, Math.floor(item.score / 20))] : PALETTE.pebble)
    onOverlay({ colors })
  }, [scored, onOverlay])

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

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">أين جمهوري؟</h2>
      <Choice value={mode} onChange={setMode} options={[{ id: 'people', label: 'أستهدف أفراداً' }, { id: 'businesses', label: 'أستهدف منشآت' }]} />
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
            <p className="mb-1 text-sm text-muted-foreground">متوسط دخل الحي الشهري</p>
            <Choice value={minIncome} onChange={setMinIncome} options={INCOMES.map((value) => ({ id: value, label: value ? `${numberFormat.format(value)}+` : 'أي دخل' }))} />
          </div>
        </>
      ) : (
        <>
          <select value={mainId} onChange={(event) => setMainId(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-base">
            <option value="">كل الأنشطة</option>
            {activities.map((activity) => <option key={activity.main_id} value={activity.main_id}>{activity.main_ar}</option>)}
          </select>
        </>
      )}
      {status === 'loading' && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ الحساب" />}
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر الحساب.</p>}
      {status !== 'loading' && (
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-sm text-muted-foreground">حجم الجمهور {selected.length ? `في ${numberFormat.format(selected.length)} أحياء محددة` : 'في المدينة'}</p>
          {figures.map((figure) => (
            <Explained key={figure.key} title={figure.label ? `حجم الجمهور: ${figure.label}` : 'حجم الجمهور'} lines={[...explain, ...unknownLine(figure.unknown)]} className="mt-0.5 text-xl font-bold">
              {figure.label && <span className="font-normal text-muted-foreground">{figure.label}: </span>}
              {figure.list.length ? `${show(figure.list.reduce((sum, item) => sum + item.size, 0))} ${unit}` : 'غير متاح'}
            </Explained>
          ))}
        </div>
      )}
      {scored.length > 0 && status !== 'loading' && (
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
