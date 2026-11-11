'use client'

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon3D } from './icon-3d'

type MainActivity = { main_id: string; main_ar: string }

/**
 * A main-activity choice shown with each sector's icon. A native select cannot draw images, so the list opens in
 * place under the button; picking closes it. With `allLabel`, an «all» choice (empty id) leads the list.
 */
export function MainActivityPicker({ activities, value, onChange, placeholder, allLabel, className }: {
  activities: MainActivity[]
  value: string
  onChange: (mainId: string) => void
  placeholder: string
  allLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = activities.find((item) => item.main_id === value)
  const choices = allLabel ? [{ main_id: '', main_ar: allLabel }, ...activities] : activities
  const pick = (id: string) => { onChange(id); setOpen(false) }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}
        className="flex h-11 items-center gap-2 rounded-lg border bg-background px-3 text-start text-base">
        {current && <Icon3D type={`main-${current.main_id}`} className="size-7" />}
        <span className={cn('min-w-0 flex-1 truncate', !current && !allLabel && 'text-muted-foreground')}>{current?.main_ar ?? allLabel ?? placeholder}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
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
