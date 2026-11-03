'use client'

import { useEffect, useState } from 'react'
import { Unavailable } from '@/components/shared/unavailable'
import { fetchCities, numberFormat } from '@/lib/insights-api'

/** The service's floor for a city to be listed (services/targeting-api/server.py cities(): having n >= 1500). */
const MIN_BUSINESSES = 1500

type Counts = { cities: number; districts: number } | 'loading' | 'unavailable'

/**
 * What the atlas covers today, counted live through /api/market/cities: the cities with at least 1,500 businesses in
 * the directory that also have districts in the official atlas, and the sum of those cities' official districts
 * (features of the golden districts.geojson). Only cities that have districts count, as everywhere in Atlas. If the
 * service does not answer, each figure reads «غير متاح»: never a typed-in number, never 0.
 */
export function ProofCounts() {
  const [counts, setCounts] = useState<Counts>('loading')
  useEffect(() => {
    let live = true
    // the same request the city pickers use (one row per city, so a repeated city is never counted twice)
    fetchCities()
      .then((rows) => {
        if (!live) return
        const covered = rows.filter((row) => typeof row.districts === 'number' && row.districts > 0)
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
    // the labels say exactly what the service counts: /cities lists the cities with at least 1,500 businesses in the
    // directory, each with its districts in the official atlas (districts.geojson); the figures sum that list only,
    // so a district in a smaller city is not in them and the label does not claim «every district on the map»
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-3" aria-busy={counts === 'loading'} aria-describedby="proof-scope">
        <div className="rounded-2xl border bg-card p-4">
          <dt className="text-sm text-muted-foreground">مدينة لها أحياء في الأطلس</dt>
          <dd className="mt-1 text-3xl font-bold tabular-nums">{figure(ready?.cities)}</dd>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <dt className="text-sm text-muted-foreground">حي بحدوده الرسمية في هذه المدن</dt>
          <dd className="mt-1 text-3xl font-bold tabular-nums">{figure(ready?.districts)}</dd>
        </div>
      </dl>
      <p id="proof-scope" className="text-xs text-muted-foreground">المدن التي فيها {numberFormat.format(MIN_BUSINESSES)} منشأة على الأقل في دليل فرق، وأحياؤها كما في الأطلس الرسمي.</p>
    </div>
  )
}
