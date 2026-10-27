'use client'

import { Building2, Loader2 } from 'lucide-react'
import Link from 'next/link'
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
  const fresh = rows.reduce((sum, row) => sum + row.new_buildings, 0)

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
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border bg-card p-3"><dt className="text-xs text-muted-foreground">تحت الإنشاء</dt><dd className="text-xl font-bold">{numberFormat.format(total)}</dd></div>
              <div className="rounded-xl border bg-card p-3"><dt className="text-xs text-muted-foreground">منها سكني</dt><dd className="text-xl font-bold">{numberFormat.format(homes)}</dd></div>
              <div className="rounded-xl border bg-card p-3"><dt className="text-xs text-muted-foreground">مبانٍ جديدة</dt><dd className="text-xl font-bold">{numberFormat.format(fresh)}</dd></div>
            </dl>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              لون الحي حسب مجموع ما يُبنى فيه:
              {SCALE.map((color) => <span key={color} className="inline-block size-3 rounded-sm" style={{ background: color }} aria-hidden />)}
              <span>أقل ← أكثر</span>
            </p>
            <div className="max-h-[380px] overflow-y-auto rounded-2xl border bg-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                  <tr><th className="p-2 text-start">#</th><th className="p-2 text-start">الحي</th><th className="p-2 text-end">تحت الإنشاء</th><th className="p-2 text-end">منها سكني</th><th className="p-2 text-end">جديدة</th><th className="p-2 text-end">مساحة الطوابق (جديدة وتحت الإنشاء)</th></tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.district_id} className="border-t hover:bg-muted/50">
                      <td className="p-2 text-xs text-muted-foreground">{index + 1}</td>
                      <td className="p-2 font-semibold"><Link href={`/insights/report?city=${encodeURIComponent(city)}&district=${encodeURIComponent(row.district_ar)}`} className="hover:text-primary hover:underline">{row.district_ar}</Link></td>
                      <td className="p-2 text-end font-semibold text-primary">{numberFormat.format(row.under_construction)}</td>
                      <td className="p-2 text-end">{numberFormat.format(row.homes_under_construction)}</td>
                      <td className="p-2 text-end">{numberFormat.format(row.new_buildings)}</td>
                      <td className="p-2 text-end">{numberFormat.format(row.floor_area_m2)} م²</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{`${numberFormat.format(rows.length)} حياً. اضغط اسم الحي لفتح تقريره الكامل.`}</p>
          </section>
        </div>
      )}
    </main>
  )
}
