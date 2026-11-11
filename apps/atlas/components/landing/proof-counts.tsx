'use client'

import { useEffect, useState } from 'react'
import { Stat, StatTile } from '@/components/shared/stat'
import { Skeleton } from '@/components/ui/skeleton'
import { EXPLAIN } from '@/lib/explanations'
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

  const ready = typeof counts === 'object' ? counts : undefined
  const tile = 'rounded-2xl border bg-card px-4 py-3'
  const figure = (label: string, value: number | undefined, explain: string[]) => (counts === 'loading'
    ? <StatTile label={label} className={tile}><Skeleton className="mt-1 h-8 w-16" aria-hidden /></StatTile>
    : <Stat label={label} value={value == null ? null : numberFormat.format(value)} explain={explain} size="large" className={tile}
      reason={value == null ? 'تعذر الوصول إلى قائمة المدن الآن.' : null} />)

  return (
    // the labels say exactly what the service counts: /cities lists the cities with at least 1,500 businesses in the
    // directory, each with its districts in the official atlas (districts.geojson); the figures sum that list only,
    // so a district in a smaller city is not in them and the label does not claim «every district on the map».
    // Each figure is the shared Stat: a tap says how it is counted (lib/explanations.ts), a missing one «غير متاح»
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3" aria-busy={counts === 'loading'} aria-describedby="proof-scope">
        {figure('مدينة لها أحياء في الأطلس', ready?.cities, EXPLAIN.coverageCities)}
        {figure('حي بحدوده الرسمية في هذه المدن', ready?.districts, EXPLAIN.coverageDistricts)}
      </div>
      <p id="proof-scope" className="text-xs text-muted-foreground">المدن التي فيها {numberFormat.format(MIN_BUSINESSES)} منشأة على الأقل في دليل فرق، وأحياؤها كما في الأطلس الرسمي.</p>
    </div>
  )
}
