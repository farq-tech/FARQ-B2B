'use client'

import { RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CityDataSource } from '@/lib/optional-source'

const SOURCE_LABEL: Record<CityDataSource, string> = {
  population: 'السكان',
  businesses: 'المنشآت',
  income: 'الدخل',
  growth: 'النمو العمراني',
  housing: 'مستوى السكن',
  realEstate: 'العروض العقارية',
  deals: 'الصفقات المسجلة',
  restaurants: 'المطاعم',
  menuPrices: 'أسعار قوائم الطعام',
  demand: 'الطلب',
}

/** Partial city data remains usable, but a failed source must not look like a real data gap. */
export function CityDataStatus({ failedSources, pendingSources, retry, className }: {
  failedSources: CityDataSource[]
  pendingSources: CityDataSource[]
  retry: () => void
  className?: string
}) {
  if (!failedSources.length && !pendingSources.length) return null
  const labels = (Object.keys(SOURCE_LABEL) as CityDataSource[])
    .filter((source) => failedSources.includes(source))
    .map((source) => SOURCE_LABEL[source])
  return (
    <div role="status" aria-live="polite" className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card/95 px-3 py-2 text-sm shadow-sm', className)}>
      {pendingSources.length > 0 && <span>جارٍ تحميل بعض مؤشرات المدينة؛ ستظهر تباعاً.</span>}
      {failedSources.length > 0 && <>
        <span>تعذر تحميل {labels.join('، ')}؛ بعض الأرقام غير متاحة مؤقتاً.</span>
        <button type="button" onClick={retry} className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-2">
          <RotateCw className="size-3.5" aria-hidden />أعد المحاولة
        </button>
      </>}
    </div>
  )
}
