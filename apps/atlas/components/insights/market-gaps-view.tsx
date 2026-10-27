'use client'

import { Loader2, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useCities } from '@/lib/insights-api'
import { cn } from '@/lib/utils'

type Activity = { main_id: string; main_ar: string; n: number }
type GapRow = {
  district_ar: string
  population: number
  businesses: number
  expected_businesses: number
  shortfall: number
  residents_per_business: number | null
  male_pct: number | null
}
type GapResult = { residents_per_business: number | null; districts: GapRow[]; basis: string; message?: string }

const number = new Intl.NumberFormat('ar-SA-u-nu-latn')
const EXAMPLES = ['صيدلية', 'مغسلة ملابس', 'بقالة', 'مطعم', 'صالون حلاقة', 'مخبز']

async function post<T>(resource: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/market/${resource}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error((payload && payload.error) || 'تعذر تحميل البيانات.')
  return payload as T
}

export function MarketGapsView() {
  const cities = useCities()
  const [city, setCity] = useState('Riyadh')
  const [activities, setActivities] = useState<Activity[]>([])
  const [mainId, setMainId] = useState('')
  const [query, setQuery] = useState('')
  const [minPopulation, setMinPopulation] = useState(5000)
  const [result, setResult] = useState<GapResult | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    setActivities([])
    setMainId('')
    post<{ summary?: { main_activities?: Activity[] } }>('market-summary', { city })
      .then((payload) => setActivities(payload.summary?.main_activities ?? []))
      .catch(() => setActivities([]))
  }, [city])

  async function run(example?: string) {
    const text = (example ?? query).trim()
    if (example) { setQuery(example); setMainId('') }
    if (!mainId && !text) return
    setStatus('loading')
    setError('')
    try {
      const body: Record<string, unknown> = { city, min_population: minPopulation, limit: 200 }
      if (text) body.q = text
      else body.main_id = mainId
      setResult(await post<GapResult>('market-gaps', body))
      setStatus('idle')
    } catch (failure) {
      setStatus('error')
      setError(failure instanceof Error ? failure.message : 'تعذر حساب الفجوات.')
    }
  }

  const gaps = result?.districts.filter((row) => row.shortfall > 0) ?? []
  const largest = Math.max(1, ...gaps.map((row) => row.shortfall))

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 pb-24 lg:py-10">
      <header>
        <p className="flex items-center gap-2 text-sm font-semibold text-primary"><TrendingUp className="size-4" aria-hidden /> فجوات السوق</p>
        <h1 className="mt-1 text-2xl font-bold">أين يوجد سكان أكثر من المنشآت التي تخدمهم؟</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
          اختر نشاطاً لترى الأحياء التي فيها منشآت أقل مما يتحمله عدد سكانها بمعدل المدينة نفسها. النتيجة دليل على مكان البحث، وليست إثباتاً لطلب مؤكد.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs font-medium">المدينة
          <select value={city} onChange={(e) => setCity(e.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm">
            {cities.map((c) => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}
          </select>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs font-medium">النشاط
          <div className="flex gap-2">
            <select value={mainId} onChange={(e) => { setMainId(e.target.value); setQuery('') }} className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm">
              <option value="">اختر نشاطاً رئيسياً</option>
              {activities.map((a) => <option key={a.main_id} value={a.main_id}>{a.main_ar}</option>)}
            </select>
            <input value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) setMainId('') }} placeholder="أو اكتب: صيدلية، مغسلة…" className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm" />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">أقل عدد سكان للحي
          <input type="number" min={0} step={1000} value={minPopulation} onChange={(e) => setMinPopulation(Math.max(0, Number(e.target.value) || 0))} className="h-10 w-32 rounded-lg border bg-background px-3 text-sm" />
        </label>
        <button onClick={() => run()} disabled={status === 'loading' || (!mainId && !query.trim())} className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' && <Loader2 className="size-4 animate-spin" aria-hidden />} احسب الفجوات
        </button>
      </section>

      {!result && status !== 'loading' && (
        <section className="rounded-2xl border border-dashed p-5 text-sm">
          <p className="font-semibold">جرّب نشاطاً بضغطة واحدة:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => run(example)} className="rounded-full border bg-background px-4 py-1.5 text-sm hover:border-primary hover:text-primary">{example}</button>
            ))}
          </div>
        </section>
      )}

      {status === 'error' && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      {result && (
        <section className="flex flex-col gap-3">
          {result.residents_per_business == null ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">{result.message || 'لا توجد بيانات كافية لهذا النشاط.'}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                معدل المدينة: منشأة لكل <strong className="text-foreground">{number.format(result.residents_per_business)}</strong> ساكن.
                {' '}{gaps.length ? `${number.format(gaps.length)} حياً تحت هذا المعدل.` : 'لا يوجد حي تحت معدل المدينة.'}
              </p>
              <div className="overflow-x-auto rounded-2xl border bg-card">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="p-3 text-start font-medium">الحي</th>
                      <th className="p-3 text-start font-medium">السكان</th>
                      <th className="p-3 text-start font-medium">المنشآت الحالية</th>
                      <th className="p-3 text-start font-medium">المتوقع بمعدل المدينة</th>
                      <th className="p-3 text-start font-medium">الفجوة</th>
                      <th className="p-3 text-start font-medium">ساكن لكل منشأة</th>
                      <th className="p-3 text-start font-medium">ذكور</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.districts.map((row) => (
                      <tr key={row.district_ar} className="border-t">
                        <td className="p-3 font-semibold"><Link href={`/insights/report?city=${encodeURIComponent(city)}&district=${encodeURIComponent(row.district_ar)}`} className="hover:text-primary hover:underline">{row.district_ar}</Link></td>
                        <td className="p-3">{number.format(row.population)}</td>
                        <td className="p-3">{number.format(row.businesses)}</td>
                        <td className="p-3">{number.format(Math.round(row.expected_businesses))}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className={cn('w-10 font-semibold', row.shortfall > 0 ? 'text-primary' : 'text-muted-foreground')}>
                              {row.shortfall > 0 ? `+${number.format(Math.round(row.shortfall))}` : number.format(Math.round(row.shortfall))}
                            </span>
                            {row.shortfall > 0 && <span className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.max(4, (row.shortfall / largest) * 120)}px` }} aria-hidden />}
                          </div>
                        </td>
                        <td className="p-3">{row.residents_per_business == null ? 'لا توجد منشأة' : number.format(row.residents_per_business)}</td>
                        <td className="p-3">{row.male_pct == null ? 'غير متاح' : `${row.male_pct}٪`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  )
}
