import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import {
  districtCounts, districtInsights, hasUnconfirmedStatus, listCities, listDistricts, listTemplates, mapFocusQuery, mapProfile, marketSummary, searchTargets, streetCatalog, streetDensity, suggestSpecialties, whoBuys, type DistrictCount, type DistrictInsight, type MarketSummary, type WhoBuys, type SpecialtySuggestion, type StreetCatalog, type StreetDensityQuery, templateStatus, tradeClusters, waNumber, statusLabel, TargetingError, OUTREACH_TEMPLATE,
  type City, type MetaTemplate, type SearchFilters, type TargetRow, type TargetSearch, type TemplateStatus, type TradeCluster,
} from '../../api/targetingClient'
import {
  Badge, Button, ChannelBadge, Chip, CityIcon, ClustersIcon, DistrictIcon, ErrorIcon, FiltersIcon, Icon, MessageTemplatesIcon, NewRequestIcon,
  SaudiEstablishmentBadge, SearchIcon, SpecialtiesIcon, StreetIcon, SuccessIcon, SupplierIcon, Switch, UploadCatalogIcon, useIsMapCompact, WarningIcon, WholesaleIcon, type Channel,
} from '../../ui'
import { FOCUS_RING } from '../../ui/cx'
import { BUY_EXAMPLES, BUY_PLACEHOLDER, BUY_PLACEHOLDER_SHORT, cityCoords, marketNameFor, marketSuggestions, SELL_EXAMPLES, SELL_PLACEHOLDER, SELL_PLACEHOLDER_SHORT } from '../../lib/saudi'
import { formatNumber } from '../../lib/formatNumber'
import { readBooklet, type BookletLine } from '../../lib/readBooklet'
import { handoff, HANDOFF } from '../../lib/handoff'
import { mapAnalyticsConsent, mapResultProfileOpenEvent, mapSearchContactAvailabilityEvent, mapSearchFailedEvent, mapSearchFailureEvent, mapSearchLatencyEvent, mapSearchOutcomeEvent, mapSearchResultEvent, mapSearchRetryEvent, mapSearchStartedEvent, mapWholesaleFilterOutcomeEvent, recordMapInteraction } from '../../lib/mapAnalytics'
import { writeLocal } from '../../b2b/storage'
import { fetchConstructionWhatsAppPricing } from '../../api/constructionClient'
import { createOpportunityRequest, type OpportunityRequestKind } from '../../api/opportunityRequestsClient'
import { prepareMarketingCampaign } from '../../api/marketingClient'
import CampaignConfirmSheet from './CampaignConfirmSheet'
import TargetingAssistant, { type TargetingAssistantPlan } from './TargetingAssistant'
import StartSheet from './StartSheet'
import MyRequests from './MyRequests'
import Counters, { type CounterItem } from './map/Counters'
import DrawnLayerMap from './map/DrawnLayerMap'
import GuideTree from './map/GuideTree'
import ProfileDrawer from './map/ProfileDrawer'
import CampaignTray from './map/CampaignTray'
import StepStrip from './map/StepStrip'
import MapLegend from './map/MapLegend'
import { fitOf, type PinFit } from './map/model'
import { RowBadges } from './map/Badges'
import {
  countersOf, densityOf, districtAt, districtsFrom, fmtMeters, streetLine, streetsFrom, topStreets, districtsFromNames, guideOf, hasPoint, inDistricts, km, mainAr, mainIdOf, matchesFocus, pinsOf, safeLocationName, safeName, subAr, subIdOf,
  type District, type Focus, type Layer, type Street,
} from './map/model'
import type { LayerMapProps, Site } from './map/types'
import { directoryActivityQuery, hasDirectoryActivityEvidence, isExplicitPurchaseRequest, isWholesaleRequest, MAX_MAP_INTENTS, parseMapIntents, type MapIntent } from './multiIntent'

/*
 * «خريطة الفرص» v2 — owner-approved redesign 2026-10-16 (Canva concepts: airy light-grey map, charcoal pins with white glyphs,
 * soft green clusters, a clean results panel on the right). Everything comes from the targeting service (POST /search over
 * the KSA places set, GET /districts, POST /clusters); nothing is invented and nothing is stored on the device.
 *
 *   · live counters over the visible cohort (rows inside the chosen districts, the guide pick and the site radius)
 *   · one map layer at a time: main activities (charcoal pins) · subcategories (green circles) · specialties (navy chips)
 *   · districts: dashed outlines, tap to choose (several allowed); pins show only inside chosen districts
 *   · «الدليل» tree (main ▸ sub ▸ specialty) and «النتائج» cards; a card or a pin opens «ملف المنشأة» (no contact field ever)
 *   · filters: الحي، الشارع، «جملة فقط» (manual only — «جملة» in the request ranks, it never narrows), الدور، التخصص
 *   · trade clusters with market names, the project site with a delivery radius
 *   · the campaign tray appears under the map once a recipient is chosen; sending is unchanged, scheduling is new
 */

const HAS_MAPBOX = Boolean(import.meta.env.VITE_MAPBOX_TOKEN)
const LayerMapbox = lazy(() => import('./map/LayerMapbox'))
function MapLoadingState() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--map-land)]">
      <span role="status" className="rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-4 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] shadow-[var(--farq-soft-shadow)] backdrop-blur-md">
        نجهّز الخريطة…
      </span>
    </div>
  )
}
function LayerMap(props: LayerMapProps) {
  const mapStartedAt = useRef<number | null>(null)
  if (mapStartedAt.current === null) mapStartedAt.current = performance.now()
  if (!HAS_MAPBOX) return <DrawnLayerMap {...props} />
  return <Suspense fallback={<MapLoadingState />}><LayerMapbox {...props} mapStartedAt={mapStartedAt.current} /></Suspense>
}

const PAGE = 150
const FETCH = 200   // rows per server page (the API maximum); «حمّل أكثر» appends the next page
const RADII = [5, 10, 25, 50, 100] as const
const normalizeActivityText = (value: string) => value.normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').toLocaleLowerCase('ar')

export const channelOf = (r: TargetRow): Channel => (waNumber(r) ? 'WhatsAppSource' : r.email ? 'Email' : 'Unreachable')
function recordSearchContactAvailability(rows: readonly Pick<TargetRow, 'phone' | 'email'>[]) {
  if (!rows.length) return
  const withContact = rows.filter((row) => Boolean(row.phone?.trim() || row.email?.trim())).length
  const event = mapSearchContactAvailabilityEvent(rows.length, withContact)
  if (event) recordMapInteraction(event)
}
const n = (v: number) => formatNumber(v)
const sourceCountOf = (r: TargetRow) => {
  const count = r.source_count ?? r.sources?.length ?? null
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null
}
/** With no fit filter, prioritize AI-likely places; an explicit fit filter selects WhatsApp rows in that visible group. */
const pickForFit = (rows: TargetRow[], fitFilter: PinFit | 'all') => {
  const prioritizeLikely = fitFilter === 'all' && rows.some((r) => r.ai)
  return new Set(rows.filter((r) => waNumber(r) && (!prioritizeLikely || r.ai === 'L')).map((r) => r.poi_key))
}
const cityLabel = (value: string | null, cities: City[]) => {
  const key = value?.trim().toLocaleLowerCase('en-US')
  if (!key) return null
  return cities.find((city) => city.en.trim().toLocaleLowerCase('en-US') === key)?.ar || value
}
const placeOf = (r: TargetRow, cities: City[]) => [safeLocationName(r.street_ar), safeLocationName(r.district_ar) || safeLocationName(r.district_en), safeLocationName(r.region_ar) || cityLabel(r.city_en, cities)].filter(Boolean).join(' · ')
const pathOf = (r: TargetRow) => {
  const m = mainIdOf(r), s = subAr(subIdOf(r))
  if (s) return `${mainAr(m)} ▸ ${s}`
  if (m !== 'unc') return mainAr(m)
  return r.category_ar ? `نشاط الدليل · ${r.category_ar}` : ''
}
const FIT = { L: { tone: 'Success', label: 'مناسب', icon: SuccessIcon }, M: { tone: 'Warning', label: 'محتمل', icon: WarningIcon }, N: { tone: 'Neutral', label: 'غير مناسب', icon: ErrorIcon } } as const
const fitBadge = (r: TargetRow) => (r.ai ? <Badge tone={FIT[r.ai].tone} icon={FIT[r.ai].icon} label={FIT[r.ai].label} className="text-[12px] leading-[18px]" /> : null)
const statusBadge = (r: TargetRow) => { const l = statusLabel(r); return l ? <Badge tone="Warning" icon={WarningIcon} label={l} className="text-[12px] leading-[18px]" /> : null }
const arabic = (s: string) => /[؀-ۿ]/.test(s)
/** Prefer the explicit place flag; only fall back to the role badge when the flag is absent. */
const isTaggedWholesaleRow = (row: TargetRow) => row.is_wholesale === true || (row.is_wholesale == null && row.role_badges?.includes('جملة') === true)
/** The narrowing filters under the search bar: district, street, wholesale (manual only), role and specialty. */
type AreaFilters = Pick<SearchFilters, 'district' | 'street' | 'wholesale' | 'role' | 'specialty' | 'contact'>
type MapScope = 'city' | 'district' | 'street'
const clusterName = (c: TradeCluster) => [c.level === 'street' ? safeLocationName(c.street_ar) : null, safeLocationName(c.district_ar)].filter(Boolean).join('، ') || c.label_ar
/** «سوق الزل للأقمشة — الديرة · 230 منشأة» when a curated popular name fits; otherwise «الشارع، الحي — 37 منشأة». */
const clusterText = (c: TradeCluster) => (c.popular_ar ? `${c.popular_ar} — ${clusterName(c)} · ${n(c.n)} منشأة` : `${clusterName(c)} — ${n(c.n)} منشأة`)

function defaultMessage(cat: string | null, area: string | null) {
  return `معك أحمد من فرق. يوصلنا طلبات تسعير${cat ? ` ${cat}` : ''} من منشآت وشركات${area ? ` في ${area}` : ''} — تبي توصلك على واتساب؟\nللإيقاف أرسل: إيقاف`
}
const boxAround = (lat: number, lon: number, d = 0.012): [number, number, number, number] => [lon - d, lat - d, lon + d, lat + d]

export default function TargetingPage({ onTemplates, onLeads, onMapFocusChange, startNew = false, onStartClosed, onRfq }: {
  onTemplates: () => void
  onLeads?: () => void
  onMapFocusChange?: (focused: boolean) => void
  /** «طلب جديد» (sidebar / tab bar): open the start sheet */
  startNew?: boolean
  onStartClosed?: () => void
  /** the buyer price-request wizard (/new), linked from the start sheet */
  onRfq?: () => void
}) {
  const mobile = useIsMapCompact()
  const [focusMode, setFocusMode] = useState(false)
  const [focusPanelOpen, setFocusPanelOpen] = useState(false)
  const [focusPanelSnap, setFocusPanelSnap] = useState<'peek' | 'half' | 'full'>('peek')
  const [resultsPanelOpen, setResultsPanelOpen] = useState(true)
  const [resultsPanelWidth, setResultsPanelWidth] = useState(400)
  const panelResizeStart = useRef<{ x: number; width: number } | null>(null)
  const panelDragStart = useRef<number | null>(null)
  const panelDidDrag = useRef(false)
  const setSheetSnap = (snap: 'peek' | 'half' | 'full') => {
    setFocusPanelSnap(snap)
    if (mobile) recordMapInteraction(`map_sheet_${snap}`)
  }
  const changeFocusMode = (focused: boolean) => {
    recordMapInteraction(focused ? 'map_focus_open' : 'map_focus_close')
    setFocusMode(focused)
    onMapFocusChange?.(focused)
    if (focused) setFocusPanelOpen(false)
  }
  // hand-offs from «هدف جديد» pages (memory only); the default is «بائعون»
  const [objective, setObjective] = useState<'purchase' | 'marketing'>(() => (handoff.take(HANDOFF.targetDirection) === 'marketing' ? 'marketing' : 'purchase'))
  const [lens, setLens] = useState<'market' | 'sellers' | 'buyers'>(() => (objective === 'marketing' ? 'buyers' : 'market'))
  const lensTabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [q, setQ] = useState(() => handoff.take(HANDOFF.targetQuery) || '')
  const generation = useRef(0)
  const [query, setQuery] = useState('')
  const hasTargetQuery = Boolean(query.trim())
  const lastSuccessfulQueryObjective = useRef(objective)
  const [res, setRes] = useState<TargetSearch | null>(null)
  const [buyerProductGroups, setBuyerProductGroups] = useState<{ name: string; rows: TargetRow[]; total: number; nextOffset: number | null; filters: AreaFilters }[]>([])
  const [buyerProductProgress, setBuyerProductProgress] = useState<{ completed: number; total: number } | null>(null)
  const buyerProductMode = lens === 'buyers' && buyerProductGroups.length > 0
  const hasAudienceBrowse = lens === 'buyers' && !hasTargetQuery && Boolean(res) && !buyerProductMode
  const showTargetResults = hasTargetQuery || hasAudienceBrowse || buyerProductMode
  const [focusedTile, setFocusedTile] = useState<{ key: string; query: string } | null>(null)
  const [focusedTileError, setFocusedTileError] = useState(false)
  const [specialtyFocusResolving, setSpecialtyFocusResolving] = useState(false)
  const [specialtyFocusResolveError, setSpecialtyFocusResolveError] = useState(false)
  const specialtyFocusResolution = useRef(0)
  const [busyKind, setBusyKind] = useState<'search' | 'browse' | 'more' | null>(null)
  const busy = busyKind !== null
  const [error, setError] = useState<string | null>(null)
  const [failedResultRefresh, setFailedResultRefresh] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedRows, setSelectedRows] = useState<Map<string, TargetRow>>(new Map())
  const [multiIntents, setMultiIntents] = useState<{ intent: MapIntent; rows: TargetRow[]; total: number; nextOffset: number | null; excludedCount: number }[]>([])
  const [multiPending, setMultiPending] = useState<Map<string, TargetRow>>(new Map())
  const [highlightedPinKey, setHighlightedPinKey] = useState<string | null>(null)
  const [showMapPins, setShowMapPins] = useState(false)
  const [mapScope, setMapScope] = useState<MapScope>('city')
  const [districtPickerOpenRequest, setDistrictPickerOpenRequest] = useState(0)
  const [showMarketClusters, setShowMarketClusters] = useState(false)
  const [showDensity, setShowDensity] = useState(true)
  const [showDistricts, setShowDistricts] = useState(true)
  const [showStreets, setShowStreets] = useState(true)
  const [layersOpen, setLayersOpen] = useState(false)
  const layerControlRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(PAGE)
  const [fitFilter, setFitFilter] = useState<PinFit | 'all'>('all')
  const [message, setMessage] = useState(defaultMessage(null, null))
  const [tpl, setTpl] = useState<TemplateStatus | null>(null)
  const [tplError, setTplError] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [preparingMarketing, setPreparingMarketing] = useState(false)
  const [preparedCampaignId, setPreparedCampaignId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!layersOpen) return
    const closeOnOutside = (event: PointerEvent) => { if (event.target instanceof Node && !layerControlRef.current?.contains(event.target)) setLayersOpen(false) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setLayersOpen(false) }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [layersOpen])
  const [filters, setFilters] = useState<AreaFilters>({})
  const areaFiltersRef = useRef<AreaFilters>({})
  const setAreaFilters = (next: AreaFilters) => { areaFiltersRef.current = next; setFilters(next) }
  const [clusters, setClusters] = useState<{ list: TradeCluster[]; basis?: string } | null>(null)
  // the densest streets of this request, drawn along the street (POST /street-density); the one picked
  const [dense, setDense] = useState<{ list: Street[]; basis?: string; specialty_available?: boolean } | null>(null)
  const [denseLoadError, setDenseLoadError] = useState(false)
  const [denseRetry, setDenseRetry] = useState(0)
  const [activeStreet, setActiveStreet] = useState<string | null>(null)
  // which streets: all activities (on open), one main, some subs, or the typed request; districts narrow them
  type StreetPick = { kind: 'all' } | { kind: 'main'; id: string } | { kind: 'sub'; ids: (string | number)[]; main: string } | { kind: 'spec'; id: string; specialtyId: string; name: string; subId: string; mainAr: string } | { kind: 'q'; q: string; objective: string }
  const [streetPick, setStreetPick] = useState<StreetPick>({ kind: 'all' })
  const [filterSpecialtyScope, setFilterSpecialtyScope] = useState<{ name: string; ids: string[] } | null>(null)
  const [filterSpecialtyResolving, setFilterSpecialtyResolving] = useState(false)
  const [filterSpecialtyResolveError, setFilterSpecialtyResolveError] = useState(false)
  const selectedSpecialtyIds = useMemo(() => {
    const fromFilter = filters.specialty && filterSpecialtyScope?.name === normalizeActivityText(filters.specialty)
      ? filterSpecialtyScope.ids : []
    const fromStreetPick = streetPick.kind === 'spec' ? [streetPick.specialtyId] : []
    if (fromFilter.length && fromStreetPick.length) return fromFilter.filter((id) => fromStreetPick.includes(id))
    return fromFilter.length ? fromFilter : fromStreetPick
  }, [filters.specialty, filterSpecialtyScope, streetPick])
  const specialtyScopeConflict = Boolean(filters.specialty && streetPick.kind === 'spec' && filterSpecialtyScope?.name === normalizeActivityText(filters.specialty) && !selectedSpecialtyIds.length)
  const [catalog, setCatalog] = useState<StreetCatalog['mains'] | null>(null)
  const [activityMenuOpen, setActivityMenuOpen] = useState(false)
  const [activitySearch, setActivitySearch] = useState('')
  const [activitySpecialties, setActivitySpecialties] = useState<SpecialtySuggestion[]>([])
  const [activitySpecialtiesLoading, setActivitySpecialtiesLoading] = useState(false)
  const [activityMenuPosition, setActivityMenuPosition] = useState<{ top: number; right: number } | null>(null)
  const activityMenuRef = useRef<HTMLDivElement>(null)
  const activityOptionsRef = useRef<HTMLDivElement>(null)
  const activityTriggerRef = useRef<HTMLButtonElement>(null)
  const activitySearchRef = useRef<HTMLInputElement>(null)
  const streetGen = useRef(0)
  const clusterGen = useRef(0)
  // map state: districts, layer, guide pick, profile, site
  const [polys, setPolys] = useState<District[] | null>(null)
  const [chosenD, setChosenD] = useState<Set<string>>(new Set())
  const [layer, setLayer] = useState<Layer>('main')
  const [focus, setFocus] = useState<Focus>(null)
  const [profile, setProfile] = useState<string | null>(null)
  const [tab, setTab] = useState<'streets' | 'results' | 'guide'>(() => (mobile ? 'streets' : 'results'))
  const resultsPanelRef = useRef<HTMLElement | null>(null)
  const searchPromptRef = useRef<HTMLElement | null>(null)
  const resultsShortcutSeen = useRef(false)
  const [analyticsConsentRevision, setAnalyticsConsentRevision] = useState(0)
  const lastVisiblePrompt = useRef<string | null>(null)
  useEffect(() => {
    const onConsentChange = () => setAnalyticsConsentRevision((revision) => revision + 1)
    window.addEventListener('farq:map-analytics-consent-changed', onConsentChange)
    return () => window.removeEventListener('farq:map-analytics-consent-changed', onConsentChange)
  }, [])
  useEffect(() => {
    if (resultsShortcutSeen.current || !mobile || focusMode || !res || mapAnalyticsConsent() !== 'accepted') return
    resultsShortcutSeen.current = true
    recordMapInteraction('map_results_shortcut_seen')
  }, [mobile, focusMode, res, analyticsConsentRevision])
  useEffect(() => {
    // Require at least half of the blank prompt to enter the viewport; its mere
    // presence below the map is not an impression. Never record query data.
    const promptRendered = lens !== 'market'
      && !hasTargetQuery
      && tab !== 'guide'
      && (!mobile || tab === 'results')
      && (!focusMode || (focusPanelOpen && (!mobile || focusPanelSnap !== 'peek')))
    const prompt = searchPromptRef.current
    if (!promptRendered || !prompt) {
      lastVisiblePrompt.current = null
      return
    }
    if (mapAnalyticsConsent() !== 'accepted') {
      lastVisiblePrompt.current = null
      return
    }
    if (typeof IntersectionObserver === 'undefined') return
    const event = lens === 'sellers' ? 'map_supplier_prompt_seen' : 'map_buyer_prompt_seen'
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.target === prompt && entry.isIntersecting && entry.intersectionRatio >= 0.5)
      if (!visible) {
        lastVisiblePrompt.current = null
        return
      }
      if (lastVisiblePrompt.current === event) return
      lastVisiblePrompt.current = event
      recordMapInteraction(event)
    }, { threshold: 0.5 })
    observer.observe(prompt)
    return () => observer.disconnect()
  }, [lens, hasTargetQuery, tab, mobile, focusMode, focusPanelOpen, focusPanelSnap, analyticsConsentRevision])
  const [site, setSite] = useState<Site | null>(null)
  const [placingSite, setPlacingSite] = useState(false)
  const [showUnlocated, setShowUnlocated] = useState(false)
  const [fit, setFit] = useState<LayerMapProps['fit']>(null)
  const fitTo = (bounds: [number, number, number, number]) => setFit((f) => ({ bounds, at: (f?.at || 0) + 1 }))
  const clearAreas = () => { clusterGen.current++; setAreaFilters({}); setClusters(null); setStreetPick({ kind: 'all' }); setActiveStreet(null); setFocus(null) }
  // a booklet turned into lines: tap a line to search for it in the chosen city
  const fileInput = useRef<HTMLInputElement>(null)
  const [lines, setLines] = useState<(BookletLine & { found?: number })[]>([])
  const [booklet, setBooklet] = useState<string | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [readErr, setReadErr] = useState<string | null>(null)
  const [activeLine, setActiveLine] = useState<number | null>(null)
  // the city: Riyadh by default (nothing is remembered on the device)
  const [cities, setCities] = useState<City[]>([])
  const [city, setCity] = useState('Riyadh')
  const [draftOpenRequest, setDraftOpenRequest] = useState(0)
  const lastSearchRows = useRef<TargetRow[]>([])
  const [marketStats, setMarketStats] = useState<MarketSummary['summary'] | null>(null)
  const [cityOverviewStats, setCityOverviewStats] = useState<MarketSummary['summary'] | null>(null)
  const [cityOverviewLoading, setCityOverviewLoading] = useState(true)
  const [cityOverviewError, setCityOverviewError] = useState(false)
  const [cityOverviewRetry, setCityOverviewRetry] = useState(0)
  const [marketDistrictCounts, setMarketDistrictCounts] = useState<DistrictCount[]>([])
  const [marketSpecialtyAvailable, setMarketSpecialtyAvailable] = useState<boolean | null>(null)
  const [marketLoading, setMarketLoading] = useState(true)
  const [marketError, setMarketError] = useState(false)
  const [marketRetry, setMarketRetry] = useState(0)
  const [districtInsightRows, setDistrictInsightRows] = useState<DistrictInsight[]>([])
  const [expandedDistrictActivities, setExpandedDistrictActivities] = useState<Set<string>>(new Set())
  const [districtInsightLoading, setDistrictInsightLoading] = useState(false)
  const [districtInsightError, setDistrictInsightError] = useState(false)
  const [districtInsightRetry, setDistrictInsightRetry] = useState(0)
  const districtInsightRef = useRef<HTMLElement | null>(null)
  const districtInsightSeenKeys = useRef(new Set<string>())
  const [buyerData, setBuyerData] = useState<{ key: string; data: WhoBuys } | null>(null)
  const [includeCommonBuyers, setIncludeCommonBuyers] = useState(false)
  const resetAll = () => { generation.current++; setRes(null); setBuyerProductGroups([]); setBuyerProductProgress(null); clearAreas(); setSelected(new Set()); setSelectedRows(new Map()); setMultiIntents([]); setMultiPending(new Map()); setActiveLine(null); setLines((ls) => ls.map(({ found: _found, ...line }) => line)); setError(null); setFailedResultRefresh(false); setConfirming(false); setProfile(null); setShowUnlocated(false) }
  const pickCity = (v: string) => { resetAll(); setMarketLoading(true); setCity(v); setMapScope('city'); setChosenD(new Set()); setExpandedDistrictActivities(new Set()); setSite(null); setFit(null) }

  useEffect(() => {
    const name = filters.specialty?.trim()
    if (!name) {
      setFilterSpecialtyScope(null)
      setFilterSpecialtyResolving(false)
      setFilterSpecialtyResolveError(false)
      return
    }
    let active = true
    const normalized = normalizeActivityText(name)
    setFilterSpecialtyScope(null)
    setFilterSpecialtyResolving(true)
    setFilterSpecialtyResolveError(false)
    suggestSpecialties(name).then((result) => {
      if (!active) return
      const ids = [...new Set((result?.suggestions || [])
        .filter((item) => normalizeActivityText(item.specialty_ar) === normalized)
        .map((item) => String(item.specialty_id || ''))
        .filter(Boolean))]
      if (!ids.length || ids.length > 20) { setFilterSpecialtyResolveError(true); return }
      setFilterSpecialtyScope({ name: normalized, ids })
    }, () => { if (active) setFilterSpecialtyResolveError(true) }).finally(() => {
      if (active) setFilterSpecialtyResolving(false)
    })
    return () => { active = false }
  }, [filters.specialty])

  useEffect(() => { templateStatus().then(setTpl, () => setTplError(true)) }, [])
  const [template, setTemplate] = useState(OUTREACH_TEMPLATE)
  const [templates, setTemplates] = useState<MetaTemplate[]>([])
  useEffect(() => { listTemplates().then((r) => setTemplates(r?.ok ? (r.data || []).filter((t) => t.status === 'APPROVED') : []), () => setTemplates([])) }, [])
  const [startOpen, setStartOpen] = useState(startNew)
  const [startSeen, setStartSeen] = useState(startNew)
  if (startNew !== startSeen) { setStartSeen(startNew); if (startNew) setStartOpen(true) }
  const closeStart = () => { setStartOpen(false); if (startNew) onStartClosed?.() }
  const [price, setPrice] = useState<number | null>(null)
  useEffect(() => { void fetchConstructionWhatsAppPricing().then((p) => setPrice(p.enabled && p.price_sar ? Number(p.price_sar) : null)) }, [])
  useEffect(() => {
    let active = true
    listCities().then((values) => {
      if (!active) return
      setCities(values)
      setCity((c) => (values.some((v) => v.en === c) ? c : values.some((v) => v.en === 'Riyadh') ? 'Riyadh' : ''))
    }, () => { if (active) setCities([]) })
    return () => { active = false }
  }, [])
  // district polygons of the city (GET /districts); 404 or none → the search answer's district names
  useEffect(() => {
    if (!city) { setPolys(null); return }
    let on = true
    setPolys(null)
    listDistricts(city).then((fc) => { if (on) setPolys(districtsFrom(fc)) }, () => { if (on) setPolys([]) })
    return () => { on = false }
  }, [city])
  const cityName = (en: string) => cities.find((c) => c.en === en)?.ar || en
  // chosen district names narrow the dense streets and the activity catalog
  const chosenNames = useMemo(() => {
    const polygonNames = (polys && polys.length ? polys : []).filter((district) => chosenD.has(district.id)).map((district) => district.ar)
    const namedSelections = [...chosenD].filter((id) => id.startsWith('name:')).map((id) => id.slice(5))
    return [...new Set([...polygonNames, ...namedSelections])].sort()
  }, [polys, chosenD])
  const densityDistrictNames = useMemo(() => [...new Set([...chosenNames, ...(filters.district ? [filters.district] : [])])], [chosenNames, filters.district])
  const densityDistrictKey = densityDistrictNames.join('|')
  const insightDistrictNames = useMemo(() => (chosenNames.length ? chosenNames : filters.district ? [filters.district] : []).slice(0, 30), [chosenNames, filters.district])
  const insightDistrictKey = insightDistrictNames.join('|')
  const buyerSubIds = streetPick.kind === 'sub' ? streetPick.ids
    : streetPick.kind === 'spec' ? [streetPick.subId]
    : focus?.level === 'sub' ? [focus.id]
    : focus?.level === 'spec' ? (res?.rows || []).filter((row) => (row.specialties || []).includes(focus.id) && (!focus.sub_id || row.taxonomy_sub === focus.sub_id)).map((row) => row.taxonomy_sub).filter((id): id is string => Boolean(id))
    : streetPick.kind === 'main' ? (catalog?.find((m) => m.main_id === streetPick.id)?.subs || []).map((s) => s.sub_id)
    : (res?.understood?.sub_ids || [])
  const buyerQueryKey = lens === 'buyers' && buyerSubIds.length && buyerSubIds.length <= 50 ? `${city}|${buyerSubIds.join('|')}` : ''
  useEffect(() => {
    if (!city) return
    const filterSpecialtyReady = !filters.specialty || filterSpecialtyScope?.name === normalizeActivityText(filters.specialty)
    if (!filterSpecialtyReady || filters.specialty && (filterSpecialtyResolveError || !selectedSpecialtyIds.length)) {
      setMarketStats(null)
      setMarketDistrictCounts([])
      setMarketSpecialtyAvailable(false)
      if (lens === 'market') { setMarketLoading(false); setMarketError(Boolean(filters.specialty && (filterSpecialtyResolveError || specialtyScopeConflict))) }
      return
    }
    let active = true
    const exactSpecialtyRequested = selectedSpecialtyIds.length > 0
    const filter = streetPick.kind === 'main' ? { main_id: streetPick.id }
      : streetPick.kind === 'sub' ? { sub_ids: streetPick.ids }
      : streetPick.kind === 'spec' ? { sub_ids: [streetPick.subId] } : {}
    const analyticsQuery = { city, ...(hasTargetQuery ? { q: query } : {}), ...filter, ...(exactSpecialtyRequested ? { specialty_ids: selectedSpecialtyIds } : {}), ...(densityDistrictNames.length ? { districts: densityDistrictNames } : {}) }
    if (lens === 'market') {
      setMarketLoading(true)
      setMarketError(false)
      setMarketStats(null)
    }
    setMarketDistrictCounts([])
    if (exactSpecialtyRequested) setMarketSpecialtyAvailable(null)
    // These are independent map panels. Retry each failed read once after a short
    // pause so a transient network error does not require the user to retry manually.
    const withOneRetry = async <T,>(load: () => Promise<T>): Promise<T> => {
      try { return await load() } catch (error) {
        const transient = error instanceof TypeError || error instanceof TargetingError && [502, 503, 504].includes(error.status)
        if (!active || !transient) throw error
        await new Promise<void>((resolve) => window.setTimeout(resolve, 350))
        if (!active) throw error
        return load()
      }
    }
    const loadSummary = async () => {
      const value = await marketSummary(analyticsQuery)
      if (!value?.summary) throw new Error('Market summary unavailable')
      return value
    }
    const loadCounts = async () => {
      const value = await districtCounts(analyticsQuery)
      if (!value?.ok) throw new Error('District counts unavailable')
      return value
    }
    const summaryRequest = lens === 'market' ? withOneRetry(loadSummary) : Promise.resolve(null)
    Promise.allSettled([summaryRequest, withOneRetry(loadCounts)]).then(([summary, counts]) => {
      if (!active) return
      const summaryCandidate = summary.status === 'fulfilled' ? summary.value?.summary || null : null
      const summaryValue = exactSpecialtyRequested && summaryCandidate?.specialty_available !== true ? null : summaryCandidate
      const countsAvailable = counts.status === 'fulfilled' && counts.value?.ok
      const specialtyAvailability = !exactSpecialtyRequested ? true : countsAvailable && counts.value?.specialty_available === true
      const districtValues = countsAvailable && (!exactSpecialtyRequested || specialtyAvailability) ? counts.value?.districts || [] : null
      if (lens === 'market') setMarketStats(summaryValue)
      setMarketDistrictCounts(districtValues || [])
      setMarketSpecialtyAvailable(specialtyAvailability)
      if (lens === 'market') setMarketError(!summaryValue || districtValues == null)
    }).finally(() => { if (active && lens === 'market') setMarketLoading(false) })
    return () => { active = false }
  }, [city, lens, streetPick, densityDistrictNames, selectedSpecialtyIds, filters.specialty, filterSpecialtyScope, filterSpecialtyResolveError, specialtyScopeConflict, query, hasTargetQuery, marketRetry])
  // Keep citywide totals separate from query- or district-scoped summaries so
  // the city view never presents a filtered count as the whole market.
  useEffect(() => {
    if (!city) {
      setCityOverviewStats(null)
      setCityOverviewLoading(false)
      setCityOverviewError(false)
      return
    }
    let active = true
    setCityOverviewLoading(true)
    setCityOverviewError(false)
    marketSummary({ city }).then((result) => {
      if (!active) return
      const summary = result?.ok ? result.summary : null
      setCityOverviewStats(summary || null)
      setCityOverviewError(!summary)
    }, () => {
      if (!active) return
      setCityOverviewStats(null)
      setCityOverviewError(true)
    }).finally(() => { if (active) setCityOverviewLoading(false) })
    return () => { active = false }
  }, [city, cityOverviewRetry])
  useEffect(() => {
    if (!city || !insightDistrictNames.length) {
      setDistrictInsightRows([])
      setDistrictInsightError(false)
      setDistrictInsightLoading(false)
      return
    }
    let active = true
    setDistrictInsightRows([])
    setDistrictInsightLoading(true)
    setDistrictInsightError(false)
    districtInsights({ city, districts: insightDistrictNames }).then((result) => {
      if (!active) return
      setDistrictInsightRows(result?.ok ? result.districts || [] : [])
      setDistrictInsightError(!result?.ok)
    }, () => { if (active) setDistrictInsightError(true) }).finally(() => { if (active) setDistrictInsightLoading(false) })
    return () => { active = false }
  }, [city, insightDistrictKey, districtInsightRetry])
  useEffect(() => {
    if (!districtInsightRows.length || districtInsightLoading || mapAnalyticsConsent() !== 'accepted') return
    const section = districtInsightRef.current
    const seenKey = `${city}:${insightDistrictKey}`
    if (!section || districtInsightSeenKeys.current.has(seenKey) || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || mapAnalyticsConsent() !== 'accepted') return
      districtInsightSeenKeys.current.add(seenKey)
      recordMapInteraction('map_district_insight_seen')
      observer.disconnect()
    }, { threshold: 0 })
    observer.observe(section)
    return () => observer.disconnect()
  }, [city, insightDistrictKey, districtInsightRows.length, districtInsightLoading, analyticsConsentRevision])
  const retryMarketStats = () => {
    recordMapInteraction('market_summary_retry')
    setMarketRetry((retry) => retry + 1)
  }
  useEffect(() => {
    if (!buyerQueryKey) return
    let active = true
    whoBuys({ city, sub_ids: buyerSubIds }).then((r) => { if (active) setBuyerData({ key: buyerQueryKey, data: r }) }, () => { if (active) setBuyerData(null) })
    return () => { active = false }
  }, [buyerQueryKey])
  const currentBuyerData = buyerData?.key === buyerQueryKey ? buyerData.data : null
  const pickKey = JSON.stringify(streetPick)
  const framedPick = useRef('')
  useEffect(() => {
    if (!city) { setDense(null); setDenseLoadError(false); return }
    const filterSpecialtyReady = !filters.specialty || filterSpecialtyScope?.name === normalizeActivityText(filters.specialty)
    if (!filterSpecialtyReady) { streetGen.current++; setDense(null); setDenseLoadError(false); return }
    if (filters.specialty && (filterSpecialtyResolveError || !selectedSpecialtyIds.length || specialtyScopeConflict)) {
      streetGen.current++
      setDense({ list: [], specialty_available: false, basis: 'تعذر مطابقة التخصص المختار مع تصنيف الشوارع بدقة.' })
      setDenseLoadError(false)
      return
    }
    if (filters.role) {
      streetGen.current++
      setDense({ list: [], basis: 'مصدر كثافة الشوارع لا يفصل البيانات حسب دور المنشأة؛ أخفينا الخطوط العامة حتى لا تبدو مطابقة.' })
      setDenseLoadError(false)
      return
    }
    const v = ++streetGen.current
    const body: StreetDensityQuery = { city, ...(streetPick.kind === 'main' ? { main_id: streetPick.id } : streetPick.kind === 'sub' ? { sub_ids: streetPick.ids } : streetPick.kind === 'spec' ? { sub_ids: [streetPick.subId] } : streetPick.kind === 'q' ? { q: streetPick.q, objective: streetPick.objective } : {}), ...(selectedSpecialtyIds.length ? { specialty_ids: selectedSpecialtyIds } : {}), ...(densityDistrictNames.length ? { districts: densityDistrictNames } : {}) }
    setDense(null)
    setDenseLoadError(false)
    recordMapInteraction('map_street_density_started')
    streetDensity(body).then((d) => {
      if (v !== streetGen.current) return
      const list = streetsFrom(d)
      setDense({ list, basis: d?.basis, specialty_available: d?.specialty_available })
      setDenseLoadError(false)
      recordMapInteraction('map_street_density_succeeded')
      // a new activity (or request): frame its densest streets so the map shows WHERE at once
      const top = topStreets(list)
      if (top.length && framedPick.current !== `${city}|${pickKey}` && !chosenNames.length) {
        framedPick.current = `${city}|${pickKey}`
        fitTo([Math.min(...top.map((x) => x.bbox[0])), Math.min(...top.map((x) => x.bbox[1])), Math.max(...top.map((x) => x.bbox[2])), Math.max(...top.map((x) => x.bbox[3]))])
      }
    }, () => {
      if (v !== streetGen.current) return
      setDense({ list: [] })
      setDenseLoadError(true)
      recordMapInteraction('map_street_density_failed')
    })
  }, [city, pickKey, densityDistrictNames, selectedSpecialtyIds, filters.specialty, filters.role, filterSpecialtyScope, filterSpecialtyResolveError, specialtyScopeConflict, denseRetry]) // eslint-disable-line react-hooks/exhaustive-deps
  const retryStreetDensity = () => {
    recordMapInteraction('map_street_density_retry')
    setDenseRetry((retry) => retry + 1)
  }
  useEffect(() => {
    if (!city) return
    let on = true
    streetCatalog({ city, ...(densityDistrictNames.length ? { districts: densityDistrictNames } : {}) }).then((c) => { if (on) setCatalog(c?.mains || []) }, () => { if (on) setCatalog(null) })
    return () => { on = false }
  }, [city, densityDistrictKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => res?.rows || [], [res])
  const byKey = useMemo(() => new Map(rows.map((r) => [r.poi_key, r])), [rows])
  const hasPolys = Boolean(polys && polys.length)
  const districts = useMemo<District[]>(() => (hasPolys ? polys! : districtsFromNames(res?.areas?.districts || [])), [hasPolys, polys, res])
  // A neighbourhood may be represented by several map polygons. Keep all of them when
  // selected, while presenting one clear option to the user.
  const districtScopeGroups = useMemo(() => {
    const groups = new Map<string, District[]>()
    for (const district of districts) {
      const key = normalizeActivityText(district.ar)
      groups.set(key, [...(groups.get(key) || []), district])
    }
    return groups
  }, [districts])
  const districtScopeOptions = useMemo(() => [...districtScopeGroups.entries()]
    .map(([key, group]) => ({ value: `scope:${key}`, text: group[0].ar }))
    .sort((a, b) => a.text.localeCompare(b.text, 'ar')), [districtScopeGroups])
  // The map selector is the source of truth for this UI count. A named
  // neighbourhood can span several polygons, so source summaries may count those
  // fragments instead of the distinct choices a person can make on the map.
  const displayedDistrictCount = (summary: MarketSummary['summary'] | null) =>
    districtScopeOptions.length || summary?.districts_count || null
  const chosenList = useMemo(() => districts.filter((d) => chosenD.has(d.id)), [districts, chosenD])
  const fitCity = () => {
    const bounds = districts.map((d) => d.bbox).filter(Boolean) as [number, number, number, number][]
    if (bounds.length) {
      fitTo([Math.min(...bounds.map((b) => b[0])), Math.min(...bounds.map((b) => b[1])), Math.max(...bounds.map((b) => b[2])), Math.max(...bounds.map((b) => b[3]))])
      return
    }
    const center = cityCoords(city)
    if (center) fitTo([center.lon - 0.15, center.lat - 0.12, center.lon + 0.15, center.lat + 0.12])
  }
  // Scope the district first. A delivery radius only applies to precise points; keep rows
  // without coordinates in a separate review list instead of silently dropping them.
  const districtRows = useMemo(() => chosenList.length ? rows.filter((r) => inDistricts(r, chosenList)) : rows, [rows, chosenList])
  const unlocatedRows = useMemo(() => districtRows.filter((r) => !hasPoint(r) && matchesFocus(r, focus)), [districtRows, focus])
  const areaRows = useMemo(() => site
    ? districtRows.filter((r) => hasPoint(r) && km(site, { lat: r.latitude!, lon: r.longitude! }) <= site.km)
    : districtRows, [districtRows, site])
  const cohort = useMemo(() => areaRows.filter((r) => matchesFocus(r, focus)), [areaRows, focus])
  const fitCounts = useMemo(() => {
    const counts: Record<PinFit | 'all', number> = { all: cohort.length, likely: 0, maybe: 0, low: 0, unknown: 0 }
    for (const row of cohort) counts[fitOf(row)] += 1
    return counts
  }, [cohort])
  const visibleCohort = useMemo(() => fitFilter === 'all' ? cohort : cohort.filter((r) => fitOf(r) === fitFilter), [cohort, fitFilter])
  const visibleListCohort = useMemo(() => {
    if (!showUnlocated) return visibleCohort
    // Move every row without a precise point out of the main list while its
    // dedicated section is open. Source records can have different poi_keys
    // for the same displayed business, so key-only filtering can leave a copy.
    return visibleCohort.filter(hasPoint)
  }, [showUnlocated, visibleCohort])
  const resultCountSummary = res
    ? buyerProductMode
      ? `${n(visibleCohort.length)} ضمن المنشآت المحمّلة`
      : `${n(visibleCohort.length)} ضمن الدفعة · ${n(res.total)} إجمالاً`
    : n(visibleCohort.length)
  const unconfirmedStatusCount = useMemo(() => visibleCohort.filter(hasUnconfirmedStatus).length, [visibleCohort])
  const showUnconfirmedStatusNotice = Boolean(hasTargetQuery && res && unconfirmedStatusCount > 0)
  const statusNoticeKey = res ? `${res.map_query || ''}|${res.total}|${res.rows[0]?.poi_key || ''}|${unconfirmedStatusCount}` : ''
  const lastStatusNoticeKey = useRef('')
  useEffect(() => {
    if (!showUnconfirmedStatusNotice || !statusNoticeKey) { lastStatusNoticeKey.current = ''; return }
    if (statusNoticeKey === lastStatusNoticeKey.current) return
    lastStatusNoticeKey.current = statusNoticeKey
    recordMapInteraction('map_results_status_notice')
  }, [showUnconfirmedStatusNotice, statusNoticeKey])
  const qualityNoticeSeen = useRef(false)
  useEffect(() => {
    if (qualityNoticeSeen.current || mapAnalyticsConsent() !== 'accepted' || !showUnconfirmedStatusNotice) return
    qualityNoticeSeen.current = true
    recordMapInteraction('map_data_quality_notice_seen')
  }, [analyticsConsentRevision, showUnconfirmedStatusNotice])
  const counters = useMemo(() => countersOf(visibleCohort, chosenNames.length), [visibleCohort, chosenNames])
  const displayCounters = useMemo<CounterItem[]>(() => {
    const shownRows = res?.rows || []
    const globalLocationCount = typeof res?.located_total === 'number' && Number.isFinite(res.located_total)
      ? res.located_total : null
    const hasGlobalLocationCount = globalLocationCount != null
    const precise = buyerProductMode ? shownRows.filter(hasPoint).length : globalLocationCount ?? shownRows.filter(hasPoint).length
    const locationLabel = hasGlobalLocationCount ? 'لها موقع إجمالاً' : 'لها موقع · محمّلة'
    const whatsapp = shownRows.filter((row) => Boolean(waNumber(row))).length
    // Search responses describe all matching districts. Once the user narrows to a
    // district, keep this indicator scoped to the visible result set.
    const areas = filters.district ? 1 : chosenNames.length || res?.areas?.districts.length || 0
    if (lens === 'market') {
      // A previous analytics request can settle during a new selection. Until
      // the new summary exists (or reports an error), keep counters in the
      // pending state rather than presenting a dash as if data were missing.
      const marketCountersLoading = marketLoading || !marketStats
      const scopeLabel = densityDistrictNames.length === 1
        ? `منشآت حي ${densityDistrictNames[0]}`
        : densityDistrictNames.length > 1 ? 'منشآت الأحياء المحددة' : 'منشآت مرصودة'
      const activities = marketStats?.main_activities || []
      const filteredScopeTotal = filters.contact === 'whatsapp'
        ? marketStats?.n_whatsapp ?? null
        : filters.wholesale
          ? marketStats?.n_wholesale ?? null
          : marketStats?.total ?? null
      return [
        { key: 'market-size', label: scopeLabel, value: filteredScopeTotal, lead: true, loading: marketCountersLoading },
        ...(densityDistrictNames.length ? [] : [{ key: 'market-districts', label: 'أحياء مغطاة', value: displayedDistrictCount(marketStats), loading: marketCountersLoading }]),
        { key: 'market-whatsapp', label: 'إشارة واتساب برقم صالح', value: marketStats?.n_whatsapp ?? null, loading: marketCountersLoading },
        { key: 'market-wholesale', label: 'منشآت موسومة جملة', value: marketStats?.n_wholesale ?? null, loading: marketCountersLoading },
        ...activities.map((activity) => ({ key: `market-main-${activity.main_id}`, label: activity.main_ar, value: activity.n, loading: marketCountersLoading })),
      ]
    }
    if ((query || buyerProductMode) && res) return buyerProductMode ? [
      { key: 'buyer-matches', label: 'جهات مرشحة · محمّلة', value: shownRows.length, lead: true },
      { key: 'buyer-whatsapp', label: 'أرقام جوال · محمّلة', value: whatsapp },
      { key: 'buyer-located', label: 'لها موقع · محمّلة', value: precise },
      { key: 'buyer-activities', label: 'منتجات مطابقة', value: buyerProductGroups.length },
    ] : lens === 'sellers' ? [
      { key: 'supplier-matches', label: 'موردون محتملون', value: Number.isFinite(res.total) ? res.total : shownRows.length, lead: true },
      { key: 'supplier-whatsapp', label: 'أرقام جوال · محمّلة', value: whatsapp },
      { key: 'supplier-located', label: locationLabel, value: precise },
      { key: 'supplier-districts', label: 'أحياء بها نتائج', value: areas },
    ] : [
      { key: 'buyer-matches', label: 'جهات قد تشتري', value: Number.isFinite(res.total) ? res.total : shownRows.length, lead: true },
      { key: 'buyer-whatsapp', label: 'أرقام جوال · محمّلة', value: whatsapp },
      { key: 'buyer-located', label: locationLabel, value: precise },
      { key: 'buyer-activities', label: 'أنشطة مشترية مرصودة', value: currentBuyerData?.buyers.length || 0 },
    ]
    // Before a specific product/activity is selected, show honest city-wide context instead of invented matches.
    return [
      { key: 'city-places', label: 'منشآت مرصودة', value: marketStats?.total ?? null, lead: true, loading: marketLoading || !marketStats },
      { key: 'city-whatsapp', label: 'إشارة واتساب برقم صالح', value: marketStats?.n_whatsapp ?? null, loading: marketLoading || !marketStats },
      { key: 'city-districts', label: 'أحياء مغطاة', value: displayedDistrictCount(marketStats), loading: marketLoading || !marketStats },
    ]
  }, [lens, marketStats, catalog, res, query, currentBuyerData, chosenD, chosenNames, filters.contact, filters.wholesale, filters.district, densityDistrictNames, districts.length, districtScopeOptions.length, marketLoading])
  const guide = useMemo(() => guideOf(areaRows), [areaRows])
  const focusedSpecialty = focus?.level === 'spec' && streetPick.kind === 'spec' && streetPick.id === focus.id && (!focus.sub_id || streetPick.subId === focus.sub_id) ? streetPick : null
  const focusedTileKey = focus && res?.map_query
    ? JSON.stringify([res.map_query, focus.level, focus.id, focus.level === 'spec' ? focus.sub_id || '' : '', focusedSpecialty?.specialtyId || ''])
    : ''
  useEffect(() => {
    if (!focus || !res?.map_query) {
      setFocusedTile(null)
      setFocusedTileError(false)
      return
    }
    if (focus.level === 'spec' && !focusedSpecialty) {
      setFocusedTile(null)
      return
    }
    let active = true
    const descriptor = {
      level: focus.level,
      id: focus.id,
      ...(focus.level === 'spec' ? { sub_id: focus.sub_id || focusedSpecialty!.subId, specialty_id: focusedSpecialty!.specialtyId } : {}),
    }
    const key = focusedTileKey
    setFocusedTile(null)
    setFocusedTileError(false)
    mapFocusQuery(res.map_query, descriptor).then((result) => {
      if (active && result?.map_query) setFocusedTile({ key, query: result.map_query })
      else if (active) setFocusedTileError(true)
    }, () => { if (active) setFocusedTileError(true) })
    return () => { active = false }
  }, [focusedTileKey, focusedSpecialty])
  const activeTileQuery = focus
    ? focusedTile?.key === focusedTileKey ? focusedTile.query : undefined
    : res?.map_query
  // Keep the city uncluttered until the user chooses an area or an activity; either choice
  // gives the map a useful, bounded cohort to pin even before they pick a district.
  const pins = useMemo(() => ((query || buyerProductMode) && (chosenList.length || focus || filters.district || filters.street || filters.role || filters.specialty || buyerProductMode) ? pinsOf(visibleCohort, layer, selected, focus) : []), [query, buyerProductMode, chosenList, visibleCohort, layer, selected, focus, filters.district, filters.street, filters.role, filters.specialty])
  const approxCount = useMemo(() => visibleCohort.filter((r) => !hasPoint(r)).length, [visibleCohort])
  const extent = useMemo<[number, number, number, number] | null>(() => {
    const pts = rows.filter(hasPoint)
    if (pts.length) return [Math.min(...pts.map((r) => r.longitude!)), Math.min(...pts.map((r) => r.latitude!)), Math.max(...pts.map((r) => r.longitude!)), Math.max(...pts.map((r) => r.latitude!))]
    const c = cityCoords(city)
    return c ? [c.lon - 0.15, c.lat - 0.12, c.lon + 0.15, c.lat + 0.12] : null
  }, [rows, city])
  const chosen = useMemo(() => [...selected].map((key) => selectedRows.get(key)).filter((row): row is TargetRow => Boolean(row)), [selected, selectedRows])
  const truncated = res ? rows.length < res.total : false
  const hasAiInVisibleCohort = visibleCohort.some((row) => Boolean(row.ai))
  const waInCohort = counters.whatsapp

  const fitDistrictSelection = (selection: District[]) => {
    const bounds = selection.map((item) => item.bbox).filter((bbox): bbox is [number, number, number, number] => Boolean(bbox))
    if (bounds.length) fitTo([Math.min(...bounds.map((bbox) => bbox[0])), Math.min(...bounds.map((bbox) => bbox[1])), Math.max(...bounds.map((bbox) => bbox[2])), Math.max(...bounds.map((bbox) => bbox[3]))])
  }
  const toggleDistrict = (id: string) => {
    const district = districts.find((item) => item.id === id)
    const grouped = district ? districtScopeGroups.get(normalizeActivityText(district.ar)) : undefined
    const selection = grouped?.length ? grouped : district ? [district] : []
    const wasChosen = selection.length > 0 && selection.every((item) => chosenD.has(item.id))
    recordMapInteraction(wasChosen ? 'map_district_clear' : 'map_district_select')
    setChosenD(wasChosen ? new Set<string>() : new Set(selection.map((item) => item.id)))
    setMapScope(wasChosen ? 'city' : 'district')
    if (!wasChosen) fitDistrictSelection(selection)
    else fitCity()
    const name = wasChosen ? undefined : district?.ar || id.replace(/^name:/, '')
    const nextFilters = { ...filters }
    delete nextFilters.district
    delete nextFilters.street
    if (name) nextFilters.district = name
    applyFilters(nextFilters)
  }
  const selectDistrictFromScope = (id: string) => {
    const grouped = id.startsWith('scope:') ? districtScopeGroups.get(id.slice('scope:'.length)) : undefined
    const selectedDistricts = grouped?.length ? grouped : districts.filter((item) => item.id === id)
    const district = selectedDistricts[0]
    const name = district?.ar || id.replace(/^name:/, '')
    recordMapInteraction('map_district_select')
    setMapScope('district')
    setChosenD(new Set(selectedDistricts.map((item) => item.id)))
    setActiveStreet(null)
    fitDistrictSelection(selectedDistricts)
    const nextFilters = { ...filters, district: name }
    delete nextFilters.street
    applyFilters(nextFilters)
  }
  const clearDistrict = () => {
    recordMapInteraction('map_district_clear')
    setChosenD(new Set())
    setMapScope('city')
    fitCity()
    const nextFilters = { ...filters }
    delete nextFilters.district
    delete nextFilters.street
    applyFilters(nextFilters)
  }
  const chooseMapScope = (next: MapScope) => {
    setMapScope(next)
  }
  const pickFocus = (f: Focus) => {
    const version = ++specialtyFocusResolution.current
    setFocus(f)
    setLayer(f?.level || 'main')
    setSpecialtyFocusResolving(false)
    setSpecialtyFocusResolveError(false)
    if (!f) {
      if (streetPick.kind === 'main' || streetPick.kind === 'sub' || streetPick.kind === 'spec') setStreetPick({ kind: 'all' })
      return
    }
    if (f.level === 'main') { setStreetPick({ kind: 'main', id: f.id }); return }
    if (f.level === 'sub') { setStreetPick({ kind: 'sub', ids: [f.id], main: f.id.split('.')[0] }); return }
    if (!f.sub_id) return
    if (streetPick.kind === 'spec' && streetPick.id === f.id && streetPick.subId === f.sub_id) return
    const findExact = (items: SpecialtySuggestion[]) => items.find((item) => item.specialty_ar === f.id && String(item.sub_id || '') === f.sub_id)
    const applyExact = (item: SpecialtySuggestion | undefined) => {
      if (version !== specialtyFocusResolution.current) return
      const specialtyId = String(item?.specialty_id || '')
      if (!item || !specialtyId) { setSpecialtyFocusResolveError(true); return }
      setStreetPick({ kind: 'spec', id: item.specialty_ar, name: item.specialty_ar, specialtyId, subId: f.sub_id!, mainAr: item.main_ar || item.sub_ar || 'نشاط فرعي' })
    }
    const cached = findExact(activitySpecialties)
    if (cached) { applyExact(cached); return }
    setSpecialtyFocusResolving(true)
    streetGen.current++
    setDense(null)
    void suggestSpecialties(f.id, f.sub_id.split('.')[0]).then((result) => applyExact(findExact(result?.suggestions || [])), () => applyExact(undefined)).finally(() => {
      if (version === specialtyFocusResolution.current) setSpecialtyFocusResolving(false)
    })
  }

  const chooseLens = (value: 'market' | 'sellers' | 'buyers') => {
    if (value === lens) return
    recordMapInteraction(`map_lens_${value}`)
    if (value === 'market') {
      const geographicFilters = { ...areaFiltersRef.current }
      const selectedStreet = activeStreet
      resetAll(); setAreaFilters(geographicFilters); setActiveStreet(selectedStreet); setQuery(''); setQ(''); setLens('market'); setTab('guide')
      void loadBrowse(city, geographicFilters)
      return
    }
    const nextObjective = value === 'buyers' ? 'marketing' : 'purchase'
    setObjective(nextObjective)
    if (q.trim() && city) {
      // Keep the user's current phrase in sync with the direction they just chose.
      // oxlint-disable-next-line react/immutability -- function declaration is safely hoisted.
      void runSearchIn(q.trim(), city, undefined, nextObjective)
    } else {
      resetAll(); setQuery(''); setQ(''); setLens(value); setTab('results')
      void loadBrowse(city)
    }
  }
  const directionOptions = [
    { value: 'market', label: 'افهم السوق' },
    { value: 'sellers', label: 'ابحث عن موردين' },
    { value: 'buyers', label: 'ابحث عن مشترين' },
  ] as const
  const directionIndex = directionOptions.findIndex((option) => option.value === lens)
  const moveDirectionFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? directionOptions.length - 1
        : event.key === 'ArrowLeft'
          ? (index + 1) % directionOptions.length
          : event.key === 'ArrowRight'
            ? (index - 1 + directionOptions.length) % directionOptions.length
            : -1
    if (nextIndex < 0) return
    event.preventDefault()
    lensTabRefs.current[nextIndex]?.focus()
    chooseLens(directionOptions[nextIndex].value)
  }
  const direction = (
    <div role="tablist" aria-label="عدسات خريطة السوق" dir="rtl" className="min-w-0 rounded-full bg-[var(--color-bg-surface-2)]/80 p-1 backdrop-blur-md">
      <div className="relative grid grid-cols-3">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 start-0 w-1/3 rounded-full bg-[var(--color-bg-surface)] shadow-[var(--farq-button-shadow)] transition-transform duration-300 motion-reduce:transition-none"
          style={{ transform: `translateX(-${directionIndex * 100}%)` }} />
        {directionOptions.map((option, index) => (
          <button key={option.value} ref={(node) => { lensTabRefs.current[index] = node }} type="button" role="tab" tabIndex={lens === option.value ? 0 : -1} aria-selected={lens === option.value} onClick={() => chooseLens(option.value)} onKeyDown={(event) => moveDirectionFocus(event, index)}
            className={`relative z-10 min-h-11 rounded-full px-2 py-2 text-[12px] font-semibold whitespace-nowrap transition-colors sm:px-3 sm:text-[13px] ${lens === option.value ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'} ${FOCUS_RING}`}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )

  const chips = useMemo(() => {
    if (!res) return []
    const p = res.parsed || {}
    const cat = (p.keywords || []).filter(arabic)[0] || ''
    const area = p.city ? cityName(p.city) : null
    return [cat ? `المنتج: ${cat}` : null, p.seller_label ? `الجهات المناسبة: ${p.seller_label}` : null, area ? `المدينة: ${area}` : null].filter(Boolean) as string[]
  }, [res, cities]) // eslint-disable-line react-hooks/exhaustive-deps

  async function searchSavedBuyerProducts(inCity: string, productFilters: AreaFilters = {}, preserveSpatial = false) {
    const products = [...new Set(lines.map((line) => line.name.trim()).filter(Boolean))]
    if (!inCity || !products.length) { void loadBrowse(inCity, {}); return }
    const version = ++generation.current
    const requestStartedAt = performance.now()
    recordMapInteraction('map_buyer_products_search_started')
    setBusyKind('search'); setError(null); setFailedResultRefresh(false); setProfile(null)
    setLens('buyers'); setObjective('marketing'); setQuery(''); setQ(''); setAreaFilters(productFilters); setRes(null)
    if (!preserveSpatial) {
      setChosenD(new Set()); setStreetPick({ kind: 'all' }); setActiveStreet(null); setFocus(null); setSite(null); setShowUnlocated(false); fitCity()
    }
    setMultiIntents([]); setMultiPending(new Map()); setSelected(new Set()); setSelectedRows(new Map()); setBuyerProductGroups([])
    setBuyerProductProgress({ completed: 0, total: products.length })
    try {
      // Each saved product gets its own server-side buyer match. A single joined
      // phrase can be interpreted as an AND query and silently lose products.
      const responses: TargetSearch[] = []
      // Keep larger catalogues from firing dozens of requests at the search API at once.
      for (let start = 0; start < products.length; start += 4) {
        const batch = await Promise.all(products.slice(start, start + 4).map((name) => searchTargets(name, inCity, FETCH, 'marketing', 0, productFilters, true, (outcome) => recordMapInteraction(mapSearchRetryEvent('marketing', outcome)))))
        responses.push(...batch)
        setBuyerProductProgress({ completed: responses.length, total: products.length })
        if (version !== generation.current) return
      }
      if (version !== generation.current) return
      const groups = products.map((name, index) => ({
        name,
        rows: responses[index].rows,
        total: responses[index].total,
        nextOffset: responses[index].next_offset ?? (responses[index].has_more ? responses[index].rows.length : null),
        filters: productFilters,
      }))
      const unique = new Map<string, TargetRow>()
      for (const group of groups) for (const row of group.rows) if (!unique.has(row.poi_key)) unique.set(row.poi_key, row)
      const rows = [...unique.values()]
      recordSearchContactAvailability(rows)
      recordMapInteraction(rows.length === 0 ? 'map_buyer_products_search_results_empty' : rows.length < 5 ? 'map_buyer_products_search_results_1_4' : 'map_buyer_products_search_results_5_plus')
      recordMapInteraction(performance.now() - requestStartedAt < 1_000 ? 'map_buyer_products_search_under_1s' : performance.now() - requestStartedAt < 3_000 ? 'map_buyer_products_search_1_to_3s' : 'map_buyer_products_search_over_3s')
      const first = responses[0]
      setBuyerProductGroups(groups)
      setRes({ ...first, rows, total: rows.length, with_whatsapp: rows.filter((row) => Boolean(waNumber(row))).length, with_email: rows.filter((row) => Boolean(row.email)).length, has_more: groups.some((group) => group.nextOffset != null), next_offset: null })
      setLines((current) => current.map((line) => {
        const index = products.indexOf(line.name.trim())
        return index < 0 ? line : { ...line, found: responses[index].total }
      }))
      setShown(FETCH); setActiveLine(null); setTab('results'); setMessage(defaultMessage(null, cityName(inCity)))
      // oxlint-disable-next-line react/immutability -- function declaration is safely hoisted.
      loadClusters('', inCity, false, 'marketing', true)
    } catch (err) {
      if (version === generation.current) {
        recordMapInteraction('map_buyer_products_search_failed')
        setError(err instanceof TargetingError ? err.message : 'تعذّر تحميل مطابقة كل منتجاتك. لم نعرض نتائج جزئية؛ حاول مرة ثانية.')
      }
    } finally {
      if (version === generation.current) { setBusyKind(null); setBuyerProductProgress(null) }
    }
  }
  async function loadMoreBuyerProduct(index: number) {
    const group = buyerProductGroups[index]
    if (!group || group.nextOffset == null || busy) return
    const version = generation.current
    const offset = group.nextOffset
    recordMapInteraction('map_buyer_products_more_started')
    setBusyKind('more'); setError(null)
    try {
      const response = await searchTargets(group.name, city, FETCH, 'marketing', offset, group.filters, true, (outcome) => recordMapInteraction(mapSearchRetryEvent('marketing', outcome)))
      if (version !== generation.current) return
      const appended = response.rows.filter((row) => !group.rows.some((existing) => existing.poi_key === row.poi_key))
      recordSearchContactAvailability(appended)
      const nextOffset = response.next_offset ?? (response.has_more ? offset + response.rows.length : null)
      setBuyerProductGroups((current) => current.map((item, i) => i === index ? { ...item, rows: [...item.rows, ...appended], total: response.total, nextOffset } : item))
      setRes((current) => {
        if (!current) return current
        const rowsByKey = new Map(current.rows.map((row) => [row.poi_key, row]))
        for (const row of response.rows) rowsByKey.set(row.poi_key, row)
        const rows = [...rowsByKey.values()]
        return { ...current, rows, total: rows.length, with_whatsapp: rows.filter((row) => Boolean(waNumber(row))).length, with_email: rows.filter((row) => Boolean(row.email)).length, has_more: buyerProductGroups.some((item, i) => i === index ? nextOffset != null : item.nextOffset != null) }
      })
      recordMapInteraction('map_buyer_products_more_succeeded')
    } catch (err) {
      if (version === generation.current) {
        recordMapInteraction('map_buyer_products_more_failed')
        setError(err instanceof TargetingError ? err.message : `تعذّر تحميل بقية مرشحي ${group.name}.`)
      }
    } finally { if (version === generation.current) setBusyKind(null) }
  }
  async function search(e?: FormEvent) {
    e?.preventDefault()
    const text = q.trim()
    // Clearing a seller's product search means match every saved product,
    // without retaining the previous district or other spatial filters.
    if (!text) {
      if (objective === 'marketing' && lines.some((line) => line.name.trim())) {
        await searchSavedBuyerProducts(city)
        return
      }
      setAreaFilters({})
      setChosenD(new Set())
      setStreetPick({ kind: 'all' })
      setActiveStreet(null)
      setFocus(null)
      setSite(null)
      setShowUnlocated(false)
      fitCity()
      setQuery('')
      setActiveLine(null)
      setBuyerProductGroups([])
      if (objective === 'marketing') setLens('buyers')
      setTab('results')
      void loadBrowse(city, {})
      return
    }
    setActiveLine(null)
    const parsed = parseMapIntents(text)
    if (parsed?.invalid) {
      setError(`ما قدرنا نفصل الطلبات. اكتب كل طلب بصيغة نشاط + حي، وبحد أقصى ${MAX_MAP_INTENTS} طلبات؛ مثال: حلاقين بحي السويدي وابي مطاعم بحي الربيع.`)
      return
    }
    if (parsed?.intents.length) {
      await searchMultipleIntents(text, parsed.intents)
      return
    }
    const searchObjective = isExplicitPurchaseRequest(text) ? 'purchase' : objective
    if (searchObjective !== objective) setObjective(searchObjective)
    await runSearchIn(text, city, undefined, searchObjective)
  }
  async function searchMultipleIntents(text: string, intents: MapIntent[]) {
    if (!city || !intents.length) return
    const version = ++generation.current
    const startedAt = performance.now()
    setBusyKind('search'); setError(null); setFailedResultRefresh(false); setNotice(null); setProfile(null)
    setLens(objective === 'marketing' ? 'buyers' : 'sellers')
    recordMapInteraction(mapSearchStartedEvent(objective))
    try {
      const responses = await Promise.all(intents.map((intent) => searchTargets(directoryActivityQuery(intent.activity), city, FETCH, objective, 0, { district: intent.district }, true, (outcome) => {
        recordMapInteraction(mapSearchRetryEvent(objective, outcome))
      })))
      if (version !== generation.current) return
      const groups = intents.map((intent, index) => {
        const matches = (row: TargetRow) => hasDirectoryActivityEvidence(intent.activity, [row.name_ar, row.name_en])
        const rows = responses[index].rows.filter(matches)
        return { intent, rows, total: responses[index].total, nextOffset: responses[index].next_offset ?? (responses[index].has_more ? responses[index].rows.length : null), excludedCount: responses[index].rows.length - rows.length }
      })
      const visibleGroups = groups.filter((group) => group.rows.length > 0).length
      recordMapInteraction(visibleGroups === groups.length
        ? 'map_multi_intent_groups_all_visible'
        : visibleGroups > 0 ? 'map_multi_intent_groups_some_visible' : 'map_multi_intent_groups_none_visible')
      const unique = new Map<string, TargetRow>()
      for (const group of groups) for (const row of group.rows) if (!unique.has(row.poi_key)) unique.set(row.poi_key, row)
      recordSearchContactAvailability([...unique.values()])
      const first = responses[0]
      const districtCounts = new Map<string, number>()
      for (const group of groups) districtCounts.set(group.intent.district, (districtCounts.get(group.intent.district) || 0) + group.rows.length)
      setRes({
        ...first,
        rows: [...unique.values()],
        total: unique.size,
        with_whatsapp: [...unique.values()].filter((row) => Boolean(waNumber(row))).length,
        with_email: [...unique.values()].filter((row) => Boolean(row.email)).length,
        areas: { districts: [...districtCounts].map(([name, count]) => ({ name, n: count })), streets: [], wholesale: 0 },
        map_query: first.map_query,
        has_more: false,
      })
      setQuery(text); setQ(text); setShown(PAGE); setAreaFilters({}); setBuyerProductGroups([]); setMultiIntents(groups); setMultiPending(new Map()); setTab('results'); setFocus(null); setShowUnlocated(false)
      if (!selected.size) setMessage(defaultMessage(null, cityName(city)))
      const districtIds = intents.map((intent) => polys?.find((district) => normalizeActivityText(district.ar) === normalizeActivityText(intent.district))?.id || `name:${intent.district}`)
      setChosenD(new Set(districtIds))
      setMapScope('district')
      if (version === generation.current) {
        const total = [...unique.values()].length
        recordMapInteraction(mapSearchLatencyEvent(performance.now() - startedAt, objective))
        recordMapInteraction(mapSearchResultEvent(total))
        recordMapInteraction(mapSearchOutcomeEvent(total, objective))
      }
    } catch (err) {
      if (version === generation.current) {
        recordMapInteraction(mapSearchFailedEvent(objective))
        recordMapInteraction('map_multi_intent_search_failed')
        setError(err instanceof TargetingError ? err.message : 'تعذّر إكمال كل طلبات البحث. لم نعرض نتائج جزئية؛ حاول مرة ثانية.')
      }
    } finally {
      if (version === generation.current) setBusyKind(null)
    }
  }
  async function loadMoreIntent(index: number) {
    const group = multiIntents[index]
    if (!group || group.nextOffset == null || busy) return
    const version = generation.current
    const offset = group.nextOffset
    setBusyKind('more'); setError(null)
    try {
      const response = await searchTargets(directoryActivityQuery(group.intent.activity), city, FETCH, objective, offset, { district: group.intent.district }, true, (outcome) => {
        recordMapInteraction(mapSearchRetryEvent(objective, outcome))
      })
      if (version !== generation.current) return
      const newRows = response.rows.filter((row) => !group.rows.some((existing) => existing.poi_key === row.poi_key))
      const matches = (row: TargetRow) => hasDirectoryActivityEvidence(group.intent.activity, [row.name_ar, row.name_en])
      const appended = newRows.filter(matches)
      recordSearchContactAvailability(appended)
      const excludedCount = newRows.length - appended.length
      setMultiIntents((current) => current.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        rows: [...item.rows, ...appended],
        total: response.total,
        excludedCount: item.excludedCount + excludedCount,
        nextOffset: response.next_offset ?? (response.has_more ? offset + response.rows.length : null),
      } : item))
      setRes((current) => {
        if (!current) return current
        const rowsByKey = new Map(current.rows.map((row) => [row.poi_key, row]))
        for (const row of response.rows) rowsByKey.set(row.poi_key, row)
        const rows = [...rowsByKey.values()]
        return { ...current, rows, total: rows.length, with_whatsapp: rows.filter((row) => Boolean(waNumber(row))).length, with_email: rows.filter((row) => Boolean(row.email)).length }
      })
    } catch (err) {
      if (version === generation.current) setError(err instanceof TargetingError ? err.message : 'تعذّر تحميل بقية نتائج هذا الطلب.')
    } finally {
      if (version === generation.current) setBusyKind(null)
    }
  }
  async function searchLine(i: number) {
    if (!city || !cities.some((value) => value.en === city)) { setError('اختر مدينة البحث من القائمة.'); return }
    setBuyerProductGroups([])
    setActiveLine(i); setQ(lines[i].name)
    const found = await runSearchIn(lines[i].name, city)
    if (found != null) setLines((ls) => ls.map((l, k) => (k === i ? { ...l, found } : l)))
  }
  // «طلباتي»: a start that read something is saved as a request (references only, never file contents)
  const [savedTick, setSavedTick] = useState(0)
  function saveRequest(kind: OpportunityRequestKind, title: string, products: string[], fileRefs: string[]) {
    const cityAr = cities.find((c) => c.en === city)?.ar || city || undefined
    createOpportunityRequest({ kind, title, payload: { city: cityAr, products: products.slice(0, 60).map((p) => p.slice(0, 200)), ...(fileRefs.length ? { fileRefs: fileRefs.slice(0, 20).map((f) => f.slice(0, 200)) } : {}) } })
      .then(() => setSavedTick((t) => t + 1), () => { /* off, read-only or no permission: nothing to show */ })
  }
  async function onBooklet(files: File[]) {
    if (!files.length) return
    setReadErr(null); setReading('بدأنا القراءة…')
    try {
      const read = await readBooklet(files, setReading)
      if (!read.length) throw new Error('ما لقينا منتجات أو خدمات في الملف. ارفع قائمة احتياجات أو كتالوجًا واضحًا.')
      setLines(read); setBooklet(files.length > 1 ? `${files.length} ملفات` : files[0].name); setActiveLine(null)
      saveRequest('BOOKLET', files.length > 1 ? `كراسة · ${files.length} ملفات` : `كراسة · ${files[0].name}`, read.map((l) => l.name), files.map((f) => f.name))
    } catch (err) {
      setReadErr(err instanceof Error ? err.message : 'تعذّرت قراءة الملف.')
    } finally { setReading(null); if (fileInput.current) fileInput.current.value = '' }
  }
  async function loadMore(forUnlocated = false) {
    if (!res || res.next_offset == null || busy) return
    setBusyKind('more'); setError(null)
    const version = generation.current
    const browsingMarket = !query.trim()
    try {
      const searchObjective = browsingMarket ? 'browse' : objective
      const r = await searchTargets(query, city, FETCH, searchObjective, res.next_offset, filters, true, browsingMarket ? undefined : (outcome) => {
        recordMapInteraction(mapSearchRetryEvent(objective, outcome))
      })
      if (version !== generation.current) return
      const newRows = r.rows.filter((row) => !res.rows.some((current) => current.poi_key === row.poi_key))
      if (!browsingMarket) recordSearchContactAvailability(newRows)
      const foundUnlocated = newRows.some((row) => !hasPoint(row))
      setRes((cur) => cur ? { ...cur, rows: [...cur.rows, ...r.rows.filter((x) => !cur.rows.some((y) => y.poi_key === x.poi_key))], has_more: r.has_more, next_offset: r.next_offset } : cur)
      setShown((s) => s + r.rows.length)
      if (browsingMarket) recordMapInteraction('map_browse_more_succeeded')
      if (forUnlocated) {
        recordMapInteraction(foundUnlocated ? 'site_unlocated_batch_found' : 'site_unlocated_batch_empty')
        if (foundUnlocated) setShowUnlocated(true)
      }
    } catch (err) {
      if (version === generation.current) {
        setError(err instanceof TargetingError ? err.message : 'تعذّر تحميل باقي النتائج.')
        if (browsingMarket) recordMapInteraction('map_browse_more_failed')
        if (forUnlocated) recordMapInteraction('site_unlocated_batch_failed')
      }
    } finally { if (version === generation.current) setBusyKind(null) }
  }
  async function loadBrowse(inCity: string, browseFilters: AreaFilters = {}, preserveSelection = false) {
    if (!inCity) return
    areaFiltersRef.current = browseFilters
    const version = ++generation.current
    const hadResults = Boolean(res)
    setBuyerProductGroups([]); setBuyerProductProgress(null)
    setBusyKind('browse'); setError(null); setFailedResultRefresh(false); setProfile(null)
    try {
      const r = await searchTargets('', inCity, FETCH, 'browse', 0, browseFilters)
      if (version !== generation.current) return
      recordMapInteraction('map_browse_succeeded')
      setFailedResultRefresh(false)
      // A city directory page is fetched in batches of FETCH rows. Show the
      // complete first batch so the initial empty-search state does not hide
      // 50 already-loaded establishments behind an extra click.
      setRes(r); setQuery(''); setAreaFilters(browseFilters); setShown(FETCH)
      setBuyerProductGroups([])
      if (!preserveSelection) {
        setSelected(new Set()); setSelectedRows(new Map()); setMultiIntents([]); setMultiPending(new Map())
      }
      setProfile(null)
      // Show a few high-signal city trading points on the first map view, before the user searches.
      loadClusters('', inCity, Boolean(browseFilters.wholesale), 'purchase', true)
    } catch (err) {
      if (version === generation.current) {
        recordMapInteraction('map_browse_failed')
        if (hadResults) recordMapInteraction('map_browse_refresh_failed')
        setFailedResultRefresh(hadResults); setError(err instanceof TargetingError ? err.message : 'تعذّر تحميل نقاط السوق.')
      }
    } finally { if (version === generation.current) setBusyKind(null) }
  }
  // Preserve the active search when the user changes cities. A city-wide browse
  // under the old phrase made the input and map disagree about what was searched.
  useEffect(() => {
    const text = query.trim()
    if (text) void runSearchIn(text, city)
    else if (lens === 'buyers' && lines.some((line) => line.name.trim())) void searchSavedBuyerProducts(city)
    else void loadBrowse(city)
  }, [city]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Where this trade concentrates in the city (POST /clusters); quiet when the service has none or is older. */
  function loadClusters(text: string, inCity: string, wholesale: boolean, obj: typeof objective = objective, keepStreets = false) {
    const v = ++clusterGen.current
    setClusters(null)
    tradeClusters({ city: inCity, q: text, objective: obj, ...(wholesale ? { wholesale: true } : {}) }).then(
      (c) => { if (v === clusterGen.current) setClusters({ list: (c?.clusters || []).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).map((x) => ({ ...x, popular_ar: marketNameFor(x, inCity, text) })), basis: c?.basis }) },
      () => { if (v === clusterGen.current) setClusters(null) },
    )
    // the request's own dense streets (a street picked before any search keeps the streets on screen)
    if (!keepStreets) { setActiveStreet(null); setStreetPick({ kind: 'q', q: text, objective: obj }) }
  }
  /**
   * A new request (next = undefined) starts without narrowing filters: «جملة» in the request only RANKS wholesalers first
   * (the service does that); it never switches «جملة فقط» on (owner 2026-10-16). Otherwise: the same request with these filters.
   */
  async function runSearchIn(text: string, inCity: string, next?: AreaFilters, obj: typeof objective = objective, initial?: AreaFilters, keepStreets = false): Promise<number | null> {
    if (!text || !inCity) return null
    setLens(obj === 'marketing' ? 'buyers' : 'sellers')
    setBusyKind('search'); setError(null); setFailedResultRefresh(false); setNotice(null); setProfile(null)
    const version = ++generation.current
    const fresh = next === undefined
    const use: AreaFilters = fresh ? (initial ?? {}) : next
    areaFiltersRef.current = use
    const requestStartedAt = performance.now()
    if (fresh) recordMapInteraction(mapSearchStartedEvent(obj))
    try {
      const r = await searchTargets(text, inCity, FETCH, obj, 0, use, true, (outcome) => {
        recordMapInteraction(mapSearchRetryEvent(obj, outcome))
      })
      if (version !== generation.current) return null
      recordSearchContactAvailability(r.rows)
      lastSearchRows.current = r.rows
      setFailedResultRefresh(false)
      lastSuccessfulQueryObjective.current = obj
      if (!fresh && use.wholesale === true && filters.wholesale !== true) recordMapInteraction(mapWholesaleFilterOutcomeEvent(r.total))
      if (fresh) {
        recordMapInteraction(mapSearchLatencyEvent(performance.now() - requestStartedAt, obj))
        recordMapInteraction(mapSearchResultEvent(r.total))
        recordMapInteraction(mapSearchOutcomeEvent(r.total, obj))
      }
      // In the buyer lens a typed search is a product intent. Keep it in the
      // in-memory product list so clearing the search can broaden back out to
      // buyers for every product the seller has entered, instead of falling
      // back to the unfiltered city directory.
      if (fresh && obj === 'marketing') {
        setLines((current) => {
          const normalized = normalizeActivityText(text)
          if (current.some((line) => normalizeActivityText(line.name) === normalized)) return current
          return [...current, { name: text, qty: '', unit: '', found: r.total }]
        })
      }
      setTab('results')
      setRes(r); setQuery(text); setShown(PAGE); setAreaFilters(use)
      if (fresh) {
        setSelected(new Set()); setSelectedRows(new Map()); setMultiIntents([]); setMultiPending(new Map()); setBuyerProductGroups([])
        const scopedDistrictId = use.district
          ? districts.find((district) => normalizeActivityText(district.ar) === normalizeActivityText(use.district!))?.id || `name:${use.district}`
          : null
        setChosenD(scopedDistrictId ? new Set([scopedDistrictId]) : new Set())
        // A fresh search started from a selected street or district is still
        // geographically scoped; keep that scope available to later actions.
        setMapScope(use.street ? 'street' : use.district ? 'district' : 'city')
        setFocus(null); setProfile(null); setShowUnlocated(false)
      }
      else setSelected((cur) => new Set(r.rows.filter((x) => cur.has(x.poi_key)).map((x) => x.poi_key)))
      if (fresh || Boolean(use.wholesale) !== Boolean(filters.wholesale)) loadClusters(text, inCity, Boolean(use.wholesale), obj, keepStreets)
      const p = r.parsed || {}
      const cat = (p.keywords || []).filter(arabic)[0] || null
      if (fresh) setMessage(defaultMessage(cat, cityName(inCity)))
      return r.total
    } catch (err) {
      if (version !== generation.current) return null
      recordMapInteraction(mapSearchFailureEvent(
        obj,
        err instanceof TargetingError ? err.status : undefined,
        err instanceof TypeError,
        fresh ? 'fresh_search' : 'filter_refresh',
      ))
      if (!fresh && use.wholesale === true && filters.wholesale !== true) recordMapInteraction('map_filter_wholesale_results_failed')
      if (fresh) {
        recordMapInteraction('map_search_failed')
        recordMapInteraction(mapSearchFailedEvent(obj))
      }
      setFailedResultRefresh(Boolean(res) && (fresh || JSON.stringify(use) !== JSON.stringify(filters)))
      setError(err instanceof TargetingError ? err.message : 'تعذّر البحث. تأكد من الاتصال وحاول مرة ثانية.')
      return null
    } finally { if (version === generation.current) setBusyKind(null) }
  }
  const applyFilters = (next: AreaFilters) => {
    if (next.street) setMapScope('street')
    else if (next.district) setMapScope('district')
    else if (mapScope === 'street') setMapScope(chosenD.size ? 'district' : 'city')
    else if (mapScope === 'district' && !chosenD.size) setMapScope('city')
    if (query) void runSearchIn(query, city, next)
    else if (buyerProductMode) void searchSavedBuyerProducts(city, next, true)
    else if (!Object.values(next).some(Boolean)) clearMapToCity()
    else void loadBrowse(city, next)
  }
  const clearMapToCity = () => {
    generation.current++
    clusterGen.current++
    specialtyFocusResolution.current++
    setQ(''); setQuery(''); setAreaFilters({}); setChosenD(new Set()); setMapScope('city'); setStreetPick({ kind: 'all' })
    setActiveStreet(null); setFocus(null); setLayer('main'); setSite(null); setPlacingSite(false); setShowUnlocated(false)
    setLens(objective === 'marketing' ? 'buyers' : 'market')
    setTab(objective === 'marketing' ? 'results' : 'guide')
    setLayersOpen(false); setError(null); setFailedResultRefresh(false)
    fitCity()
    void loadBrowse(city, {})
  }
  async function openMapProfile(key: string) {
    if (busy || failedResultRefresh) return
    const existing = byKey.get(key)
    if (existing) { recordMapInteraction('map_profile_open'); setSheetSnap('full'); setProfile(key); return }
    if (!res?.map_query) return
    const version = generation.current
    const mapQuery = res.map_query
    try {
      const result = await mapProfile(mapQuery, key)
      if (version !== generation.current) return
      setRes((current) => current?.map_query === mapQuery ? { ...current, rows: [...current.rows.filter((row) => row.poi_key !== key), result.row] } : current)
      recordMapInteraction('map_profile_open'); setSheetSnap('full')
      setProfile(key)
    } catch {
      if (version === generation.current) setError('تعذّر فتح بيانات المنشأة. حدّث نقاط الخريطة وحاول مرة ثانية.')
    }
  }
  function prepareQuoteForProfile(key: string) {
    if (busy || failedResultRefresh) return
    const row = byKey.get(key)
    if (!row || !onRfq) return
    recordMapInteraction('map_profile_quote_start')
    const product = query.trim()
    writeLocal('purchase-seed', {
      lines: product ? [{ name: product, qty: '', unit: '' }] : [],
      city: cityName(city),
      targets: [row],
    })
    setProfile(null)
    onRfq()
  }
  const keep = (f: AreaFilters, drop: (keyof AreaFilters)[]) => { const x = { ...f }; for (const k of drop) delete x[k]; return x }
  const pickCluster = (c: TradeCluster) => {
    fitTo(boxAround(c.lat, c.lon))
    if (!c.district_ar) return
    // the cluster's district is chosen on the map too, so its shops show
    const d = districts.find((x) => x.ar === c.district_ar)
    if (d) setChosenD(new Set([d.id]))
    applyFilters({ ...keep(filters, ['district', 'street']), district: c.district_ar, street: c.level === 'street' && c.street_ar ? c.street_ar : undefined })
  }

  /** A dense street (line, its label or the list): zoom to it, choose its district, narrow the results to it, show its card. */
  const pickStreetFromScope = (value: string) => {
    const selected = streetScopeOptions.find((street) => street.value === value)
    if (!selected) return
    const denseMatch = dense?.list.find((street) =>
      normalizeActivityText(street.props.street_ar) === normalizeActivityText(selected.name)
      && (!selected.district || normalizeActivityText(street.props.district_ar || '') === normalizeActivityText(selected.district)))
    if (denseMatch) { pickStreet(denseMatch.id); return }

    recordMapInteraction('map_street_select')
    setMapScope('street')
    setActiveStreet(null)
    const matchingDistricts = selected.district ? districtScopeGroups.get(normalizeActivityText(selected.district)) : undefined
    if (matchingDistricts?.length) {
      setChosenD(new Set(matchingDistricts.map((district) => district.id)))
      fitDistrictSelection(matchingDistricts)
    }
    const streetRows = rows.filter((row) =>
      normalizeActivityText(safeLocationName(row.street_ar) || '') === normalizeActivityText(selected.name)
      && (!selected.district || normalizeActivityText(safeLocationName(row.district_ar) || '') === normalizeActivityText(selected.district))
      && hasPoint(row))
    if (streetRows.length) {
      const lons = streetRows.map((row) => row.longitude!)
      const lats = streetRows.map((row) => row.latitude!)
      const pad = 0.002
      fitTo([Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad])
    }
    const streetFilters = { ...keep(filters, ['district', 'street']), ...(selected.district ? { district: selected.district } : {}), street: selected.name }
    applyFilters(streetFilters)
  }

  const pickStreet = (id: string) => {
    const st = dense?.list.find((x) => x.id === id)
    if (!st) return
    recordMapInteraction('map_street_select')
    setMapScope('street')
    if (focusMode) {
      if (mobile && !focusPanelOpen) recordMapInteraction('map_sheet_open')
      setFocusPanelOpen(true)
      if (mobile) setSheetSnap('half')
    }
    const [w, so, e, no] = st.bbox, pad = 0.002
    fitTo([w - pad, so - pad, e + pad, no + pad])
    setActiveStreet(id)
    const d = hasPolys ? districtAt(st.mid[0], st.mid[1], districts) : null
    if (d) setChosenD(new Set([d.id]))
    // A street is a geographic scope in market view. Keep the chosen map
    // activity and lens intact instead of turning the street's category into a
    // new supplier search. In a dedicated supplier/buyer journey, retain the
    // existing shortcut of searching from the street's own activity.
    const streetFilters = { ...keep(filters, ['district', 'street']), ...(st.props.district_ar ? { district: st.props.district_ar } : {}), street: st.props.street_ar }
    if (query) applyFilters(streetFilters)
    else if (lens === 'market') applyFilters(streetFilters)
    else { const term = st.props.sub_ar || st.props.main_ar; if (term) { setQ(term); void runSearchIn(term, city, undefined, objective, streetFilters, true) } }
  }

  /** «أبي أبيع منتجاتي»: confirmed specialties become search lines on the buyers' side; the first one runs now. */
  const startSelling = (names: string[], files: string[] = []) => {
    closeStart()
    saveRequest(files.length ? 'SELLER_CATALOG' : 'SELLER_PRODUCTS', `أبيع: ${names.slice(0, 3).join('، ')}${names.length > 3 ? '…' : ''}`, names, files)
    resetAll()
    setObjective('marketing')
    setLines(names.map((name) => ({ name, qty: '', unit: '' }))); setBooklet('تخصصاتك'); setActiveLine(null)
    if (!city || !cities.some((c) => c.en === city)) { setError('اختر المدينة، ثم اضغط التخصص للبحث عن مشترين.'); return }
    setActiveLine(0); setQ(names[0])
    void runSearchIn(names[0], city, undefined, 'marketing').then((found) => { if (found != null) setLines((ls) => ls.map((l, k) => (k === 0 ? { ...l, found } : l))) })
  }
  const beginBuyerFlow = (browse: boolean) => {
    if (lens === 'sellers' && objective === 'purchase') return
    resetAll(); setQ(''); setQuery(''); setObjective('purchase'); setLens('sellers'); setTab('results')
    if (browse) void loadBrowse(city)
  }
  const startSheet = startOpen ? (
    <StartSheet mobile={mobile} initialDirection={objective === 'marketing' ? 'sell' : 'buy'} onClose={closeStart} onRfq={onRfq}
      onBooklet={() => { beginBuyerFlow(false); fileInput.current?.click(); closeStart() }}
      onBuySearch={() => { beginBuyerFlow(true); closeStart(); requestAnimationFrame(() => input.current?.focus()) }}
      onExplore={() => { closeStart(); if (lens !== 'market') chooseLens('market') }}
      onSellLines={startSelling} />
  ) : null
  const fileField = (
    <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden
      accept=".pdf,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*"
      onChange={(e) => void onBooklet([...(e.target.files || [])])} />
  )
  const linesPanel = (reading || readErr || lines.length) ? (
    <section aria-label="منتجات وخدمات الملف" className="flex flex-col gap-2">
      {reading ? <p role="status" className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{reading}</p> : null}
      {readErr ? <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]">{readErr}</p> : null}
      {lines.length ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[14px] leading-[22px] font-medium">عناصر الملف ({n(lines.length)}){booklet ? <span className="text-[var(--color-text-tertiary)]"> · <bdi>{booklet}</bdi></span> : null}</p>
            <button type="button" onClick={() => { setLines([]); setBuyerProductGroups([]); setBooklet(null); setActiveLine(null) }} className={`text-[12px] leading-[18px] text-[var(--color-text-tertiary)] hover:underline ${FOCUS_RING}`}>إزالة</button>
          </div>
          <ul className={mobile ? '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1' : 'flex max-h-[112px] flex-wrap gap-2 overflow-y-auto'}>
            {lines.map((l, i) => (
              <li key={i} className="shrink-0">
                <button type="button" onClick={() => void searchLine(i)} disabled={busy} aria-pressed={activeLine === i} title={l.name}
                  className={`flex max-w-[280px] items-center gap-2 rounded-full border px-3 py-1.5 text-start text-[14px] leading-[22px] disabled:opacity-60 ${activeLine === i ? 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary-subtle)] text-[var(--color-text-info)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)] hover:border-[var(--color-border-strong)]'} ${FOCUS_RING}`}>
                  <span className="truncate">{l.name}</span>
                  {l.qty ? <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{l.qty} {l.unit}</span> : null}
                  {l.found != null ? <span className="shrink-0 rounded-full bg-[var(--color-bg-success)] px-1.5 text-[12px] text-[var(--color-text-success)]">{n(l.found)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  ) : null

  // «جملة فقط» · «الحي» · «الشارع» · «الدور» · «التخصص»; an active filter is a chip with ×
  const areas = res?.areas
  const streets = useMemo(() => (areas?.streets || []).filter((x) => !filters.district || x.district === filters.district), [areas, filters.district])
  // The scope picker is a directory filter, so it must offer every discovered
  // street in the current city or district. Density lines remain a separate,
  // analytical layer and are only used for exact geometry when available.
  // oxlint-disable-next-line react/preserve-manual-memoization -- normalizing every street is intentionally memoized for large cities.
  const streetScopeOptions = useMemo(() => {
    const unique = new Map<string, { name: string; district: string; n: number }>()
    for (const street of streets) {
      const name = safeLocationName(street.name)
      if (!name) continue
      const district = safeLocationName(street.district) || ''
      const key = `${normalizeActivityText(name)}\u0000${normalizeActivityText(district)}`
      const current = unique.get(key)
      unique.set(key, { name, district, n: Math.max(current?.n || 0, street.n || 0) })
    }
    return [...unique.values()]
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ar'))
      .map((street, index) => ({ ...street, value: `directory:${index}`, text: `${street.name}${street.district ? ` · ${street.district}` : ''} (${n(street.n)})` }))
  }, [streets])
  const picker = (id: string, label: string, icon: typeof DistrictIcon, options: { value: string; text: string }[], onPick: (v: string) => void) => options.length ? (
    <FilterPill id={id} label={label} icon={icon} analyticsKey={id === 'targeting-district' ? 'district' : id === 'targeting-street' ? 'street' : id === 'targeting-role' ? 'role' : 'specialty'} options={options} disabled={busy} mobile={mobile} onPick={onPick} />
  ) : null
  const highlightFilterDistrict = (name?: string) => {
    if (!name) { setChosenD(new Set()); return }
    const normalized = safeLocationName(name)
    const match = districts.find((district) => safeLocationName(district.ar) === normalized)
    setChosenD(new Set([match?.id || `name:${name}`]))
  }
  const areaBar = res && areas ? (
    <fieldset aria-label="تضييق النتائج" className={`m-0 min-w-0 border-0 ${mobile ? '-mx-4 flex flex-wrap items-center gap-2 px-4 pt-0 pb-1' : 'flex flex-wrap items-center gap-2 p-0'}`}>
      <FiltersIcon size={18} className="shrink-0 text-[var(--color-icon-secondary)]" />
      {filters.contact === 'whatsapp' ? <Chip className="shrink-0" icon="whatsapp" label="إشارة واتساب برقم صالح" selected disabled={busy} onRemove={() => applyFilters(keep(filters, ['contact']))} /> : null}
      {areas.wholesale || filters.wholesale ? (
        <Chip className="shrink-0" icon={WholesaleIcon} label={`جملة فقط · ${n(areas.wholesale)}`} selected={Boolean(filters.wholesale)} disabled={busy}
          onClick={() => {
            const enabled = !filters.wholesale
            recordMapInteraction(enabled ? 'map_filter_wholesale_on' : 'map_filter_wholesale_off')
            applyFilters({ ...filters, wholesale: enabled || undefined })
          }} />
      ) : null}
      {filters.district
        ? <Chip className="shrink-0" icon={DistrictIcon} label={`الحي: ${filters.district}`} selected disabled={busy} onRemove={() => { highlightFilterDistrict(); applyFilters(keep(filters, ['district', 'street'])) }} />
        : picker('targeting-district', 'الحي', DistrictIcon, areas.districts.flatMap((d) => {
          const name = safeLocationName(d.name)
          return name ? [{ value: name, text: `${name} (${n(d.n)})` }] : []
        }), (v) => { highlightFilterDistrict(v); applyFilters({ ...keep(filters, ['street']), district: v }) })}
      {filters.street
        ? <Chip className="shrink-0" icon={StreetIcon} label={`الشارع: ${filters.street}`} selected disabled={busy} onRemove={() => applyFilters(keep(filters, ['street']))} />
        : picker('targeting-street', 'الشارع', StreetIcon, streets.map((st, i) => ({ value: String(i), text: `${st.name}${filters.district || !st.district ? '' : ` — ${st.district}`} (${n(st.n)})` })), (v) => { const st = streets[Number(v)]; if (st) { highlightFilterDistrict(filters.district || st.district || undefined); applyFilters({ ...filters, district: filters.district || st.district || undefined, street: st.name }) } })}
      {filters.role
        ? <Chip className="shrink-0" icon={SupplierIcon} label={`الدور: ${filters.role}`} selected disabled={busy} onRemove={() => applyFilters(keep(filters, ['role']))} />
        : picker('targeting-role', 'الدور', SupplierIcon, (areas.roles || []).map((x) => ({ value: x.name, text: `${x.name} (${n(x.n)})` })), (v) => applyFilters({ ...filters, role: v }))}
      {filters.specialty
        ? <Chip className="shrink-0" icon={SpecialtiesIcon} label={`التخصص: ${filters.specialty}`} selected disabled={busy} onRemove={() => applyFilters(keep(filters, ['specialty']))} />
        : picker('targeting-specialty', 'التخصص', SpecialtiesIcon, (areas.specialties || []).map((x) => ({ value: x.name, text: `${x.name} (${n(x.n)})` })), (v) => applyFilters({ ...filters, specialty: v }))}
    </fieldset>
  ) : null
  const examples = objective === 'marketing' ? SELL_EXAMPLES : BUY_EXAMPLES
  const markets = useMemo(() => (objective === 'purchase' ? marketSuggestions(city) : []), [city, objective])
  const tryExample = (term: string, district?: string) => {
    setQ(term); setActiveLine(null)
    if (!city) { setError('اختر المدينة، ثم اضغط المثال.'); requestAnimationFrame(() => input.current?.focus()); return }
    void runSearchIn(term, city, undefined, objective, district ? { district } : undefined)
  }
  const suggestBar = !res && !busy ? (
    <div aria-label="أمثلة للبحث" role="group" className={mobile ? '-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1' : 'flex flex-wrap items-center gap-2'}>
      <span className="shrink-0 text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)]">جرّب:</span>
      {examples.map((t) => <Chip key={t} className="shrink-0" label={t} onClick={() => tryExample(t)} />)}
      {markets.map((m) => <Chip key={m.label} className="shrink-0" label={m.label} onClick={() => tryExample(m.term, m.district)} />)}
    </div>
  ) : null
  // Keep a short list of high-signal trade points alongside the street-density lines.
  const denseList = useMemo(() => {
    if (filters.role) return []
    return (dense?.list || []).filter((street) =>
      (!filters.street || safeLocationName(street.props.street_ar) === safeLocationName(filters.street)) &&
      (!filters.district || safeLocationName(street.props.district_ar) === safeLocationName(filters.district)))
  }, [dense, filters.role, filters.street, filters.district])
  const streetNames = useMemo(() => new Set(denseList.map((x) => x.props.street_ar)), [denseList])
  const clusterTop = useMemo(() => (clusters?.list || [])
    .filter((c) => !filters.role && !filters.specialty && c.level !== 'cell' &&
      (!filters.district || safeLocationName(c.district_ar) === safeLocationName(filters.district)) &&
      (!filters.street || c.level === 'street' && safeLocationName(c.street_ar) === safeLocationName(filters.street)) &&
      !(c.level === 'street' && c.street_ar && streetNames.has(c.street_ar)))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5), [clusters, streetNames, filters.role, filters.specialty, filters.district, filters.street])
  const activeStreetId = activeStreet && denseList.some((x) => x.id === activeStreet && (!filters.street || safeLocationName(x.props.street_ar) === safeLocationName(filters.street))) ? activeStreet : null
  const pickedStreet = activeStreetId ? denseList.find((x) => x.id === activeStreetId)! : null
  // Use counts from the same selected cohort for map colors. Exact specialty filters only
  // draw street lines when the source carries specialty IDs; unsupported dimensions fail closed.
  const density = useMemo(() => {
    if (!hasPolys) return new Map<string, number>()
    if (filters.role && streetPick.kind !== 'all') return new Map<string, number>()
    if (res && streetPick.kind === 'all') return densityOf(districts, res.areas?.districts || [], rows)
    return densityOf(districts, marketDistrictCounts.map((item) => ({ name: item.district_ar, n: item.n })), [])
  }, [hasPolys, res, streetPick.kind, districts, rows, marketDistrictCounts, filters.role])
  const densityMax = useMemo(() => Math.max(0, ...density.values()), [density])
  // Keep the selected neighborhood visually isolated while the rest retain
  // their outlines for orientation. Clearing the neighborhood restores the
  // citywide heat layer.
  const mapDensity = useMemo(() => chosenD.size
    ? new Map([...density].filter(([id]) => chosenD.has(id)))
    : density, [density, chosenD])
  const anyChosen = chosenD.size > 0 || Boolean(filters.street)
  // Browse data is loaded before a customer searches; it must not advance the search journey.
  const step: 1 | 2 | 3 = !(hasTargetQuery || buyerProductMode) ? 1 : !anyChosen && !profile ? 2 : 3
  const topDistricts = useMemo(() => filters.role && streetPick.kind !== 'all' ? [] : res && streetPick.kind === 'all'
    ? [...(res.areas?.districts || [])].sort((a, b) => b.n - a.n).slice(0, 8)
    : marketDistrictCounts.slice(0, 8).map((d) => ({ name: d.district_ar, n: d.n })), [res, streetPick.kind, marketDistrictCounts, filters.role])
  const where = filters.street ? `${filters.street}${filters.district ? `، ${filters.district}` : ''}` : filters.district || (chosenNames.length === 1 ? chosenNames[0] : chosenNames.length > 1 ? `${formatNumber(chosenNames.length)} أحياء` : cityName(city))
  const pickedMain = streetPick.kind === 'main' ? streetPick.id : streetPick.kind === 'sub' ? streetPick.main : streetPick.kind === 'spec' ? catalog?.find((item) => item.subs.some((sub) => String(sub.sub_id) === streetPick.subId))?.main_id || null : null
  const pickedSubs = pickedMain ? catalog?.find((m) => m.main_id === pickedMain)?.subs || [] : []
  const selectedActivity = pickedMain ? catalog?.find((m) => m.main_id === pickedMain) : null
  const normalizedActivitySearch = normalizeActivityText(activitySearch.trim())
  const filteredActivities = (catalog || []).filter((item) => normalizeActivityText(item.main_ar).includes(normalizedActivitySearch) || item.subs.some((sub) => normalizeActivityText(sub.sub_ar).includes(normalizedActivitySearch)))
  const matchingSubActivities = activitySearch.trim() ? (catalog || []).flatMap((item) => item.subs
    .filter((sub) => normalizeActivityText(sub.sub_ar).includes(normalizedActivitySearch))
    .map((sub) => ({ ...sub, main_id: item.main_id, main_ar: item.main_ar }))) : []
  const filteredSpecialties = activitySpecialties.filter((item) => !selectedActivity || !item.main_ar || item.main_ar === selectedActivity.main_ar)
  useEffect(() => {
    const text = activitySearch.trim()
    if (text.length < 2) {
      setActivitySpecialties([])
      setActivitySpecialtiesLoading(false)
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      setActivitySpecialtiesLoading(true)
      suggestSpecialties(text, pickedMain || undefined).then((result) => {
        if (active) setActivitySpecialties(result?.suggestions || [])
      }, () => {
        if (active) setActivitySpecialties([])
      }).finally(() => {
        if (active) setActivitySpecialtiesLoading(false)
      })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [activitySearch, pickedMain])
  const clearActivitySelection = () => {
    if (streetPick.kind !== 'all') recordMapInteraction('map_activity_clear')
    setStreetPick({ kind: 'all' })
    pickFocus(null)
    closeActivityMenu()
  }
  const selectActivity = (mainId: string) => {
    const clear = pickedMain === mainId
    recordMapInteraction(clear ? 'map_activity_clear' : 'map_activity_main_select')
    setStreetPick(clear ? { kind: 'all' } : { kind: 'main', id: mainId })
    pickFocus(clear ? null : { level: 'main', id: mainId })
    closeActivityMenu()
  }
  const selectSubActivity = (mainId: string, subId: string | number) => {
    const selectedAlready = streetPick.kind === 'sub' && streetPick.ids.map(String).includes(String(subId))
    recordMapInteraction(selectedAlready ? 'map_activity_clear' : 'map_activity_sub_select')
    setStreetPick(selectedAlready ? { kind: 'main', id: mainId } : { kind: 'sub', ids: [String(subId)], main: mainId })
    pickFocus(selectedAlready ? { level: 'main', id: mainId } : { level: 'sub', id: String(subId) })
    closeActivityMenu()
  }
  const selectStreetSpecialty = (item: SpecialtySuggestion) => {
    const id = String(item.specialty_ar)
    const specialtyId = String(item.specialty_id)
    const subId = String(item.sub_id || '')
    if (!subId) return
    const alreadySelected = streetPick.kind === 'spec' && streetPick.id === id
    recordMapInteraction(alreadySelected ? 'map_activity_clear' : 'map_activity_spec_select')
    setStreetPick(alreadySelected
      ? { kind: 'all' }
      : { kind: 'spec', id, specialtyId, name: item.specialty_ar, subId, mainAr: item.main_ar || item.sub_ar || 'نشاط فرعي' })
    pickFocus(alreadySelected ? null : { level: 'spec', id, sub_id: subId })
    closeActivityMenu()
  }
  const closeActivityMenu = () => {
    setActivityMenuOpen(false)
    activityTriggerRef.current?.focus()
  }
  const renderActivitySearchMatches = () => activitySearch.trim() ? (
    <div className="mt-2 flex flex-col gap-1" aria-live="polite">
      {matchingSubActivities.map((item) => (
        <Command.Item key={`sub:${item.sub_id}`} value={`فرعي ${item.sub_ar} ${item.main_ar}`} onSelect={() => selectSubActivity(item.main_id, item.sub_id)} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-3 text-start text-[13px] data-[selected=true]:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>
          <span className="min-w-0 flex-1 truncate">{item.sub_ar} <span className="text-[var(--color-text-tertiary)]">· {item.main_ar}</span></span>
          <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{n(item.streets)} شارع</span>
        </Command.Item>
      ))}
      <div className="mt-1 border-t border-[var(--color-border-default)] pt-2">
        <p className="m-0 px-3 pb-1 text-[12px] font-medium text-[var(--color-text-secondary)]">التخصصات المطابقة</p>
        {activitySpecialtiesLoading ? <p className="m-0 px-3 py-2 text-[12px] text-[var(--color-text-tertiary)]">نبحث في التخصصات…</p> : null}
        {filteredSpecialties.map((item) => (
          <Command.Item key={`spec:${item.specialty_id}`} value={`تخصص ${item.specialty_ar} ${item.sub_ar || item.main_ar}`} onSelect={() => selectStreetSpecialty(item)} className={`flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-start text-[13px] data-[selected=true]:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>
            <span className="min-w-0 flex-1 truncate">{item.specialty_ar} <span className="text-[var(--color-text-tertiary)]">· {item.sub_ar || item.main_ar}</span></span>
            {streetPick.kind === 'spec' && streetPick.id === item.specialty_ar ? <Icon name="check" size={16} /> : null}
          </Command.Item>
        ))}
        {!activitySpecialtiesLoading && !matchingSubActivities.length && !filteredSpecialties.length && !filteredActivities.length ? <p className="m-0 px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">ما لقينا تصنيفاً أو نشاطاً فرعياً أو تخصصاً بهذا الاسم.</p> : null}
      </div>
    </div>
  ) : null
  useEffect(() => {
    if (!activityMenuOpen) return
    activitySearchRef.current?.focus()
    const positionMenu = () => {
      const rect = activityTriggerRef.current?.getBoundingClientRect()
      if (rect) {
        const menuHeight = Math.min(window.innerHeight * 0.55, 448)
        setActivityMenuPosition({ top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 12)), right: Math.max(12, window.innerWidth - rect.right) })
      }
    }
    positionMenu()
    const onPointerDown = (event: PointerEvent) => {
      if (!mobile && !activityMenuRef.current?.contains(event.target as Node) && !activityOptionsRef.current?.contains(event.target as Node)) setActivityMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeActivityMenu()
        return
      }
      if (!mobile || event.key !== 'Tab') return
      const dialog = document.getElementById('street-activity-options')
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) { event.preventDefault(); return }
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', positionMenu)
    document.addEventListener('scroll', positionMenu, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', positionMenu)
      document.removeEventListener('scroll', positionMenu, true)
    }
  }, [activityMenuOpen, mobile])
  const renderActivityOptions = (items: StreetCatalog['mains'], activeMain: string | null, onAll: () => void, onSelect: (mainId: string) => void) => (
    <>
      <Command.Item value="كل الأنشطة" onSelect={onAll} className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-start text-[14px] data-[selected=true]:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>
        <span className="min-w-0 flex-1">كل الأنشطة</span>
        {!activeMain && streetPick.kind === 'all' ? <Icon name="check" size={16} /> : null}
      </Command.Item>
      {items.map((item) => <Command.Item key={item.main_id} value={`تصنيف ${item.main_ar}`} onSelect={() => onSelect(item.main_id)} className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-start text-[14px] data-[selected=true]:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>
        <span className="min-w-0 flex-1 truncate">{item.main_ar}</span>
        <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{n(item.streets)} شارع</span>
        {activeMain === item.main_id ? <Icon name="check" size={16} /> : null}
      </Command.Item>)}
    </>
  )
  const activityPicker = catalog && catalog.length ? (
    <div className="flex flex-col gap-2" data-testid="street-picker">
      <div ref={activityMenuRef} className="relative self-start">
        <button ref={activityTriggerRef} type="button" aria-haspopup="dialog" aria-expanded={activityMenuOpen} aria-controls="street-activity-options" onClick={() => { setActivitySearch(''); const nextOpen = !activityMenuOpen; setActivityMenuOpen(nextOpen); if (nextOpen) recordMapInteraction('map_activity_filter_open') }}
          className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px] font-medium shadow-sm hover:border-[var(--color-border-strong)] ${FOCUS_RING}`}>
          <FiltersIcon size={16} className="shrink-0 text-[var(--color-icon-secondary)]" />
          <span className="max-w-[min(65vw,18rem)] truncate">{streetPick.kind === 'spec' ? `التخصص: ${streetPick.name}` : streetPick.kind === 'sub' ? `النشاط الفرعي: ${pickedSubs.find((sub) => streetPick.ids.map(String).includes(String(sub.sub_id)))?.sub_ar || selectedActivity?.main_ar}` : `النشاط: ${selectedActivity ? selectedActivity.main_ar : 'الكل'}`}</span>
          {selectedActivity ? <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{n(selectedActivity.streets)} شارع</span> : null}
          <Icon name="chevron-down" size={15} className={`shrink-0 transition-transform ${activityMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        {activityMenuOpen ? (mobile ? createPortal(
          <div className="fixed inset-0 z-[160] flex items-end bg-black/25" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeActivityMenu() }}>
            <section id="street-activity-options" role="dialog" aria-modal="true" aria-labelledby="street-activity-title" className="flex max-h-[75dvh] w-full flex-col overflow-hidden rounded-t-[24px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 shadow-2xl backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
              <button type="button" aria-label="إغلاق قائمة الأنشطة" onClick={closeActivityMenu} className={`flex h-11 shrink-0 touch-none items-center justify-center ${FOCUS_RING}`}><span aria-hidden className="h-1.5 w-10 rounded-full bg-[var(--color-border-strong)]" /></button>
              <h3 id="street-activity-title" className="px-5 pb-2 text-[16px] font-semibold">اختر نشاط الشوارع</h3>
              <Command label="فلتر أنشطة الشوارع" shouldFilter={false} loop>
                <label htmlFor="activity-search-mobile" className="mx-4 mb-2 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-default)] px-3">
                  <SearchIcon size={16} className="shrink-0 text-[var(--color-icon-secondary)]" />
                  <Command.Input id="activity-search-mobile" ref={activitySearchRef} value={activitySearch} onValueChange={setActivitySearch} aria-label="ابحث عن نشاط أو تخصص" placeholder="ابحث عن تصنيف أو نشاط فرعي أو تخصص" className="!min-h-0 min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0 text-[15px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
                </label>
                <Command.List className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
                  {renderActivityOptions(filteredActivities, pickedMain, clearActivitySelection, selectActivity)}
                  {renderActivitySearchMatches()}
                </Command.List>
              </Command>
            </section>
          </div>, document.body,
        ) : createPortal(
          <div ref={activityOptionsRef} id="street-activity-options" role="dialog" aria-label="نشاط الشوارع وعدد الشوارع لكل نشاط" style={{ position: 'fixed', top: activityMenuPosition?.top ?? 0, right: activityMenuPosition?.right ?? 12 }} className="z-[160] max-h-[min(55dvh,28rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 p-2 shadow-2xl backdrop-blur-xl">
            <Command label="فلتر أنشطة الشوارع" shouldFilter={false} loop>
              <label htmlFor="activity-search-desktop" className="mb-1 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-default)] px-3">
                <SearchIcon size={16} className="shrink-0 text-[var(--color-icon-secondary)]" />
                <Command.Input id="activity-search-desktop" ref={activitySearchRef} value={activitySearch} onValueChange={setActivitySearch} aria-label="ابحث عن نشاط أو تخصص" placeholder="ابحث عن تصنيف أو نشاط فرعي أو تخصص" className="!min-h-0 min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0 text-[14px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
              </label>
              <Command.List>
                {renderActivityOptions(filteredActivities, pickedMain, clearActivitySelection, selectActivity)}
                {renderActivitySearchMatches()}
              </Command.List>
            </Command>
          </div>, document.body,
        )) : null}
      </div>
      {pickedMain ? (
        <>
        <div role="group" aria-label="الأنشطة الفرعية وعدد الشوارع لكل نشاط" aria-describedby={mobile && pickedSubs.length > 2 ? 'street-subactivities-scroll-hint' : undefined} className={mobile ? '-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1' : 'flex flex-wrap gap-1.5'}>
          {pickedSubs.map((x) => {
            const on = streetPick.kind === 'sub' && streetPick.ids.map(String).includes(String(x.sub_id)) || streetPick.kind === 'spec' && streetPick.subId === String(x.sub_id)
            return <Chip key={String(x.sub_id)} className="shrink-0" label={`${x.sub_ar} · ${n(x.streets)} شارع`} selected={on} onClick={() => { recordMapInteraction(on ? 'map_activity_clear' : 'map_activity_sub_select'); setStreetPick(on ? { kind: 'main', id: pickedMain } : { kind: 'sub', ids: [x.sub_id], main: pickedMain }); pickFocus(on ? { level: 'main', id: pickedMain } : { level: 'sub', id: String(x.sub_id) }) }} />
          })}
        </div>
        </>
      ) : null}
      {streetPick.kind === 'q' ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">الشوارع حسب طلبك: «{streetPick.q}»</p> : null}
      {streetPick.kind === 'spec' ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">المنشآت وعدادات الأحياء تُصفّى على التخصص «{streetPick.name}». {marketSpecialtyAvailable === false ? 'الخدمة أو نسخة الدليل لا تدعم العد الدقيق لهذا التخصص؛ أخفينا الأعداد والخطوط العامة حتى لا تبدو مطابقة.' : 'خطوط الشوارع لا تظهر إلا إذا كان مصدرها يفصل هذا التخصص.'}</p> : null}
    </div>
  ) : null
  const densePanel = denseList.length || activityPicker || topDistricts.length || filters.role || filters.specialty || filters.street || focus?.level === 'spec' && (specialtyFocusResolving || specialtyFocusResolveError) ? (
    <section aria-labelledby="dense-title" className="flex flex-col gap-2 border-b border-[var(--color-border-default)] px-5 py-3">
      <h2 id="dense-title" className="flex items-center gap-2 text-[14px] leading-[22px] font-semibold"><StreetIcon size={18} className="text-[var(--color-icon-secondary)]" />أكثر الشوارع كثافة في {where}</h2>
      <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
        {hasTargetQuery || buyerProductMode
          ? 'اختر شارعاً من القائمة أو الخريطة لتضييق النتائج. كثافة الشارع لا تثبت ملاءمة كل منشأة لما تبحث عنه.'
          : 'اختر نشاطاً أو اضغط شارعاً أو حياً لاستعراض المنشآت. الكثافة توضّح تجمع المنشآت، ولا تثبت ملاءمتها لما تبحث عنه.'}
      </p>
      {activityPicker}
      {dense?.basis ? <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{dense.basis}</p> : null}
      {denseList.length ? (
        <ol className="flex flex-col" data-testid="dense-streets">
          {topStreets(denseList).map((st, i) => (
            <li key={st.id}>
              <button type="button" disabled={busy} aria-pressed={activeStreetId === st.id} onClick={() => pickStreet(st.id)}
                className={`fi-host flex w-full items-start gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-start text-[14px] leading-[22px] hover:bg-[var(--color-bg-surface-2)] disabled:opacity-60 ${activeStreetId === st.id ? 'bg-[var(--color-bg-primary-subtle)] font-medium' : ''} ${FOCUS_RING}`}>
                <span aria-hidden className="w-4 pt-0.5 text-center text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2">{streetLine(st)} — {n(st.props.n)} منشأة</span>
                  <span className="text-[12px] leading-[18px] tabular-nums text-[var(--color-text-secondary)]">{fmtMeters(st.props.length_m)} · {formatNumber(st.props.per_100m, { maximumFractionDigits: 1 })} منشأة لكل 100 م</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : filters.specialty && filterSpecialtyResolving ? <p role="status" className="text-[13px] leading-[20px] text-[var(--color-text-secondary)]">نطابق التخصص مع بيانات الشوارع قبل عرض أي خطوط…</p> : filters.specialty && (filterSpecialtyResolveError || specialtyScopeConflict) ? <p role="alert" className="text-[13px] leading-[20px] text-[var(--color-text-danger)]">تعذر مطابقة التخصص مع طبقة الشوارع بدقة؛ أخفينا الخطوط العامة حتى لا تظهر كأنها تطابقه.</p> : filters.role ? <p className="text-[13px] leading-[20px] text-[var(--color-text-secondary)]">مصدر كثافة الشوارع لا يفصل حسب دور المنشأة. تبقى قائمة المنشآت مفلترة، وأخفينا خطوط الشوارع العامة.</p> : filters.street && dense ? <p className="text-[13px] leading-[20px] text-[var(--color-text-secondary)]">طبقة كثافة الشوارع الحالية لا تتضمن شارع «{filters.street}»؛ أبقينا الفلتر على قائمة المنشآت فقط.</p> : focus?.level === 'spec' && specialtyFocusResolving ? <p role="status" className="text-[13px] leading-[20px] text-[var(--color-text-secondary)]">نطابق التخصص مع التصنيف الدقيق قبل تحديث كثافة الشوارع…</p> : focus?.level === 'spec' && specialtyFocusResolveError ? <p role="alert" className="text-[13px] leading-[20px] text-[var(--color-text-danger)]">ما قدرنا نطابق هذا التخصص مع بيانات الشوارع؛ أخفينا الخطوط حتى لا نعرض نشاطاً أوسع على أنه مطابق.</p> : denseLoadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-text-danger)]">
          <WarningIcon size={16} />
          <span className="min-w-0 flex-1">تعذر تحميل كثافة الشوارع. هذا لا يعني عدم وجود شوارع كثيفة.</span>
          <button type="button" onClick={retryStreetDensity} className={`shrink-0 underline ${FOCUS_RING}`}>إعادة المحاولة</button>
        </div>
      ) : dense && selectedSpecialtyIds.length && dense.specialty_available === false ? <p className="text-[13px] leading-[20px] text-[var(--color-text-secondary)]">مصدر الشوارع الحالي لا يفصل هذا التخصص؛ أخفينا خطوط النشاط الأوسع.</p> : dense && streetPick.kind === 'spec' && dense.specialty_available === false ? <p className="text-[13px] leading-[20px] text-[var(--color-text-secondary)]">ما عندنا حالياً طبقة شوارع مفصلة لهذا التخصص. أوقفنا خطوط النشاط الفرعي حتى لا تظهر كأنها نتيجة دقيقة.</p> : dense ? <p className="text-[13px] leading-[20px] text-[var(--color-text-secondary)]">ما فيه شوارع كثيفة بهذا الاختيار. جرّب نشاطاً آخر أو أحياء أوسع.</p> : <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">نحسب أكثف الشوارع…</p>}
      {topDistricts.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">أكثر الأحياء بهذا النشاط</p>
          <div role="group" aria-label="أكثر الأحياء" className="flex flex-wrap gap-1.5">
            {topDistricts.map((d) => {
              const dist = districts.find((x) => x.ar === d.name)
              return dist ? <Chip key={d.name} className="shrink-0" icon={DistrictIcon} label={`${d.name} · ${n(d.n)}`} selected={chosenD.has(dist.id)} onClick={() => toggleDistrict(dist.id)} /> : null
            })}
          </div>
        </div>
      ) : null}
    </section>
  ) : null
  const clusterList = clusterTop.length ? (
    <details open className="group border-b border-[var(--color-border-default)] px-5 py-3">
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 text-[14px] leading-[22px] font-medium ${FOCUS_RING}`}>
        <span className="flex items-center gap-2"><ClustersIcon size={18} className="text-[var(--color-icon-secondary)]" />{denseList.length ? 'تجمعات أخرى' : 'تجمعات هذا النشاط'}</span>
        <Icon name="chevron-down" size={16} className="text-[var(--color-icon-secondary)] transition-transform group-open:rotate-180" />
      </summary>
      {clusters?.basis ? <p className="mt-1 text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{clusters.basis}</p> : null}
      <ul className="mt-2 flex flex-col">
        {clusterTop.map((c, i) => {
          const on = Boolean(c.district_ar && filters.district === c.district_ar && (c.level !== 'street' || filters.street === c.street_ar))
          return (
            <li key={`${c.level}|${c.district_ar}|${c.street_ar}|${i}`}>
              <button type="button" disabled={busy} aria-pressed={on} onClick={() => pickCluster(c)}
                className={`fi-host flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-start text-[14px] leading-[22px] hover:bg-[var(--color-bg-surface-2)] disabled:opacity-60 ${on ? 'bg-[var(--color-bg-primary-subtle)] font-medium' : ''} ${FOCUS_RING}`}>
                {c.level === 'street' ? <StreetIcon size={16} /> : <DistrictIcon size={16} />}
                <span className="min-w-0 flex-1 truncate">{clusterText(c)}</span>
                {c.wholesale_pct >= 30 ? <span className="rounded-full border border-[var(--map-sand)] bg-[color-mix(in_srgb,var(--map-sand)_25%,white)] px-2 text-[12px] leading-[18px] font-medium">جملة</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  ) : null

  const toggle = (r: TargetRow) => {
    if (busy || failedResultRefresh || !waNumber(r)) return
    recordMapInteraction(selected.has(r.poi_key) ? 'map_supplier_remove' : 'map_supplier_add')
    setSelected((s) => { const x = new Set(s); if (x.has(r.poi_key)) x.delete(r.poi_key); else x.add(r.poi_key); return x })
    setSelectedRows((current) => { const next = new Map(current); if (next.has(r.poi_key)) next.delete(r.poi_key); else next.set(r.poi_key, r); return next })
  }
  const loadedWholesaleRows = visibleCohort.filter(isTaggedWholesaleRow)
  const selectableWholesaleRows = loadedWholesaleRows.filter((row) => waNumber(row) && !selected.has(row.poi_key))
  const loadedContactableRows = visibleCohort.filter((row) => waNumber(row))
  const selectableLoadedContactableRows = loadedContactableRows.filter((row) => !selected.has(row.poi_key))
  const selectLoadedWholesaleCandidates = () => {
    if (!selectableWholesaleRows.length) return
    setSelected((current) => new Set([...current, ...selectableWholesaleRows.map((row) => row.poi_key)]))
    setSelectedRows((current) => new Map([...current, ...selectableWholesaleRows.map((row) => [row.poi_key, row] as const)]))
    setNotice(`تم تحديد ${n(selectableWholesaleRows.length)} مورداً موسوماً بالجملة من النتائج المحمّلة ولديه إشارة واتساب برقم صالح. راجع قائمة الحملة قبل أي إرسال.`)
  }
  const selectLoadedContactableCandidates = () => {
    if (!selectableLoadedContactableRows.length) return
    setSelected((current) => new Set([...current, ...selectableLoadedContactableRows.map((row) => row.poi_key)]))
    setSelectedRows((current) => new Map([...current, ...selectableLoadedContactableRows.map((row) => [row.poi_key, row] as const)]))
    recordMapInteraction('map_supplier_candidate_batch_add')
    setNotice(`أُضيف ${n(selectableLoadedContactableRows.length)} مرشحاً من النتائج المحمّلة إلى قائمة الحملة للمراجعة. ليسوا جميعاً مؤكدين للبيع بالجملة، ولم يُرسل شيء.`)
  }
  const commitMultiSelection = () => {
    if (!multiPending.size) return
    setSelected((current) => new Set([...current, ...multiPending.keys()]))
    setSelectedRows((current) => new Map([...current, ...multiPending]))
    setMultiPending(new Map())
    setNotice(`أُضيف ${n(multiPending.size)} منشأة إلى قائمة الحملة للمراجعة. لم يُرسل شيء.`)
  }
  const approved = tpl?.status === 'APPROVED'
  const holder = tpl?.holder?.holder_rfq_id || null
  const templateBlock = !message.trim() ? 'اكتب نص الرسالة' : tplError ? 'تعذّر التحقق من حالة القالب' : !tpl ? 'جارٍ التحقق من القالب…' : template === OUTREACH_TEMPLATE && !approved ? `القالب ${OUTREACH_TEMPLATE} غير معتمد من Meta (${tpl.status})` : template !== OUTREACH_TEMPLATE && !templates.some((t) => t.name === template && t.status === 'APPROVED') ? 'القالب غير معتمد من Meta' : null
  const marketingBlock = null
  const refreshBlock = busy ? 'جارٍ تحديث النتائج؛ انتظر اكتمال البحث قبل اختيار المنشآت أو الإرسال.' : failedResultRefresh ? 'تعذّر تحديث النتائج؛ لا ترسل الاختيار الحالي حتى تعيد المحاولة أو ترجع إلى النتائج السابقة.' : null
  const sendBlock = objective === 'marketing'
    ? refreshBlock || (!chosen.length ? 'حدد جهة وحدة على الأقل' : null)
    : refreshBlock || marketingBlock || (!chosen.length ? 'حدد جهة وحدة على الأقل' : templateBlock || (!holder ? 'ما فيه طلب حاضن للردود' : null))
  const scheduleBlock = refreshBlock || marketingBlock || (!chosen.length ? 'حدد جهة وحدة على الأقل' : templateBlock)
  const cost = price != null ? (chosen.length * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
  const templateBadge = approved || template !== OUTREACH_TEMPLATE ? { tone: 'Success' as const, label: 'قالب واتساب معتمد' } : tpl ? { tone: 'Warning' as const, label: `القالب: ${tpl.status}` } : tplError ? { tone: 'Danger' as const, label: 'حالة القالب غير معروفة' } : null
  // drafts live in this page only (owner: nothing on the device); a reload clears them
  const saveDraft = () => {
    setConfirming(false)
    setNotice(`أبشر، الحملة محفوظة كمسودة في هذه الصفحة (${n(chosen.length)} موردين). ترسلها بضغطة لما يتفعّل الإرسال؛ تحديث الصفحة يمسحها.`)
  }

  const assistantPurpose = (text: string) => {
    if (/طلبات|عرض سعر|مورد|شراء|مشتريات/.test(text)) return 'التعرّف على فرق ومقارنة خيارات الشراء'
    if (/زيارة|تجربة|اشتراك|تسجيل/.test(text)) return 'دعوة مناسبة للتعرّف على الخدمة'
    return 'التعرّف على فرق وبدء متابعة يدوية للمهتمين'
  }

  const assistantFallbackTarget = (text: string) => {
    const groups: Array<[RegExp, string]> = [
      [/مقاول|بناء|تشطيب|حديد|سباك|كهربائ/, 'شركات المقاولات والبناء والتشطيب'],
      [/مطعم|مقهى|كافيه|أغذية|تموين/, 'المطاعم والمقاهي ومنشآت الأغذية'],
      [/بقال|تجزئة|متجر|سوبر/, 'تجار التجزئة والبقالات'],
      [/مصنع|صناع/, 'المصانع والمنشآت الصناعية'],
      [/عياد|طبي|صحة/, 'العيادات والمنشآت الصحية'],
      [/عقار|مكتب عقار/, 'مكاتب وشركات العقار'],
    ]
    return groups.find(([pattern]) => pattern.test(text))?.[1]
      || text.replace(/(?:ابي|أبي|ابغى|أبغى|استهدف|استهداف|الشريحة|العملاء|المنشآت|الشركات|الغاية|الهدف|الحملة|واتساب|في الرياض|في جدة|في الدمام)/g, ' ').replace(/\s+/g, ' ').trim()
      || 'منشآت أعمال مناسبة'
  }

  const understandAssistantPrompt = async (prompt: string): Promise<TargetingAssistantPlan> => {
    // Uses the live directory analyzer. When ANTHROPIC_API_KEY is present in the targeting service,
    // this invokes its model parser; otherwise the service states its deterministic fallback in `parsed`.
    // Keep this request on the same production-safe page size as the map search.
    // The targeting service validates the range before invoking its analyzer.
    try {
      const analysis = await searchTargets(prompt.slice(0, 120), city, 30, 'marketing')
      const parsed = analysis.parsed || {}
      const target = parsed.seller_label || (parsed.keywords || []).filter(Boolean).slice(0, 3).join('، ') || assistantFallbackTarget(prompt)
      return { target, purpose: assistantPurpose(prompt), prompt, source: 'directory', seed: analysis }
    } catch {
      // The draft search below remains the authority. This path lets a temporary
      // analyzer outage never strand a user before reviewing a draft.
      return { target: assistantFallbackTarget(prompt), purpose: assistantPurpose(prompt), prompt, source: 'fallback' }
    }
  }

  const prepareAssistantDraft = async (plan: TargetingAssistantPlan) => {
    if (preparingMarketing) throw new Error('BUSY')
    setObjective('marketing'); setLens('buyers'); setQ(plan.target)
    // The analysis request already loaded a small, reviewable cohort. Reuse it
    // instead of blocking the screen with the same directory lookup a second time.
    const seed = plan.seed
    let total: number | null
    if (seed?.rows?.length) {
      generation.current += 1
      setError(null); setFailedResultRefresh(false); setNotice(null); setProfile(null)
      lastSearchRows.current = seed.rows
      lastSuccessfulQueryObjective.current = 'marketing'
      setTab('results'); setRes(seed); setQuery(plan.target); setShown(PAGE); setAreaFilters({})
      setSelected(new Set()); setSelectedRows(new Map()); setMultiIntents([]); setMultiPending(new Map()); setBuyerProductGroups([])
      setChosenD(new Set()); setMapScope('city'); setFocus(null); setShowUnlocated(false)
      total = seed.total
    } else {
      // A fallback understanding has no preloaded cohort, so it performs one
      // bounded live lookup. The user can stop it immediately if it is slow.
      setRes(null); lastSearchRows.current = []; setSelected(new Set()); setSelectedRows(new Map())
      total = await runSearchIn(plan.target, city, undefined, 'marketing')
    }
    if (total === null) throw new Error('SEARCH_FAILED')
    const rows = lastSearchRows.current.filter((row) => Boolean(waNumber(row))).slice(0, 50)
    if (!rows.length) throw new Error('NO_WHATSAPP_RESULTS')
    const phones = rows.map(waNumber).filter((phone): phone is string => Boolean(phone))
    setSelected(new Set(rows.map((row) => row.poi_key)))
    setSelectedRows(new Map(rows.map((row) => [row.poi_key, row] as const)))
    setPreparingMarketing(true)
    try {
      const campaign = await prepareMarketingCampaign({
        name: `حملة فرق · ${cityName(city)} · ${plan.target}`.slice(0, 160),
        segment: 'B2B_MARKETING',
        phones,
        consentRecordedAt: new Date().toISOString(),
        consentSource: 'موافقة مسبقة أعلنها مالك الحملة عند إعداد الدفعة',
      })
      setPreparedCampaignId(campaign.id)
      setNotice(`أُضيفت ${n(phones.length)} منشأة إلى مسودة حملة واتساب. راجعها قبل الإرسال.`)
      return { count: phones.length, campaignId: campaign.id }
    } finally { setPreparingMarketing(false) }
  }

  const prepareWhatsAppCampaign = async () => {
    if (preparingMarketing || !chosen.length) return
    const phones = chosen.map(waNumber).filter((phone): phone is string => Boolean(phone))
    if (!phones.length) return
    setPreparingMarketing(true)
    try {
      const campaign = await prepareMarketingCampaign({
        name: `حملة فرق · ${cityName(city)} · ${query || 'استهداف السوق'}`.slice(0, 160),
        segment: 'B2B_MARKETING',
        phones,
        consentRecordedAt: new Date().toISOString(),
        consentSource: 'موافقة مسبقة أعلنها مالك الحملة عند إعداد الدفعة',
      })
      setPreparedCampaignId(campaign.id)
      setNotice(`أُضيفت ${n(phones.length)} منشأة إلى مسودة حملة واتساب. راجعها قبل الإرسال.`)
    } catch {
      setNotice('تعذّر حفظ مسودة حملة واتساب. تأكد من صلاحية الحساب ثم أعد المحاولة.')
    } finally { setPreparingMarketing(false) }
  }

  const resultCard = (r: TargetRow) => {
    const ch = channelOf(r), can = ch === 'WhatsAppSource', on = selected.has(r.poi_key), name = safeName(r)
    const locationNotes = [!hasPoint(r) ? (site ? 'موقع تقريبي · المسافة غير معروفة' : 'موقع تقريبي') : null, r.district_reliable === false ? 'الحي غير مؤكد' : null].filter(Boolean)
    return (
      <li key={r.poi_key} data-key={r.poi_key} onPointerEnter={(event) => { if (event.pointerType === 'mouse' && hasPoint(r)) setHighlightedPinKey(r.poi_key) }} onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHighlightedPinKey((key) => key === r.poi_key ? null : key) }} onFocusCapture={() => { if (hasPoint(r)) setHighlightedPinKey(r.poi_key) }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHighlightedPinKey((key) => key === r.poi_key ? null : key) }} className="border-b border-[var(--color-border-default)]">
        <div className={`flex flex-row items-start gap-3 px-4 py-3 ${profile === r.poi_key ? 'bg-[var(--color-bg-surface-2)]' : 'hover:bg-[var(--color-bg-surface-2)]'}`}>
          <input type="checkbox" checked={on} disabled={!can || busy || failedResultRefresh} onChange={() => toggle(r)} aria-label={`اختر ${name} للحملة`} title={busy ? 'انتظر اكتمال تحديث النتائج' : failedResultRefresh ? 'أعد تحديث النتائج قبل اختيار المنشآت' : can ? undefined : ch === 'Email' ? 'الحملة على واتساب فقط' : 'لا توجد إشارة واتساب برقم صالح'}
            className={`mt-1 size-5 shrink-0 accent-[var(--map-ink)] disabled:opacity-50 ${FOCUS_RING}`} />
          <button type="button" disabled={busy || failedResultRefresh} onClick={() => { recordMapInteraction('map_profile_open'); recordMapInteraction('map_result_profile_open'); recordMapInteraction(mapResultProfileOpenEvent(objective)); setProfile(r.poi_key) }} className={`flex min-w-0 flex-1 flex-col gap-1 text-start disabled:cursor-wait disabled:opacity-60 ${FOCUS_RING}`}>
            <span className={`truncate text-[15px] leading-[24px] font-semibold ${ch === 'Unreachable' ? 'text-[var(--color-text-secondary)]' : ''}`}>{name}</span>
            {pathOf(r) ? <span className="truncate text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{pathOf(r)}</span> : null}
            <RowBadges r={r} />
            {sourceCountOf(r) === 1 ? <Badge tone="Neutral" showDot={false} label="مصدر مسجل واحد" className="w-fit text-[11px] leading-[16px] px-2 py-0.5" /> : null}
            <span className="truncate text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{placeOf(r, cities) || '—'}{locationNotes.length ? ` · ${locationNotes.join(' · ')}` : ''}</span>
          </button>
          <span className="flex shrink-0 flex-col items-end gap-1"><ChannelBadge channel={ch} />{statusBadge(r)}{fitBadge(r)}<SaudiEstablishmentBadge evidence={r} /></span>
        </div>
      </li>
    )
  }
  const resultsContent = !res ? (
    <p className="px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{busyKind === 'browse' ? 'جارٍ تحميل سوق المدينة…' : busyKind === 'more' ? 'جارٍ تحميل منشآت إضافية…' : busyKind === 'search' ? 'جارٍ البحث…' : objective === 'marketing' ? 'اكتب تخصصك مثل «مواد سباكة» أو ارفع كتالوجك، ثم اختر حياً على الخريطة.' : 'اكتب المنتج أو الخدمة (مثل: حدايد وبويات)، واختر المدينة، واضغط ابحث. ثم اختر حياً على الخريطة لعرض منشآته.'}</p>
  ) : multiIntents.length ? (
    <div className="flex flex-col gap-3 p-3" aria-label="مراجعة نتائج الطلبات المتعددة">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] p-3">
        <p className="m-0 min-w-0 flex-1 text-[14px] leading-[22px]">راجع النتائج لكل طلب، ثم أضف المختار إلى قائمة الحملة. لا يتم الإرسال هنا.</p>
        <Button variant="Primary" size="S" disabled={!multiPending.size || busy} onClick={commitMultiSelection}>أضف المحدد للحملة · {n(multiPending.size)}</Button>
      </div>
      {multiIntents.map(({ intent, rows: intentRows, total, nextOffset, excludedCount }, index) => {
        const available = intentRows.filter((row) => waNumber(row) && !selected.has(row.poi_key))
        const allChecked = available.length > 0 && available.every((row) => multiPending.has(row.poi_key))
        return (
          <section key={`${intent.activity}|${intent.district}`} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-default)]" aria-label={`${intent.activity} في حي ${intent.district}`}>
            <div className="flex flex-wrap items-center gap-2 bg-[var(--color-bg-surface-2)] px-3 py-2">
              <h3 className="m-0 min-w-0 flex-1 text-[14px] font-semibold">{intent.activity} · حي {intent.district}</h3>
              <span className="text-[12px] text-[var(--color-text-secondary)]">{n(intentRows.length)} معروضة من {n(total)}</span>
              {excludedCount ? <span className="text-[11px] text-[var(--color-text-tertiary)]" title="لم يظهر وصف الحلاقة في اسم المنشأة">استُبعدت {n(excludedCount)} لعدم وضوح التخصص</span> : null}
              {nextOffset != null ? <Button variant="Ghost" size="S" disabled={busy} loading={busyKind === 'more'} loadingLabel="نحمّل…" onClick={() => void loadMoreIntent(index)}>حمّل المزيد</Button> : null}
              <button type="button" disabled={!available.length || busy} onClick={() => setMultiPending((current) => {
                const next = new Map(current)
                if (allChecked) available.forEach((row) => next.delete(row.poi_key))
                else available.forEach((row) => next.set(row.poi_key, row))
                return next
              })} className={`rounded-full border border-[var(--color-border-default)] px-3 py-1 text-[12px] font-medium disabled:opacity-50 ${FOCUS_RING}`}>{allChecked ? 'إلغاء اختيار الطلب' : 'اختر القابل للإضافة'}</button>
            </div>
            {intentRows.length ? <ul className="m-0 list-none p-0">{intentRows.map((row) => {
              const channel = channelOf(row)
              const inCampaign = selected.has(row.poi_key)
              const checked = inCampaign || multiPending.has(row.poi_key)
              return <li key={row.poi_key} className="flex items-start gap-3 border-t border-[var(--color-border-default)] px-3 py-2.5">
                <input type="checkbox" checked={checked} disabled={busy || inCampaign || channel !== 'WhatsAppSource'} onChange={() => setMultiPending((current) => {
                  const next = new Map(current)
                  if (next.has(row.poi_key)) next.delete(row.poi_key)
                  else next.set(row.poi_key, row)
                  return next
              })} aria-label={`اختر ${safeName(row)} من ${intent.activity} في ${intent.district}`} className={`mt-1 size-5 shrink-0 accent-[var(--map-ink)] ${FOCUS_RING}`} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[14px] font-semibold">{safeName(row)}</p>
                  <p className="m-0 truncate text-[12px] text-[var(--color-text-secondary)]">{placeOf(row, cities) || `حي ${intent.district}`}{row.district_reliable === false ? ' · الحي غير مؤكد' : ''}</p>
                  {inCampaign ? <span className="text-[11px] text-[var(--color-text-success)]">مضافة للحملة</span> : channel !== 'WhatsAppSource' ? <span className="text-[11px] text-[var(--color-text-tertiary)]">لا توجد إشارة واتساب من المصدر</span> : null}
                </div>
                <ChannelBadge channel={channel} />
              </li>
            })}</ul> : <p className="m-0 px-3 py-4 text-[13px] text-[var(--color-text-secondary)]">ما لقينا منشآت لهذا الطلب.</p>}
          </section>
        )
      })}
    </div>
  ) : !visibleCohort.length ? (
    <div className="px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
      <p>{cohort.length ? 'ما فيه منشآت بهذا التقدير ضمن النتائج الحالية.' : rows.length ? 'ما فيه منشآت هنا مع الأحياء أو التضييق المختار. وسّع الاختيار أو شِل أحد المرشحات.' : filters.district || filters.street || filters.wholesale || filters.role || filters.specialty || filters.contact ? 'ما فيه جهات بهذا الوصف مع التضييق المختار. شِل أحد المرشحات فوق.' : 'ما لقينا جهات بهذا الوصف. جرّب كلمة ثانية أو مدينة أوسع.'}</p>
      {cohort.length && fitFilter !== 'all' && fitCounts.unknown > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span>فيه {n(fitCounts.unknown)} منشأة بدون تقدير نموذجي؛ قد تظل مطابقة لنشاطها.</span>
          <Button variant="Ghost" size="S" onClick={() => {
            setFitFilter('unknown')
            setShown(PAGE)
            recordMapInteraction('fit_filter_unknown')
          }}>اعرض بدون تقدير نموذجي</Button>
        </div>
      ) : null}
      {cohort.length && fitFilter !== 'all' ? <button type="button" className={`mt-2 block font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`} onClick={() => setFitFilter('all')}>عرض كل النتائج</button> : null}
    </div>
  ) : (
    <div aria-busy={busy}>
      {busy ? <p role="status" className="mx-3 mt-3 rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-[12px] leading-[19px] text-[var(--color-text-secondary)]">{buyerProductProgress ? `نبحث عن المشترين لـ ${n(buyerProductProgress.completed)} من ${n(buyerProductProgress.total)} منتج…` : 'جارٍ تحديث النتائج. ستتمكن من اختيار المنشآت بعد اكتمال البحث.'}</p> : null}
      {buyerProductMode ? <section className="mx-3 mt-3 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] p-3" aria-label="مطابقة منتجاتك مع المشترين">
        <p className="m-0 text-[13px] leading-[21px] font-medium">مرشحو المشترين جُمِعوا من منتجاتك المحفوظة. المطابقة حسب النشاط المسجل وليست تأكيداً لنية الشراء.</p>
        <ul className="mt-2 flex flex-col gap-2 p-0">
          {buyerProductGroups.map((group, index) => <li key={`${group.name}-${index}`} className="flex flex-wrap items-center gap-2 text-[12px] leading-[18px]">
            <span className="min-w-0 flex-1 truncate">{group.name} · {n(group.rows.length)} من {n(group.total)}</span>
            {group.nextOffset != null ? <Button variant="Ghost" size="S" disabled={busy} loading={busyKind === 'more'} loadingLabel="نحمّل…" onClick={() => void loadMoreBuyerProduct(index)}>حمّل المزيد</Button> : <span className="text-[var(--color-text-tertiary)]">اكتمل التحميل</span>}
          </li>)}
        </ul>
      </section> : null}
      {objective === 'purchase' && isWholesaleRequest(query) ? (
        <div className="mx-3 mt-3 flex flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] p-3">
          <p className="m-0 text-[12px] leading-[19px] text-[var(--color-text-secondary)]">نتائج البحث مرشحون بحسب النشاط، وليست تأكيداً أن المنشأة تبيع بالجملة. إشارة واتساب من سجل الدليل مع رقم صالح، ولا تؤكد أن الرقم نشط. اختر الموسومين بالجملة فقط لفلترة أدق، أو أضف نتائج الدفعة المطابقة للمرشحات الحالية وذات الإشارة للمراجعة. {res.has_more ? `الاختيار يقتصر على الدفعة الحالية (${n(rows.length)} من ${n(res.total)})؛ حمّل المزيد ثم أعد الاختيار لبقية النتائج.` : 'تم تحميل جميع النتائج.'} لا يحدث إرسال أو جدولة عند الاختيار.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="Secondary" size="S" disabled={busy || failedResultRefresh || !selectableWholesaleRows.length} onClick={selectLoadedWholesaleCandidates}>اختر الموسومين بالجملة · {n(selectableWholesaleRows.length)}</Button>
            <Button variant="Secondary" size="S" disabled={busy || failedResultRefresh || !selectableLoadedContactableRows.length} onClick={selectLoadedContactableCandidates}>أضف المرشحين المحمّلين للمراجعة · {n(selectableLoadedContactableRows.length)}</Button>
          </div>
        </div>
      ) : null}
      <ul>
        {visibleListCohort.slice(0, shown).map(resultCard)}
        {shown < visibleListCohort.length ? <li className="px-4 py-3"><Button variant="Ghost" size="S" onClick={() => setShown((s) => s + PAGE)}>اعرض {n(Math.min(PAGE, visibleListCohort.length - shown))} أكثر</Button></li> : null}
        {truncated && shown >= visibleCohort.length ? (
          <li className="flex flex-row items-center justify-between gap-3 px-4 py-3">
            <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{hasTargetQuery ? `معروض ${n(rows.length)} من ${n(res.total)} — الأقرب للوصف أولًا.` : `معروض ${n(rows.length)} من ${n(res.total)} من سجلات الدليل العام.`}</span>
            <Button variant="Ghost" size="S" disabled={busy} loading={busyKind === 'more'} loadingLabel="نحمّل…" onClick={() => void loadMore()}>حمّل {n(Math.min(FETCH, res.total - rows.length))} أكثر</Button>
          </li>
        ) : null}
      </ul>
    </div>
  )
  const unlocatedPanel = res && (unlocatedRows.length || (res.located_total != null && res.total > res.located_total)) ? (
    <section className="border-t border-[var(--color-border-default)] px-4 py-3" aria-label="منشآت بلا دبوس" data-testid="site-unlocated-results">
      <div className="flex flex-wrap items-center gap-2 text-[13px] leading-[21px]">
        <p className="m-0 flex-1 text-[var(--color-text-secondary)]">
          {site ? 'نطاق التوصيل يحسب المنشآت ذات الإحداثيات الدقيقة فقط. ' : 'هذه المنشآت بلا إحداثيات دقيقة، لذلك لا يظهر لها دبوس على الخريطة. '}{unlocatedRows.length
            ? `يوجد ${n(unlocatedRows.length)} من النتائج المحمّلة بلا دبوس؛ لا يمكن تحديد قربها من موقع المشروع.`
            : 'توجد نتائج بلا دبوس في البحث، لكن لا توجد منها في الدفعة المحمّلة حالياً.'}
        </p>
        {unlocatedRows.length ? (
          <Button variant="Ghost" size="S" onClick={() => {
            setFitFilter('all')
            setShowUnlocated((value) => {
              const next = !value
              recordMapInteraction(next ? 'site_unlocated_show' : 'site_unlocated_hide')
              return next
            })
          }} aria-expanded={showUnlocated} aria-controls="site-unlocated-list">{showUnlocated ? 'إخفاء النتائج بلا دبوس' : `اعرض ${n(unlocatedRows.length)} بلا دبوس`}</Button>
        ) : null}
      </div>
      {showUnlocated && unlocatedRows.length ? (
        <ul id="site-unlocated-list" className="mt-2 rounded-[12px] border border-[var(--color-border-default)]" aria-label="نتائج مواقعها غير دقيقة">
          {unlocatedRows.slice(0, shown).map(resultCard)}
        </ul>
      ) : null}
      {showUnlocated && shown < unlocatedRows.length ? (
        <Button variant="Ghost" size="S" onClick={() => setShown((value) => value + PAGE)}>
          اعرض {n(Math.min(PAGE, unlocatedRows.length - shown))} أخرى بلا دبوس
        </Button>
      ) : null}
      {hasTargetQuery && truncated && !unlocatedRows.length ? (
        <Button variant="Ghost" size="S" disabled={busy} loading={busyKind === 'more'} loadingLabel="نحمّل…" onClick={() => void loadMore(true)}>
          حمّل الدفعة التالية للعثور على منشآت بلا دبوس
        </Button>
      ) : null}
    </section>
  ) : null
  const resultsBody = <div>{unlocatedPanel}{resultsContent}</div>
  const targetBrowsePrompt = lens === 'sellers'
    ? 'اكتب اسم منتج أو نشاط لعرض الموردين المطابقين، أو اختر شارعاً أخضر لتبدأ البحث بنشاطه.'
    : 'اكتب منتجاتك أو اختر نشاطاً من الشوارع الخضراء لعرض المشترين المحتملين.'
  const targetResultsPanel = showTargetResults ? resultsBody : (
    <section ref={searchPromptRef} className="mx-4 my-3 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-4 py-3" aria-live="polite" data-testid="map-search-prompt">
      <h2 className="m-0 text-[14px] font-semibold">{lens === 'sellers' ? 'ابدأ بالبحث عن مورد' : 'ابدأ باكتشاف المشترين'}</h2>
      <p className="mb-0 mt-1 text-[13px] leading-[21px] text-[var(--color-text-secondary)]">{targetBrowsePrompt}</p>
    </section>
  )
  const panelHead = (
    <div className="map-compact-results-panel-head flex flex-col gap-2 border-b border-[var(--color-border-default)] px-4 pt-3">
      {lens === 'buyers' ? (
        <div className="flex items-center justify-between gap-3 rounded-[12px] bg-[var(--color-bg-surface-2)] px-3 py-2">
          <div className="min-w-0">
            <p className="m-0 text-[13px] leading-[20px] font-semibold">تسوّق منتجاتك للمشترين</p>
            <p className="m-0 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{buyerProductMode
              ? 'تعرض اللوحة مرشحي منتجاتك المحفوظة؛ راجع نشاط المنشأة وبياناتها قبل التواصل.'
              : hasTargetQuery
                ? 'تعرض اللوحة الجهات المرتبطة ببحثك الحالي؛ أضف منتجات أخرى لمقارنة المرشحين.'
                : 'ابحث عن الجهات التي قد تحتاج نشاطك، أو أضف منتجاتك لتبدأ.'}</p>
          </div>
          <Button variant="Secondary" size="S" icon={UploadCatalogIcon} onClick={() => { recordMapInteraction('map_seller_add_products'); setStartOpen(true) }}>{buyerProductMode || hasTargetQuery ? 'أضف منتجاً آخر' : 'أضف منتجاتك'}</Button>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="اللوحة" className="flex gap-1 rounded-full bg-[var(--color-bg-surface-2)] p-1">
          {((mobile ? [['streets', 'الشوارع'], ['results', showTargetResults ? `المنشآت · ${n(visibleCohort.length)}` : 'ابدأ البحث'], ['guide', 'الدليل']] : [['results', showTargetResults ? `المنشآت · ${n(visibleCohort.length)}` : 'ابدأ البحث'], ['guide', 'الدليل']]) as [typeof tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k || (!mobile && tab === 'streets' && k === 'results')} onClick={() => setTab(k)}
              className={`rounded-full px-4 py-1.5 text-[14px] leading-[22px] font-medium ${tab === k ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--farq-button-shadow)]' : 'text-[var(--color-text-secondary)]'} ${FOCUS_RING}`}>{l}</button>
          ))}
        </div>
        {showTargetResults && res && waInCohort ? (
          <button type="button" className={`text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] hover:underline ${FOCUS_RING}`}
            onClick={() => {
              if (chosen.length) { setSelected(new Set()); setSelectedRows(new Map()) }
              else {
                recordMapInteraction('fit_supplier_selection')
                const picked = visibleCohort.filter((row) => pickForFit(visibleCohort, fitFilter).has(row.poi_key))
                setSelected(new Set(picked.map((row) => row.poi_key)))
                setSelectedRows(new Map(picked.map((row) => [row.poi_key, row])))
              }
            }}>
            {chosen.length ? 'إلغاء التحديد' : fitFilter === 'likely' || (fitFilter === 'all' && hasAiInVisibleCohort) ? 'حدد المناسبين' : mobile ? 'حدد واتساب' : 'حدد اللي عندهم واتساب'}
          </button>
        ) : null}
      </div>
      {showTargetResults && res ? (
        <p className="pb-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
          {buyerProductMode
            ? `المرشحون من منتجاتك: تعرض القائمة ${n(Math.min(shown, visibleListCohort.length))} من ${n(visibleListCohort.length)} منشأة محمّلة. عدد المطابقات لكل منتج موضح أعلاه.`
            : hasTargetQuery
              ? `القائمة تعرض ${n(Math.min(shown, visibleListCohort.length))} من ${n(visibleListCohort.length)} منشأة محمّلة · ${n(res.total)} نتيجة مطابقة إجمالاً`
            : `دليل المدينة: تعرض القائمة ${n(Math.min(shown, visibleListCohort.length))} من ${n(visibleListCohort.length)} منشأة محمّلة · ${n(res.total)} سجل مرصود في الدليل. هذه ليست ترشيحات مؤكدة للمشترين؛ أضف منتجاتك لفرز الجهات حسب ملاءمتها.`}
          {chosenNames.length ? ` · داخل ${n(chosenNames.length)} ${chosenNames.length === 1 ? 'حي' : 'أحياء'} مختارة` : ' · اختر حياً على الخريطة لتضييق النتائج'}
          {focus ? ` · ${focus.level === 'main' ? mainAr(focus.id) : focus.level === 'sub' ? subAr(focus.id) || '' : focus.id}` : ''}
          {approxCount ? ` · ${n(approxCount)} بموقع تقريبي (بلا دبوس)` : ''}
          {fitFilter !== 'all' ? <span> · تقدير الملاءمة للفرز فقط</span> : null}
          {focus ? <button type="button" onClick={() => pickFocus(null)} className={`ms-2 font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>إلغاء الفرز</button> : null}
        </p>
      ) : null}
      {showUnconfirmedStatusNotice ? (
        <details onToggle={(event) => { if (event.currentTarget.open) recordMapInteraction('map_data_quality_notice_open') }} className="group mb-3 rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-3 py-1.5 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
          <summary className={`flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 font-medium ${FOCUS_RING}`}>
            <span className="flex min-w-0 items-center gap-1.5"><WarningIcon size={15} className="shrink-0" /><span>تنبيهات قبل التواصل</span></span>
            <Icon name="chevron-down" size={14} className="shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-1 border-t border-[var(--color-border-default)] py-2">
            {unconfirmedStatusCount > 0 ? <p className="m-0">حالة التشغيل غير مؤكدة لـ {n(unconfirmedStatusCount)} من {n(visibleCohort.length)} منشأة. تحقق من نشاطها قبل التواصل.</p> : null}
          </div>
        </details>
      ) : null}
    </div>
  )
  const marketSummaryPanel = (
    <section className="flex flex-col gap-3 border-b border-[var(--color-border-default)] px-4 py-4" aria-label="ملخص السوق">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{densityDistrictNames.length === 1 ? `ملخص حي ${densityDistrictNames[0]}` : densityDistrictNames.length > 1 ? `ملخص ${n(densityDistrictNames.length)} أحياء محددة` : `ملخص سوق ${cityName(city)}`}</h2>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">{marketLoading ? 'جارٍ التحديث…' : marketError ? 'بعض بيانات السوق غير متاحة' : 'حسب سجل الدليل الحالي'}</span>
      </div>
      {marketStats ? (
        <>
          <p className="m-0 text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
            بطاقات الخريطة تعرض عدد المنشآت والتصنيفات الرئيسية لهذا النطاق. أعداد الأنشطة للسجلات المصنفة بثقة عالية أو متوسطة، وقد يظهر السجل ضمن أكثر من نشاط. عدد واتساب من وسم الدليل، ولا يعني تحققاً مستقلاً من الرقم.
          </p>
        </>
      ) : marketLoading ? <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">نحمّل ملخص السوق…</p> : (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
          <span>تعذّر تحميل ملخص السوق.</span>
          <button type="button" onClick={retryMarketStats} className={`font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>أعد المحاولة</button>
        </div>
      )}
      {marketStats && marketError && !marketLoading ? (
        <div role="status" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
          <span>تعذّر تحميل بعض بيانات الأحياء.</span>
          <button type="button" onClick={retryMarketStats} className={`font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>أعد المحاولة</button>
        </div>
      ) : null}
      {marketStats?.densest_street ? <p className="rounded-[10px] bg-[var(--color-bg-surface-2)] px-3 py-2 text-[13px] leading-[20px]">أكثف شارع: <strong>{marketStats.densest_street.street_ar}</strong> · {marketStats.densest_street.district_ar || cityName(city)} · {n(marketStats.densest_street.n)} منشأة</p> : null}
    </section>
  )
  const marketPanel = mobile
    ? <>{densePanel || <p className="px-5 py-3 text-[13px] text-[var(--color-text-secondary)]">نحمّل الأحياء والشوارع والأنشطة…</p>}{marketSummaryPanel}</>
    : <>{marketSummaryPanel}{densePanel || <p className="px-5 py-3 text-[13px] text-[var(--color-text-secondary)]">نحمّل الأحياء والشوارع والأنشطة…</p>}</>
  const districtInsightPanel = insightDistrictNames.length ? (
    <section ref={districtInsightRef} className="flex flex-col gap-3 border-b border-[var(--color-border-default)] px-4 py-3" aria-label="ملخص أنشطة الأحياء">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold">ملخص {insightDistrictNames.length === 1 ? 'الحي' : 'الأحياء'}</h2>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">من كامل دليل الحي، وليس نتائج بحثك</span>
      </div>
      {districtInsightLoading ? <p role="status" className="m-0 text-[13px] text-[var(--color-text-secondary)]">نحلل توزيع الأنشطة في {n(insightDistrictNames.length)} {insightDistrictNames.length === 1 ? 'حي' : 'أحياء'}…</p> : null}
      {districtInsightRows.map((district) => {
        const hasReliableTotal = district.total > 0
        return <article key={district.district_ar} className="flex flex-col gap-2 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="m-0 text-[14px] font-semibold">حي {district.district_ar}</h3>
            <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{hasReliableTotal ? `${n(district.classified)} مصنّف من ${n(district.total)} سجل` : `${n(district.classified)} سجل مصنّف`}</span>
          </div>
          <p className="m-0 text-[13px] leading-[20px]">
            الأكثر ظهوراً: <strong>{district.dominant_activity?.main_ar || 'لا توجد بيانات مصنّفة'}</strong>{district.dominant_activity ? ` · ${n(district.dominant_activity.n)} سجل${district.classified > 0 ? ` (${n(Math.round(district.dominant_activity.n / district.classified * 100))}٪ من السجلات المصنّفة)` : ''}` : ''}
          </p>
          {district.dominant_activity?.top_subactivities?.length ? <div role="group" aria-label={`أبرز الأنشطة الفرعية في حي ${district.district_ar}`} className="flex flex-wrap items-center gap-1.5 text-[12px] leading-[19px] text-[var(--color-text-secondary)]"><span>أبرز الأنشطة الفرعية:</span>{district.dominant_activity.top_subactivities.map((item) => <button key={item.sub_id} type="button" aria-label={`تصفية خريطة حي ${district.district_ar} حسب ${item.sub_ar}، ${n(item.n)} سجل مصنف`} onClick={() => { recordMapInteraction('map_district_subactivity_select'); selectSubFromDistrictInsight(district.dominant_activity!.main_id, String(item.sub_id)) }} className={`rounded-full bg-[var(--color-bg-surface-2)] px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--color-bg-primary-subtle)] hover:text-[var(--color-text-info)] ${FOCUS_RING}`}>{item.sub_ar} · {n(item.n)}</button>)}</div> : null}
          {district.least_activity ? <p className="m-0 text-[12px] leading-[19px] text-[var(--color-text-secondary)]">الأقل بين الأنشطة المسجلة: {district.least_activity.main_ar} · {n(district.least_activity.n)} سجل</p> : null}
          {district.activities.length > 1 ? (() => {
            const districtKey = `${city}:${district.district_ar}`
            const expanded = expandedDistrictActivities.has(districtKey)
            const visibleActivities = expanded ? district.activities : district.activities.slice(0, 5)
            return <div className="flex flex-wrap gap-1.5" aria-label={`توزيع الأنشطة المسجلة في حي ${district.district_ar}`}>
              {visibleActivities.map((activity) => <button key={activity.main_id} type="button" aria-label={`تصفية خريطة حي ${district.district_ar} حسب ${activity.main_ar}، ${n(activity.n)} سجل مصنف`} onClick={() => { recordMapInteraction('map_district_activity_select'); selectMainFromCounter(activity.main_id) }} className={`rounded-full bg-[var(--color-bg-surface-2)] px-2.5 py-1 text-[11px] transition-colors hover:bg-[var(--color-bg-primary-subtle)] hover:text-[var(--color-text-info)] ${FOCUS_RING}`}>{activity.main_ar} · {n(activity.n)}</button>)}
              {district.activities.length > 5 ? <button
                type="button"
                aria-expanded={expanded}
                onClick={() => {
                  if (!expanded) recordMapInteraction('map_district_activities_expand')
                  setExpandedDistrictActivities((current) => {
                    const next = new Set(current)
                    if (next.has(districtKey)) next.delete(districtKey)
                    else next.add(districtKey)
                    return next
                  })
                }}
                className={`self-center rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}
              >{expanded ? 'إخفاء الأنشطة الإضافية' : `عرض كل الأنشطة (${n(district.activities.length)})`}</button> : null}
            </div>
          })() : null}
          {district.absent_from_directory.length ? <p className="m-0 text-[12px] leading-[19px] text-[var(--color-text-secondary)]"><strong>لا تظهر لها سجلات مصنّفة في الدليل:</strong> {district.absent_from_directory.slice(0, 4).join('، ')}{district.absent_from_directory.length > 4 ? `، و${n(district.absent_from_directory.length - 4)} أخرى` : ''}</p> : <p className="m-0 text-[12px] leading-[19px] text-[var(--color-text-secondary)]"><strong>الأنشطة غير الظاهرة:</strong> لم يرصد التحليل نشاطاً مصنّفاً على مستوى المدينة بلا سجل في هذا الحي.</p>}
          {hasReliableTotal ? <p className="m-0 text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">نسبة تغطية التصنيف {n(district.classification_pct)}٪ من السجلات ذات الحي الموثوق. عدم ظهور نشاط لا يثبت عدم وجوده فعلياً.</p> : <p className="m-0 text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">إجمالي سجلات الحي قيد التحقق؛ نعرض فقط السجلات المصنفة المؤكدة.</p>}
        </article>
      })}
      {districtInsightError && !districtInsightLoading ? <div role="status" className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
        <span>تعذّر تحميل ملخص الأحياء.</span>
        <button type="button" onClick={() => setDistrictInsightRetry((value) => value + 1)} className={`font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>أعد المحاولة</button>
      </div> : null}
    </section>
  ) : null
  const buyerPanel = lens === 'buyers' && !buyerProductMode && currentBuyerData ? (
    <section className="flex flex-col gap-2 border-b border-[var(--color-border-default)] px-4 py-3" aria-label="المنشآت التي تشتري هذا النشاط">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">من يشتري عادةً؟</h2>
        <button type="button" aria-pressed={includeCommonBuyers} onClick={() => setIncludeCommonBuyers((v) => !v)} className={`text-[12px] font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>
          {includeCommonBuyers ? 'عرض الأساسي فقط' : 'عرض احتمالات أقل تأكيداً'}
        </button>
      </div>
      <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{currentBuyerData.subject.label_ar} · علاقة احتياج متوقعة وليست إثباتاً لنية شراء</p>
      {includeCommonBuyers ? <p role="note" className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">الاحتمالات الأقل تأكيداً قد لا تطابق احتياجك؛ راجع نشاط المنشأة قبل التواصل.</p> : null}
      {currentBuyerData.buyers.filter((b) => includeCommonBuyers || b.strength === 'core').length ? (
        <ul className="flex flex-col">
          {currentBuyerData.buyers.filter((b) => includeCommonBuyers || b.strength === 'core').map((b) => <li key={b.sub_id} className="flex items-center gap-2 border-t border-[var(--color-border-default)] py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{b.sub_ar} <span className="text-[11px] text-[var(--color-text-tertiary)]">{b.strength === 'core' ? 'أساسي' : 'محتمل'}</span></span>
            <span className="tabular-nums text-[var(--color-text-secondary)]">{n(b.n)} · واتساب {n(b.n_whatsapp)}</span>
          </li>)}
        </ul>
      ) : <p className="text-[13px] text-[var(--color-text-secondary)]">ما فيه علاقات شراء مصنّفة لهذا النشاط في المدينة.</p>}
    </section>
  ) : null
  const fitLegend = <MapLegend fitFilter={fitFilter} counts={fitCounts} onFitFilterChange={(next) => {
    if (next === fitFilter) return
    setFitFilter(next)
    setShown(PAGE)
    recordMapInteraction(`fit_filter_${next}`)
  }} />
  const scopeDistricts = districtInsightRows
  const scopeDistrictName = chosenNames.length === 1 ? chosenNames[0] : filters.district || null
  const scopeDistrictTitle = scopeDistrictName ? `سوق حي ${scopeDistrictName}` : chosenNames.length > 1 ? `تحليل ${n(chosenNames.length)} أحياء` : 'تحليل الحي'
  const scopeLabel = mapScope === 'city' ? 'المدينة' : mapScope === 'district' ? chosenNames.length > 1 ? 'الأحياء' : 'الحي' : 'الشارع'
  const scopeStreet = pickedStreet || (filters.street ? denseList.find((street) => normalizeActivityText(street.props.street_ar) === normalizeActivityText(filters.street!)) || null : null)
  const streetScopeRows = scopeStreet ? visibleCohort.filter((row) =>
      normalizeActivityText(safeLocationName(row.street_ar) || '') === normalizeActivityText(scopeStreet.props.street_ar)
      && (!scopeStreet.props.district_ar || normalizeActivityText(safeLocationName(row.district_ar) || '') === normalizeActivityText(scopeStreet.props.district_ar))
    ) : []
  const streetMainCounts = new Map<string, number>()
  for (const row of streetScopeRows) {
    const category = mainAr(mainIdOf(row))
    if (category !== 'غير مصنّف') streetMainCounts.set(category, (streetMainCounts.get(category) || 0) + 1)
  }
  const streetMainBreakdown = [...streetMainCounts].sort((a, b) => b[1] - a[1]).slice(0, 5)
  // With no text search, market analytics are the source of truth for the
  // selected district and activity. `res` is only a loaded result page, so
  // using its row count here understated the actual commercial scope.
  const useMarketScopeTotal = lens === 'market' && !hasTargetQuery
  const marketScopeTotal = filters.contact === 'whatsapp'
    ? marketStats?.n_whatsapp ?? null
    : filters.wholesale
      ? marketStats?.n_wholesale ?? null
      : marketStats?.total ?? cityOverviewStats?.total ?? null
  const scopedMatchCount = useMarketScopeTotal
    ? marketScopeTotal
    : res ? buyerProductMode || Boolean(focus || site || chosenD.size) ? visibleCohort.length : res.total : null
  const scopedMatchLabel = useMarketScopeTotal && mapScope !== 'city' ? 'منشآت الخريطة في النطاق' : 'مطابقات البحث في النطاق'
  const scopedMatchNote = useMarketScopeTotal
    ? mapScope === 'district'
      ? 'سجل الخريطة بحسب الحدود والفلاتر؛ وقد يختلف عن تحليل الحي المصنف.'
      : 'إجمالي سجلات الدليل ضمن النطاق والفلاتر'
    : res && (buyerProductMode || Boolean(focus || site || chosenD.size))
      ? 'من النتائج المحمّلة بعد تضييق النطاق'
      : res ? 'إجمالي النتائج المطابقة للبحث والفلاتر' : 'ابدأ بحثاً لعرض المطابقات'
  const scopeMetric = (label: string, value: string | number | null | undefined, note?: string, wide = false, action?: { label: string; onClick: () => void }) => {
    const content = <>
      <span className="block text-[11px] leading-[17px] text-[var(--color-text-secondary)]">{label}</span>
      <strong className="mt-1 block break-words text-[15px] leading-[21px] tabular-nums">{value == null || value === '' ? '—' : typeof value === 'number' ? n(value) : value}</strong>
      {note ? <span className="mt-1 block text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">{note}</span> : null}
    </>
    const shell = `min-w-0 rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2.5 ${wide ? 'col-span-2' : ''}`
    return action ? <button key={label} type="button" aria-label={action.label} onClick={action.onClick} className={`${shell} text-right transition-colors hover:border-[var(--map-green)] hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>{content}</button>
      : <div key={label} className={shell}>{content}</div>
  }
  const mapScopePanel = (
    <section data-testid="map-scope-insights" className="flex flex-col gap-3 border-b border-[var(--color-border-default)] px-4 py-3" aria-label={`تحليل السوق: ${scopeLabel}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="m-0 text-[15px] font-semibold">{mapScope === 'city' ? `سوق ${cityName(city)}` : mapScope === 'district' ? scopeDistrictTitle : scopeStreet ? `شارع ${scopeStreet.props.street_ar}` : 'تحليل الشارع'}</h2>
          <p className="m-0 mt-1 text-[11px] leading-[16px] text-[var(--color-text-tertiary)]">
            {mapScope === 'city' ? 'إجمالي الدليل منفصل عن نتائج بحثك الحالية.' : mapScope === 'district' ? 'الأعداد من سجل الحي المصنّف؛ غيّر الحي من الخريطة أو فلتر الحي.' : 'بيانات الشارع تخص النشاط الظاهر في طبقة الكثافة.'}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-bg-surface-2)] px-2.5 py-1 text-[10px] text-[var(--color-text-secondary)]">{cityOverviewLoading && mapScope === 'city' ? 'جارٍ التحديث' : 'حسب سجل الدليل'}</span>
      </div>
      {mapScope === 'city' ? (
        cityOverviewStats ? <>
          <dl className="m-0 grid grid-cols-2 gap-2">
            {scopeMetric('إجمالي المنشآت', cityOverviewStats.total, 'حجم الدليل في المدينة')}
            {scopeMetric('الأحياء المغطاة', displayedDistrictCount(cityOverviewStats), 'أحياء لها سجلات موثوقة')}
            {scopeMetric('التصنيف الأكثر انتشاراً', cityOverviewStats.main_activities?.[0]?.main_ar || 'غير متاح حالياً', cityOverviewStats.main_activities?.[0] ? `${n(cityOverviewStats.main_activities[0].n)} سجل مصنّف` : 'لم يصل توزيع أنشطة المدينة', true, cityOverviewStats.main_activities?.[0] ? { label: `تصفية الخريطة حسب ${cityOverviewStats.main_activities[0].main_ar}` , onClick: () => { recordMapInteraction('map_city_summary_activity_select'); selectMainFromCounter(cityOverviewStats.main_activities![0].main_id) } } : undefined)}
            {scopeMetric('أكبر حي', cityOverviewStats.top_districts?.[0]?.district_ar || null, cityOverviewStats.top_districts?.[0] ? `${n(cityOverviewStats.top_districts[0].n)} منشأة مسجلة` : 'لا تتوفر بيانات أحياء', true, cityOverviewStats.top_districts?.[0] ? { label: `اختيار حي ${cityOverviewStats.top_districts[0].district_ar} على الخريطة`, onClick: () => { const district = cityOverviewStats.top_districts![0]; const id = districts.find((item) => normalizeActivityText(item.ar) === normalizeActivityText(district.district_ar))?.id || `name:${district.district_ar}`; selectDistrictFromScope(id) } } : undefined)}
            {scopeMetric('ضمن الفلاتر الحالية', scopedMatchCount, scopedMatchNote, true)}
          </dl>
          {cityOverviewStats.main_activities?.length ? <p className="m-0 text-[11px] leading-[17px] text-[var(--color-text-secondary)]">أنشطة بارزة: {cityOverviewStats.main_activities.slice(0, 3).map((activity) => `${activity.main_ar} (${n(activity.n)})`).join(' · ')}</p> : <p role="status" className="m-0 flex flex-wrap items-center gap-2 text-[11px] leading-[17px] text-[var(--color-text-secondary)]"><span>تعذّر عرض توزيع أنشطة المدينة حالياً.</span><button type="button" onClick={() => { recordMapInteraction('market_summary_retry'); setCityOverviewRetry((retry) => retry + 1) }} className={`font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>أعد المحاولة</button></p>}
        </> : cityOverviewLoading ? <p role="status" className="m-0 text-[13px] text-[var(--color-text-secondary)]">نحمّل ملخص المدينة…</p> : cityOverviewError ? <div role="status" className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]"><span>تعذّر تحميل إجمالي المدينة.</span><button type="button" onClick={() => setCityOverviewRetry((retry) => retry + 1)} className={`font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>أعد المحاولة</button></div> : null
      ) : null}
      {mapScope === 'district' ? (
        scopeDistricts.length ? scopeDistricts.map((district) => {
          const streetPool = denseList.filter((street) => normalizeActivityText(street.props.district_ar || '') === normalizeActivityText(district.district_ar))
          const densest = [...streetPool].sort((a, b) => b.props.per_100m - a.props.per_100m)[0]
          const hasReliableTotal = district.total > 0
          return <article key={district.district_ar} className="flex flex-col gap-2" aria-label={`مؤشرات حي ${district.district_ar}`}>
            <dl className="m-0 grid grid-cols-2 gap-2">
              {hasReliableTotal
                ? scopeMetric('إجمالي المنشآت في الحي', district.total, `${n(district.classified)} مصنّف · تغطية ${n(district.classification_pct)}٪`)
                : scopeMetric('السجلات المصنفة في الحي', district.classified, 'إجمالي الدليل قيد التحقق؛ لا نعرض نسبة تغطية غير مؤكدة')}
              {scopeMetric('الشوارع الظاهرة بالكثافة', new Set(streetPool.map((street) => street.props.street_ar)).size, 'حسب طبقة النشاط الحالية')}
              {scopeMetric('التصنيف الأكثر انتشاراً', district.dominant_activity?.main_ar || null, district.dominant_activity ? `${n(district.dominant_activity.n)} سجل` : 'لا توجد بيانات مصنّفة', true, district.dominant_activity ? { label: `تصفية خريطة حي ${district.district_ar} حسب ${district.dominant_activity.main_ar}`, onClick: () => { recordMapInteraction('map_district_activity_select'); selectMainFromCounter(district.dominant_activity!.main_id) } } : undefined)}
              {scopeMetric('أكثف شارع بهذا النشاط', densest?.props.street_ar || null, densest ? `${formatNumber(densest.props.per_100m, { maximumFractionDigits: 1 })} منشأة لكل 100 م` : 'اختر نشاطاً لعرض كثافة الشوارع', true)}
              {scopeMetric(scopedMatchLabel, scopedMatchCount, scopedMatchNote, true)}
            </dl>
            {district.dominant_activity?.top_subactivities?.length ? <div role="group" aria-label={`أبرز الأنشطة الفرعية في حي ${district.district_ar}`} className="flex flex-wrap items-center gap-1.5 text-[11px] leading-[17px] text-[var(--color-text-secondary)]"><span>أبرز الأنشطة الفرعية:</span>{district.dominant_activity.top_subactivities.slice(0, 3).map((item) => <button key={item.sub_id} type="button" aria-label={`تصفية خريطة حي ${district.district_ar} حسب ${item.sub_ar}، ${n(item.n)} سجل مصنف`} onClick={() => { recordMapInteraction('map_district_subactivity_select'); selectSubFromDistrictInsight(district.dominant_activity!.main_id, String(item.sub_id)) }} className={`rounded-full bg-[var(--color-bg-surface-2)] px-2 py-0.5 text-[10px] transition-colors hover:bg-[var(--color-bg-primary-subtle)] hover:text-[var(--color-text-info)] ${FOCUS_RING}`}>{item.sub_ar} · {n(item.n)}</button>)}</div> : null}
            {district.activities.length ? <div className="flex flex-wrap gap-1.5" aria-label={`توزيع الأنشطة في حي ${district.district_ar}`}>{district.activities.slice(0, 6).map((activity) => <button key={activity.main_id} type="button" aria-label={`تصفية خريطة حي ${district.district_ar} حسب ${activity.main_ar}، ${n(activity.n)} سجل مصنف`} onClick={() => { recordMapInteraction('map_district_activity_select'); selectMainFromCounter(activity.main_id) }} className={`rounded-full bg-[var(--color-bg-surface-2)] px-2.5 py-1 text-[10px] transition-colors hover:bg-[var(--color-bg-primary-subtle)] hover:text-[var(--color-text-info)] ${FOCUS_RING}`}>{activity.main_ar} · {n(activity.n)}</button>)}</div> : null}
            {district.least_activity ? <p className="m-0 text-[11px] text-[var(--color-text-secondary)]">الأقل بين المسجل: {district.least_activity.main_ar} · {n(district.least_activity.n)}</p> : null}
            {district.absent_from_directory.length ? <p className="m-0 text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">لا تظهر سجلات مصنفة لـ: {district.absent_from_directory.slice(0, 3).join('، ')}. غياب السجل لا يثبت غياب النشاط فعلياً.</p> : null}
          </article>
        }) : districtInsightLoading ? <p role="status" className="m-0 text-[13px] text-[var(--color-text-secondary)]">اختر الحي من الخريطة أو الفلتر؛ نحمّل تحليله…</p> : districtInsightError ? <div role="status" className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]"><span>تعذّر تحميل تحليل الحي.</span><button type="button" onClick={() => setDistrictInsightRetry((retry) => retry + 1)} className={`font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>أعد المحاولة</button></div> : <div className="flex flex-col gap-2"><p className="m-0 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">اختر حياً من الخريطة أو فلتر الحي لعرض حجمه وأنشطته.</p>{cityOverviewStats?.top_districts?.length ? <div className="flex flex-wrap gap-1.5" aria-label="أكبر الأحياء في المدينة">{cityOverviewStats.top_districts.slice(0, 5).map((district) => {
              const districtId = districts.find((item) => normalizeActivityText(item.ar) === normalizeActivityText(district.district_ar))?.id || `name:${district.district_ar}`
              return <Chip key={district.district_ar} className="shrink-0" label={`${district.district_ar} · ${n(district.n)}`} selected={chosenD.has(districtId)} onClick={() => toggleDistrict(districtId)} />
            })}</div> : null}</div>
      ) : null}
      {mapScope === 'street' ? (
        scopeStreet ? <>
          <dl className="m-0 grid grid-cols-2 gap-2">
            {scopeMetric('منشآت بهذا النشاط', scopeStreet.props.n, scopeStreet.props.sub_ar || scopeStreet.props.main_ar || 'كما ترصدها طبقة الشارع')}
            {scopeMetric('الكثافة', `${formatNumber(scopeStreet.props.per_100m, { maximumFractionDigits: 1 })} / 100 م`, 'منشأة لكل 100 متر')}
            {scopeMetric('التصنيف في الطبقة', scopeStreet.props.main_ar || scopeStreet.props.sub_ar || null, scopeStreet.props.sub_ar || 'لا يوجد تصنيف فرعي', true)}
            {scopeMetric('مطابقات البحث المحمّلة', streetScopeRows.length, 'منشآت على هذا الشارع ضمن الدفعة الحالية', true)}
          </dl>
          {streetMainBreakdown.length ? <div className="flex flex-wrap gap-1.5" aria-label="التصنيفات في نتائج الشارع">{streetMainBreakdown.map(([category, count]) => <span key={category} className="rounded-full bg-[var(--color-bg-surface-2)] px-2.5 py-1 text-[10px]">{category} · {n(count)}</span>)}</div> : null}
          {streetScopeRows.length ? <ul className="m-0 flex list-none flex-col divide-y divide-[var(--color-border-default)] p-0" aria-label="منشآت مطابقة على الشارع">{streetScopeRows.slice(0, 5).map((row) => <li key={row.poi_key} className="flex items-center justify-between gap-2 py-2 text-[12px]"><span className="min-w-0 truncate font-medium">{safeName(row)}</span><button type="button" onClick={() => void openMapProfile(row.poi_key)} className={`shrink-0 text-[var(--color-text-info)] underline ${FOCUS_RING}`}>الملف</button></li>)}</ul> : <p className="m-0 text-[11px] text-[var(--color-text-secondary)]">ما فيه منشآت مطابقة محمّلة على هذا الشارع حالياً.</p>}
        </> : <div className="flex flex-col gap-2"><p className="m-0 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">اختر شارعاً من الخريطة أو من قائمة الشوارع لعرض نشاطه ومنشآته المطابقة.</p>{denseList.length ? <div className="flex flex-wrap gap-1.5" aria-label="شوارع مقترحة">{[...denseList].sort((a, b) => b.props.per_100m - a.props.per_100m).slice(0, 5).map((street) => <Chip key={street.id} className="shrink-0" label={`${street.props.street_ar} · ${n(street.props.n)}`} selected={activeStreetId === street.id} onClick={() => pickStreet(street.id)} />)}</div> : <p className="m-0 text-[11px] text-[var(--color-text-tertiary)]">اختر نشاطاً أو حياً أولاً لعرض الشوارع.</p>}</div>
      ) : null}
    </section>
  )
  const selectedMainId = focus?.level === 'main' ? focus.id : focus?.level === 'sub' ? focus.id.split('.')[0] : focus?.level === 'spec' ? (focus.sub_id || '').split('.')[0] : null
  const selectMainFromCounter = (mainId: string) => {
    recordMapInteraction('map_activity_main_select')
    // A market category card replaces prior text/taxonomy filters, while keeping
    // active geographic filters. The visible scope picker can be opened without
    // changing the underlying district or street filter.
    const scopeFilters: AreaFilters = {
      ...(areaFiltersRef.current.district ? { district: areaFiltersRef.current.district } : {}),
      ...(areaFiltersRef.current.street ? { street: areaFiltersRef.current.street } : {}),
    }
    setQ('')
    setQuery('')
    setLens('market')
    setAreaFilters(scopeFilters)
    setActiveStreet(mapScope === 'street' ? activeStreet : null)
    clusterGen.current++
    setClusters(null)
    void loadBrowse(city, scopeFilters, true)
    pickFocus({ level: 'main', id: mainId })
    // On a phone, take the user straight to the compact subactivity row.
    // The guide remains the useful next surface on a wide layout.
    setTab(mobile ? 'streets' : 'guide')
  }
  const selectSubFromDistrictInsight = (mainId: string, subId: string) => {
    // The insight belongs to the selected district. Keep that geography while
    // carrying the chosen subactivity through to the map density and scope totals.
    const current = areaFiltersRef.current
    const scopeFilters: AreaFilters = {
      ...(current.district ? { district: current.district } : {}),
      ...(current.street ? { street: current.street } : {}),
    }
    setQ('')
    setQuery('')
    setLens('market')
    setAreaFilters(scopeFilters)
    setStreetPick({ kind: 'sub', ids: [subId], main: mainId })
    setActiveStreet(mapScope === 'street' ? activeStreet : null)
    clusterGen.current++
    setClusters(null)
    void loadBrowse(city, scopeFilters, true)
    pickFocus({ level: 'sub', id: subId })
    // Keep the selected subactivity visible with its sibling activities and
    // specialty search on phones instead of moving it behind the guide tab.
    setTab(mobile ? 'streets' : 'guide')
  }
  const selectedSummaryCounterKey = filters.contact === 'whatsapp' ? 'market-whatsapp' : filters.wholesale ? 'market-wholesale' : null
  const selectSummaryCounter = (key: string) => {
    if (key === 'market-districts' || key === 'city-districts') {
      recordMapInteraction('map_counter_district_picker_open')
      setMapScope('district')
      setDistrictPickerOpenRequest((request) => request + 1)
      return
    }
    if (!['market-size', 'market-whatsapp', 'market-wholesale', 'city-places', 'city-whatsapp'].includes(key)) return
    const current = areaFiltersRef.current
    if (key === 'market-whatsapp' || key === 'city-whatsapp') recordMapInteraction(current.contact === 'whatsapp' ? 'map_counter_whatsapp_filter_off' : 'map_counter_whatsapp_filter_on')
    else if (key === 'market-wholesale') recordMapInteraction(current.wholesale ? 'map_counter_wholesale_filter_off' : 'map_counter_wholesale_filter_on')
    else recordMapInteraction('map_counter_scope_reset')
    const scopeFilters: AreaFilters = {
      ...(current.district ? { district: current.district } : {}),
      ...(current.street ? { street: current.street } : {}),
    }
    if (key === 'market-whatsapp' || key === 'city-whatsapp') {
      if (current.contact !== 'whatsapp') scopeFilters.contact = 'whatsapp'
    } else if (key === 'market-wholesale') {
      if (!current.wholesale) scopeFilters.wholesale = true
    }
    setQ('')
    setQuery('')
    setLens('market')
    setFocus(null)
    setStreetPick({ kind: 'all' })
    setSite(null)
    setFitFilter('all')
    setShowUnlocated(false)
    setActiveStreet(mapScope === 'street' ? activeStreet : null)
    clusterGen.current++
    setClusters(null)
    setAreaFilters(scopeFilters)
    void loadBrowse(city, scopeFilters, true)
    setTab('guide')
  }
  const marketGuide = <GuideTree guide={res ? guide : []} focus={focus} onFocus={pickFocus} empty={res ? 'ما فيه أنشطة هنا. اختر حياً فيه منشآت.' : 'اختر نشاطاً من قائمة الشوارع أو ابحث عن منشآت، ثم تصفّح الأنشطة والتخصصات هنا.'} mobile={mobile} />
  const panelContent = lens === 'market'
    ? tab === 'guide' ? marketGuide : mobile && tab === 'results' ? resultsBody : marketPanel
    : <>
    {buyerPanel}
    {mobile && tab === 'streets' ? densePanel || <p className="px-5 py-6 text-[14px] text-[var(--color-text-secondary)]">نحسب أكثف الشوارع…</p> : tab !== 'guide' ? (
      <>{mobile ? null : densePanel}{denseList.length ? null : clusterList}<MyRequests mobile={mobile} refresh={savedTick} />{targetResultsPanel}</>
    ) : marketGuide}
  </>
  const panelBody = <>{mapScopePanel}{fitLegend}{mapScope === 'district' ? null : districtInsightPanel}{panelContent}</>

  // ---------- the map with its floating controls
  const fallbackChips = !hasPolys && polys !== null && districts.length ? (
    <div role="group" aria-label="الأحياء" className="pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto pb-1">
      {districts.map((d) => {
        const c = res?.areas?.districts.find((x) => x.name === d.ar)?.n
        return <Chip key={d.id} className="shrink-0" icon={DistrictIcon} label={`${d.ar}${c != null ? ` · ${n(c)}` : ''}`} selected={chosenD.has(d.id)} onClick={() => toggleDistrict(d.id)} />
      })}
    </div>
  ) : null
  const mapBlock = (
    <div className={`${focusMode ? 'absolute inset-0 rounded-none border-0' : `relative min-h-0 rounded-[18px] border border-[var(--color-border-default)] ${mobile ? 'map-compact-scroll-anchor h-[clamp(340px,48dvh,420px)] shrink-0' : 'flex-1'}`} overflow-hidden bg-[var(--map-land)]`}>
      <LayerMap city={city} focusMode={focusMode} districts={hasPolys ? districts : []} chosen={chosenD} onDistrict={toggleDistrict} pins={showMapPins ? pins : []} highlightedPinKey={highlightedPinKey} layer={layer} onPin={(k) => void openMapProfile(k)} tileQuery={showMapPins && !buyerProductMode ? activeTileQuery : undefined} onTileRefresh={() => { if (buyerProductMode) return; void (query ? runSearchIn(query, city, filters) : loadBrowse(city, filters)) }}
        nameOf={(k) => { const r = byKey.get(k); return r ? safeName(r) : 'منشأة' }} clusters={clusterTop} onCluster={pickCluster}
        streets={denseList} activeStreet={activeStreetId} onStreet={pickStreet} density={mapDensity} densityMax={densityMax}
        showDensity={showDensity} showDistricts={showDistricts} showClusters={showMarketClusters} showPlaces={showMapPins} showStreets={showStreets}
        site={site} placingSite={placingSite} onPlaceSite={(lat, lon) => { setSite({ lat, lon, km: site?.km || 10 }); setPlacingSite(false); setShowUnlocated(false) }} fit={fit} extent={extent} />
      <div ref={layerControlRef} className="pointer-events-none absolute bottom-3 end-3 z-30">
        {layersOpen ? <div id="map-layer-options" role="group" aria-label="إظهار طبقات الخريطة" className="pointer-events-auto mb-2 max-h-[calc(100%-56px)] w-[min(300px,calc(100vw-48px))] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 p-3 shadow-[var(--farq-soft-shadow)] backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <span className="text-[13px] font-semibold">طبقات السوق</span>
            <button type="button" aria-label="إغلاق طبقات الخريطة" onClick={() => setLayersOpen(false)} className={`flex size-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}><Icon name="x" size={16} /></button>
          </div>
          <div className="flex flex-col gap-2">
            <section aria-labelledby="map-layer-city" className="rounded-xl bg-[var(--color-bg-surface-2)]/70 p-2">
              <h3 id="map-layer-city" className="m-0 px-2 pb-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">المدينة · بؤر السوق</h3>
              <Switch className="w-full justify-between" label="تجمعات النشاط" description="مواقع مجمّعة وأعدادها" checked={showMarketClusters} onChange={(event) => { const on = event.currentTarget.checked; setShowMarketClusters(on); recordMapInteraction(on ? 'map_filter_layer_city_on' : 'map_filter_layer_city_off') }} />
            </section>
            <section aria-labelledby="map-layer-districts" className="rounded-xl bg-[var(--color-bg-surface-2)]/70 p-2">
              <h3 id="map-layer-districts" className="m-0 px-2 pb-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">الأحياء · قارن واختر</h3>
              <div className="flex flex-col gap-1.5">
                <Switch className="w-full justify-between" label="تدرج الكثافة" description="الأغمق يعني منشآت أكثر" checked={showDensity} onChange={(event) => { const on = event.currentTarget.checked; setShowDensity(on); recordMapInteraction(on ? 'map_filter_layer_density_on' : 'map_filter_layer_density_off') }} />
                <Switch className="w-full justify-between" label="حدود وأسماء الأحياء" checked={showDistricts} onChange={(event) => { const on = event.currentTarget.checked; setShowDistricts(on); recordMapInteraction(on ? 'map_filter_layer_districts_on' : 'map_filter_layer_districts_off') }} />
              </div>
            </section>
            <section aria-labelledby="map-layer-streets" className="rounded-xl bg-[var(--color-bg-surface-2)]/70 p-2">
              <h3 id="map-layer-streets" className="m-0 px-2 pb-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">الشوارع · كثافة النشاط</h3>
              <Switch className="w-full justify-between" label="الشوارع الكثيفة" description="اضغط الشارع لتضييق النتائج" checked={showStreets} onChange={(event) => { const on = event.currentTarget.checked; setShowStreets(on); recordMapInteraction(on ? 'map_filter_layer_streets_on' : 'map_filter_layer_streets_off') }} />
            </section>
            <section aria-labelledby="map-layer-places" className="rounded-xl bg-[var(--color-bg-surface-2)]/70 p-2">
              <h3 id="map-layer-places" className="m-0 px-2 pb-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">التفاصيل</h3>
              <Switch className="w-full justify-between" label="نقاط المنشآت" description="المواقع الفردية وملفاتها" checked={showMapPins} onChange={(event) => { const on = event.currentTarget.checked; setShowMapPins(on); recordMapInteraction(on ? 'map_filter_layer_places_on' : 'map_filter_layer_places_off'); if (!on) setProfile(null) }} />
            </section>
          </div>
        </div> : null}
        <button type="button" aria-label="طبقات الخريطة" aria-expanded={layersOpen} aria-controls="map-layer-options" aria-pressed={layersOpen} onClick={() => setLayersOpen((open) => !open)} className={`pointer-events-auto flex size-11 items-center justify-center rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 text-[var(--color-text-primary)] shadow-[var(--farq-soft-shadow)] backdrop-blur-md transition-colors hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING} ${layersOpen ? 'text-[var(--color-text-info)]' : ''}`}><Icon name="layers" size={19} /></button>
      </div>
      {!focusMode ? <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-3 py-2 text-[13px] font-semibold shadow-[var(--farq-soft-shadow)] backdrop-blur-md md:min-h-8">
            <span>{focus?.level === 'main' ? `النشاط الرئيسي: ${mainAr(focus.id)}` : focus?.level === 'sub' ? `النشاط الفرعي: ${subAr(focus.id) || ''}` : focus?.level === 'spec' ? `التخصص: ${focus.id}` : lens === 'market' ? 'نظرة عامة على السوق' : 'النشاط الرئيسي'}</span>
            {focus ? <button type="button" onClick={() => pickFocus(null)} className={`inline-flex min-h-11 items-center px-2 text-[var(--color-text-info)] underline md:min-h-8 ${FOCUS_RING}`}>العودة للمستوى الأعلى</button> : null}
          </div>
          {focus && res?.map_query && !activeTileQuery ? <p role={focusedTileError ? 'alert' : 'status'} className="pointer-events-auto m-0 max-w-[min(28rem,90vw)] rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-3 py-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)] shadow-[var(--farq-soft-shadow)] backdrop-blur-md">{focusedTileError ? 'تعذّر تحديث نقاط الخلفية لهذا النشاط؛ أخفيناها حتى لا تختلط بنتائج الاختيار.' : 'نحدّث نقاط الخريطة لتطابق النشاط المحدد…'}</p> : null}
          <div className="pointer-events-auto flex flex-wrap gap-1.5">
            {districts.length && chosenD.size ? <button type="button" onClick={clearDistrict} className={`min-h-11 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[13px] font-medium shadow-[var(--farq-soft-shadow)] md:min-h-8 ${FOCUS_RING}`}>عرض كل الأحياء</button> : null}
            {site ? (
              <div className="flex items-center gap-1 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] py-1 ps-3 pe-1 text-[13px] font-medium shadow-[var(--farq-soft-shadow)]">
                <FilterPill id="site-radius" label={`نطاق التوصيل · ${site.km} كم`} icon={null} analyticsKey="site_radius" options={RADII.map((radius) => ({ value: String(radius), text: `${radius} كم` }))} disabled={false} mobile={mobile} onPick={(value) => setSite({ ...site, km: Number(value) })} />
                <button type="button" aria-label="إزالة موقع المشروع" onClick={() => { setSite(null); setShowUnlocated(false) }} className={`flex ${mobile ? 'size-11' : 'size-7'} items-center justify-center rounded-full hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}><Icon name="x" size={14} /></button>
              </div>
            ) : (
              <button type="button" aria-pressed={placingSite} onClick={() => setPlacingSite((p) => !p)} className={`flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium shadow-[var(--farq-soft-shadow)] md:min-h-8 ${placingSite ? 'border-[var(--map-ink)] bg-[var(--map-ink)] text-white' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 backdrop-blur-md'} ${FOCUS_RING}`}>
                <Icon name="map-pin" size={14} />{placingSite ? 'اضغط على الخريطة' : 'موقع المشروع'}
              </button>
            )}
            <button type="button" onClick={() => changeFocusMode(true)} className={`min-h-11 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[13px] font-medium shadow-[var(--farq-soft-shadow)] md:min-h-8 ${FOCUS_RING}`}>توسيع الخريطة</button>
          </div>
        </div>
        {fallbackChips}
      </div> : null}
      {!anyChosen ? (
        <p role="status" data-testid="map-hint" className="sr-only">
          {polys === null ? 'نحمّل أحياء المدينة…'
            : !res && denseList.length ? (mobile ? 'الخطوط الخضراء أكثف الشوارع. اضغط شارعاً لتظهر منشآته.' : 'الخطوط الخضراء أكثف الشوارع. اختر نشاطاً من القائمة أو اكتب وش تبي، أو اضغط شارعاً لتظهر منشآته.')
            : !res ? 'اكتب وش تبي فوق واضغط «ابحث»، ونوريك وين يتركز في المدينة.'
            : busy ? 'نحسب أكثف الشوارع والأحياء…'
            : denseList.length ? (mobile ? 'اضغط شارعاً أخضر أو حياً لتظهر منشآته.' : 'الخطوط الخضراء أكثف الشوارع، والأحياء الأغمق فيها منشآت أكثر. اضغط شارعاً أو حياً لتظهر منشآته.')
            : hasPolys ? 'الأحياء الأغمق فيها منشآت أكثر. اضغط حياً لتظهر منشآته.'
            : 'اختر حياً من القائمة فوق لتظهر منشآته.'}
        </p>
      ) : null}
      {pickedStreet ? (
        <div data-testid="street-card" className="absolute start-3 top-[64px] z-10 flex w-[min(300px,80%)] flex-col gap-1.5 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 p-3 text-[13px] leading-[20px] shadow-[var(--farq-soft-shadow)] backdrop-blur-md">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold"><StreetIcon size={15} className="me-1 inline text-[var(--map-green)]" />{pickedStreet.props.street_ar}</p>
            <button type="button" aria-label="إغلاق بطاقة الشارع" onClick={() => { setActiveStreet(null); applyFilters(keep(filters, ['street'])) }} className={`flex ${mobile ? 'size-11' : 'size-7'} shrink-0 items-center justify-center rounded-full hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}><Icon name="x" size={14} /></button>
          </div>
          <p className="text-[var(--color-text-secondary)]">{[pickedStreet.props.district_ar, [pickedStreet.props.main_ar, pickedStreet.props.sub_ar].filter(Boolean).join(' ▸ ')].filter(Boolean).join(' · ')}</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">المنشآت</dt><dd className="m-0 font-semibold tabular-nums">{n(pickedStreet.props.n)} منشأة</dd></div>
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">طول المقطع</dt><dd className="m-0 font-semibold tabular-nums">{fmtMeters(pickedStreet.props.length_m)}</dd></div>
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">الكثافة</dt><dd className="m-0 font-semibold tabular-nums">{formatNumber(pickedStreet.props.per_100m, { maximumFractionDigits: 1 })} منشأة لكل 100 م</dd></div>
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">جملة</dt><dd className="m-0 font-semibold tabular-nums">{n(pickedStreet.props.n_wholesale)} منشأة</dd></div>
          </dl>
        </div>
      ) : null}
      {mobile && !focusMode && res && showTargetResults ? (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center">
          <button type="button" onClick={() => {
            setTab('results')
            recordMapInteraction('map_results_jump')
            resultsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }} disabled={busy} className={`pointer-events-auto rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 px-4 py-2 text-[14px] font-semibold shadow-lg backdrop-blur-md disabled:opacity-70 ${FOCUS_RING}`}>
            {busy ? 'جارٍ تحديث النتائج…' : `عرض النتائج · ${resultCountSummary}`}
          </button>
        </div>
      ) : null}
      {profile && byKey.get(profile) && !mobile ? (
        <ProfileDrawer row={byKey.get(profile)!} mobile={false} onClose={() => setProfile(null)} chosen={selected.has(profile)} onChoose={() => toggle(byKey.get(profile)!)} onRequestQuote={lens === 'sellers' && onRfq ? () => prepareQuoteForProfile(profile) : undefined} />
      ) : null}
    </div>
  )

  const tray = chosen.length ? (
    <CampaignTray mobile={mobile} count={chosen.length} keys={chosen.map((r) => r.poi_key)} cost={cost} message={message} onMessage={setMessage}
      template={template} onTemplate={setTemplate} templates={templates} sendBlock={sendBlock} scheduleBlock={scheduleBlock} templateBadge={templateBadge}
      city={city} showTiming={objective === 'purchase'} onSend={() => setConfirming(true)} onPrepare={objective === 'marketing' ? () => void prepareWhatsAppCampaign() : undefined} onOpenLeads={onLeads} openRequest={draftOpenRequest} preparing={preparingMarketing} prepared={Boolean(preparedCampaignId)} onClear={() => { setSelected(new Set()); setSelectedRows(new Map()); setPreparedCampaignId(null) }} onNotice={setNotice} />
  ) : null
  const confirmSheet = confirming && holder ? (
    <CampaignConfirmSheet template={template} holderRfqId={holder} rows={chosen} message={message.trim()} query={query} price={price} city={city}
      onClose={() => setConfirming(false)} onSaveDraft={saveDraft}
      onDone={(sent, failed) => { setConfirming(false); setNotice(`تم بحمد الله، أرسلنا ${n(sent)} رسالة${failed ? ` · ما وصلت ${n(failed)}` : ''}. الردود توصلك في صندوق الوارد.`) }} />
  ) : null
  const noticeLine = notice ? <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-success)]">{notice}</p> : null
  const errorLine = error ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]"><WarningIcon size={18} /><span className="min-w-0 flex-1">{error}{failedResultRefresh ? ' النتائج المعروضة لم تتحدّث وتخص النطاق السابق.' : ''}</span>{failedResultRefresh && query ? <button type="button" onClick={() => { const previousObjective = lastSuccessfulQueryObjective.current; setQ(query); setObjective(previousObjective); void runSearchIn(query, city, undefined, previousObjective, filters) }} className={`shrink-0 underline ${FOCUS_RING}`}>إعادة البحث السابق</button> : null}{!failedResultRefresh && !hasTargetQuery && city ? <button type="button" disabled={busy} onClick={() => void loadBrowse(city, filters)} className={`shrink-0 underline disabled:opacity-60 ${FOCUS_RING}`}>إعادة تحميل السوق</button> : null}</div> : null
  const understood = chips.length ? (
    <div className={mobile ? '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1' : 'flex flex-wrap items-center gap-2'}>
      {mobile ? null : <span className="flex items-center gap-1.5 text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)]"><Icon name="bolt" size={16} />فهمنا طلبك كذا:</span>}
      {chips.map((c) => (
        <button key={c} type="button" onClick={() => input.current?.focus()} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-bg-surface)] px-3 py-1 text-[13px] leading-[20px] font-medium whitespace-nowrap ${FOCUS_RING}`}>
          {mobile ? c.replace(/^[^:]+:\s*/, '') : c}<Icon name="edit" size={13} />
        </button>
      ))}
    </div>
  ) : null
  const searchForm = (
    <form role="search" onSubmit={search} className={`flex w-full items-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] ${mobile ? 'py-1 ps-3 pe-1' : 'py-1.5 ps-4 pe-1.5'} shadow-[var(--farq-card-shadow)] focus-within:border-[var(--map-ink)]`}>
      <SearchIcon size={mobile ? 18 : 20} className="text-[var(--color-icon-secondary)]" />
      <label className="sr-only" htmlFor="targeting-q">وش تبي توصل له؟</label>
      <input id="targeting-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={objective === 'marketing' ? (mobile ? SELL_PLACEHOLDER_SHORT : SELL_PLACEHOLDER) : (mobile ? BUY_PLACEHOLDER_SHORT : BUY_PLACEHOLDER)}
        className={`min-w-0 flex-1 bg-transparent ${mobile ? 'text-[16px]' : 'text-[17px]'} leading-[28px] outline-none placeholder:text-[var(--color-text-tertiary)]`} />
      {(query || q.trim() || Object.values(filters).some(Boolean) || chosenD.size || streetPick.kind !== 'all' || focus || site) ? <button type="button" aria-label="مسح الكل وعرض سوق المدينة" title="مسح الكل" disabled={busy} onClick={clearMapToCity} className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--color-icon-secondary)] hover:bg-[var(--color-bg-surface-2)] disabled:opacity-50 ${FOCUS_RING}`}><Icon name="x" size={16} /></button> : null}
      <Button type="submit" variant="Primary" size={mobile ? 'S' : 'M'} disabled={(!q.trim() && !query.trim() && objective !== 'marketing') || !city || busy} loading={busyKind === 'search'} loadingLabel={mobile ? 'بحث…' : 'جارٍ البحث…'}>ابحث</Button>
    </form>
  )
  const mapScopeControl = (
    <div role="group" aria-label="اختر مدينة أو حياً أو شارعاً للخريطة" className={`grid min-w-0 grid-cols-3 rounded-full bg-[var(--color-bg-surface-2)] p-1 ${mobile ? 'w-full' : 'w-[330px] shrink-0'}`}>
      <FilterPill id="map-scope-city" label={cityName(city) || 'المدينة'} icon={CityIcon} analyticsKey="city" options={cities.map((item) => ({ value: item.en, text: item.ar || item.en }))} emptyText={cities.length ? 'ما لقينا مدينة بهذا الاسم.' : 'جار تحميل قائمة المدن…'} disabled={busy} mobile={mobile} portalMenu={focusMode} active={mapScope === 'city'} buttonClassName="min-h-10 w-full min-w-0 justify-center border-transparent bg-transparent px-1.5 text-[12px] shadow-none hover:bg-[var(--color-bg-surface)]/70 md:text-[13px]" onOpen={() => chooseMapScope('city')} onPick={(value) => { pickCity(value); setMapScope('city') }} />
      <FilterPill id="map-scope-district" label={chosenList[0]?.ar || filters.district || 'الحي'} icon={DistrictIcon} analyticsKey="district" options={districtScopeOptions} emptyText={districts.length ? 'ما لقينا حياً بهذا الاسم.' : polys === null ? 'جار تحميل أحياء المدينة…' : 'لا تتوفر أحياء للاختيار في هذه المدينة حالياً.'} disabled={busy || !city} mobile={mobile} portalMenu={focusMode} openRequest={districtPickerOpenRequest} active={mapScope === 'district'} buttonClassName="min-h-10 w-full min-w-0 justify-center border-transparent bg-transparent px-1.5 text-[12px] shadow-none hover:bg-[var(--color-bg-surface)]/70 md:text-[13px]" onOpen={() => chooseMapScope('district')} onPick={selectDistrictFromScope} />
      <FilterPill id="map-scope-street" label={pickedStreet?.props.street_ar || filters.street || 'الشارع'} icon={StreetIcon} analyticsKey="street" options={streetScopeOptions.length ? streetScopeOptions : denseList.map((item) => ({ value: `density:${item.id}`, text: `${item.props.street_ar} · ${item.props.district_ar || cityName(city)}` }))} emptyText={streetScopeOptions.length || denseList.length ? 'ما لقينا شارعاً بهذا الاسم.' : res === null ? 'جار تحميل قائمة الشوارع…' : 'لا توجد شوارع متاحة ضمن النطاق الحالي.'} disabled={busy || !city} mobile={mobile} portalMenu={focusMode} active={mapScope === 'street'} buttonClassName="min-h-10 w-full min-w-0 justify-center border-transparent bg-transparent px-1.5 text-[12px] shadow-none hover:bg-[var(--color-bg-surface)]/70 md:text-[13px]" onOpen={() => chooseMapScope('street')} onPick={(value) => value.startsWith('density:') ? pickStreet(value.slice('density:'.length)) : pickStreetFromScope(value)} />
    </div>
  )
  const searchWithScope = <div className={`flex ${mobile ? 'flex-col items-stretch gap-2' : 'items-center gap-3'}`}>
    <div className="min-w-0 flex-1">{searchForm}</div>
    {mapScopeControl}
  </div>
  const cancelActiveSearch = () => {
    if (busyKind !== 'search') return
    // Ignore the in-flight response and give control back immediately. The
    // directory request may still complete server-side, but it can no longer
    // overwrite this page or leave its controls disabled.
    generation.current += 1
    setBusyKind(null)
    setFailedResultRefresh(false)
    setError('أوقفنا البحث الجاري. عدّل النطاق ثم ابحث مرة أخرى.')
  }

  const searchStatus = busy ? (
    <p role="status" aria-live="polite" aria-atomic="true" className="flex items-center justify-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-3 py-1.5 text-[12px] leading-[18px] text-[var(--color-text-secondary)] shadow-sm backdrop-blur-md">
      <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
      <span>{busyKind === 'browse' ? 'جارٍ تحميل منشآت السوق على الخريطة…' : busyKind === 'more' ? 'جارٍ تحميل نتائج إضافية…' : buyerProductProgress ? `نبحث عن المشترين لـ ${n(buyerProductProgress.completed)} من ${n(buyerProductProgress.total)} منتج…` : 'جارٍ تحديث نتائج البحث على الخريطة…'}</span>
      {busyKind === 'search' ? <button type="button" onClick={cancelActiveSearch} className={`shrink-0 underline ${FOCUS_RING}`}>إيقاف البحث</button> : null}
    </p>
  ) : null

  if (focusMode) {
    return (
      <div data-testid="map-focus-shell" className="fixed inset-0 z-[110] flex h-dvh flex-col overflow-hidden bg-[var(--map-land)]">
        <div className="relative min-h-0 flex-1">{mapBlock}</div>
        <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex justify-center">
          <div className="pointer-events-auto flex w-full max-w-[760px] flex-col gap-2 rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 p-2 shadow-lg backdrop-blur">
            {searchWithScope}
            {searchStatus}
            <div className={`flex gap-2 ${mobile ? 'flex-col items-stretch' : 'items-center'}`}>
              <div className={`min-w-0 ${mobile ? 'w-full' : 'flex-1'}`}>{direction}</div>
              <div className="flex items-center justify-between gap-2">
                <button type="button" aria-expanded={focusPanelOpen} aria-controls="map-focus-panel"
                  onClick={() => {
                    const nextOpen = !focusPanelOpen
                    setFocusPanelOpen(nextOpen)
                    recordMapInteraction(nextOpen ? 'map_sheet_open' : 'map_sheet_close')
                    if (nextOpen) setSheetSnap('peek')
                  }}
                  className={`min-h-11 shrink-0 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px] font-medium shadow-sm md:min-h-8 ${FOCUS_RING}`}>
          {focusPanelOpen ? 'إخفاء اللوحة' : buyerProductMode ? `مرشحو منتجاتك · ${n(res?.total || 0)}` : hasTargetQuery ? `النتائج · ${resultCountSummary}` : hasAudienceBrowse ? `دليل المدينة · ${n(res?.total || 0)}` : 'ابدأ البحث'}
                </button>
                <button type="button" onClick={() => changeFocusMode(false)} aria-label="العودة لتخطيط الصفحة"
                  className={`min-h-11 shrink-0 rounded-full bg-[var(--color-bg-surface-2)] px-3 py-2 text-[13px] font-medium md:min-h-8 ${FOCUS_RING}`}>
                  رجوع للتخطيط
                </button>
              </div>
            </div>
            {errorLine}
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-3 start-3 z-20 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 px-3 py-1.5 text-[12px] font-medium shadow-sm">
          {lens === 'market' ? `منشآت مرصودة · ${marketStats ? n(marketStats.total) : marketLoading ? '…' : '—'}` : buyerProductMode ? `مرشحو منتجاتك · ${n(res?.total || 0)}` : hasTargetQuery ? `نتائج · ${resultCountSummary}` : hasAudienceBrowse ? `دليل المدينة · ${n(res?.total || 0)}` : lens === 'sellers' ? 'ابدأ البحث عن مورد' : 'ابدأ البحث عن مشترين'}
          {chosenNames.length ? ` · ${n(chosenNames.length)} ${chosenNames.length === 1 ? 'حي محدد' : 'أحياء محددة'}` : ''}
        </div>
        {focusPanelOpen ? (
          <aside id="map-focus-panel" aria-label="النتائج والدليل" style={mobile ? { height: `calc(${focusPanelSnap === 'peek' ? 15 : focusPanelSnap === 'full' ? 95 : 58}dvh + env(safe-area-inset-bottom))` } : undefined} className={`absolute z-30 flex flex-col overflow-hidden border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 shadow-2xl backdrop-blur-md transition-[height] duration-300 motion-reduce:transition-none ${mobile ? 'inset-x-0 bottom-0 max-h-[calc(100dvh-env(safe-area-inset-top))] rounded-t-2xl pb-[env(safe-area-inset-bottom)]' : 'inset-y-3 end-3 top-[116px] w-[min(400px,calc(100vw-24px))] rounded-2xl'}`}>
            {mobile ? <button type="button" aria-expanded={focusPanelSnap !== 'peek'} aria-label={
              focusPanelSnap === 'peek' ? 'لوحة النتائج مختصرة؛ اضغط لعرض التفاصيل' : focusPanelSnap === 'half' ? 'لوحة النتائج بارتفاع متوسط؛ اضغط لتوسيعها بالكامل' : 'لوحة النتائج بكامل الشاشة؛ اضغط لتصغيرها'
            } onClick={() => {
              if (panelDidDrag.current) { panelDidDrag.current = false; return }
              setSheetSnap(focusPanelSnap === 'peek' ? 'half' : focusPanelSnap === 'half' ? 'full' : 'peek')
            }} onPointerDown={(event) => { panelDragStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerUp={(event) => {
              if (panelDragStart.current == null) return
              const delta = event.clientY - panelDragStart.current
              panelDragStart.current = null
              if (Math.abs(delta) < 28) return
              panelDidDrag.current = true
              setSheetSnap(delta < 0 ? focusPanelSnap === 'peek' ? 'half' : 'full' : focusPanelSnap === 'full' ? 'half' : 'peek')
            }} className={`flex h-11 shrink-0 touch-none items-center justify-center ${FOCUS_RING}`}><span aria-hidden className="h-1.5 w-10 rounded-full bg-[var(--color-border-strong)]" /></button> : null}
            {mobile && focusPanelSnap === 'peek' ? (
              <div className="flex min-h-0 items-center justify-between gap-2 px-4 pb-3">
                <p className="m-0 truncate text-[13px] font-medium text-[var(--color-text-secondary)]">{lens === 'market' ? `ملخص السوق · ${marketStats ? n(marketStats.total) : marketLoading ? '…' : '—'} منشأة` : buyerProductMode ? `مرشحو منتجاتك · ${n(res?.total || 0)}` : hasTargetQuery ? `النتائج · ${resultCountSummary}` : hasAudienceBrowse ? `دليل المدينة · ${n(res?.total || 0)}` : lens === 'sellers' ? 'ابحث عن مورد' : 'اكتشف المشترين'}</p>
                <button type="button" onClick={() => setSheetSnap('half')} className={`min-h-11 shrink-0 rounded-full bg-[var(--color-bg-surface-2)] px-3 py-1.5 text-[13px] font-semibold md:min-h-8 ${FOCUS_RING}`}>عرض التفاصيل</button>
              </div>
            ) : <>
              {panelHead}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panelBody}</div>
            </>}
          </aside>
        ) : null}
        {tray ? <div className="absolute inset-x-3 bottom-3 z-30 flex justify-center"><div className="w-full max-w-[700px]">{tray}</div></div> : null}
        {noticeLine ? <div className="absolute inset-x-3 bottom-3 z-40 flex justify-center"><div className="w-full max-w-[700px]">{noticeLine}</div></div> : null}
        {profile && byKey.get(profile) ? <ProfileDrawer row={byKey.get(profile)!} mobile={mobile} onClose={() => setProfile(null)} chosen={selected.has(profile)} onChoose={() => toggle(byKey.get(profile)!)} onRequestQuote={lens === 'sellers' && onRfq ? () => prepareQuoteForProfile(profile) : undefined} /> : null}
        {confirmSheet}
        {startSheet}
      </div>
    )
  }

  if (mobile) {
    return (
      <div className={`flex min-w-0 flex-col gap-3 bg-[var(--color-bg-canvas)] px-4 pt-4 pb-6 ${mobile ? `map-compact-scroll-layout ${lens !== 'market' ? 'map-targeting-lens' : ''}` : ''}`}>
        <h1 className="sr-only">خريطة الفرص</h1>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {direction}
          <div className="flex gap-1">
            <Button variant="Ghost" size="S" icon={NewRequestIcon} onClick={() => setStartOpen(true)}>طلب جديد</Button>
            <Button variant="Ghost" size="S" icon={MessageTemplatesIcon} onClick={onTemplates}>القوالب</Button>
          </div>
        </div>
        {searchWithScope}
        {searchStatus}
        {errorLine}
        {areaBar}
        {mapBlock}
        {suggestBar}
        {understood}
        {linesPanel}
        {fileField}
        {lens !== 'market' ? <StepStrip current={step} mobile /> : null}
        <Counters items={displayCounters} compact selectedMainId={selectedMainId} selectedCounterKey={selectedSummaryCounterKey} onActivitySelect={selectMainFromCounter} onCounterSelect={selectSummaryCounter} />
        {tray}
        {noticeLine}
        <section ref={resultsPanelRef} aria-label="النتائج والدليل" className={`${mobile ? 'map-compact-results-panel ' : ''}-mx-4 flex flex-col bg-[var(--color-bg-surface)] scroll-mt-3`}>
          <div className={mobile ? 'map-compact-results-panel-scroll' : ''}>
            {panelHead}
            {panelBody}
          </div>
        </section>
        {profile && byKey.get(profile) ? <ProfileDrawer row={byKey.get(profile)!} mobile onClose={() => setProfile(null)} chosen={selected.has(profile)} onChoose={() => toggle(byKey.get(profile)!)} onRequestQuote={lens === 'sellers' && onRfq ? () => prepareQuoteForProfile(profile) : undefined} /> : null}
        {confirmSheet}
        {startSheet}
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh min-w-0 flex-col bg-[var(--color-bg-canvas)]">
      <header className="flex flex-col gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
          <h1 className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">خريطة السوق — FARQ B2B</h1>
            {direction}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="Primary" size="S" icon={NewRequestIcon} onClick={() => setStartOpen(true)}>طلب جديد</Button>
            <Button variant="Secondary" size="S" icon={MessageTemplatesIcon} onClick={onTemplates}>قوالب واتساب</Button>
          </div>
          {fileField}
        </div>
        {searchWithScope}
        <TargetingAssistant city={city} cityLabel={cityName(city)} mobile={mobile} onUnderstand={understandAssistantPrompt} onPrepare={prepareAssistantDraft} onOpenDraft={() => { setDraftOpenRequest((value) => value + 1); requestAnimationFrame(() => document.querySelector('[data-testid=campaign-tray]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })) }} />
        {searchStatus}
        {understood}
        {suggestBar}
        {areaBar}
        {errorLine}
        {linesPanel}
      </header>
      <div className="flex min-h-[42rem] flex-1 flex-row">
        <>
          <aside id="targeting-results-panel" hidden={!resultsPanelOpen} aria-label="النتائج والدليل" style={{ width: `${resultsPanelWidth}px` }} className="relative flex shrink-0 flex-col border-e border-[var(--color-border-default)] bg-[var(--color-bg-surface)] transition-[width] duration-150">
            <div className="flex items-center justify-end px-3 pt-2">
              <Button type="button" variant="Ghost" size="S" aria-expanded="true" aria-controls="targeting-results-panel" onClick={() => { setResultsPanelOpen(false); recordMapInteraction('map_results_panel_hide') }}>إخفاء اللوحة</Button>
            </div>
            {panelHead}
            <div className="min-h-0 flex-1 overflow-y-auto">{panelBody}</div>
          </aside>
          <div hidden={!resultsPanelOpen} role="separator" aria-label="تغيير عرض لوحة النتائج" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={560} aria-valuenow={resultsPanelWidth} tabIndex={0}
            onPointerDown={(event) => { panelResizeStart.current = { x: event.clientX, width: resultsPanelWidth }; event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerMove={(event) => {
              const start = panelResizeStart.current
              if (!start) return
              const direction = document.documentElement.dir === 'rtl' ? -1 : 1
              setResultsPanelWidth(Math.max(300, Math.min(560, start.width + direction * (event.clientX - start.x))))
            }}
            onPointerUp={() => { panelResizeStart.current = null }} onPointerCancel={() => { panelResizeStart.current = null }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              const rtl = document.documentElement.dir === 'rtl'
              const grow = rtl ? event.key === 'ArrowLeft' : event.key === 'ArrowRight'
              setResultsPanelWidth((width) => Math.max(300, Math.min(560, width + (grow ? 24 : -24))))
            }}
            className={`z-10 flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none hover:bg-[var(--color-bg-primary-subtle)] focus-visible:bg-[var(--color-bg-primary-subtle)] ${FOCUS_RING}`}>
            <span aria-hidden className="h-10 w-1 rounded-full bg-[var(--color-border-strong)]" />
          </div>
        </>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          {!resultsPanelOpen ? <div className="flex items-center justify-start">
            <Button type="button" variant="Secondary" size="S" aria-expanded="false" aria-controls="targeting-results-panel" onClick={() => { setResultsPanelOpen(true); recordMapInteraction('map_results_panel_show') }}>عرض النتائج والدليل</Button>
          </div> : null}
          {lens !== 'market' ? <StepStrip current={step} mobile={false} /> : null}
          <Counters items={displayCounters} selectedMainId={selectedMainId} selectedCounterKey={selectedSummaryCounterKey} onActivitySelect={selectMainFromCounter} onCounterSelect={selectSummaryCounter} />
          {mapBlock}
          {noticeLine}
          {tray}
        </main>
      </div>
      {confirmSheet}
      {startSheet}
    </div>
  )
}

/** A compact, map-friendly filter control whose menu floats over results instead of shifting them. */
function FilterPill({ id, label, icon: IconComponent, analyticsKey, options, emptyText, disabled, mobile, onPick, active = false, buttonClassName = '', onOpen, portalMenu = false, openRequest = 0 }: {
  id: string
  label: string
  icon: typeof DistrictIcon | null
  analyticsKey: 'city' | 'district' | 'street' | 'role' | 'specialty' | 'site_radius'
  options: { value: string; text: string }[]
  emptyText?: string
  disabled: boolean
  mobile: boolean
  onPick: (value: string) => void
  active?: boolean
  buttonClassName?: string
  onOpen?: () => void
  /** In expanded-map mode, render above the map's stacking context and anchor to the trigger. */
  portalMenu?: boolean
  /** Open the menu when a related summary counter is activated. */
  openRequest?: number
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchUsed = useRef(false)
  const handledOpenRequest = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const menuRoot = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) {
      searchUsed.current = false
      setSearch('')
    }
  }, [open])
  useEffect(() => {
    if (!openRequest || openRequest === handledOpenRequest.current) return
    handledOpenRequest.current = openRequest
    setOpen(true)
    setSearch('')
    onOpen?.()
    recordMapInteraction(`map_filter_open_${analyticsKey}`)
  }, [openRequest, onOpen, analyticsKey])
  useEffect(() => {
    if (!open) return
    const modalMenu = mobile && !portalMenu
    const priorFocus = modalMenu ? trigger.current : null
    const dialog = modalMenu ? document.getElementById(`${id}-options`) : null
    if (modalMenu) {
      const searchInput = dialog?.querySelector<HTMLInputElement>('input:not([disabled])')
      if (searchInput) searchInput.focus()
      else dialog?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menuRoot.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); return }
      if (!modalMenu || event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
      if (!focusable.length) { event.preventDefault(); return }
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    if (modalMenu) return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (priorFocus?.isConnected) priorFocus.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown) }
  }, [open, mobile, id, portalMenu])
  const choose = (value: string) => {
    setOpen(false)
    setSearch('')
    trigger.current?.focus()
    recordMapInteraction(`map_filter_select_${analyticsKey}`)
    onPick(value)
  }
  const updateSearch = (value: string) => {
    if (value.trim() && !searchUsed.current) {
      searchUsed.current = true
      recordMapInteraction('map_filter_search_used')
    }
    setSearch(value)
  }
  const optionList = (className: string) => (
    <Command label={label} loop>
      {options.length >= 8 ? (
        <label className="mx-1 mb-1 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3">
          <SearchIcon size={16} className="shrink-0 text-[var(--color-icon-secondary)]" />
          <Command.Input value={search} onValueChange={updateSearch} aria-label={`ابحث في ${label}`} placeholder={`ابحث في ${label}`} className="!min-h-0 min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0 text-[14px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
          {search ? <button type="button" aria-label="مسح البحث" onClick={() => setSearch('')} className={`shrink-0 rounded-full p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}><Icon name="x" size={13} /></button> : null}
        </label>
      ) : null}
      <Command.List className={className}>
        {options.map((option) => <Command.Item key={option.value} value={`${option.text} ${option.value}`} onSelect={() => choose(option.value)} className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-start text-[14px] leading-[22px] text-[var(--color-text-primary)] data-[selected=true]:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>
          <span className="min-w-0 flex-1 truncate">{option.text}</span>
          <Icon name="chevron-back" size={14} className="shrink-0 text-[var(--color-icon-secondary)]" />
        </Command.Item>)}
        <Command.Empty className="px-3 py-5 text-center text-[13px] leading-[20px] text-[var(--color-text-secondary)]">{emptyText || 'ما لقينا خياراً بهذا الاسم. جرّب كلمة أقصر.'}</Command.Empty>
      </Command.List>
    </Command>
  )
  const menu = open ? portalMenu ? (() => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return null
    const width = Math.min(352, window.innerWidth - 16)
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - Math.min(360, window.innerHeight * 0.55) - 8))
    return createPortal(
      <div ref={menuRoot} id={`${id}-options`} role="dialog" aria-label={label} dir="rtl" style={{ position: 'fixed', top, left, width }} className="z-[180] max-h-[55dvh] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 p-2 shadow-2xl backdrop-blur-xl">
        {optionList('max-h-[min(45dvh,22rem)] overflow-y-auto overscroll-contain')}
      </div>, document.body,
    )
  })() : mobile ? createPortal(
    <div className="fixed inset-0 z-[160] flex items-end bg-black/25" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section id={`${id}-options`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="flex max-h-[70dvh] w-full flex-col overflow-hidden rounded-t-[24px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 shadow-2xl backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <button type="button" aria-label="إغلاق قائمة الخيارات" onClick={() => setOpen(false)} className={`flex h-11 shrink-0 touch-none items-center justify-center ${FOCUS_RING}`}><span aria-hidden className="h-1.5 w-10 rounded-full bg-[var(--color-border-strong)]" /></button>
        <h2 id={`${id}-title`} className="px-5 pb-2 text-[16px] font-semibold">{label}</h2>
        {optionList('min-h-0 overflow-y-auto overscroll-contain px-3 pb-3')}
      </section>
    </div>, document.body,
  ) : (
    <div id={`${id}-options`} role="dialog" aria-label={label} className="absolute start-0 top-[calc(100%+8px)] z-50 max-h-[55dvh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 p-2 shadow-2xl backdrop-blur-xl">
      {optionList('max-h-[min(45dvh,22rem)] overflow-y-auto overscroll-contain')}
    </div>
  ) : null
  return (
    <div ref={root} className="relative shrink-0">
      <button ref={trigger} id={id} type="button" aria-haspopup={mobile ? 'dialog' : 'true'} aria-expanded={open} aria-controls={`${id}-options`} data-active={active || undefined} disabled={disabled} onClick={() => { const nextOpen = !open; setOpen(nextOpen); if (nextOpen) { setSearch(''); onOpen?.(); recordMapInteraction(`map_filter_open_${analyticsKey}`) } }}
        className={`inline-flex min-h-11 max-w-[min(13rem,78vw)] items-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-3 py-2 text-[14px] leading-[20px] font-medium text-[var(--color-text-secondary)] shadow-sm backdrop-blur-md hover:border-[var(--color-border-strong)] disabled:opacity-50 md:min-h-10 ${buttonClassName} ${active ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm' : ''} ${FOCUS_RING}`}>
        {IconComponent ? <IconComponent size={16} className="shrink-0 text-[var(--color-icon-secondary)]" /> : null}
        <span className="truncate">{label}</span>
        <Icon name="chevron-down" size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  )
}
