import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  districtCounts, hasUnconfirmedStatus, listCities, listDistricts, listTemplates, mapProfile, marketSummary, searchTargets, streetCatalog, streetDensity, whoBuys, type DistrictCount, type MarketSummary, type WhoBuys, type StreetCatalog, type StreetDensityQuery, templateFits, templateStatus, tradeClusters, waNumber, statusLabel, TargetingError, OUTREACH_TEMPLATE,
  type City, type MetaTemplate, type SearchFilters, type TargetRow, type TargetSearch, type TemplateStatus, type TradeCluster,
} from '../../api/targetingClient'
import {
  Badge, Button, ChannelBadge, Chip, CityIcon, ClustersIcon, DistrictIcon, ErrorIcon, FiltersIcon, Icon, MessageTemplatesIcon, NewRequestIcon,
  SaudiEstablishmentBadge, SearchIcon, SpecialtiesIcon, StreetIcon, SuccessIcon, SupplierIcon, UploadCatalogIcon, useIsMapCompact, WarningIcon, WholesaleIcon, type Channel,
} from '../../ui'
import { FOCUS_RING } from '../../ui/cx'
import { BUY_EXAMPLES, BUY_PLACEHOLDER, BUY_PLACEHOLDER_SHORT, cityCoords, marketNameFor, marketSuggestions, SELL_EXAMPLES, SELL_PLACEHOLDER, SELL_PLACEHOLDER_SHORT } from '../../lib/saudi'
import { readBooklet, type BookletLine } from '../../lib/readBooklet'
import { handoff, HANDOFF } from '../../lib/handoff'
import { mapAnalyticsConsent, mapReadinessEvent, mapResultProfileOpenEvent, mapSearchFailedEvent, mapSearchLatencyEvent, mapSearchOutcomeEvent, mapSearchResultEvent, mapSearchRetryEvent, mapSearchStartedEvent, mapWholesaleFilterOutcomeEvent, recordMapInteraction } from '../../lib/mapAnalytics'
import { writeLocal } from '../../b2b/storage'
import { fetchConstructionWhatsAppPricing } from '../../api/constructionClient'
import { createOpportunityRequest, type OpportunityRequestKind } from '../../api/opportunityRequestsClient'
import CampaignConfirmSheet from './CampaignConfirmSheet'
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
import { directoryActivityQuery, hasDirectoryActivityEvidence, MAX_MAP_INTENTS, parseMapIntents, type MapIntent } from './multiIntent'

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

export const channelOf = (r: TargetRow): Channel => (waNumber(r) ? 'WhatsApp' : r.email ? 'Email' : 'Unreachable')
const n = (v: number) => v.toLocaleString('ar-SA')
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
/** The narrowing filters under the search bar: district, street, wholesale (manual only), role and specialty. */
type AreaFilters = Pick<SearchFilters, 'district' | 'street' | 'wholesale' | 'role' | 'specialty'>
const clusterName = (c: TradeCluster) => [c.level === 'street' ? safeLocationName(c.street_ar) : null, safeLocationName(c.district_ar)].filter(Boolean).join('، ') || c.label_ar
/** «سوق الزل للأقمشة — الديرة · 230 منشأة» when a curated popular name fits; otherwise «الشارع، الحي — 37 منشأة». */
const clusterText = (c: TradeCluster) => (c.popular_ar ? `${c.popular_ar} — ${clusterName(c)} · ${n(c.n)} منشأة` : `${clusterName(c)} — ${n(c.n)} منشأة`)

function defaultMessage(cat: string | null, area: string | null) {
  return `معك أحمد من فرق. يوصلنا طلبات تسعير${cat ? ` ${cat}` : ''} من منشآت وشركات${area ? ` في ${area}` : ''} — تبي توصلك على واتساب؟\nللإيقاف أرسل: إيقاف`
}
const boxAround = (lat: number, lon: number, d = 0.012): [number, number, number, number] => [lon - d, lat - d, lon + d, lat + d]

export default function TargetingPage({ onTemplates, onMapFocusChange, startNew = false, onStartClosed, onRfq }: {
  onTemplates: () => void
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
  const [busyKind, setBusyKind] = useState<'search' | 'browse' | 'more' | null>(null)
  const busy = busyKind !== null
  const [error, setError] = useState<string | null>(null)
  const [failedResultRefresh, setFailedResultRefresh] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedRows, setSelectedRows] = useState<Map<string, TargetRow>>(new Map())
  const [multiIntents, setMultiIntents] = useState<{ intent: MapIntent; rows: TargetRow[]; total: number; nextOffset: number | null; excludedCount: number }[]>([])
  const [multiPending, setMultiPending] = useState<Map<string, TargetRow>>(new Map())
  const [highlightedPinKey, setHighlightedPinKey] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [fitFilter, setFitFilter] = useState<PinFit | 'all'>('all')
  const [message, setMessage] = useState(defaultMessage(null, null))
  const [tpl, setTpl] = useState<TemplateStatus | null>(null)
  const [tplError, setTplError] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [filters, setFilters] = useState<AreaFilters>({})
  const [clusters, setClusters] = useState<{ list: TradeCluster[]; basis?: string } | null>(null)
  // the densest streets of this request, drawn along the street (POST /street-density); the one picked
  const [dense, setDense] = useState<{ list: Street[]; basis?: string } | null>(null)
  const [denseLoadError, setDenseLoadError] = useState(false)
  const [denseRetry, setDenseRetry] = useState(0)
  const [activeStreet, setActiveStreet] = useState<string | null>(null)
  // which streets: all activities (on open), one main, some subs, or the typed request; districts narrow them
  type StreetPick = { kind: 'all' } | { kind: 'main'; id: string } | { kind: 'sub'; ids: (string | number)[]; main: string } | { kind: 'q'; q: string; objective: string }
  const [streetPick, setStreetPick] = useState<StreetPick>({ kind: 'all' })
  const [catalog, setCatalog] = useState<StreetCatalog['mains'] | null>(null)
  const [activityMenuOpen, setActivityMenuOpen] = useState(false)
  const [activitySearch, setActivitySearch] = useState('')
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
  const clearAreas = () => { clusterGen.current++; setFilters({}); setClusters(null); setStreetPick({ kind: 'all' }); setActiveStreet(null); setFocus(null) }
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
  const [marketStats, setMarketStats] = useState<MarketSummary['summary'] | null>(null)
  const [marketDistrictCounts, setMarketDistrictCounts] = useState<DistrictCount[]>([])
  const [marketLoading, setMarketLoading] = useState(true)
  const [marketError, setMarketError] = useState(false)
  const [marketRetry, setMarketRetry] = useState(0)
  const [buyerData, setBuyerData] = useState<{ key: string; data: WhoBuys } | null>(null)
  const [includeCommonBuyers, setIncludeCommonBuyers] = useState(false)
  const resetAll = () => { generation.current++; setRes(null); clearAreas(); setSelected(new Set()); setSelectedRows(new Map()); setMultiIntents([]); setMultiPending(new Map()); setActiveLine(null); setLines((ls) => ls.map(({ found: _found, ...line }) => line)); setError(null); setFailedResultRefresh(false); setConfirming(false); setProfile(null); setShowUnlocated(false) }
  const pickCity = (v: string) => { resetAll(); setMarketLoading(true); setCity(v); setChosenD(new Set()); setSite(null); setFit(null) }

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
  const chosenNames = useMemo(() => (polys && polys.length ? polys : []).filter((d) => chosenD.has(d.id)).map((d) => d.ar).concat([...chosenD].filter((id) => id.startsWith('name:')).map((id) => id.slice(5))).sort(), [polys, chosenD])
  const chosenKey = chosenNames.join('|')
  const buyerSubIds = streetPick.kind === 'sub' ? streetPick.ids
    : focus?.level === 'sub' ? [focus.id]
    : streetPick.kind === 'main' ? (catalog?.find((m) => m.main_id === streetPick.id)?.subs || []).map((s) => s.sub_id)
    : (res?.understood?.sub_ids || [])
  const buyerQueryKey = lens === 'buyers' && buyerSubIds.length && buyerSubIds.length <= 50 ? `${city}|${buyerSubIds.join('|')}` : ''
  useEffect(() => {
    if (!city || lens !== 'market') return
    let active = true
    const filter = streetPick.kind === 'main' ? { main_id: streetPick.id }
      : streetPick.kind === 'sub' ? { sub_ids: streetPick.ids } : {}
    const query = { city, ...filter, ...(chosenNames.length ? { districts: chosenNames } : {}) }
    setMarketLoading(true)
    setMarketError(false)
    setMarketStats(null)
    setMarketDistrictCounts([])
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
      const value = await marketSummary(query)
      if (!value?.summary) throw new Error('Market summary unavailable')
      return value
    }
    const loadCounts = async () => {
      const value = await districtCounts(query)
      if (!value?.ok) throw new Error('District counts unavailable')
      return value
    }
    Promise.allSettled([withOneRetry(loadSummary), withOneRetry(loadCounts)]).then(([summary, counts]) => {
      if (!active) return
      const summaryValue = summary.status === 'fulfilled' ? summary.value?.summary || null : null
      const districtValues = counts.status === 'fulfilled' && counts.value?.ok ? counts.value.districts || [] : null
      setMarketStats(summaryValue)
      setMarketDistrictCounts(districtValues || [])
      setMarketError(!summaryValue || districtValues == null)
    }).finally(() => { if (active) setMarketLoading(false) })
    return () => { active = false }
  }, [city, lens, streetPick, chosenNames, marketRetry])
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
    const v = ++streetGen.current
    const body: StreetDensityQuery = { city, ...(streetPick.kind === 'main' ? { main_id: streetPick.id } : streetPick.kind === 'sub' ? { sub_ids: streetPick.ids } : streetPick.kind === 'q' ? { q: streetPick.q, objective: streetPick.objective } : {}), ...(chosenNames.length ? { districts: chosenNames } : {}) }
    setDense(null)
    setDenseLoadError(false)
    recordMapInteraction('map_street_density_started')
    streetDensity(body).then((d) => {
      if (v !== streetGen.current) return
      const list = streetsFrom(d)
      setDense({ list, basis: d?.basis })
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
  }, [city, pickKey, chosenKey, denseRetry]) // eslint-disable-line react-hooks/exhaustive-deps
  const retryStreetDensity = () => {
    recordMapInteraction('map_street_density_retry')
    setDenseRetry((retry) => retry + 1)
  }
  useEffect(() => {
    if (!city) return
    let on = true
    streetCatalog({ city, ...(chosenNames.length ? { districts: chosenNames } : {}) }).then((c) => { if (on) setCatalog(c?.mains || []) }, () => { if (on) setCatalog(null) })
    return () => { on = false }
  }, [city, chosenKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => res?.rows || [], [res])
  const byKey = useMemo(() => new Map(rows.map((r) => [r.poi_key, r])), [rows])
  const hasPolys = Boolean(polys && polys.length)
  const districts = useMemo<District[]>(() => (hasPolys ? polys! : districtsFromNames(res?.areas?.districts || [])), [hasPolys, polys, res])
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
  const resultCountSummary = res ? `${n(visibleCohort.length)} ضمن الدفعة · ${n(res.total)} إجمالاً` : n(visibleCohort.length)
  const unconfirmedStatusCount = useMemo(() => visibleCohort.filter(hasUnconfirmedStatus).length, [visibleCohort])
  const unverifiedWhatsappCount = useMemo(() => visibleCohort.filter((row) => channelOf(row) === 'WhatsApp' && row.whatsapp_verification_state !== 'verified').length, [visibleCohort])
  const statusNoticeKey = res ? `${res.map_query || ''}|${res.total}|${res.rows[0]?.poi_key || ''}|${unconfirmedStatusCount}` : ''
  const lastStatusNoticeKey = useRef('')
  useEffect(() => {
    if (!unconfirmedStatusCount || !statusNoticeKey) { lastStatusNoticeKey.current = ''; return }
    if (statusNoticeKey === lastStatusNoticeKey.current) return
    lastStatusNoticeKey.current = statusNoticeKey
    recordMapInteraction('map_results_status_notice')
  }, [statusNoticeKey, unconfirmedStatusCount])
  const qualityNoticeSeen = useRef(false)
  useEffect(() => {
    if (qualityNoticeSeen.current || mapAnalyticsConsent() !== 'accepted' || !hasTargetQuery || !res || (!unconfirmedStatusCount && !unverifiedWhatsappCount)) return
    qualityNoticeSeen.current = true
    recordMapInteraction('map_data_quality_notice_seen')
  }, [analyticsConsentRevision, hasTargetQuery, res, unconfirmedStatusCount, unverifiedWhatsappCount])
  const counters = useMemo(() => countersOf(visibleCohort, chosenD.size), [visibleCohort, chosenD])
  const displayCounters = useMemo<CounterItem[]>(() => {
    const shownRows = res?.rows || []
    const globalLocationCount = typeof res?.located_total === 'number' && Number.isFinite(res.located_total)
      ? res.located_total : null
    const hasGlobalLocationCount = globalLocationCount != null
    const precise = globalLocationCount ?? shownRows.filter(hasPoint).length
    const withoutPin = res
      ? hasGlobalLocationCount ? Math.max(0, res.total - precise) : shownRows.filter((row) => !hasPoint(row)).length
      : 0
    const locationLabel = hasGlobalLocationCount ? 'لها موقع إجمالاً' : 'لها موقع · محمّلة'
    const missingLocationLabel = hasGlobalLocationCount ? 'بلا دبوس إجمالاً' : 'بلا دبوس · محمّلة'
    const whatsapp = typeof res?.with_whatsapp === 'number' && Number.isFinite(res.with_whatsapp)
      ? res.with_whatsapp : shownRows.filter((row) => Boolean(waNumber(row))).length
    // Search responses describe all matching districts. Once the user narrows to a
    // district, keep this indicator scoped to the visible result set.
    const areas = filters.district ? 1 : chosenD.size || res?.areas?.districts.length || 0
    if (lens === 'market') return [
      { key: 'market-size', label: 'منشآت مرصودة', value: marketStats?.total ?? null, lead: true },
      { key: 'market-districts', label: 'أحياء مغطاة', value: marketStats?.districts_count ?? null },
      { key: 'market-whatsapp', label: 'وسم واتساب من المصدر', value: marketStats?.n_whatsapp ?? null },
      { key: 'market-unlocated', label: 'بلا موقع دقيق', value: marketStats?.n_approx ?? null },
    ]
    if (query && res) return lens === 'sellers' ? [
      { key: 'supplier-matches', label: 'موردون محتملون', value: Number.isFinite(res.total) ? res.total : shownRows.length, lead: true },
      { key: 'supplier-whatsapp', label: 'وسم واتساب من المصدر', value: whatsapp },
      { key: 'supplier-located', label: locationLabel, value: precise },
      { key: 'supplier-unlocated', label: missingLocationLabel, value: withoutPin },
      { key: 'supplier-districts', label: 'أحياء بها نتائج', value: areas },
    ] : [
      { key: 'buyer-matches', label: 'جهات قد تشتري', value: Number.isFinite(res.total) ? res.total : shownRows.length, lead: true },
      { key: 'buyer-whatsapp', label: 'وسم واتساب من المصدر', value: whatsapp },
      { key: 'buyer-located', label: locationLabel, value: precise },
      { key: 'buyer-unlocated', label: missingLocationLabel, value: withoutPin },
      { key: 'buyer-activities', label: 'أنشطة مشترية مرصودة', value: currentBuyerData?.buyers.length || 0 },
    ]
    // Before a specific product/activity is selected, show honest city-wide context instead of invented matches.
    return [
      { key: 'city-places', label: 'منشآت مرصودة', value: marketStats?.total ?? null, lead: true },
      { key: 'city-whatsapp', label: 'وسم واتساب من المصدر', value: marketStats?.n_whatsapp ?? null },
      { key: 'city-districts', label: 'أحياء مغطاة', value: marketStats?.districts_count ?? null },
      { key: 'city-unlocated', label: 'بلا موقع دقيق', value: marketStats?.n_approx ?? null },
    ]
  }, [lens, marketStats, catalog, res, query, currentBuyerData, chosenD, filters.district])
  const guide = useMemo(() => guideOf(areaRows), [areaRows])
  // Keep the city uncluttered until the user chooses an area or an activity; either choice
  // gives the map a useful, bounded cohort to pin even before they pick a district.
  const pins = useMemo(() => (query && (chosenList.length || focus) ? pinsOf(visibleCohort, layer, selected, focus) : []), [query, chosenList, visibleCohort, layer, selected, focus])
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

  const toggleDistrict = (id: string) => {
    const wasChosen = chosenD.has(id)
    recordMapInteraction(wasChosen ? 'map_district_clear' : 'map_district_select')
    const next = wasChosen ? new Set<string>() : new Set([id])
    setChosenD(next)
    const district = districts.find((d) => d.id === id)
    if (!wasChosen && district?.bbox) fitTo(district.bbox)
    else if (wasChosen) fitCity()
    const name = wasChosen ? undefined : district?.ar || id.replace(/^name:/, '')
    if (query) {
      const nextFilters = { ...filters }
      delete nextFilters.district
      delete nextFilters.street
      if (name) nextFilters.district = name
      void runSearchIn(query, city, nextFilters)
    } else {
      const nextFilters = { ...filters }
      delete nextFilters.district
      delete nextFilters.street
      if (name) nextFilters.district = name
      void loadBrowse(city, nextFilters)
    }
  }
  const clearDistrict = () => {
    recordMapInteraction('map_district_clear')
    setChosenD(new Set())
    fitCity()
    if (query) {
      const nextFilters = { ...filters }
      delete nextFilters.district
      delete nextFilters.street
      void runSearchIn(query, city, nextFilters)
    } else {
      const nextFilters = { ...filters }
      delete nextFilters.district
      delete nextFilters.street
      void loadBrowse(city, nextFilters)
    }
  }
  const pickFocus = (f: Focus) => { setFocus(f); setLayer(f?.level || 'main') }

  const citySelect = (cls: string) => (
    <>
      <label className="sr-only" htmlFor="targeting-city">المدينة</label>
      <span className="relative inline-flex shrink-0 items-center">
        <CityIcon size={16} className="pointer-events-none absolute start-2 text-[var(--color-icon-secondary)]" />
        <select id="targeting-city" required value={cities.some((c) => c.en === city) ? city : ''} onChange={(e) => pickCity(e.target.value)} aria-invalid={!city}
          className={`shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] py-1.5 ps-7 pe-2 ${city ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'} ${FOCUS_RING} ${cls}`}>
          <option value="">اختر المدينة</option>
          {cities.map((c) => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}
        </select>
      </span>
    </>
  )
  const chooseLens = (value: 'market' | 'sellers' | 'buyers') => {
    if (value === lens) return
    recordMapInteraction(`map_lens_${value}`)
    if (value === 'market') {
      resetAll(); setQuery(''); setQ(''); setLens('market'); setTab('guide')
      void loadBrowse(city)
      return
    }
    const nextObjective = value === 'buyers' ? 'marketing' : 'purchase'
    setObjective(nextObjective)
    if (q.trim() && city) {
      // Keep the user's current phrase in sync with the direction they just chose.
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

  async function search(e?: FormEvent) {
    e?.preventDefault()
    setActiveLine(null)
    const parsed = parseMapIntents(q.trim())
    if (parsed?.invalid) {
      setError(`ما قدرنا نفصل الطلبات. اكتب كل طلب بصيغة نشاط + حي، وبحد أقصى ${MAX_MAP_INTENTS} طلبات؛ مثال: حلاقين بحي السويدي وابي مطاعم بحي الربيع.`)
      return
    }
    if (parsed?.intents.length) {
      await searchMultipleIntents(q.trim(), parsed.intents)
      return
    }
    await runSearchIn(q.trim(), city)
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
      const unique = new Map<string, TargetRow>()
      for (const group of groups) for (const row of group.rows) if (!unique.has(row.poi_key)) unique.set(row.poi_key, row)
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
      setQuery(text); setQ(text); setShown(PAGE); setFilters({}); setMultiIntents(groups); setMultiPending(new Map()); setTab('results'); setFocus(null); setShowUnlocated(false)
      if (!selected.size) setMessage(defaultMessage(null, cityName(city)))
      const districtIds = intents.map((intent) => polys?.find((district) => normalizeActivityText(district.ar) === normalizeActivityText(intent.district))?.id || `name:${intent.district}`)
      setChosenD(new Set(districtIds))
      if (version === generation.current) {
        const total = [...unique.values()].length
        recordMapInteraction(mapSearchLatencyEvent(performance.now() - startedAt, objective))
        recordMapInteraction(mapSearchResultEvent(total))
        recordMapInteraction(mapSearchOutcomeEvent(total, objective))
      }
    } catch (err) {
      if (version === generation.current) setError(err instanceof TargetingError ? err.message : 'تعذّر إكمال كل طلبات البحث. لم نعرض نتائج جزئية؛ حاول مرة ثانية.')
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
  async function loadBrowse(inCity: string, browseFilters: AreaFilters = {}) {
    if (!inCity) return
    const version = ++generation.current
    const hadResults = Boolean(res)
    setBusyKind('browse'); setError(null); setFailedResultRefresh(false); setProfile(null)
    try {
      const r = await searchTargets('', inCity, FETCH, 'browse', 0, browseFilters)
      if (version !== generation.current) return
      recordMapInteraction('map_browse_succeeded')
      setFailedResultRefresh(false)
      setRes(r); setQuery(''); setFilters(browseFilters); setShown(PAGE)
      setSelected(new Set()); setSelectedRows(new Map()); setMultiIntents([]); setMultiPending(new Map()); setProfile(null)
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
    const requestStartedAt = performance.now()
    if (fresh) recordMapInteraction(mapSearchStartedEvent(obj))
    try {
      const r = await searchTargets(text, inCity, FETCH, obj, 0, use, true, (outcome) => {
        recordMapInteraction(mapSearchRetryEvent(obj, outcome))
      })
      if (version !== generation.current) return null
      setFailedResultRefresh(false)
      lastSuccessfulQueryObjective.current = obj
      if (!fresh && use.wholesale === true && filters.wholesale !== true) recordMapInteraction(mapWholesaleFilterOutcomeEvent(r.total))
      if (fresh) {
        recordMapInteraction(mapSearchLatencyEvent(performance.now() - requestStartedAt, obj))
        recordMapInteraction(mapSearchResultEvent(r.total))
        recordMapInteraction(mapSearchOutcomeEvent(r.total, obj))
      }
      setTab('results')
      setRes(r); setQuery(text); setShown(PAGE); setFilters(use)
      if (fresh) { setSelected(new Set()); setSelectedRows(new Map()); setMultiIntents([]); setMultiPending(new Map()); setFocus(null); setProfile(null); setShowUnlocated(false) }
      else setSelected((cur) => new Set(r.rows.filter((x) => cur.has(x.poi_key)).map((x) => x.poi_key)))
      if (fresh || Boolean(use.wholesale) !== Boolean(filters.wholesale)) loadClusters(text, inCity, Boolean(use.wholesale), obj, keepStreets)
      const p = r.parsed || {}
      const cat = (p.keywords || []).filter(arabic)[0] || null
      if (fresh) setMessage(defaultMessage(cat, cityName(inCity)))
      return r.total
    } catch (err) {
      if (version !== generation.current) return null
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
    if (query) void runSearchIn(query, city, next)
    else void loadBrowse(city, next)
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
    if (d) setChosenD((s) => new Set(s).add(d.id))
    applyFilters({ ...keep(filters, ['district', 'street']), district: c.district_ar, street: c.level === 'street' && c.street_ar ? c.street_ar : undefined })
  }

  /** A dense street (line, its label or the list): zoom to it, choose its district, narrow the results to it, show its card. */
  const pickStreet = (id: string) => {
    const st = dense?.list.find((x) => x.id === id)
    if (!st) return
    recordMapInteraction('map_street_select')
    if (focusMode) {
      if (mobile && !focusPanelOpen) recordMapInteraction('map_sheet_open')
      setFocusPanelOpen(true)
      if (mobile) setSheetSnap('half')
    }
    const [w, so, e, no] = st.bbox, pad = 0.002
    fitTo([w - pad, so - pad, e + pad, no + pad])
    setActiveStreet(id)
    const d = hasPolys ? districtAt(st.mid[0], st.mid[1], districts) : null
    if (d) setChosenD((x) => new Set(x).add(d.id))
    // results for this street: the current request narrowed to it, or (before any search) the street's own trade
    if (query) applyFilters({ ...keep(filters, ['street']), street: st.props.street_ar })
    else { const term = st.props.sub_ar || st.props.main_ar; if (term) { setQ(term); void runSearchIn(term, city, undefined, objective, { street: st.props.street_ar }, true) } }
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
            <button type="button" onClick={() => { setLines([]); setBooklet(null); setActiveLine(null) }} className={`text-[12px] leading-[18px] text-[var(--color-text-tertiary)] hover:underline ${FOCUS_RING}`}>إزالة</button>
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
  const picker = (id: string, label: string, icon: typeof DistrictIcon, options: { value: string; text: string }[], onPick: (v: string) => void) => options.length ? (
    <FilterPill id={id} label={label} icon={icon} analyticsKey={id === 'targeting-district' ? 'district' : id === 'targeting-street' ? 'street' : id === 'targeting-role' ? 'role' : 'specialty'} options={options} disabled={busy} mobile={mobile} onPick={onPick} />
  ) : null
  const areaBar = res && areas ? (
    <fieldset aria-label="تضييق النتائج" className={`m-0 min-w-0 border-0 ${mobile ? '-mx-4 flex flex-wrap items-center gap-2 px-4 pt-0 pb-1' : 'flex flex-wrap items-center gap-2 p-0'}`}>
      <FiltersIcon size={18} className="shrink-0 text-[var(--color-icon-secondary)]" />
      {areas.wholesale || filters.wholesale ? (
        <Chip className="shrink-0" icon={WholesaleIcon} label={`جملة فقط · ${n(areas.wholesale)}`} selected={Boolean(filters.wholesale)} disabled={busy}
          onClick={() => {
            const enabled = !filters.wholesale
            recordMapInteraction(enabled ? 'map_filter_wholesale_on' : 'map_filter_wholesale_off')
            applyFilters({ ...filters, wholesale: enabled || undefined })
          }} />
      ) : null}
      {filters.district
        ? <Chip className="shrink-0" icon={DistrictIcon} label={`الحي: ${filters.district}`} selected disabled={busy} onRemove={() => applyFilters(keep(filters, ['district', 'street']))} />
        : picker('targeting-district', 'الحي', DistrictIcon, areas.districts.flatMap((d) => {
          const name = safeLocationName(d.name)
          return name ? [{ value: name, text: `${name} (${n(d.n)})` }] : []
        }), (v) => applyFilters({ ...keep(filters, ['street']), district: v }))}
      {filters.street
        ? <Chip className="shrink-0" icon={StreetIcon} label={`الشارع: ${filters.street}`} selected disabled={busy} onRemove={() => applyFilters(keep(filters, ['street']))} />
        : picker('targeting-street', 'الشارع', StreetIcon, streets.map((st, i) => ({ value: String(i), text: `${st.name}${filters.district || !st.district ? '' : ` — ${st.district}`} (${n(st.n)})` })), (v) => { const st = streets[Number(v)]; if (st) applyFilters({ ...filters, district: filters.district || st.district || undefined, street: st.name }) })}
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
  const denseList = useMemo(() => dense?.list || [], [dense])
  const streetNames = useMemo(() => new Set(denseList.map((x) => x.props.street_ar)), [denseList])
  const clusterTop = useMemo(() => (clusters?.list || [])
    .filter((c) => c.level !== 'cell' && !(c.level === 'street' && c.street_ar && streetNames.has(c.street_ar)))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5), [clusters, streetNames])
  const activeStreetId = activeStreet && dense?.list.find((x) => x.id === activeStreet)?.props.street_ar === filters.street ? activeStreet : null
  const pickedStreet = activeStreetId ? dense!.list.find((x) => x.id === activeStreetId)! : null
  // choropleth: places of this request per district (service counts by name, else rows inside)
  const density = useMemo(() => {
    if (!hasPolys) return new Map<string, number>()
    if (res) return densityOf(districts, res.areas?.districts || [], rows)
    return densityOf(districts, marketDistrictCounts.map((item) => ({ name: item.district_ar, n: item.n })), [])
  }, [hasPolys, res, districts, rows, marketDistrictCounts])
  const densityMax = useMemo(() => Math.max(0, ...density.values()), [density])
  const anyChosen = chosenD.size > 0 || Boolean(filters.street)
  // Browse data is loaded before a customer searches; it must not advance the search journey.
  const step: 1 | 2 | 3 = !hasTargetQuery ? 1 : !anyChosen && !profile ? 2 : 3
  const topDistricts = useMemo(() => res
    ? [...(res.areas?.districts || [])].sort((a, b) => b.n - a.n).slice(0, 8)
    : marketDistrictCounts.slice(0, 8).map((d) => ({ name: d.district_ar, n: d.n })), [res, marketDistrictCounts])
  const AR_DIGITS = (v: number) => String(v).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])
  const where = chosenNames.length === 1 ? chosenNames[0] : chosenNames.length > 1 ? `${AR_DIGITS(chosenNames.length)} أحياء` : cityName(city)
  const pickedMain = streetPick.kind === 'main' ? streetPick.id : streetPick.kind === 'sub' ? streetPick.main : null
  const pickedSubs = pickedMain ? catalog?.find((m) => m.main_id === pickedMain)?.subs || [] : []
  const selectedActivity = pickedMain ? catalog?.find((m) => m.main_id === pickedMain) : null
  const normalizedActivitySearch = normalizeActivityText(activitySearch.trim())
  const filteredActivities = (catalog || []).filter((item) => normalizeActivityText(item.main_ar).includes(normalizedActivitySearch))
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
  const closeActivityMenu = () => {
    setActivityMenuOpen(false)
    activityTriggerRef.current?.focus()
  }
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
      <button type="button" aria-pressed={!activeMain && streetPick.kind === 'all'} onClick={onAll} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-start text-[14px] hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>
        <span className="min-w-0 flex-1">كل الأنشطة</span>
        {!activeMain && streetPick.kind === 'all' ? <Icon name="check" size={16} /> : null}
      </button>
      {items.map((item) => <button key={item.main_id} type="button" aria-pressed={activeMain === item.main_id} onClick={() => onSelect(item.main_id)} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-start text-[14px] hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>
        <span className="min-w-0 flex-1 truncate">{item.main_ar}</span>
        <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{n(item.streets)} شارع</span>
        {activeMain === item.main_id ? <Icon name="check" size={16} /> : null}
      </button>)}
    </>
  )
  const activityPicker = catalog && catalog.length ? (
    <div className="flex flex-col gap-2" data-testid="street-picker">
      <div ref={activityMenuRef} className="relative self-start">
        <button ref={activityTriggerRef} type="button" aria-haspopup="dialog" aria-expanded={activityMenuOpen} aria-controls="street-activity-options" onClick={() => { setActivitySearch(''); const nextOpen = !activityMenuOpen; setActivityMenuOpen(nextOpen); if (nextOpen) recordMapInteraction('map_activity_filter_open') }}
          className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px] font-medium shadow-sm hover:border-[var(--color-border-strong)] ${FOCUS_RING}`}>
          <FiltersIcon size={16} className="shrink-0 text-[var(--color-icon-secondary)]" />
          <span className="max-w-[min(65vw,18rem)] truncate">النشاط: {selectedActivity ? selectedActivity.main_ar : 'الكل'}</span>
          {selectedActivity ? <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{n(selectedActivity.streets)} شارع</span> : null}
          <Icon name="chevron-down" size={15} className={`shrink-0 transition-transform ${activityMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        {activityMenuOpen ? (mobile ? createPortal(
          <div className="fixed inset-0 z-[160] flex items-end bg-black/25" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeActivityMenu() }}>
            <section id="street-activity-options" role="dialog" aria-modal="true" aria-labelledby="street-activity-title" className="flex max-h-[75dvh] w-full flex-col overflow-hidden rounded-t-[24px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 shadow-2xl backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
              <button type="button" aria-label="إغلاق قائمة الأنشطة" onClick={closeActivityMenu} className={`flex h-11 shrink-0 touch-none items-center justify-center ${FOCUS_RING}`}><span aria-hidden className="h-1.5 w-10 rounded-full bg-[var(--color-border-strong)]" /></button>
              <h3 id="street-activity-title" className="px-5 pb-2 text-[16px] font-semibold">اختر نشاط الشوارع</h3>
              <label className="mx-4 mb-2 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-default)] px-3">
                <SearchIcon size={16} className="shrink-0 text-[var(--color-icon-secondary)]" />
                <input ref={activitySearchRef} value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} placeholder="ابحث عن نشاط" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
              </label>
              <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
                {renderActivityOptions(filteredActivities, pickedMain, clearActivitySelection, selectActivity)}
                {activitySearch && filteredActivities.length === 0 ? <p className="px-3 py-4 text-[14px] text-[var(--color-text-secondary)]">ما لقينا نشاطاً بهذا الاسم.</p> : null}
              </div>
            </section>
          </div>, document.body,
        ) : createPortal(
          <div ref={activityOptionsRef} id="street-activity-options" role="dialog" aria-label="نشاط الشوارع وعدد الشوارع لكل نشاط" style={{ position: 'fixed', top: activityMenuPosition?.top ?? 0, right: activityMenuPosition?.right ?? 12 }} className="z-[160] max-h-[min(55dvh,28rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 p-2 shadow-2xl backdrop-blur-xl">
            <label className="mb-1 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-default)] px-3">
              <SearchIcon size={16} className="shrink-0 text-[var(--color-icon-secondary)]" />
              <input ref={activitySearchRef} value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} placeholder="ابحث عن نشاط" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
            </label>
            {renderActivityOptions(filteredActivities, pickedMain, clearActivitySelection, selectActivity)}
            {activitySearch && filteredActivities.length === 0 ? <p className="px-3 py-4 text-[14px] text-[var(--color-text-secondary)]">ما لقينا نشاطاً بهذا الاسم.</p> : null}
          </div>, document.body,
        )) : null}
      </div>
      {pickedMain ? (
        <>
        <div role="group" aria-label="الأنشطة الفرعية وعدد الشوارع لكل نشاط" aria-describedby={mobile && pickedSubs.length > 2 ? 'street-subactivities-scroll-hint' : undefined} className={mobile ? '-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1' : 'flex flex-wrap gap-1.5'}>
          {pickedSubs.map((x) => {
            const on = streetPick.kind === 'sub' && streetPick.ids.includes(x.sub_id)
            return <Chip key={String(x.sub_id)} className="shrink-0" label={`${x.sub_ar} · ${n(x.streets)} شارع`} selected={on} onClick={() => { recordMapInteraction(on ? 'map_activity_clear' : 'map_activity_sub_select'); setStreetPick(on ? { kind: 'main', id: pickedMain } : { kind: 'sub', ids: [x.sub_id], main: pickedMain }); pickFocus(on ? { level: 'main', id: pickedMain } : { level: 'sub', id: String(x.sub_id) }) }} />
          })}
        </div>
        </>
      ) : null}
      {streetPick.kind === 'q' ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">الشوارع حسب طلبك: «{streetPick.q}»</p> : null}
    </div>
  ) : null
  const densePanel = denseList.length || activityPicker || topDistricts.length ? (
    <section aria-labelledby="dense-title" className="flex flex-col gap-2 border-b border-[var(--color-border-default)] px-5 py-3">
      <h2 id="dense-title" className="flex items-center gap-2 text-[14px] leading-[22px] font-semibold"><StreetIcon size={18} className="text-[var(--color-icon-secondary)]" />أكثر الشوارع كثافة في {where}</h2>
      <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
        {hasTargetQuery
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
                  <span className="text-[12px] leading-[18px] tabular-nums text-[var(--color-text-secondary)]">{fmtMeters(st.props.length_m)} · {st.props.per_100m.toLocaleString('ar-SA', { maximumFractionDigits: 1 })} منشأة لكل ١٠٠ م</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : denseLoadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-text-danger)]">
          <WarningIcon size={16} />
          <span className="min-w-0 flex-1">تعذر تحميل كثافة الشوارع. هذا لا يعني عدم وجود شوارع كثيفة.</span>
          <button type="button" onClick={retryStreetDensity} className={`shrink-0 underline ${FOCUS_RING}`}>إعادة المحاولة</button>
        </div>
      ) : dense ? <p className="text-[13px] leading-[20px] text-[var(--color-text-secondary)]">ما فيه شوارع كثيفة بهذا الاختيار. جرّب نشاطاً آخر أو أحياء أوسع.</p> : <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">نحسب أكثف الشوارع…</p>}
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
    setSelectedRows((current) => { const next = new Map(current); if (selected.has(r.poi_key)) next.delete(r.poi_key); else next.set(r.poi_key, r); return next })
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
  const templateBlock = !message.trim() ? 'اكتب نص الرسالة' : tplError ? 'تعذّر التحقق من حالة القالب' : !tpl ? 'جارٍ التحقق من القالب…' : template === OUTREACH_TEMPLATE && !approved ? `القالب ${OUTREACH_TEMPLATE} غير معتمد من Meta (${tpl.status})` : template !== OUTREACH_TEMPLATE && !templates.some((t) => t.name === template && templateFits(t)) ? 'القالب ما يناسب الحملة' : null
  const marketingBlock = objective === 'marketing' ? 'اكتشاف المشترين فقط؛ الإرسال غير مفعّل لهذا المسار' : null
  const refreshBlock = busy ? 'جارٍ تحديث النتائج؛ انتظر اكتمال البحث قبل اختيار المنشآت أو الإرسال.' : failedResultRefresh ? 'تعذّر تحديث النتائج؛ لا ترسل الاختيار الحالي حتى تعيد المحاولة أو ترجع إلى النتائج السابقة.' : null
  const sendBlock = refreshBlock || marketingBlock || (!chosen.length ? 'حدد جهة وحدة على الأقل' : templateBlock || (!holder ? 'ما فيه طلب حاضن للردود' : null))
  const scheduleBlock = refreshBlock || marketingBlock || (!chosen.length ? 'حدد جهة وحدة على الأقل' : templateBlock)
  const cost = price != null ? (chosen.length * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
  const templateBadge = approved || template !== OUTREACH_TEMPLATE ? { tone: 'Success' as const, label: 'قالب واتساب معتمد' } : tpl ? { tone: 'Warning' as const, label: `القالب: ${tpl.status}` } : tplError ? { tone: 'Danger' as const, label: 'حالة القالب غير معروفة' } : null
  // drafts live in this page only (owner: nothing on the device); a reload clears them
  const saveDraft = () => {
    setConfirming(false)
    setNotice(`أبشر، الحملة محفوظة كمسودة في هذه الصفحة (${n(chosen.length)} موردين). ترسلها بضغطة لما يتفعّل الإرسال؛ تحديث الصفحة يمسحها.`)
  }

  const resultCard = (r: TargetRow) => {
    const ch = channelOf(r), can = ch === 'WhatsApp', on = selected.has(r.poi_key), name = safeName(r)
    const locationNotes = [!hasPoint(r) ? (site ? 'موقع تقريبي · المسافة غير معروفة' : 'موقع تقريبي') : null, r.district_reliable === false ? 'الحي غير مؤكد' : null].filter(Boolean)
    return (
      <li key={r.poi_key} data-key={r.poi_key} onPointerEnter={(event) => { if (event.pointerType === 'mouse' && hasPoint(r)) setHighlightedPinKey(r.poi_key) }} onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHighlightedPinKey((key) => key === r.poi_key ? null : key) }} onFocusCapture={() => { if (hasPoint(r)) setHighlightedPinKey(r.poi_key) }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHighlightedPinKey((key) => key === r.poi_key ? null : key) }} className="border-b border-[var(--color-border-default)]">
        <div className={`flex flex-row items-start gap-3 px-4 py-3 ${profile === r.poi_key ? 'bg-[var(--color-bg-surface-2)]' : 'hover:bg-[var(--color-bg-surface-2)]'}`}>
          <input type="checkbox" checked={on} disabled={!can || busy || failedResultRefresh} onChange={() => toggle(r)} aria-label={`اختر ${name} للحملة`} title={busy ? 'انتظر اكتمال تحديث النتائج' : failedResultRefresh ? 'أعد تحديث النتائج قبل اختيار المنشآت' : can ? undefined : ch === 'Email' ? 'الحملة على واتساب فقط' : 'ما عنده قناة واتساب بعد'}
            className={`mt-1 size-5 shrink-0 accent-[var(--map-ink)] disabled:opacity-50 ${FOCUS_RING}`} />
          <button type="button" disabled={busy || failedResultRefresh} onClick={() => { recordMapInteraction('map_profile_open'); recordMapInteraction('map_result_profile_open'); recordMapInteraction(mapResultProfileOpenEvent(objective)); setProfile(r.poi_key) }} className={`flex min-w-0 flex-1 flex-col gap-1 text-start disabled:cursor-wait disabled:opacity-60 ${FOCUS_RING}`}>
            <span className={`truncate text-[15px] leading-[24px] font-semibold ${ch === 'Unreachable' ? 'text-[var(--color-text-secondary)]' : ''}`}>{name}</span>
            {pathOf(r) ? <span className="truncate text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{pathOf(r)}</span> : null}
            <RowBadges r={r} />
            {sourceCountOf(r) === 1 ? <Badge tone="Neutral" showDot={false} label="مصدر مسجل واحد" className="w-fit text-[11px] leading-[16px] px-2 py-0.5" /> : null}
            <span className="truncate text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{placeOf(r, cities) || '—'}{locationNotes.length ? ` · ${locationNotes.join(' · ')}` : ''}</span>
          </button>
          <span className="flex shrink-0 flex-col items-end gap-1">{ch === 'WhatsApp' && r.whatsapp_verification_state !== 'verified' ? <Badge tone="Warning" label="واتساب غير متحقق" className="px-2 py-0.5 text-[12px] leading-[18px]" /> : <ChannelBadge channel={ch} />}{statusBadge(r)}{fitBadge(r)}<SaudiEstablishmentBadge evidence={r} /></span>
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
                <input type="checkbox" checked={checked} disabled={busy || inCampaign || channel !== 'WhatsApp'} onChange={() => setMultiPending((current) => {
                  const next = new Map(current)
                  if (next.has(row.poi_key)) next.delete(row.poi_key)
                  else next.set(row.poi_key, row)
                  return next
                })} aria-label={`اختر ${safeName(row)} من ${intent.activity} في ${intent.district}`} className={`mt-1 size-5 shrink-0 accent-[var(--map-ink)] ${FOCUS_RING}`} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[14px] font-semibold">{safeName(row)}</p>
                  <p className="m-0 truncate text-[12px] text-[var(--color-text-secondary)]">{placeOf(row, cities) || `حي ${intent.district}`}{row.district_reliable === false ? ' · الحي غير مؤكد' : ''}</p>
                  {inCampaign ? <span className="text-[11px] text-[var(--color-text-success)]">مضافة للحملة</span> : channel !== 'WhatsApp' ? <span className="text-[11px] text-[var(--color-text-tertiary)]">لا تتوفر قناة واتساب</span> : null}
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
      <p>{cohort.length ? 'ما فيه منشآت بهذا التقدير ضمن النتائج الحالية.' : rows.length ? 'ما فيه منشآت هنا مع الأحياء أو التضييق المختار. وسّع الاختيار أو شِل أحد المرشحات.' : filters.district || filters.street || filters.wholesale || filters.role || filters.specialty ? 'ما فيه جهات بهذا الوصف مع التضييق المختار. شِل أحد المرشحات فوق.' : 'ما لقينا جهات بهذا الوصف. جرّب كلمة ثانية أو مدينة أوسع.'}</p>
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
      {busy ? <p role="status" className="mx-3 mt-3 rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-[12px] leading-[19px] text-[var(--color-text-secondary)]">جارٍ تحديث النتائج. ستتمكن من اختيار المنشآت بعد اكتمال البحث.</p> : null}
      <ul>
        {visibleListCohort.slice(0, shown).map(resultCard)}
        {shown < visibleListCohort.length ? <li className="px-4 py-3"><Button variant="Ghost" size="S" onClick={() => setShown((s) => s + PAGE)}>اعرض {n(Math.min(PAGE, visibleListCohort.length - shown))} أكثر</Button></li> : null}
        {truncated && shown >= visibleCohort.length ? (
          <li className="flex flex-row items-center justify-between gap-3 px-4 py-3">
            <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">معروض {n(rows.length)} من {n(res.total)} — الأقرب للوصف أولًا.</span>
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
  const targetResultsPanel = hasTargetQuery ? resultsBody : (
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
            <p className="m-0 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">ابحث عن الجهات التي قد تحتاج نشاطك، أو أضف منتجاتك لتبدأ.</p>
          </div>
          <Button variant="Secondary" size="S" icon={UploadCatalogIcon} onClick={() => { recordMapInteraction('map_seller_add_products'); setStartOpen(true) }}>أضف منتجاتك</Button>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="اللوحة" className="flex gap-1 rounded-full bg-[var(--color-bg-surface-2)] p-1">
          {((mobile ? [['streets', 'الشوارع'], ['results', hasTargetQuery ? `النتائج · ${n(visibleCohort.length)}` : 'ابدأ البحث'], ['guide', 'الدليل']] : [['results', hasTargetQuery ? `النتائج · ${n(visibleCohort.length)}` : 'ابدأ البحث'], ['guide', 'الدليل']]) as [typeof tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k || (!mobile && tab === 'streets' && k === 'results')} onClick={() => setTab(k)}
              className={`rounded-full px-4 py-1.5 text-[14px] leading-[22px] font-medium ${tab === k ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--farq-button-shadow)]' : 'text-[var(--color-text-secondary)]'} ${FOCUS_RING}`}>{l}</button>
          ))}
        </div>
        {hasTargetQuery && res && waInCohort ? (
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
      {hasTargetQuery && res ? (
        <p className="pb-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
          {`القائمة تعرض ${n(Math.min(shown, visibleListCohort.length))} من ${n(visibleListCohort.length)} منشأة محمّلة · ${n(res.total)} نتيجة مطابقة إجمالاً`}
          {chosenD.size ? ` · داخل ${n(chosenD.size)} ${chosenD.size === 1 ? 'حي' : 'أحياء'} مختارة` : ' · اختر حياً على الخريطة لتضييق النتائج'}
          {focus ? ` · ${focus.level === 'main' ? mainAr(focus.id) : focus.level === 'sub' ? subAr(focus.id) || '' : focus.id}` : ''}
          {approxCount ? ` · ${n(approxCount)} بموقع تقريبي (بلا دبوس)` : ''}
          {fitFilter !== 'all' ? <span> · تقدير الملاءمة للفرز فقط</span> : null}
          {focus ? <button type="button" onClick={() => setFocus(null)} className={`ms-2 font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>إلغاء الفرز</button> : null}
        </p>
      ) : null}
      {hasTargetQuery && res && (unverifiedWhatsappCount > 0 || unconfirmedStatusCount > 0) ? (
        <details onToggle={(event) => { if (event.currentTarget.open) recordMapInteraction('map_data_quality_notice_open') }} className="group mb-3 rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-3 py-1.5 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
          <summary className={`flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 font-medium ${FOCUS_RING}`}>
            <span className="flex min-w-0 items-center gap-1.5"><WarningIcon size={15} className="shrink-0" /><span>تنبيهات قبل التواصل</span></span>
            <Icon name="chevron-down" size={14} className="shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-1 border-t border-[var(--color-border-default)] py-2">
            {unverifiedWhatsappCount > 0 ? <p className="m-0">وسم واتساب من المصدر؛ لم يتم التحقق من استقبال الرقم للرسائل.</p> : null}
            {unconfirmedStatusCount > 0 ? <p className="m-0">حالة التشغيل غير مؤكدة لـ {n(unconfirmedStatusCount)} من {n(visibleCohort.length)} منشأة. تحقق من نشاطها قبل التواصل.</p> : null}
          </div>
        </details>
      ) : null}
    </div>
  )
  const marketSummaryPanel = (
    <section className="flex flex-col gap-3 border-b border-[var(--color-border-default)] px-4 py-4" aria-label="ملخص السوق">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">ملخص سوق {cityName(city)}</h2>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">{marketLoading ? 'جارٍ التحديث…' : marketError ? 'بعض بيانات السوق غير متاحة' : 'حسب سجل الدليل الحالي'}</span>
      </div>
      {marketStats ? (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ['منشآت مرصودة', marketStats.total], ['أحياء بإسناد موثوق', marketStats.districts_count],
              ['واتساب حسب المصدر', marketStats.n_whatsapp], ['منشآت موسومة جملة', marketStats.n_wholesale],
              ['منشآت لديها تخصصات مسجلة', marketStats.n_specialties], ['بلا موقع دقيق', marketStats.n_approx],
            ].map(([label, value]) => <div key={label} className="rounded-[12px] bg-[var(--color-bg-surface-2)] px-3 py-2">
              <dt className="text-[11px] leading-[16px] text-[var(--color-text-secondary)]">{label}</dt>
              <dd className="m-0 text-[16px] leading-[24px] font-semibold tabular-nums">{n(Number(value))}</dd>
            </div>)}
          </dl>
          <p className="m-0 text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
            الملخص يحصي سجل المنشآت في المدينة؛ نتائج الخريطة تقتصر على المنشآت الموسومة بواتساب من المصدر، والوسم لا يعني تحقق الرقم.
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
  const buyerPanel = lens === 'buyers' && currentBuyerData ? (
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
  const marketGuide = <GuideTree guide={res ? guide : []} focus={focus} onFocus={pickFocus} empty={res ? 'ما فيه أنشطة هنا. اختر حياً فيه منشآت.' : 'اختر نشاطاً من قائمة الشوارع أو ابحث عن منشآت، ثم تصفّح الأنشطة والتخصصات هنا.'} />
  const panelContent = lens === 'market'
    ? tab === 'guide' ? marketGuide : mobile && tab === 'results' ? resultsBody : marketPanel
    : <>
    {buyerPanel}
    {mobile && tab === 'streets' ? densePanel || <p className="px-5 py-6 text-[14px] text-[var(--color-text-secondary)]">نحسب أكثف الشوارع…</p> : tab !== 'guide' ? (
      <>{mobile ? null : densePanel}{denseList.length ? null : clusterList}<MyRequests mobile={mobile} refresh={savedTick} />{targetResultsPanel}</>
    ) : marketGuide}
  </>
  const panelBody = <>{fitLegend}{panelContent}</>

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
      <LayerMap city={city} focusMode={focusMode} districts={hasPolys ? districts : []} chosen={chosenD} onDistrict={toggleDistrict} pins={pins} highlightedPinKey={highlightedPinKey} layer={layer} onPin={(k) => void openMapProfile(k)} tileQuery={res?.map_query} onTileRefresh={() => void (query ? runSearchIn(query, city, filters) : loadBrowse(city, filters))}
        nameOf={(k) => { const r = byKey.get(k); return r ? safeName(r) : 'منشأة' }} clusters={clusterTop} onCluster={pickCluster}
        streets={denseList} activeStreet={activeStreetId} onStreet={pickStreet} density={density} densityMax={densityMax}
        site={site} placingSite={placingSite} onPlaceSite={(lat, lon) => { setSite({ lat, lon, km: site?.km || 10 }); setPlacingSite(false); setShowUnlocated(false) }} fit={fit} extent={extent} />
      {!focusMode ? <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-3 py-2 text-[13px] font-semibold shadow-[var(--farq-soft-shadow)] backdrop-blur-md md:min-h-8">
            <span>{focus?.level === 'main' ? `النشاط الرئيسي: ${mainAr(focus.id)}` : focus?.level === 'sub' ? `النشاط الفرعي: ${subAr(focus.id) || ''}` : focus?.level === 'spec' ? `التخصص: ${focus.id}` : lens === 'market' ? 'نظرة عامة على السوق' : 'النشاط الرئيسي'}</span>
            {focus ? <button type="button" onClick={() => pickFocus(null)} className={`inline-flex min-h-11 items-center px-2 text-[var(--color-text-info)] underline md:min-h-8 ${FOCUS_RING}`}>العودة للمستوى الأعلى</button> : null}
          </div>
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
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">الكثافة</dt><dd className="m-0 font-semibold tabular-nums">{pickedStreet.props.per_100m.toLocaleString('ar-SA', { maximumFractionDigits: 1 })} منشأة لكل ١٠٠ م</dd></div>
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">جملة</dt><dd className="m-0 font-semibold tabular-nums">{n(pickedStreet.props.n_wholesale)} منشأة</dd></div>
          </dl>
        </div>
      ) : null}
      {mobile && !focusMode && res && hasTargetQuery ? (
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
      city={city} showTiming={objective === 'purchase'} onSend={() => setConfirming(true)} onClear={() => { setSelected(new Set()); setSelectedRows(new Map()) }} onNotice={setNotice} />
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
    <form role="search" onSubmit={search} className={`flex items-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] ${mobile ? 'py-1 ps-3 pe-1' : 'py-1.5 ps-4 pe-1.5'} shadow-[var(--farq-card-shadow)] focus-within:border-[var(--map-ink)]`}>
      <SearchIcon size={mobile ? 18 : 20} className="text-[var(--color-icon-secondary)]" />
      <label className="sr-only" htmlFor="targeting-q">وش تبي توصل له؟</label>
      <input id="targeting-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={objective === 'marketing' ? (mobile ? SELL_PLACEHOLDER_SHORT : SELL_PLACEHOLDER) : (mobile ? BUY_PLACEHOLDER_SHORT : BUY_PLACEHOLDER)}
        className={`min-w-0 flex-1 bg-transparent ${mobile ? 'text-[16px]' : 'text-[17px]'} leading-[28px] outline-none placeholder:text-[var(--color-text-tertiary)]`} />
      {citySelect(mobile ? 'max-w-[112px] text-[14px]' : 'w-[160px] text-[15px] rounded-full')}
      <Button type="submit" variant="Primary" size={mobile ? 'S' : 'M'} disabled={!q.trim() || !city || busy} loading={busyKind === 'search'} loadingLabel={mobile ? 'بحث…' : 'جارٍ البحث…'}>ابحث</Button>
    </form>
  )
  const searchStatus = busy ? (
    <p role="status" aria-live="polite" aria-atomic="true" className="flex items-center justify-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-3 py-1.5 text-[12px] leading-[18px] text-[var(--color-text-secondary)] shadow-sm backdrop-blur-md">
      <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
      {busyKind === 'browse' ? 'جارٍ تحميل منشآت السوق على الخريطة…' : busyKind === 'more' ? 'جارٍ تحميل نتائج إضافية…' : 'جارٍ تحديث نتائج البحث على الخريطة…'}
    </p>
  ) : null

  if (focusMode) {
    return (
      <div data-testid="map-focus-shell" className="fixed inset-0 z-[110] flex h-dvh flex-col overflow-hidden bg-[var(--map-land)]">
        <div className="relative min-h-0 flex-1">{mapBlock}</div>
        <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex justify-center">
          <div className="pointer-events-auto flex w-full max-w-[760px] flex-col gap-2 rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 p-2 shadow-lg backdrop-blur">
            {searchForm}
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
                  {focusPanelOpen ? 'إخفاء اللوحة' : hasTargetQuery ? `النتائج · ${resultCountSummary}` : 'ابدأ البحث'}
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
          {lens === 'market' ? `منشآت مرصودة · ${marketStats ? n(marketStats.total) : marketLoading ? '…' : '—'}` : hasTargetQuery ? `نتائج · ${resultCountSummary}` : lens === 'sellers' ? 'ابدأ البحث عن مورد' : 'ابدأ البحث عن مشترين'}
          {chosenD.size ? ` · ${n(chosenD.size)} ${chosenD.size === 1 ? 'حي محدد' : 'أحياء محددة'}` : ''}
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
                <p className="m-0 truncate text-[13px] font-medium text-[var(--color-text-secondary)]">{lens === 'market' ? `ملخص السوق · ${marketStats ? n(marketStats.total) : marketLoading ? '…' : '—'} منشأة` : hasTargetQuery ? `النتائج · ${resultCountSummary}` : lens === 'sellers' ? 'ابحث عن مورد' : 'اكتشف المشترين'}</p>
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
        {searchForm}
        {searchStatus}
        {errorLine}
        {areaBar}
        {mapBlock}
        {suggestBar}
        {understood}
        {linesPanel}
        {fileField}
        {lens !== 'market' ? <StepStrip current={step} mobile /> : null}
        <Counters items={displayCounters} compact />
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
    <div className="flex h-dvh min-w-0 flex-col bg-[var(--color-bg-canvas)]">
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
        {searchForm}
        {searchStatus}
        {understood}
        {suggestBar}
        {areaBar}
        {errorLine}
        {linesPanel}
      </header>
      <div className="flex min-h-0 flex-1 flex-row">
        <aside aria-label="النتائج والدليل" className="flex w-[400px] shrink-0 flex-col border-e border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
          {panelHead}
          <div className="min-h-0 flex-1 overflow-y-auto">{panelBody}</div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          {lens !== 'market' ? <StepStrip current={step} mobile={false} /> : null}
          <Counters items={displayCounters} />
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
function FilterPill({ id, label, icon: IconComponent, analyticsKey, options, disabled, mobile, onPick }: {
  id: string
  label: string
  icon: typeof DistrictIcon | null
  analyticsKey: 'district' | 'street' | 'role' | 'specialty' | 'site_radius'
  options: { value: string; text: string }[]
  disabled: boolean
  mobile: boolean
  onPick: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const priorFocus = mobile ? trigger.current : null
    const dialog = mobile ? document.getElementById(`${id}-options`) : null
    if (mobile) dialog?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
    const onPointerDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); return }
      if (!mobile || event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
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
    if (mobile) return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (priorFocus?.isConnected) priorFocus.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown) }
  }, [open, mobile, id])
  const choose = (value: string) => {
    setOpen(false)
    recordMapInteraction(`map_filter_select_${analyticsKey}`)
    onPick(value)
  }
  const menu = open ? mobile ? createPortal(
    <div className="fixed inset-0 z-[160] flex items-end bg-black/25" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section id={`${id}-options`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="flex max-h-[70dvh] w-full flex-col overflow-hidden rounded-t-[24px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 shadow-2xl backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <button type="button" aria-label="إغلاق قائمة الخيارات" onClick={() => setOpen(false)} className={`flex h-11 shrink-0 touch-none items-center justify-center ${FOCUS_RING}`}><span aria-hidden className="h-1.5 w-10 rounded-full bg-[var(--color-border-strong)]" /></button>
        <h2 id={`${id}-title`} className="px-5 pb-2 text-[16px] font-semibold">{label}</h2>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
          {options.map((option) => <button key={option.value} type="button" onClick={() => choose(option.value)} className={`block min-h-12 w-full rounded-xl px-3 py-2 text-start text-[15px] leading-[22px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>{option.text}</button>)}
        </div>
      </section>
    </div>, document.body,
  ) : (
    <div id={`${id}-options`} aria-label={label} className="absolute start-0 top-[calc(100%+8px)] z-50 max-h-[55dvh] w-[min(19rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 p-1.5 shadow-2xl backdrop-blur-xl">
      {options.map((option) => <button key={option.value} type="button" onClick={() => choose(option.value)} className={`block min-h-11 w-full rounded-xl px-3 py-2 text-start text-[14px] leading-[22px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>{option.text}</button>)}
    </div>
  ) : null
  return (
    <div ref={root} className="relative shrink-0">
      <button ref={trigger} id={id} type="button" aria-haspopup={mobile ? 'dialog' : 'true'} aria-expanded={open} aria-controls={`${id}-options`} disabled={disabled} onClick={() => { const nextOpen = !open; setOpen(nextOpen); if (nextOpen) recordMapInteraction(`map_filter_open_${analyticsKey}`) }}
        className={`inline-flex min-h-11 max-w-[min(13rem,78vw)] items-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-3 py-2 text-[14px] leading-[20px] font-medium text-[var(--color-text-secondary)] shadow-sm backdrop-blur-md hover:border-[var(--color-border-strong)] disabled:opacity-50 md:min-h-10 ${FOCUS_RING}`}>
        {IconComponent ? <IconComponent size={16} className="shrink-0 text-[var(--color-icon-secondary)]" /> : null}
        <span className="truncate">{label}</span>
        <Icon name="chevron-down" size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  )
}
