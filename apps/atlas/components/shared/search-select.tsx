'use client'

import { useMemo } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronDown } from 'lucide-react'
import { normalizeArabic } from '@/lib/search'
import { cn } from '@/lib/utils'

export type SearchSelectItem = { id: string; label: string }

/**
 * A choice from a long list (a city's 150+ districts) that can be typed into: the field is the search, the list
 * under it narrows as the person types, and Arabic spelling variants match each other (أ/إ/ا, ة/ه, ى/ي; lib/search
 * normalizeArabic), so «الياسمين» is found from «ياسمين». Arrow keys move through the list, Enter picks, Escape
 * closes. Same height, radius, border and focus ring as every other control; the list is a card-radius popup.
 * For a handful of choices use Select (components/ui/select.tsx) instead: there is nothing to search.
 */
export function SearchSelect({ items, value, onChange, placeholder, label, empty = 'لا نتيجة بهذا الاسم', disabled, className }: {
  items: SearchSelectItem[]
  /** the chosen item's id; '' for none */
  value: string
  onChange: (id: string) => void
  placeholder: string
  /** the field's accessible name, when no <label> wraps it */
  label?: string
  /** what the list says when nothing matches the typed text */
  empty?: string
  disabled?: boolean
  className?: string
}) {
  const selected = useMemo(() => items.find((item) => item.id === value) ?? null, [items, value])
  return (
    <Combobox.Root<SearchSelectItem>
      items={items} value={selected} disabled={disabled}
      onValueChange={(item) => onChange(item?.id ?? '')}
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(item, current) => item.id === current.id}
      filter={(item, query) => !query || normalizeArabic(item.label).includes(normalizeArabic(query))}
    >
      <div className={cn('relative', className)}>
        <Combobox.Input placeholder={placeholder} aria-label={label}
          className="h-11 w-full min-w-0 rounded-lg border border-input bg-background ps-3 pe-10 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60" />
        <Combobox.Trigger aria-label={label ? `اعرض ${label}` : 'اعرض القائمة'}
          className="absolute inset-y-0 end-0 grid w-10 place-items-center rounded-e-lg text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
          <ChevronDown className="size-4" aria-hidden />
        </Combobox.Trigger>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50">
          <Combobox.Popup dir="rtl"
            className="max-h-[min(var(--available-height),20rem)] w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-y-auto rounded-2xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0">
            <Combobox.Empty className="px-3 py-2 text-sm text-muted-foreground empty:hidden">{empty}</Combobox.Empty>
            <Combobox.List>
              {(item: SearchSelectItem) => (
                <Combobox.Item key={item.id} value={item}
                  className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:font-semibold pointer-coarse:py-3">
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <Combobox.ItemIndicator><Check className="size-4 text-primary" aria-hidden /></Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
