'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import { circlePolygon, type Area, type Site } from '../lens-map-canvas'
import type { Overlay } from './overlay'
import { PALETTE } from '@/lib/palette'
import { useStickyState } from '@/lib/sticky-state'
import { breakEvenOrdersPerDay } from '@/lib/break-even'
import { completeComparisonMaximum } from '@/lib/complete-comparison'
import { requestWithDeadline } from '@/lib/optional-source'
import { parsePopulationWithin, type PopulationWithin } from '@/lib/population-within'
import { isActiveAroundKey, pruneAroundResults } from '@/lib/around-cache'

type Point = { lon: number; lat: number }
type Geometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
type Reach = { kind: 'radius'; metres: number } | { kind: 'drive'; minutes: number }
type Result = { status: 'loading' | 'ready' | 'error'; message?: string; geometry?: Geometry; figures?: PopulationWithin }
const REACHES: Reach[] = [
  { kind: 'radius', metres: 500 }, { kind: 'radius', metres: 1000 }, { kind: 'radius', metres: 2000 },
  { kind: 'drive', minutes: 5 }, { kind: 'drive', minutes: 10 }, { kind: 'drive', minutes: 15 },
]
const COLORS = [PALETTE.olive, PALETTE.ochre, PALETTE.slate]
const MAX_SITES = 3
const reachLabel = (reach: Reach) => (reach.kind === 'radius'
  ? (reach.metres < 1000 ? `${numberFormat.format(reach.metres)} م` : `${numberFormat.format(reach.metres / 1000)} كم`)
  : `${numberFormat.format(reach.minutes)} د بالسيارة`)
const sameReach = (a: Reach, b: Reach) => a.kind === b.kind && (a.kind === 'radius' ? a.metres === (b as typeof a).metres : a.minutes === (b as typeof a).minutes)
const show = (value: number | null | undefined) => (value == null ? 'غير متاح' : numberFormat.format(Math.round(value)))
const peopleExplanation = (figures: PopulationWithin): string[] => {
  if (!figures.people_per_district) return ['غير متاح: طبقة المباني لا تحتوي قياساً للسكان لكل مبنى.']
  if (figures.population == null) return ['غير متاح: بعض المباني داخل النطاق بلا قياس سكاني. لا نعرض مجموعاً جزئياً.']
  return [...EXPLAIN.aroundPeople, 'تقدير مكاني للمقارنة بين المواقع، وليس تعداداً للأفراد داخل كل مبنى.']
}

/** The area a site reaches: a circle on the ground, or the roads a car covers in the time (Valhalla isochrone). */
async function areaFor(point: Point, reach: Reach, signal: AbortSignal): Promise<Geometry> {
  if (reach.kind === 'radius') return circlePolygon({ ...point, radius_m: reach.metres }).geometry
  const response = await fetch('/api/routing/isochrone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locations: [point], costing: 'auto', contours_minutes: [reach.minutes] }),
    signal,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || 'تعذر حساب منطقة الوصول.')
  const geometry = (body?.features ?? []).map((feature: GeoJSON.Feature) => feature.geometry).find((g: GeoJSON.Geometry) => g?.type === 'Polygon' || g?.type === 'MultiPolygon')
  if (!geometry) throw new Error('تعذر حساب منطقة الوصول.')
  return geometry
}

/**
 * «قارن المواقع»: tap up to three candidate sites and compare who lives and what operates within the same reach of
 * each, by distance or by drive time on the real road network. Every figure is the same golden count as the rest of
 * Atlas, only the boundary differs.
 */
export function AroundTool({ onOverlay }: { onOverlay: (overlay: Overlay) => void }) {
  const [sites, setSites] = useState<(Point & { id: number })[]>([])
  const [reach, setReach] = useStickyState<Reach>('around.reach', REACHES[1])
  const [results, setResults] = useState<Record<string, Result>>({})
  const [averageOrder, setAverageOrder] = useState('')
  const [contributionMarginPercent, setContributionMarginPercent] = useState('')
  const [operatingDays, setOperatingDays] = useState('')
  const [monthlyCosts, setMonthlyCosts] = useState<Record<number, string>>({})
  const [retryVersion, setRetryVersion] = useState(0)
  const nextId = useRef(1)
  const requested = useRef(new Set<string>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // a fourth tap replaces the oldest site
  const pick = useCallback((point: Point) => {
    const id = nextId.current++
    setSites((current) => [...current.slice(-(MAX_SITES - 1)), { ...point, id }])
  }, [])

  const keyOf = useCallback((site: { id: number }) => `${site.id}|${reach.kind}|${reach.kind === 'radius' ? reach.metres : reach.minutes}`, [reach])

  // each site × reach is worked out once; results are keyed by both, so a late answer never lands on the wrong site
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const pending = new Set<string>()
    const activeSiteIds = new Set(sites.map((site) => String(site.id)))
    for (const key of requested.current) if (!isActiveAroundKey(key, activeSiteIds)) requested.current.delete(key)
    setResults((current) => pruneAroundResults(current, activeSiteIds))
    for (const site of sites) {
      const key = keyOf(site)
      if (requested.current.has(key)) continue
      requested.current.add(key)
      pending.add(key)
      setResults((current) => ({ ...current, [key]: { status: 'loading' } }))
      const settle = (result: Result) => {
        pending.delete(key)
        if (!active || !mounted.current) return
        if (result.status === 'error') requested.current.delete(key)
        setResults((current) => ({ ...current, [key]: result }))
      }
      requestWithDeadline(async (signal) => {
        const geometry = await areaFor(site, reach, signal)
        const figures = parsePopulationWithin(await postMarket<unknown>('population-within', { geometry }, signal))
        return { geometry, figures }
      }, controller.signal, 20_000)
        .then(({ geometry, figures }) => settle({ status: 'ready', geometry, figures }))
        .catch((error: Error) => settle({ status: 'error', message: error.name === 'TimeoutError' ? 'استغرق حساب الموقع وقتاً أطول من المتوقع.' : error.message || 'تعذر الحساب.' }))
    }
    return () => {
      active = false
      controller.abort()
      for (const key of pending) requested.current.delete(key)
    }
  }, [sites, reach, keyOf, retryVersion])

  const retry = (site: { id: number }) => {
    const key = keyOf(site)
    requested.current.delete(key)
    setResults((current) => ({ ...current, [key]: { status: 'loading' } }))
    setRetryVersion((current) => current + 1)
  }

  const labelled = useMemo(() => sites.map((site, index) => ({ ...site, label: numberFormat.format(index + 1), color: COLORS[index], result: results[keyOf(site)] })), [sites, results, keyOf])

  useEffect(() => {
    const areas: Area[] = labelled.flatMap((site) => (site.result?.geometry ? [{ id: String(site.id), color: site.color, geometry: site.result.geometry }] : []))
    const markers: Site[] = labelled.map((site) => ({ id: String(site.id), label: site.label, color: site.color, lon: site.lon, lat: site.lat }))
    onOverlay({ onPick: pick, areas, sites: markers })
  }, [labelled, pick, onOverlay])

  const rows: { label: string; value: (f: PopulationWithin) => number | null; explain: (f: PopulationWithin) => string[]; higherIsBetter?: boolean }[] = [
    { label: 'السكان', value: (f) => f.population, explain: peopleExplanation, higherIsBetter: true },
    { label: 'الوحدات السكنية', value: (f) => f.dwellings, explain: () => EXPLAIN.aroundHomes, higherIsBetter: true },
    { label: 'المنشآت', value: (f) => f.businesses, explain: () => EXPLAIN.aroundBusinesses },
    {
      label: 'ساكن لكل منشأة',
      value: (f) => f.residents_per,
      explain: (f) => f.population == null
        ? ['غير متاح لأن قياس السكان داخل المنطقة غير مكتمل.', 'لا نرتب المواقع بهذا المؤشر دون قيمة سكان موثوقة.']
        : ['السكان الموزعون تقديرياً داخل المنطقة ÷ المنشآت داخلها.', 'كلما ارتفع الرقم قلّت المنشآت التي تخدم السكان، أي منافسة أقل. لا يمثل تعداداً للأفراد.'],
      higherIsBetter: true,
    },
  ]
  const ready = labelled.filter((site) => site.result?.status === 'ready' && site.result.figures)
  const best = (row: (typeof rows)[number]) => {
    if (!row.higherIsBetter || labelled.length < 2) return null
    const values = labelled.map((site) => site.result?.status === 'ready' && site.result.figures
      ? row.value(site.result.figures)
      : null)
    return completeComparisonMaximum(values, labelled.length)
  }
  const asInput = (value: string) => value.trim() === '' ? null : Number(value)
  const commonInputs = {
    averageOrder: asInput(averageOrder),
    contributionMarginPercent: asInput(contributionMarginPercent),
    operatingDays: asInput(operatingDays),
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">قارن المواقع</h2>
      <p className="text-base text-muted-foreground">اضغط على الخريطة لإضافة موقع، حتى {numberFormat.format(MAX_SITES)} مواقع.</p>
      <div className="grid grid-cols-3 gap-1.5">
        {REACHES.map((value) => (
          <button key={reachLabel(value)} onClick={() => setReach(value)} aria-pressed={sameReach(reach, value)}
            className={cn('min-h-11 rounded-lg border px-1.5 py-2 text-base', sameReach(reach, value) ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
            {reachLabel(value)}
          </button>
        ))}
      </div>
      {reach.kind === 'drive' && (
        <Explained title="منطقة الوصول بالسيارة" lines={EXPLAIN.driveArea(reach.minutes)} className="text-sm text-muted-foreground">
          المنطقة: كل ما تصله السيارة في {numberFormat.format(reach.minutes)} دقائق على الطرق.
        </Explained>
      )}
      {labelled.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="text-sm text-muted-foreground">
                <th className="py-1.5 text-start font-medium" />
                {labelled.map((site) => (
                  <th key={site.id} className="py-1.5 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-flex size-6 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: site.color }}>{site.label}</span>
                      <button onClick={() => setSites((current) => current.filter((item) => item.id !== site.id))} aria-label={`إزالة الموقع ${site.label}`} className="text-muted-foreground hover:text-foreground">
                        <X className="size-4" aria-hidden />
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const top = best(row)
                return (
                  <tr key={row.label}>
                    <th className="py-2 text-start text-sm font-medium text-muted-foreground">{row.label}</th>
                    {labelled.map((site) => {
                      const result = site.result
                      if (!result || result.status === 'loading') return <td key={site.id} className="py-2 text-center"><Loader2 className="mx-auto size-4 animate-spin text-primary" aria-label="جارٍ الحساب" /></td>
                      if (result.status === 'error') return <td key={site.id} className="py-2 text-center text-sm text-destructive">
                        <span>{result.message}</span>
                        {row.label === 'السكان' && <button className="mt-1 block w-full text-primary underline" onClick={() => retry(site)}>إعادة المحاولة</button>}
                      </td>
                      const value = row.value(result.figures!)
                      return (
                        <td key={site.id} className="py-2 text-center">
                          <Explained title={row.label} lines={row.explain(result.figures!)} className={cn('font-bold', top != null && value === top && 'text-primary')}>{show(value)}</Explained>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {ready.length > 0 && (
        <div className="space-y-2">
          {ready.map((site) => site.result!.figures!.top_activities.length > 0 && (
            <div key={site.id}>
              <p className="mb-1 text-sm font-semibold text-muted-foreground">أكثر الأنشطة حول الموقع {site.label}</p>
              <ul className="space-y-1 text-base">
                {site.result!.figures!.top_activities.slice(0, 4).map((row) => (
                  <li key={row.activity} className="flex justify-between"><span>{row.activity}</span><span className="font-semibold">{numberFormat.format(row.n)}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <section className="space-y-3 rounded-xl border p-3" aria-labelledby="break-even-heading">
        <div>
          <h3 id="break-even-heading" className="font-semibold">اختبار نقطة التعادل</h3>
          <p className="text-sm text-muted-foreground">أدخل افتراضاتك. الحساب يوضح الطلبات اللازمة لتغطية التكاليف، ولا يتوقع المبيعات.</p>
        </div>
        <Explained title="طريقة الحساب" lines={[
            'التكلفة الثابتة الشهرية ÷ (متوسط قيمة الطلب × هامش المساهمة بعد التكلفة المتغيرة × أيام العمل الشهرية).',
          'نقرّب عدد الطلبات اليومية للأعلى. النتيجة حساب من افتراضاتك وليست توقعاً للطلب أو المبيعات.',
        ]} className="text-sm text-muted-foreground">كيف حُسبت؟</Explained>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-sm font-medium">
            <span>متوسط قيمة الطلب (ر.س)</span>
            <input aria-label="متوسط قيمة الطلب بالريال" type="number" min="0.01" step="0.01" inputMode="decimal" dir="ltr"
              value={averageOrder} onChange={(event) => setAverageOrder(event.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-base font-normal" />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>المتبقي بعد التكلفة المتغيرة (%)</span>
            <input aria-label="النسبة المتبقية من الطلب بعد التكلفة المتغيرة" type="number" min="0.01" max="100" step="0.01" inputMode="decimal" dir="ltr"
              value={contributionMarginPercent} onChange={(event) => setContributionMarginPercent(event.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-base font-normal" />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>أيام العمل بالشهر</span>
            <input aria-label="أيام العمل في الشهر" type="number" min="1" max="31" step="1" inputMode="numeric" dir="ltr"
              value={operatingDays} onChange={(event) => setOperatingDays(event.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-base font-normal" />
          </label>
        </div>
        {labelled.length === 0 ? (
          <p className="text-sm text-muted-foreground">أضف موقعاً من الخريطة لإدخال تكلفته ومقارنة نقطة التعادل.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {labelled.map((site) => {
              const cost = asInput(monthlyCosts[site.id] ?? '')
              const orders = breakEvenOrdersPerDay({ ...commonInputs, monthlyCosts: cost })
              return (
                <div key={site.id} className="space-y-2 rounded-lg bg-muted/40 p-3">
                  <label className="block space-y-1 text-sm font-medium">
                    <span>التكاليف الثابتة الشهرية — الموقع {site.label} (ر.س)</span>
                    <input aria-label={`التكاليف الثابتة الشهرية للموقع ${site.label} بالريال`} type="number" min="0.01" step="0.01" inputMode="decimal" dir="ltr"
                      value={monthlyCosts[site.id] ?? ''}
                      onChange={(event) => setMonthlyCosts((current) => ({ ...current, [site.id]: event.target.value }))}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-base font-normal" />
                  </label>
                  <div aria-live="polite">
                    <p className="text-sm text-muted-foreground">طلبات يومية للتعادل</p>
                    <p className="font-bold">{orders == null ? 'أكمل أو صحّح الافتراضات' : numberFormat.format(orders)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </section>
  )
}
