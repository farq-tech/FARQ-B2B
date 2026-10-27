'use client'

import { Loader2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { InsightMap } from '@/components/insights/insight-map'
import { numberFormat, postMarket, useCities, useDistricts } from '@/lib/insights-api'

type Territory = { territory: number; weight: number; share_pct: number | null; districts: { district_ar: string; district_id: string | number; weight: number }[] }
type Result = { territories: Territory[]; basis: string }

const PALETTE = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171', '#94a3b8', '#e879f9', '#a3e635', '#60a5fa']

export function TerritoriesView() {
  const cities = useCities()
  const [city, setCity] = useState('Riyadh')
  const districts = useDistricts(city)
  const [count, setCount] = useState(5)
  const [weight, setWeight] = useState<'population' | 'businesses'>('population')
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')
  const [error, setError] = useState('')

  async function run() {
    setStatus('loading')
    setError('')
    try {
      setResult(await postMarket<Result>('territories', { city, count, weight }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر التقسيم.')
    } finally {
      setStatus('idle')
    }
  }

  // divide as soon as the page opens or the city changes, so the map is never empty; the button reruns with new settings
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, [city])

  const colors = useMemo(() => Object.fromEntries((result?.territories ?? []).flatMap((group, index) =>
    group.districts.map((district) => [String(district.district_id), PALETTE[index % PALETTE.length]]))), [result])

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 pb-24 lg:py-10">
      <header>
        <p className="flex items-center gap-2 text-sm font-semibold text-primary"><Users className="size-4" aria-hidden /> مناطق المندوبين</p>
        <h1 className="mt-1 text-2xl font-bold">قسّم المدينة بين فريقك بالتساوي</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">كل منطقة مجموعة أحياء متجاورة تحمل حصة متساوية من السكان أو من المنشآت، حتى يتوزع العمل بعدل.</p>
      </header>
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs font-medium">المدينة
          <select value={city} onChange={(e) => { setCity(e.target.value); setResult(null) }} className="h-10 rounded-lg border bg-background px-3 text-sm">
            {cities.map((c) => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">عدد المندوبين
          <input type="number" min={2} max={50} value={count} onChange={(e) => setCount(Math.min(50, Math.max(2, Number(e.target.value) || 2)))} className="h-10 w-24 rounded-lg border bg-background px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">التوزيع حسب
          <select value={weight} onChange={(e) => setWeight(e.target.value as 'population' | 'businesses')} className="h-10 rounded-lg border bg-background px-3 text-sm">
            <option value="population">السكان (للبيع للأفراد)</option>
            <option value="businesses">المنشآت (للبيع للشركات)</option>
          </select>
        </label>
        <button onClick={run} disabled={status === 'loading'} className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' && <Loader2 className="size-4 animate-spin" aria-hidden />} قسّم
        </button>
      </section>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <InsightMap districts={districts} colors={colors} className="h-[480px]" />
        <section className="flex max-h-[480px] flex-col gap-2 overflow-y-auto">
          {(result?.territories ?? []).map((group, index) => (
            <article key={group.territory} className="rounded-xl border bg-card p-3">
              <header className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ background: PALETTE[index % PALETTE.length] }} aria-hidden />
                <h2 className="font-semibold">المنطقة {group.territory}</h2>
                <span className="ms-auto text-xs text-muted-foreground">{numberFormat.format(group.weight)} {weight === 'population' ? 'ساكن' : 'منشأة'} · {group.share_pct}٪</span>
              </header>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">{group.districts.map((district) => district.district_ar).join('، ')}</p>
            </article>
          ))}
          {result && <p className="text-xs leading-6 text-muted-foreground">{result.basis}</p>}
        </section>
      </div>
    </main>
  )
}
