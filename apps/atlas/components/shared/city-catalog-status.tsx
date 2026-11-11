'use client'

import { RotateCw } from 'lucide-react'
import type { CityCatalogStatus } from '@/lib/insights-api'
import { cn } from '@/lib/utils'

/** Explain the temporary one-city fallback when the catalog is unavailable and keep a local retry available. */
export function CityCatalogStatus({ status, retry, className }: { status: CityCatalogStatus; retry: () => void; className?: string }) {
  if (status !== 'error') return null
  return (
    <p role="alert" className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive', className)}>
      تعذر تحميل قائمة المدن؛ المعروض الرياض مؤقتاً.
      <button type="button" onClick={retry} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
        <RotateCw className="size-3.5" aria-hidden />أعد المحاولة
      </button>
    </p>
  )
}
