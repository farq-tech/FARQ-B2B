'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import type { DistrictRow } from '../city-data'
import type { Overlay } from './overlay'

type Territory = { territory: number; weight: number; share_pct: number | null; districts: { district_ar: string; district_id: string | number }[] }

const PALETTE = ['#d9f99d', '#38bdf8', '#f472b6', '#facc15', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171', '#94a3b8', '#e879f9', '#4ade80', '#60a5fa']

/** «تقسيم المندوبين»: the city split into neighbouring areas with an equal share of people or businesses each. */
export function TerritoriesTool({ city, rows, onOverlay }: { city: string; rows: DistrictRow[]; onOverlay: (overlay: Overlay) => void }) {
  const [count, setCount] = useState(5)
  const [weight, setWeight] = useState<'population' | 'businesses'>('population')
  const [groups, setGroups] = useState<Territory[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    let active = true
    setStatus('loading')
    postMarket<{ territories: Territory[] }>('territories', { city, count, weight })
      .then((data) => { if (active) { setGroups(data.territories); setStatus('idle') } })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [city, count, weight])

  useEffect(() => {
    if (!groups) { onOverlay({}); return }
    const ids = new Map(rows.map((row) => [row.name, row.id]))
    const colors = new Map<string, string>()
    groups.forEach((group, index) => group.districts.forEach((district) => {
      const id = ids.get(district.district_ar) ?? String(district.district_id)
      colors.set(id, PALETTE[index % PALETTE.length])
    }))
    onOverlay({ colors })
  }, [groups, rows, onOverlay])

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">تقسيم المندوبين</h2>
      <label className="flex items-center justify-between gap-3 text-base">عدد المندوبين
        <input type="number" min={2} max={50} value={count} onChange={(e) => setCount(Math.min(50, Math.max(2, Number(e.target.value) || 2)))}
          className="h-11 w-24 rounded-lg border bg-background px-3 text-base" />
      </label>
      <div className="flex gap-1.5">
        {(['population', 'businesses'] as const).map((value) => (
          <button key={value} onClick={() => setWeight(value)} aria-pressed={weight === value}
            className={cn('flex-1 rounded-lg border py-2 text-base', weight === value ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
            توازن {value === 'population' ? 'بالسكان' : 'بالمنشآت'}
          </button>
        ))}
      </div>
      {status === 'loading' && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ التقسيم" />}
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر التقسيم.</p>}
      {groups && status !== 'loading' && (
        <ol className="max-h-[45vh] space-y-2 overflow-y-auto">
          {groups.map((group, index) => (
            <li key={group.territory} className="rounded-xl bg-muted/40 p-3">
              <div className="flex items-center gap-2 text-base">
                <span className="size-3.5 rounded-sm" style={{ background: PALETTE[index % PALETTE.length] }} aria-hidden />
                <span className="font-bold">المندوب {numberFormat.format(index + 1)}</span>
                <Explained title={`حصة المندوب ${numberFormat.format(index + 1)}`} lines={EXPLAIN.territory(weight)} className="ms-auto font-semibold">
                  {numberFormat.format(Math.round(group.weight))} {weight === 'population' ? 'ساكن' : 'منشأة'}
                </Explained>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{group.districts.map((district) => district.district_ar).join('، ')}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
