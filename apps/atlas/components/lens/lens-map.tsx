'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MousePointerClick, X } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { ChipRow, PillField, SearchPill, pillControl } from '@/components/shared/search-pill'
import { Chip } from '@/components/ui/chip'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN, populationMethod } from '@/lib/explanations'
import { numberFormat, useCities } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import { useCityData, type DistrictRow } from './city-data'
import { DistrictPanel } from './district-panel'
import { LensMapCanvas, SHADES, shadeSteps } from './lens-map-canvas'
import { LENSES, METRICS, lensById, type LensId, type MetricId, type ToolId } from './lenses'
import { AroundTool } from './tools/around-tool'
import { AudienceTool } from './tools/audience-tool'
import { CompareTool } from './tools/compare-tool'
import { CompetitorsTool } from './tools/competitors-tool'
import { BusinessesPanel } from './businesses-panel'
import { GapsTool } from './tools/gaps-tool'
import { HomesTool } from './tools/homes-tool'
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

/** The step of a journey, as a numbered tab. */
function StepTab({ index, label, active, onClick }: { index: number; label: string; active: boolean; onClick: () => void }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
      className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60', active ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold', active ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{numberFormat.format(index + 1)}</span>
      {label}
    </button>
  )
}

// a landing goal opens the lens that serves it; «find a supplier» opens the business search instead
const GOAL_LENS: Record<string, LensId> = { explore: 'analysts', expand: 'shops', target: 'marketers', network: 'distributors', property: 'property' }

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
    if (query.get('goal') === 'find-supplier' || query.get('search') != null) searchBox.current?.focus()
  }, [])

  const steps = useMemo(() => shadeSteps(new Map(data.rows.map((row) => [row.id, METRICS[metric].value(row)]))), [data.rows, metric])
  const chosen = data.rows.filter((row) => selected.includes(row.id))
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const cityName = cities.find((item) => item.en === city)?.ar || city
  const step = active.steps.find((item) => item.tool === tool)
  const showBusinesses = !search && selected.length > 0 && lens !== 'property' && ['businesses', 'gaps', 'district', 'competitors'].includes(tool)

  return (
    <main className="flex h-[calc(100dvh-4rem)] flex-col pb-16 lg:pb-0">
      {/* one search pill and one chip row, as on «العقار»: the city, who is looking, and what they look for */}
      <header className="flex flex-col gap-3 border-b bg-background/70 px-4 py-3 backdrop-blur">
        <SearchPill label="ابحث عن مورد أو نشاط" onSubmit={() => { if (draft.trim()) setSearch({ q: draft.trim(), nonce: Date.now() }) }}>
          <PillField label="المدينة" className="basis-[calc(50%-0.25rem)] sm:basis-auto sm:max-w-[11rem]">
            <select aria-label="المدينة" value={city} onChange={(e) => setCity(e.target.value)} className={pillControl}>
              {cities.map((item) => <option key={item.en} value={item.en}>{item.ar || item.en}</option>)}
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
        <ChipRow label="المقياس على الخريطة">
          {overlay.colors ? (
            // a tool that paints the districts itself owns the map's colours while it is open
            <p className="py-2 text-sm text-muted-foreground">الألوان الآن من «{step?.label}». ارجع إلى «{active.steps[0].label}» لتغييرها.</p>
          ) : active.metrics.map((id) => (
            <Chip key={id} active={metric === id} onClick={() => setMetric(id)}>{METRICS[id].label}</Chip>
          ))}
        </ChipRow>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[50vh] shrink-0 lg:h-auto lg:flex-1">
          <LensMapCanvas features={data.features} steps={steps} selected={selected} onToggle={toggle} colors={overlay.colors} circle={overlay.circle} onPick={overlay.onPick} points={overlay.points} lines={overlay.lines} start={overlay.start} areas={overlay.areas} sites={overlay.sites} listings={overlay.listings} onListing={overlay.onListing} focus={overlay.focus} />
          {overlay.popup}
          {!overlay.colors && <Explained title="ألوان الخريطة" lines={EXPLAIN.shading(METRICS[metric].label)} className="absolute bottom-3 start-3 flex items-center gap-1 rounded-lg border bg-card/90 px-2.5 py-2 text-sm no-underline backdrop-blur">
            <span className="text-muted-foreground">أقل</span>
            {SHADES.map((shade) => <span key={shade} className="h-3 w-6 rounded-sm" style={{ background: shade }} />)}
            <span className="text-muted-foreground">أعلى · {METRICS[metric].label}</span>
          </Explained>}
          {data.status === 'loading' && (
            // a small note in the corner: the map stays visible while the city loads
            <div role="status" className="absolute top-3 start-3 flex items-center gap-2 rounded-full border bg-card/90 px-3 py-1.5 text-sm shadow-sm backdrop-blur">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden />جارٍ تحميل أحياء {cityName}
            </div>
          )}
        </div>
        <aside className="flex w-full flex-col gap-3 overflow-y-auto p-3 lg:w-[400px] lg:border-s">
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
                  <div role="tablist" aria-label={`خطوات ${active.label}`} className="flex flex-col gap-1.5">
                    {active.steps.map((item, index) => (
                      <StepTab key={item.tool} index={index} label={item.label} active={tool === item.tool} onClick={() => setTool(item.tool)} />
                    ))}
                  </div>
                  {tool === 'gaps' && <GapsTool city={city} rows={data.rows} onOverlay={onOverlay} onSelect={(id) => setSelected([id])} />}
                  {tool === 'audience' && <AudienceTool city={city} rows={data.rows} selected={chosen} onOverlay={onOverlay} onSelect={toggle} />}
                  {tool === 'competitors' && <CompetitorsTool city={city} rows={data.rows} features={data.features} onOverlay={onOverlay} onSelect={(id) => setSelected([id])} onActivity={setRival}
                    onAllBranches={(brand) => { setSelected([]); setSearch({ q: brand, nonce: Date.now() }) }} />}
                  {tool === 'around' && <AroundTool onOverlay={onOverlay} />}
                  {tool === 'territories' && <TerritoriesTool city={city} rows={data.rows} onOverlay={onOverlay} />}
                  {tool === 'homes' && <HomesTool key={lens} city={city} rows={data.rows} features={data.features} selected={chosen} onOverlay={onOverlay} preset={lens === 'shops' ? { kind: 'rent', type: 'store', deal: 'all' } : undefined} />}
                  {tool === 'compare' && <CompareTool rows={data.rows} selected={chosen} />}
                  {tool === 'businesses' && !selected.length && (
                    <EmptyState icon={MousePointerClick} title="اختر حياً" body="اضغط حياً أو أكثر على الخريطة، أو من ترتيب «أين جمهوري؟»، فتظهر منشآته هنا. أو ابحث عن نشاط من الأعلى." />
                  )}
                  {(tool === 'district' || tool === 'growth' || (selected.length > 0 && tool !== 'around' && tool !== 'homes')) && (
                    <DistrictPanel city={city} cityName={cityName} lens={lens} rows={data.rows} selected={chosen} total={data.total} onClear={() => setSelected([])} />
                  )}
                  {showBusinesses && <BusinessesPanel key={`${tool}|${rival ?? ''}`} city={city} districts={chosen.map((row) => row.name)} query={tool === 'competitors' ? rival ?? undefined : undefined} />}
                  {(tool === 'district' || tool === 'growth') && <Ranking rows={data.rows} metric={metric} selected={selected} onToggle={toggle} full={lens === 'analysts' || tool === 'growth'} />}
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </main>
  )
}
