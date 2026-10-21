'use client'

import { ChevronDown, Search, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { CITIES } from '@/lib/mock-data'
import type { GoalDef } from '@/lib/goals'
import type { Filters } from '@/lib/types'

interface SearchToolbarProps {
  goal: GoalDef
  onChangeGoal: () => void
  cityId: string
  onCityChange: (id: string) => void
  initialQuery: string
  onSearch: (text: string) => void
  onOpenAssistant: () => void
}

export function SearchToolbar({
  goal,
  onChangeGoal,
  cityId,
  onCityChange,
  initialQuery,
  onSearch,
  onOpenAssistant,
}: SearchToolbarProps) {
  const [text, setText] = useState(initialQuery)

  // Searches originating from the assistant or the live activity picker update
  // the map state outside this input. Keep the visible query aligned with that
  // applied state so the user can understand and refine the active scope.
  useEffect(() => {
    setText(initialQuery)
  }, [initialQuery])

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onChangeGoal}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border bg-accent px-3 text-sm font-medium text-accent-foreground hover:border-primary/40"
          aria-label={`الهدف: ${goal.label}. اضغط للتغيير`}
        >
          <goal.icon className="size-4" aria-hidden />
          <span className="hidden sm:inline">{goal.label}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </button>
        <form
          role="search"
          className="relative flex min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch(text)
          }}
        >
          <label htmlFor="opp-search" className="sr-only">
            ابحث بلغة طبيعية
          </label>
          <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id="opp-search"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={goal.placeholder}
            className="h-10 w-full rounded-lg border bg-card pr-9 pl-20 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25"
          />
          <Button type="submit" size="sm" className="absolute top-1/2 left-1 -translate-y-1/2">
            بحث
          </Button>
        </form>
        <Button variant="outline" className="h-10 shrink-0" onClick={onOpenAssistant} aria-label="فتح المساعد">
          <Sparkles data-icon="inline-start" className="text-primary" />
          <span className="hidden md:inline">المساعد</span>
        </Button>
      </div>

      <div className="max-w-xs">
        <NativeSelect label="المدينة" value={cityId} onChange={onCityChange}>
          {CITIES.map((c) => (
            <option key={c.id} value={c.id} disabled={!c.available}>
              {c.available ? c.name : `${c.name} (غير متاحة)`}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  )
}

function NativeSelect({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <label className="relative flex min-w-0 flex-col">
      <span className="sr-only">{label}</span>
      <span className="pointer-events-none absolute top-1 right-3 text-[10px] font-medium text-muted-foreground" aria-hidden>
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full min-w-0 appearance-none truncate rounded-lg border bg-card pt-3.5 pr-3 pl-7 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </label>
  )
}
