'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import { MapLegend } from './map-legend'
import type { Overlay } from './overlay'
import { PALETTE } from '@/lib/palette'

type Activity = { main_id: string; main_ar: string }
type Gap = { district_ar: string; population: number; businesses: number; expected_businesses: number; shortfall: number }
type Result = { residents_per_business: number | null; districts: Gap[] }

const EXAMPLES = ['صيدلية', 'مغسلة ملابس', 'بقالة', 'مطعم', 'صالون حلاقة', 'مخبز']
const SURPLUS = PALETTE.pebble   // more businesses than the city rate carries

/** «أين ينقص نشاطي؟»: districts with fewer businesses of an activity than their people carry at the city's rate. */
export function GapsTool({ city, rows, onOverlay, onSelect }: {
  city: string
  rows: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
}) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [query, setQuery] = useState('')
  const [mainId, setMainId] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    setResult(null)
    // the map opens painted: the first example runs at once, and any activity replaces it
    setQuery(EXAMPLES[0])
    run(EXAMPLES[0], '')
    postMarket<{ summary?: { main_activities?: Activity[] } }>('market-summary', { city })
      .then((payload) => setActivities(payload.summary?.main_activities ?? []))
      .catch(() => setActivities([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city])

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
    onOverlay({ colors })
  }, [result, rows, onOverlay])

  async function run(text: string, main: string) {
    if (!text && !main) return
    setStatus('loading')
    try {
      const body: Record<string, unknown> = { city, min_population: 5000, limit: 200, ...(text ? { q: text } : { main_id: main }) }
      setResult(await postMarket<Result>('market-gaps', body))
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  const ids = new Map(rows.map((row) => [row.name, row.id]))
  const gaps = result?.districts.filter((row) => row.shortfall > 0) ?? []

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">أين ينقص نشاطي؟</h2>
      <div className="flex gap-2">
        <input value={query} onChange={(e) => { setQuery(e.target.value); setMainId('') }} onKeyDown={(e) => { if (e.key === 'Enter') run(query.trim(), '') }}
          placeholder="اكتب نشاطك: صيدلية، مغسلة…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
        <button onClick={() => run(query.trim(), mainId)} disabled={status === 'loading'} className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' ? <Loader2 className="size-5 animate-spin" aria-label="جارٍ الحساب" /> : 'احسب'}
        </button>
      </div>
      <select value={mainId} onChange={(e) => { setMainId(e.target.value); setQuery(''); run('', e.target.value) }} className="h-11 rounded-lg border bg-background px-3 text-base">
        <option value="">أو اختر نشاطاً رئيسياً</option>
        {activities.map((item) => <option key={item.main_id} value={item.main_id}>{item.main_ar}</option>)}
      </select>
      <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button key={example} onClick={() => { setQuery(example); run(example, '') }} className="rounded-full border px-3 py-1.5 text-sm hover:border-primary hover:text-primary">{example}</button>
          ))}
        </div>
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر الحساب.</p>}
      {result && result.residents_per_business == null && <p className="text-base text-muted-foreground">لا توجد بيانات كافية لهذا النشاط.</p>}
      {result && result.residents_per_business != null && (
        <>
          <p className="text-base">
            معدل المدينة: منشأة لكل <strong>{numberFormat.format(result.residents_per_business)}</strong> ساكن · {numberFormat.format(gaps.length)} حياً فيها نقص
          </p>
          <MapLegend from="نقص قليل" to="نقص كبير" shades={SHADES} extra={{ color: SURPLUS, label: 'مكتفٍ' }} />
          <ol className="max-h-[45vh] divide-y overflow-y-auto text-base">
            {gaps.map((row) => (
              <li key={row.district_ar} className="flex items-center gap-2 py-2">
                <button onClick={() => { const id = ids.get(row.district_ar); if (id) onSelect(id) }} className="flex-1 truncate text-start font-medium hover:text-primary">{row.district_ar}</button>
                <span className="text-sm text-muted-foreground">{numberFormat.format(row.businesses)} موجودة</span>
                <Explained title={`النقص في ${row.district_ar}`} lines={EXPLAIN.gap(row.expected_businesses, row.businesses, result.residents_per_business as number)} className="w-14 text-end font-bold text-primary">
                  +{numberFormat.format(Math.round(row.shortfall))}
                </Explained>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
