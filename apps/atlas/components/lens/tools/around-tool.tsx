'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import type { Overlay } from './overlay'

type Around = { population: number | null; dwellings: number | null; businesses: number | null; top_activities: { activity: string; n: number }[] }
type Point = { lon: number; lat: number }

const RADII = [250, 500, 1000, 2000]
const show = (value: number | null) => (value == null ? 'غير متاح' : numberFormat.format(Math.round(value)))

/** «كم شخص حول موقع؟»: tap the map, get people, homes and businesses within a radius of that point. */
export function AroundTool({ onOverlay }: { onOverlay: (overlay: Overlay) => void }) {
  const [point, setPoint] = useState<Point | null>(null)
  const [radius, setRadius] = useState(500)
  const [result, setResult] = useState<Around | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  const pick = useCallback((next: Point) => setPoint(next), [])

  useEffect(() => {
    onOverlay({ onPick: pick, circle: point ? { ...point, radius_m: radius } : null })
  }, [point, radius, pick, onOverlay])

  useEffect(() => {
    if (!point) return
    let active = true
    setStatus('loading')
    postMarket<Around>('population-around', { ...point, radius_m: radius })
      .then((data) => { if (active) { setResult(data); setStatus('idle') } })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [point, radius])

  const figure = (label: string, value: number | null, lines: string[]) => (
    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Explained title={label} lines={lines} className="mt-0.5 text-xl font-bold">{show(value)}</Explained>
    </div>
  )

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">كم شخص حول موقع؟</h2>
      <p className="text-base text-muted-foreground">اضغط أي نقطة على الخريطة.</p>
      <div className="flex gap-1.5">
        {RADII.map((value) => (
          <button key={value} onClick={() => setRadius(value)} aria-pressed={radius === value}
            className={cn('flex-1 rounded-lg border py-2 text-base', radius === value ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
            {value < 1000 ? `${value} م` : `${value / 1000} كم`}
          </button>
        ))}
      </div>
      {status === 'loading' && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ الحساب" />}
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر الحساب.</p>}
      {result && status !== 'loading' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {figure('السكان', result.population, EXPLAIN.aroundPeople)}
            {figure('الوحدات السكنية', result.dwellings, EXPLAIN.aroundHomes)}
            {figure('المنشآت', result.businesses, EXPLAIN.aroundBusinesses)}
          </div>
          {result.top_activities.length > 0 && (
            <ul className="space-y-1.5 text-base">
              {result.top_activities.slice(0, 6).map((row) => (
                <li key={row.activity} className="flex justify-between"><span>{row.activity}</span><span className="font-semibold">{numberFormat.format(row.n)}</span></li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
