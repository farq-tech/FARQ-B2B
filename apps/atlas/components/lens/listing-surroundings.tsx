'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import type { Listing } from '@/lib/real-estate'

type Place = { name: string; district_ar: string | null; lon: number; lat: number; km: number }
type Anchor = { label: string; lon: number; lat: number; km: number }
type Near = { places: Record<'school_public' | 'school_private' | 'school' | 'hospital', Place[]>; anchors: Record<string, Anchor> }
export type MyPoint = { lon: number; lat: number }
/** Drive time and road distance from the home to one target, when the routing service answered. */
type Drive = { minutes: number; km: number } | null

const KM = (km: number) => `${numberFormat.format(Math.round(km * 10) / 10)} كم`
const PLACES: [keyof Near['places'], string][] = [['school_public', 'مدرسة حكومية'], ['school_private', 'مدرسة أهلية'], ['school', 'مدرسة (النوع غير مذكور)'], ['hospital', 'مستشفى']]

/** Road time and distance from one point to several, through Valhalla's matrix (OSRM-shaped answers too); null per target it could not route. */
async function drives(from: MyPoint, targets: MyPoint[]): Promise<Drive[]> {
  const response = await fetch('/api/routing/sources_to_targets', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sources: [from], targets, costing: 'auto' }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error('routing')
  const row = (data.sources_to_targets?.[0] ?? []) as { time?: number | null; distance?: number | null }[]
  if (row.length) return targets.map((_, i) => (row[i]?.time != null && row[i]?.distance != null ? { minutes: Math.round(row[i].time! / 60), km: row[i].distance! } : null))
  const durations = data.durations?.[0] as (number | null)[] | undefined
  const distances = data.distances?.[0] as (number | null)[] | undefined
  return targets.map((_, i) => (durations?.[i] != null && distances?.[i] != null ? { minutes: Math.round(durations[i]! / 60), km: distances[i]! / 1000 } : null))
}

/**
 * «حول العقار»: what a home is near. The nearest public and private schools and hospital by name from the directory,
 * the city's airport and centre, and the viewer's own point, with drive times where the routing service answers and
 * straight-line distance otherwise. The street the ad names and how dense the district is come from the listing and
 * the district row.
 */
export function ListingSurroundings({ listing, myPoint, density }: { listing: Listing; myPoint: MyPoint | null; density: number | null }) {
  const [near, setNear] = useState<Near | null | 'error'>(null)
  const [times, setTimes] = useState<Record<string, Drive>>({})

  useEffect(() => {
    let live = true
    setNear(null)
    setTimes({})
    postMarket<Near>('places-near', { city: listing.city, lon: listing.lon, lat: listing.lat })
      .then((data) => {
        if (!live) return
        setNear(data)
        const targets: [string, MyPoint][] = [...Object.entries(data.anchors ?? {}).map(([key, anchor]) => [key, { lon: anchor.lon, lat: anchor.lat }] as [string, MyPoint]), ...(myPoint ? [['mine', myPoint] as [string, MyPoint]] : [])]
        if (!targets.length) return
        drives({ lon: listing.lon, lat: listing.lat }, targets.map(([, point]) => point))
          .then((found) => { if (live) setTimes(Object.fromEntries(targets.map(([key], i) => [key, found[i]]))) })
          .catch(() => { /* straight-line distances stay */ })
      })
      .catch(() => { if (live) setNear('error') })
    return () => { live = false }
  }, [listing.id, listing.city, listing.lon, listing.lat, myPoint])

  const straight = (point: MyPoint) => {
    const rad = Math.PI / 180
    const h = Math.sin(((point.lat - listing.lat) * rad) / 2) ** 2 + Math.cos(listing.lat * rad) * Math.cos(point.lat * rad) * Math.sin(((point.lon - listing.lon) * rad) / 2) ** 2
    return 2 * 6371 * Math.asin(Math.sqrt(h))
  }
  const reach = (key: string, km: number) => {
    const drive = times[key]
    return drive ? `${numberFormat.format(drive.minutes)} دقيقة بالسيارة · ${KM(drive.km)}` : `${KM(km)} خط مستقيم`
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      {listing.street_width ? <p>على شارع عرضه {numberFormat.format(listing.street_width)} م</p> : null}
      <p>
        <Explained title="كثافة السكان" lines={EXPLAIN.density} className="text-sm">
          كثافة الحي: {density != null ? `${numberFormat.format(Math.round(density))} ساكن لكل كم²` : 'غير متاح'}
        </Explained>
      </p>
      {near === null && <Loader2 className="size-4 animate-spin text-primary" aria-label="جارٍ التحميل" />}
      {near === 'error' && <p className="text-muted-foreground">ما حول العقار غير متاح الآن.</p>}
      {near && near !== 'error' && (
        <ul className="flex flex-col gap-1">
          {PLACES.map(([key, label]) => {
            const place = near.places?.[key]?.[0]
            if (!place && key === 'school') return null
            return (
              <li key={key} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{label}</span>
                <span className="min-w-0 truncate text-end">{place ? `${place.name} · ${KM(place.km)}` : 'لا شيء في 6 كم'}</span>
              </li>
            )
          })}
          {Object.entries(near.anchors ?? {}).map(([key, anchor]) => (
            <li key={key} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{anchor.label}</span>
              <span className="shrink-0">{reach(key, anchor.km)}</span>
            </li>
          ))}
          {myPoint && (
            <li className="flex justify-between gap-2">
              <span className="text-muted-foreground">نقطتك</span>
              <span className="shrink-0">{reach('mine', straight(myPoint))}</span>
            </li>
          )}
          <li>
            <Explained title="كيف حسبناها" lines={EXPLAIN.surroundings} className="text-xs text-muted-foreground">كيف حسبناها؟</Explained>
          </li>
        </ul>
      )}
    </div>
  )
}
