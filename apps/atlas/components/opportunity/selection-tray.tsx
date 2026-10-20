'use client'

import { BookmarkPlus, FileText, Megaphone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'

interface SelectionTrayProps {
  count: number
  primary: RequestType
  onClear: () => void
  onAction: (type: RequestType) => void
  className?: string
}

const ACTIONS: { type: RequestType; label: string; icon: typeof FileText }[] = [
  { type: 'list', label: 'حفظ قائمة للمراجعة', icon: BookmarkPlus },
  { type: 'rfq', label: 'إنشاء طلب تسعير', icon: FileText },
  { type: 'campaign', label: 'تجهيز مسودة حملة', icon: Megaphone },
]

export function SelectionTray({ count, primary, onClear, onAction, className }: SelectionTrayProps) {
  if (count === 0) return null
  return (
    <div
      role="region"
      aria-label="المنشآت المحددة"
      className={cn('flex flex-col gap-2.5 rounded-2xl border bg-card p-3 shadow-lg sm:flex-row sm:items-center', className)}
    >
      <div className="flex items-center justify-between gap-3 sm:justify-start">
        <span className="text-sm font-semibold">
          <span className="ml-1 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground tabular-nums">
            {count}
          </span>
          منشأة محددة
        </span>
        <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <X className="size-3.5" aria-hidden />
          مسح التحديد
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:mr-auto sm:flex">
        {ACTIONS.map((a) => (
          <Button
            key={a.type}
            variant={a.type === primary ? 'default' : 'outline'}
            onClick={() => onAction(a.type)}
            className="h-auto min-h-9 flex-col gap-1 px-2 py-1.5 text-[11px] whitespace-normal sm:h-9 sm:flex-row sm:text-sm"
          >
            <a.icon data-icon="inline-start" />
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
