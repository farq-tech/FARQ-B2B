'use client'

import { ChevronDown, X } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CATEGORIES, CHANNELS, DISTRICTS, ROLES, STREETS } from '@/lib/mock-data'
import { EMPTY_FILTERS, countActiveFilters } from '@/lib/search'
import type { Business, Filters, WholesaleFilter } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Option {
  value: string
  label: string
  count?: number
}

function MultiFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: Option[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const active = selected.length > 0
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
              active ? 'border-primary bg-accent text-accent-foreground' : 'bg-card hover:bg-muted',
            )}
          />
        }
      >
        {label}
        {active ? <span className="rounded-full bg-primary px-1.5 text-[11px] leading-4 text-primary-foreground">{selected.length}</span> : null}
        <ChevronDown className="size-3.5 opacity-60" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-semibold text-muted-foreground">{label}</span>
          {active ? (
            <button type="button" className="text-xs font-medium text-primary" onClick={() => onChange([])}>
              مسح
            </button>
          ) : null}
        </div>
        <div className="flex max-h-64 flex-col overflow-y-auto overscroll-contain p-1.5">
          {options.length === 0 ? <p className="p-2 text-sm text-muted-foreground">لا توجد خيارات</p> : null}
          {options.map((o) => {
            const checked = selected.includes(o.value)
            return (
              <label key={o.value} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => onChange(v ? [...selected, o.value] : selected.filter((x) => x !== o.value))}
                />
                <span className="flex-1">{o.label}</span>
                {o.count !== undefined ? <span className="text-xs text-muted-foreground tabular-nums">{o.count}</span> : null}
              </label>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function WholesaleToggle({ value, onChange }: { value: WholesaleFilter; onChange: (v: WholesaleFilter) => void }) {
  const opts: [WholesaleFilter, string][] = [
    ['all', 'الكل'],
    ['wholesale', 'جملة'],
    ['retail', 'تجزئة'],
  ]
  return (
    <div role="radiogroup" aria-label="نوع البيع" className="inline-flex h-8 shrink-0 items-center rounded-full border bg-card p-0.5">
      {opts.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'h-full rounded-full px-3 text-[13px] font-medium transition-colors',
            value === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

interface FilterBarProps {
  cityId: string
  filters: Filters
  onChange: (f: Filters) => void
  scope: Business[]
}

export function FilterBar({ cityId, filters, onChange, scope }: FilterBarProps) {
  const count = (pred: (b: Business) => boolean) => scope.filter(pred).length

  const districtOptions = DISTRICTS.filter((d) => d.cityId === cityId).map((d) => ({ value: d.id, label: d.name, count: count((b) => b.districtId === d.id) }))
  const streetOptions = STREETS.filter((s) => s.cityId === cityId && (filters.districts.length === 0 || filters.districts.includes(s.districtId))).map((s) => ({
        value: s.id,
        label: s.name,
        count: count((b) => b.streetId === s.id),
      }))
  const categoryOptions = CATEGORIES.map((c) => ({ value: c.name, label: c.name, count: count((b) => b.category === c.name) }))
  const specialtyOptions = CATEGORIES.filter((c) => filters.categories.length === 0 || filters.categories.includes(c.name)).flatMap((c) =>
    c.specialties.map((s) => ({ value: s, label: s, count: count((b) => b.specialty === s) })),
  )
  const roleOptions = ROLES.map((r) => ({ value: r, label: r }))
  const channelOptions = CHANNELS.map((c) => ({ value: c, label: c, count: count((b) => b.channels.includes(c)) }))

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value })
  const active = countActiveFilters(filters)

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="الفلاتر">
      <MultiFilter label="الحي" options={districtOptions} selected={filters.districts} onChange={(v) => set('districts', v)} />
      <MultiFilter label="الشارع" options={streetOptions} selected={filters.streets} onChange={(v) => set('streets', v)} />
      <MultiFilter label="التصنيف" options={categoryOptions} selected={filters.categories} onChange={(v) => set('categories', v)} />
      <WholesaleToggle value={filters.wholesale} onChange={(v) => set('wholesale', v)} />
      <MultiFilter label="الدور" options={roleOptions} selected={filters.roles} onChange={(v) => set('roles', v as Filters['roles'])} />
      <MultiFilter label="التخصص" options={specialtyOptions} selected={filters.specialties} onChange={(v) => set('specialties', v)} />
      <MultiFilter label="قناة التواصل" options={channelOptions} selected={filters.channels} onChange={(v) => set('channels', v as Filters['channels'])} />
      {active ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
          مسح الكل ({active})
        </button>
      ) : null}
    </div>
  )
}
