import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { listCities, listTemplates, searchTargets, templateBody, templateFits, templateStatus, tradeClusters, type MetaTemplate, type City, type SearchFilters, type TradeCluster, waNumber, statusLabel, TargetingError, OUTREACH_TEMPLATE, type TargetRow, type TargetSearch, type TemplateStatus } from '../../api/targetingClient'
import {
  Badge, Button, ChannelBadge, Chip, CityIcon, ClustersIcon, DistrictIcon, ErrorIcon, FiltersIcon, InfoIcon, MessageTemplatesIcon, Money, NewRequestIcon,
  SaudiEstablishmentBadge, SearchIcon, Stat, StreetIcon, SuccessIcon, useIsMobile, WarningIcon, WholesaleIcon, Icon, type Channel,
} from '../../ui'
import { BUY_EXAMPLES, BUY_PLACEHOLDER, BUY_PLACEHOLDER_SHORT, marketNameFor, marketSuggestions, SELL_EXAMPLES, SELL_PLACEHOLDER, SELL_PLACEHOLDER_SHORT } from '../../lib/saudi'
import SendTiming from './SendTiming'
import { FOCUS_RING } from '../../ui/cx'
import TargetMap from './TargetMap'
import { readBooklet, type BookletLine } from '../../lib/readBooklet'
import { fetchConstructionWhatsAppPricing } from '../../api/constructionClient'

// Mapbox when the build has a public token (VITE_MAPBOX_TOKEN), else the drawn map; loaded on its own.
const HAS_MAPBOX = Boolean(import.meta.env.VITE_MAPBOX_TOKEN)
const MapboxMap = lazy(() => import('./MapboxMap'))
function MapView(props: Parameters<typeof TargetMap>[0]) {
  if (!HAS_MAPBOX) return <TargetMap {...props} />
  return (
    <Suspense fallback={null}>
      <MapboxMap {...props} />
      {props.legend === false ? null : (
        <div className="pointer-events-none absolute end-4 top-4 flex items-center gap-3 rounded-full bg-[var(--color-bg-inverse)]/80 px-3 py-2 text-[12px] leading-[18px] font-medium text-[var(--color-text-on-inverse)]">
          {[['واتساب', 'var(--brand-accent)'], ['إيميل', 'var(--brand-action-light)'], ['لا يمكن', 'var(--brand-text-3)']].map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c }} />{l}</span>
          ))}
        </div>
      )}
    </Suspense>
  )
}
import CampaignConfirmSheet from './CampaignConfirmSheet'
import MessageStep, { categoryAr, previewOf } from './MessageStep'
import StartSheet from './StartSheet'
import MyRequests from './MyRequests'
import { createOpportunityRequest, type OpportunityRequestKind } from '../../api/opportunityRequestsClient'

/*
 * «07 · خريطة الفرص» (was «الاستهداف» / «حملات الموردين») — Figma 51:2, on the targeting service's own data (POST /search over the
 * KSA places set). «10 · تأكيد إرسال الحملة» (54:607) opens in place from «أرسل الحملة».
 *
 * Only real numbers: the four counters, the results and the map come from the search answer.
 * Figma's «طلبوا الإيقاف» count and the batch pace are not in the service, so they are not shown.
 * The campaign is the approved WhatsApp template; only places with a valid mobile can be chosen.
 */

/** A campaign saved while sending is closed (Figma M11c «احفظ الحملة كمسودة»); this browser only. */
const DRAFT_KEY = 'farq.targeting.draft'
type Draft = { q: string; city: string; message: string; keys: string[]; at: number }
const readDraft = (): Draft | null => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && Array.isArray(d.keys) ? d : null } catch { return null } }
const PAGE = 150
const FETCH = 200   // rows per server page (the API maximum); «حمّل أكثر» appends the next page

export const channelOf = (r: TargetRow): Channel => (waNumber(r) ? 'WhatsApp' : r.email ? 'Email' : 'Unreachable')
const nameOf = (r: TargetRow) => r.name_ar || r.name_en || 'بدون اسم'
const placeOf = (r: TargetRow) => [r.street_ar, r.district_ar || r.district_en, r.region_ar || r.city_en].filter(Boolean).join(' · ')
const n = (v: number) => v.toLocaleString('en-US')
const CITY_KEY = 'farq.targeting.city'
/** «حدد المناسبين»: AI-likely places with WhatsApp; without an AI check, everyone with WhatsApp. */
const pickBest = (rows: TargetRow[]) => {
  const ai = rows.some((r) => r.ai)
  return new Set(rows.filter((r) => waNumber(r) && (!ai || r.ai === 'L')).map((r) => r.poi_key))
}
const rowSub = (r: TargetRow) => [r.reason || null, r.target_role === 'buyer' ? 'مشتري محتمل' : null, r.sources?.includes('farq_supplier') ? 'مورد في فرق' : null, r.target_role === 'buyer' ? null : r.match === 'seller' ? 'يبيعه غالبًا' : r.match === 'product' ? 'يذكر المنتج' : null, placeOf(r)].filter(Boolean).join(' · ') || '—'
const FIT = { L: { tone: 'Success', label: 'مناسب', icon: SuccessIcon }, M: { tone: 'Warning', label: 'محتمل', icon: WarningIcon }, N: { tone: 'Neutral', label: 'غير مناسب', icon: ErrorIcon } } as const
const fitBadge = (r: TargetRow) => (r.ai ? <Badge tone={FIT[r.ai].tone} icon={FIT[r.ai].icon} label={FIT[r.ai].label} className="text-[12px] leading-[18px]" /> : null)
const wholesaleBadge = (r: TargetRow) => (r.is_wholesale ? <Badge tone="Neutral" icon={WholesaleIcon} label="جملة" className="text-[12px] leading-[18px]" /> : null)
const statusBadge = (r: TargetRow) => { const l = statusLabel(r); return l ? <Badge tone="Warning" icon={WarningIcon} label={l} className="text-[12px] leading-[18px]" /> : null }
const arabic = (s: string) => /[؀-ۿ]/.test(s)
/** «جملة» in the request: the wholesale filter starts on (the service sets understood.wholesale on the same word). */
const WHOLESALE_RX = /جمل[ةه]/
/** The area filters under the search bar: exact district, a street inside it, wholesale only. */
type AreaFilters = Pick<SearchFilters, 'district' | 'street' | 'wholesale'>
/** «تجمعات هذا النشاط»: street / district clusters only, the first 8. */
const clusterName = (c: TradeCluster) => [c.level === 'street' ? c.street_ar : null, c.district_ar].filter(Boolean).join('، ') || c.label_ar
/** «سوق الزل للأقمشة — الديرة · 230 محل» when a curated popular name fits; otherwise «الشارع، الحي — 37 محل». */
const clusterText = (c: TradeCluster) => (c.popular_ar ? `${c.popular_ar} — ${clusterName(c)} · ${n(c.n)} محل` : `${clusterName(c)} — ${n(c.n)} محل`)

function defaultMessage(cat: string | null, area: string | null) {
  return `معك أحمد من فرق. يوصلنا طلبات تسعير${cat ? ` ${cat}` : ''} من منشآت وشركات${area ? ` في ${area}` : ''} — تبي توصلك على واتساب؟\nللإيقاف أرسل: إيقاف`
}

export default function TargetingPage({ onTemplates, startNew = false, onStartClosed, onRfq }: {
  onTemplates: () => void
  /** «طلب جديد» (sidebar / tab bar): open the start sheet */
  startNew?: boolean
  onStartClosed?: () => void
  /** the buyer price-request wizard (/new), linked from the start sheet */
  onRfq?: () => void
}) {
  const mobile = useIsMobile()
  const [objective, setObjective] = useState<'purchase' | 'marketing'>(() => { try { return sessionStorage.getItem('farq-target-direction') === 'marketing' ? 'marketing' : 'purchase' } catch { return 'purchase' } })
  const generation = useRef(0)
  const direction = <fieldset className="flex gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] p-2" aria-label="من تبحث عنه؟">
    {([{ value: 'purchase', label: 'بائعون — أبي أشتري' }, { value: 'marketing', label: 'مشترون — أبي أبيع' }] as const).map(option => <label key={option.value} className="flex flex-1 flex-row items-center gap-2 text-[14px]">
      <input type="radio" name="target-direction" checked={objective === option.value} onChange={() => { generation.current++; setObjective(option.value); setRes(null); clearAreas(); setSelected(new Set()); setLines(ls => ls.map(({ found: _found, ...line }) => line)); setActiveLine(null); setError(null); setConfirming(false); setComposeOpen(false) }} />{option.label}
    </label>)}
  </fieldset>
  const [q, setQ] = useState(() => { try { return sessionStorage.getItem('farq-target-query') || '' } catch { return '' } })
  useEffect(() => { try { sessionStorage.removeItem('farq-target-query') } catch { /* optional handoff */ } }, [])
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
  const [composeOpen, setComposeOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  // area filters (district / street / wholesale) and the trade clusters of the current request
  const [filters, setFilters] = useState<AreaFilters>({})
  const [clusters, setClusters] = useState<{ list: TradeCluster[]; basis?: string } | null>(null)
  const clusterGen = useRef(0)
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; at: number } | null>(null)
  const clearAreas = () => { clusterGen.current++; setFilters({}); setClusters(null); setFlyTo(null) }
  // a booklet turned into lines: tap a line to search for it in the chosen city
  const fileInput = useRef<HTMLInputElement>(null)
  const [lines, setLines] = useState<(BookletLine & { found?: number })[]>([])
  const [booklet, setBooklet] = useState<string | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [readErr, setReadErr] = useState<string | null>(null)
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const list = useRef<HTMLUListElement>(null)
  // the city is required: the search runs inside one city only
  const [cities, setCities] = useState<City[]>([])
  const [city, setCity] = useState(() => { try { return localStorage.getItem(CITY_KEY) || '' } catch { return '' } })
  const pickCity = (v: string) => { generation.current++; setCity(v); setError(null); setRes(null); clearAreas(); setSelected(new Set()); setActiveLine(null); setLines(ls => ls.map(({ found: _found, ...line }) => line)); try { localStorage.setItem(CITY_KEY, v) } catch { /* storage blocked */ } }

  useEffect(() => { templateStatus().then(setTpl, () => setTplError(true)) }, [])
  // any approved template the send path can fill ({{1}} name, {{2}} text); the invitation template by default
  const [template, setTemplate] = useState(OUTREACH_TEMPLATE)
  const [templates, setTemplates] = useState<MetaTemplate[]>([])
  useEffect(() => { listTemplates().then((r) => setTemplates(r?.ok ? (r.data || []).filter((t) => t.status === 'APPROVED') : []), () => setTemplates([])) }, [])
  // «طلب جديد»: the start sheet opens when the route asks for it
  const [startOpen, setStartOpen] = useState(startNew)
  const [startSeen, setStartSeen] = useState(startNew)
  if (startNew !== startSeen) { setStartSeen(startNew); if (startNew) setStartOpen(true) }
  const closeStart = () => { setStartOpen(false); if (startNew) onStartClosed?.() }
  // Cost = the server's price per message (GET /api/construction/whatsapp/pricing) × recipients (owner decision).
  const [price, setPrice] = useState<number | null>(null)
  useEffect(() => { void fetchConstructionWhatsAppPricing().then((p) => setPrice(p.enabled && p.price_sar ? Number(p.price_sar) : null)) }, [])
  const [draft, setDraft] = useState<Draft | null>(() => readDraft())
  const restoring = useRef<string[] | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  useEffect(() => {
    let active = true
    listCities().then(values => {
      if (!active) return
      setCities(values)
      setCity(saved => values.some(value => value.en === saved) ? saved : '')
    }, () => { if (active) setCities([]) })
    return () => { active = false }
  }, [])
  const cityName = (en: string) => cities.find((c) => c.en === en)?.ar || en

  const rows = useMemo(() => res?.rows || [], [res])
  const counts = useMemo(() => {
    let wa = 0, emailOnly = 0, none = 0
    for (const r of rows) { const c = channelOf(r); if (c === 'WhatsApp') wa++; else if (c === 'Email') emailOnly++; else none++ }
    return { wa, emailOnly, none }
  }, [rows])
  const truncated = res ? rows.length < res.total : false
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.poi_key)), [rows, selected])
  const hasAi = Boolean(res?.ai_checked)
  const citySelect = (cls: string) => (
    <>
      <label className="sr-only" htmlFor="targeting-city">المدينة</label>
      <span className="relative inline-flex shrink-0 items-center">
      <CityIcon size={16} className="pointer-events-none absolute start-2 text-[var(--color-icon-secondary)]" />
      <select id="targeting-city" required value={cities.some(value => value.en === city) ? city : ''} onChange={(e) => pickCity(e.target.value)} aria-invalid={!city}
        className={`shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] py-1.5 ps-7 pe-2 ${city ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'} ${FOCUS_RING} ${cls}`}>
        <option value="">اختر المدينة</option>
        {cities.map((c) => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}
      </select>
      </span>
    </>
  )

  const chips = useMemo(() => {
    if (!res) return []
    const p = res.parsed || {}
    const cat = (p.keywords || []).filter(arabic)[0] || ''
    const area = p.city ? cityName(p.city) : null
    return [cat ? `المنتج: ${cat}` : null, p.seller_label ? `الجهات المناسبة: ${p.seller_label}` : null, area ? `المدينة: ${area}` : null].filter(Boolean) as string[]
  }, [res, cities])

  async function search(e?: FormEvent) {
    e?.preventDefault()
    setActiveLine(null)
    await runSearch(q.trim())
  }
  async function searchLine(i: number) {
    if (!city || !cities.some(value => value.en === city)) { setError('اختر مدينة البحث من القائمة.'); return }
    setActiveLine(i); setQ(lines[i].name)
    const found = await runSearch(lines[i].name)
    if (found != null) setLines((ls) => ls.map((l, k) => (k === i ? { ...l, found } : l)))
  }
  // «طلباتي»: a start that read something is saved as a request (references only, never file contents).
  // Quiet when the API is off or refuses: the search itself never depends on it.
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
  async function runSearch(text: string): Promise<number | null> { return runSearchIn(text, city) }
  // every result, not only the first page: the next server page is appended to the list and the map
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
  function loadClusters(text: string, city: string, wholesale: boolean, obj: typeof objective = objective) {
    const v = ++clusterGen.current
    setClusters(null)
    tradeClusters({ city, q: text, objective: obj, ...(wholesale ? { wholesale: true } : {}) }).then(
      (c) => { if (v === clusterGen.current) setClusters({ list: (c?.clusters || []).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).map((x) => ({ ...x, popular_ar: marketNameFor(x, city, text) })), basis: c?.basis }) },
      () => { if (v === clusterGen.current) setClusters(null) },
    )
  }
  /** A new request (next = undefined) starts without area filters, wholesale on when it asks for «جملة»; otherwise the same request with these filters. */
  async function runSearchIn(text: string, city: string, next?: AreaFilters, obj: typeof objective = objective, initial?: AreaFilters): Promise<number | null> {
    if (!text || !city || busy) return null
    setBusy(true); setError(null); setNotice(null)
    const version = generation.current
    const fresh = next === undefined
    let use: AreaFilters = fresh ? (initial ?? (WHOLESALE_RX.test(text) ? { wholesale: true } : {})) : next
    try {
      let r = await searchTargets(text, city, FETCH, obj, 0, use)
      // the service read «جملة» where the page did not: turn the filter on and ask again
      if (fresh && r.understood?.wholesale && !use.wholesale && version === generation.current) { use = { wholesale: true }; r = await searchTargets(text, city, FETCH, obj, 0, use) }
      if (version !== generation.current) return null
      setRes(r); setQuery(text); setShown(PAGE); setFilters(use)
      const keep = restoring.current
      restoring.current = null
      if (fresh) setSelected(keep ? new Set(r.rows.filter((x) => keep.includes(x.poi_key) && waNumber(x)).map((x) => x.poi_key)) : new Set())
      // narrowing keeps the places still in the results chosen
      else setSelected((cur) => new Set(r.rows.filter((x) => cur.has(x.poi_key)).map((x) => x.poi_key)))
      if (fresh || Boolean(use.wholesale) !== Boolean(filters.wholesale)) loadClusters(text, city, Boolean(use.wholesale), obj)
      const p = r.parsed || {}
      const cat = (p.keywords || []).filter(arabic)[0] || null
      if (fresh && !keep) setMessage(defaultMessage(cat, cityName(city)))
      return r.total
    } catch (err) {
      if (version !== generation.current) return null
      setError(err instanceof TargetingError ? err.message : 'تعذّر البحث. تأكد من الاتصال وحاول مرة ثانية.')
      return null
    } finally { setBusy(false) }
  }
  const applyFilters = (next: AreaFilters) => { if (query) void runSearchIn(query, city, next) }
  const pickCluster = (c: TradeCluster) => {
    setFlyTo((cur) => ({ lat: c.lat, lon: c.lon, at: (cur?.at || 0) + 1 }))
    if (!c.district_ar) return
    applyFilters({ wholesale: filters.wholesale, district: c.district_ar, street: c.level === 'street' && c.street_ar ? c.street_ar : undefined })
  }

  /** «أبي أبيع منتجاتي»: confirmed specialties become search lines on the buyers' side; the first one runs now. */
  const startSelling = (names: string[], files: string[] = []) => {
    closeStart()
    saveRequest(files.length ? 'SELLER_CATALOG' : 'SELLER_PRODUCTS', `أبيع: ${names.slice(0, 3).join('، ')}${names.length > 3 ? '…' : ''}`, names, files)
    generation.current++
    setObjective('marketing'); try { sessionStorage.setItem('farq-target-direction', 'marketing') } catch { /* optional */ }
    setRes(null); clearAreas(); setSelected(new Set()); setError(null); setConfirming(false); setComposeOpen(false)
    setLines(names.map((name) => ({ name, qty: '', unit: '' }))); setBooklet('تخصصاتك'); setActiveLine(null)
    if (!city || !cities.some((c) => c.en === city)) { setError('اختر المدينة، ثم اضغط التخصص للبحث عن مشترين.'); return }
    setActiveLine(0); setQ(names[0])
    void runSearchIn(names[0], city, undefined, 'marketing').then((found) => { if (found != null) setLines((ls) => ls.map((l, k) => (k === 0 ? { ...l, found } : l))) })
  }
  const startSheet = startOpen ? (
    <StartSheet mobile={mobile} onClose={closeStart} onRfq={onRfq}
      onBooklet={() => {
        if (objective === 'marketing') { generation.current++; setObjective('purchase'); setRes(null); clearAreas(); setSelected(new Set()) }
        fileInput.current?.click(); closeStart()
      }}
      onFreeSearch={() => { closeStart(); requestAnimationFrame(() => input.current?.focus()) }}
      onSellLines={startSelling} />
  ) : null

  const fileField = (
    <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden
      accept=".pdf,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*"
      onChange={(e) => void onBooklet([...(e.target.files || [])])} />
  )
  const linesPanel = (row: boolean) => (reading || readErr || lines.length) ? (
    <section aria-label="منتجات وخدمات الملف" className="flex flex-col gap-2">
      {reading ? <p role="status" className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{reading}</p> : null}
      {readErr ? <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]">{readErr}</p> : null}
      {lines.length ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-[14px] leading-[22px] font-medium ${row ? 'text-[var(--color-text-on-inverse)]' : ''}`}>عناصر الملف ({n(lines.length)}){booklet ? <span className={row ? 'text-[var(--color-text-on-inverse-secondary)]' : 'text-[var(--color-text-tertiary)]'}> · <bdi>{booklet}</bdi></span> : null}</p>
            <button type="button" onClick={() => { setLines([]); setBooklet(null); setActiveLine(null) }} className={`text-[12px] leading-[18px] ${row ? 'text-[var(--color-text-on-inverse-secondary)]' : 'text-[var(--color-text-tertiary)]'} hover:underline ${FOCUS_RING}`}>إزالة</button>
          </div>
          <ul className={row ? '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1' : 'flex max-h-[112px] flex-wrap gap-2 overflow-y-auto'}>
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

  // «جملة فقط» · «الحي» · «الشارع» under the search bar; an active filter is a chip with ×
  const areas = res?.areas
  const streets = useMemo(() => (areas?.streets || []).filter((x) => !filters.district || x.district === filters.district), [areas, filters.district])
  const pickerCls = `max-w-[140px] shrink-0 appearance-none rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] py-2 ps-9 pe-4 text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)] enabled:hover:border-[var(--color-border-strong)] disabled:opacity-50 ${FOCUS_RING}`
  const areaBar = (row: boolean) => res && areas && (areas.districts.length || areas.streets.length || areas.wholesale || filters.wholesale || filters.district || filters.street) ? (
    <fieldset aria-label="تضييق النتائج" className={`m-0 min-w-0 border-0 ${row ? '-mx-4 flex items-center gap-2 overflow-x-auto px-4 pt-0 pb-1' : 'flex flex-wrap items-center gap-2 p-0'}`}>
      <FiltersIcon size={18} className="shrink-0 text-[var(--color-icon-secondary)]" />
      {areas.wholesale || filters.wholesale ? (
        <Chip className="shrink-0" icon={WholesaleIcon} label={`جملة فقط · ${n(areas.wholesale)}`} selected={Boolean(filters.wholesale)} disabled={busy}
          onClick={() => applyFilters({ ...filters, wholesale: !filters.wholesale || undefined })} />
      ) : null}
      {filters.district ? (
        <Chip className="shrink-0" icon={DistrictIcon} label={`الحي: ${filters.district}`} selected disabled={busy} onRemove={() => applyFilters({ wholesale: filters.wholesale })} />
      ) : areas.districts.length ? (
        <>
          <label className="sr-only" htmlFor="targeting-district">الحي</label>
          <span className="relative inline-flex shrink-0 items-center">
            <DistrictIcon size={16} className="pointer-events-none absolute start-3 text-[var(--color-icon-secondary)]" />
            <select id="targeting-district" value="" disabled={busy} className={pickerCls} onChange={(e) => { if (e.target.value) applyFilters({ wholesale: filters.wholesale, district: e.target.value }) }}>
              <option value="">الحي ▾</option>
              {areas.districts.map((d) => <option key={d.name} value={d.name}>{d.name} ({n(d.n)})</option>)}
            </select>
          </span>
        </>
      ) : null}
      {filters.street ? (
        <Chip className="shrink-0" icon={StreetIcon} label={`الشارع: ${filters.street}`} selected disabled={busy} onRemove={() => applyFilters({ wholesale: filters.wholesale, district: filters.district })} />
      ) : streets.length ? (
        <>
          <label className="sr-only" htmlFor="targeting-street">الشارع</label>
          <span className="relative inline-flex shrink-0 items-center">
          <StreetIcon size={16} className="pointer-events-none absolute start-3 text-[var(--color-icon-secondary)]" />
          <select id="targeting-street" value="" disabled={busy} className={pickerCls}
            onChange={(e) => { const st = streets[Number(e.target.value)]; if (e.target.value && st) applyFilters({ wholesale: filters.wholesale, district: filters.district || st.district || undefined, street: st.name }) }}>
            <option value="">الشارع ▾</option>
            {streets.map((st, i) => <option key={`${st.district}|${st.name}`} value={i}>{st.name}{filters.district || !st.district ? '' : ` — ${st.district}`} ({n(st.n)})</option>)}
          </select>
          </span>
        </>
      ) : null}
    </fieldset>
  ) : null
  // before a search: the words people say («حدايد وبويات»، «مليس»…) and the city's known markets («سوق الزل للأقمشة»)
  const examples = objective === 'marketing' ? SELL_EXAMPLES : BUY_EXAMPLES
  const markets = useMemo(() => (objective === 'purchase' ? marketSuggestions(city) : []), [city, objective])
  const tryExample = (term: string, district?: string) => {
    setQ(term); setActiveLine(null)
    if (!city) { setError('اختر المدينة، ثم اضغط المثال.'); requestAnimationFrame(() => input.current?.focus()); return }
    void runSearchIn(term, city, undefined, objective, district ? { district } : undefined)
  }
  const suggestBar = (row: boolean) => !res && !busy ? (
    <div aria-label="أمثلة للبحث" role="group" className={row ? '-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1' : 'flex flex-wrap items-center gap-2'}>
      <span className={`shrink-0 text-[14px] leading-[22px] font-medium ${row ? 'rounded-full bg-[var(--color-bg-surface)] px-3 py-1.5 text-[var(--color-text-secondary)]' : 'text-[var(--color-text-secondary)]'}`}>جرّب:</span>
      {examples.map((t) => <Chip key={t} className="shrink-0" label={t} onClick={() => tryExample(t)} />)}
      {markets.map((m) => <Chip key={m.label} className="shrink-0" label={m.label} onClick={() => tryExample(m.term, m.district)} />)}
    </div>
  ) : null
  const clusterTop = useMemo(() => (clusters?.list || []).filter((c) => c.level !== 'cell').slice(0, 8), [clusters])
  const clusterList = clusterTop.length ? (
    <details open className="group border-t border-[var(--color-border-default)] px-5 py-3">
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 text-[14px] leading-[22px] font-medium ${FOCUS_RING}`}>
        <span className="flex items-center gap-2"><ClustersIcon size={18} className="text-[var(--color-icon-secondary)]" />تجمعات هذا النشاط</span>
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
                {c.wholesale_pct >= 30 ? <Badge tone="Neutral" icon={WholesaleIcon} label="جملة" className="px-2 py-0 text-[12px] leading-[18px]" /> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  ) : null
  const mapClusters = { clusters: clusters?.list || [], onCluster: pickCluster, flyTo }

  const toggle = (r: TargetRow) => {
    if (!waNumber(r)) return
    setSelected((s) => { const x = new Set(s); if (x.has(r.poi_key)) x.delete(r.poi_key); else x.add(r.poi_key); return x })
  }
  const focusRow = (key: string) => {
    const i = rows.findIndex((r) => r.poi_key === key)
    if (i < 0) return
    if (i >= shown) setShown(i + 1)
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  const approved = tpl?.status === 'APPROVED'
  const holder = tpl?.holder?.holder_rfq_id || null
  const sendBlock = objective === 'marketing' ? 'اكتشاف المشترين فقط؛ الإرسال غير مفعّل لهذا المسار' : !res ? 'ابحث أولًا' : !chosen.length ? 'حدد جهة وحدة على الأقل' : !message.trim() ? 'اكتب نص الرسالة' : tplError ? 'تعذّر التحقق من حالة القالب' : !tpl ? 'جارٍ التحقق من القالب…' : template === OUTREACH_TEMPLATE && !approved ? `القالب ${OUTREACH_TEMPLATE} غير معتمد من Meta (${tpl.status})` : !holder ? 'ما فيه طلب حاضن للردود' : null
  const cost = price != null ? (chosen.length * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
  const costLine = cost != null ? <>≈ <Money amount={cost} vat="excl" noteClassName="text-[length:inherit] leading-[inherit] font-[inherit]" /></> : 'سعر الرسالة يظهر في المراجعة'
  const saveDraft = () => {
    const d: Draft = { q: query, city, message: message.trim(), keys: chosen.map((r) => r.poi_key), at: Date.now() }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* storage blocked */ }
    setDraft(d); setConfirming(false); setComposeOpen(false)
    setNotice(`أبشر، حفظنا الحملة كمسودة على هذا الجهاز (${n(d.keys.length)} موردين). ترسلها بضغطة لما يتفعّل الإرسال.`)
  }
  const resumeDraft = async () => {
    if (!draft) return
    restoring.current = draft.keys
    setQ(draft.q); setMessage(draft.message)
    if (draft.city !== city) pickCity(draft.city)
    setDraft(null)
    await runSearchIn(draft.q, draft.city)
  }
  const draftBanner = draft && !res ? (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-surface)] px-3 py-2 text-[14px] leading-[22px] shadow-[var(--elevation-lg)]">
      <span>عندك حملة محفوظة: {draft.q} · <bdi dir="ltr">{n(draft.keys.length)}</bdi> موردين</span>
      <span className="flex gap-1"><Button variant="Ghost" size="S" onClick={() => void resumeDraft()}>كمّلها</Button><Button variant="Ghost" size="S" onClick={() => { try { localStorage.removeItem(DRAFT_KEY) } catch { /* storage blocked */ } setDraft(null) }}>احذفها</Button></span>
    </div>
  ) : null

  const compose = (
    <section aria-labelledby="campaign-title" className={`flex flex-col gap-3 rounded-[var(--radius-xl)] bg-[var(--color-bg-surface)] p-5 text-start shadow-[var(--elevation-lg)] ${mobile ? 'w-full' : 'w-[520px] max-w-[calc(100%-48px)]'}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="campaign-title" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">رسالة الحملة</h2>
        {approved || template !== OUTREACH_TEMPLATE ? <Badge tone="Success" showDot={false} label="قالب واتساب معتمد" /> : tpl ? <Badge tone="Warning" showDot={false} label={`القالب: ${tpl.status}`} /> : tplError ? <Badge tone="Danger" showDot={false} label="حالة القالب غير معروفة" /> : null}
      </div>
      {templates.length ? (
        <label className="flex flex-col gap-1">
          <span className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">القالب (المعتمدة من ميتا)</span>
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className={`rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-[14px] ${FOCUS_RING}`}>
            {templates.some((t) => t.name === OUTREACH_TEMPLATE) ? null : <option value={OUTREACH_TEMPLATE}>{OUTREACH_TEMPLATE}</option>}
            {templates.map((t) => {
              const fits = templateFits(t) || (t.name === OUTREACH_TEMPLATE && !templateBody(t))
              return <option key={t.name} value={t.name} disabled={!fits}>{[t.name, categoryAr(t.category)].filter(Boolean).join(' · ')}{fits ? '' : ' — متغيراته ما تناسب الحملة'}</option>
            })}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col rounded-[var(--radius-lg)] bg-[var(--color-bg-surface-2)] px-3.5 py-3 focus-within:outline-2 focus-within:outline-solid focus-within:outline-[var(--color-border-primary)]">
        <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">السلام عليكم {'{اسم المحل}'}،</span>
        <span className="sr-only">نص الرسالة</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={900}
          className="w-full resize-none bg-transparent text-[16px] leading-[26px] text-[var(--color-text-primary)] outline-none" />
      </label>
      {(() => { const body = template === OUTREACH_TEMPLATE ? '' : templateBody(templates.find((t) => t.name === template) || { name: '', status: '' }); return body ? <p className="text-[12px] leading-[18px] whitespace-pre-line text-[var(--color-text-secondary)]">معاينة: {previewOf(body, message)}</p> : null })()}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[16px] leading-[26px] font-medium">بيوصل لـ {n(chosen.length)} جهة</p>
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">
            {res ? <>{n(counts.wa)} عندهم واتساب · {costLine}</> : 'ابحث عن الجهات أولًا'}
          </p>
        </div>
        <Button variant="Primary" size="M" icon="send" disabled={Boolean(sendBlock)} title={sendBlock || undefined} onClick={() => setConfirming(true)}>أرسل الحملة</Button>
      </div>
      {sendBlock && res ? <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{sendBlock}</p> : null}
      {objective === 'purchase' ? <SendTiming city={city} /> : null}
      {notice ? <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-success)]">{notice}</p> : null}
    </section>
  )

  const results = (
    <section aria-labelledby="results-title" className={`flex min-h-0 flex-col bg-[var(--color-bg-surface)] ${mobile ? 'w-full border-t' : 'h-full w-[380px] shrink-0 border-e'} border-[var(--color-border-default)]`}>
      <div className="flex items-baseline justify-between gap-2 px-5 py-4">
        <h2 id="results-title" className="flex items-baseline gap-2">
          <span className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">النتائج</span>
          {res ? <span className="text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)]">{n(res.total)}</span> : null}
        </h2>
        {res && counts.wa ? (
          <button type="button" className={`text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] hover:underline ${FOCUS_RING}`}
            onClick={() => setSelected(chosen.length ? new Set() : pickBest(rows))}>
            {chosen.length ? 'إلغاء التحديد' : hasAi ? 'حدد المناسبين' : 'حدد اللي عندهم واتساب'}
          </button>
        ) : null}
      </div>
      {clusterList}
      <MyRequests refresh={savedTick} />
      {!res ? (
        <p className="border-t border-[var(--color-border-default)] px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{busy ? 'جارٍ البحث…' : 'اكتب وش تبي توصل له (نشاط ومدينة) واضغط ابحث.'}</p>
      ) : !rows.length ? (
        <p className="border-t border-[var(--color-border-default)] px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{filters.district || filters.street || filters.wholesale ? 'ما فيه جهات بهذا الوصف مع التضييق المختار. شِل أحد المرشحات فوق.' : 'ما لقينا جهات بهذا الوصف. جرّب كلمة ثانية أو مدينة أوسع.'}</p>
      ) : (
        <ul ref={list} className={`${mobile ? 'max-h-[60dvh]' : 'min-h-0 flex-1'} overflow-y-auto`}>
          {rows.slice(0, shown).map((r) => {
            const ch = channelOf(r)
            const on = selected.has(r.poi_key)
            const can = ch === 'WhatsApp'
            return (
              <li key={r.poi_key} data-key={r.poi_key} className="border-t border-[var(--color-border-default)]">
                <label className={`flex flex-row items-center gap-3 px-5 py-3.5 ${can ? 'cursor-pointer hover:bg-[var(--color-bg-surface-2)]' : ''}`} title={can ? undefined : ch === 'Email' ? 'الحملة على واتساب فقط' : 'ما عنده وسيلة تواصل صالحة'}>
                  <input type="checkbox" checked={on} disabled={!can} onChange={() => toggle(r)} className={`size-5 shrink-0 accent-[var(--color-bg-primary)] ${FOCUS_RING}`} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={`truncate text-[16px] leading-[26px] font-medium ${ch === 'Unreachable' ? 'text-[var(--color-text-tertiary)]' : ''}`}>{nameOf(r)}</span>
                    <span className="truncate text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{rowSub(r)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1"><ChannelBadge channel={ch} />{wholesaleBadge(r)}{statusBadge(r)}{fitBadge(r)}<SaudiEstablishmentBadge evidence={r} /></span>
                </label>
              </li>
            )
          })}
          {shown < rows.length ? (
            <li className="border-t border-[var(--color-border-default)] px-5 py-3">
              <Button variant="Ghost" size="S" onClick={() => setShown((s) => s + PAGE)}>اعرض {n(Math.min(PAGE, rows.length - shown))} أكثر</Button>
            </li>
          ) : null}
          {truncated && shown >= rows.length ? (
            <li className="flex flex-row items-center justify-between gap-3 border-t border-[var(--color-border-default)] px-5 py-3">
              <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">معروض {n(rows.length)} من {n(res.total)} — الأقرب للوصف أولًا.</span>
              <Button variant="Ghost" size="S" disabled={busy} loading={busy} loadingLabel="نحمّل…" onClick={() => void loadMore()}>حمّل {n(Math.min(FETCH, res.total - rows.length))} أكثر</Button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )

  const basisOf = truncated ? `من أول ${n(rows.length)} نتيجة` : null
  const confirmSheet = confirming && holder ? (
    <CampaignConfirmSheet template={template} holderRfqId={holder} rows={chosen} message={message.trim()} query={query} price={price} city={city}
      onClose={() => setConfirming(false)} onSaveDraft={saveDraft}
      onDone={(sent, failed) => { setConfirming(false); setComposeOpen(false); try { localStorage.removeItem(DRAFT_KEY) } catch { /* storage blocked */ } setNotice(`تم بحمد الله، أرسلنا ${n(sent)} رسالة${failed ? ` · ما وصلت ${n(failed)}` : ''}. الردود توصلك في صندوق الوارد.`) }} />
  ) : null

  // Phones: Figma M07 (59:439) — the map fills the screen under a floating search; counters, results and the
  // campaign button sit in a bottom sheet; the message opens in its own sheet, then the confirm sheet (10).
  if (mobile) {
    const mini = (label: string, value: number, color: string) => (
      <div className="flex flex-col items-center rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] py-2">
        <span className="font-[family-name:var(--font-display)] text-[18px] leading-[26px] font-semibold tabular-nums" style={{ color }}>{n(value)}</span>
        <span className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      </div>
    )
    return (
      <div className="relative h-[calc(100dvh-72px)] overflow-hidden bg-[var(--color-bg-inverse)]">
        <h1 className="sr-only">خريطة الفرص</h1>
        {/* Figma M07 `18396:2027`: map first, the list sheet starts collapsed. */}
        <div className="absolute inset-0">
          <MapView rows={rows} selected={selected} onToggle={(r) => { toggle(r); focusRow(r.poi_key) }} topInset={(chips.length ? 170 : 130) + (areas ? 50 : 0) + (lines.length ? 70 : 0)} legend={false} {...mapClusters} />
        </div>
        <div className="absolute inset-x-4 top-4 flex flex-col gap-3">
          {direction}
          <form role="search" onSubmit={search} className="flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] py-1.5 ps-4 pe-1.5 shadow-[var(--elevation-lg)]">
            <SearchIcon size={18} className="text-[var(--color-icon-secondary)]" />
            <label className="sr-only" htmlFor="targeting-q">وش تبي توصل له؟</label>
            <input id="targeting-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={objective === 'marketing' ? SELL_PLACEHOLDER_SHORT : BUY_PLACEHOLDER_SHORT}
              className="min-w-0 flex-1 bg-transparent text-[16px] leading-[26px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
            {citySelect('max-w-[116px] text-[14px]')}
            <Button type="submit" variant="Primary" size="S" disabled={!q.trim() || !city || busy} loading={busy} loadingLabel="…">ابحث</Button>
          </form>
          {suggestBar(true)}
          {chips.length ? (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {chips.map((c) => <button key={c} type="button" onClick={() => input.current?.focus()} className={`shrink-0 whitespace-nowrap rounded-full bg-[var(--color-bg-surface)] px-4 py-1.5 text-[14px] leading-[22px] font-medium ${FOCUS_RING}`}>{c.replace(/^[^:]+:\s*/, '')}</button>)}
            </div>
          ) : null}
          {areaBar(true)}
          {error ? <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]">{error}</p> : null}
          {linesPanel(true)}
          {draftBanner}
          {res && rows.length && !sheetOpen ? <p className="flex items-center gap-1.5 self-center rounded-full bg-[var(--color-bg-surface)] px-3 py-1.5 text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] shadow-[var(--elevation-lg)]"><InfoIcon size={16} />اضغط الدبوس لتختار المورد</p> : null}
          {fileField}
        </div>
        <section aria-label="النتائج" className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-[var(--radius-xl)] bg-[var(--color-bg-surface)] shadow-[var(--elevation-lg)] ${sheetOpen ? 'h-[72%]' : ''}`}>
          <button type="button" aria-expanded={sheetOpen} onClick={() => setSheetOpen((o) => !o)} className={`flex min-h-11 w-full flex-col items-center gap-1 px-4 pt-2 ${FOCUS_RING}`}>
            <span aria-hidden className="h-1 w-10 rounded-full bg-[var(--color-border-strong)]" />
            <span className="sr-only">{sheetOpen ? 'صغّر القائمة' : 'افتح القائمة'}</span>
          </button>
          <div className="flex items-center justify-between gap-2 px-4 pt-2">
            <button type="button" onClick={() => setSheetOpen((o) => !o)} className={`min-h-11 text-start text-[14px] leading-[22px] font-medium ${FOCUS_RING}`}>{res ? <><bdi dir="ltr">{n(res.total)}</bdi> نتيجة{sheetOpen ? '' : ' · اسحب للأعلى للقائمة'}</> : objective === 'marketing' ? 'ابحث عن مشترين محتملين' : 'ابحث عن بائعين'}</button>
            <div className="flex items-center gap-3">
              {res && counts.wa ? (
                <button type="button" className={`text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] ${FOCUS_RING}`}
                  onClick={() => setSelected(chosen.length ? new Set() : pickBest(rows))}>
                  {chosen.length ? 'إلغاء التحديد' : hasAi ? 'حدد المناسبين' : 'حدد واتساب'}
                </button>
              ) : null}
              <Button variant="Ghost" size="S" icon={NewRequestIcon} onClick={() => setStartOpen(true)}>طلب جديد</Button>
              <Button variant="Ghost" size="S" icon={MessageTemplatesIcon} onClick={onTemplates}>القوالب</Button>
            </div>
          </div>
          {sheetOpen && res ? (
            <div className="grid grid-cols-4 gap-2 px-4 py-3">
              {mini('وُجد', res.total, 'var(--color-text-primary)')}
              {mini('واتساب المعروض', counts.wa, 'var(--color-text-success)')}
              {mini('إيميل المعروض', counts.emailOnly, 'var(--color-text-info)')}
              {mini('بلا قناة مؤكدة', counts.none, 'var(--color-text-tertiary)')}
            </div>
          ) : null}
          {sheetOpen && res ? <p className="px-4 pb-2 text-[12px] text-[var(--color-text-secondary)]">نعرض {n(rows.length)} من {n(res.total)} جهة؛ أعداد التواصل تخص المعروض فقط.{res.contact_enrichment === 'not_configured' ? ' البحث التلقائي عن الأرقام غير مفعّل بعد.' : ''}</p> : null}
          <ul ref={list} className={sheetOpen ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
            {clusterList ? <li className="-mx-1">{clusterList}</li> : null}
            <li className="-mx-1"><MyRequests mobile refresh={savedTick} /></li>
            {!res && !busy ? <li className="px-5 py-6 text-[14px] leading-[24px] text-[var(--color-text-secondary)]">{objective === 'marketing' ? 'اكتب تخصصك مثل «مواد سباكة»، أو ارفع كتالوجك ثم اختر تخصصًا أو منتجًا للبحث عن مشترين محتملين.' : 'اكتب المنتج أو الخدمة التي تحتاجها، أو ارفع قائمة احتياجاتك ثم اختر عنصرًا للبحث عن بائعين.'} اختر المدينة لتحديد نطاق البحث.</li> : null}
            {busy ? <li role="status" className="px-5 py-6 text-[14px]">نفهم المنتج أو الخدمة ونبحث عن الجهات المناسبة…</li> : null}
            {res && !rows.length ? <li className="px-5 py-6 text-[14px]">لم نجد جهات مناسبة لهذا العنصر في المدينة المختارة. جرّب وصفًا أوضح أو مدينة أخرى.</li> : null}
            {rows.slice(0, shown).map((r) => {
              const ch = channelOf(r), can = ch === 'WhatsApp'
              return (
                <li key={r.poi_key} data-key={r.poi_key}>
                  <label className="flex flex-row items-center gap-3 px-4 py-2.5">
                    <input type="checkbox" checked={selected.has(r.poi_key)} disabled={!can} onChange={() => toggle(r)} className={`size-5 shrink-0 accent-[var(--color-bg-primary)] ${FOCUS_RING}`} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate text-[16px] leading-[24px] font-medium ${ch === 'Unreachable' ? 'text-[var(--color-text-tertiary)]' : ''}`}>{nameOf(r)}</span>
                      <span className="truncate text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{rowSub(r)}</span>
                      {r.phone_source && r.phone ? <span className="text-[12px]">هاتف عام: <bdi dir="ltr">{r.phone}</bdi> · واتساب غير مؤكد</span> : null}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1"><ChannelBadge channel={ch} />{wholesaleBadge(r)}{statusBadge(r)}{fitBadge(r)}<SaudiEstablishmentBadge evidence={r} /></span>
                  </label>
                </li>
              )
            })}
            {shown < rows.length ? <li className="px-4 py-2"><Button variant="Ghost" size="S" onClick={() => setShown((s) => s + PAGE)}>اعرض {n(Math.min(PAGE, rows.length - shown))} أكثر</Button></li> : null}
          </ul>
          {notice ? <p role="status" className="mx-4 mb-2 rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-success)]">{notice}</p> : null}
          {/* Figma summary bar: what is chosen and what it costs, from step 1. */}
          <div className="flex items-center justify-between gap-3 bg-[var(--color-bg-inverse)] px-4 py-3 text-[var(--color-text-on-inverse)]">
            <div className="flex min-w-0 flex-col">
              <p className="text-[16px] leading-[26px] font-medium">اخترت <bdi dir="ltr">{n(chosen.length)}</bdi> موردين</p>
              <p className="text-[12px] leading-[18px] text-[var(--color-text-on-inverse-secondary)]">واتساب <bdi dir="ltr">{n(chosen.length)}</bdi>{cost != null ? <> · = <Money amount={cost} vat="excl" noteClassName="text-[length:inherit] leading-[inherit] text-[var(--color-text-on-inverse-secondary)]" /></> : null}</p>
            </div>
            <Button variant="Secondary" size="M" disabled={!chosen.length} title={chosen.length ? undefined : 'اختر مورد واحد على الأقل'} onClick={() => setComposeOpen(true)}>التالي</Button>
          </div>
        </section>
        {composeOpen ? (
          <div role="dialog" aria-modal="true" aria-label="رسالة الحملة" className="fixed inset-x-0 top-0 bottom-[72px] z-50 overflow-y-auto farq-dots">
            <MessageStep city={city} template={template} onTemplate={setTemplate} count={chosen.length} cost={cost} message={message} onMessage={setMessage} onBack={() => setComposeOpen(false)}
              onNext={() => setConfirming(true)} onNewTemplate={onTemplates}
              blocked={objective === 'marketing' ? 'الإرسال غير متاح لمسار المشترين' : !holder && tpl ? 'ما فيه طلب حاضن للردود' : null} />
          </div>
        ) : null}
        {confirmSheet}
        {startSheet}
      </div>
    )
  }

  return (
    <div className={`flex min-w-0 flex-col ${mobile ? '' : 'h-dvh'}`}>
      <header className={`flex flex-col gap-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/70 ${mobile ? 'px-4 py-4' : 'px-8 py-6'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">خريطة الفرص</h1>
            {direction}
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">اكتشف البائعين أو المشترين المحتملين حسب هدفك</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="Primary" size="S" icon={NewRequestIcon} onClick={() => setStartOpen(true)}>طلب جديد</Button>
            <Button variant="Secondary" size="S" icon={MessageTemplatesIcon} onClick={onTemplates}>قوالب واتساب</Button>
          </div>
          {fileField}
        </div>
        <form role="search" onSubmit={search} className="flex items-center gap-3 rounded-[var(--radius-lg)] border-2 border-[var(--color-border-primary)] bg-[var(--color-bg-surface)] py-2 ps-4 pe-2">
          <SearchIcon size={22} className="text-[var(--color-icon-secondary)]" />
          <label className="sr-only" htmlFor="targeting-q">وش تبي توصل له؟</label>
          <input id="targeting-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={objective === 'marketing' ? SELL_PLACEHOLDER : BUY_PLACEHOLDER}
            className="min-w-0 flex-1 bg-transparent text-[18px] leading-[30px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
          {citySelect('w-[170px] text-[16px]')}
          <Button type="submit" variant="Primary" size="M" disabled={!q.trim() || !city || busy} loading={busy} loadingLabel="جارٍ البحث…">ابحث</Button>
        </form>
        {chips.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)]"><Icon name="bolt" size={16} />فهمنا طلبك كذا:</span>
            {chips.map((c) => (
              <button key={c} type="button" onClick={() => input.current?.focus()} className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--color-bg-info)] px-3 py-1.5 text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] ${FOCUS_RING}`}>
                {c}<Icon name="edit" size={14} />
              </button>
            ))}
            {res?.parsed?.ai === false ? <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">(فهم بالقاموس الداخلي)</span> : null}
          </div>
        ) : null}
        {suggestBar(false)}
        {areaBar(false)}
        {error ? <p role="alert" className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]"><WarningIcon size={18} />{error}</p> : null}
        {linesPanel(false)}
        {draftBanner}
      </header>

      {res ? (
        <div className={`grid gap-4 ${mobile ? 'grid-cols-2 px-4 py-4' : 'grid-cols-4 px-8 py-4'}`}>
          <Stat label="وُجد" value={n(res.total)} basis={res.ai_checked ? `الذكاء فحص ${n(res.ai_checked)}: مناسب ${n(res.ai_likely || 0)} · محتمل ${n(res.ai_maybe || 0)}` : res.parsed?.ai === false ? 'بيانات عامة · فهم بالقاموس' : 'بيانات عامة · فهم بالذكاء'} />
          <Stat label="عندهم واتساب" tone="Success" value={n(counts.wa)} basis={basisOf || 'رقم جوال سعودي صيغته صحيحة'} />
          <Stat label="إيميل فقط" value={n(counts.emailOnly)} basis={basisOf || 'ما عندهم واتساب معروف'} />
          <Stat label="لا يمكن الإرسال" tone="Danger" value={n(counts.none)} basis={basisOf || 'بدون وسيلة تواصل صالحة'} />
        </div>
      ) : null}

      <div className={`flex min-h-0 flex-1 ${mobile ? 'flex-col' : 'flex-row'}`}>
        {results}
        <div className={`relative min-w-0 flex-1 overflow-hidden bg-[var(--color-bg-inverse)] ${mobile ? 'h-[360px] flex-none' : ''}`}>
          <MapView rows={rows} selected={selected} onToggle={(r) => { toggle(r); focusRow(r.poi_key) }} bottomInset={320} {...mapClusters} />
          {mobile ? null : <div className="pointer-events-none absolute inset-x-6 bottom-6 flex justify-start"><div className="pointer-events-auto">{compose}</div></div>}
        </div>
        {mobile ? <div className="p-4">{compose}</div> : null}
      </div>

      {confirmSheet}
      {startSheet}
    </div>
  )
}
