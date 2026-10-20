'use client'

import { BoxSelect, List, Map as MapIcon, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { BusinessMap } from '@/components/map/business-map'
import type { MapState } from '@/components/map/mock-map'
import { Button } from '@/components/ui/button'
import { isInArea, type MapArea } from '@/lib/geo'
import { goalById } from '@/lib/goals'
import { BUYER_ROLES, SUPPLIER_ROLES, cityById, districtById } from '@/lib/mock-data'
import { EMPTY_FILTERS, mergeParsedIntoFilters, parseQuery, runSearch, type ParsedQuery } from '@/lib/search'
import { useAppStore } from '@/lib/store'
import type { Filters, GoalId, RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AssistantPanel } from './assistant-panel'
import { FilterBar } from './filter-bar'
import { GoalPicker } from './goal-picker'
import { ResultsPanel } from './results-panel'
import { SearchToolbar } from './search-toolbar'
import { SelectionTray } from './selection-tray'

function inferGoal(parsed: ParsedQuery): GoalId {
  if (parsed.intent === 'rfq') return 'rfq'
  if (parsed.intent === 'campaign') return 'target'
  if (parsed.roles.some((r) => BUYER_ROLES.includes(r))) return 'find-buyers'
  if (parsed.roles.some((r) => SUPPLIER_ROLES.includes(r)) || parsed.categories.length) return 'find-supplier'
  return 'explore'
}

export function OpportunityMapView() {
  const router = useRouter()
  const { selection, toggleSelect, setSelection, createDraft } = useAppStore()
  const [goal, setGoal] = useState<GoalId | null>(null)
  const [cityId, setCityId] = useState('riyadh')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [query, setQuery] = useState('')
  const [freeText, setFreeText] = useState<string[]>([])
  const [interpretation, setInterpretation] = useState<string[]>([])
  const [intent, setIntent] = useState<RequestType | null>(null)
  const [loading, setLoading] = useState(false)
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null)
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [area, setArea] = useState<MapArea | null>(null)
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const simulateLoad = (ms = 650) => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    setLoading(true)
    loadTimer.current = setTimeout(() => setLoading(false), ms)
  }

  const city = cityById.get(cityId)
  const { results, duplicatesMerged, scope } = useMemo(
    () => runSearch({ cityId, goal, filters, freeText }),
    [cityId, goal, filters, freeText],
  )
  const listResults = useMemo(() => (area ? results.filter((b) => isInArea(cityId, b, area)) : results), [area, results, cityId])

  const resetSearch = () => {
    setArea(null)
    setFilters(EMPTY_FILTERS)
    setFreeText([])
    setInterpretation([])
    setIntent(null)
  }

  const applyQuery = (text: string, parsed: ParsedQuery, nextGoal?: GoalId) => {
    setQuery(text)
    setFilters((f) => mergeParsedIntoFilters(nextGoal ? EMPTY_FILTERS : f, parsed))
    setFreeText(parsed.freeText)
    setInterpretation(parsed.chips)
    setIntent(parsed.intent)
    if (nextGoal) setGoal(nextGoal)
    simulateLoad(450)
  }

  const handleSearch = (text: string) => {
    if (!text.trim()) {
      setQuery('')
      setFreeText([])
      setInterpretation([])
      return
    }
    applyQuery(text, parseQuery(text, cityId))
  }

  const handleAssistantApply = (text: string, parsed: ParsedQuery) => {
    setAssistantOpen(false)
    applyQuery(text, parsed, goal ?? inferGoal(parsed))
  }

  const handlePrepareDraft = (text: string, parsed: ParsedQuery, type: RequestType) => {
    const nextGoal = goal ?? inferGoal(parsed)
    const nextFilters = mergeParsedIntoFilters(EMPTY_FILTERS, parsed)
    const { results: matched } = runSearch({ cityId, goal: nextGoal, filters: nextFilters, freeText: parsed.freeText })
    const top = matched.slice(0, 8).map((b) => b.id)
    if (top.length === 0) return null
    applyQuery(text, parsed, nextGoal)
    const id = createDraft({
      type,
      businessIds: top,
      cityId,
      goal: nextGoal,
      query: text,
      categoryHint: nextFilters.categories[0],
      districtHint: nextFilters.districts.length === 1 ? districtById.get(nextFilters.districts[0])?.name : undefined,
    })
    return { id, count: top.length }
  }

  const assistant = (
    <AssistantPanel
      open={assistantOpen}
      onClose={() => setAssistantOpen(false)}
      cityId={cityId}
      onApply={handleAssistantApply}
      onPrepareDraft={handlePrepareDraft}
      onOpenDraft={(id) => {
        setAssistantOpen(false)
        router.push(`/requests/${id}`)
      }}
      defaultType={goal ? (goalById.get(goal)?.primaryAction ?? 'list') : 'list'}
    />
  )

  const selectGoal = (g: GoalId) => {
    setGoal(g)
    resetSearch()
    setQuery('')
    simulateLoad()
  }

  const changeCity = (id: string) => {
    setCityId(id)
    setArea(null)
    resetSearch()
    if (cityById.get(id)?.available) simulateLoad()
  }

  const focusBusiness = (id: string) => {
    setFocus({ id, nonce: Date.now() })
    setMobileView('map')
  }

  const handleAction = (type: RequestType) => {
    const id = createDraft({
      type,
      businessIds: selection,
      cityId,
      goal,
      query: query || undefined,
      categoryHint: filters.categories[0],
      districtHint: filters.districts.length === 1 ? districtById.get(filters.districts[0])?.name : undefined,
    })
    setSelection([])
    router.push(`/requests/${id}`)
  }

  const goalDef = goal ? goalById.get(goal) : null

  if (!goalDef) {
    return (
      <main className="flex-1">
        <GoalPicker onSelect={selectGoal} onOpenAssistant={() => setAssistantOpen(true)} />
        {assistant}
      </main>
    )
  }

  const mapState: MapState = !city?.available ? 'unavailable' : loading ? 'loading' : results.length === 0 ? 'empty' : 'ready'
  const primary = intent ?? goalDef.primaryAction

  return (
    <main data-viewport-workspace className="flex min-h-0 flex-1 flex-col lg:h-dvh lg:max-h-dvh lg:flex-none lg:overflow-hidden">
      <h1 className="sr-only">خريطة الفرص — {goalDef.label}</h1>
      <div className="flex flex-col gap-2.5 border-b bg-card px-4 py-3">
        <SearchToolbar
          key={`${goal}-${cityId}-${query}`}
          goal={goalDef}
          onChangeGoal={() => setGoal(null)}
          cityId={cityId}
          onCityChange={changeCity}
          filters={filters}
          onFiltersChange={setFilters}
          initialQuery={query}
          onSearch={handleSearch}
          onOpenAssistant={() => setAssistantOpen(true)}
        />
        <FilterBar cityId={cityId} filters={filters} onChange={setFilters} scope={scope} />
      </div>

      <div className="flex items-center gap-2 px-4 pt-3 lg:hidden">
        <div role="tablist" aria-label="طريقة العرض" className="grid flex-1 grid-cols-2 rounded-lg border bg-card p-0.5">
          {(
            [
              ['map', 'الخريطة', MapIcon],
              ['list', `القائمة (${listResults.length})`, List],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={mobileView === v}
              onClick={() => setMobileView(v)}
              className={cn(
                'inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium',
                mobileView === v ? 'bg-foreground text-background' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(22rem,26rem)_1fr]">
        <section
          aria-label="النتائج"
          className={cn('min-h-0 overflow-y-auto border-l px-4 py-4 lg:block', mobileView === 'list' ? 'block flex-1 pb-40' : 'hidden', 'lg:pb-28')}
        >
          {area ? (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-accent px-3 py-2 text-sm">
              <BoxSelect className="size-4 shrink-0 text-primary" aria-hidden />
              <p className="min-w-0 flex-1 truncate">
                محصورة في <span className="font-semibold">{area.label}</span> · {listResults.length} من {results.length}
              </p>
              <Button size="xs" variant="ghost" onClick={() => setArea(null)}>
                <X data-icon="inline-start" />
                مسح
              </Button>
            </div>
          ) : null}
          <ResultsPanel
            results={city?.available ? listResults : []}
            scope={scope}
            duplicatesMerged={duplicatesMerged}
            interpretation={interpretation}
            filters={filters}
            onFiltersChange={setFilters}
            selectedIds={selection}
            focusedId={focus?.id ?? null}
            onToggle={toggleSelect}
            onFocus={focusBusiness}
            onSelectAll={(ids, select) =>
              setSelection(select ? Array.from(new Set([...selection, ...ids])) : selection.filter((id) => !ids.includes(id)))
            }
            loading={loading}
          />
        </section>

        <section aria-label="الخريطة" className={cn('relative min-h-0 p-3 lg:block lg:p-4', mobileView === 'map' ? 'block flex-1' : 'hidden')}>
          <BusinessMap
            cityId={cityId}
            businesses={results}
            selectedIds={selection}
            onTogglePin={toggleSelect}
            focusRequest={focus}
            highlightDistricts={filters.districts}
            highlightStreets={filters.streets}
            state={mapState}
            onResetFilters={resetSearch}
            onRetry={() => changeCity('riyadh')}
            area={area}
            onAreaChange={setArea}
            onSelectMany={(ids) => setSelection(Array.from(new Set([...selection, ...ids])))}
            onShowList={() => setMobileView('list')}
            reserveBottom={selection.length > 0}
            className="h-full"
          />
        </section>
      </div>

      <div className="pointer-events-none fixed inset-x-3 bottom-[4.5rem] z-30 lg:right-[calc(15rem+1rem)] lg:bottom-4 lg:left-4">
        <SelectionTray
          count={selection.length}
          primary={primary}
          onClear={() => setSelection([])}
          onAction={handleAction}
          className="pointer-events-auto mx-auto max-w-3xl"
        />
      </div>

      {assistant}
    </main>
  )
}
