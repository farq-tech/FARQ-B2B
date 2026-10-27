'use client'

import { Loader2, LocateFixed } from 'lucide-react'
import { useState } from 'react'
import { InsightMap } from '@/components/insights/insight-map'
import { numberFormat, postMarket, useCities, useDistricts } from '@/lib/insights-api'

type Around = {
  radius_m: number
  home_buildings?: number
  dwellings: number | null
  population: number | null
  businesses: number | null
  top_activities: { activity: string; n: number }[]
  basis: string
}

const RADII = [250, 500, 1000, 2000]

export function AroundView() {
  const cities = useCities()
  const [city, setCity] = useState('Riyadh')
  const districts = useDistricts(city)
  const [point, setPoint] = useState<{ lon: number; lat: number } | null>(null)
  const [radius, setRadius] = useState(500)
  const [result, setResult] = useState<Around | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')
  const [error, setError] = useState('')

  async function measure(next: { lon: number; lat: number }, radius_m: number) {
    setPoint(next)
    setStatus('loading')
    setError('')
    try {
      setResult(await postMarket<Around>('population-around', { ...next, radius_m }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر الحساب.')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 pb-24 lg:py-10">
      <header>
        <p className="flex items-center gap-2 text-sm font-semibold text-primary"><LocateFixed className="size-4" aria-hidden /> السكان حول موقع</p>
        <h1 className="mt-1 text-2xl font-bold">كم شخصاً يعيش حول هذا الموقع؟</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">انقر على الخريطة لموقع فرع أو متجر مقترح، واختر نصف القطر. ترى الوحدات السكنية والسكان التقديريين والمنشآت المنافسة حوله.</p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">المدينة
          <select value={city} onChange={(e) => { setCity(e.target.value); setPoint(null); setResult(null) }} className="h-10 rounded-lg border bg-background px-3 text-sm">
            {cities.map((c) => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs font-medium">نصف القطر
          <div className="flex gap-1">
            {RADII.map((value) => (
              <button key={value} onClick={() => { setRadius(value); if (point) measure(point, value) }} className={`h-10 rounded-lg border px-3 text-sm ${radius === value ? 'border-primary bg-primary/10 font-semibold text-primary' : 'bg-background'}`}>
                {value >= 1000 ? `${value / 1000} كم` : `${value} م`}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <InsightMap districts={districts} circle={point ? { ...point, radius_m: radius } : null} onPick={(next) => measure(next, radius)} className="h-[480px]" />
        <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
          {!point && <p className="text-sm text-muted-foreground">انقر على أي نقطة في الخريطة للبدء.</p>}
          {status === 'loading' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> جارٍ الحساب…</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {result && status === 'idle' && (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">السكان التقديريون</dt><dd className="text-xl font-bold">{result.population == null ? 'غير متاح' : numberFormat.format(result.population)}</dd></div>
                <div className="rounded-xl bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">الوحدات السكنية</dt><dd className="text-xl font-bold">{result.dwellings == null ? 'غير متاح' : numberFormat.format(Math.round(result.dwellings))}</dd></div>
                <div className="rounded-xl bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">مبانٍ سكنية</dt><dd className="text-xl font-bold">{result.home_buildings == null ? 'غير متاح' : numberFormat.format(result.home_buildings)}</dd></div>
                <div className="rounded-xl bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">منشآت في الدليل</dt><dd className="text-xl font-bold">{result.businesses == null ? 'غير متاح' : numberFormat.format(result.businesses)}</dd></div>
              </dl>
              {result.top_activities.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">أكثر الأنشطة حول الموقع</p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {result.top_activities.map((row) => <li key={row.activity} className="flex justify-between"><span>{row.activity}</span><span className="font-semibold">{numberFormat.format(row.n)}</span></li>)}
                  </ul>
                </div>
              )}
              <p className="text-xs leading-6 text-muted-foreground">{result.basis}</p>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
