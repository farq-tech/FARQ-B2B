'use client'

import { ChevronDown, Layers3, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { CATEGORIES } from '@/lib/mock-data'
import { formatNumber } from '@/lib/format'
import type { Business, Filters, ScoredBusiness } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ResultCard } from './result-card'

interface ResultsPanelProps {
  results: ScoredBusiness[]
  scope: Business[]
  duplicatesMerged: number
  interpretation: string[]
  filters: Filters
  onFiltersChange: (f: Filters) => void
  selectedIds: string[]
  focusedId: string | null
  onToggle: (id: string) => void
  onFocus: (id: string) => void
  onSelectAll: (ids: string[], select: boolean) => void
  loading: boolean
}

export function ResultsPanel({
  results,
  scope,
  duplicatesMerged,
  interpretation,
  filters,
  onFiltersChange,
  selectedIds,
  focusedId,
  onToggle,
  onFocus,
  onSelectAll,
  loading,
}: ResultsPanelProps) {
  const [browserOpen, setBrowserOpen] = useState(false)
  const selectedSet = new Set(selectedIds)
  const ids = results.map((r) => r.id)
  const allSelected = ids.length > 0 && ids.every((id) => selectedSet.has(id))
  const withWhatsapp = results.filter((r) => r.whatsapp).length
  const districtCount = new Set(results.map((r) => r.districtId)).size

  const toggleCategory = (name: string) =>
    onFiltersChange({
      ...filters,
      categories: filters.categories.includes(name) ? filters.categories.filter((c) => c !== name) : [...filters.categories, name],
    })
  const toggleSpecialty = (name: string) =>
    onFiltersChange({
      ...filters,
      specialties: filters.specialties.includes(name) ? filters.specialties.filter((c) => c !== name) : [...filters.specialties, name],
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2" aria-live="polite">
        <SummaryStat label="منشأة فريدة" value={loading ? '—' : formatNumber(results.length)} />
        <SummaryStat label="متاحة واتساب" value={loading ? '—' : formatNumber(withWhatsapp)} />
        <SummaryStat label="حي" value={loading ? '—' : formatNumber(districtCount)} />
      </div>
      {duplicatesMerged > 0 && !loading ? (
        <p className="text-xs text-muted-foreground">
          {`دمجنا ${duplicatesMerged} سجلات مكررة بنفس رقم الواتساب لتظهر كل منشأة مرة واحدة.`}
        </p>
      ) : null}

      {interpretation.length ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-card p-2.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" aria-hidden />
            فهمنا بحثك:
          </span>
          {interpretation.map((chip) => (
            <span key={chip} className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border bg-card">
        <button
          type="button"
          onClick={() => setBrowserOpen((v) => !v)}
          aria-expanded={browserOpen}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium"
        >
          <span className="inline-flex items-center gap-2">
            <Layers3 className="size-4 text-muted-foreground" aria-hidden />
            تصفح التصنيفات
          </span>
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', browserOpen && 'rotate-180')} aria-hidden />
        </button>
        {browserOpen ? (
          <ul className="flex flex-col gap-1 border-t p-2">
            {CATEGORIES.map((c) => {
              const count = scope.filter((b) => b.category === c.name && !b.duplicateOf).length
              const active = filters.categories.includes(c.name)
              return (
                <li key={c.name} className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => toggleCategory(c.name)}
                    aria-pressed={active}
                    className={cn(
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm',
                      active ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-muted',
                    )}
                  >
                    {c.name}
                    <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                  </button>
                  {active ? (
                    <div className="flex flex-wrap gap-1 pb-1 pr-2.5">
                      {c.specialties.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleSpecialty(s)}
                          aria-pressed={filters.specialties.includes(s)}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[11px]',
                            filters.specialties.includes(s) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>

      <div className="flex items-center justify-between px-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={allSelected} disabled={!ids.length} onCheckedChange={(v) => onSelectAll(ids, Boolean(v))} />
          تحديد كل النتائج
        </label>
        <span className="text-xs text-muted-foreground">مرتبة حسب المطابقة</span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          لا توجد منشآت تطابق البحث الحالي. جرّب إزالة بعض الفلاتر.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {results.map((b) => (
            <li key={b.id}>
              <ResultCard
                business={b}
                selected={selectedSet.has(b.id)}
                focused={focusedId === b.id}
                onToggle={() => onToggle(b.id)}
                onFocus={() => onFocus(b.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-xl border bg-card px-3 py-2">
      <span className="text-lg font-bold tabular-nums">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}
