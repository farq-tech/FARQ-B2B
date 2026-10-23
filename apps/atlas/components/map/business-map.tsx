'use client'

import { MapPinOff } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { MapLevel } from '@/lib/map-summary'
import { cn } from '@/lib/utils'
import { MapboxBusinessMap } from './mapbox-map'
import type { MockMapProps } from './mock-map'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

export function BusinessMap(props: MockMapProps & { focusDistrictRequest?: { name: string; nonce: number } | null; focusStreetRequest?: { street: string; district?: string; nonce: number } | null; onDetailLevelChange?: (level: MapLevel) => void; onMarketInsightOpened?: (insight: { kind: 'cluster' | 'street'; count: number }) => void; liveDistricts?: import('geojson').FeatureCollection; liveCounts?: import('@/lib/live-market').DistrictCount[]; liveSummary?: import('@/lib/live-market').MarketSummary['summary']; liveStreets?: import('geojson').FeatureCollection<import('geojson').Geometry, import('@/lib/live-market').StreetDensityProperties>; liveClusters?: import('@/lib/live-market').MarketCluster[]; liveEntityPins?: readonly { id: string; name: string; category: string; district: string; street: string; whatsapp: boolean; reason: string; latitude: number | null; longitude: number | null }[]; /** All pages for the selected district were loaded, so its pins are safe to render directly. */ liveEntityPinsComplete?: boolean; liveDirectorySummary?: import('@/components/opportunity/live-entity-results').DirectorySummary | null; liveMapQuery?: string | null; liveTileAccess?: string | null; onLiveEntityResolved?: (entity: import('@/components/opportunity/live-entity-results').LiveEntity) => void; liveEntityState?: import('@/components/opportunity/live-entity-results').DirectoryLoadState; liveError?: boolean }) {
  const [failed, setFailed] = useState(false)
  const handleFailure = useCallback(() => setFailed(true), [])

  if (MAPBOX_TOKEN && !failed && props.state !== 'unavailable') {
    return <MapboxBusinessMap {...props} token={MAPBOX_TOKEN} onFailure={handleFailure} />
  }

  return (
    <div className={cn('relative flex size-full items-center justify-center overflow-hidden rounded-xl border bg-map-land p-6 text-center', props.className)}>
      <div className="flex max-w-sm flex-col items-center gap-3">
        <MapPinOff className="size-7 text-muted-foreground" aria-hidden />
        <p className="font-semibold">الخريطة الحية غير متاحة حالياً</p>
        <p className="text-sm leading-relaxed text-muted-foreground">لن نعرض نتائج بديلة أو غير موثقة. أعد المحاولة بعد التحقق من اتصال خدمة السوق.</p>
        {props.onRetry ? <button type="button" onClick={props.onRetry} className="text-sm font-medium text-primary underline-offset-4 hover:underline">إعادة المحاولة</button> : null}
      </div>
    </div>
  )}
