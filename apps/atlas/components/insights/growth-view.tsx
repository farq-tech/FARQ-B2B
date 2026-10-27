'use client'

import { Building2, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { InsightMap } from '@/components/insights/insight-map'
import { numberFormat, postMarket, useCities, useDistricts } from '@/lib/insights-api'

type GrowthRow = { district_id: string; district_ar: string; under_construction: number; new_buildings: number; homes_under_construction: number; floor_area_m2: number }
type GrowthResult = { available: boolean; districts: GrowthRow[]; basis: string }

const SCALE = ['#14532d', '#15803d', '#22c55e', '#a3e635', '#facc15']

export function GrowthView() {
  const cities = useCities()
  const [city, setCity] = useState('Riyadh')
  const districts = useDistricts(city)
  const [result, setResult] = useState<GrowthResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setResult(null)
    setError('')
    postMarket<GrowthResult>('growth', { city }).then(setResult).catch((failure) => setError(failure instanceof Error ? failure.message : 'تعذر تحميل النمو.'))
  }, [city])

  const rows = result?.districts ?? []
  const largest = Math.max(1, ...rows.map((row) => row.under_construction + row.new_buildings))
  const colors = useMemo(() => Object.fromEntries(rows.map((row) => {
    const share = (row.under_construction + row.new_buildings) / largest
    return [row.district_id, SCALE[Math.min(SCALE.length - 1, Math.floor(share * SCALE.length))]]
  })), [rows, largest])
  const total = rows.reduce((sum, row) => sum + row.under_construction, 0)
  const homes = rows.reduce((sum, row) => sum + row.homes_under_construction, 0)

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 pb-24 lg:py-10">
      <header>
        <p className="flex items-center gap-2 text-sm font-semibold text-primary"><Building2 className="size-4" aria-hidden /> خريطة النمو</p>
        <h1 className="mt-1 text-2xl font-bold">أين يُبنى الآن؟</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">المباني تحت الإنشاء والمباني الجديدة لكل حي. هنا يتجه الطلب القادم على مواد البناء والتكييف والأثاث والخدمات.</p>
      </header>
      <label className="flex w-full max-w-xs flex-col gap-1 text-xs font-medium">المدينة
        <select value={city} onChange={(e) => setCity(e.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm">
          {cities.map((c) => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!result && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> جارٍ التحميل…</p>}
      {result && !result.available && <p className="rounded-lg border p-4 text-sm text-muted-foreground">{result.basis}</p>}
      {result?.available && (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <InsightMap districts={districts} colors={colors} className="h-[460px]" />
          <section className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground"><strong className="text-foreground">{numberFormat.format(total)}</strong> مبنى تحت الإنشاء، منها <strong className="text-foreground">{numberFormat.format(homes)}</strong> سكني.</p>
            <ol className="flex max-h-[420px] flex-col gap-1 overflow-y-auto rounded-2xl border bg-card p-3 text-sm">
              {rows.slice(0, 40).map((row, index) => (
                <li key={row.district_id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                  <span className="w-6 text-xs text-muted-foreground">{index + 1}</span>
                  <span className="flex-1 font-semibold">{row.district_ar}</span>
                  <span className="text-xs text-muted-foreground">سكني {numberFormat.format(row.homes_under_construction)}</span>
                  <span className="w-14 text-end font-semibold text-primary">{numberFormat.format(row.under_construction + row.new_buildings)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
      {result?.available && <p className="text-xs leading-6 text-muted-foreground">{result.basis}</p>}
    </main>
  )
}
