'use client'

import { BoxSelect, Gauge, List, Map as MapIcon, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BusinessMap } from '@/components/map/business-map'
import type { MapState } from '@/components/map/mock-map'
import { Button } from '@/components/ui/button'
import { type MapArea } from '@/lib/geo'
import { goalById } from '@/lib/goals'
import { BUYER_ROLES, SUPPLIER_ROLES, cityById, districtById } from '@/lib/mock-data'
import { EMPTY_FILTERS, mergeParsedIntoFilters, parseQuery, type ParsedQuery } from '@/lib/search'
import { resolveLiveActivityScope } from '@/lib/activity-scope'
import { districtAreaForQuery, districtDisplayName, districtNameById, findDistrictByName, normalizeDistrictName, stableDistrictId } from '@/lib/live-district'
import { loadLiveActivityCatalog, loadLiveMarket, type DistrictCount, type LiveActivityMain, type LiveMarket } from '@/lib/live-market'
import { useAppStore } from '@/lib/store'
import type { Filters, GoalId, RequestType } from '@/lib/types'
import { trackDraftPrepared, trackLiveActivityScopeApplied, trackMapDetailLevel, trackMarketInsightOpened, trackMarketSearch, trackSelectionChange } from '@/lib/commercial-metrics'
import { cn } from '@/lib/utils'
import { AssistantPanel } from './assistant-panel'
import { GoalPicker } from './goal-picker'
import { LiveActivityFilter } from './live-activity-filter'
import { LiveEntityResults, type DirectoryObjective, type DirectorySummary, type LiveEntity, type DirectoryLoadState } from './live-entity-results'
import { MarketScope } from './market-scope'
import { SearchToolbar } from './search-toolbar'
import { SelectionTray } from './selection-tray'

function inferGoal(parsed: ParsedQuery): GoalId {
  if (parsed.intent === 'rfq') return 'rfq'
  if (parsed.intent === 'campaign') return 'target'
  if (parsed.roles.some((r) => BUYER_ROLES.includes(r))) return 'find-buyers'
  if (parsed.roles.some((r) => SUPPLIER_ROLES.includes(r)) || parsed.categories.length) return 'find-supplier'
  return 'explore'
}

/**
 * Directory rows must always come from the semantic endpoint. `browse` is only
 * for map tiles and intentionally ignores a free-text query. Marketing flips
 * the relationship to likely buyers; every other Atlas goal looks for the
 * named trade itself or its suppliers.
 */
function directoryObjective(goal: GoalId | null, intent: RequestType | null): DirectoryObjective {
  return goal === 'target' || intent === 'campaign' ? 'marketing' : 'purchase'
}

type RankedDistrict = DistrictCount & { reviewScore: number }

function districtKey(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function rankDistricts(districts: DistrictCount[], goal: GoalId | null, visibleDistricts: Set<string>): RankedDistrict[] {
  // The aggregate endpoint can include alternate spellings and tiny unmatched
  // rows. An opportunity list must only promote districts that a user can
  // actually open on this map.
  const mapped = visibleDistricts.size ? districts.filter((district) => visibleDistricts.has(districtKey(district.district_ar))) : districts
  const maxCount = Math.max(1, ...mapped.map((district) => district.n))
  const meaningful = mapped.filter((district) => district.n >= Math.max(5, Math.ceil(maxCount * 0.002)))
  const candidates = meaningful.length >= 3 ? meaningful : mapped
  const weights = goal === 'target'
    ? { volume: 0.45, whatsapp: 0.45, wholesale: 0.10 }
    : goal === 'rfq' || goal === 'find-supplier'
      ? { volume: 0.55, whatsapp: 0.10, wholesale: 0.35 }
      : { volume: 0.70, whatsapp: 0.20, wholesale: 0.10 }
  return candidates
    .map((district) => {
      const volume = district.n / maxCount
      const whatsapp = Math.min(1, (district.n_whatsapp ?? 0) / Math.max(1, district.n))
      const wholesale = Math.min(1, (district.n_wholesale ?? 0) / Math.max(1, district.n))
      return { ...district, reviewScore: Math.round(100 * (volume * weights.volume + whatsapp * weights.whatsapp + wholesale * weights.wholesale)) }
    })
    .sort((a, b) => b.reviewScore - a.reviewScore || b.n - a.n)
    .slice(0, 12)
}

/**
 * A natural-language search can name a broad commercial category while also
 * containing a precise specialty. Prefer an unambiguous catalog scope over
 * leaving the aggregate service to infer the phrase alone. The query remains
 * visible in the UI; this only determines which aggregate market geometry is
 * loaded for the map.
 */
export function OpportunityMapView() {
  const router = useRouter()
  const searchParams = useSearchParams()
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
  const [mapDistrictSelections, setMapDistrictSelections] = useState<Array<{ id: string; name: string }>>([])
  const [market, setMarket] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; data: LiveMarket | null }>({ status: 'idle', data: null })
  const [activityCatalog, setActivityCatalog] = useState<LiveActivityMain[]>([])
  const [activeActivity, setActiveActivity] = useState<LiveActivityMain | null>(null)
  const [activityScopeWasInferred, setActivityScopeWasInferred] = useState(false)
  const [liveEntities, setLiveEntities] = useState<LiveEntity[]>([])
  const [liveDirectorySummary, setLiveDirectorySummary] = useState<DirectorySummary | null>(null)
  const [liveMapQuery, setLiveMapQuery] = useState<string | null>(null)
  const [liveTileAccess, setLiveTileAccess] = useState<string | null>(null)
  const [directoryState, setDirectoryState] = useState<DirectoryLoadState>('idle')
  const [liveEntitySnapshots, setLiveEntitySnapshots] = useState<Record<string, LiveEntity>>({})
  const [livePinsComplete, setLivePinsComplete] = useState(false)
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handledEntryGoal = useRef(false)
  const handledEntryDistrict = useRef(false)

  // LiveEntityResults publishes once per response. Keeping this callback stable
  // prevents its effect from re-publishing the same rows after every map render.
  const handleLiveResults = useCallback((rows: LiveEntity[]) => {
    setLiveEntities(rows)
    setLiveEntitySnapshots((current) => ({ ...current, ...Object.fromEntries(rows.map((entity) => [entity.id, entity])) }))
  }, [])

  const simulateLoad = (ms = 650) => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    setLoading(true)
    loadTimer.current = setTimeout(() => setLoading(false), ms)
  }

  const city = cityById.get(cityId)
  // Atlas stores selected districts as stable local ids while the live market
  // service accepts canonical Arabic names. Convert at the boundary so the
  // map, summary, and street-density requests all share the same scope.
  const liveDistrictNameById = useMemo(
    () => districtNameById(market.data?.districts.features ?? []),
    [market.data?.districts],
  )
  const selectedAreaDistrict = useMemo(() => {
    if (area?.kind !== 'district') return null
    const name = liveDistrictNameById.get(area.districtId) ?? districtById.get(area.districtId)?.name ?? area.label.replace(/^حي\s+/, '').trim()
    return name || null
  }, [area, liveDistrictNameById])
  const liveDistrictScope = useMemo(() => {
    const names = [
      ...filters.districts.flatMap((id) => districtById.get(id)?.name ? [districtById.get(id)!.name] : []),
      ...(selectedAreaDistrict ? [selectedAreaDistrict] : []),
      ...mapDistrictSelections.map((district) => district.name),
    ]
    const unique = new Map<string, string>()
    for (const name of names) {
      const key = normalizeDistrictName(name)
      if (!unique.has(key)) unique.set(key, name)
    }
    return Array.from(unique.values())
  }, [filters.districts, selectedAreaDistrict, mapDistrictSelections])
  const selectedDistrictIds = useMemo(() => {
    const selectedNames = new Set(liveDistrictScope.map(normalizeDistrictName))
    const matchingLiveIds = (market.data?.districts.features ?? []).flatMap((feature) => {
      const name = districtDisplayName(feature)
      const id = stableDistrictId(feature)
      return name && id && selectedNames.has(normalizeDistrictName(name)) ? [id] : []
    })
    return Array.from(new Set([
      ...filters.districts,
      ...mapDistrictSelections.map((district) => district.id),
      ...(area?.kind === 'district' ? [area.districtId] : []),
      ...matchingLiveIds,
    ]))
  }, [area, filters.districts, liveDistrictScope, mapDistrictSelections, market.data?.districts])

  // Assistant parsing can finish before polygon geometry arrives. Reconcile
  // the saved district name to the provider id once it is available so the
  // same applied filter is also visible as a selected map boundary.
  useEffect(() => {
    if (area || filters.districts.length !== 1) return
    const name = districtById.get(filters.districts[0])?.name
    const feature = name ? findDistrictByName(market.data?.districts.features ?? [], name) : null
    const id = feature ? stableDistrictId(feature) : null
    if (id && name) setArea({ kind: 'district', districtId: id, label: `حي ${name}` })
  }, [area, filters.districts, market.data?.districts])

  useEffect(() => {
    if (!goal) return
    const controller = new AbortController()
    setMarket({ status: 'loading', data: null })
    loadLiveMarket(cityId, activeActivity ? {
      mainId: activeActivity.main_id,
      subIds: activeActivity.subs.map((item) => item.sub_id),
      districts: liveDistrictScope,
      objective: directoryObjective(goal, intent),
    } : { q: query, districts: liveDistrictScope, objective: directoryObjective(goal, intent) })
      .then((data) => {
        if (!controller.signal.aborted) setMarket({ status: 'ready', data })
      })
      .catch(() => {
        if (!controller.signal.aborted) setMarket({ status: 'error', data: null })
      })
    return () => controller.abort()
  }, [cityId, goal, intent, query, activeActivity, liveDistrictScope])

  useEffect(() => {
    if (!goal) return
    let active = true
    loadLiveActivityCatalog(cityId, { districts: liveDistrictScope })
      .then((items) => { if (active) setActivityCatalog(items) })
      .catch(() => { if (active) setActivityCatalog([]) })
    return () => { active = false }
  }, [cityId, goal, liveDistrictScope])

  // Search can happen before the catalog reaches the client. Apply the same
  // deterministic scope once it is available instead of keeping a broad,
  // potentially misleading free-text aggregate.
  useEffect(() => {
    if (activeActivity || !query || !activityCatalog.length) return
    const parsed = parseQuery(query, cityId)
    const inferred = resolveLiveActivityScope(parsed.categories, parsed.specialties, activityCatalog, query)
    if (!inferred) return
    setActiveActivity(inferred)
    setActivityScopeWasInferred(true)
    trackLiveActivityScopeApplied({ city: cityId, shops: inferred.shops })
  }, [activeActivity, activityCatalog, cityId, query])


  const visibleDistrictNames = useMemo(() => new Set(
    (market.data?.districts.features ?? []).flatMap((feature) => {
      const properties = feature.properties ?? {}
      const value = properties.ar ?? properties.name_ar ?? properties.district_ar ?? properties.name
      return typeof value === 'string' ? [districtKey(value)] : []
    }),
  ), [market.data?.districts])
  const liveDistricts = useMemo(() => rankDistricts(market.data?.counts ?? [], goal, visibleDistrictNames), [market.data?.counts, goal, visibleDistrictNames])
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
  const marketReadAt = useMemo(() => {
    if (!market.data?.loadedAt) return null
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(market.data.loadedAt))
  }, [market.data?.loadedAt])


  const resetSearch = () => {
    setArea(null)
    setMapDistrictSelections([])
    setActiveActivity(null)
    setActivityScopeWasInferred(false)
    setFilters(EMPTY_FILTERS)
    setFreeText([])
    setInterpretation([])
    setIntent(null)
  }

  const applyQuery = (text: string, parsed: ParsedQuery, nextGoal?: GoalId) => {
    const inferredActivity = resolveLiveActivityScope(parsed.categories, parsed.specialties, activityCatalog, text)
    setActiveActivity(inferredActivity)
    setActivityScopeWasInferred(Boolean(inferredActivity))
    if (inferredActivity) trackLiveActivityScopeApplied({ city: cityId, shops: inferredActivity.shops })
    setQuery(text)
    const requestedDistrict = parsed.districts
      .map((id) => districtById.get(id)?.name)
      .find((name): name is string => Boolean(name))
    const liveDistrict = requestedDistrict ? findDistrictByName(market.data?.districts.features ?? [], requestedDistrict) : null
    setArea((current) => districtAreaForQuery(current, requestedDistrict, liveDistrict))
    // A new intent defines a new candidate cohort. Retaining entities from a
    // prior search can silently carry unrelated businesses into a campaign.
    setSelection([])
    setFilters((f) => mergeParsedIntoFilters(nextGoal ? EMPTY_FILTERS : f, parsed))
    setFreeText(parsed.freeText)
    setInterpretation(parsed.chips)
    setIntent(parsed.intent)
    if (nextGoal) setGoal(nextGoal)
    simulateLoad(450)
  }

  const handleSearch = (text: string) => {
    trackMarketSearch({ city: cityId, goal: goal ?? 'explore', query: text })
    setActiveActivity(null)
    setActivityScopeWasInferred(false)
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



  const assistant = (
    <AssistantPanel
      open={assistantOpen}
      onClose={() => setAssistantOpen(false)}
      cityId={cityId}
      onApply={handleAssistantApply}
    />
  )

  const selectGoal = (g: GoalId) => {
    setGoal(g)
    resetSearch()
    setQuery('')
    simulateLoad()
  }

  useEffect(() => {
    if (handledEntryGoal.current) return
    const value = searchParams.get('goal')
    if (!value || !goalById.has(value as GoalId)) return
    handledEntryGoal.current = true
    setGoal(value as GoalId)
    resetSearch()
    setQuery('')
    simulateLoad()
  // The landing-page parameters initialize the map once; subsequent state
  // changes must stay under the visitor's control.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // The login gate returns users to the same district. Aggregates remain
  // public, while this restores the polygon before the authenticated directory
  // loads the matching pins and basic entity details.
  useEffect(() => {
    if (handledEntryDistrict.current) return
    const name = searchParams.get('district')?.trim()
    if (!name) return
    if (!goal) {
      setGoal('explore')
      simulateLoad()
      return
    }
    const feature = findDistrictByName(market.data?.districts.features ?? [], name)
    const id = feature ? stableDistrictId(feature) : null
    if (!id || !feature) return
    handledEntryDistrict.current = true
    const label = districtDisplayName(feature) ?? name
    setArea({ kind: 'district', districtId: id, label: `حي ${label}` })
    setFocusDistrict({ name: label, nonce: Date.now() })
  }, [goal, market.data?.districts, searchParams])

  const changeCity = (id: string) => {
    // The selector can include planned cities. Do not replace a working market
    // view with an unavailable scope until its data coverage is ready.
    if (!cityById.get(id)?.available) return
    setCityId(id)
    setArea(null)
    resetSearch()
    simulateLoad()
  }

  const selectLiveActivity = (activity: LiveActivityMain, label = activity.main_ar) => {
    trackLiveActivityScopeApplied({ city: cityId, shops: activity.shops })
    setArea(null)
    setSelection([])
    setActiveActivity(activity)
    setActivityScopeWasInferred(false)
    setQuery(label)
    setFilters(EMPTY_FILTERS)
    setFreeText([])
    setInterpretation([`التصنيف: ${label}`])
    setIntent(null)
    simulateLoad(450)
  }

  const clearLiveActivity = () => {
    setActiveActivity(null)
    setActivityScopeWasInferred(false)
    setQuery('')
    setFilters(EMPTY_FILTERS)
    setFreeText([])
    setInterpretation([])
    setIntent(null)
    simulateLoad(450)
  }

  const clearDistrictScope = () => {
    setArea(null)
    setMapDistrictSelections([])
    setFilters((current) => ({ ...current, districts: [] }))
  }

  const toggleMapDistrictScope = (id: string, name: string) => {
    const filterIds = filters.districts.filter((filterId) => {
      const filterName = districtById.get(filterId)?.name
      return filterName && normalizeDistrictName(filterName) === normalizeDistrictName(name)
    })
    const isArea = area?.kind === 'district' && area.districtId === id
    const isMapSelection = mapDistrictSelections.some((district) => district.id === id)
    const isFilterSelection = filterIds.length > 0

    if (isArea || isMapSelection || isFilterSelection) {
      const remaining = mapDistrictSelections.filter((district) => district.id !== id)
      setMapDistrictSelections(remaining)
      if (isFilterSelection) setFilters((current) => ({ ...current, districts: current.districts.filter((filterId) => !filterIds.includes(filterId)) }))
      if (isArea) {
        if (remaining.length === 1 && filters.districts.length === 0) {
          const [next] = remaining
          setArea({ kind: 'district', districtId: next.id, label: `حي ${next.name}`, districtName: next.name })
          setMapDistrictSelections([])
        } else setArea(null)
      } else if (isMapSelection && remaining.length === 1 && !area && filters.districts.length === 0) {
        const [next] = remaining
        setArea({ kind: 'district', districtId: next.id, label: `حي ${next.name}`, districtName: next.name })
        setMapDistrictSelections([])
      }
      return
    }

    const next = { id, name }
    if (area?.kind === 'district') {
      const existing = mapDistrictSelections.some((district) => district.id === area.districtId)
        ? mapDistrictSelections
        : [...mapDistrictSelections, { id: area.districtId, name: selectedAreaDistrict ?? area.label.replace(/^حي\s+/, '').trim() }]
      setMapDistrictSelections([...existing, next])
      setArea(null)
    } else if (liveDistrictScope.length === 0) {
      setArea({ kind: 'district', districtId: id, label: `حي ${name}`, districtName: name })
    } else {
      setMapDistrictSelections([...mapDistrictSelections, next])
    }
  }

  const focusBusiness = (id: string) => {
    setFocus({ id, nonce: Date.now() })
    setMobileView('map')
  }

  const focusDistrictOnMap = (name: string) => {
    const feature = findDistrictByName(market.data?.districts.features ?? [], name)
    const id = feature ? stableDistrictId(feature) : null
    if (id && feature) setArea({ kind: 'district', districtId: id, label: `حي ${districtDisplayName(feature) ?? name}` })
    setFocusDistrict({ name, nonce: Date.now() })
    setMobileView('map')
  }

  const handleAreaChange = (nextArea: MapArea | null) => {
    // Atlas scopes its map by official district boundaries only. Reject any
    // legacy free-drawn area that may survive a client-side navigation.
    setArea(nextArea?.kind === 'rect' ? null : nextArea)
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
      categoryHint: activeActivity?.main_ar ?? filters.categories[0],
      districtHint: selectedAreaDistrict ?? (filters.districts.length === 1 ? districtById.get(filters.districts[0])?.name : undefined),
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
  // The authenticated directory applies the stricter, documented WhatsApp
  // validity rule. When a district is selected it is the authoritative cohort
  // for the list, points, and contact-signal statistic together.
  const useDirectoryDistrictSummary = liveDistrictScope.length === 1 && Boolean(selectedAreaDistrict && liveDirectorySummary)
  const scopeTotal = useDirectoryDistrictSummary ? liveDirectorySummary?.total ?? null : market.data?.summary?.total ?? null
  const scopeWhatsapp = useDirectoryDistrictSummary ? liveDirectorySummary?.withWhatsapp ?? null : market.data?.summary?.n_whatsapp ?? null
  const marketSummaryTitle = query
    ? liveDistrictScope.length ? `ملخص نشاط «${query}» في النطاق المحدد` : `ملخص نشاط «${query}»`
    : liveDistrictScope.length === 1 ? `ملخص حي ${liveDistrictScope[0]}`
      : liveDistrictScope.length > 1 ? 'ملخص الأحياء المحددة'
        : 'ملخص سوق المدينة'

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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          <span className="font-medium text-primary">قراءة سوق حية</span>
          {activityScopeWasInferred && activeActivity ? <span>التصنيف المطبق: {activeActivity.subs.length === 1 ? activeActivity.subs[0]?.sub_ar : activeActivity.main_ar}</span> : null}
          {marketReadAt ? <span>آخر قراءة: {marketReadAt}</span> : null}
          {market.data?.unavailable.length ? <span className="text-amber-700">تحديث جزئي للمؤشرات.</span> : null}
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

      <div className="flex min-h-0 flex-1 flex-col gap-0 lg:grid lg:grid-cols-[minmax(21rem,25rem)_minmax(0,1fr)]">
        <section
          aria-label="النتائج"
          className={cn('min-h-0 overflow-y-auto border-l bg-muted/[0.18] px-4 py-4 lg:block', mobileView === 'list' ? 'block flex-1 pb-40' : 'hidden', 'lg:pb-28')}
        >
          <section className="flex flex-col gap-3" aria-label="ملخص السوق الحي">
            <MarketScope goal={goalDef} city={city?.name ?? 'المدينة'} query={query} districts={liveDistrictScope} total={market.status === 'ready' ? scopeTotal : null} onClearQuery={clearLiveActivity} onClearDistrict={clearDistrictScope} />
            <div className="rounded-2xl border bg-card p-4">
              <p className="font-semibold">{marketSummaryTitle}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">إحصاءات هذا النطاق فقط. لا نعرض أرقام الاتصال هنا؛ القرار يبنى على النشاط والموقع وسبب المطابقة.</p>
              {market.status === 'ready' ? (
                <>
                  <dl className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">منشآت ضمن النطاق</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{scopeTotal?.toLocaleString('en-US') ?? '—'}</dd></div>
                    <div className="rounded-lg bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">إشارات واتساب قابلة للفحص</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{scopeWhatsapp?.toLocaleString('en-US') ?? '—'}</dd></div>
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
            <LiveActivityFilter activities={activityCatalog} active={activeActivity} onSelect={selectLiveActivity} onClear={clearLiveActivity} />
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
            <LiveEntityResults query={query} cityId={cityId} objective={directoryObjective(goal, intent)} district={selectedAreaDistrict ?? undefined} prefetchAllForMap={Boolean(selectedAreaDistrict)} onResults={handleLiveResults} onSummary={setLiveDirectorySummary} onMapQuery={setLiveMapQuery} onTileAccess={setLiveTileAccess} onStateChange={setDirectoryState} onPinsCompleteChange={setLivePinsComplete} selectedIds={selection} onToggle={(id) => handleToggleSelect(id, 'directory')} />
            {market.status === 'error' ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">تعذر تحميل بيانات السوق الحية. <button type="button" className="font-medium text-primary underline" onClick={() => window.location.reload()}>إعادة المحاولة</button></div> : null}
          </section>
        </section>

        <section aria-label="الخريطة" className={cn('relative min-h-0 bg-background p-3 lg:block lg:p-4', mobileView === 'map' ? 'block flex-1' : 'hidden')}>
          <BusinessMap
            cityId={cityId}
            businesses={visibleResults}
            selectedIds={selection}
            onTogglePin={(id) => handleToggleSelect(id, 'map_pin')}
            focusRequest={focus}
            focusDistrictRequest={focusDistrict}
            focusStreetRequest={focusStreet}
            highlightDistricts={selectedDistrictIds}
            highlightStreets={filters.streets}
            state={mapState}
            liveDistricts={market.data?.districts}
            liveCounts={market.data?.counts}
            liveSummary={market.data?.summary}
            liveStreets={market.data?.streets}
            liveClusters={market.data?.clusters}
            liveEntityPins={liveEntities}
            liveEntityPinsComplete={livePinsComplete}
            liveDirectorySummary={liveDirectorySummary}
            liveMapQuery={liveMapQuery}
            liveTileAccess={liveTileAccess}
            onLiveEntityResolved={(entity) => setLiveEntitySnapshots((current) => ({ ...current, [entity.id]: entity }))}
            liveEntityState={directoryState}
            onDetailLevelChange={(level) => trackMapDetailLevel({ city: cityId, level })}
            onMarketInsightOpened={({ kind, count }) => trackMarketInsightOpened({ city: cityId, kind, count })}
            selectedDistrictIds={selectedDistrictIds}
            onDistrictScopeToggle={toggleMapDistrictScope}
            onResetFilters={resetSearch}
            onRetry={() => window.location.reload()}
            area={area}
            onAreaChange={handleAreaChange}
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
