'use client'

import { ChevronDown, MapPinned, Search, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'
import { CITIES } from '@/lib/mock-data'
import type { GoalDef } from '@/lib/goals'

interface SearchToolbarProps {
  goal: GoalDef
  onChangeGoal: () => void
  cityId: string
  onCityChange: (id: string) => void
  initialQuery: string
  onSearch: (text: string) => void
  onOpenAssistant: () => void
  resultCount?: number | null
  searching?: boolean
}

export function SearchToolbar({ goal, onChangeGoal, cityId, onCityChange, initialQuery, onSearch, onOpenAssistant, resultCount = null, searching = false }: SearchToolbarProps) {
  const [text, setText] = useState(initialQuery)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastApplied = useRef(initialQuery)

  useEffect(() => {
    setText(initialQuery)
    lastApplied.current = initialQuery
  }, [initialQuery])

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
  }, [])

  const applySearch = (value: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = null
    if (value === lastApplied.current) return
    lastApplied.current = value
    onSearch(value)
  }

  return (
    <section aria-label="تحديد هدف البحث" className="rounded-2xl border bg-card p-2 shadow-xs">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <button type="button" onClick={onChangeGoal} className="inline-flex h-11 shrink-0 items-center justify-between gap-2 rounded-xl bg-foreground px-3.5 text-sm font-semibold text-background hover:opacity-90 lg:min-w-40" aria-label={`الهدف: ${goal.label}. اضغط للتغيير`}>
          <span className="inline-flex items-center gap-2"><goal.icon className="size-4" />{goal.label}</span><ChevronDown className="size-3.5 opacity-70" />
        </button>
        <form role="search" className="relative flex min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); applySearch(text) }}>
          <label htmlFor="opp-search" className="sr-only">ابحث بلغة طبيعية</label>
          <Search className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="opp-search"
            type="search"
            value={text}
            onChange={(event) => {
              const value = event.target.value
              setText(value)
              if (searchTimer.current) clearTimeout(searchTimer.current)
              if (!value.trim()) applySearch(value)
              else searchTimer.current = setTimeout(() => applySearch(value), 300)
            }}
            placeholder={goal.placeholder}
            autoComplete="off"
            className="h-11 w-full rounded-xl border bg-background pr-10 pl-20 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25"
          />
          <Button type="submit" size="sm" className="absolute top-1/2 left-1.5 -translate-y-1/2">اعرض النتائج</Button>
        </form>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 lg:flex lg:items-center">
          <NativeSelect label="المدينة" value={cityId} onChange={onCityChange}><>{CITIES.map((city) => <option key={city.id} value={city.id} disabled={!city.available}>{city.available ? city.name : `${city.name} (غير متاحة)`}</option>)}</></NativeSelect>
          <Button variant="outline" className="h-11" onClick={onOpenAssistant}><Sparkles data-icon="inline-start" className="text-primary" /><span className="hidden sm:inline">ساعدني</span></Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-1.5 pt-2 text-xs text-muted-foreground">
        <p className="flex min-w-0 items-center gap-1.5"><MapPinned className="size-3.5 shrink-0 text-primary" /><span className="truncate">حدّد حيًا من الخريطة ليبقى نطاقك محفوظًا عند البحث.</span></p>
        <span aria-live="polite" className="shrink-0 tabular-nums">{searching ? 'جارٍ البحث…' : resultCount != null ? `${formatNumber(resultCount)} نتيجة` : ''}</span>
      </div>
    </section>
  )
}

function NativeSelect({ label, value, onChange, disabled, children }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; children: ReactNode }) {
  return <label className="relative flex min-w-0"><span className="sr-only">{label}</span><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-11 min-w-0 appearance-none rounded-xl border bg-background py-0 pr-8 pl-8 text-sm font-medium outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-50">{children}</select><MapPinned className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-primary" /><ChevronDown className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" /></label>
}
