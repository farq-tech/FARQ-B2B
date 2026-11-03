'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, MapPinOff, MousePointerClick, Search, X } from 'lucide-react'
import { CopyLinkButton } from '@/components/shared/copy-link'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { PillField, SearchPill, pillControl } from '@/components/shared/search-pill'
import { Chip } from '@/components/ui/chip'
import { Skeleton } from '@/components/ui/skeleton'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN, populationMethod } from '@/lib/explanations'
import { counted, ltr, numberFormat, useCities } from '@/lib/insights-api'
import { useMainActivities } from '@/lib/main-activities'
import { getSticky, setSticky, useStudiedActivity, watchSticky } from '@/lib/sticky-state'
import { cn } from '@/lib/utils'
import { AnimatePresence, DURATION, EASE, SPRING, motion, useReducedMotion } from '@/lib/motion'
import { useCityData, type DistrictRow } from './city-data'
import { DistrictPanel } from './district-panel'
import { LensMapCanvas, SHADES, shadeSteps } from './lens-map-canvas'
import { MapOnboarding } from './map-onboarding'
import { MoreRows, ResultRow, useShowMore } from './result-row'
import { readMapOptions, readMapQuery, writeMapOptions, writeMapQuery } from './map-query'
import { HALF, MapSheet, PEEK_PX, type SheetSnap } from './map-sheet'
import { LENSES, METRICS, METRIC_TABLE, TOOL_INPUTS, lensById, metricAvailability, neededTables, nextStep, stepTables, type LensId, type MetricId, type ToolId } from './lenses'
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

function Ranking({ rows, metric, selected, onToggle, onHover, full, onRetry, loading = false }: {
  rows: DistrictRow[]
  metric: MetricId
  selected: string[]
  onToggle: (id: string) => void
  onHover?: (id: string | null) => void
  full: boolean
  /** Set when the figure's table failed to load: the card offers a retry instead of «غير متاح في أي حي». */
  onRetry?: (() => void) | null
  /** The figure's table is being asked again: its rows say nothing yet. */
  loading?: boolean
}) {
  const { label, value, unit } = METRICS[metric]
  const ranked = rows.filter((row) => value(row) != null).sort((a, b) => (value(b) as number) - (value(a) as number))
  // the full ranking opens on 20 and grows on «اعرض المزيد», saying how much of the city it shows
  const [limit, showMore] = useShowMore(full ? 20 : 5, metric)
  const shown = ranked.slice(0, limit)
  return (
    <section aria-label={`ترتيب الأحياء حسب ${label}`} className="rounded-2xl border bg-card p-4">
      <h3 className="text-base font-bold">الأعلى في {label}</h3>
      <ol className="mt-2 divide-y text-base">
        {shown.map((row, index) => (
          <ResultRow key={row.id} active={selected.includes(row.id)} onClick={() => onToggle(row.id)} onHover={(on) => onHover?.(on ? row.id : null)}
            // ranks up to 192 (Riyadh) keep one column width
            leading={<span className="w-8 shrink-0 text-sm text-muted-foreground tabular-nums">{numberFormat.format(index + 1)}</span>}
            title={row.name}
            aside={<Explained title={`${label} · ${row.name}`} lines={metricExplanation(metric, row)} className="font-semibold tabular-nums">{format(value(row), unit)}</Explained>} />
        ))}
      </ol>
      {full && <MoreRows shown={shown.length} total={ranked.length} noun="district" onMore={showMore} />}
      {/* a figure no district of the city has: said in the card, which otherwise stood empty under its title */}
      {loading && <div role="status" aria-label={`جارٍ تحميل ${label}`} className="mt-3 flex flex-col gap-3">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-5 w-full" />)}</div>}
      {!loading && ranked.length === 0 && rows.length > 0 && (onRetry
        ? <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">تعذّر تحميل هذا الرقم الآن<Chip onClick={onRetry}>أعد المحاولة</Chip></p>
        : <p className="mt-2 text-sm text-muted-foreground">غير متاح في أي حي من أحياء هذه المدينة بعد</p>)}
      {full && !onRetry && !loading && ranked.length > 0 && ranked.length < rows.length && <p className="mt-2 text-sm text-muted-foreground">{counted(rows.length - ranked.length, 'district')}: غير متاح</p>}
    </section>
  )
}

/** The city summary's shape while its tables load: four figure tiles, then the ranking's first rows. */
function SummarySkeleton({ cityName }: { cityName: string }) {
  return (
    <div role="status" aria-label={`جارٍ تحميل أرقام ${cityName}`} className="flex flex-col gap-3">
      <section className="rounded-2xl border bg-card p-4">
        <p className="text-xl font-bold">{cityName}</p>
        <div className="mt-3 grid grid-cols-2 gap-2" aria-hidden>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-xl bg-muted/40 px-3 py-2.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border bg-card p-4" aria-hidden>
        <Skeleton className="h-5 w-32" />
        <div className="mt-3 flex flex-col gap-3">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-5 w-full" />)}</div>
      </section>
    </div>
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
function ScrollRow({ label, role = 'group', active, className, style, onKeyDown, arrows = false, children }: {
  label: string
  role?: 'group' | 'tablist'
  active?: string
  className?: string
  style?: CSSProperties
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  /** With a mouse, a round arrow at each edge that hides more (a wheel or a trackpad does not scroll a row sideways
   * by itself); touch swipes, and the keyboard moves through the items. */
  arrows?: boolean
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
  const nudge = (direction: -1 | 1) => {
    const el = row.current
    if (!el) return
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.6), behavior })
  }
  const strip = (
    <div ref={row} role={role} aria-label={label} onScroll={measure} onKeyDown={onKeyDown}
      className={cn('flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
      style={{ ...style, maskImage: fade, WebkitMaskImage: fade }}>
      {children}
    </div>
  )
  if (!arrows) return strip
  const arrow = (side: 'left' | 'right') => edges[side] && (
    // out of the tab order and hidden from screen readers: the tabs themselves are reached with the arrow keys
    <button type="button" tabIndex={-1} aria-hidden onClick={() => nudge(side === 'left' ? -1 : 1)}
      className={cn('absolute top-1/2 z-[1] hidden size-8 -translate-y-1/2 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm hover:text-foreground pointer-fine:grid',
        side === 'left' ? 'left-1' : 'right-1')}>
      {side === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  )
  return <div className="relative">{strip}{arrow('left')}{arrow('right')}</div>
}

/**
 * The step of a journey as a numbered tab, on one line in a row that scrolls sideways (phone and desktop alike) and
 * keeps the open step in view. A ✓ marks a step that has given an answer in this visit.
 */
const tabId = (tool: ToolId) => `map-step-${tool}`
/** The sheet's scrolling body, the panel of the open step tab. */
const STEP_PANEL = 'map-step-panel'

function StepTab({ tool, index, label, active, done, onClick }: { tool: ToolId; index: number; label: string; active: boolean; done: boolean; onClick: () => void }) {
  const reduce = useReducedMotion()
  return (
    <button role="tab" id={tabId(tool)} aria-controls={STEP_PANEL} aria-selected={active} tabIndex={active ? 0 : -1} onClick={onClick}
      className={cn('relative flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
      {/* the olive fill slides from the step that was open to this one (shared layoutId); framer measures the real DOM
          boxes, so it lands right in RTL as in LTR. Motion reduced: it simply appears under the active step. */}
      {active && (reduce
        ? <span aria-hidden className="absolute inset-0 -z-10 rounded-xl bg-primary/10" />
        : <motion.span aria-hidden layoutId="map-step-indicator" className="absolute inset-0 -z-10 rounded-xl bg-primary/10" transition={SPRING} />)}
      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold', active ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{numberFormat.format(index + 1)}</span>
      {label}
      {done && <><Check className="size-4 shrink-0 text-primary" strokeWidth={3} aria-hidden /><span className="sr-only">، فيها نتيجة</span></>}
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
      <div className="flex items-start gap-2">
        {/* two lines before it is cut: one long name, or several picked names, reads whole or nearly so */}
        <h2 className="line-clamp-2 min-w-0 flex-1 text-base font-bold break-words">{single ? single.name : `${counted(chosen.length, 'district')}: ${chosen.map((row) => row.name).join('، ')}`}</h2>
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

type Pointed = { id: string; x: number; y: number; width: number; height: number }
type PointerStore = { get: () => Pointed | null; set: (next: Pointed | null) => void; subscribe: (listener: () => void) => () => void }

/**
 * The district under the mouse, kept out of the page's state: a mouse move over the map used to re-render the whole
 * map page (every open tool, both scrolling rows) once per pointer event. Now only the label beside the pointer
 * follows it, at most once per frame.
 */
function createPointerStore(): PointerStore {
  let value: Pointed | null = null
  let queued: Pointed | null = null
  let frame = 0
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next) => {
      queued = next
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (queued === value || (queued && value && queued.id === value.id && queued.x === value.x && queued.y === value.y)) return
        value = queued
        listeners.forEach((listener) => listener())
      })
    },
  }
}

/** The label beside the mouse pointer: the district's name and what `describe` says of it (null: no label). */
function PointerTip({ store, describe }: { store: PointerStore; describe: (id: string) => ReactNode | null }) {
  const pointed = useSyncExternalStore(store.subscribe, store.get, () => null)
  const content = pointed ? describe(pointed.id) : null
  if (!pointed || !content) return null
  return (
    <div role="tooltip" className="pointer-events-none absolute z-[6] max-w-56 rounded-lg border bg-card/95 px-2.5 py-1.5 text-sm shadow-md backdrop-blur"
      // beside the pointer, flipped near the map's edges so it never runs off it
      style={{ left: pointed.x + 240 > pointed.width ? pointed.x - 234 : pointed.x + 14, top: pointed.y + 96 > pointed.height ? pointed.y - 86 : pointed.y + 14 }}>
      {content}
    </div>
  )
}

const DONE_KEY = 'atlas.map.done'
/** The steps answered in this tab's session for a city (sessionStorage; nothing when it is blocked). */
function readDone(city: string): ToolId[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`${DONE_KEY}|${city}`) ?? '[]')
    return Array.isArray(saved) ? saved.filter((id): id is ToolId => typeof id === 'string' && id in TOOL_INPUTS) : []
  } catch { return [] }
}
function writeDone(city: string, done: ToolId[]) {
  try { sessionStorage.setItem(`${DONE_KEY}|${city}`, JSON.stringify(done)) } catch { /* private window: the marks last this visit only */ }
}

// the choices made inside the lens's steps (sort orders, filters, the second activity, the open business), beside the view
const withOptions = (search: string, lens: LensId) => writeMapOptions(search, lens, lensById(lens).steps.map((step) => step.tool), getSticky)
const replaceAddress = (search: string) => {
  if (search !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
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
  const reduce = useReducedMotion()
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
  // the collapsed sheet's height as it measures (MapSheet), where the phone's map ends
  const [peekPx, setPeekPx] = useState(PEEK_PX)
  // the district a step's list is pointing at, outlined on the map so a row and its place are seen together
  const [hovered, setHovered] = useState<string | null>(null)
  // the district under the mouse, named beside the pointer with its figure, before any click
  const [pointer] = useState(createPointerStore)
  useEffect(() => { setHovered(null) }, [tool, city])
  // a layout effect runs before the tools' own effects post their overlay, so an answer is credited to its own step
  useLayoutEffect(() => { openTool.current = tool }, [tool])
  // a map that failed to open: its notice takes the map, and the tour waits (there is nothing to tap)
  const [mapFailed, setMapFailed] = useState(false)
  // the district a click on the map opened a card on, where the click landed, and where that is on screen now
  const [card, setCard] = useState<{ id: string; lon: number; lat: number } | null>(null)
  const [cardAt, setCardAt] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  // a pick made by a click on the map answers in its card, so the phone's sheet stays down and the map in view
  const mapPick = useRef(false)
  // only what the layer in view and the open step read is asked at once, the layer's table first so the map colours
  // early; the city's other tables follow when the page is idle (lenses.ts neededTables)
  const data = useCityData(city, neededTables(tool, metric))
  // a control that removes itself (closing the search, clearing the pick, «التالي») hands focus to this element once
  // the page has re-rendered, instead of dropping it on the page's body
  const focusAfter = useRef<string | null>(null)
  useEffect(() => {
    const id = focusAfter.current
    if (!id) return
    focusAfter.current = null
    document.getElementById(id)?.focus({ preventScroll: true })
  })
  // the steps that gave an answer in this visit (a ✓ on their tab): a tool's answer is the one-line summary or the
  // sites it posts with its overlay, read against the step that is open when it posts
  // kept for this tab's session, per city, so a reload (or a shared link opened again) keeps the journey's progress
  const [done, setDone] = useState<ToolId[]>([])
  const doneCity = useRef(city)
  const markDone = useCallback((id: ToolId) => setDone((current) => {
    if (current.includes(id)) return current
    const next = [...current, id]
    writeDone(doneCity.current, next)
    return next
  }), [])
  const openTool = useRef<ToolId | null>(null)
  // one poster per open step: an answer that lands after its step was left (a slow fetch of the step before) is
  // dropped, instead of painting its colours under the open step's key
  const onOverlay = useMemo(() => {
    const owner = tool
    return (next: Overlay) => {
      if (openTool.current !== owner) return
      setOverlay(next)
      if (next.summary || next.sites?.length) markDone(owner)
    }
  }, [tool, markDone])
  const active = lensById(lens)

  // a ✓ answered for the city it was given in: another city starts its journey unanswered
  useEffect(() => { setSelected([]); setCard(null); doneCity.current = city; setDone(readDone(city)) }, [city])
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
  // a layout effect, so the reset lands before the new step's own effects post its overlay: as a passive effect it
  // ran after them (a parent's effects follow its children's) and wiped an answer the step had at hand
  useLayoutEffect(() => {
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
  // the second activity of «قارن بنشاط آخر» named by a main activity's id, waiting for the city's list for its name
  const presetRival = useRef<string | null>(null)
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
    // the steps' own choices, each checked against what its step offers; the steps already open hear them
    const openLens = (preset.lens ?? lens) as LensId
    for (const [key, value] of Object.entries(readMapOptions(window.location.search, openLens, lensById(openLens).steps.map((step) => step.tool)))) {
      const main = key === 'competitors.rival' ? (value as { main_id?: string; label?: string }).main_id : undefined
      if (main && !(value as { label?: string }).label) presetRival.current = main
      else setSticky(key, value)
    }
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
    const wanted = presetRival.current
    if (!wanted || !activities.length) return
    presetRival.current = null
    const item = activities.find((activity) => activity.main_id === wanted)
    if (item) setSticky('competitors.rival', { main_id: item.main_id, label: item.main_ar })
    else replaceAddress(withOptions(window.location.search, lens))
    // the lens is read as it stands when the list arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities])
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
    // a shared link opens on its districts, framed, instead of the whole city with the picked ones somewhere in it
    if (ids.length) { setSelected(ids); flyTo(...ids) }
    // flyTo only sets state; it is rebuilt each render and needs no dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.status, data.rows, city])
  useEffect(() => {
    if (!hydrated) return
    // a main activity still waiting for its city's list keeps its place in the address
    const main = presetMain.current ?? studied.main_id ?? null
    const next = writeMapQuery(window.location.search, { city, lens, tool, districts: selected, q: search?.q ?? null, main, activity: main ? null : studied.q ?? null, layer: metric }, lensById(lens).steps[0].tool, lensById(lens).metric)
    // a second activity still waiting for its name keeps its place too
    replaceAddress(presetRival.current ? next : withOptions(next, lens))
  }, [hydrated, city, lens, tool, selected, search, studied, metric])
  // a choice made inside a step goes to the address as it is made
  useEffect(() => {
    if (!hydrated) return
    return watchSticky(() => { if (!presetRival.current) replaceAddress(withOptions(window.location.search, lens)) })
  }, [hydrated, lens])
  useEffect(() => {
    const quiet = mapPick.current
    mapPick.current = false
    if (selected.length && !quiet) setSheet((current) => (current === 'peek' ? 'half' : current))
  }, [selected.length])
  useEffect(() => { if (search) setSheet((current) => (current === 'peek' ? 'half' : current)) }, [search])

  // shaded from the rows as they stand (each table joins as it answers), so the map colours as soon as its figure is in
  const steps = useMemo(() => shadeSteps(new Map(data.early.map((row) => [row.id, METRICS[metric].value(row)]))), [data.early, metric])
  const metricPending = data.pending.includes(METRIC_TABLE[metric])
  const chosen = data.rows.filter((row) => selected.includes(row.id))
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  // a district picked from a list takes the map to it (a click on the map is already looking at it); on a phone a full
  // sheet drops to half so the district shows above it
  const [zoomTo, setZoomTo] = useState<{ ids: string[]; nonce: number; cover: number } | null>(null)
  const flyTo = (...ids: string[]) => {
    const phone = !window.matchMedia('(min-width: 64rem)').matches
    if (phone) setSheet('half')
    setZoomTo({ ids, nonce: Date.now(), cover: phone ? HALF : 0 })
  }
  const pickFromList = (id: string) => { setSelected([id]); flyTo(id) }
  const toggleFromList = (id: string) => { if (!selected.includes(id)) flyTo(id); toggle(id) }
  const cityName = cities.find((item) => item.en === city)?.ar || city
  const step = active.steps.find((item) => item.tool === tool)
  // a step whose answer is the picked districts' summary is done once a district is picked on it
  useEffect(() => { if (selected.length && TOOL_INPUTS[tool].pickAnswers) markDone(tool) }, [selected.length, tool, markDone])
  // «التالي»: the next step of the journey, named with what it carries over (the studied activity, the picked district)
  const next = nextStep(active, tool)
  const carried = next ? [
    TOOL_INPUTS[next.tool].activity && TOOL_INPUTS[tool].activity ? `«${studied.label}»` : null,
    TOOL_INPUTS[next.tool].district && chosen.length ? (chosen.length === 1 ? chosen[0].name : counted(chosen.length, 'district')) : null,
  ].filter(Boolean).join(' · ') : ''
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
  const metricMissing = data.status === 'ready' && !metricPending && data.rows.length > 0 && steps.size === 0 && !data.failed.includes(METRIC_TABLE[metric])
  const unshaded = data.status === 'ready' && !metricPending ? data.early.length - steps.size : 0
  // which of the lens's figures can colour this city: in a small city most are missing, and a table can fail to load
  // (Riyadh's searches answered 502 for a while); «طبقات» marks both, and the key offers the first figure that does
  // colour the map instead of «choose another» blind. A failed table is «غير متاح الآن» (this time), and a retry.
  const availability = useMemo(() => new Map(active.metrics.map((id) => [id, data.status === 'ready' ? metricAvailability(id, data.rows, data.failed, data.pending) : 'ready'] as const)),
    [data.status, data.rows, data.failed, data.pending, active.metrics])
  const failedTable = (id: MetricId) => data.status === 'ready' && data.failed.includes(METRIC_TABLE[id])
  const metricFailed = failedTable(metric)
  const fallbackMetric = metricMissing || metricFailed ? active.metrics.find((id) => id !== metric && availability.get(id) === 'ready') ?? null : null
  // a layer that failed while nobody was looking at it is marked in «طبقات», not announced over the page; picking it
  // asks its table again, and only then does its key say it failed (with a retry) if it fails once more
  const layerOptions = active.metrics.map((id): [string, string, string?] => [id, METRICS[id].label,
    availability.get(id) === 'missing' ? 'غير متاح' : availability.get(id) === 'failed' ? 'غير متاح الآن' : undefined])
  const pickLayer = (id: MetricId) => {
    setMetric(id)
    if (id !== metric && availability.get(id) === 'failed') data.reload?.()
  }
  // a notice over the panel only for a table the open step reads; a layer's own failure is said in the map's key
  const stepFailed = data.status === 'ready' && data.failed.some((table) => stepTables(tool).includes(table))
  // one district's value of the shading figure, as the card and the pointer's label show it
  const metricText = (row: DistrictRow) => (metricPending ? 'جارٍ التحميل' : metricFailed ? 'تعذّر التحميل' : format(METRICS[metric].value(row), METRICS[metric].unit))
  // the district the open step puts first, or else the top of the shading figure (as «الأعلى في» ranks it)
  const leadId = overlay.lead ?? (toolColors ? null : [...data.rows].filter((row) => METRICS[metric].value(row) != null)
    .sort((a, b) => (METRICS[metric].value(b) as number) - (METRICS[metric].value(a) as number))[0]?.id ?? null)
  // a step that hands over no line of its own still gets one at peek: the district the shading figure ranks first,
  // with its figure from its row (a percentage kept whole inside the Arabic line)
  const leadRow = leadId ? data.rows.find((row) => row.id === leadId) ?? null : null
  const leadValue = leadRow ? METRICS[metric].value(leadRow) : null
  const peekLine = overlay.summary ?? (!toolColors && leadRow && leadValue != null
    ? `الأعلى في ${METRICS[metric].label}: ${leadRow.name} ${METRICS[metric].unit === '%' ? ltr(format(leadValue, '%')) : format(leadValue, METRICS[metric].unit)}`
    : null)
  // the card stays while its district is picked and the map takes clicks as districts
  const cardRow = card && selected.includes(card.id) && !overlay.onPick ? data.rows.find((row) => row.id === card.id) ?? null : null
  const cardLines = (row: DistrictRow): { label: string; value: string }[] => {
    const population = { label: 'السكان', value: format(row.population) }
    // the open step's own figure for the district, as the step computed it
    if (overlay.facts) return [{ label: step?.label ?? '', value: overlay.facts.get(row.id) ?? 'غير متاح' }, population]
    if (!toolColors && metric !== 'population') return [{ label: METRICS[metric].label, value: metricText(row) }, population]
    return [population]
  }
  // the map itself, where focus goes back when the card it opened closes (the card's button is gone)
  const focusMap = () => document.querySelector<HTMLElement>('.mapboxgl-canvas')?.focus({ preventScroll: true })
  const closeCard = () => { setCard(null); focusMap() }
  // Escape closes the card, unless something above it (a popover, the sheet's handle, a field) took the key first
  const cardOpen = cardRow != null
  useEffect(() => {
    if (!cardOpen) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if ((event.target as Element | null)?.closest?.('input, textarea, select, [role="dialog"]')) return
      closeCard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // closeCard only sets state and moves focus; it is rebuilt each render and needs no dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardOpen])
  const openDetails = () => {
    // the summary in the panel now answers: the card goes, so it no longer covers its own district, and on a phone the
    // district is framed in what the half sheet leaves of the map
    const id = card?.id
    setCard(null)
    if (id && !window.matchMedia('(min-width: 64rem)').matches && sheet !== 'full') flyTo(id)
    else setSheet((current) => (current === 'full' ? current : 'half'))
    // after the sheet has risen, so the summary is scrolled to where it ends up
    window.setTimeout(() => document.getElementById('picked-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
  }
  const rowById = useMemo(() => new Map(data.rows.map((row) => [row.id, row])), [data.rows])
  const describePointed = (id: string) => {
    const row = id === cardRow?.id ? null : rowById.get(id)
    if (!row) return null
    return (
      <>
        <p className="truncate font-bold">{row.name}</p>
        {/* the shading figure as the district row holds it; a step's own colours are explained in its key */}
        {!toolColors && <p className="text-muted-foreground">{METRICS[metric].label}: <span className="font-semibold text-foreground tabular-nums">{metricText(row)}</span></p>}
        {/* a step that colours the map says what its colour means for this district, from its own answer */}
        {toolColors && overlay.hover?.get(row.id) && <p className="font-semibold text-foreground tabular-nums">{overlay.hover.get(row.id)}</p>}
        <p className="text-xs text-muted-foreground">{selected.includes(row.id) ? 'اضغط لإلغاء اختياره' : 'اضغط لترى أرقامه'}</p>
      </>
    )
  }
  // over a phone's half sheet the map keeps a strip of itself: the key shrinks to its title and «طبقات» there
  const keyCompact = sheet === 'half'
  const legendTitle = overlay.legend?.title ?? (toolColors ? `ألوان الخريطة: ${step?.label ?? ''}` : step?.label ?? '')
  // the peeking sheet's one line is cut at its end: the picked district leads, the step (also on its tab) follows
  // where the journey stands, said once in the peeking title («الخطوة 2 من 4»); the picked district leads when there is one
  const stepAt = step ? `الخطوة ${numberFormat.format(active.steps.indexOf(step) + 1)} من ${numberFormat.format(active.steps.length)}` : ''
  const sheetTitle = search ? `بحث: ${search.q}` : chosen.length ? `${chosen.map((row) => row.name).join('، ')} · ${step?.label}` : `${stepAt} · ${step?.label ?? ''}`
  // a pick on the map is silent to a screen reader (the canvas has no districts to read): the pick and its two golden
  // figures are said in a polite live line instead
  const pickedSay = chosen.length === 1
    ? `اخترت ${chosen[0].name}. السكان ${format(chosen[0].population)}، المنشآت ${format(chosen[0].businesses)}.`
    : chosen.length > 1 ? `${counted(chosen.length, 'district')} مختارة: ${chosen.map((row) => row.name).join('، ')}.` : ''
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
        {/* --lift: how far a phone's half sheet reaches over the map (it covers HALF of the map and peek together, the map
            already ends at the peek): the key and the buttons at the map's bottom ride above it instead of under it */}
        <div className="absolute inset-x-0 top-0 bottom-[var(--peek)] max-lg:[--lift:var(--sheet-lift,0px)] lg:relative lg:inset-auto lg:flex-1"
          style={{ '--peek': `${peekPx}px`, ...(sheet === 'half' ? { '--sheet-lift': `calc(${HALF * 100}% - ${peekPx * (1 - HALF)}px)` } : {}) } as CSSProperties}>
          <LensMapCanvas features={data.features} steps={steps} selected={selected} onToggle={toggle} colors={overlay.colors} circle={overlay.circle} onPick={overlay.onPick} points={overlay.points} lines={overlay.lines} start={overlay.start} areas={overlay.areas} sites={overlay.sites} listings={overlay.listings} onListing={overlay.onListing} streets={overlay.streets} onStreet={overlay.onStreet} focus={overlay.focus} zoomTo={zoomTo} hover={hovered} onPoint={pointer.set}
            onFailed={setMapFailed} errorClassName="max-lg:top-1/3" cover={sheet === 'half' ? HALF : 0} peek={peekPx}
            onDistrictClick={(hit) => { mapPick.current = true; setCard(selected.includes(hit.id) ? null : hit) }}
            pin={cardRow ? card : null} onPin={setCardAt} />
          {overlay.popup}
          {cardRow && cardAt && cardAt.x >= 0 && cardAt.y >= 0 && cardAt.x <= cardAt.width && cardAt.y <= cardAt.height && (
            <DistrictCard name={cardRow.name} lines={cardLines(cardRow)} at={cardAt} onDetails={openDetails} onClose={closeCard}
              {...(window.matchMedia('(min-width: 64rem)').matches
                ? { top: 8, bottom: cardAt.height - 8 }
                // the floating search and chips on top; below, what the sheet covers above the map's own end (the peek)
                : { top: 124, bottom: cardAt.height - 8 - (sheet === 'half' ? Math.max(0, HALF * (cardAt.height + peekPx) - peekPx) : 0) })} />
          )}
          <PointerTip store={pointer} describe={describePointed} />
          <p aria-live="polite" className="sr-only">{pickedSay}</p>
          <MapOnboarding lens={lens} onLens={setLens} picked={selected.length > 0} paused={mapFailed || noDistricts}
            onShowMe={leadId ? () => pickFromList(leadId) : null} />
          {/* the view is in the address, so its link reopens this work (above the «؟» on a phone, beside it from lg) */}
          <CopyLinkButton className="absolute end-3 bottom-[calc(6.5rem+var(--lift,0px))] z-10 transition-[bottom,color] duration-300 motion-reduce:transition-none lg:end-16 lg:top-3 lg:bottom-auto" />
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
            {/* a search sent puts the phone's keyboard away, so the results rising in the sheet are not hidden under it */}
            <form role="search" aria-label="ابحث عن مورد أو نشاط" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) phoneSearch.current?.blur(); submit() }}
              className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card/95 p-1.5 ps-4 shadow-md backdrop-blur">
              <input ref={phoneSearch} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="ابحث عن مورد أو نشاط"
                placeholder="ابحث عن مورد أو نشاط" className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
              {/* one tap empties the field and closes its results, back to the steps */}
              {(draft || search) && (
                <button type="button" aria-label="امسح البحث" onClick={() => { setDraft(''); setSearch(null); phoneSearch.current?.focus() }}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" aria-hidden /></button>
              )}
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
          <div className="pointer-events-none absolute start-3 bottom-[calc(2.25rem+env(safe-area-inset-bottom)+var(--lift,0px))] z-[5] flex transition-[bottom] duration-300 motion-reduce:transition-none max-w-[calc(100%-5rem)] flex-col items-start gap-1.5">
            <div className="pointer-events-auto flex flex-col gap-1.5 rounded-xl border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur">
              {!data.features.length || (!toolColors && metricPending) ? (
                // the key's shape while the city's districts load; the map stays in view
                <div role="status" className="flex flex-col gap-1.5">
                  <LegendTitle>{data.features.length ? `جارٍ تحميل ${METRICS[metric].label}` : `جارٍ تحميل أحياء ${cityName}`}</LegendTitle>
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
                    <LayerPicker options={layerOptions} value={metric} onChange={(id) => pickLayer(id as MetricId)} />
                  </div>
                  {metricFailed ? (
                    <div role="alert" className="flex flex-col items-start gap-1.5">
                      <p className="text-sm text-muted-foreground">تعذّر تحميل هذا الرقم الآن</p>
                      <span className="flex flex-wrap gap-1.5">
                        {data.reload && <Chip onClick={data.reload}>أعد المحاولة</Chip>}
                        {fallbackMetric && <Chip onClick={() => setMetric(fallbackMetric)}>لوّن بـ«{METRICS[fallbackMetric].label}»</Chip>}
                      </span>
                    </div>
                  ) : metricMissing ? (
                    <div className="flex flex-col items-start gap-1.5">
                      <p className="text-sm text-muted-foreground">غير متاح في {cityName}{fallbackMetric ? '' : '، ولا مقياس آخر لهذه الفئة بعد'}</p>
                      {fallbackMetric && <Chip onClick={() => setMetric(fallbackMetric)}>لوّن الخريطة بـ«{METRICS[fallbackMetric].label}»</Chip>}
                    </div>
                  ) : <Explained title="ألوان الخريطة" lines={EXPLAIN.shading(METRICS[metric].label)} className={cn('flex items-center gap-1.5 text-sm no-underline', keyCompact && 'max-lg:hidden')}>
                    <span className="text-muted-foreground">أقل</span>
                    <span className="flex gap-0.5" aria-hidden>{SHADES.map((shade) => <span key={shade} className="h-4 w-7 rounded-sm" style={{ background: shade }} />)}</span>
                    <span className="text-muted-foreground">أعلى</span>
                  </Explained>}
                  {/* districts without the figure are drawn unshaded: the key names that, so a blank district (Jeddah's
                      central markets under «السكان») reads as «غير متاح», not as the lowest value */}
                  {!metricMissing && !metricFailed && unshaded > 0 && (
                    <span className={cn('flex items-center gap-1.5 text-sm text-muted-foreground', keyCompact && 'max-lg:hidden')}>
                      <span className="h-4 w-7 rounded-sm border border-dashed border-muted-foreground/50" aria-hidden />
                      بلا لون: غير متاح ({counted(unshaded, 'district')})
                    </span>
                  )}
                  </>}
                </>
              )}
            </div>
          </div>
        </div>
        <MapSheet snap={sheet} onSnap={setSheet} onPeek={setPeekPx} title={sheetTitle} summary={!search && !chosen.length ? peekLine : null} resetKey={search ? `search|${search.nonce}` : `${lens}|${tool}`}
          panel={!search && data.status !== 'error' ? { id: STEP_PANEL, labelledBy: tabId(tool) } : null}
          header={!search && data.status !== 'error' ? (
            // the steps stay above the scrolling body at every stop of the sheet, and on one line from lg too
            <ScrollRow role="tablist" arrows label={`خطوات ${active.label}`} active={tool} onKeyDown={tabKeys} className="-mx-3 gap-1.5 px-3 pb-1">
              {active.steps.map((item, index) => (
                <StepTab key={item.tool} tool={item.tool} index={index} label={item.label} active={tool === item.tool} done={done.includes(item.tool)} onClick={() => setTool(item.tool)} />
              ))}
            </ScrollRow>
          ) : null}>
          {data.status === 'error' ? (
            <LoadError what="بيانات المدينة" onRetry={data.reload} />
          ) : (
            <>
              {search && (
                <div className="flex flex-col gap-2">
                  <Chip onClick={() => { focusAfter.current = tabId(tool); setSearch(null) }} className="self-start"><X className="size-4" aria-hidden />إغلاق البحث والعودة للخطوات</Chip>
                  <BusinessesPanel key={search.nonce} city={city} districts={chosen.map((row) => row.name)} query={search.q} />
                </div>
              )}
              {!search && (
                <>
                  {/* a table that failed empties its figures in every district: said once at the top, with a retry, so a
                      «غير متاح» further down is not read as the city lacking the figure */}
                  {stepFailed && (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed bg-card p-3 text-sm">
                      <span className="min-w-0 flex-1">تعذّر تحميل جزء من أرقام {cityName} الآن، وما لم يُحمَّل مكتوب «تعذّر التحميل».</span>
                      {data.reload && <Chip onClick={data.reload}>أعد المحاولة</Chip>}
                    </div>
                  )}
                  {/* a tap answers first: the picked district leads, then the step's tool, then the full summary */}
                  {chosen.length > 0 && !['district', 'growth', 'compare', 'around', 'homes'].includes(tool) && (
                    <PickedStrip chosen={chosen} onClear={() => { focusAfter.current = tabId(tool); setSelected([]) }}
                      onDetails={() => document.getElementById('picked-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
                  )}
                  {/* the open step's tool crossfades as the step changes — a short, gentle swap so the panel reads as one
                      surface answering, not a flicker. mode="wait" keeps one tool mounted at a time (no racing overlays);
                      the shared panels below (summary, businesses) stay put and never remount here. */}
                  <AnimatePresence mode="wait" initial={false}>
                    {tool !== 'businesses' && (
                      <motion.div key={tool} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: reduce ? 0 : DURATION.fast, ease: EASE }}>
                        {tool === 'gaps' && <GapsTool city={city} cityName={cityName} rows={data.rows} onOverlay={onOverlay} onSelect={pickFromList} selected={selected} onHover={setHovered} />}
                        {tool === 'audience' && <AudienceTool city={city} rows={data.rows} selected={chosen} onOverlay={onOverlay} onSelect={toggleFromList} onHover={setHovered} />}
                        {tool === 'competitors' && <CompetitorsTool city={city} rows={data.rows} onOverlay={onOverlay} onHover={setHovered} onSelect={pickFromList} onActivity={setRival}
                          onAllBranches={(brand) => { setSelected([]); setSearch({ q: brand, nonce: Date.now() }) }} />}
                        {tool === 'corridors' && <CorridorsTool city={city} rows={data.rows} onOverlay={onOverlay} />}
                        {tool === 'around' && <AroundTool city={city} onOverlay={onOverlay} districts={data.rows} features={data.features} />}
                        {tool === 'territories' && <TerritoriesTool city={city} rows={data.rows} onOverlay={onOverlay} />}
                        {tool === 'homes' && <HomesTool key={lens} city={city} rows={data.rows} selected={chosen} onOverlay={onOverlay} onHover={setHovered} preset={lens === 'shops' ? { kind: 'rent', type: 'store', deal: 'all' } : undefined} />}
                        {tool === 'compare' && <CompareTool rows={data.rows} selected={chosen} />}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {tool === 'businesses' && !selected.length && (
                    <EmptyState icon={MousePointerClick} title="اختر حياً" body="اضغط حياً أو أكثر على الخريطة، أو من ترتيب «أين جمهوري؟»، فتظهر منشآته هنا. أو ابحث عن نشاط من الأعلى." />
                  )}
                  {/* while the city's tables load, the summary keeps its shape: its tiles said «غير متاح» and the ranking
                      stood empty, as if the city had no figures at all */}
                  {data.status === 'loading' && (tool === 'district' || tool === 'growth') && <SummarySkeleton cityName={cityName} />}
                  {data.status !== 'loading' && (tool === 'district' || tool === 'growth' || (selected.length > 0 && tool !== 'around' && tool !== 'homes')) && (
                    <div id="picked-summary" className="scroll-mt-2">
                      <DistrictPanel city={city} cityName={cityName} lens={lens} rows={data.rows} selected={chosen} total={data.total} failed={data.failed} pending={data.pending}
                        onClear={() => { focusAfter.current = tabId(tool); setSelected([]) }} />
                    </div>
                  )}
                  {showBusinesses && <BusinessesPanel key={`${tool}|${rival ?? ''}`} city={city} districts={chosen.map((row) => row.name)} query={tool === 'competitors' ? rival ?? undefined : undefined} />}
                  {data.status !== 'loading' && (tool === 'district' || tool === 'growth') && <Ranking rows={data.rows} metric={metric} selected={selected} onToggle={toggleFromList} onHover={setHovered} full={lens === 'analysts' || tool === 'growth'} onRetry={metricFailed ? data.reload : null} loading={metricPending} />}
                  {/* once the step has answered, the journey goes on: the next step opens with the same activity and districts */}
                  {next && done.includes(tool) && (
                    <button onClick={() => { focusAfter.current = tabId(next.tool); setTool(next.tool) }}
                      className="flex shrink-0 items-center gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-3 text-start outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/60">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{numberFormat.format(active.steps.indexOf(next) + 1)}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-bold">التالي: {next.label}</span>
                        {carried && <span className="truncate text-sm text-muted-foreground">يكمل على {carried}</span>}
                      </span>
                      <ArrowLeft className="size-5 shrink-0 text-primary" aria-hidden />
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </MapSheet>
      </div>
    </main>
  )
}
