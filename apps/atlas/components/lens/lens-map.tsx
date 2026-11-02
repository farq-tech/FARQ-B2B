'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, MousePointerClick, Search, X } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { ChipRow, PillField, SearchPill, pillControl } from '@/components/shared/search-pill'
import { Chip } from '@/components/ui/chip'
import { Skeleton } from '@/components/ui/skeleton'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN, populationMethod } from '@/lib/explanations'
import { numberFormat, useCities } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import { useCityData, type DistrictRow } from './city-data'
import { DistrictPanel } from './district-panel'
import { LensMapCanvas, SHADES, shadeSteps } from './lens-map-canvas'
import { MapOnboarding } from './map-onboarding'
import { HALF, MapSheet, PEEK, type SheetSnap } from './map-sheet'
import { LENSES, METRICS, lensById, type LensId, type MetricId, type ToolId } from './lenses'
import { AroundTool } from './tools/around-tool'
import { AudienceTool } from './tools/audience-tool'
import { CompareTool } from './tools/compare-tool'
import { CompetitorsTool } from './tools/competitors-tool'
import { CorridorsTool } from './tools/corridors-tool'
import { BusinessesPanel } from './businesses-panel'
import { GapsTool } from './tools/gaps-tool'
import { HomesTool } from './tools/homes-tool'
import { LegendTitle, MapLegend } from './tools/map-legend'
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
        className="h-9 appearance-none rounded-full border border-primary/40 bg-card/95 ps-3.5 pe-8 text-sm font-semibold text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
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
  // a map that failed to open: its notice takes the map, and the tour waits (there is nothing to tap)
  const [mapFailed, setMapFailed] = useState(false)
  const data = useCityData(city)
  const onOverlay = useCallback((next: Overlay) => setOverlay(next), [])
  const active = lensById(lens)

  useEffect(() => { setSelected([]) }, [city])
  // a link's ?tool= wins once over the lens's first step, when it is one of that lens's steps
  const presetTool = useRef<ToolId | null>(null)
  useEffect(() => {
    const steps = lensById(lens).steps.map((step) => step.tool)
    setMetric(lensById(lens).metric)
    setTool(presetTool.current && steps.includes(presetTool.current) ? presetTool.current : steps[0])
    presetTool.current = null
  }, [lens])
  useEffect(() => {
    setOverlay({})
    if (tool === 'growth') setMetric('growth')
  }, [tool])
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const presetLens = query.get('lens') ?? GOAL_LENS[query.get('goal') ?? '']
    presetTool.current = (query.get('tool') as ToolId | null) ?? null
    if (presetLens && LENSES.some((item) => item.id === presetLens)) setLens(presetLens as LensId)
    if (query.get('goal') === 'find-supplier' || query.get('search') != null) (window.matchMedia('(min-width: 64rem)').matches ? searchBox : phoneSearch).current?.focus()
  }, [])
  useEffect(() => { if (selected.length) setSheet((current) => (current === 'peek' ? 'half' : current)) }, [selected.length])
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
  const pickDistrict = (value: string) => { if (value !== DISTRICTS_MULTI) setSelected(value ? [value] : []) }
  const submit = () => { if (draft.trim()) setSearch({ q: draft.trim(), nonce: Date.now() }) }
  // the step that paints the districts itself owns the map's colours while it is open; the metric chips wait, and the
  // key in the map's corner says whose colours they are
  const toolColors = overlay.colors != null
  const legendTitle = overlay.legend?.title ?? (toolColors ? `ألوان الخريطة: ${step?.label ?? ''}` : step?.label ?? '')
  const sheetTitle = search ? `بحث: ${search.q}` : chosen.length ? `${step?.label} · ${chosen.map((row) => row.name).join('، ')}` : `${active.label} · ${step?.label ?? ''}`
  const showBusinesses = !search && selected.length > 0 && lens !== 'property' && ['businesses', 'gaps', 'district', 'competitors'].includes(tool)

  return (
    <main className="flex h-[calc(100dvh-8rem)] flex-col lg:h-[calc(100dvh-4rem)]">
      {/* from lg: one search pill and one chip row, as on «العقار»: the city, who is looking, and what they look for */}
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
        {!toolColors && (
          <ChipRow label="المقياس على الخريطة">
            {active.metrics.map((id) => <Chip key={id} active={metric === id} onClick={() => setMetric(id)}>{METRICS[id].label}</Chip>)}
          </ChipRow>
        )}
      </header>

      <div className="relative min-h-0 flex-1 lg:flex lg:flex-row">
        <div className="absolute inset-x-0 top-0 bottom-[var(--peek)] lg:relative lg:inset-auto lg:flex-1" style={{ '--peek': PEEK } as CSSProperties}>
          <LensMapCanvas features={data.features} steps={steps} selected={selected} onToggle={toggle} colors={overlay.colors} circle={overlay.circle} onPick={overlay.onPick} points={overlay.points} lines={overlay.lines} start={overlay.start} areas={overlay.areas} sites={overlay.sites} listings={overlay.listings} onListing={overlay.onListing} streets={overlay.streets} onStreet={overlay.onStreet} focus={overlay.focus} zoomTo={zoomTo}
            onFailed={setMapFailed} errorClassName="max-lg:top-1/3" />
          {overlay.popup}
          <MapOnboarding lens={lens} onLens={setLens} picked={selected.length > 0} paused={mapFailed} />
          {/* on a phone the controls float over the map: the search, then one scrolling row of city, who, and metric */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3 lg:hidden">
            <form role="search" aria-label="ابحث عن مورد أو نشاط" onSubmit={(event) => { event.preventDefault(); submit() }}
              className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card/95 p-1.5 ps-4 shadow-md backdrop-blur">
              <input ref={phoneSearch} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="ابحث عن مورد أو نشاط"
                placeholder="ابحث عن مورد أو نشاط" className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
              <button type="submit" aria-label="ابحث" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><Search className="size-4" aria-hidden /></button>
            </form>
            <ScrollRow label="المدينة والحي والفئة والمقياس" className="pointer-events-auto -mx-3 gap-2 px-3 pb-1">
              <ChipSelect label="المدينة" value={city} onChange={setCity} options={cities.map((item) => [item.en, item.ar || item.en])} />
              <ChipSelect label="الحي" value={districtValue} onChange={pickDistrict} options={districtOptions} />
              <ChipSelect label="الفئة" value={lens} onChange={(value) => setLens(value as LensId)} options={LENSES.map((item) => [item.id, item.label])} />
              {!toolColors && active.metrics.map((id) => <Chip key={id} active={metric === id} onClick={() => setMetric(id)} className="shadow-sm">{METRICS[id].label}</Chip>)}
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
                  {overlay.legend && <MapLegend {...overlay.legend} title={legendTitle} />}
                  {toolColors && !overlay.legend && <LegendTitle>{legendTitle}</LegendTitle>}
                  {!toolColors && overlay.legend && <span className="my-0.5 border-t" aria-hidden />}
                  {!toolColors && <>
                  <LegendTitle>ألوان الخريطة: {METRICS[metric].label}</LegendTitle>
                  <Explained title="ألوان الخريطة" lines={EXPLAIN.shading(METRICS[metric].label)} className="flex items-center gap-1.5 text-sm no-underline">
                    <span className="text-muted-foreground">أقل</span>
                    <span className="flex gap-0.5" aria-hidden>{SHADES.map((shade) => <span key={shade} className="h-4 w-7 rounded-sm" style={{ background: shade }} />)}</span>
                    <span className="text-muted-foreground">أعلى</span>
                  </Explained>
                  </>}
                </>
              )}
            </div>
          </div>
        </div>
        <MapSheet snap={sheet} onSnap={setSheet} title={sheetTitle}>
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
                  <ScrollRow role="tablist" label={`خطوات ${active.label}`} active={tool} onKeyDown={tabKeys}
                    style={{ '--steps': active.steps.length } as CSSProperties}
                    className="-mx-3 shrink-0 gap-1.5 px-3 pb-1 lg:mx-0 lg:grid lg:grid-cols-[repeat(var(--steps),minmax(0,1fr))] lg:gap-1 lg:overflow-visible lg:rounded-2xl lg:border lg:bg-card lg:p-1">
                    {active.steps.map((item, index) => (
                      <StepTab key={item.tool} index={index} label={item.label} active={tool === item.tool} onClick={() => setTool(item.tool)} />
                    ))}
                  </ScrollRow>
                  {tool === 'gaps' && <GapsTool city={city} rows={data.rows} onOverlay={onOverlay} onSelect={pickFromList} />}
                  {tool === 'audience' && <AudienceTool city={city} rows={data.rows} selected={chosen} onOverlay={onOverlay} onSelect={toggleFromList} />}
                  {tool === 'competitors' && <CompetitorsTool city={city} rows={data.rows} onOverlay={onOverlay} onSelect={pickFromList} onActivity={setRival}
                    onAllBranches={(brand) => { setSelected([]); setSearch({ q: brand, nonce: Date.now() }) }} />}
                  {tool === 'corridors' && <CorridorsTool city={city} onOverlay={onOverlay} />}
                  {tool === 'around' && <AroundTool city={city} onOverlay={onOverlay} districts={data.rows} features={data.features} />}
                  {tool === 'territories' && <TerritoriesTool city={city} rows={data.rows} onOverlay={onOverlay} />}
                  {tool === 'homes' && <HomesTool key={lens} city={city} rows={data.rows} selected={chosen} onOverlay={onOverlay} preset={lens === 'shops' ? { kind: 'rent', type: 'store', deal: 'all' } : undefined} />}
                  {tool === 'compare' && <CompareTool rows={data.rows} selected={chosen} />}
                  {tool === 'businesses' && !selected.length && (
                    <EmptyState icon={MousePointerClick} title="اختر حياً" body="اضغط حياً أو أكثر على الخريطة، أو من ترتيب «أين جمهوري؟»، فتظهر منشآته هنا. أو ابحث عن نشاط من الأعلى." />
                  )}
                  {(tool === 'district' || tool === 'growth' || (selected.length > 0 && tool !== 'around' && tool !== 'homes')) && (
                    <DistrictPanel city={city} cityName={cityName} lens={lens} rows={data.rows} selected={chosen} total={data.total} onClear={() => setSelected([])} />
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
