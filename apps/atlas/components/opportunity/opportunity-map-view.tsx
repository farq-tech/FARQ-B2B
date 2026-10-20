'use client'

import { BoxSelect, List, Map as MapIcon, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BusinessMap } from '@/components/map/business-map'
import type { MapState } from '@/components/map/mock-map'
import { Button } from '@/components/ui/button'
import { type MapArea } from '@/lib/geo'
import { goalById } from '@/lib/goals'
import { BUYER_ROLES, SUPPLIER_ROLES, cityById, districtById } from '@/lib/mock-data'
import { EMPTY_FILTERS, mergeParsedIntoFilters, parseQuery, type ParsedQuery } from '@/lib/search'
import { loadLiveMarket, type LiveMarket } from '@/lib/live-market'
import { useAppStore } from '@/lib/store'
import type { Filters, GoalId, RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AssistantPanel } from './assistant-panel'
import { GoalPicker } from './goal-picker'
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
  const [market, setMarket] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; data: LiveMarket | null }>({ status: 'idle', data: null })
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const simulateLoad = (ms = 650) => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    setLoading(true)
    loadTimer.current = setTimeout(() => setLoading(false), ms)
  }

  const city = cityById.get(cityId)

  useEffect(() => {
    if (!goal) return
    const controller = new AbortController()
    setMarket({ status: 'loading', data: null })
    loadLiveMarket(cityId, query)
      .then((data) => {
        if (!controller.signal.aborted) setMarket({ status: 'ready', data })
      })
      .catch(() => {
        if (!controller.signal.aborted) setMarket({ status: 'error', data: null })
      })
    return () => controller.abort()
  }, [cityId, goal, query])


  const liveDistricts = market.data?.counts.slice().sort((a, b) => b.n - a.n).slice(0, 12) ?? []


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

  const handlePrepareDraft = (_text: string, _parsed: ParsedQuery, _type: RequestType) => {
    // Real entities are intentionally unavailable until Atlas has an authenticated directory session.
    return null
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

  const mapState: MapState = !city?.available || market.status === 'error' ? 'unavailable' : loading || market.status === 'loading' ? 'loading' : market.status === 'ready' ? 'ready' : 'unavailable'
  // The prototype's seeded establishments must never appear as real marketplace results.
  const visibleResults: never[] = []
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
          initialQuery={query}
          onSearch={handleSearch}
          onOpenAssistant={() => setAssistantOpen(true)}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">بيانات سوق حية</span>
          <span>{query ? `مقيّدة بالنشاط: ${query}` : 'اختر نشاطاً لتحديث كثافة الأحياء.'}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pt-3 lg:hidden">
        <div role="tablist" aria-label="طريقة العرض" className="grid flex-1 grid-cols-2 rounded-lg border bg-card p-0.5">
          {(
            [
              ['map', 'الخريطة', MapIcon],
              ['list', 'ملخص السوق', List],
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
          <section className="flex flex-col gap-3" aria-label="ملخص السوق الحي">
            <div className="rounded-xl border bg-card p-4">
              <p className="font-semibold">{query ? `نتائج نشاط «${query}»` : 'سوق المدينة'}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">تتغير خريطة الأحياء والإحصاءات بحسب البحث. لا نعرض جهات أو بيانات اتصال تجريبية.</p>
              {market.status === 'ready' ? (
                <dl className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">منشآت ضمن النطاق</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{market.data?.summary?.total?.toLocaleString('en-US') ?? '—'}</dd></div>
                  <div className="rounded-lg bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">إشارات واتساب</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{market.data?.summary?.n_whatsapp?.toLocaleString('en-US') ?? '—'}</dd></div>
                </dl>
              ) : null}
            </div>
            {market.status === 'ready' ? (
              <div className="rounded-xl border bg-card p-4">
                <p className="text-sm font-semibold">الأحياء الأعلى نشاطاً</p>
                <ul className="mt-3 flex flex-col divide-y">
                  {liveDistricts.map((district) => <li key={district.district_ar} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{district.district_ar}</span><span className="font-semibold tabular-nums">{district.n.toLocaleString('en-US')}</span></li>)}
                </ul>
              </div>
            ) : null}
            {market.status === 'error' ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">تعذر تحميل بيانات السوق الحية. <button type="button" className="font-medium text-primary underline" onClick={() => window.location.reload()}>إعادة المحاولة</button></div> : null}
          </section>
        </section>

        <section aria-label="الخريطة" className={cn('relative min-h-0 p-3 lg:block lg:p-4', mobileView === 'map' ? 'block flex-1' : 'hidden')}>
          <BusinessMap
            cityId={cityId}
            businesses={visibleResults}
            selectedIds={selection}
            onTogglePin={toggleSelect}
            focusRequest={focus}
            highlightDistricts={filters.districts}
            highlightStreets={filters.streets}
            state={mapState}
            liveDistricts={market.data?.districts}
            liveCounts={market.data?.counts}
            liveSummary={market.data?.summary}
            onResetFilters={resetSearch}
            onRetry={() => window.location.reload()}
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
