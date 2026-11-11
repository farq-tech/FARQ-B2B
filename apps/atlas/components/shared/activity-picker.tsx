'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { numberFormat } from '@/lib/insights-api'
import { activityKey, searchActivities, type Activity, type ActivityQuery } from '@/lib/activities'
import { Icon3D } from './icon-3d'

/**
 * The activity choice at the level shops are: the reader types a shop («مغسلة»، «برجر») or scrolls the city's
 * largest, and picks one subcategory or specialty with its count here. The main activity shows only as the icon and
 * the parent line. With `allLabel`, an «all» choice leads the list and picks null.
 */
export function ActivityPicker({ activities, value, onPick, placeholder, allLabel, className }: {
  activities: Activity[]
  /** The studied activity, shown on the button by its label when it is one of the list's entries. */
  value: (ActivityQuery & { label?: string }) | null
  onPick: (item: Activity | null) => void
  placeholder: string
  allLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const key = activityKey(value)
  const current = key ? activities.find((item) => activityKey(item.query) === key) : undefined
  const found = useMemo(() => searchActivities(activities, text), [activities, text])
  const pick = (item: Activity | null) => { onPick(item); setOpen(false); setText('') }
  const close = () => { setOpen(false); setText('') }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => { if (event.key === 'Escape') close() }}
        className="flex h-11 items-center gap-2 rounded-lg border bg-background px-3 text-start text-base">
        {current && <Icon3D type={`main-${current.main_id}`} className="size-7" />}
        <span className={cn('min-w-0 flex-1 truncate', !current && !allLabel && 'text-muted-foreground')}>
          {current?.name_ar ?? (key ? value?.label : null) ?? allLabel ?? placeholder}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 rounded-lg border bg-background p-1.5" onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
          <label className="flex h-10 items-center gap-2 rounded-md border px-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input value={text} onChange={(event) => setText(event.target.value)} autoFocus enterKeyHint="search"
              aria-label={placeholder} placeholder="ابحث باسم المحل: مغسلة، برجر، صيدلية…"
              className="min-w-0 flex-1 bg-transparent text-base outline-none" />
          </label>
          <ul role="listbox" aria-label={placeholder} className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {allLabel && !text.trim() && (
              <li role="option" aria-selected={!key}>
                <button type="button" onClick={() => pick(null)}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted', !key && 'bg-primary/10 font-semibold text-primary')}>
                  <span className="size-7 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{allLabel}</span>
                  {!key && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              </li>
            )}
            {found.map((item) => {
              const selected = current?.key === item.key && current.kind === item.kind
              return (
                <li key={`${item.kind}:${item.key}`} role="option" aria-selected={selected}>
                  <button type="button" onClick={() => pick(item)}
                    className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted', selected && 'bg-primary/10 font-semibold text-primary')}>
                    <Icon3D type={`main-${item.main_id}`} className="size-7" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{item.name_ar}</span>
                      <span className="truncate text-xs text-muted-foreground">{item.parent_ar}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr">{numberFormat.format(item.n)}</span>
                    {selected && <Check className="size-4 shrink-0" aria-hidden />}
                  </button>
                </li>
              )
            })}
            {activities.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">جارٍ تحميل التخصصات…</li>}
            {activities.length > 0 && found.length === 0 && (
              <li className="px-2 py-3 text-sm text-muted-foreground">لا يوجد تخصص بهذا الاسم. جرّب كلمة أخرى، أو اكتب النشاط في خانة البحث.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
