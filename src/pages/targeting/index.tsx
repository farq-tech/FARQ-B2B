import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  listCities, listDistricts, listTemplates, searchTargets, streetDensity, templateFits, templateStatus, tradeClusters, waNumber, statusLabel, TargetingError, OUTREACH_TEMPLATE,
  type City, type MetaTemplate, type SearchFilters, type TargetRow, type TargetSearch, type TemplateStatus, type TradeCluster,
} from '../../api/targetingClient'
import {
  Badge, Button, ChannelBadge, Chip, CityIcon, ClustersIcon, DistrictIcon, ErrorIcon, FiltersIcon, Icon, MessageTemplatesIcon, NewRequestIcon,
  SaudiEstablishmentBadge, SearchIcon, SpecialtiesIcon, StreetIcon, SuccessIcon, SupplierIcon, useIsMobile, WarningIcon, WholesaleIcon, type Channel,
} from '../../ui'
import { FOCUS_RING } from '../../ui/cx'
import { BUY_EXAMPLES, BUY_PLACEHOLDER, BUY_PLACEHOLDER_SHORT, cityCoords, marketNameFor, marketSuggestions, SELL_EXAMPLES, SELL_PLACEHOLDER, SELL_PLACEHOLDER_SHORT } from '../../lib/saudi'
import { readBooklet, type BookletLine } from '../../lib/readBooklet'
import { handoff, HANDOFF } from '../../lib/handoff'
import { fetchConstructionWhatsAppPricing } from '../../api/constructionClient'
import { createOpportunityRequest, type OpportunityRequestKind } from '../../api/opportunityRequestsClient'
import CampaignConfirmSheet from './CampaignConfirmSheet'
import StartSheet from './StartSheet'
import MyRequests from './MyRequests'
import Counters from './map/Counters'
import DrawnLayerMap from './map/DrawnLayerMap'
import GuideTree from './map/GuideTree'
import ProfileDrawer from './map/ProfileDrawer'
import CampaignTray from './map/CampaignTray'
import StepStrip from './map/StepStrip'
import MapLegend from './map/MapLegend'
import { RowBadges } from './map/Badges'
import { LayerSwatch } from './map/glyphs'
import {
  countersOf, densityOf, districtAt, districtsFrom, fmtMeters, streetsFrom, topStreets, districtsFromNames, guideOf, hasPoint, inDistricts, km, LAYERS, mainAr, mainIdOf, matchesFocus, pinsOf, safeName, subAr, subIdOf,
  type District, type Focus, type Layer, type Street,
} from './map/model'
import type { LayerMapProps, Site } from './map/types'

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
function LayerMap(props: LayerMapProps) {
  if (!HAS_MAPBOX) return <DrawnLayerMap {...props} />
  return <Suspense fallback={null}><LayerMapbox {...props} /></Suspense>
}

const PAGE = 150
const FETCH = 200   // rows per server page (the API maximum); «حمّل أكثر» appends the next page
const RADII = [5, 10, 25, 50, 100] as const

export const channelOf = (r: TargetRow): Channel => (waNumber(r) ? 'WhatsApp' : r.email ? 'Email' : 'Unreachable')
const n = (v: number) => v.toLocaleString('en-US')
/** «حدد المناسبين»: AI-likely places with WhatsApp; without an AI check, everyone with WhatsApp. */
const pickBest = (rows: TargetRow[]) => {
  const ai = rows.some((r) => r.ai)
  return new Set(rows.filter((r) => waNumber(r) && (!ai || r.ai === 'L')).map((r) => r.poi_key))
}
const placeOf = (r: TargetRow) => [r.street_ar, r.district_ar || r.district_en, r.region_ar || r.city_en].filter(Boolean).join(' · ')
const pathOf = (r: TargetRow) => { const m = mainIdOf(r), s = subAr(subIdOf(r)); return s ? `${mainAr(m)} ▸ ${s}` : r.taxonomy_sub ? mainAr(m) : r.category_ar || '' }
const FIT = { L: { tone: 'Success', label: 'مناسب', icon: SuccessIcon }, M: { tone: 'Warning', label: 'محتمل', icon: WarningIcon }, N: { tone: 'Neutral', label: 'غير مناسب', icon: ErrorIcon } } as const
const fitBadge = (r: TargetRow) => (r.ai ? <Badge tone={FIT[r.ai].tone} icon={FIT[r.ai].icon} label={FIT[r.ai].label} className="text-[12px] leading-[18px]" /> : null)
const statusBadge = (r: TargetRow) => { const l = statusLabel(r); return l ? <Badge tone="Warning" icon={WarningIcon} label={l} className="text-[12px] leading-[18px]" /> : null }
const arabic = (s: string) => /[؀-ۿ]/.test(s)
/** The narrowing filters under the search bar: district, street, wholesale (manual only), role and specialty. */
type AreaFilters = Pick<SearchFilters, 'district' | 'street' | 'wholesale' | 'role' | 'specialty'>
const clusterName = (c: TradeCluster) => [c.level === 'street' ? c.street_ar : null, c.district_ar].filter(Boolean).join('، ') || c.label_ar
/** «سوق الزل للأقمشة — الديرة · 230 محل» when a curated popular name fits; otherwise «الشارع، الحي — 37 محل». */
const clusterText = (c: TradeCluster) => (c.popular_ar ? `${c.popular_ar} — ${clusterName(c)} · ${n(c.n)} محل` : `${clusterName(c)} — ${n(c.n)} محل`)

function defaultMessage(cat: string | null, area: string | null) {
  return `معك أحمد من فرق. يوصلنا طلبات تسعير${cat ? ` ${cat}` : ''} من منشآت وشركات${area ? ` في ${area}` : ''} — تبي توصلك على واتساب؟\nللإيقاف أرسل: إيقاف`
}
const boxAround = (lat: number, lon: number, d = 0.012): [number, number, number, number] => [lon - d, lat - d, lon + d, lat + d]

export default function TargetingPage({ onTemplates, startNew = false, onStartClosed, onRfq }: {
  onTemplates: () => void
  /** «طلب جديد» (sidebar / tab bar): open the start sheet */
  startNew?: boolean
  onStartClosed?: () => void
  /** the buyer price-request wizard (/new), linked from the start sheet */
  onRfq?: () => void
}) {
  const mobile = useIsMobile()
  // hand-offs from «هدف جديد» pages (memory only); the default is «بائعون»
  const [objective, setObjective] = useState<'purchase' | 'marketing'>(() => (handoff.take(HANDOFF.targetDirection) === 'marketing' ? 'marketing' : 'purchase'))
  const [q, setQ] = useState(() => handoff.take(HANDOFF.targetQuery) || '')
  const generation = useRef(0)
  const [query, setQuery] = useState('')
  const [res, setRes] = useState<TargetSearch | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(PAGE)
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
  const [activeStreet, setActiveStreet] = useState<string | null>(null)
  const clusterGen = useRef(0)
  // map state: districts, layer, guide pick, profile, site
  const [polys, setPolys] = useState<District[] | null>(null)
  const [chosenD, setChosenD] = useState<Set<string>>(new Set())
  const [layer, setLayer] = useState<Layer>('main')
  const [focus, setFocus] = useState<Focus>(null)
  const [profile, setProfile] = useState<string | null>(null)
  const [tab, setTab] = useState<'results' | 'guide'>('results')
  const [site, setSite] = useState<Site | null>(null)
  const [placingSite, setPlacingSite] = useState(false)
  const [fit, setFit] = useState<LayerMapProps['fit']>(null)
  const fitTo = (bounds: [number, number, number, number]) => setFit((f) => ({ bounds, at: (f?.at || 0) + 1 }))
  const clearAreas = () => { clusterGen.current++; setFilters({}); setClusters(null); setDense(null); setActiveStreet(null); setFocus(null) }
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
  const resetAll = () => { generation.current++; setRes(null); clearAreas(); setSelected(new Set()); setActiveLine(null); setLines((ls) => ls.map(({ found: _found, ...line }) => line)); setError(null); setConfirming(false); setProfile(null) }
  const pickCity = (v: string) => { resetAll(); setCity(v); setChosenD(new Set()); setSite(null) }

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

  const rows = useMemo(() => res?.rows || [], [res])
  const byKey = useMemo(() => new Map(rows.map((r) => [r.poi_key, r])), [rows])
  const hasPolys = Boolean(polys && polys.length)
  const districts = useMemo<District[]>(() => (hasPolys ? polys! : districtsFromNames(res?.areas?.districts || [])), [hasPolys, polys, res])
  const chosenList = useMemo(() => districts.filter((d) => chosenD.has(d.id)), [districts, chosenD])
  // the cohort: chosen districts (all rows before any is chosen), then the project site radius, then the guide pick
  const areaRows = useMemo(() => {
    let out = chosenList.length ? rows.filter((r) => inDistricts(r, chosenList)) : rows
    if (site) out = out.filter((r) => hasPoint(r) && km(site, { lat: r.latitude!, lon: r.longitude! }) <= site.km)
    return out
  }, [rows, chosenList, site])
  const cohort = useMemo(() => areaRows.filter((r) => matchesFocus(r, focus)), [areaRows, focus])
  const counters = useMemo(() => countersOf(cohort, chosenD.size), [cohort, chosenD])
  const guide = useMemo(() => guideOf(areaRows), [areaRows])
  const pins = useMemo(() => (chosenList.length ? pinsOf(cohort, layer, selected, focus) : []), [chosenList, cohort, layer, selected, focus])
  const approxCount = useMemo(() => cohort.filter((r) => !hasPoint(r)).length, [cohort])
  const extent = useMemo<[number, number, number, number] | null>(() => {
    const pts = rows.filter(hasPoint)
    if (pts.length) return [Math.min(...pts.map((r) => r.longitude!)), Math.min(...pts.map((r) => r.latitude!)), Math.max(...pts.map((r) => r.longitude!)), Math.max(...pts.map((r) => r.latitude!))]
    const c = cityCoords(city)
    return c ? [c.lon - 0.15, c.lat - 0.12, c.lon + 0.15, c.lat + 0.12] : null
  }, [rows, city])
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.poi_key)), [rows, selected])
  const truncated = res ? rows.length < res.total : false
  const hasAi = Boolean(res?.ai_checked)
  const waInCohort = counters.whatsapp

  const toggleDistrict = (id: string) => {
    setChosenD((s) => {
      const x = new Set(s)
      if (x.has(id)) x.delete(id)
      else {
        x.add(id)
        const d = districts.find((y) => y.id === id)
        if (x.size === 1 && d?.bbox) fitTo(d.bbox)
      }
      return x
    })
  }
  const pickFocus = (f: Focus) => { setFocus(f); if (f) setLayer(f.level) }

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
  const direction = (
    <fieldset className="flex gap-1 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-1" aria-label="من تبحث عنه؟">
      {([{ value: 'purchase', label: 'بائعون — أبي أشتري' }, { value: 'marketing', label: 'مشترون — أبي أبيع' }] as const).map((option) => (
        <label key={option.value} className={`flex cursor-pointer flex-row items-center gap-2 rounded-full px-3 py-1 text-[14px] leading-[22px] font-medium whitespace-nowrap ${objective === option.value ? 'bg-[var(--map-ink)] text-white' : 'text-[var(--color-text-secondary)]'}`}>
          <input type="radio" name="target-direction" aria-label={option.label} className="sr-only" checked={objective === option.value} onChange={() => { resetAll(); setObjective(option.value) }} />
          <span aria-hidden>{mobile ? option.label.split(' — ')[0] : option.label}</span>
        </label>
      ))}
    </fieldset>
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
    await runSearchIn(q.trim(), city)
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
  async function loadMore() {
    if (!res || res.next_offset == null || busy || !query) return
    setBusy(true); setError(null)
    const version = generation.current
    try {
      const r = await searchTargets(query, city, FETCH, objective, res.next_offset, filters)
      if (version !== generation.current) return
      setRes((cur) => cur ? { ...cur, rows: [...cur.rows, ...r.rows.filter((x) => !cur.rows.some((y) => y.poi_key === x.poi_key))], has_more: r.has_more, next_offset: r.next_offset } : cur)
      setShown((s) => s + r.rows.length)
    } catch (err) {
      if (version === generation.current) setError(err instanceof TargetingError ? err.message : 'تعذّر تحميل باقي النتائج.')
    } finally { setBusy(false) }
  }
  /** Where this trade concentrates in the city (POST /clusters); quiet when the service has none or is older. */
  function loadClusters(text: string, inCity: string, wholesale: boolean, obj: typeof objective = objective) {
    const v = ++clusterGen.current
    setClusters(null)
    tradeClusters({ city: inCity, q: text, objective: obj, ...(wholesale ? { wholesale: true } : {}) }).then(
      (c) => { if (v === clusterGen.current) setClusters({ list: (c?.clusters || []).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).map((x) => ({ ...x, popular_ar: marketNameFor(x, inCity, text) })), basis: c?.basis }) },
      () => { if (v === clusterGen.current) setClusters(null) },
    )
    setDense(null); setActiveStreet(null)
    streetDensity({ city: inCity, q: text, objective: obj }).then(
      (d) => {
        if (v !== clusterGen.current) return
        const list = streetsFrom(d)
        setDense({ list, basis: d?.basis })
        // right after a search: frame the densest streets so the map shows WHERE at once
        const top = topStreets(list)
        if (top.length) fitTo([Math.min(...top.map((x) => x.bbox[0])), Math.min(...top.map((x) => x.bbox[1])), Math.max(...top.map((x) => x.bbox[2])), Math.max(...top.map((x) => x.bbox[3]))])
      },
      () => { if (v === clusterGen.current) setDense({ list: [] }) },
    )
  }
  /**
   * A new request (next = undefined) starts without narrowing filters: «جملة» in the request only RANKS wholesalers first
   * (the service does that); it never switches «جملة فقط» on (owner 2026-10-16). Otherwise: the same request with these filters.
   */
  async function runSearchIn(text: string, inCity: string, next?: AreaFilters, obj: typeof objective = objective, initial?: AreaFilters): Promise<number | null> {
    if (!text || !inCity || busy) return null
    setBusy(true); setError(null); setNotice(null)
    const version = generation.current
    const fresh = next === undefined
    const use: AreaFilters = fresh ? (initial ?? {}) : next
    try {
      const r = await searchTargets(text, inCity, FETCH, obj, 0, use)
      if (version !== generation.current) return null
      setRes(r); setQuery(text); setShown(PAGE); setFilters(use)
      if (fresh) { setSelected(new Set()); setFocus(null); setProfile(null) }
      else setSelected((cur) => new Set(r.rows.filter((x) => cur.has(x.poi_key)).map((x) => x.poi_key)))
      if (fresh || Boolean(use.wholesale) !== Boolean(filters.wholesale)) loadClusters(text, inCity, Boolean(use.wholesale), obj)
      const p = r.parsed || {}
      const cat = (p.keywords || []).filter(arabic)[0] || null
      if (fresh) setMessage(defaultMessage(cat, cityName(inCity)))
      return r.total
    } catch (err) {
      if (version !== generation.current) return null
      setError(err instanceof TargetingError ? err.message : 'تعذّر البحث. تأكد من الاتصال وحاول مرة ثانية.')
      return null
    } finally { setBusy(false) }
  }
  const applyFilters = (next: AreaFilters) => { if (query) void runSearchIn(query, city, next) }
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
    const [w, so, e, no] = st.bbox, pad = 0.002
    fitTo([w - pad, so - pad, e + pad, no + pad])
    setActiveStreet(id)
    const d = hasPolys ? districtAt(st.mid[0], st.mid[1], districts) : null
    if (d) setChosenD((x) => new Set(x).add(d.id))
    applyFilters({ ...keep(filters, ['street']), street: st.props.street_ar })
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
  const startSheet = startOpen ? (
    <StartSheet mobile={mobile} onClose={closeStart} onRfq={onRfq}
      onBooklet={() => { if (objective === 'marketing') { resetAll(); setObjective('purchase') } fileInput.current?.click(); closeStart() }}
      onFreeSearch={() => { closeStart(); requestAnimationFrame(() => input.current?.focus()) }}
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
  const pickerCls = `max-w-[150px] shrink-0 appearance-none rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] py-2 ps-9 pe-4 text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)] enabled:hover:border-[var(--color-border-strong)] disabled:opacity-50 ${FOCUS_RING}`
  const picker = (id: string, label: string, icon: typeof DistrictIcon, options: { value: string; text: string }[], onPick: (v: string) => void) => options.length ? (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <span className="relative inline-flex shrink-0 items-center">
        <IconSlot icon={icon} />
        <select id={id} value="" disabled={busy} className={pickerCls} onChange={(e) => { if (e.target.value !== '') onPick(e.target.value) }}>
          <option value="">{label} ▾</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
        </select>
      </span>
    </>
  ) : null
  const areaBar = res && areas ? (
    <fieldset aria-label="تضييق النتائج" className={`m-0 min-w-0 border-0 ${mobile ? '-mx-4 flex items-center gap-2 overflow-x-auto px-4 pt-0 pb-1' : 'flex flex-wrap items-center gap-2 p-0'}`}>
      <FiltersIcon size={18} className="shrink-0 text-[var(--color-icon-secondary)]" />
      {areas.wholesale || filters.wholesale ? (
        <Chip className="shrink-0" icon={WholesaleIcon} label={`جملة فقط · ${n(areas.wholesale)}`} selected={Boolean(filters.wholesale)} disabled={busy}
          onClick={() => applyFilters({ ...filters, wholesale: !filters.wholesale || undefined })} />
      ) : null}
      {filters.district
        ? <Chip className="shrink-0" icon={DistrictIcon} label={`الحي: ${filters.district}`} selected disabled={busy} onRemove={() => applyFilters(keep(filters, ['district', 'street']))} />
        : picker('targeting-district', 'الحي', DistrictIcon, areas.districts.map((d) => ({ value: d.name, text: `${d.name} (${n(d.n)})` })), (v) => applyFilters({ ...keep(filters, ['street']), district: v }))}
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
  // dense streets are the primary «تجمعات»: a circle stays only where no street line covers it
  const denseList = useMemo(() => dense?.list || [], [dense])
  const streetNames = useMemo(() => new Set(denseList.map((x) => x.props.street_ar)), [denseList])
  const streetDistricts = useMemo(() => new Set(hasPolys ? denseList.map((x) => districtAt(x.mid[0], x.mid[1], districts)?.ar).filter(Boolean) as string[] : []), [denseList, hasPolys, districts])
  const circles = useMemo(() => (clusters?.list || []).filter((c) => !(c.level === 'street' && c.street_ar && streetNames.has(c.street_ar)) && !(c.level !== 'street' && c.district_ar && streetDistricts.has(c.district_ar))), [clusters, streetNames, streetDistricts])
  const clusterTop = useMemo(() => circles.filter((c) => c.level !== 'cell').slice(0, 8), [circles])
  const activeStreetId = activeStreet && dense?.list.find((x) => x.id === activeStreet)?.props.street_ar === filters.street ? activeStreet : null
  const pickedStreet = activeStreetId ? dense!.list.find((x) => x.id === activeStreetId)! : null
  // choropleth: places of this request per district (service counts by name, else rows inside)
  const density = useMemo(() => (hasPolys && res ? densityOf(districts, res.areas?.districts || [], rows) : new Map<string, number>()), [hasPolys, res, districts, rows])
  const densityMax = useMemo(() => Math.max(0, ...density.values()), [density])
  const anyChosen = chosenD.size > 0 || Boolean(filters.street)
  const step: 1 | 2 | 3 | 4 = !res ? 1 : !anyChosen ? 2 : !selected.size ? 3 : 4
  const topDistricts = useMemo(() => [...(res?.areas?.districts || [])].sort((a, b) => b.n - a.n).slice(0, 6), [res])
  const densePanel = res && (denseList.length || topDistricts.length) ? (
    <section aria-labelledby="dense-title" className="flex flex-col gap-2 border-b border-[var(--color-border-default)] px-5 py-3">
      {denseList.length ? <>
        <h2 id="dense-title" className="flex items-center gap-2 text-[14px] leading-[22px] font-semibold"><StreetIcon size={18} className="text-[var(--color-icon-secondary)]" />أكثر الشوارع كثافة</h2>
        {dense?.basis ? <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{dense.basis}</p> : null}
        <ol className="flex flex-col" data-testid="dense-streets">
          {topStreets(denseList).map((st, i) => (
            <li key={st.id}>
              <button type="button" disabled={busy} aria-pressed={activeStreetId === st.id} onClick={() => pickStreet(st.id)}
                className={`fi-host flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-start text-[14px] leading-[22px] hover:bg-[var(--color-bg-surface-2)] disabled:opacity-60 ${activeStreetId === st.id ? 'bg-[var(--color-bg-primary-subtle)] font-medium' : ''} ${FOCUS_RING}`}>
                <span aria-hidden className="w-4 text-center text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{st.props.street_ar}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-text-secondary)]">{n(st.props.n)} محل · {st.props.per_100m.toLocaleString('en-US', { maximumFractionDigits: 1 })} لكل ١٠٠ م</span>
              </button>
            </li>
          ))}
        </ol>
      </> : <h2 id="dense-title" className="sr-only">أكثر الأحياء</h2>}
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
    if (!waNumber(r)) return
    setSelected((s) => { const x = new Set(s); if (x.has(r.poi_key)) x.delete(r.poi_key); else x.add(r.poi_key); return x })
  }
  const approved = tpl?.status === 'APPROVED'
  const holder = tpl?.holder?.holder_rfq_id || null
  const templateBlock = !message.trim() ? 'اكتب نص الرسالة' : tplError ? 'تعذّر التحقق من حالة القالب' : !tpl ? 'جارٍ التحقق من القالب…' : template === OUTREACH_TEMPLATE && !approved ? `القالب ${OUTREACH_TEMPLATE} غير معتمد من Meta (${tpl.status})` : template !== OUTREACH_TEMPLATE && !templates.some((t) => t.name === template && templateFits(t)) ? 'القالب ما يناسب الحملة' : null
  const marketingBlock = objective === 'marketing' ? 'اكتشاف المشترين فقط؛ الإرسال غير مفعّل لهذا المسار' : null
  const sendBlock = marketingBlock || (!chosen.length ? 'حدد جهة وحدة على الأقل' : templateBlock || (!holder ? 'ما فيه طلب حاضن للردود' : null))
  const scheduleBlock = marketingBlock || (!chosen.length ? 'حدد جهة وحدة على الأقل' : templateBlock)
  const cost = price != null ? (chosen.length * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
  const templateBadge = approved || template !== OUTREACH_TEMPLATE ? { tone: 'Success' as const, label: 'قالب واتساب معتمد' } : tpl ? { tone: 'Warning' as const, label: `القالب: ${tpl.status}` } : tplError ? { tone: 'Danger' as const, label: 'حالة القالب غير معروفة' } : null
  // drafts live in this page only (owner: nothing on the device); a reload clears them
  const saveDraft = () => {
    setConfirming(false)
    setNotice(`أبشر، الحملة محفوظة كمسودة في هذه الصفحة (${n(chosen.length)} موردين). ترسلها بضغطة لما يتفعّل الإرسال؛ تحديث الصفحة يمسحها.`)
  }

  const resultCard = (r: TargetRow) => {
    const ch = channelOf(r), can = ch === 'WhatsApp', on = selected.has(r.poi_key), name = safeName(r)
    return (
      <li key={r.poi_key} data-key={r.poi_key} className="border-b border-[var(--color-border-default)]">
        <div className={`flex flex-row items-start gap-3 px-4 py-3 ${profile === r.poi_key ? 'bg-[var(--color-bg-surface-2)]' : 'hover:bg-[var(--color-bg-surface-2)]'}`}>
          <input type="checkbox" checked={on} disabled={!can} onChange={() => toggle(r)} aria-label={`اختر ${name} للحملة`} title={can ? undefined : ch === 'Email' ? 'الحملة على واتساب فقط' : 'ما عنده قناة واتساب بعد'}
            className={`mt-1 size-5 shrink-0 accent-[var(--map-ink)] ${FOCUS_RING}`} />
          <button type="button" onClick={() => setProfile(r.poi_key)} className={`flex min-w-0 flex-1 flex-col gap-1 text-start ${FOCUS_RING}`}>
            <span className={`truncate text-[15px] leading-[24px] font-semibold ${ch === 'Unreachable' ? 'text-[var(--color-text-secondary)]' : ''}`}>{name}</span>
            {pathOf(r) ? <span className="truncate text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{pathOf(r)}</span> : null}
            <RowBadges r={r} />
            <span className="truncate text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{placeOf(r) || '—'}{hasPoint(r) ? '' : ' · موقع تقريبي'}</span>
          </button>
          <span className="flex shrink-0 flex-col items-end gap-1"><ChannelBadge channel={ch} />{statusBadge(r)}{fitBadge(r)}<SaudiEstablishmentBadge evidence={r} /></span>
        </div>
      </li>
    )
  }
  const resultsBody = !res ? (
    <p className="px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{busy ? 'جارٍ البحث…' : objective === 'marketing' ? 'اكتب تخصصك مثل «مواد سباكة» أو ارفع كتالوجك، ثم اختر حياً على الخريطة.' : 'اكتب المنتج أو الخدمة (مثل: حدايد وبويات)، واختر المدينة، واضغط ابحث. ثم اختر حياً على الخريطة لعرض محلاته.'}</p>
  ) : !cohort.length ? (
    <p className="px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{rows.length ? 'ما فيه منشآت هنا مع الأحياء أو التضييق المختار. وسّع الاختيار أو شِل أحد المرشحات.' : filters.district || filters.street || filters.wholesale || filters.role || filters.specialty ? 'ما فيه جهات بهذا الوصف مع التضييق المختار. شِل أحد المرشحات فوق.' : 'ما لقينا جهات بهذا الوصف. جرّب كلمة ثانية أو مدينة أوسع.'}</p>
  ) : (
    <ul>
      {cohort.slice(0, shown).map(resultCard)}
      {shown < cohort.length ? <li className="px-4 py-3"><Button variant="Ghost" size="S" onClick={() => setShown((s) => s + PAGE)}>اعرض {n(Math.min(PAGE, cohort.length - shown))} أكثر</Button></li> : null}
      {truncated && shown >= cohort.length ? (
        <li className="flex flex-row items-center justify-between gap-3 px-4 py-3">
          <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">معروض {n(rows.length)} من {n(res.total)} — الأقرب للوصف أولًا.</span>
          <Button variant="Ghost" size="S" disabled={busy} loading={busy} loadingLabel="نحمّل…" onClick={() => void loadMore()}>حمّل {n(Math.min(FETCH, res.total - rows.length))} أكثر</Button>
        </li>
      ) : null}
    </ul>
  )
  const panelHead = (
    <div className="flex flex-col gap-2 border-b border-[var(--color-border-default)] px-4 pt-3">
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="اللوحة" className="flex gap-1 rounded-full bg-[var(--color-bg-surface-2)] p-1">
          {([['results', `النتائج${res ? ` · ${n(cohort.length)}` : ''}`], ['guide', 'الدليل']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-full px-4 py-1.5 text-[14px] leading-[22px] font-medium ${tab === k ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--farq-button-shadow)]' : 'text-[var(--color-text-secondary)]'} ${FOCUS_RING}`}>{l}</button>
          ))}
        </div>
        {res && waInCohort ? (
          <button type="button" className={`text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] hover:underline ${FOCUS_RING}`}
            onClick={() => setSelected(chosen.length ? new Set() : pickBest(cohort))}>
            {chosen.length ? 'إلغاء التحديد' : hasAi ? 'حدد المناسبين' : mobile ? 'حدد واتساب' : 'حدد اللي عندهم واتساب'}
          </button>
        ) : null}
      </div>
      {res ? (
        <p className="pb-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
          {chosenD.size ? `داخل ${n(chosenD.size)} ${chosenD.size === 1 ? 'حي' : 'أحياء'} مختارة` : 'كل نتائج البحث — اختر حياً على الخريطة لتضييقها وعرض الدبابيس'}
          {focus ? ` · ${focus.level === 'main' ? mainAr(focus.id) : focus.level === 'sub' ? subAr(focus.id) || '' : focus.id}` : ''}
          {approxCount ? ` · ${n(approxCount)} بموقع تقريبي (بلا دبوس)` : ''}
          {focus ? <button type="button" onClick={() => setFocus(null)} className={`ms-2 font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>إلغاء الفرز</button> : null}
        </p>
      ) : null}
    </div>
  )
  const panelBody = tab === 'results' ? (
    <>{densePanel}{clusterList}<MyRequests mobile={mobile} refresh={savedTick} />{resultsBody}</>
  ) : (
    <GuideTree guide={res ? guide : []} focus={focus} onFocus={pickFocus} empty={res ? 'ما فيه أنشطة هنا. اختر حياً فيه محلات.' : 'ابحث أولاً، ثم اختر حياً لعرض أنشطته وتخصصاته هنا.'} />
  )

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
    <div className={`relative min-h-0 overflow-hidden rounded-[18px] border border-[var(--color-border-default)] bg-[var(--map-land)] ${mobile ? 'h-[52dvh] shrink-0' : 'flex-1'}`}>
      <LayerMap districts={hasPolys ? districts : []} chosen={chosenD} onDistrict={toggleDistrict} pins={pins} layer={layer} onPin={(k) => setProfile(k)}
        nameOf={(k) => { const r = byKey.get(k); return r ? safeName(r) : 'منشأة' }} clusters={circles} onCluster={pickCluster}
        streets={denseList} activeStreet={activeStreetId} onStreet={pickStreet} density={density} densityMax={densityMax}
        site={site} placingSite={placingSite} onPlaceSite={(lat, lon) => { setSite({ lat, lon, km: site?.km || 10 }); setPlacingSite(false) }} fit={fit} extent={extent} />
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div role="radiogroup" aria-label="طبقة الخريطة" className="pointer-events-auto flex items-center gap-1 rounded-[14px] border-2 border-[var(--map-ink)] bg-[var(--color-bg-surface)] p-1 shadow-[var(--farq-soft-shadow)]">
            {mobile ? null : <span aria-hidden className="px-2 text-[13px] font-semibold text-[var(--color-text-secondary)]">اعرض المحلات حسب:</span>}
            {LAYERS.map((l) => (
              <button key={l.key} type="button" role="radio" aria-checked={layer === l.key} onClick={() => { setLayer(l.key); if (focus && focus.level !== l.key) setFocus(null) }}
                className={`flex items-center gap-1.5 rounded-[10px] ${mobile ? 'px-2.5 py-1.5 text-[13px]' : 'px-3.5 py-2 text-[14px]'} leading-[20px] font-semibold ${layer === l.key ? 'bg-[var(--map-ink)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)]'} ${FOCUS_RING}`}>
                <LayerSwatch layer={l.key} />{mobile ? l.label.replace('الأنشطة ', '') : l.label}
              </button>
            ))}
          </div>
          <div className="pointer-events-auto flex flex-wrap gap-1.5">
            {districts.length ? <>
              <button type="button" onClick={() => setChosenD(new Set(districts.map((d) => d.id)))} className={`rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[13px] font-medium shadow-[var(--farq-soft-shadow)] ${FOCUS_RING}`}>كل الأحياء</button>
              <button type="button" disabled={!chosenD.size} onClick={() => { setChosenD(new Set()); setFocus(null) }} className={`rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[13px] font-medium shadow-[var(--farq-soft-shadow)] disabled:opacity-50 ${FOCUS_RING}`}>إزالة الكل</button>
            </> : null}
            {site ? (
              <span className="flex items-center gap-1 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] py-1 ps-3 pe-1 text-[13px] font-medium shadow-[var(--farq-soft-shadow)]">
                <label htmlFor="site-radius">موقع المشروع · نطاق التوصيل</label>
                <select id="site-radius" value={site.km} onChange={(e) => setSite({ ...site, km: Number(e.target.value) })} className={`rounded-full bg-[var(--color-bg-surface-2)] px-2 py-0.5 ${FOCUS_RING}`}>
                  {RADII.map((r) => <option key={r} value={r}>{r} كم</option>)}
                </select>
                <button type="button" aria-label="إزالة موقع المشروع" onClick={() => setSite(null)} className={`flex size-7 items-center justify-center rounded-full hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}><Icon name="x" size={14} /></button>
              </span>
            ) : (
              <button type="button" aria-pressed={placingSite} onClick={() => setPlacingSite((p) => !p)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium shadow-[var(--farq-soft-shadow)] ${placingSite ? 'border-[var(--map-ink)] bg-[var(--map-ink)] text-white' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)]'} ${FOCUS_RING}`}>
                <Icon name="map-pin" size={14} />{placingSite ? 'اضغط على الخريطة' : 'موقع المشروع'}
              </button>
            )}
          </div>
        </div>
        {fallbackChips}
      </div>
      {!anyChosen ? (
        <p role="status" data-testid="map-hint" className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-2 text-center text-[14px] leading-[22px] font-medium shadow-[var(--farq-soft-shadow)] ${mobile ? 'top-[96px] w-[88%]' : 'bottom-4 max-w-[56%]'}`}>
          {polys === null ? 'نحمّل أحياء المدينة…'
            : !res ? 'اكتب وش تبي فوق واضغط «ابحث»، ونوريك وين يتركز في المدينة.'
            : busy ? 'نحسب أكثف الشوارع والأحياء…'
            : denseList.length ? 'الخطوط الخضراء أكثف الشوارع، والأحياء الأغمق فيها محلات أكثر. اضغط شارعاً أو حياً لتظهر محلاته.'
            : hasPolys ? 'الأحياء الأغمق فيها محلات أكثر. اضغط حياً لتظهر محلاته.'
            : 'اختر حياً من القائمة فوق لتظهر محلاته.'}
        </p>
      ) : null}
      {pickedStreet ? (
        <div data-testid="street-card" className="absolute start-3 top-[64px] z-10 flex w-[min(300px,80%)] flex-col gap-1.5 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3 text-[13px] leading-[20px] shadow-[var(--farq-soft-shadow)]">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold"><StreetIcon size={15} className="me-1 inline text-[var(--map-green)]" />{pickedStreet.props.street_ar}</p>
            <button type="button" aria-label="إغلاق بطاقة الشارع" onClick={() => { setActiveStreet(null); applyFilters(keep(filters, ['street'])) }} className={`flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}><Icon name="x" size={14} /></button>
          </div>
          {pickedStreet.props.sub_ar ? <p className="text-[var(--color-text-secondary)]">{pickedStreet.props.sub_ar}</p> : null}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">المحلات</dt><dd className="m-0 font-semibold tabular-nums">{n(pickedStreet.props.n)} محل</dd></div>
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">طول المقطع</dt><dd className="m-0 font-semibold tabular-nums">{fmtMeters(pickedStreet.props.length_m)}</dd></div>
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">الكثافة</dt><dd className="m-0 font-semibold tabular-nums">{pickedStreet.props.per_100m.toLocaleString('en-US', { maximumFractionDigits: 1 })} محل لكل ١٠٠ م</dd></div>
            <div><dt className="text-[12px] text-[var(--color-text-secondary)]">جملة</dt><dd className="m-0 font-semibold tabular-nums">{n(pickedStreet.props.n_wholesale)} محل</dd></div>
          </dl>
        </div>
      ) : null}
      <MapLegend mobile={mobile} />
      {profile && byKey.get(profile) && !mobile ? (
        <ProfileDrawer row={byKey.get(profile)!} mobile={false} onClose={() => setProfile(null)} chosen={selected.has(profile)} onChoose={() => toggle(byKey.get(profile)!)} />
      ) : null}
    </div>
  )

  const tray = chosen.length ? (
    <CampaignTray mobile={mobile} count={chosen.length} keys={chosen.map((r) => r.poi_key)} cost={cost} message={message} onMessage={setMessage}
      template={template} onTemplate={setTemplate} templates={templates} sendBlock={sendBlock} scheduleBlock={scheduleBlock} templateBadge={templateBadge}
      city={city} showTiming={objective === 'purchase'} onSend={() => setConfirming(true)} onClear={() => setSelected(new Set())} onNotice={setNotice} />
  ) : null
  const confirmSheet = confirming && holder ? (
    <CampaignConfirmSheet template={template} holderRfqId={holder} rows={chosen} message={message.trim()} query={query} price={price} city={city}
      onClose={() => setConfirming(false)} onSaveDraft={saveDraft}
      onDone={(sent, failed) => { setConfirming(false); setNotice(`تم بحمد الله، أرسلنا ${n(sent)} رسالة${failed ? ` · ما وصلت ${n(failed)}` : ''}. الردود توصلك في صندوق الوارد.`) }} />
  ) : null
  const noticeLine = notice ? <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-success)]">{notice}</p> : null
  const errorLine = error ? <p role="alert" className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]"><WarningIcon size={18} />{error}</p> : null
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
      <Button type="submit" variant="Primary" size={mobile ? 'S' : 'M'} disabled={!q.trim() || !city || busy} loading={busy} loadingLabel={mobile ? '…' : 'جارٍ البحث…'}>ابحث</Button>
    </form>
  )

  if (mobile) {
    return (
      <div className="flex min-w-0 flex-col gap-3 bg-[var(--color-bg-canvas)] px-4 pt-4 pb-6">
        <h1 className="sr-only">خريطة الفرص</h1>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {direction}
          <div className="flex gap-1">
            <Button variant="Ghost" size="S" icon={NewRequestIcon} onClick={() => setStartOpen(true)}>طلب جديد</Button>
            <Button variant="Ghost" size="S" icon={MessageTemplatesIcon} onClick={onTemplates}>القوالب</Button>
          </div>
        </div>
        {searchForm}
        {suggestBar}
        {understood}
        {areaBar}
        {errorLine}
        {linesPanel}
        {fileField}
        <StepStrip current={step} mobile />
        <Counters values={counters} compact />
        {mapBlock}
        {tray}
        {noticeLine}
        <section aria-label="النتائج والدليل" className="-mx-4 flex flex-col bg-[var(--color-bg-surface)]">
          {panelHead}
          {panelBody}
        </section>
        {profile && byKey.get(profile) ? <ProfileDrawer row={byKey.get(profile)!} mobile onClose={() => setProfile(null)} chosen={selected.has(profile)} onChoose={() => toggle(byKey.get(profile)!)} /> : null}
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
            <h1 className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">خريطة الفرص</h1>
            {direction}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="Primary" size="S" icon={NewRequestIcon} onClick={() => setStartOpen(true)}>طلب جديد</Button>
            <Button variant="Secondary" size="S" icon={MessageTemplatesIcon} onClick={onTemplates}>قوالب واتساب</Button>
          </div>
          {fileField}
        </div>
        {searchForm}
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
          <StepStrip current={step} mobile={false} />
          <Counters values={counters} />
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

/** A leading icon inside a picker <select>. */
function IconSlot({ icon: I }: { icon: typeof DistrictIcon }) {
  return <I size={16} className="pointer-events-none absolute start-3 text-[var(--color-icon-secondary)]" />
}
