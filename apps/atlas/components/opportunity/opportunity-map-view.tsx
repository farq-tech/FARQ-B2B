'use client'

import { BoxSelect, Gauge, List, Map as MapIcon, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BusinessMap } from '@/components/map/business-map'
import type { MapState } from '@/components/map/mock-map'
import { Button } from '@/components/ui/button'
import { type MapArea } from '@/lib/geo'
import { goalById } from '@/lib/goals'
import { BUYER_ROLES, SUPPLIER_ROLES, cityById, districtById } from '@/lib/mock-data'
import { EMPTY_FILTERS, mergeParsedIntoFilters, parseQuery, type ParsedQuery } from '@/lib/search'
import { loadLiveMarket, type DistrictCount, type LiveMarket } from '@/lib/live-market'
import { useAppStore } from '@/lib/store'
import type { Filters, GoalId, RequestType } from '@/lib/types'
import { trackDraftPrepared, trackMapDetailLevel, trackMarketSearch, trackSelectionChange } from '@/lib/commercial-metrics'
import { cn } from '@/lib/utils'
import { AssistantPanel } from './assistant-panel'
import { GoalPicker } from './goal-picker'
import { LiveEntityResults, type LiveEntity } from './live-entity-results'
import { SearchToolbar } from './search-toolbar'
import { SelectionTray } from './selection-tray'

function inferGoal(parsed: ParsedQuery): GoalId {
  if (parsed.intent === 'rfq') return 'rfq'
  if (parsed.intent === 'campaign') return 'target'
  if (parsed.roles.some((r) => BUYER_ROLES.includes(r))) return 'find-buyers'
  if (parsed.roles.some((r) => SUPPLIER_ROLES.includes(r)) || parsed.categories.length) return 'find-supplier'
  return 'explore'
}

type RankedDistrict = DistrictCount & { reviewScore: number }

function rankDistricts(districts: DistrictCount[], goal: GoalId | null): RankedDistrict[] {
  const maxCount = Math.max(1, ...districts.map((district) => district.n))
  const weights = goal === 'target'
    ? { volume: 0.45, whatsapp: 0.45, wholesale: 0.10 }
    : goal === 'rfq' || goal === 'find-supplier'
      ? { volume: 0.55, whatsapp: 0.10, wholesale: 0.35 }
      : { volume: 0.70, whatsapp: 0.20, wholesale: 0.10 }
  return districts
    .map((district) => {
      const volume = district.n / maxCount
      const whatsapp = Math.min(1, (district.n_whatsapp ?? 0) / Math.max(1, district.n))
      const wholesale = Math.min(1, (district.n_wholesale ?? 0) / Math.max(1, district.n))
      return { ...district, reviewScore: Math.round(100 * (volume * weights.volume + whatsapp * weights.whatsapp + wholesale * weights.wholesale)) }
    })
    .sort((a, b) => b.reviewScore - a.reviewScore || b.n - a.n)
    .slice(0, 12)
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
  const [focusDistrict, setFocusDistrict] = useState<{ name: string; nonce: number } | null>(null)
  const [focusStreet, setFocusStreet] = useState<{ street: string; district?: string; nonce: number } | null>(null)
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [area, setArea] = useState<MapArea | null>(null)
  const [market, setMarket] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; data: LiveMarket | null }>({ status: 'idle', data: null })
  const [liveEntities, setLiveEntities] = useState<LiveEntity[]>([])
  const [liveEntitySnapshots, setLiveEntitySnapshots] = useState<Record<string, LiveEntity>>({})
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


  const liveDistricts = useMemo(() => rankDistricts(market.data?.counts ?? [], goal), [market.data?.counts, goal])
  const strongestStreet = useMemo(() => {
    const summaryStreet = market.data?.summary?.densest_street
    if (summaryStreet?.street_ar) return summaryStreet
    const feature = [...(market.data?.streets.features ?? [])]
      .filter((item) => Boolean(item.properties?.street_ar || item.properties?.label_ar))
      .sort((a, b) => (b.properties?.n ?? 0) - (a.properties?.n ?? 0))[0]
    if (!feature?.properties) return null
    return {
      street_ar: feature.properties.street_ar ?? feature.properties.label_ar,
      district_ar: feature.properties.district_ar,
      n: feature.properties.n,
      per_100m: undefined,
      sub_ar: undefined,
    }
  }, [market.data])


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
    trackMarketSearch({ city: cityId, goal: goal ?? 'explore', query: text })
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

  const handlePrepareDraft = async (text: string, parsed: ParsedQuery, type: RequestType) => {
    const draftGoal = goal ?? inferGoal(parsed)
    applyQuery(text, parsed, draftGoal)
    try {
      const response = await fetch('/api/market/entities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: text.trim(), city: cityId, limit: 12 }),
      })
      const payload = await response.json().catch(() => null) as { rows?: unknown } | null
      const rows = Array.isArray(payload?.rows) ? payload.rows.filter((row): row is LiveEntity => Boolean(row && typeof row === 'object' && typeof (row as LiveEntity).id === 'string')).slice(0, 12) : []
      if (!response.ok) return { id: '', count: 0, message: response.status === 401 ? 'سجّل الدخول أولاً لعرض الجهات الحية وتجهيز المسودة.' : 'تعذر تحميل الجهات الآن. بقي البحث مطبقاً على الخريطة.', login: response.status === 401 }
      if (rows.length === 0) return { id: '', count: 0, message: 'لم نجد جهات مطابقة لتجهيز مسودة. جرّب صياغة أوسع.' }
      setLiveEntities(rows)
      setLiveEntitySnapshots((current) => ({ ...current, ...Object.fromEntries(rows.map((entity) => [entity.id, entity])) }))
      const ids = rows.map((entity) => entity.id)
      setSelection(ids)
      const id = createDraft({
        type,
        businessIds: ids,
        liveBusinesses: rows,
        cityId,
        goal: draftGoal,
        query: text,
        categoryHint: parsed.categories[0],
        districtHint: parsed.districts.length === 1 ? districtById.get(parsed.districts[0])?.name : undefined,
      })
      trackDraftPrepared({ city: cityId, type, source: 'assistant', count: rows.length })
      return { id, count: rows.length }
    } catch {
      return { id: '', count: 0, message: 'تعذر الاتصال بخدمة الجهات. بقي البحث مطبقاً على الخريطة.' }
    }
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

  const focusDistrictOnMap = (name: string) => {
    setFocusDistrict({ name, nonce: Date.now() })
    setMobileView('map')
  }

  const focusStreetOnMap = (street: string, district?: string) => {
    setFocusStreet({ street, district, nonce: Date.now() })
    setMobileView('map')
  }

  const liveSelection = selection.flatMap((id) => liveEntitySnapshots[id] ? [liveEntitySnapshots[id]] : [])

  const handleToggleSelect = (id: string, source: 'map_pin' | 'directory' = 'map_pin') => {
    const selected = !selection.includes(id)
    toggleSelect(id)
    trackSelectionChange({ city: cityId, selected, source, selectedCount: selection.length + (selected ? 1 : -1) })
  }

  const handleSelectMany = (ids: string[]) => {
    const next = Array.from(new Set([...selection, ...ids]))
    if (next.length === selection.length) return
    setSelection(next)
    // Aggregate selection is measured without sending entity IDs or locations.
    trackSelectionChange({ city: cityId, selected: true, source: 'group', selectedCount: next.length })
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
      liveBusinesses: liveSelection,
    })
    trackDraftPrepared({ city: cityId, type, source: 'selection', count: selection.length })
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
          <span>{query ? `مقيّدة بالنشاط: ${query}` : 'اكتب نشاطاً لتخصيص قراءة السوق حسب حاجتك.'}</span>
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
                <>
                  <dl className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">منشآت ضمن النطاق</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{market.data?.summary?.total?.toLocaleString('en-US') ?? '—'}</dd></div>
                    <div className="rounded-lg bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">إشارات واتساب قابلة للفحص</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{market.data?.summary?.n_whatsapp?.toLocaleString('en-US') ?? '—'}</dd></div>
                  </dl>
                  {strongestStreet?.street_ar ? (
                    <section className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-3" aria-label="أقوى إشارة سوق">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Gauge className="size-4" aria-hidden /></span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold">أعلى كثافة في النتائج</p>
                          <p className="mt-0.5 truncate text-sm font-semibold">{strongestStreet.street_ar}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{[strongestStreet.sub_ar, strongestStreet.district_ar].filter(Boolean).join(' · ')}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span><strong className="text-foreground tabular-nums">{strongestStreet.n?.toLocaleString('en-US') ?? '—'}</strong> منشأة</span>
                        {strongestStreet.per_100m ? <span><strong className="text-foreground tabular-nums">{strongestStreet.per_100m.toLocaleString('en-US')}</strong> لكل 100 م</span> : null}
                        <button type="button" onClick={() => focusStreetOnMap(strongestStreet.street_ar!, strongestStreet.district_ar)} className="font-medium text-primary underline-offset-4 hover:underline">عرضه على الخريطة</button>
                      </div>
                    </section>
                  ) : null}
                  {market.data?.summary?.basis ? (
                    <details className="mt-3 text-xs leading-5 text-muted-foreground">
                      <summary className="cursor-pointer font-medium text-foreground">كيف حُسبت هذه النتائج؟</summary>
                      <p className="mt-1.5">{market.data.summary.basis}</p>
                    </details>
                  ) : null}
                </>
              ) : null}
            </div>
            {market.status === 'ready' ? (
              <div className="rounded-xl border bg-card p-4">
                <p className="text-sm font-semibold">أحياء أولى بالمراجعة</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">يختلف الترتيب حسب هدفك الحالي، وليس توقعاً لفرصة مؤكدة أو موافقة تواصل.</p>
                <ul className="mt-3 flex flex-col divide-y">
                  {liveDistricts.map((district) => (
                    <li key={district.district_ar}>
                      <button type="button" onClick={() => focusDistrictOnMap(district.district_ar)} className="flex w-full items-center justify-between gap-3 py-2 text-right text-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="min-w-0 flex-1 truncate">{district.district_ar}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground tabular-nums">{district.n.toLocaleString('en-US')}</span><span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-semibold text-primary tabular-nums">{district.reviewScore}/100</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
                {liveDistricts.length ? <details className="mt-2 text-[11px] leading-5 text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">كيف رُتّبت الأحياء؟</summary><p className="mt-1">نعطي وزناً لكثافة النشاط دائماً، ثم نرفع وزن إشارات واتساب عند الاستهداف أو نشاط الجملة عند البحث عن مورد أو طلب تسعير. اضغط على حي لتظهر قراءته على الخريطة.</p></details> : null}
              </div>
            ) : null}
            <LiveEntityResults query={query} cityId={cityId} onResults={(rows) => {
              setLiveEntities(rows)
              setLiveEntitySnapshots((current) => ({ ...current, ...Object.fromEntries(rows.map((entity) => [entity.id, entity])) }))
            }} selectedIds={selection} onToggle={(id) => handleToggleSelect(id, 'directory')} />
            {market.status === 'error' ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">تعذر تحميل بيانات السوق الحية. <button type="button" className="font-medium text-primary underline" onClick={() => window.location.reload()}>إعادة المحاولة</button></div> : null}
          </section>
        </section>

        <section aria-label="الخريطة" className={cn('relative min-h-0 p-3 lg:block lg:p-4', mobileView === 'map' ? 'block flex-1' : 'hidden')}>
          <BusinessMap
            cityId={cityId}
            businesses={visibleResults}
            selectedIds={selection}
            onTogglePin={(id) => handleToggleSelect(id, 'map_pin')}
            focusRequest={focus}
            focusDistrictRequest={focusDistrict}
            focusStreetRequest={focusStreet}
            highlightDistricts={filters.districts}
            highlightStreets={filters.streets}
            state={mapState}
            liveDistricts={market.data?.districts}
            liveCounts={market.data?.counts}
            liveSummary={market.data?.summary}
            liveStreets={market.data?.streets}
            liveClusters={market.data?.clusters}
            liveEntityPins={liveEntities}
            onDetailLevelChange={(level) => trackMapDetailLevel({ city: cityId, level })}
            onResetFilters={resetSearch}
            onRetry={() => window.location.reload()}
            area={area}
            onAreaChange={setArea}
            onSelectMany={handleSelectMany}
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
