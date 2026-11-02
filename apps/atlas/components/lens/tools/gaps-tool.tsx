'use client'

import { useEffect, useState } from 'react'
import { useMainActivities } from '@/lib/main-activities'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket } from '@/lib/insights-api'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import type { Overlay } from './overlay'
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

/** «أين ينقص نشاطي؟»: districts with fewer businesses of an activity than their people carry at the city's rate. */
export function GapsTool({ city, rows, onOverlay, onSelect, selected = [], onHover }: {
  city: string
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
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  // the map opens painted with the studied activity; any other activity replaces it
  useEffect(() => {
    let live = true
    setStatus('loading')
    const body: Record<string, unknown> = { city, min_population: 5000, limit: 200, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) }
    postMarket<Result>('market-gaps', body)
      .then((data) => { if (live) { setResult(data); setStatus('idle') } })
      .catch(() => { if (live) setStatus('error') })
    return () => { live = false }
  }, [city, studied])

  const label = studied.label
  useEffect(() => {
    if (!result) { onOverlay({}); return }
    const ids = new Map(rows.map((row) => [row.name, row.id]))
    const short = result.districts.filter((row) => row.shortfall > 0)
    const largest = Math.max(1, ...short.map((row) => row.shortfall))
    const colors = new Map<string, string>()
    for (const row of result.districts) {
      const id = ids.get(row.district_ar)
      if (!id) continue
      colors.set(id, row.shortfall > 0 ? SHADES[Math.min(4, Math.floor((5 * row.shortfall) / (largest + 1e-9)))] : SURPLUS)
    }
    // the API returns the districts largest shortfall first, so the first short one is the top of the list; the
    // figure is isolated left to right so its «+» stays in front of it inside the Arabic line
    const top = short[0]
    const summary = result.residents_per_business == null ? null
      : top ? `${counted(short.length, 'district')} فيها نقص · الأعلى: ${top.district_ar} \u2066+${numberFormat.format(Math.round(top.shortfall))}\u2069` : 'لا نقص في أي حي'
    onOverlay({ summary, colors, legend: { title: `نقص «${label}» في الأحياء`, from: 'نقص قليل', to: 'نقص كبير', shades: SHADES, extra: { color: SURPLUS, label: 'مكتفٍ' } } })
  }, [result, rows, onOverlay, label])

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
      {status !== 'loading' && result && result.residents_per_business == null && <p className="text-base text-muted-foreground">لا توجد بيانات كافية لهذا النشاط.</p>}
      {status !== 'loading' && result && result.residents_per_business != null && (
        <>
          <p className="text-base">
            معدل المدينة: منشأة لكل <strong>{numberFormat.format(result.residents_per_business)}</strong> ساكن · {counted(gaps.length, 'district')} فيها نقص
          </p>
          <ol className="max-h-[45vh] divide-y overflow-y-auto text-base" aria-label="الأحياء الأكثر نقصاً">
            {gaps.slice(0, limit).map((row) => {
              const id = ids.get(row.district_ar)
              return (
                <ResultRow key={row.district_ar} title={row.district_ar} active={id != null && selected.includes(id)}
                  onClick={id ? () => onSelect(id) : undefined} onPoint={(on) => onHover?.(on && id ? id : null)}
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
