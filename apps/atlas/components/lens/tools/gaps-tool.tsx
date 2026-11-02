'use client'

import { useEffect, useState } from 'react'
import { useMainActivities } from '@/lib/main-activities'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket } from '@/lib/insights-api'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import type { Overlay } from './overlay'
import { gapsHoverLine, gapsSummary } from './gaps-summary'
import { PALETTE } from '@/lib/palette'
import { Icon3D } from '@/components/shared/icon-3d'
import { useStudiedActivity } from '@/lib/sticky-state'
import { Understood, type Understanding } from '@/components/shared/understood'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'

type Gap = { district_ar: string; population: number; businesses: number; expected_businesses: number; shortfall: number }
type Result = { residents_per_business: number | null; districts: Gap[]; understood?: Understanding }

const EXAMPLES = ['صيدلية', 'مغسلة ملابس', 'بقالة', 'مطعم', 'صالون حلاقة', 'مخبز']
const SURPLUS = PALETTE.pebble   // more businesses than the city rate carries
// districts with fewer residents are left out of the answer (a few people make any count look short or full)
const MIN_POPULATION = 5000

/** «أين ينقص نشاطي؟»: districts with fewer businesses of an activity than their people carry at the city's rate. */
export function GapsTool({ city, cityName, rows, onOverlay, onSelect, selected = [], onHover }: {
  city: string
  /** The city's Arabic name, for the line that says its districts have no population. */
  cityName?: string
  rows: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
  /** The districts picked on the map or anywhere else: their rows are marked. */
  selected?: string[]
  /** The row under the pointer or keyboard focus, so the map can outline its district. */
  onHover?: (id: string | null) => void
}) {
  const activities = useMainActivities(city)
  // the activity is shared with the other steps, so «المنافسون» opens on the one picked here
  const [studied, setStudied] = useStudiedActivity()
  const [query, setQuery] = useState(studied.q ?? '')
  // an activity set from elsewhere (a shared link, another step) shows in the box too
  useEffect(() => { setQuery(studied.q ?? '') }, [studied.q])
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  // the map opens painted with the studied activity; any other activity replaces it
  useEffect(() => {
    let live = true
    // the previous activity's answer goes at once, so the map never paints it under the new activity's name
    setResult(null)
    setStatus('loading')
    const body: Record<string, unknown> = { city, min_population: MIN_POPULATION, limit: 200, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) }
    postMarket<Result>('market-gaps', body)
      .then((data) => { if (live) { setResult(data); setStatus('idle') } })
      .catch(() => { if (live) setStatus('error') })
    return () => { live = false }
  }, [city, studied])

  const label = studied.label
  // a city none of whose districts has a population (most small cities today): no activity can be worked out there,
  // so the panel says why instead of «not enough data for this activity», which sent the visitor trying others
  const noPeople = rows.length > 0 && rows.every((row) => row.population == null)
  useEffect(() => {
    if (!result) { onOverlay({}); return }
    if (noPeople && result.residents_per_business == null) { onOverlay({ summary: 'سكان الأحياء غير متاحين هنا، فالنقص لا يُحسب' }); return }
    // no city rate, no shortfall anywhere: the map keeps its own shading instead of a blank city under «نقص …» while
    // the panel says there is not enough data
    if (result.residents_per_business == null) { onOverlay({ summary: `لا توجد بيانات كافية لـ«${label}»` }); return }
    const ids = new Map(rows.map((row) => [row.name, row.id]))
    const short = result.districts.filter((row) => row.shortfall > 0)
    const largest = Math.max(1, ...short.map((row) => row.shortfall))
    const colors = new Map<string, string>()
    for (const row of result.districts) {
      const id = ids.get(row.district_ar)
      if (!id) continue
      colors.set(id, row.shortfall > 0 ? SHADES[Math.min(4, Math.floor((5 * row.shortfall) / (largest + 1e-9)))] : SURPLUS)
    }
    const top = short[0]
    const summary = gapsSummary(result, counted)
    const answered = new Map(result.districts.map((row) => [row.district_ar, row]))
    const hover = new Map(rows.map((row) => [row.id, gapsHoverLine(answered.get(row.name), row.population, MIN_POPULATION, counted, numberFormat)]))
    onOverlay({ summary, hover, lead: top ? ids.get(top.district_ar) ?? null : null, colors, legend: { title: `نقص «${label}» في الأحياء`, from: 'نقص قليل', to: 'نقص كبير', shades: SHADES, extra: { color: SURPLUS, label: 'مكتفٍ' } } })
  }, [result, rows, onOverlay, label, noPeople])

  const study = (text: string) => { if (text) setStudied({ q: text, label: text }) }

  const ids = new Map(rows.map((row) => [row.name, row.id]))
  const gaps = result?.districts.filter((row) => row.shortfall > 0) ?? []
  // the bar only scales each row's shortfall, as the API returned it, against the largest in the list
  const widest = Math.max(0, ...gaps.map((row) => row.shortfall))
  const [limit, showMore] = useShowMore(20, `${city}|${label}`)

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">أين ينقص نشاطي؟</h2>
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') study(query.trim()) }}
          placeholder="اكتب نشاطك: صيدلية، مغسلة ملابس…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
        <button onClick={() => study(query.trim())} disabled={status === 'loading'} className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' ? 'جارٍ الحساب' : 'احسب'}
        </button>
      </div>
      <MainActivityPicker activities={activities} value={studied.main_id ?? ''} placeholder="أو اختر نشاطاً رئيسياً"
        onChange={(id) => { const item = activities.find((a) => a.main_id === id); if (item) { setQuery(''); setStudied({ main_id: item.main_id, label: item.main_ar }) } }} />
      <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button key={example} onClick={() => { setQuery(example); study(example) }} className="inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-3 text-sm hover:border-primary hover:text-primary"><Icon3D activity={example} />{example}</button>
          ))}
        </div>
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر الحساب.</p>}
      {/* the shape of the answer while it is worked out: district rows, each with its bar line */}
      {status === 'loading' && <ResultRowsSkeleton rows={5} sub label="جارٍ حساب النقص" />}
      {status !== 'loading' && studied.q && <Understood value={result?.understood} />}
      {status !== 'loading' && result && result.residents_per_business == null && (noPeople ? (
        <div role="status" className="flex flex-col gap-1 rounded-xl bg-muted/40 p-3 text-base">
          <p className="font-semibold">سكان أحياء {cityName ?? 'هذه المدينة'}: غير متاح بعد</p>
          <p className="text-sm text-muted-foreground">النقص يُحسب من سكان كل حي، فلا يُحسب هنا لأي نشاط. «المنافسون» و«شوارع النشاط» يعملان فيها من المنشآت.</p>
        </div>
      ) : <p className="text-base text-muted-foreground">لا توجد بيانات كافية لهذا النشاط.</p>)}
      {status !== 'loading' && result && result.residents_per_business != null && (
        <>
          {/* two facts, each kept whole: on a phone the one line used to break inside «فيها نقص» */}
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-base">
            <span className="whitespace-nowrap">معدل المدينة: منشأة لكل <strong className="tabular-nums">{numberFormat.format(result.residents_per_business)}</strong> ساكن</span>
            <span className="whitespace-nowrap text-muted-foreground">{counted(gaps.length, 'district')} فيها نقص</span>
          </p>
          <ol className="max-h-[45vh] divide-y overflow-y-auto text-base" aria-label="الأحياء الأكثر نقصاً">
            {gaps.slice(0, limit).map((row) => {
              const id = ids.get(row.district_ar)
              return (
                <ResultRow key={row.district_ar} title={row.district_ar} active={id != null && selected.includes(id)}
                  onClick={id ? () => onSelect(id) : undefined} onHover={(on) => onHover?.(on && id ? id : null)}
                  sub={(
                    // the bar scales the API's shortfall against the list's largest; the count stays the quiet figure
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className="block h-full rounded-full bg-primary/70" style={{ width: `${widest > 0 ? (100 * row.shortfall) / widest : 0}%` }} />
                      </span>
                      <span className="shrink-0 tabular-nums">{numberFormat.format(row.businesses)} موجودة</span>
                    </span>
                  )}
                  aside={(
                    <Explained title={`النقص في ${row.district_ar}`} lines={EXPLAIN.gap(row.expected_businesses, row.businesses, result.residents_per_business as number)} className="text-lg font-bold text-primary tabular-nums">
                      <bdi dir="ltr">+{numberFormat.format(Math.round(row.shortfall))}</bdi>
                    </Explained>
                  )} />
              )
            })}
          </ol>
          <MoreRows shown={Math.min(limit, gaps.length)} total={gaps.length} noun="district" onMore={showMore} />
        </>
      )}
    </section>
  )
}
