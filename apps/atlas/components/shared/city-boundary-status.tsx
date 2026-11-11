'use client'

import { Map } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Keep a city usable when its neighborhood geometry is missing, while making the boundary limitation explicit. */
export function CityBoundaryStatus({ city, districtCount, className }: {
  city: string
  districtCount?: number
  className?: string
}) {
  if (districtCount !== 0) return null
  return (
    <p role="status" className={cn('flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-foreground', className)}>
      <Map className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
      لا تتوفر حدود أحياء لمدينة {city}؛ بيانات مستوى الحي غير متاحة حالياً.
    </p>
  )
}
