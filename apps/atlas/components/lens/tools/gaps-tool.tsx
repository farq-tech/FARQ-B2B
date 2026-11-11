'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket, useMainActivities } from '@/lib/insights-api'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import { MapLegend } from './map-legend'
import type { Overlay } from './overlay'
import { PALETTE } from '@/lib/palette'
import { Icon3D } from '@/components/shared/icon-3d'
import { useStudiedActivity } from '@/lib/sticky-state'
import { isMarketGapResponse, marketGapCoverage, type MarketGapResponse } from '@/lib/market-gap'
import { joinDistrictByIdOrUniqueName } from '@/lib/district-join'
import { Understood } from '@/components/shared/understood'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'

type Result = MarketGapResponse

const EXAMPLES = ['صيدلية', 'مغسلة ملابس', 'بقالة', 'مطعم', 'صالون حلاقة', 'مخبز']
const SURPLUS = PALETTE.pebble   // more businesses than the city rate carries

/** «أين ينقص نشاطي؟»: districts with fewer businesses of an activity than their people carry at the city's rate. */
export function GapsTool({ city, rows, onOverlay, onSelect }: {
  city: string
  rows: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
}) {
  const { activities, status: activityStatus, retry: retryActivities } = useMainActivities(city)
  // the activity is shared with the other steps, so «المنافسون» opens on the one picked here
  const [studied, setStudied] = useStudiedActivity()
  const [query, setQuery] = useState(studied.q ?? '')
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  // the map opens painted with the studied activity; any other activity replaces it
  useEffect(() => {
    let live = true
    const controller = new AbortController()
    setStatus('loading')
    setResult(null)
    const body: Record<string, unknown> = { city, min_population: 5000, limit: 200, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) }
    postMarket<unknown>('market-gaps', body, controller.signal)
      .then((data) => {
        if (!isMarketGapResponse(data, city)) throw new Error('Invalid market gaps')
        if (live) { setResult(data); setStatus('idle') }
      })
      .catch(() => { if (live && !controller.signal.aborted) setStatus('error') })
    return () => { live = false; controller.abort() }
  }, [city, studied])

  useEffect(() => {
    if (!result) { onOverlay({}); return }
    const byDistrict = joinDistrictByIdOrUniqueName(rows, result.districts)
    const hasFitScore = (result.fit_sample_districts ?? 0) > 0
    const short = result.districts.filter((row) => row.shortfall > 0)
    const largest = Math.max(1, ...short.map((row) => row.shortfall))
    const colors = new Map<string, string>()
    for (const target of rows) {
      const row = byDistrict.get(target.id)
      if (!row) continue
      if (hasFitScore) {
        colors.set(target.id, row.fit_score == null ? SURPLUS : SHADES[Math.min(4, Math.floor(row.fit_score / 20))])
      } else {
        colors.set(target.id, row.shortfall > 0 ? SHADES[Math.min(4, Math.floor((5 * row.shortfall) / (largest + 1e-9)))] : SURPLUS)
      }
    }
    onOverlay({ colors })
  }, [result, rows, onOverlay])

  const study = (text: string) => { if (text) setStudied({ q: text, label: text }) }

  const rankedDistricts = result ? joinDistrictByIdOrUniqueName(rows, result.districts) : new Map()
  const gapIds = new Map([...rankedDistricts].map(([id, row]) => [row, id]))
  const gaps = result?.districts.filter((row) => row.shortfall > 0) ?? []
  const hasFitScore = (result?.fit_sample_districts ?? 0) > 0
  const rankedGaps = [...gaps].sort((a, b) => hasFitScore
    ? (b.fit_score ?? -1) - (a.fit_score ?? -1) || b.shortfall - a.shortfall || a.district_ar.localeCompare(b.district_ar)
    : b.shortfall - a.shortfall || a.district_ar.localeCompare(b.district_ar))
  const sample = result?.rate_sample_districts
  const populationDistricts = result?.districts_with_population
  const rateCoverage = marketGapCoverage(sample, populationDistricts)

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">أين ينقص نشاطي؟</h2>
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') study(query.trim()) }}
          placeholder="اكتب نشاطك: صيدلية، مغسلة ملابس…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
        <button onClick={() => study(query.trim())} disabled={status === 'loading'} className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' ? <Loader2 className="size-5 animate-spin" aria-label="جارٍ الحساب" /> : 'احسب'}
        </button>
      </div>
      <MainActivityPicker activities={activities} value={studied.main_id ?? ''} valueLabel={studied.main_id ? studied.label : undefined} placeholder="أو اختر نشاطاً رئيسياً"
        onChange={(id) => { const item = activities.find((a) => a.main_id === id); if (item) { setQuery(''); setStudied({ main_id: item.main_id, label: item.main_ar }) } }} status={activityStatus} onRetry={retryActivities} />
      <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button key={example} onClick={() => { setQuery(example); study(example) }} className="inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-3 text-sm hover:border-primary hover:text-primary"><Icon3D activity={example} />{example}</button>
          ))}
        </div>
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر الحساب.</p>}
      {status !== 'loading' && studied.q && <Understood value={result?.understood} />}
      {result && result.residents_per_business == null && <p className="text-base text-muted-foreground">{result.message ?? 'لا توجد بيانات كافية لهذا النشاط.'}</p>}
      {result && result.residents_per_business != null && (
        <>
          <p className="text-base">
            معدل الأحياء المرصودة: منشأة لكل <strong>{numberFormat.format(result.residents_per_business)}</strong> ساكن · {numberFormat.format(gaps.length)} أحياء بإشارة نقص أولية
          </p>
          {rateCoverage
            ? <p className="text-sm text-muted-foreground">حُسب المعدل من {numberFormat.format(rateCoverage.sample)} من أصل {numberFormat.format(rateCoverage.total)} حياً لها قياس سكاني وتظهر فيها منشأة من النشاط. الأحياء الأخرى لا تدخل في المعدل؛ وغياب سجل من الدليل لا يثبت غياب المنشأة أو وجود طلب غير مخدوم.</p>
            : <p className="text-sm text-muted-foreground">نطاق الأحياء التي بُني عليها المعدل غير متاح من الخدمة الحالية؛ تعامل مع المقارنة كمؤشر أولي فقط.</p>}
          {hasFitScore
            ? <MapLegend from="جاذبية نسبية أقل" to="أعلى" shades={SHADES} extra={{ color: SURPLUS, label: 'الدخل غير متاح' }} />
            : <MapLegend from="إشارة أولية أقل" to="إشارة أولية أكبر" shades={SHADES} extra={{ color: SURPLUS, label: 'سجلات فوق المعدل' }} />}
          {hasFitScore
            ? <p className="text-sm text-muted-foreground">درجة الجاذبية متاحة في {numberFormat.format(result.fit_sample_districts!)} من {numberFormat.format(result.fit_candidate_districts ?? result.fit_sample_districts!)} أحياء ذات سكان مقاسين؛ بقية الأحياء بلا دخل مقاس.</p>
            : <p className="text-sm text-muted-foreground">درجة الجاذبية غير متاحة؛ لا توجد أحياء ضمن النطاق اكتملت فيها قياسات الدخل وفجوة النشاط معاً. الترتيب هنا بحسب فجوة النشاط فقط.</p>}
          <ol className="max-h-[45vh] divide-y overflow-y-auto text-base">
            {rankedGaps.map((row) => (
              <li key={row.district_id ?? row.district_ar} className="flex items-center gap-2 py-2">
                <button onClick={() => { const id = gapIds.get(row); if (id) onSelect(id) }} className="flex-1 truncate text-start font-medium hover:text-primary">{row.district_ar}</button>
                <span className="text-sm text-muted-foreground">في الدليل: {numberFormat.format(row.businesses)}</span>
                {hasFitScore && <Explained title={`جاذبية الموقع في ${row.district_ar}`} lines={EXPLAIN.siteFit(row.fit_score ?? null, row.fit_gap_rank ?? null, row.fit_income_rank ?? null, result.fit_sample_districts ?? 0)} className="whitespace-nowrap text-sm font-semibold text-foreground">{row.fit_score == null ? 'غير متاح' : `${numberFormat.format(row.fit_score)}/100`}</Explained>}
                <Explained title={`إشارة المقارنة في ${row.district_ar}`} lines={EXPLAIN.gap(row.expected_businesses, row.businesses, result.residents_per_business as number, result.rate_sample_districts, result.districts_with_population)} className="w-14 text-end font-bold text-primary">
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
