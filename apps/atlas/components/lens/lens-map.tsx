'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { numberFormat, useCities } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import { useCityData, type DistrictRow } from './city-data'
import { DistrictPanel } from './district-panel'
import { LensMapCanvas, SHADES, shadeSteps } from './lens-map-canvas'
import { LENSES, METRICS, lensById, type LensId, type MetricId } from './lenses'

const format = (value: number | null, unit?: string) => (value == null ? 'غير متاح' : `${numberFormat.format(value)}${unit ? ` ${unit}` : ''}`)

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
      <h3 className="text-sm font-bold">الأعلى في {label}</h3>
      <ol className={cn('mt-2 divide-y text-sm', full && 'max-h-[50vh] overflow-y-auto')}>
        {shown.map((row, index) => (
          <li key={row.id}>
            <button onClick={() => onToggle(row.id)} className={cn('flex w-full items-center gap-2 py-1.5 text-start hover:text-primary', selected.includes(row.id) && 'text-primary')}>
              <span className="w-6 text-xs text-muted-foreground">{numberFormat.format(index + 1)}</span>
              <span className="flex-1 truncate font-medium">{row.name}</span>
              <span className="font-semibold tabular-nums">{format(value(row), unit)}</span>
            </button>
          </li>
        ))}
      </ol>
      {full && ranked.length < rows.length && <p className="mt-2 text-xs text-muted-foreground">{numberFormat.format(rows.length - ranked.length)} حياً: غير متاح</p>}
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
  const data = useCityData(city)

  useEffect(() => { setSelected([]) }, [city])
  useEffect(() => { setMetric(lensById(lens).metric) }, [lens])

  const steps = useMemo(() => shadeSteps(new Map(data.rows.map((row) => [row.id, METRICS[metric].value(row)]))), [data.rows, metric])
  const chosen = data.rows.filter((row) => selected.includes(row.id))
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const cityName = cities.find((item) => item.en === city)?.ar || city
  const active = lensById(lens)

  return (
    <main className="flex h-[calc(100dvh-4rem)] flex-col pb-16 lg:pb-0">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card/60 px-3 py-2">
        <select aria-label="المدينة" value={city} onChange={(e) => setCity(e.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm">
          {cities.map((item) => <option key={item.en} value={item.en}>{item.ar || item.en}</option>)}
        </select>
        <div role="tablist" aria-label="الفئة" className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
          {LENSES.map((item) => (
            <button key={item.id} role="tab" aria-selected={lens === item.id} onClick={() => setLens(item.id)}
              className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', lens === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" aria-label="المقياس على الخريطة">
          {active.metrics.map((id) => (
            <button key={id} onClick={() => setMetric(id)} aria-pressed={metric === id}
              className={cn('rounded-full border px-3 py-1 text-xs', metric === id ? 'border-primary text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {METRICS[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[50vh] shrink-0 lg:h-auto lg:flex-1">
          <LensMapCanvas features={data.features} steps={steps} selected={selected} onToggle={toggle} />
          <div className="absolute bottom-3 start-3 flex items-center gap-1 rounded-lg border bg-card/90 px-2 py-1.5 text-[11px] backdrop-blur">
            <span className="text-muted-foreground">أقل</span>
            {SHADES.map((shade) => <span key={shade} className="h-2.5 w-5 rounded-sm" style={{ background: shade }} />)}
            <span className="text-muted-foreground">أعلى · {METRICS[metric].label}</span>
          </div>
          {data.status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/40"><Loader2 className="size-6 animate-spin text-primary" aria-label="جارٍ التحميل" /></div>
          )}
        </div>
        <aside className="flex w-full flex-col gap-3 overflow-y-auto p-3 lg:w-[380px] lg:border-s">
          {data.status === 'error' ? (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">تعذر تحميل بيانات المدينة.</p>
          ) : (
            <>
              <DistrictPanel city={city} cityName={cityName} lens={lens} rows={data.rows} selected={chosen} total={data.total} onClear={() => setSelected([])} />
              <Ranking rows={data.rows} metric={metric} selected={selected} onToggle={toggle} full={lens === 'analysts'} />
            </>
          )}
        </aside>
      </div>
    </main>
  )
}
