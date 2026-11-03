'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { Building2, Calculator, ClipboardList, Megaphone, Users } from 'lucide-react'
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Hourglass, MapPinOff, MousePointerClick, Search, X } from 'lucide-react'
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
import { getSticky, setSticky, stickyHas, useStickyState, useStudiedActivity, watchSticky } from '@/lib/sticky-state'
import { cn } from '@/lib/utils'
import { AnimatePresence, DURATION, EASE, SPRING, motion, useReducedMotion } from '@/lib/motion'
import { useCityData, type CityTable, type DistrictRow } from './city-data'
import { DistrictPanel } from './district-panel'
import { LensMapCanvas, SHADES, shadeSteps, type BusinessDot, type BusinessGroup } from './lens-map-canvas'
import type { PublicDirectoryEntity } from '@/lib/live-directory'
import { MapOnboarding } from './map-onboarding'
import { SavedComparisons, SavedList } from './saved-comparisons'
import { MoreRows, ResultRow, useShowMore } from './result-row'
import { cleanQuery, readMapOptions, readMapQuery, writeMapOptions, writeMapQuery } from './map-query'
import { districtAt } from '@/lib/geo-measure'
import { PALETTE } from '@/lib/palette'
import { useAppStore } from '@/lib/store'
import { backIfReturning, historyGate, homesHref, priceStartHref, pushedState, rememberView } from '@/lib/handoff'
import { HALF, MapSheet, PEEK_PX, type SheetSnap } from './map-sheet'
import { LENSES, METRICS, METRIC_TABLE, TOOL_INPUTS, journeyStart, lensById, metricAvailability, neededTables, nextStep, stepTables, type LensId, type MetricId, type ToolId } from './lenses'
import { CompareStart, JourneySummary, StartFrom } from './journey'
import { STEP_WAIT, decisionFor, pickedLine, stepLine, type DecisionAction, type HomesChoice, type SitesCompared } from './journey-logic'
import { trackDecisionMoment, trackJourneyDecision } from '@/lib/commercial-metrics'
import { StillWorking } from './tools/choice'
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
function DistrictCard({ name, lines, at, top: ceiling, bottom: floor, onDetails, onClose, kind = 'district' }: {
  name: string
  /** A district's card, or a business's (a list's «على الخريطة»): the same window, named for what it shows. */
  kind?: 'district' | 'business'
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
    <section aria-label={kind === 'district' ? `الحي ${name}` : `المنشأة ${name}`} className="absolute z-[7] flex flex-col gap-1.5 rounded-xl border bg-card/95 p-3 text-sm shadow-lg backdrop-blur"
      style={{ left, width, top }}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold">{name}</h2>
        <button onClick={onClose} aria-label="إغلاق" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" aria-hidden /></button>
      </div>
      {lines.map((line) => (
        <p key={line.label} className="text-muted-foreground">{line.label}: <span className="font-semibold text-foreground tabular-nums">{line.value}</span></p>
      ))}
      <button onClick={onDetails} className="mt-1 self-start rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60">{kind === 'district' ? 'التفاصيل' : 'في القائمة'}</button>
    </section>
  )
}

type Pointed = { id: string; x: number; y: number; width: number; height: number }
/** One action under a tool's verdict: a link to another page, or a step on this map. One look for both. */
function NextAction({ href, onClick, icon: Icon, children }: { href?: string; onClick?: () => void; icon: typeof ArrowLeft; children: ReactNode }) {
  const look = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-card px-3 py-1 text-sm font-semibold text-primary outline-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11'
  const body = <><Icon className="size-4 shrink-0" aria-hidden />{children}</>
  return href ? <Link href={href} className={look}>{body}</Link> : <button type="button" onClick={onClick} className={look}>{body}</button>
}

/** The saved comparisons as a card of their own (nothing where none is saved). */
function SavedListCard({ onOpen }: { onOpen: (href: string) => void }) {
  const { views } = useAppStore()
  if (!views.length) return null
  return <section aria-label="المقارنات المحفوظة" className="rounded-2xl border bg-card p-4"><SavedList onOpen={onOpen} /></section>
}

/** The card a group of close businesses opens on the map: how many, the first few by name, and «قرّب» for the rest. */
function GroupCard({ group, names, at, top: ceiling, bottom: floor, onOpen, onClose, onExpand }: {
  group: BusinessGroup
  names: { id: string; name: string }[]
  at: { x: number; y: number; width: number; height: number }
  top: number
  bottom: number
  onOpen: (id: string) => void
  onClose: () => void
  onExpand: () => void
}) {
  const width = Math.min(256, at.width - 16)
  const left = Math.min(Math.max(8, at.x - width / 2), at.width - width - 8)
  const height = 64 + names.length * 30 + 44
  const wanted = at.y - 12 - height >= ceiling ? at.y - 12 - height : at.y + 12
  const top = Math.max(ceiling, Math.min(wanted, floor - height))
  const more = group.count - names.length
  return (
    <section aria-label={`${counted(group.count, 'business')} في هذا المكان`} className="absolute z-[7] flex flex-col gap-1.5 rounded-xl border bg-card/95 p-3 text-sm shadow-lg backdrop-blur" style={{ left, width, top }}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold">{counted(group.count, 'business')} هنا</h2>
        <button onClick={onClose} aria-label="إغلاق" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" aria-hidden /></button>
      </div>
      <ul className="flex flex-col">
        {names.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onOpen(item.id)} className="w-full truncate rounded-md px-1 py-1 text-start font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60">{item.name}</button>
          </li>
        ))}
      </ul>
      <button onClick={onExpand} className="mt-1 self-start rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60">
        {more > 0 ? `قرّب لترى ${counted(more, 'business')} أخرى` : 'قرّب'}
      </button>
    </section>
  )
}

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

// the city and group a visitor last worked in, so a visit to the bare map opens where they left off, not on Riyadh's
// shop owners every time (this browser only; the address still wins)
const LAST_KEY = 'atlas.map.last'
// and the activity they studied, once they picked one (never the default nobody picked)
type Last = { city?: string; lens?: LensId; main?: string; activity?: string }
function readLast(): Last {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, unknown>
    // the same checks as an address (map-query.ts): storage is this browser's, but still read as untrusted
    const text = (value: unknown, shape: RegExp) => (typeof value === 'string' && shape.test(value) ? value : undefined)
    return {
      city: text(saved.city, /^[A-Za-z][A-Za-z .'-]{0,39}$/),
      lens: LENSES.some((item) => item.id === saved.lens) ? saved.lens as LensId : undefined,
      main: text(saved.main, /^[A-Za-z0-9_-]{1,40}$/),
      activity: typeof saved.activity === 'string' ? cleanQuery(saved.activity) ?? undefined : undefined,
    }
  } catch { return {} }
}
function writeLast(last: Last) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(last)) } catch { /* private window: the map opens on its defaults */ }
}

// what each of the city's tables holds, so a failed one is named instead of «part of the figures»
const TABLE_LABEL: Record<CityTable, string> = {
  population: 'السكان', counts: 'المنشآت', income: 'الدخل', growth: 'البناء الجديد', housing: 'مستوى السكن', realEstate: 'أسعار العقار',
  deals: 'الصفقات المسجلة', restaurants: 'مطاعم التوصيل', menuPrices: 'أسعار الأصناف', demand: 'البحث بلا نتيجة',
}

/** Where the businesses list sits in the panel, scrolled to when the decision card opens it. */
const JOURNEY_BUSINESSES = 'journey-businesses'

/** The steps whose first district is a place to go on to (a gap, a matching audience, the best listing's district), not one to avoid. */
const LEADS_TO_START: readonly ToolId[] = ['gaps', 'audience', 'homes']

// the choices made inside the lens's steps (sort orders, filters, the second activity, the open business), beside the view
const withOptions = (search: string, lens: LensId) => writeMapOptions(search, lens, lensById(lens).steps.map((step) => step.tool), getSticky)
/** A new history entry for a change Back should undo (a step, a district, the city, the group, a search). */
const pushAddress = (search: string, prev: string | null = null) => {
  if (search === window.location.search) return
  window.history.pushState(pushedState(prev), '', `${window.location.pathname}${search}${window.location.hash}`)
  rememberView('/map', search)
}
const replaceAddress = (search: string) => {
  if (search !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
  // the main navigation and a request made here come back to this view (lib/handoff.ts)
  rememberView('/map', search)
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
  // a search from the top of the map, or one inside a site's reach (`area`, from a site card in «قارن المواقع»)
  const [search, setSearch] = useState<{ q: string; nonce: number; area?: { label: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon } } | null>(null)
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
  // a business a list located on the map: the map flies to it and marks it, until the step, the city or the search changes
  const [located, setLocated] = useState<{ id: string; lon: number; lat: number; name: string; category: string; district: string } | null>(null)
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
  // what each step of this city's journey last answered: its one-line answer and the district it put first, kept after
  // the step is left, so a later step can start from it («ابدأ من») and the last step can sum the journey up. Held for
  // one city and group (`key`): another city or group starts an empty trail.
  const trailKey = `${city}|${lens}`
  const [trail, setTrail] = useState<{ key: string; summaries: Partial<Record<ToolId, string>>; leads: Partial<Record<ToolId, string>> }>({ key: '', summaries: {}, leads: {} })
  const remember = useCallback((key: string, owner: ToolId, summary: string | null, lead: string | null) => setTrail((current) => {
    const base = current.key === key ? current : { key, summaries: {}, leads: {} }
    if (base === current && (current.summaries[owner] ?? null) === summary && (current.leads[owner] ?? null) === lead) return current
    return { key, summaries: { ...base.summaries, [owner]: summary ?? undefined }, leads: { ...base.leads, [owner]: lead ?? undefined } }
  }), [])
  // one poster per open step: an answer that lands after its step was left (a slow fetch of the step before) is
  // dropped, instead of painting its colours under the open step's key
  const onOverlay = useMemo(() => {
    const owner = tool
    const key = trailKey
    return (next: Overlay) => {
      if (openTool.current !== owner) return
      setOverlay(next)
      if (next.summary || next.sites?.length) markDone(owner)
      remember(key, owner, next.summary ?? null, next.lead ?? null)
      // the sites «قارن المواقع» scored, kept for the shop owner's closing card (cleared when the sites go)
      if (owner === 'around') setSitesTrail((current) => (current.key === key && current.value === (next.comparison ?? null) ? current : { key, value: next.comparison ?? null }))
    }
  }, [tool, trailKey, markDone, remember])
  const trailNow = trail.key === trailKey ? trail : null
  const [sitesTrail, setSitesTrail] = useState<{ key: string; value: SitesCompared | null }>({ key: '', value: null })
  // the decision card opened the picked districts' businesses; another step, group or city closes them
  const [decisionBusinesses, setDecisionBusinesses] = useState(false)
  useEffect(() => { setDecisionBusinesses(false) }, [tool, lens, city])
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
  // Back and Forward: a change of city, group, step, districts or search is one entry; the layer, a step's own choices
  // and the camera replace the entry they are in (lib/handoff.ts historyGate)
  const [gate] = useState(() => historyGate())
  useEffect(() => {
    gate.hold()
    const query = new URLSearchParams(window.location.search)
    const preset = readMapQuery(window.location.search, Object.fromEntries(LENSES.map((item) => [item.id, item.steps.map((s) => s.tool)])), GOAL_LENS,
      Object.fromEntries(LENSES.map((item) => [item.id, item.metrics])))
    // the bare map opens on the city and group last worked in; anything the address names wins, and a step or
    // districts named alone keep the defaults they were written against
    const last = readLast()
    if (!preset.city && !query.has('district') && last.city) preset.city = last.city
    if (!preset.lens && !query.has('goal') && !query.has('tool') && !query.has('layer') && last.lens) preset.lens = last.lens
    if (!preset.main && !preset.activity) { if (last.main) preset.main = last.main; else if (last.activity) preset.activity = last.activity }
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
    if (!cities.some((item) => item.en === wanted)) { gate.hold(); setCity('Riyadh') }
  }, [cities])
  useEffect(() => {
    const pending = presetDistricts.current
    if (!pending || data.status === 'loading') return
    if (pending.city !== city) { if (data.status === 'ready') presetDistricts.current = null; return }
    presetDistricts.current = null
    const known = new Set(data.rows.map((row) => row.id))
    const ids = pending.ids.filter((id) => known.has(id))
    // a shared link opens on its districts, framed, instead of the whole city with the picked ones somewhere in it
    gate.hold()
    if (ids.length) { setSelected(ids); flyTo(...ids) }
    // flyTo only sets state; it is rebuilt each render and needs no dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.status, data.rows, city])
  // what one history entry of the map shows (lib/handoff.ts historyGate), as it stands or with a pick or search closed
  const mapKey = (change: { selected?: string[]; q?: string | null }) =>
    JSON.stringify([city, lens, tool, change.selected ?? selected, change.q !== undefined ? change.q : search?.q ?? null])
  // closing a search or a pick that the entry before already shows without it goes Back to that entry, so «open, close»
  // is undone by one Back, not two
  const closeSearch = () => { if (!backIfReturning(mapKey({ q: null }))) setSearch(null) }
  const clearPick = () => { if (!backIfReturning(mapKey({ selected: [] }))) setSelected([]) }
  useEffect(() => {
    if (!hydrated) return
    // a main activity still waiting for its city's list keeps its place in the address
    const main = presetMain.current ?? studied.main_id ?? null
    const next = writeMapQuery(window.location.search, { city, lens, tool, districts: selected, q: search?.q ?? null, main, activity: main ? null : studied.q ?? null, layer: metric }, lensById(lens).steps[0].tool, lensById(lens).metric)
    // a second activity still waiting for its name keeps its place too
    const address = presetRival.current ? next : withOptions(next, lens)
    const prev = gate.step(mapKey({}))
    if (prev != null) pushAddress(address, prev)
    else replaceAddress(address)
  }, [hydrated, city, lens, tool, selected, search, studied, metric])
  // Back or Forward onto another entry of the map: the view that entry's address names, read like a shared link
  // the outlines' rows (`early`), which a step still loading its own tables already has: `rows` waits for those
  const now = useRef({ city, lens, tool, search, rows: data.early })
  now.current = { city, lens, tool, search, rows: data.early }
  // the same reading of the address, for a saved comparison opened from the panel (an entry of its own, like a link)
  const applyAddress = useRef<() => void>(() => {})
  const openView = (href: string) => {
    if (href === `${window.location.pathname}${window.location.search}`) return
    window.history.pushState({}, '', href)
    applyAddress.current()
  }
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname !== '/map') return
      const view = readMapQuery(window.location.search, Object.fromEntries(LENSES.map((item) => [item.id, item.steps.map((s) => s.tool)])), {},
        Object.fromEntries(LENSES.map((item) => [item.id, item.metrics])))
      const at = now.current
      gate.reset()
      gate.hold()
      setCard(null)
      const nextCity = view.city ?? 'Riyadh'
      if (nextCity !== at.city) {
        // the other city's districts are picked once they load, as for a shared link
        presetDistricts.current = view.districts.length ? { city: nextCity, ids: view.districts } : null
        setCity(nextCity)
      } else {
        const known = new Set(at.rows.map((row) => row.id))
        const ids = known.size ? view.districts.filter((id) => known.has(id)) : view.districts
        setSelected(ids)
        if (ids.length) flyTo(...ids)
      }
      const nextLens = (view.lens ?? 'shops') as LensId
      if (nextLens !== at.lens) {
        presetTool.current = view.tool as ToolId | null
        presetLayer.current = view.layer as MetricId | null
        setLens(nextLens)
      } else {
        setTool((view.tool as ToolId | null) ?? lensById(nextLens).steps[0].tool)
        setMetric((view.layer as MetricId | null) ?? lensById(nextLens).metric)
      }
      if ((view.q ?? null) !== (at.search?.q ?? null)) {
        setDraft(view.q ?? '')
        setSearch(view.q ? { q: view.q, nonce: Date.now() } : null)
      }
    }
    applyAddress.current = onPop
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // flyTo only sets state; the handler reads the page through `now`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate])
  // saved as it changes; a city that turns out unknown is checked again on the next visit, as an address would be
  useEffect(() => {
    if (!hydrated) return
    const picked = stickyHas('activity')
    // a main activity still waiting for its city's list is kept, as in the address
    const main = presetMain.current ?? (picked ? studied.main_id : undefined)
    writeLast({ city, lens, main, activity: !main && picked ? studied.q : undefined })
  }, [hydrated, city, lens, studied])
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
  useEffect(() => { setLocated(null) }, [tool, city, search])
  // the open list's businesses, named on the map; a row and its dot light together (bizPoint), a dot opens its card
  const [biz, setBiz] = useState<{ dots: BusinessDot[]; rows: PublicDirectoryEntity[] }>({ dots: [], rows: [] })
  const [bizPoint, setBizPoint] = useState<string | null>(null)
  // a group of close businesses that was clicked: its card names them, each opening its own card
  const [group, setGroup] = useState<BusinessGroup | null>(null)
  useEffect(() => { setGroup(null) }, [biz.dots, tool, city])
  // what the map shows, for a list that follows it
  const [mapBounds, setMapBounds] = useState<[number, number, number, number] | null>(null)
  // the business audience's activity (its «منشآت» mode), carried into the campaign step's list
  const [audienceMode] = useStickyState<'people' | 'businesses'>('audience.mode', 'people')
  const onMarkers = useCallback((dots: BusinessDot[], rows: PublicDirectoryEntity[]) => setBiz({ dots, rows }), [])
  const bizDots = useMemo(() => biz.dots.map((dot) => (dot.id === bizPoint || dot.id === located?.id ? { ...dot, active: true } : dot)), [biz.dots, bizPoint, located?.id])
  const openBiz = (id: string) => {
    const row = biz.rows.find((item) => item.id === id)
    if (!row) return
    setGroup(null)
    locate(row)
    // the row it came from is in view when the list is raised again
    document.getElementById(`biz-row-${id}`)?.scrollIntoView({ block: 'nearest' })
  }
  // a business card's «على الخريطة»: on a phone the sheet goes down so the marked place is in view
  const locate = (row: { id: string; name: string; category: string; district: string; latitude: number | null; longitude: number | null }) => {
    if (row.latitude == null || row.longitude == null) return
    // the business's own card takes the map's one card: a district card open beside it closes
    setCard(null)
    setLocated({ id: row.id, lon: row.longitude, lat: row.latitude, name: row.name, category: row.category, district: row.district })
    if (!window.matchMedia('(min-width: 64rem)').matches) setSheet('peek')
  }

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
  // and posts its own answer line from the picked rows (the businesses step posts its count from its list instead)
  const pickedKey = selected.join('|')
  const pickedAnswer = TOOL_INPUTS[tool].pickAnswers ? pickedLine(tool, chosen) : null
  useEffect(() => {
    if (!pickedKey || !TOOL_INPUTS[tool].pickAnswers) return
    markDone(tool)
    if (tool !== 'businesses') remember(trailKey, tool, pickedAnswer, null)
  }, [pickedKey, tool, markDone, remember, trailKey, pickedAnswer])
  // the analyst's decision moments (foundation §7): the ranking sorted by another figure (its id), and two districts
  // compared (no names); the figure the lens opens on is not a choice
  const openedMetric = useRef<string | null>(null)
  useEffect(() => {
    if (lens !== 'analysts' || tool !== 'district') { openedMetric.current = null; return }
    if (openedMetric.current == null) { openedMetric.current = metric; return }
    if (metric !== openedMetric.current) { openedMetric.current = metric; trackDecisionMoment('ranking_sorted', { lens, city, metric }) }
  }, [lens, tool, metric, city])
  useEffect(() => {
    if (tool === 'compare' && selected.length === 2) trackDecisionMoment('districts_compared', { lens, city, count: 2 })
    // once per pair picked, by their ids as one string
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, pickedKey, city])
  // the businesses list's own line (its count in the picked districts), kept as that step's answer
  const onBusinessesAnswer = useCallback((line: string | null) => { if (line) remember(trailKey, 'businesses', line, null) }, [remember, trailKey])
  // «التالي»: the next step of the journey, named with what it carries over (the studied activity, the picked district)
  const next = nextStep(active, tool)
  // the activity is carried by name only once the customer chose it (a pick, a link): the default nobody picked is
  // not «يكمل على «صيدلية»»
  const chosenActivity = stickyHas('activity') ? studied.label : null
  const carried = next ? [
    TOOL_INPUTS[next.tool].activity && TOOL_INPUTS[tool].activity && chosenActivity ? `«${chosenActivity}»` : null,
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
  const rankLine = !toolColors && leadRow && leadValue != null
    ? `الأعلى في ${METRICS[metric].label}: ${leadRow.name} ${METRICS[metric].unit === '%' ? ltr(format(leadValue, '%')) : format(leadValue, METRICS[metric].unit)}`
    : null
  // a step still waiting for the customer says what to do on it; only the steps whose answer is the ranking itself
  // («الأحياء والترتيب», «أين يُبنى الآن؟») lead with the top district of the shading figure
  // the step's own line: its answer, else that it is working, slow or failed (with a retry), else what to do on it
  const line = stepLine({ tool, step: step ?? null, summary: overlay.summary ?? pickedAnswer, state: overlay.state, slow: overlay.slow, rankLine })
  const retry = overlay.state === 'error' ? overlay.retry ?? null : null
  const peekLine = line ? (
    <span className={cn('inline-flex items-center gap-1.5', line.tone === 'error' && 'text-destructive')}>
      {(line.tone === 'loading' || line.tone === 'slow') && <Hourglass className="size-3.5 shrink-0 animate-pulse text-primary" aria-hidden />}
      <span className="truncate">{line.text}</span>
    </span>
  ) : null
  const peekAction = retry && !search && !chosen.length ? <Chip onClick={retry}>أعد المحاولة</Chip> : null
  // a slow step says why it takes long and what to do meanwhile, once, above its tool (territories and the site
  // comparison say it in their own words already)
  const slowWait = overlay.state === 'loading' && overlay.slow && tool !== 'territories' && tool !== 'around' ? STEP_WAIT[tool] : null
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
  // a list inside a site's reach keeps that reach drawn, so the list and its area are read together
  const catchmentAreas = useMemo(() => (search?.area ? [{ id: 'catchment', color: PALETTE.olive, geometry: search.area.geometry }] : null), [search])
  const sheetTitle = search ? (search.area ? `«${search.q}» في نطاق الموقع ${search.area.label}` : `بحث: ${search.q}`) : chosen.length ? `${chosen.map((row) => row.name).join('، ')} · ${step?.label}` : `${stepAt} · ${step?.label ?? ''}`
  // a pick on the map is silent to a screen reader (the canvas has no districts to read): the pick and its two golden
  // figures are said in a polite live line instead
  const pickedSay = chosen.length === 1
    ? `اخترت ${chosen[0].name}. السكان ${format(chosen[0].population)}، المنشآت ${format(chosen[0].businesses)}.`
    : chosen.length > 1 ? `${counted(chosen.length, 'district')} مختارة: ${chosen.map((row) => row.name).join('، ')}.` : ''
  // the step after each answer, under its verdict (the tools' `next` slot): what the answer names first (its `lead`
  // district) carried into the request, the business list, the listings or the price, nothing typed again
  const leadOf = overlay.lead ? data.rows.find((row) => row.id === overlay.lead) ?? null : null
  // after a pick from an answer, the business list it opens is brought into view
  const toBusinesses = () => window.setTimeout(() => document.querySelector('section[aria-label="منشآت الحي"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
  const nextFor = (id: ToolId): ReactNode => {
    if (id === 'gaps' && leadOf) return <>
      <NextAction icon={ClipboardList} onClick={() => { pickFromList(leadOf.id); toBusinesses() }}>طلب تسعير أو حملة في {leadOf.name}</NextAction>
      <NextAction icon={Building2} href={homesHref({ city, districts: [leadOf.id], types: ['store'] })}>محلات للإيجار في {leadOf.name}</NextAction>
    </>
    if (id === 'competitors' && leadOf) return (
      <NextAction icon={Users} onClick={() => { setSelected([leadOf.id]); setSearch({ q: rival ?? studied.label, nonce: Date.now() }) }}>منشآت «{rival ?? studied.label}» في {leadOf.name}</NextAction>
    )
    if (id === 'audience' && (chosen.length || leadOf)) {
      const scope = chosen.length ? chosen : [leadOf!]
      return <NextAction icon={Megaphone} onClick={() => { if (!chosen.length) setSelected([leadOf!.id]); setTool('businesses'); toBusinesses() }}>
        جهّز حملة في {scope.length === 1 ? scope[0].name : counted(scope.length, 'district')}
      </NextAction>
    }
    if (id === 'homes' && leadOf) return (
      <NextAction icon={Calculator} href={priceStartHref({ city, district: leadOf.id })}>سعّر عقاراً في {leadOf.name}</NextAction>
    )
    if (id === 'around' && overlay.sites?.length) return <>
      <NextAction icon={ArrowLeft} onClick={() => [...document.querySelectorAll('article h3')].find((title) => title.textContent?.startsWith('بطاقة الموقع'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>بطاقة الموقع</NextAction>
      {lensById(lens).steps.some((item) => item.tool === 'homes') && <NextAction icon={Building2} onClick={() => setTool('homes')}>محلات للإيجار حول المواقع</NextAction>}
    </>
    return null
  }
  // under each site's card: the businesses of the studied activity inside the site's own reach (its catchment as the
  // card drew it), from where a quote request, a campaign or a list starts; without a reach yet, the site's district
  const siteAction = (site: { label: string; lon: number; lat: number; area?: GeoJSON.Polygon | GeoJSON.MultiPolygon }) => {
    if (site.area) {
      const area = { label: site.label, geometry: site.area }
      return (
        <NextAction icon={ClipboardList} onClick={() => { setSelected([]); setSearch({ q: studied.label, nonce: Date.now(), area }) }}>
          اطلب تسعيراً من منشآت «{studied.label}» داخل نطاق الموقع {site.label}
        </NextAction>
      )
    }
    const id = districtAt(site, data.features)
    const row = id ? data.rows.find((item) => item.id === id) ?? null : null
    return (
      <NextAction icon={ClipboardList} onClick={() => { setSelected(row ? [row.id] : []); setSearch({ q: studied.label, nonce: Date.now() }) }}>
        اطلب تسعيراً من منشآت «{studied.label}» {row ? `في ${row.name}` : 'في المدينة'}
      </NextAction>
    )
  }
  const showBusinesses = !search && selected.length > 0 && lens !== 'property' && ['businesses', 'gaps', 'district', 'competitors'].includes(tool)
  // «ابدأ من»: a step that takes a district, opened with none picked, starts from the district an earlier step put first
  const startLeads: Partial<Record<ToolId, string>> = {}
  for (const id of LEADS_TO_START) if (trailNow?.leads[id]) startLeads[id] = trailNow.leads[id]
  const start = !search && !selected.length && tool !== 'compare' ? journeyStart(active, tool, startLeads, (id) => rowById.has(id)) : null
  const startRow = start ? rowById.get(start.id) ?? null : null
  // the card the journey closes on: what its steps pointed to, and what to do with it through the existing flows
  // the property seeker's search in «اختر عقاراً» (its kept choices, homes-tool.tsx), carried into the close's links
  const homesChoice = (): HomesChoice => {
    const kind = getSticky('homes.plain.kind') === 'sale' ? 'sale' : 'rent'
    const rentDeal = getSticky('homes.plain.rentDeal') as string | undefined
    const budget = Number(getSticky('homes.plain.budget') ?? 0)
    return { kind, type: String(getSticky('homes.plain.type') ?? 'apartment'), deal: kind === 'sale' ? 'sale' : rentDeal === 'all' ? null : rentDeal ?? 'rent_year', budget: Number.isFinite(budget) ? budget : 0 }
  }
  const decision = !next ? decisionFor({ lens, city, rows: data.rows, picked: chosen, leads: trailNow?.leads ?? {}, activity: chosenActivity, done,
    sites: sitesTrail.key === trailKey ? sitesTrail.value : null, homes: lens === 'property' ? homesChoice() : null }) : null
  const answeredSteps = active.steps.filter((item) => done.includes(item.tool)).length
  // at the journey's last step the peeking sheet says the decision itself, so a phone sees it without raising the panel
  // (a failed step still says it failed, with its retry)
  const shownDecision = !search && decision?.pick && active.steps.length > 1 && done.some((id) => active.steps.some((item) => item.tool === id)) ? decision.pick : null
  const decisionLine = shownDecision && overlay.state !== 'error'
    ? <span className="inline-flex items-center gap-1.5 font-semibold text-foreground"><Check className="size-3.5 shrink-0 text-primary" strokeWidth={3} aria-hidden /><span className="truncate">{shownDecision}</span></span>
    : null
  // the decision moment of the journey itself: the closing card shown, once per group, city and decision in a visit
  useEffect(() => {
    if (shownDecision) trackJourneyDecision({ lens, city, moment: 'shown', answered: answeredSteps, steps: active.steps.length })
    // keyed by the decision's words (never sent), the group and the city
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownDecision, lens, city])
  const act = (action: DecisionAction) => {
    trackJourneyDecision({ lens, city, moment: 'acted', action: action.kind, answered: answeredSteps, steps: active.steps.length })
    if (action.kind === 'link') return
    if (action.kind === 'step') {
      if (action.ids.length) { setSelected(action.ids); flyTo(...action.ids) }
      focusAfter.current = tabId(action.tool)
      setTool(action.tool)
      return
    }
    setSelected(action.ids)
    flyTo(...action.ids)
    setDecisionBusinesses(true)
    // once the list is drawn (under the card, or the step's own), it comes into view
    window.setTimeout(() => document.getElementById(JOURNEY_BUSINESSES)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
  }
  // «قارن مباشرة»: the two districts the shading figure ranks first, or the picked one and the top other
  const compareStart = (() => {
    if (tool !== 'compare' || selected.length >= 2 || search || metricPending) return null
    const value = METRICS[metric].value
    const top = data.rows.filter((row) => value(row) != null && !selected.includes(row.id)).sort((a, b) => (value(b) as number) - (value(a) as number))
    const pair = selected.length === 1 ? [chosen[0], top[0]] : [top[0], top[1]]
    if (!pair[0] || !pair[1]) return null
    const why = selected.length === 1 ? `${pair[1].name} الأعلى في ${METRICS[metric].label}` : `الأعلى في ${METRICS[metric].label}`
    return { rows: pair as [DistrictRow, DistrictRow], why }
  })()

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
          <LensMapCanvas features={data.features} steps={steps} selected={selected} onToggle={toggle} colors={overlay.colors} circle={overlay.circle} onPick={overlay.onPick} points={overlay.points} lines={overlay.lines} start={overlay.start ?? located} areas={catchmentAreas ?? overlay.areas} sites={overlay.sites} listings={overlay.listings} onListing={overlay.onListing} businesses={bizDots} onBusiness={openBiz} onBusinessHover={setBizPoint} onBusinessGroup={(next) => { setCard(null); setLocated(null); setGroup(next) }} onBounds={setMapBounds} streets={overlay.streets} onStreet={overlay.onStreet} focus={located ?? overlay.focus} zoomTo={zoomTo} hover={hovered} onPoint={pointer.set}
            onFailed={setMapFailed} errorClassName="max-lg:top-1/3" cover={sheet === 'half' ? HALF : 0} peek={peekPx}
            onDistrictClick={(hit) => { mapPick.current = true; setLocated(null); setCard(selected.includes(hit.id) ? null : hit) }}
            pin={cardRow ? card : located ?? group} onPin={setCardAt} />
          {overlay.popup}
          {cardRow && cardAt && cardAt.x >= 0 && cardAt.y >= 0 && cardAt.x <= cardAt.width && cardAt.y <= cardAt.height && (
            <DistrictCard name={cardRow.name} lines={cardLines(cardRow)} at={cardAt} onDetails={openDetails} onClose={closeCard}
              {...(window.matchMedia('(min-width: 64rem)').matches
                ? { top: 8, bottom: cardAt.height - 8 }
                // the floating search and chips on top; below, what the sheet covers above the map's own end (the peek)
                : { top: 124, bottom: cardAt.height - 8 - (sheet === 'half' ? Math.max(0, HALF * (cardAt.height + peekPx) - peekPx) : 0) })} />
          )}
          {/* the business a list located: its name beside its mark, what it is and where, and the way back to its row */}
          {!cardRow && located && cardAt && cardAt.x >= 0 && cardAt.y >= 0 && cardAt.x <= cardAt.width && cardAt.y <= cardAt.height && (
            <DistrictCard kind="business" name={located.name} at={cardAt}
              lines={[{ label: 'النشاط', value: located.category || 'غير متاح' }, { label: 'الحي', value: located.district || 'غير متاح' }]}
              onClose={() => setLocated(null)}
              onDetails={() => {
                const id = located.id
                setSheet((current) => (current === 'peek' ? 'half' : current))
                window.setTimeout(() => {
                  const row = document.getElementById(`biz-row-${id}`)
                  row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                  row?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true })
                }, 250)
              }}
              {...(window.matchMedia('(min-width: 64rem)').matches
                ? { top: 8, bottom: cardAt.height - 8 }
                : { top: 124, bottom: cardAt.height - 8 - (sheet === 'half' ? Math.max(0, HALF * (cardAt.height + peekPx) - peekPx) : 0) })} />
          )}
          {/* a group of close businesses: its names, each a tap from its own card, and the zoom that splits it */}
          {!cardRow && !located && group && cardAt && cardAt.x >= 0 && cardAt.y >= 0 && cardAt.x <= cardAt.width && cardAt.y <= cardAt.height && (
            <GroupCard group={group} names={group.ids.map((id) => ({ id, name: biz.rows.find((row) => row.id === id)?.name ?? 'غير متاح' }))} at={cardAt}
              onOpen={openBiz} onClose={() => setGroup(null)} onExpand={() => { group.expand(); setGroup(null) }}
              {...(window.matchMedia('(min-width: 64rem)').matches
                ? { top: 8, bottom: cardAt.height - 8 }
                : { top: 124, bottom: cardAt.height - 8 - (sheet === 'half' ? Math.max(0, HALF * (cardAt.height + peekPx) - peekPx) : 0) })} />
          )}
          <PointerTip store={pointer} describe={describePointed} />
          <p aria-live="polite" className="sr-only">{pickedSay}</p>
          <MapOnboarding lens={lens} onLens={setLens} picked={selected.length > 0} paused={mapFailed || noDistricts}
            onShowMe={leadId ? () => pickFromList(leadId) : null} showMeName={leadRow?.name ?? null}
            // «أين ينقص نشاطي؟» is the step that waits for the activity before it colours anything (the others start on one)
            firstAsk={tool === 'gaps' && !chosenActivity ? step?.ask ?? null : null} />
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
                <button type="button" aria-label="امسح البحث" onClick={() => { setDraft(''); closeSearch(); phoneSearch.current?.focus() }}
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
        <MapSheet snap={sheet} onSnap={setSheet} onPeek={setPeekPx} title={sheetTitle} summary={!search ? decisionLine ?? (!chosen.length ? peekLine : null) : null} summaryAction={peekAction} resetKey={search ? `search|${search.nonce}` : `${lens}|${tool}`}
          panel={!search && data.status !== 'error' ? { id: STEP_PANEL, labelledBy: tabId(tool) } : null}
          header={!search && data.status !== 'error' ? (
            // the steps stay above the scrolling body at every stop of the sheet: one sideways line on a phone, and from lg
            // they wrap, so a five-step journey shows every step and its ✓ at once (no arrows, nothing cut)
            <ScrollRow role="tablist" arrows label={`خطوات ${active.label}`} active={tool} onKeyDown={tabKeys} className="-mx-3 gap-1.5 px-3 pb-1 lg:flex-wrap lg:overflow-visible">
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
                  <Chip onClick={() => { focusAfter.current = tabId(tool); closeSearch() }} className="self-start"><X className="size-4" aria-hidden />إغلاق البحث والعودة للخطوات</Chip>
                  <BusinessesPanel key={search.nonce} city={city} districts={search.area ? [] : chosen.map((row) => row.name)} query={search.q} area={search.area ?? null} onLocate={locate} located={located?.id ?? null} onMarkers={onMarkers} pointed={bizPoint} onPoint={setBizPoint} bounds={mapBounds} />
                </div>
              )}
              {!search && (
                <>
                  {/* a table that failed empties its figures in every district: said once at the top, with a retry, so a
                      «غير متاح» further down is not read as the city lacking the figure */}
                  {stepFailed && (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed bg-card p-3 text-sm">
                      {/* named, so the rest of the city's figures read as sound and the customer knows what is missing */}
                      <span className="min-w-0 flex-1">تعذّر تحميل {data.failed.filter((table) => stepTables(tool).includes(table)).map((table) => `«${TABLE_LABEL[table]}»`).join(' و')} في {cityName} الآن، وما يعتمد عليه مكتوب «تعذّر التحميل». بقية الأرقام محمّلة.</span>
                      {data.reload && <Chip onClick={data.reload}>أعد المحاولة</Chip>}
                    </div>
                  )}
                  {/* a tap answers first: the picked district leads, then the step's tool, then the full summary */}
                  {chosen.length > 0 && !['district', 'growth', 'compare', 'around', 'homes'].includes(tool) && (
                    <PickedStrip chosen={chosen} onClear={() => { focusAfter.current = tabId(tool); clearPick() }}
                      onDetails={() => document.getElementById('picked-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
                  )}
                  {start && startRow && <StartFrom name={startRow.name} from={start.from} onPick={() => pickFromList(startRow.id)} />}
                  {slowWait && <StillWorking>{slowWait.why} {slowWait.meanwhile}</StillWorking>}
                  {/* the open step's tool crossfades as the step changes — a short, gentle swap so the panel reads as one
                      surface answering, not a flicker. mode="wait" keeps one tool mounted at a time (no racing overlays);
                      the shared panels below (summary, businesses) stay put and never remount here. */}
                  <AnimatePresence mode="wait" initial={false}>
                    {tool !== 'businesses' && (
                      <motion.div key={tool} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: reduce ? 0 : DURATION.fast, ease: EASE }}>
                        {tool === 'gaps' && <GapsTool city={city} cityName={cityName} rows={data.rows} onOverlay={onOverlay} onSelect={pickFromList} selected={selected} onHover={setHovered} next={nextFor('gaps')} />}
                        {tool === 'audience' && <AudienceTool city={city} rows={data.rows} selected={chosen} onOverlay={onOverlay} onSelect={toggleFromList} onHover={setHovered} next={nextFor('audience')} />}
                        {tool === 'competitors' && <CompetitorsTool city={city} rows={data.rows} onOverlay={onOverlay} onHover={setHovered} onSelect={pickFromList} onActivity={setRival}
                          onAllBranches={(brand) => { setSelected([]); setSearch({ q: brand, nonce: Date.now() }) }} next={nextFor('competitors')} />}
                        {tool === 'corridors' && <CorridorsTool city={city} rows={data.rows} onOverlay={onOverlay} />}
                        {tool === 'around' && <AroundTool city={city} onOverlay={onOverlay} districts={data.rows} features={data.features} next={nextFor('around')} siteAction={siteAction} seed={trailNow?.leads.gaps ?? null} />}
                        {tool === 'territories' && <TerritoriesTool city={city} rows={data.rows} onOverlay={onOverlay} />}
                        {tool === 'homes' && <HomesTool key={lens} city={city} rows={data.rows} selected={chosen} onOverlay={onOverlay} onHover={setHovered} preset={lens === 'shops' ? { kind: 'rent', type: 'store', deal: 'all' } : undefined} next={nextFor('homes')} />}
                        {tool === 'compare' && <CompareTool rows={data.rows} selected={chosen} />}
                        {/* the comparison kept by name inside Atlas, and every saved one a tap away (foundation §3.4) */}
                        {tool === 'compare' && <SavedComparisons city={city} cityName={cityName} districts={chosen.map((row) => row.name)}
                          here={() => (typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}`)} onOpen={openView} />}
                        {/* the analysts' first step lists what they saved, so a comparison is reopened from where the journey starts */}
                        {tool === 'district' && lens === 'analysts' && <SavedListCard onOpen={openView} />}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {compareStart && <CompareStart names={[compareStart.rows[0].name, compareStart.rows[1].name]} why={compareStart.why}
                    onPick={() => { const ids = compareStart.rows.map((row) => row.id); setSelected(ids); flyTo(...ids) }} />}
                  {tool === 'businesses' && !selected.length && !start && (
                    <EmptyState icon={MousePointerClick} title="اختر حياً" body="اضغط حياً أو أكثر على الخريطة، أو اختره من «الحي» في الأعلى، فتظهر منشآته هنا. أو ابحث عن نشاط من الأعلى." />
                  )}
                  {/* while the city's tables load, the summary keeps its shape: its tiles said «غير متاح» and the ranking
                      stood empty, as if the city had no figures at all */}
                  {data.status === 'loading' && (tool === 'district' || tool === 'growth') && <SummarySkeleton cityName={cityName} />}
                  {data.status !== 'loading' && (tool === 'district' || tool === 'growth' || (selected.length > 0 && tool !== 'around' && tool !== 'homes')) && (
                    <div id="picked-summary" className="scroll-mt-2">
                      <DistrictPanel city={city} cityName={cityName} lens={lens} rows={data.rows} selected={chosen} total={data.total} failed={data.failed} pending={data.pending}
                        onClear={() => { focusAfter.current = tabId(tool); clearPick() }} />
                    </div>
                  )}
                  {showBusinesses && (
                    <div id={JOURNEY_BUSINESSES} className="scroll-mt-2">
                      <BusinessesPanel key={`${tool}|${rival ?? ''}`} city={city} districts={chosen.map((row) => row.name)} query={tool === 'competitors' ? rival ?? undefined : undefined} onLocate={locate} located={located?.id ?? null}
                        onMarkers={onMarkers} pointed={bizPoint} onPoint={setBizPoint} bounds={mapBounds}
                        prefill={tool === 'gaps' || (tool === 'businesses' && lens === 'marketers' && audienceMode === 'businesses') ? studied.label : null}
                        onAnswer={tool === 'businesses' ? onBusinessesAnswer : undefined} />
                    </div>
                  )}
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
                  {/* the last step closes the journey: what each step answered, on one card, and a link to come back to it */}
                  {!next && active.steps.length > 1 && done.some((id) => active.steps.some((item) => item.tool === id)) && (
                    <JourneySummary lens={active} cityName={cityName} tool={tool} done={done} answers={trailNow?.summaries ?? {}}
                      picked={chosen.map((row) => row.name)} activity={chosenActivity} decision={decision} onAct={act}
                      onOpen={(id) => { focusAfter.current = tabId(id); setTool(id) }} />
                  )}
                  {/* the decision's businesses, where the quote request, the campaign or the list is made from the picks
                      after review (the same list as every step's); only when the open step does not show it already */}
                  {decisionBusinesses && selected.length > 0 && !showBusinesses && (
                    <div id={JOURNEY_BUSINESSES} className="scroll-mt-2">
                      <BusinessesPanel key={`decision|${pickedKey}`} city={city} districts={chosen.map((row) => row.name)} onLocate={locate} located={located?.id ?? null} />
                    </div>
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
