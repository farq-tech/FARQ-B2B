'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN, populationMethod } from '@/lib/explanations'
import { numberFormat, useCities } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import { useCityData, type DistrictRow } from './city-data'
import { DistrictPanel } from './district-panel'
import { LensMapCanvas, SHADES, shadeSteps } from './lens-map-canvas'
import { LENSES, METRICS, lensById, type LensId, type MetricId } from './lenses'
import { AroundTool } from './tools/around-tool'
import { GapsTool } from './tools/gaps-tool'
import type { Overlay } from './tools/overlay'
import { TerritoriesTool } from './tools/territories-tool'

/** The insight tools, named by the question each one answers; their results are drawn on the one map. */
type ToolId = 'district' | 'gaps' | 'around' | 'growth' | 'territories'
const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'district', label: 'الحي' },
  { id: 'gaps', label: 'أين ينقص نشاطي؟' },
  { id: 'around', label: 'كم شخص حول موقع؟' },
  { id: 'growth', label: 'أين يُبنى الآن؟' },
  { id: 'territories', label: 'تقسيم المندوبين' },
]
// the tool each group starts on (docs/atlas-product-foundation.md §4)
const START: Record<LensId, ToolId> = { shops: 'gaps', marketers: 'district', distributors: 'territories', analysts: 'district' }

const format = (value: number | null, unit?: string) => (value == null ? 'غير متاح' : `${numberFormat.format(value)}${unit ? ` ${unit}` : ''}`)

/** The explanation of one district's value of the shading metric. */
function metricExplanation(metric: MetricId, row: DistrictRow): string[] {
  switch (metric) {
    case 'population': return [populationMethod(row.populationSource)]
    case 'businesses': return EXPLAIN.businesses('district')
    case 'residentsPerBusiness': return EXPLAIN.residentsPerBusiness(row.population, row.businesses)
    case 'whatsapp': return EXPLAIN.whatsapp
    case 'restaurants': return EXPLAIN.restaurants
    case 'income': return EXPLAIN.income
    case 'growth': return EXPLAIN.growth(row.underConstruction, row.newBuildings)
  }
}

function Ranking({ rows, metric, selected, onToggle, full }: {
  rows: DistrictRow[]
  metric: MetricId
  selected: string[]
  onToggle: (id: string) => void
  full: boolean
}) {
  const { label, value, unit } = METRICS[metric]
  const ranked = rows.filter((row) => value(row) != null).sort((a, b) => (value(b) as number) - (value(a) as number))
  const shown = full ? ranked : ranked.slice(0, 5)
  return (
    <section aria-label={`ترتيب الأحياء حسب ${label}`} className="rounded-2xl border bg-card p-4">
      <h3 className="text-base font-bold">الأعلى في {label}</h3>
      <ol className={cn('mt-2 divide-y text-base', full && 'max-h-[50vh] overflow-y-auto')}>
        {shown.map((row, index) => (
          <li key={row.id}>
            <div className={cn('flex w-full items-center gap-2 py-2', selected.includes(row.id) && 'text-primary')}>
              <span className="w-6 text-sm text-muted-foreground">{numberFormat.format(index + 1)}</span>
              <button onClick={() => onToggle(row.id)} className="flex-1 truncate text-start font-medium hover:text-primary">{row.name}</button>
              <Explained title={`${label} · ${row.name}`} lines={metricExplanation(metric, row)} className="font-semibold tabular-nums">{format(value(row), unit)}</Explained>
            </div>
          </li>
        ))}
      </ol>
      {full && ranked.length < rows.length && <p className="mt-2 text-sm text-muted-foreground">{numberFormat.format(rows.length - ranked.length)} حياً: غير متاح</p>}
    </section>
  )
}

/** Atlas map with one lens per user group (docs/atlas-product-foundation.md §4). */
export function LensMap() {
  const cities = useCities()
  const [city, setCity] = useState('Riyadh')
  const [lens, setLens] = useState<LensId>('shops')
  const [metric, setMetric] = useState<MetricId>(lensById('shops').metric)
  const [selected, setSelected] = useState<string[]>([])
  const [tool, setTool] = useState<ToolId>(START.shops)
  const [overlay, setOverlay] = useState<Overlay>({})
  const data = useCityData(city)
  const onOverlay = useCallback((next: Overlay) => setOverlay(next), [])

  useEffect(() => { setSelected([]) }, [city])
  useEffect(() => { setMetric(lensById(lens).metric); setTool(START[lens]) }, [lens])
  useEffect(() => {
    setOverlay({})
    if (tool === 'growth') setMetric('growth')
  }, [tool])
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get('tool')
    if (preset && TOOLS.some((item) => item.id === preset)) setTool(preset as ToolId)
  }, [])

  const steps = useMemo(() => shadeSteps(new Map(data.rows.map((row) => [row.id, METRICS[metric].value(row)]))), [data.rows, metric])
  const chosen = data.rows.filter((row) => selected.includes(row.id))
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const cityName = cities.find((item) => item.en === city)?.ar || city
  const active = lensById(lens)

  return (
    <main className="flex h-[calc(100dvh-4rem)] flex-col pb-16 lg:pb-0">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card/60 px-3 py-2">
        <select aria-label="المدينة" value={city} onChange={(e) => setCity(e.target.value)} className="h-10 rounded-lg border bg-background px-3 text-base">
          {cities.map((item) => <option key={item.en} value={item.en}>{item.ar || item.en}</option>)}
        </select>
        <div role="tablist" aria-label="الفئة" className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
          {LENSES.map((item) => (
            <button key={item.id} role="tab" aria-selected={lens === item.id} onClick={() => setLens(item.id)}
              className={cn('rounded-lg px-3 py-1.5 text-base font-medium transition-colors', lens === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" aria-label="المقياس على الخريطة">
          {active.metrics.map((id) => (
            <button key={id} onClick={() => setMetric(id)} aria-pressed={metric === id}
              className={cn('rounded-full border px-3 py-1 text-sm', metric === id ? 'border-primary text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {METRICS[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[50vh] shrink-0 lg:h-auto lg:flex-1">
          <LensMapCanvas features={data.features} steps={steps} selected={selected} onToggle={toggle} colors={overlay.colors} circle={overlay.circle} onPick={overlay.onPick} points={overlay.points} lines={overlay.lines} start={overlay.start} />
          {!overlay.colors && <Explained title="ألوان الخريطة" lines={EXPLAIN.shading(METRICS[metric].label)} className="absolute bottom-3 start-3 flex items-center gap-1 rounded-lg border bg-card/90 px-2.5 py-2 text-sm no-underline backdrop-blur">
            <span className="text-muted-foreground">أقل</span>
            {SHADES.map((shade) => <span key={shade} className="h-3 w-6 rounded-sm" style={{ background: shade }} />)}
            <span className="text-muted-foreground">أعلى · {METRICS[metric].label}</span>
          </Explained>}
          {data.status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/40"><Loader2 className="size-6 animate-spin text-primary" aria-label="جارٍ التحميل" /></div>
          )}
        </div>
        <aside className="flex w-full flex-col gap-3 overflow-y-auto p-3 lg:w-[380px] lg:border-s">
          {data.status === 'error' ? (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">تعذر تحميل بيانات المدينة.</p>
          ) : (
            <>
              <div role="tablist" aria-label="الأدوات" className="flex flex-wrap gap-1.5">
                {TOOLS.map((item) => (
                  <button key={item.id} role="tab" aria-selected={tool === item.id} onClick={() => setTool(item.id)}
                    className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', tool === item.id ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {item.label}
                  </button>
                ))}
              </div>
              {tool === 'gaps' && <GapsTool city={city} rows={data.rows} onOverlay={onOverlay} onSelect={(id) => setSelected([id])} />}
              {tool === 'around' && <AroundTool onOverlay={onOverlay} />}
              {tool === 'territories' && <TerritoriesTool city={city} rows={data.rows} onOverlay={onOverlay} />}
              {(tool === 'district' || tool === 'growth' || selected.length > 0) && tool !== 'around' && (
                <DistrictPanel city={city} cityName={cityName} lens={lens} rows={data.rows} selected={chosen} total={data.total} onClear={() => setSelected([])} />
              )}
              {(tool === 'district' || tool === 'growth') && <Ranking rows={data.rows} metric={metric} selected={selected} onToggle={toggle} full={lens === 'analysts' || tool === 'growth'} />}
            </>
          )}
        </aside>
      </div>
    </main>
  )
}
