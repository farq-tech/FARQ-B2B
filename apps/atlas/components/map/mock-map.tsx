'use client'

import { Check, Layers, Loader2, MapPinOff, Minus, Plus, RotateCcw, SearchX, ServerCrash, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { DISTRICTS, MAP_HEIGHT, MAP_WIDTH, STREETS, districtById, streetById } from '@/lib/mock-data'
import { formatPhone } from '@/lib/format'
import type { MapArea } from '@/lib/geo'
import type { Business } from '@/lib/types'
import { cn } from '@/lib/utils'

export type MapState = 'ready' | 'loading' | 'empty' | 'unavailable'

interface View {
  k: number
  tx: number
  ty: number
}

interface Layers {
  districts: boolean
  streets: boolean
  clusters: boolean
}

export interface MockMapProps {
  cityId: string
  businesses: Business[]
  ghostBusinesses?: Business[]
  selectedIds: string[]
  onTogglePin: (id: string) => void
  focusRequest?: { id: string; nonce: number } | null
  highlightDistricts?: string[]
  highlightStreets?: string[]
  state?: MapState
  onResetFilters?: () => void
  onRetry?: () => void
  compact?: boolean
  /** Lift bottom overlays (legend, mobile card) above a floating tray. */
  reserveBottom?: boolean
  className?: string
  /** Area-of-interest selection (live map only). */
  area?: MapArea | null
  onAreaChange?: (area: MapArea | null) => void
  onSelectMany?: (ids: string[]) => void
  onShowList?: () => void
}

const MIN_K = 1
const MAX_K = 6
const IDENTITY: View = { k: 1, tx: 0, ty: 0 }
const MAIN_ROADS = [
  'M0 343 L1000 347',
  'M343 0 L349 700',
  'M656 0 L660 700',
  'M0 120 C250 160 520 90 1000 180',
  'M120 700 C260 520 640 560 900 0',
]

function clampView(v: View): View {
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k))
  const tx = Math.min(0, Math.max(MAP_WIDTH - MAP_WIDTH * k, v.tx))
  const ty = Math.min(0, Math.max(MAP_HEIGHT - MAP_HEIGHT * k, v.ty))
  return { k, tx, ty }
}

function centerOn(x: number, y: number, k: number): View {
  return clampView({ k, tx: MAP_WIDTH / 2 - x * k, ty: MAP_HEIGHT / 2 - y * k })
}

interface Cluster {
  key: string
  x: number
  y: number
  items: Business[]
}

function clusterize(items: Business[], k: number): Cluster[] {
  const cell = 96 / k
  const groups = new Map<string, Business[]>()
  for (const b of items) {
    const key = `${Math.floor(b.x / cell)}:${Math.floor(b.y / cell)}`
    const g = groups.get(key)
    if (g) g.push(b)
    else groups.set(key, [b])
  }
  return Array.from(groups, ([key, group]) => ({
    key,
    items: group,
    x: group.reduce((s, b) => s + b.x, 0) / group.length,
    y: group.reduce((s, b) => s + b.y, 0) / group.length,
  }))
}

const PIN_PATH = 'M0 0 C-6 -9 -11 -14 -11 -21 A11 11 0 1 1 11 -21 C11 -14 6 -9 0 0 Z'

export function MockMap({
  cityId,
  businesses,
  ghostBusinesses = [],
  selectedIds,
  onTogglePin,
  focusRequest,
  highlightDistricts = [],
  highlightStreets = [],
  state = 'ready',
  onResetFilters,
  onRetry,
  compact = false,
  className,
}: MockMapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const [view, setView] = useState<View>(IDENTITY)
  const [layers, setLayers] = useState<Layers>({ districts: true, streets: true, clusters: !compact })
  const [infoId, setInfoId] = useState<string | null>(null)
  const [legendOpen, setLegendOpen] = useState(!compact)

  const districts = useMemo(() => DISTRICTS.filter((d) => d.cityId === cityId), [cityId])
  const streets = useMemo(() => STREETS.filter((s) => s.cityId === cityId), [cityId])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const streetCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of businesses) counts.set(b.streetId, (counts.get(b.streetId) ?? 0) + 1)
    return counts
  }, [businesses])

  const useClusters = layers.clusters && view.k < 2.2
  const clusters = useMemo(
    () => (useClusters ? clusterize(businesses, view.k) : businesses.map((b) => ({ key: b.id, x: b.x, y: b.y, items: [b] }))),
    [businesses, useClusters, view.k],
  )

  const handledFocusRef = useRef<number | null>(null)
  useEffect(() => {
    if (!focusRequest || handledFocusRef.current === focusRequest.nonce) return
    const b = businesses.find((x) => x.id === focusRequest.id) ?? ghostBusinesses.find((x) => x.id === focusRequest.id)
    if (!b) return
    handledFocusRef.current = focusRequest.nonce
    setView((v) => centerOn(b.x, b.y, Math.max(v.k, 2.6)))
    setInfoId(b.id)
  }, [focusRequest, businesses, ghostBusinesses])

  useEffect(() => {
    setView(IDENTITY)
    setInfoId(null)
  }, [cityId])

  const zoomBy = (factor: number) =>
    setView((v) => {
      const cx = (MAP_WIDTH / 2 - v.tx) / v.k
      const cy = (MAP_HEIGHT / 2 - v.ty) / v.k
      return centerOn(cx, cy, v.k * factor)
    })

  const unitsPerPx = () => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return 1
    return 1 / Math.min(rect.width / MAP_WIDTH, rect.height / MAP_HEIGHT)
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY, view, moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      d.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const u = unitsPerPx()
    setView(clampView({ k: d.view.k, tx: d.view.tx + dx * u, ty: d.view.ty + dy * u }))
  }
  const onPointerUp = () => {
    suppressClickRef.current = Boolean(dragRef.current?.moved)
    dragRef.current = null
  }

  const handlePin = (id: string) => {
    if (suppressClickRef.current) return
    onTogglePin(id)
    setInfoId(id)
  }

  const handleCluster = (c: Cluster) => {
    if (suppressClickRef.current) return
    setView((v) => centerOn(c.x, c.y, v.k * 2))
  }

  const info = infoId ? businesses.find((b) => b.id === infoId) ?? ghostBusinesses.find((b) => b.id === infoId) : null
  const inv = 1 / view.k

  if (state === 'unavailable') {
    return (
      <div className={cn('relative flex items-center justify-center overflow-hidden rounded-xl border bg-map-land', className)}>
        <div className="flex max-w-xs flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center shadow-sm">
          <ServerCrash className="size-8 text-warning" aria-hidden />
          <p className="font-semibold">خدمة الخرائط غير متاحة لهذه المدينة حالياً</p>
          <p className="text-sm text-muted-foreground">نعمل على توسيع التغطية. جرّب مدينة أخرى أو أعد المحاولة لاحقاً.</p>
          {onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              <RotateCcw data-icon="inline-start" />
              إعادة المحاولة
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative overflow-hidden rounded-xl border bg-map-land', className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className={cn('size-full select-none', view.k > 1 ? 'cursor-grab touch-none active:cursor-grabbing' : 'touch-pan-y')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => zoomBy(1.6)}
        role="application"
        aria-label="خريطة الفرص التفاعلية"
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          <rect width={MAP_WIDTH} height={MAP_HEIGHT} className="fill-map-land" />
          {MAIN_ROADS.map((d) => (
            <path key={d} d={d} fill="none" className="stroke-map-road" strokeWidth={9} strokeLinecap="round" />
          ))}

          {layers.districts
            ? districts.map((d) => {
                const hl = highlightDistricts.includes(d.id)
                return (
                  <polygon
                    key={d.id}
                    points={d.polygon.map((p) => p.join(',')).join(' ')}
                    className={cn(hl ? 'fill-primary/10 stroke-primary' : 'fill-card/50 stroke-foreground/15')}
                    strokeWidth={hl ? 2 : 1}
                    strokeDasharray={hl ? undefined : '6 4'}
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })
            : null}

          {streets.map((s) => {
            const count = streetCounts.get(s.id) ?? 0
            const active = layers.streets && (count >= 3 || highlightStreets.includes(s.id))
            const strong = highlightStreets.includes(s.id)
            return (
              <g key={s.id}>
                <line
                  x1={s.from[0]}
                  y1={s.from[1]}
                  x2={s.to[0]}
                  y2={s.to[1]}
                  className="stroke-map-road"
                  strokeWidth={7}
                  strokeLinecap="round"
                />
                {active ? (
                  <line
                    x1={s.from[0]}
                    y1={s.from[1]}
                    x2={s.to[0]}
                    y2={s.to[1]}
                    className={strong ? 'stroke-primary' : 'stroke-primary/45'}
                    strokeWidth={strong ? 4 : 3}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </g>
            )
          })}

          {layers.districts
            ? districts.map((d) => (
                <text
                  key={`${d.id}-label`}
                  x={d.center[0] - 40}
                  y={d.center[1] + 92}
                  textAnchor="middle"
                  fontSize={13 * Math.max(inv, 0.55)}
                  className={cn('pointer-events-none font-semibold', highlightDistricts.includes(d.id) ? 'fill-primary' : 'fill-foreground/45')}
                >
                  {d.name}
                </text>
              ))
            : null}

          {layers.streets && view.k >= 1.8
            ? streets
                .filter((s) => (streetCounts.get(s.id) ?? 0) >= 1)
                .map((s) => (
                  <text
                    key={`${s.id}-label`}
                    x={(s.from[0] + s.to[0]) / 2}
                    y={(s.from[1] + s.to[1]) / 2 - 8 * inv}
                    textAnchor="middle"
                    fontSize={10 * inv}
                    className="pointer-events-none fill-foreground/55"
                  >
                    {s.name}
                  </text>
                ))
            : null}

          {ghostBusinesses.map((b) => (
            <g
              key={`ghost-${b.id}`}
              transform={`translate(${b.x} ${b.y}) scale(${inv * 0.85})`}
              role="button"
              tabIndex={0}
              aria-label={`إضافة ${b.name}`}
              aria-pressed={false}
              className="cursor-pointer opacity-55 outline-none hover:opacity-100 focus-visible:opacity-100"
              onClick={() => handlePin(b.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handlePin(b.id)
                }
              }}
            >
              <path d={PIN_PATH} className="fill-card stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="3 2" />
              <Plus x={-6} y={-27} width={12} height={12} className="text-muted-foreground" />
            </g>
          ))}

          {clusters.map((c) => {
            if (c.items.length > 1) {
              const selectedCount = c.items.filter((b) => selectedSet.has(b.id)).length
              const r = Math.min(26, 13 + c.items.length * 1.2)
              return (
                <g
                  key={c.key}
                  transform={`translate(${c.x} ${c.y}) scale(${inv})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`تجمع يضم ${c.items.length} منشأة، اضغط للتكبير`}
                  className="cursor-pointer outline-none"
                  onClick={() => handleCluster(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleCluster(c)
                    }
                  }}
                >
                  <circle r={r + 5} className="fill-primary/15" />
                  <circle r={r} className="fill-primary stroke-card" strokeWidth={2} />
                  <text textAnchor="middle" dy="0.35em" fontSize={13} className="fill-primary-foreground font-bold">
                    {c.items.length}
                  </text>
                  {selectedCount ? (
                    <g transform={`translate(${r * 0.75} ${-r * 0.75})`}>
                      <circle r={8} className="fill-foreground stroke-card" strokeWidth={1.5} />
                      <text textAnchor="middle" dy="0.35em" fontSize={9} className="fill-card font-bold">
                        {selectedCount}
                      </text>
                    </g>
                  ) : null}
                </g>
              )
            }
            const b = c.items[0]
            const selected = selectedSet.has(b.id)
            const focused = infoId === b.id
            return (
              <g
                key={b.id}
                transform={`translate(${b.x} ${b.y}) scale(${inv})`}
                role="button"
                tabIndex={0}
                aria-label={b.name}
                aria-pressed={selected}
                className="group cursor-pointer outline-none"
                onClick={() => handlePin(b.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handlePin(b.id)
                  }
                }}
              >
                {focused ? <circle cy={-21} r={19} className="animate-pulse fill-primary/20" /> : null}
                <path
                  d={PIN_PATH}
                  className={cn(
                    'transition-colors group-focus-visible:stroke-foreground',
                    selected ? 'fill-primary stroke-card' : 'fill-card stroke-primary group-hover:fill-accent',
                  )}
                  strokeWidth={2}
                />
                {selected ? (
                  <Check x={-6.5} y={-27.5} width={13} height={13} strokeWidth={3} className="text-primary-foreground" />
                ) : (
                  <circle cy={-21} r={4} className="fill-primary" />
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* Zoom & layer controls */}
      <div className="absolute top-3 left-3 flex flex-col gap-1.5">
        <div className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          <button type="button" onClick={() => zoomBy(1.6)} className="p-2 hover:bg-muted" aria-label="تكبير">
            <Plus className="size-4" />
          </button>
          <button type="button" onClick={() => zoomBy(1 / 1.6)} className="border-t p-2 hover:bg-muted" aria-label="تصغير">
            <Minus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setView(IDENTITY)
              setInfoId(null)
            }}
            className="border-t p-2 hover:bg-muted"
            aria-label="إعادة ضبط الخريطة"
          >
            <RotateCcw className="size-4" />
          </button>
        </div>
        <Popover>
          <PopoverTrigger
            render={<button type="button" className="rounded-lg border bg-card p-2 shadow-sm hover:bg-muted" aria-label="طبقات الخريطة" />}
          >
            <Layers className="size-4" />
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-56">
            <p className="text-xs font-semibold text-muted-foreground">طبقات الخريطة</p>
            {(
              [
                ['districts', 'حدود الأحياء'],
                ['streets', 'شوارع النشاط'],
                ['clusters', 'تجميع الدبابيس'],
              ] as [keyof Layers, string][]
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-3 text-sm">
                {label}
                <Switch checked={layers[key]} onCheckedChange={(v) => setLayers((l) => ({ ...l, [key]: v }))} />
              </label>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Legend */}
      <div className="absolute right-3 bottom-3 max-w-[13rem]">
        {legendOpen ? (
          <div className="flex flex-col gap-2 rounded-lg border bg-card/95 p-3 text-xs shadow-sm backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="font-semibold">دليل الخريطة</span>
              <button type="button" onClick={() => setLegendOpen(false)} aria-label="إخفاء الدليل" className="text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </div>
            <LegendRow swatch={<span className="size-3 rounded-full border-2 border-primary bg-card" />} label="منشأة" />
            <LegendRow swatch={<span className="flex size-3 items-center justify-center rounded-full bg-primary" />} label="منشأة محددة" />
            <LegendRow swatch={<span className="size-3.5 rounded-full bg-primary ring-3 ring-primary/20" />} label="تجمع منشآت" />
            <LegendRow swatch={<span className="h-1 w-4 rounded bg-primary/50" />} label="شارع نشاط (3+ منشآت)" />
            <LegendRow swatch={<span className="size-3 rounded-sm border border-primary bg-primary/10" />} label="حي ضمن الفلتر" />
            {ghostBusinesses.length ? <LegendRow swatch={<span className="size-3 rounded-full border border-dashed border-muted-foreground" />} label="مرشح للإضافة" /> : null}
          </div>
        ) : (
          <button type="button" onClick={() => setLegendOpen(true)} className="rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-muted">
            دليل الخريطة
          </button>
        )}
      </div>

      {/* Selected pin card */}
      {info && state === 'ready' ? (
        <div className="absolute top-3 right-3 left-14 sm:right-auto sm:left-16 sm:w-72">
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-md">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{info.name}</p>
                <p className="text-xs text-muted-foreground">
                  {info.activity} · {districtById.get(info.districtId)?.name} · {streetById.get(info.streetId)?.name}
                </p>
              </div>
              <button type="button" onClick={() => setInfoId(null)} aria-label="إغلاق البطاقة" className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground" dir="ltr">
                {formatPhone(info.whatsapp)}
              </span>
              <Button size="sm" variant={selectedSet.has(info.id) ? 'outline' : 'default'} onClick={() => onTogglePin(info.id)}>
                {selectedSet.has(info.id) ? 'إلغاء التحديد' : 'تحديد'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {state === 'loading' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-map-land/80 backdrop-blur-[2px]" role="status">
          <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-sm">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            جارٍ تحميل طبقات الخريطة…
          </div>
        </div>
      ) : null}

      {state === 'empty' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-map-land/60 p-4">
          <div className="flex max-w-xs flex-col items-center gap-2 rounded-xl border bg-card p-5 text-center shadow-sm">
            {compact ? <MapPinOff className="size-7 text-muted-foreground" aria-hidden /> : <SearchX className="size-7 text-muted-foreground" aria-hidden />}
            <p className="font-semibold">{compact ? 'لا توجد منشآت في هذه المسودة' : 'لا توجد نتائج مطابقة'}</p>
            <p className="text-sm text-muted-foreground">
              {compact ? 'أضف منشآت من المرشحين على الخريطة.' : 'جرّب توسيع نطاق البحث أو إزالة بعض الفلاتر.'}
            </p>
            {onResetFilters ? (
              <Button variant="outline" size="sm" onClick={onResetFilters}>
                مسح الفلاتر
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="flex w-4 items-center justify-center">{swatch}</span>
      {label}
    </div>
  )
}
