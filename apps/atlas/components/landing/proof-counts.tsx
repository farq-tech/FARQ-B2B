'use client'

import { useEffect, useState } from 'react'
import { Unavailable } from '@/components/shared/unavailable'
import { numberFormat } from '@/lib/insights-api'

type Counts = { cities: number; districts: number } | 'loading' | 'unavailable'

/**
 * What the atlas covers today, counted live from the golden district table through /api/market/cities (each city with
 * the number of official districts it has). Only cities that have districts count, as everywhere in Atlas. If the
 * service does not answer, each figure reads «غير متاح»: never a typed-in number, never 0.
 */
export function ProofCounts() {
  const [counts, setCounts] = useState<Counts>('loading')
  useEffect(() => {
    let live = true
    fetch('/api/market/cities')
      .then((response) => (response.ok ? response.json() : null))
      .then((rows: { districts?: number }[] | null) => {
        if (!live) return
        const covered = Array.isArray(rows) ? rows.filter((row) => typeof row.districts === 'number' && row.districts > 0) : []
        setCounts(covered.length ? { cities: covered.length, districts: covered.reduce((sum, row) => sum + (row.districts ?? 0), 0) } : 'unavailable')
      })
      .catch(() => { if (live) setCounts('unavailable') })
    return () => { live = false }
  }, [])

  const figure = (value: number | undefined) => (counts === 'loading'
    ? <span className="inline-block h-8 w-16 animate-pulse rounded-md bg-muted align-middle" aria-hidden />
    : value == null ? <Unavailable className="text-base" /> : numberFormat.format(value))
  const ready = typeof counts === 'object' ? counts : undefined

  return (
    <dl className="grid grid-cols-2 gap-3" aria-busy={counts === 'loading'}>
      <div className="rounded-2xl border bg-card p-4">
        <dt className="text-sm text-muted-foreground">مدن بأحيائها الرسمية</dt>
        <dd className="mt-1 text-3xl font-bold tabular-nums">{figure(ready?.cities)}</dd>
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <dt className="text-sm text-muted-foreground">حي بحدوده على الخريطة</dt>
        <dd className="mt-1 text-3xl font-bold tabular-nums">{figure(ready?.districts)}</dd>
      </div>
    </dl>
  )
}
