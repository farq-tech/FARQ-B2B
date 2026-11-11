'use client'

import { useState } from 'react'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon3D } from './icon-3d'
import { resolveMainActivitySelection, type MainActivity } from '@/lib/insights-api'

/**
 * A main-activity choice shown with each sector's icon. A native select cannot draw images, so the list opens in
 * place under the button; picking closes it. With `allLabel`, an «all» choice (empty id) leads the list.
 */
export function MainActivityPicker({ activities, value, onChange, placeholder, allLabel, className, status, onRetry, valueLabel }: {
  activities: MainActivity[]
  value: string
  onChange: (mainId: string) => void
  placeholder: string
  allLabel?: string
  className?: string
  status?: 'loading' | 'ready' | 'error'
  onRetry?: () => void
  /** Keeps a cross-city selection visible when this city's directory has no records in that activity. */
  valueLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const { activity: current, missing: missingSelection } = resolveMainActivitySelection(activities, value, valueLabel)
  const choices = [
    ...(allLabel ? [{ main_id: '', main_ar: allLabel }] : []),
    ...activities,
    ...(missingSelection && current ? [current] : []),
  ]
  const pick = (id: string) => { onChange(id); setOpen(false) }

  if (status === 'loading') return <div role="status" className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}><Loader2 className="size-4 animate-spin" /> جارٍ تحميل الأنشطة</div>
  if (status === 'error') return (
    <div role="alert" className={cn('text-sm text-destructive', className)}>
      تعذر تحميل الأنشطة، لذا لم نعرض قائمة ناقصة.{' '}
      {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline">أعد المحاولة</button>}
    </div>
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}
        className="flex h-11 items-center gap-2 rounded-lg border bg-background px-3 text-start text-base">
        {current && <Icon3D type={`main-${current.main_id}`} className="size-7" />}
        <span className={cn('min-w-0 flex-1 truncate', !current && !allLabel && 'text-muted-foreground')}>{current?.main_ar ?? allLabel ?? placeholder}</span>
        {missingSelection && <span className="shrink-0 text-xs text-muted-foreground">لا يظهر في المدينة</span>}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {missingSelection && status === 'ready' && <p role="status" className="text-sm text-muted-foreground">لا تظهر لهذا النشاط سجلات مصنّفة في دليل هذه المدينة؛ لا يعني ذلك خلو المدينة منه فعلياً.</p>}
      {open && (
        <ul role="listbox" aria-label={placeholder} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}
          className="grid max-h-80 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border bg-background p-1.5">
          {choices.map((item) => {
            const selected = item.main_id === value
            return (
              <li key={item.main_id || 'all'} role="option" aria-selected={selected}>
                <button type="button" onClick={() => pick(item.main_id)}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted', selected && 'bg-primary/10 font-semibold text-primary')}>
                  {item.main_id ? <Icon3D type={`main-${item.main_id}`} className="size-7" /> : <span className="size-7 shrink-0" aria-hidden />}
                  <span className="min-w-0 flex-1">{item.main_ar}</span>
                  {selected && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
