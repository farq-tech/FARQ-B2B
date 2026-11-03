'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, MapPinOff, MousePointerClick, Search, X } from 'lucide-react'
import { CopyLinkButton } from '@/components/shared/copy-link'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { PillField, SearchPill, pillControl } from '@/components/shared/search-pill'
import { Chip } from '@/components/ui/chip'
import { Skeleton } from '@/components/ui/skeleton'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN, populationMethod } from '@/lib/explanations'
import { counted, numberFormat, useCities } from '@/lib/insights-api'
import { useMainActivities } from '@/lib/main-activities'
import { useStudiedActivity } from '@/lib/sticky-state'
import { cn } from '@/lib/utils'
import { useCityData, type DistrictRow } from './city-data'
import { DistrictPanel } from './district-panel'
import { LensMapCanvas, SHADES, shadeSteps } from './lens-map-canvas'
import { MapOnboarding } from './map-onboarding'
import { readMapQuery, writeMapQuery } from './map-query'
import { HALF, MapSheet, PEEK, PEEK_PX, type SheetSnap } from './map-sheet'
import { LENSES, METRICS, lensById, type LensId, type MetricId, type ToolId } from './lenses'
import { AroundTool } from './tools/around-tool'
import { AudienceTool } from './tools/audience-tool'
import { CompareTool } from './tools/compare-tool'
import { CompetitorsTool } from './tools/competitors-tool'
import { CorridorsTool } from './tools/corridors-tool'
import { BusinessesPanel } from './businesses-panel'
import { GapsTool } from './tools/gaps-tool'
import { HomesTool } from './tools/homes-tool'
import { LayerPicker, LegendTitle, MapLegend } from './tools/map-legend'
import type { Overlay } from './tools/overlay'
import { TerritoriesTool } from './tools/territories-tool'

const format = (value: number | null, unit?: string) => (value == null ? 'غير متاح' : `${numberFormat.format(value)}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`)

/** The explanation of one district's value of the shading metric. */
function metricExplanation(metric: MetricId, row: DistrictRow): string[] {
  switch (metric) {
    case 'population': return [populationMethod(row.populationSource)]
    case 'businesses': return EXPLAIN.businesses('district')
    case 'residentsPerBusiness': return EXPLAIN.residentsPerBusiness(row.population, row.businesses)
    case 'restaurants': return EXPLAIN.restaurants
    case 'menuPrice': return EXPLAIN.menuPrice(row.menuPricePlaces)
    case 'unmet': return EXPLAIN.unmet(row.searches, row.unmetSearches)
    case 'villaShare': return EXPLAIN.villaShare
    case 'shopRent': return EXPLAIN.realEstate(row.realEstate.rent_year_commercial?.listings, 'rent_year')
    case 'homeRent': return EXPLAIN.realEstate(row.realEstate.rent_year_residential?.listings, 'rent_year')
    case 'homeRentMonthly': return EXPLAIN.realEstate(row.realEstate.rent_month_residential?.listings, 'rent_month')
    case 'homePrice': return EXPLAIN.realEstate(row.realEstate.sale_residential?.listings, 'sale')
    case 'dealPrice': return EXPLAIN.registeredDeals(row.deals.residential?.deals)
    case 'warehouseRent': return EXPLAIN.realEstate(row.realEstate.rent_year_warehouse?.listings, 'rent_year')
    case 'income': return EXPLAIN.income
    case 'growth': return EXPLAIN.growth(row.underConstruction, row.newBuildings)
  }
}

function Ranking({ rows, metric, selected, onToggle, full }: {
  rows: DistrictRow[]
  metric: MetricId
  selected: string[]
  onToggle: (id: string) => void
  full: boolean
}) {
  const { label, value, unit } = METRICS[metric]
  const ranked = rows.filter((row) => value(row) != null).sort((a, b) => (value(b) as number) - (value(a) as number))
  const shown = full ? ranked : ranked.slice(0, 5)
  return (
    <section aria-label={`ترتيب الأحياء حسب ${label}`} className="rounded-2xl border bg-card p-4">
      <h3 className="text-base font-bold">الأعلى في {label}</h3>
      <ol className={cn('mt-2 divide-y text-base', full && 'max-h-[50vh] overflow-y-auto')}>
        {shown.map((row, index) => (
          <li key={row.id}>
            <div className={cn('flex w-full items-center gap-2 py-2', selected.includes(row.id) && 'text-primary')}>
              <span className="w-6 text-sm text-muted-foreground">{numberFormat.format(index + 1)}</span>
              <button onClick={() => onToggle(row.id)} className="flex-1 truncate text-start font-medium hover:text-primary">{row.name}</button>
              <Explained title={`${label} · ${row.name}`} lines={metricExplanation(metric, row)} className="font-semibold tabular-nums">{format(value(row), unit)}</Explained>
            </div>
          </li>
        ))}
      </ol>
      {full && ranked.length < rows.length && <p className="mt-2 text-sm text-muted-foreground">{numberFormat.format(rows.length - ranked.length)} حياً: غير متاح</p>}
    </section>
  )
}

/** A native select dressed as a chip, for the phone's floating row. */
function ChipSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return (
    <span className="relative shrink-0">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}
        // a select is as wide as its longest option: with real district names «كل الأحياء» took most of the row, so the
        // chip fits its picked name where the browser can (field-sizing) and is capped everywhere else
        className="h-9 w-auto max-w-[10.5rem] [field-sizing:content] appearance-none truncate rounded-full border border-primary/40 bg-card/95 ps-3.5 pe-8 text-sm font-semibold text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </span>
  )
}

/**
 * A row that scrolls sideways on a phone. It keeps its padding at both ends, starts at the reading (RTL) start, fades
 * the edge that hides more chips so the cut reads as «there is more», and brings the active item (`aria-selected` or
 * `aria-pressed`) into view when `active` changes. Where everything fits, nothing fades and nothing moves.
 */
function ScrollRow({ label, role = 'group', active, className, style, onKeyDown, children }: {
  label: string
  role?: 'group' | 'tablist'
  active?: string
  className?: string
  style?: CSSProperties
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}) {
  const row = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  // measured from the items themselves, so it holds in RTL and LTR alike
  const measure = useCallback(() => {
    const el = row.current
    if (!el || !el.children.length) return
    const box = el.getBoundingClientRect()
    const rects = Array.from(el.children, (child) => child.getBoundingClientRect())
    const left = Math.min(...rects.map((rect) => rect.left)) < box.left - 1
    const right = Math.max(...rects.map((rect) => rect.right)) > box.right + 1
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }))
  }, [])
  useEffect(() => {
    const el = row.current
    if (!el) return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [measure])
  // items come and go with the lens (metric chips, steps): measuring is cheap and a same answer changes nothing
  useEffect(() => { measure() })
  useEffect(() => {
    const el = row.current
    const item = active == null ? null : el?.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]')
    if (!el || !item) return
    const box = el.getBoundingClientRect()
    const rect = item.getBoundingClientRect()
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    // the extra 40px clears the fade, so the active item is read, not guessed
    if (rect.left < box.left + 4) el.scrollBy({ left: rect.left - box.left - 40, behavior })
    else if (rect.right > box.right - 4) el.scrollBy({ left: rect.right - box.right + 40, behavior })
  }, [active])
  const fade = edges.left || edges.right
    ? `linear-gradient(to right, ${edges.left ? 'transparent' : '#000'}, #000 40px, #000 calc(100% - 40px), ${edges.right ? 'transparent' : '#000'})`
    : undefined
  return (
    <div ref={row} role={role} aria-label={label} onScroll={measure} onKeyDown={onKeyDown}
      className={cn('flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
      style={{ ...style, maskImage: fade, WebkitMaskImage: fade }}>
      {children}
    </div>
  )
}

/**
 * The step of a journey as a numbered tab: a chip in the phone's scrolling row, and from lg one cell of a stepper
 * (number over a short label) so the panel's results start near its top.
 */
function StepTab({ index, label, active, onClick }: { index: number; label: string; active: boolean; onClick: () => void }) {
  return (
    <button role="tab" aria-selected={active} tabIndex={active ? 0 : -1} onClick={onClick}
      className={cn('flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        'lg:min-w-0 lg:flex-col lg:justify-start lg:gap-1 lg:px-1 lg:py-2 lg:text-center lg:leading-snug',
        active ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground lg:border-transparent lg:hover:bg-muted/60')}>
      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold', active ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{numberFormat.format(index + 1)}</span>
      {label}
    </button>
  )
}

/** Arrow keys, Home and End move between the tabs of a tablist and open the one they land on (WAI-ARIA tabs). */
function tabKeys(event: KeyboardEvent<HTMLDivElement>) {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))
  const at = tabs.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  // in RTL the next step sits to the left
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
  const arrows: Record<string, number> = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }
  const step = arrows[event.key]
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step != null ? (at + step + tabs.length) % tabs.length : null
  if (next == null) return
  event.preventDefault()
  tabs[next].focus()
  tabs[next].click()
}

/**
 * The answer to a tap, first in the panel: the picked district's name and its two golden figures, straight from its
 * row, with a jump to the full summary further down. The step's own tool stays right under it.
 */
function PickedStrip({ chosen, onDetails, onClear }: { chosen: DistrictRow[]; onDetails: () => void; onClear: () => void }) {
  const single = chosen.length === 1 ? chosen[0] : null
  return (
    <section aria-label="الحي المختار" className="flex flex-col gap-2 rounded-2xl border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold">{single ? single.name : `${counted(chosen.length, 'district')}: ${chosen.map((row) => row.name).join('، ')}`}</h2>
        <button onClick={onClear} aria-label="إلغاء التحديد" className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" aria-hidden /></button>
      </div>
      {single && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">السكان <Explained title={`السكان · ${single.name}`} lines={EXPLAIN.population([single.populationSource], single.population)} className="font-semibold text-foreground tabular-nums">{format(single.population)}</Explained></span>
          <span className="text-muted-foreground">المنشآت <Explained title={`المنشآت · ${single.name}`} lines={EXPLAIN.businesses('district')} className="font-semibold text-foreground tabular-nums">{format(single.businesses)}</Explained></span>
        </p>
      )}
      <button onClick={onDetails} className="self-start text-sm font-semibold text-primary underline-offset-4 hover:underline">ملخص {single ? 'الحي' : 'الأحياء'} كاملاً</button>
    </section>
  )
}

/**
 * The answer to a click, on the district itself: its name, the open step's figure for it (or the shading figure, or its
 * population) as already loaded, and «التفاصيل» for the full summary in the panel. A missing figure reads «غير متاح».
 */
function DistrictCard({ name, lines, at, top: ceiling, bottom: floor, onDetails, onClose }: {
  name: string
  lines: { label: string; value: string }[]
  at: { x: number; y: number; width: number; height: number }
  /** The part of the map in view, top to bottom (pixels): under the phone's floating controls, above its sheet. */
  top: number
  bottom: number
  onDetails: () => void
  onClose: () => void
}) {
  // above the click, centred on it; below it when the controls would cover it; always inside the part in view
  const width = Math.min(256, at.width - 16)
  const left = Math.min(Math.max(8, at.x - width / 2), at.width - width - 8)
  const height = 64 + lines.length * 22 + 36
  const wanted = at.y - 12 - height >= ceiling ? at.y - 12 - height : at.y + 12
  const top = Math.max(ceiling, Math.min(wanted, floor - height))
  return (
    <section aria-label={`الحي ${name}`} className="absolute z-[7] flex flex-col gap-1.5 rounded-xl border bg-card/95 p-3 text-sm shadow-lg backdrop-blur"
      style={{ left, width, top }}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold">{name}</h2>
        <button onClick={onClose} aria-label="إغلاق" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" aria-hidden /></button>
      </div>
      {lines.map((line) => (
        <p key={line.label} className="text-muted-foreground">{line.label}: <span className="font-semibold text-foreground tabular-nums">{line.value}</span></p>
      ))}
      <button onClick={onDetails} className="mt-1 self-start rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60">التفاصيل</button>
    </section>
  )
}

// a landing goal opens the lens that serves it; «find a supplier» opens the business search instead
const GOAL_LENS: Record<string, LensId> = { explore: 'analysts', expand: 'shops', target: 'marketers', network: 'distributors', property: 'property' }

// the fixed district filter writes into the same `selected` as a map tap; this value marks «several chosen on the map»
const DISTRICTS_MULTI = '__multi__'

/**
 * Atlas map with one journey per user group (docs/atlas-product-foundation.md §4): the group's steps in order, its
 * three figures on the map, and one business search for every group.
 */
export function LensMap() {
  const cities = useCities()
  const [city, setCity] = useState('Riyadh')
  const [lens, setLens] = useState<LensId>('shops')
  const [metric, setMetric] = useState<MetricId>(lensById('shops').metric)
  const [selected, setSelected] = useState<string[]>([])
  const [tool, setTool] = useState<ToolId>(lensById('shops').steps[0].tool)
  const [overlay, setOverlay] = useState<Overlay>({})
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState<{ q: string; nonce: number } | null>(null)
  // the activity «المنافسون» is studying: a picked district then lists its competitors by name
  const [rival, setRival] = useState<string | null>(null)
  const searchBox = useRef<HTMLInputElement>(null)
  const phoneSearch = useRef<HTMLInputElement>(null)
  // the phone's bottom sheet: a picked district or a search opens it halfway so the answer shows beside the map
  const [sheet, setSheet] = useState<SheetSnap>('peek')
  // the district a step's list is pointing at, outlined on the map so a row and its place are seen together
  const [hovered, setHovered] = useState<string | null>(null)
  // the district under the mouse, named beside the pointer with its figure, before any click
  const [pointed, setPointed] = useState<{ id: string; x: number; y: number; width: number; height: number } | null>(null)
  useEffect(() => { setHovered(null) }, [tool, city])
  // a map that failed to open: its notice takes the map, and the tour waits (there is nothing to tap)
  const [mapFailed, setMapFailed] = useState(false)
  // the top of the panel, where the tour asks its goal question
  const [goalSlot, setGoalSlot] = useState<HTMLDivElement | null>(null)
  const raiseSheet = useCallback(() => setSheet((current) => (current === 'peek' ? 'half' : current)), [])
  // the district a click on the map opened a card on, where the click landed, and where that is on screen now
  const [card, setCard] = useState<{ id: string; lon: number; lat: number } | null>(null)
  const [cardAt, setCardAt] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  // a pick made by a click on the map answers in its card, so the phone's sheet stays down and the map in view
  const mapPick = useRef(false)
  const data = useCityData(city)
  const onOverlay = useCallback((next: Overlay) => setOverlay(next), [])
  const active = lensById(lens)

  useEffect(() => { setSelected([]); setCard(null) }, [city])
  // a link's ?tool= wins once over the lens's first step, when it is one of that lens's steps
  const presetTool = useRef<ToolId | null>(null)
  // and its ?layer= over the lens's own shading figure, when it is one of that lens's figures
  const presetLayer = useRef<MetricId | null>(null)
  useEffect(() => {
    const steps = lensById(lens).steps.map((step) => step.tool)
    const layer = presetLayer.current
    presetLayer.current = null
    setMetric(layer && lensById(lens).metrics.includes(layer) ? layer : lensById(lens).metric)
    setTool(presetTool.current && steps.includes(presetTool.current) ? presetTool.current : steps[0])
    presetTool.current = null
  }, [lens])
  useEffect(() => {
    setOverlay({})
    if (tool === 'growth') setMetric('growth')
  }, [tool])
  // the view lives in the address (map-query.ts): read once, every value checked, and written back as it changes
  const [hydrated, setHydrated] = useState(false)
  // districts named by the address wait for their city's districts, and only ids that exist there are picked
  const presetDistricts = useRef<{ city: string; ids: string[] } | null>(null)
  // a city named by the address waits for the list of cities, and falls back to the default when it is not there
  const presetCity = useRef<string | null>(null)
  // the studied activity is shared by the steps (sticky-state); a main activity named by id waits for the city's list
  const [studied, setStudied] = useStudiedActivity()
  const activities = useMainActivities(city)
  const presetMain = useRef<string | null>(null)
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const preset = readMapQuery(window.location.search, Object.fromEntries(LENSES.map((item) => [item.id, item.steps.map((s) => s.tool)])), GOAL_LENS,
      Object.fromEntries(LENSES.map((item) => [item.id, item.metrics])))
    if (preset.city) { presetCity.current = preset.city; setCity(preset.city) }
    if (preset.activity) setStudied({ q: preset.activity, label: preset.activity })
    presetMain.current = preset.main
    if (preset.districts.length) presetDistricts.current = { city: preset.city ?? 'Riyadh', ids: preset.districts }
    if (preset.lens && preset.lens !== lens) {
      presetTool.current = preset.tool as ToolId | null
      presetLayer.current = preset.layer as MetricId | null
      setLens(preset.lens as LensId)
    } else {
      if (preset.tool) setTool(preset.tool as ToolId)
      if (preset.layer) setMetric(preset.layer as MetricId)
    }
    if (preset.q) { setDraft(preset.q); setSearch({ q: preset.q, nonce: Date.now() }) }
    if (query.get('goal') === 'find-supplier' || query.get('search') != null) (window.matchMedia('(min-width: 64rem)').matches ? searchBox : phoneSearch).current?.focus()
    setHydrated(true)
    // read once on arrival; later changes come from the page itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const wanted = presetMain.current
    if (!wanted || !activities.length) return
    presetMain.current = null
    const item = activities.find((activity) => activity.main_id === wanted)
    if (item) setStudied({ main_id: item.main_id, label: item.main_ar })
  }, [activities, setStudied])
  useEffect(() => {
    const wanted = presetCity.current
    if (!wanted || cities.length < 2) return
    presetCity.current = null
    if (!cities.some((item) => item.en === wanted)) setCity('Riyadh')
  }, [cities])
  useEffect(() => {
    const pending = presetDistricts.current
    if (!pending || data.status === 'loading') return
    if (pending.city !== city) { if (data.status === 'ready') presetDistricts.current = null; return }
    presetDistricts.current = null
    const known = new Set(data.rows.map((row) => row.id))
    const ids = pending.ids.filter((id) => known.has(id))
    if (ids.length) { setSelected(ids); flyTo(ids[0]) }
    // flyTo only sets state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.status, data.rows, city])
  useEffect(() => {
    if (!hydrated) return
    // a main activity still waiting for its city's list keeps its place in the address
    const main = presetMain.current ?? studied.main_id ?? null
    const next = writeMapQuery(window.location.search, { city, lens, tool, districts: selected, q: search?.q ?? null, main, activity: main ? null : studied.q ?? null, layer: metric }, lensById(lens).steps[0].tool, lensById(lens).metric)
    if (next !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`)
  }, [hydrated, city, lens, tool, selected, search, studied, metric])
  useEffect(() => {
    const quiet = mapPick.current
    mapPick.current = false
    if (selected.length && !quiet) setSheet((current) => (current === 'peek' ? 'half' : current))
  }, [selected.length])
  useEffect(() => { if (search) setSheet((current) => (current === 'peek' ? 'half' : current)) }, [search])

  const steps = useMemo(() => shadeSteps(new Map(data.rows.map((row) => [row.id, METRICS[metric].value(row)]))), [data.rows, metric])
  const chosen = data.rows.filter((row) => selected.includes(row.id))
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  // a district picked from a list takes the map to it (a click on the map is already looking at it); on a phone a full
  // sheet drops to half so the district shows above it
  const [zoomTo, setZoomTo] = useState<{ id: string; nonce: number; cover: number } | null>(null)
  const flyTo = (id: string) => {
    const phone = !window.matchMedia('(min-width: 64rem)').matches
    if (phone) setSheet('half')
    setZoomTo({ id, nonce: Date.now(), cover: phone ? HALF : 0 })
  }
  const pickFromList = (id: string) => { setSelected([id]); flyTo(id) }
  const toggleFromList = (id: string) => { if (!selected.includes(id)) flyTo(id); toggle(id) }
  const cityName = cities.find((item) => item.en === city)?.ar || city
  const step = active.steps.find((item) => item.tool === tool)
  // the fixed «الحي» filter: a non-map way to focus one district, kept in sync with map taps and steady across lenses
  const districtOptions = useMemo<[string, string][]>(() => {
    const sorted = [...data.rows].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map((row) => [row.id, row.name] as [string, string])
    const base: [string, string][] = [['', 'كل الأحياء'], ...sorted]
    return selected.length > 1 ? [[DISTRICTS_MULTI, `${numberFormat.format(selected.length)} أحياء مختارة`], ...base] : base
  }, [data.rows, selected.length])
  const districtValue = selected.length === 1 ? selected[0] : selected.length > 1 ? DISTRICTS_MULTI : ''
  const pickDistrict = (value: string) => {
    if (value === DISTRICTS_MULTI) return
    setSelected(value ? [value] : [])
    if (value) flyTo(value)
  }
  const submit = () => { if (draft.trim()) setSearch({ q: draft.trim(), nonce: Date.now() }) }
  // the step that paints the districts itself owns the map's colours while it is open; the metric chips wait, and the
  // key in the map's corner says whose colours they are
  const toolColors = overlay.colors != null
  // a city whose districts came back empty, and a shading figure no district of the city has: said, not drawn blank
  const noDistricts = data.status === 'ready' && data.features.length === 0
  const metricMissing = data.status === 'ready' && data.rows.length > 0 && steps.size === 0
  // the district the open step puts first, or else the top of the shading figure (as «الأعلى في» ranks it)
  const leadId = overlay.lead ?? (toolColors ? null : [...data.rows].filter((row) => METRICS[metric].value(row) != null)
    .sort((a, b) => (METRICS[metric].value(b) as number) - (METRICS[metric].value(a) as number))[0]?.id ?? null)
  // the card stays while its district is picked and the map takes clicks as districts
  const cardRow = card && selected.includes(card.id) && !overlay.onPick ? data.rows.find((row) => row.id === card.id) ?? null : null
  const cardLines = (row: DistrictRow): { label: string; value: string }[] => {
    const population = { label: 'السكان', value: format(row.population) }
    // the open step's own figure for the district, as the step computed it
    if (overlay.facts) return [{ label: step?.label ?? '', value: overlay.facts.get(row.id) ?? 'غير متاح' }, population]
    if (!toolColors && metric !== 'population') return [{ label: METRICS[metric].label, value: format(METRICS[metric].value(row), METRICS[metric].unit) }, population]
    return [population]
  }
  const openDetails = () => {
    setSheet((current) => (current === 'full' ? current : 'half'))
    // after the sheet has risen, so the summary is scrolled to where it ends up
    window.setTimeout(() => document.getElementById('picked-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
  }
  const pointedRow = pointed && pointed.id !== cardRow?.id ? data.rows.find((row) => row.id === pointed.id) ?? null : null
  const legendTitle = overlay.legend?.title ?? (toolColors ? `ألوان الخريطة: ${step?.label ?? ''}` : step?.label ?? '')
  const sheetTitle = search ? `بحث: ${search.q}` : chosen.length ? `${step?.label} · ${chosen.map((row) => row.name).join('، ')}` : `${active.label} · ${step?.label ?? ''}`
  const showBusinesses = !search && selected.length > 0 && lens !== 'property' && ['businesses', 'gaps', 'district', 'competitors'].includes(tool)

  return (
    <main className="flex h-[calc(100dvh-8rem)] flex-col lg:h-[calc(100dvh-4rem)]">
      {/* from lg: one search pill, as on «العقار»: the city, who is looking, and what they look for. What colours the
          map is picked in the key on the map («طبقات»), beside the colours it changes */}
      <header className="hidden flex-col gap-3 border-b bg-background/70 px-4 py-3 backdrop-blur lg:flex">
        <SearchPill label="ابحث عن مورد أو نشاط" onSubmit={submit}>
          <PillField label="المدينة" className="basis-[calc(50%-0.25rem)] sm:basis-auto sm:max-w-[11rem]">
            <select aria-label="المدينة" value={city} onChange={(e) => setCity(e.target.value)} className={pillControl}>
              {cities.map((item) => <option key={item.en} value={item.en}>{item.ar || item.en}</option>)}
            </select>
          </PillField>
          <PillField label="الحي" className="basis-[calc(50%-0.25rem)] sm:basis-auto sm:max-w-[11rem]">
            <select aria-label="الحي" value={districtValue} onChange={(e) => pickDistrict(e.target.value)} className={pillControl} disabled={!data.rows.length}>
              {districtOptions.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
            </select>
          </PillField>
          <PillField label="أنا من" className="basis-[calc(50%-0.25rem)] sm:basis-auto sm:max-w-[13rem]">
            <select aria-label="الفئة" value={lens} onChange={(e) => setLens(e.target.value as LensId)} className={pillControl}>
              {LENSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </PillField>
          <PillField label="ابحث عن مورد أو نشاط" className="sm:flex-[2]">
            <input ref={searchBox} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="ابحث عن مورد أو نشاط"
              placeholder="مثل: مورد قهوة" className={pillControl} />
          </PillField>
        </SearchPill>
      </header>

      <div className="relative min-h-0 flex-1 lg:flex lg:flex-row">
        <div className="absolute inset-x-0 top-0 bottom-[var(--peek)] lg:relative lg:inset-auto lg:flex-1" style={{ '--peek': PEEK } as CSSProperties}>
          <LensMapCanvas features={data.features} steps={steps} selected={selected} onToggle={toggle} colors={overlay.colors} circle={overlay.circle} onPick={overlay.onPick} points={overlay.points} lines={overlay.lines} start={overlay.start} areas={overlay.areas} sites={overlay.sites} listings={overlay.listings} onListing={overlay.onListing} streets={overlay.streets} onStreet={overlay.onStreet} focus={overlay.focus} zoomTo={zoomTo} hover={hovered} onPoint={setPointed}
            onFailed={setMapFailed} errorClassName="max-lg:top-1/3" cover={sheet === 'half' ? HALF : 0}
            onDistrictClick={(hit) => { mapPick.current = true; setCard(selected.includes(hit.id) ? null : hit) }}
            pin={cardRow ? card : null} onPin={setCardAt} />
          {overlay.popup}
          {cardRow && cardAt && cardAt.x >= 0 && cardAt.y >= 0 && cardAt.x <= cardAt.width && cardAt.y <= cardAt.height && (
            <DistrictCard name={cardRow.name} lines={cardLines(cardRow)} at={cardAt} onDetails={openDetails} onClose={() => setCard(null)}
              {...(window.matchMedia('(min-width: 64rem)').matches
                ? { top: 8, bottom: cardAt.height - 8 }
                // the floating search and chips on top; below, what the sheet covers above the map's own end (the peek)
                : { top: 124, bottom: cardAt.height - 8 - (sheet === 'half' ? Math.max(0, HALF * (cardAt.height + PEEK_PX) - PEEK_PX) : 0) })} />
          )}
          {pointedRow && pointed && (
            <div role="tooltip" className="pointer-events-none absolute z-[6] max-w-56 rounded-lg border bg-card/95 px-2.5 py-1.5 text-sm shadow-md backdrop-blur"
              // beside the pointer, flipped near the map's edges so it never runs off it
              style={{ left: pointed.x + 240 > pointed.width ? pointed.x - 234 : pointed.x + 14, top: pointed.y + 96 > pointed.height ? pointed.y - 86 : pointed.y + 14 }}>
              <p className="truncate font-bold">{pointedRow.name}</p>
              {/* the shading figure as the district row holds it; a step's own colours are explained in its key */}
              {!toolColors && <p className="text-muted-foreground">{METRICS[metric].label}: <span className="font-semibold text-foreground tabular-nums">{format(METRICS[metric].value(pointedRow), METRICS[metric].unit)}</span></p>}
              <p className="text-xs text-muted-foreground">{selected.includes(pointedRow.id) ? 'اضغط لإلغاء اختياره' : 'اضغط لترى أرقامه'}</p>
            </div>
          )}
          <MapOnboarding lens={lens} onLens={setLens} picked={selected.length > 0} paused={mapFailed || noDistricts} goalSlot={goalSlot} onAsk={raiseSheet}
            onShowMe={leadId ? () => pickFromList(leadId) : null} />
          {/* the view is in the address, so its link reopens this work (above the «؟» on a phone, beside it from lg) */}
          <CopyLinkButton className="absolute end-3 bottom-[6.5rem] z-10 lg:end-16 lg:top-3 lg:bottom-auto" />
          {noDistricts && (
            <div role="status" className="absolute inset-x-4 top-1/3 z-[15] mx-auto flex max-w-sm flex-col items-start gap-2 rounded-xl border bg-card/95 p-4 shadow-md backdrop-blur lg:top-1/4">
              <p className="flex items-center gap-2 font-bold"><MapPinOff className="size-5 text-muted-foreground" aria-hidden />حدود أحياء {cityName}: غير متاحة بعد</p>
              <p className="text-sm text-muted-foreground">البحث عن المنشآت والموردين يعمل فيها من الأعلى. أو افتح مدينة لها أحياء على الخريطة.</p>
              {city !== 'Riyadh' && <Chip onClick={() => setCity('Riyadh')}>اعرض الرياض</Chip>}
            </div>
          )}
          {/* on a phone the controls float over the map: the search, then one row of city, district and who; the map's
              colours are picked in its key («طبقات») */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3 lg:hidden">
            <form role="search" aria-label="ابحث عن مورد أو نشاط" onSubmit={(event) => { event.preventDefault(); submit() }}
              className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card/95 p-1.5 ps-4 shadow-md backdrop-blur">
              <input ref={phoneSearch} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="ابحث عن مورد أو نشاط"
                placeholder="ابحث عن مورد أو نشاط" className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
              <button type="submit" aria-label="ابحث" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><Search className="size-4" aria-hidden /></button>
            </form>
            <ScrollRow label="المدينة والحي والفئة" className="pointer-events-auto -mx-3 gap-2 px-3 pb-1">
              <ChipSelect label="المدينة" value={city} onChange={setCity} options={cities.map((item) => [item.en, item.ar || item.en])} />
              <ChipSelect label="الحي" value={districtValue} onChange={pickDistrict} options={districtOptions} />
              <ChipSelect label="الفئة" value={lens} onChange={(value) => setLens(value as LensId)} options={LENSES.map((item) => [item.id, item.label])} />
            </ScrollRow>
          </div>
          {/* the colour key, titled with what it colours: clear of the map's attribution (bottom corner) and of the
              «؟» button, above the phone's peeking sheet and the screen's safe area */}
          <div className="pointer-events-none absolute start-3 bottom-[calc(2.25rem+env(safe-area-inset-bottom))] z-[5] flex max-w-[calc(100%-5rem)] flex-col items-start gap-1.5">
            <div className="pointer-events-auto flex flex-col gap-1.5 rounded-xl border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur">
              {data.status === 'loading' ? (
                // the key's shape while the city's districts load; the map stays in view
                <div role="status" className="flex flex-col gap-1.5">
                  <LegendTitle>جارٍ تحميل أحياء {cityName}</LegendTitle>
                  <span className="flex gap-0.5" aria-hidden>{SHADES.map((shade) => <Skeleton key={shade} className="h-4 w-7 rounded-sm" />)}</span>
                </div>
              ) : (
                <>
                  {/* a tool's own key (its districts, or lines such as streets drawn over the shading) */}
                  {overlay.legend && <MapLegend {...overlay.legend} title={legendTitle} explain={overlay.legend.explain ?? EXPLAIN.toolColors[tool]} />}
                  {toolColors && !overlay.legend && <LegendTitle>{legendTitle}</LegendTitle>}
                  {!toolColors && overlay.legend && <span className="my-0.5 border-t" aria-hidden />}
                  {!toolColors && <>
                  <div className="flex items-center justify-between gap-2">
                    <LegendTitle>ألوان الخريطة: {METRICS[metric].label}</LegendTitle>
                    <LayerPicker options={active.metrics.map((id) => [id, METRICS[id].label])} value={metric} onChange={(id) => setMetric(id as MetricId)} />
                  </div>
                  {metricMissing ? <p className="text-sm text-muted-foreground">غير متاح في {cityName}، اختر طبقة أخرى من «طبقات»</p> : <Explained title="ألوان الخريطة" lines={EXPLAIN.shading(METRICS[metric].label)} className="flex items-center gap-1.5 text-sm no-underline">
                    <span className="text-muted-foreground">أقل</span>
                    <span className="flex gap-0.5" aria-hidden>{SHADES.map((shade) => <span key={shade} className="h-4 w-7 rounded-sm" style={{ background: shade }} />)}</span>
                    <span className="text-muted-foreground">أعلى</span>
                  </Explained>}
                  </>}
                </>
              )}
            </div>
          </div>
        </div>
        <MapSheet snap={sheet} onSnap={setSheet} title={sheetTitle} summary={!search && !chosen.length ? overlay.summary : null}>
          {data.status === 'error' ? (
            <LoadError what="بيانات المدينة" onRetry={data.reload} />
          ) : (
            <>
              {search && (
                <div className="flex flex-col gap-2">
                  <Chip onClick={() => setSearch(null)} className="self-start"><X className="size-4" aria-hidden />إغلاق البحث والعودة للخطوات</Chip>
                  <BusinessesPanel key={search.nonce} city={city} districts={chosen.map((row) => row.name)} query={search.q} />
                </div>
              )}
              {!search && (
                <>
                  <div ref={setGoalSlot} className="empty:hidden" />
                  <ScrollRow role="tablist" label={`خطوات ${active.label}`} active={tool} onKeyDown={tabKeys}
                    style={{ '--steps': active.steps.length } as CSSProperties}
                    className="-mx-3 shrink-0 gap-1.5 px-3 pb-1 lg:mx-0 lg:grid lg:grid-cols-[repeat(var(--steps),minmax(0,1fr))] lg:gap-1 lg:overflow-visible lg:rounded-2xl lg:border lg:bg-card lg:p-1">
                    {active.steps.map((item, index) => (
                      <StepTab key={item.tool} index={index} label={item.label} active={tool === item.tool} onClick={() => setTool(item.tool)} />
                    ))}
                  </ScrollRow>
                  {/* a tap answers first: the picked district leads, then the step's tool, then the full summary */}
                  {chosen.length > 0 && !['district', 'growth', 'compare', 'around', 'homes'].includes(tool) && (
                    <PickedStrip chosen={chosen} onClear={() => setSelected([])}
                      onDetails={() => document.getElementById('picked-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
                  )}
                  {tool === 'gaps' && <GapsTool city={city} rows={data.rows} onOverlay={onOverlay} onSelect={pickFromList} selected={selected} onHover={setHovered} />}
                  {tool === 'audience' && <AudienceTool city={city} rows={data.rows} selected={chosen} onOverlay={onOverlay} onSelect={toggleFromList} onHover={setHovered} />}
                  {tool === 'competitors' && <CompetitorsTool city={city} rows={data.rows} onOverlay={onOverlay} onHover={setHovered} onSelect={pickFromList} onActivity={setRival}
                    onAllBranches={(brand) => { setSelected([]); setSearch({ q: brand, nonce: Date.now() }) }} />}
                  {tool === 'corridors' && <CorridorsTool city={city} onOverlay={onOverlay} />}
                  {tool === 'around' && <AroundTool city={city} onOverlay={onOverlay} districts={data.rows} features={data.features} />}
                  {tool === 'territories' && <TerritoriesTool city={city} rows={data.rows} onOverlay={onOverlay} />}
                  {tool === 'homes' && <HomesTool key={lens} city={city} rows={data.rows} selected={chosen} onOverlay={onOverlay} onHover={setHovered} preset={lens === 'shops' ? { kind: 'rent', type: 'store', deal: 'all' } : undefined} />}
                  {tool === 'compare' && <CompareTool rows={data.rows} selected={chosen} />}
                  {tool === 'businesses' && !selected.length && (
                    <EmptyState icon={MousePointerClick} title="اختر حياً" body="اضغط حياً أو أكثر على الخريطة، أو من ترتيب «أين جمهوري؟»، فتظهر منشآته هنا. أو ابحث عن نشاط من الأعلى." />
                  )}
                  {(tool === 'district' || tool === 'growth' || (selected.length > 0 && tool !== 'around' && tool !== 'homes')) && (
                    <div id="picked-summary" className="scroll-mt-2">
                      <DistrictPanel city={city} cityName={cityName} lens={lens} rows={data.rows} selected={chosen} total={data.total} onClear={() => setSelected([])} />
                    </div>
                  )}
                  {showBusinesses && <BusinessesPanel key={`${tool}|${rival ?? ''}`} city={city} districts={chosen.map((row) => row.name)} query={tool === 'competitors' ? rival ?? undefined : undefined} />}
                  {(tool === 'district' || tool === 'growth') && <Ranking rows={data.rows} metric={metric} selected={selected} onToggle={toggleFromList} full={lens === 'analysts' || tool === 'growth'} />}
                </>
              )}
            </>
          )}
        </MapSheet>
      </div>
    </main>
  )
}
