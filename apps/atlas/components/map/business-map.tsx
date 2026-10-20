'use client'

import { MapPinned } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { MapboxBusinessMap } from './mapbox-map'
import { MockMap, type MockMapProps } from './mock-map'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

export function BusinessMap(props: MockMapProps) {
  const [failed, setFailed] = useState(false)
  const handleFailure = useCallback(() => setFailed(true), [])

  if (MAPBOX_TOKEN && !failed && props.state !== 'unavailable') {
    return <MapboxBusinessMap {...props} token={MAPBOX_TOKEN} onFailure={handleFailure} />
  }

  return (
    <div className={cn('relative', props.className)}>
      <MockMap {...props} className="size-full" />
      {props.state !== 'unavailable' ? (
        <p className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border bg-card/95 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
          <MapPinned className="size-3.5" aria-hidden />
          عرض تخطيطي — الخريطة الحية غير متاحة حالياً
        </p>
      ) : null}
    </div>
  )
}
