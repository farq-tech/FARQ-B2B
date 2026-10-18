import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type WheelEvent } from 'react'
import { Icon } from '../../../ui'
import { FOCUS_RING } from '../../../ui/cx'
import { chipWidth, clip, fitBadgeSvg, MAP_ICON_BODY, palette, TEARDROP } from './glyphs'
import { densityStep, FIT_LABEL, streetLine } from './model'

/** District fill strength by density step (0 none … 4 densest), matched to the Mapbox layer. */
const CHORO = [0.015, 0.14, 0.27, 0.4, 0.55]
import type { LayerMapProps } from './types'

/*
 * The drawn map (no Mapbox token in this build): the same layers as the Mapbox map on the light-grey land colour.
 * District polygons are real (GET /districts), drawn with dashed outlines; a chosen district gets a light green fill.
 * Pins are the real coordinates of the rows inside the chosen districts. Nothing on this map is invented: no roads.
 * Drag to move, wheel or +/- to zoom, Enter / Space on a district or pin.
 */
type View = { cx: number; cy: number; k: number }
const LAT0 = 24.7
const projX = (lon: number) => lon * Math.cos((LAT0 * Math.PI) / 180)
const projY = (lat: number) => -lat
const unX = (x: number) => x / Math.cos((LAT0 * Math.PI) / 180)
const unY = (y: number) => -y

function viewFor(b: [number, number, number, number], w: number, h: number, pad = 48): View {
  const [west, south, east, north] = b
  const x0 = projX(west), x1 = projX(east), y0 = projY(north), y1 = projY(south)
  const k = Math.min((w - pad * 2) / Math.max(1e-4, x1 - x0), (h - pad * 2) / Math.max(1e-4, y1 - y0))
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k: Math.min(k, 60000) }
}
const RIYADH_BOX: [number, number, number, number] = [46.55, 24.55, 46.85, 24.85]
const enter = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() } }

export default function DrawnLayerMap({ districts, chosen, onDistrict, pins, highlightedPinKey, onPin, nameOf, clusters, onCluster, site, placingSite, onPlaceSite, fit, extent, streets, activeStreet, onStreet, density, densityMax, showDensity, showDistricts, showPlaces }: LayerMapProps) {
  const box = useRef<HTMLDivElement>(null)
  const P = useMemo(() => palette(), [])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean; v: View } | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const cityBox = useMemo<[number, number, number, number] | null>(() => {
    const bs = districts.map((d) => d.bbox).filter(Boolean) as [number, number, number, number][]
    if (!bs.length) return extent
    return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))]
  }, [districts, extent])
  // frame the city (or the rows) once the size is known; then follow «fit» requests
  // the frame follows the box size until the user moves the map themselves
  const framed = useRef<string>('')
  const moved = useRef(false)
  useEffect(() => {
    if (!size.w || !size.h) return
    const target = fit ? `fit:${fit.at}` : `city:${cityBox?.join(',')}`
    const key = `${target}|${moved.current ? 'user' : `${size.w}x${size.h}`}`
    if (framed.current === key) return
    if (!framed.current.startsWith(`${target}|`)) moved.current = false
    framed.current = `${target}|${moved.current ? 'user' : `${size.w}x${size.h}`}`
    if (moved.current) return
    setView(viewFor(fit?.bounds || cityBox || RIYADH_BOX, size.w, size.h))
  }, [size, fit, cityBox])

  const v = view || (size.w ? viewFor(cityBox || RIYADH_BOX, size.w, size.h) : { cx: 0, cy: 0, k: 1 })
  const sx = (lon: number) => (projX(lon) - v.cx) * v.k + size.w / 2
  const sy = (lat: number) => (projY(lat) - v.cy) * v.k + size.h / 2
  const toLonLat = (px: number, py: number) => ({ lon: unX((px - size.w / 2) / v.k + v.cx), lat: unY((py - size.h / 2) / v.k + v.cy) })

  // polygons in projected units: drawn once, moved with a transform
  const paths = useMemo(() => districts.filter((d) => d.feature).map((d) => {
    const g = d.feature!.geometry
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    const dstr = polys.map((poly) => poly.map((ring) => ring.map(([x, y], i) => `${i ? 'L' : 'M'}${projX(x).toFixed(5)} ${projY(y).toFixed(5)}`).join('') + 'Z').join('')).join('')
    return { id: d.id, ar: d.ar, d: dstr, bbox: d.bbox! }
  }), [districts])
  const zoomBy = (f: number, px = size.w / 2, py = size.h / 2) => {
    moved.current = true
    const p = toLonLat(px, py)
    const k = Math.max(200, Math.min(80000, v.k * f))
    setView({ k, cx: projX(p.lon) - (px - size.w / 2) / k, cy: projY(p.lat) - (py - size.h / 2) / k })
  }
  const onWheel = (e: WheelEvent) => { const r = box.current!.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top) }
  const down = (e: RPointerEvent) => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, moved: false, v }; }
  const move = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    d.moved = true
    moved.current = true
    setView({ ...d.v, cx: d.v.cx - dx / d.v.k, cy: d.v.cy - dy / d.v.k })
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    const step = 60 / v.k
    const pan: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (pan[e.key]) { e.preventDefault(); moved.current = true; setView({ ...v, cx: v.cx + pan[e.key][0], cy: v.cy + pan[e.key][1] }) }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.5) }
    else if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.5) }
  }
  const up = () => { setTimeout(() => { drag.current = null }, 0) }
  const wasDrag = () => Boolean(drag.current?.moved)
  const clickLand = (e: React.MouseEvent) => {
    if (wasDrag() || !placingSite) return
    const r = box.current!.getBoundingClientRect()
    const p = toLonLat(e.clientX - r.left, e.clientY - r.top)
    onPlaceSite(p.lat, p.lon)
  }
  const maxPer = Math.max(1, ...streets.map((st) => st.props.per_100m))
  // label pills: the 12 busiest lines (and the picked one), each only where it does not overlap one already placed
  const labels: { st: (typeof streets)[number]; x: number; y: number; w: number; text: string }[] = []
  for (const st of [...streets].sort((a, b) => Number(b.id === activeStreet) - Number(a.id === activeStreet) || b.props.n - a.props.n).slice(0, 12)) {
    const x = sx(st.mid[0]), y = sy(st.mid[1])
    const label = streetLine(st)
    const text = `${label.length > 24 ? `${label.slice(0, 23)}…` : label} · ${st.props.n.toLocaleString('ar-SA')}`
    const w = Math.min(220, 20 + text.length * 6.1)
    if (labels.some((l) => Math.abs(l.x - x) < (l.w + w) / 2 + 4 && Math.abs(l.y - y) < 26)) continue
    labels.push({ st, x, y, w, text })
  }
  const ordered = [...pins].sort((a, b) => Number(a.chosen) - Number(b.chosen) || b.lat - a.lat)
  const siteR = site ? (site.km / 111.32) * v.k : 0

  return (
    <div ref={box} className={`absolute inset-0 touch-none overflow-hidden bg-[var(--map-land)] ${placingSite ? 'cursor-crosshair' : 'cursor-grab'}`}
      role="region" aria-label="خريطة الفرص">
      {size.w ? (
        // a map canvas is a keyboard widget of its own (arrows pan, +/− zoom): role="application" is the documented pattern
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
        <svg width={size.w} height={size.h} className={`block select-none ${FOCUS_RING}`} role="application" aria-label="الخريطة: الأسهم للتحريك، + و − للتكبير والتصغير" tabIndex={0} onKeyDown={onKey} onWheel={onWheel} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onClick={clickLand}>
          <g transform={`translate(${size.w / 2 - v.cx * v.k} ${size.h / 2 - v.cy * v.k}) scale(${v.k})`}>
            {paths.map((p) => {
              const on = chosen.has(p.id)
              const step = showDensity ? densityStep(density.get(p.id) || 0, densityMax) : 0
              return (
                <path key={p.id} d={p.d} role="button" tabIndex={0} aria-pressed={on} aria-label={`حي ${p.ar}${density.get(p.id) ? ` — ${density.get(p.id)} منشأة` : ''}`} data-district={p.ar} data-density={step}
                  onClick={(e) => { e.stopPropagation(); if (!wasDrag() && !placingSite && (showDistricts || showDensity)) onDistrict(p.id); else if (placingSite) clickLand(e) }}
                  onKeyDown={enter(() => { if (showDistricts || showDensity) onDistrict(p.id) })}
                  className="cursor-pointer outline-none transition-[stroke] hover:stroke-[var(--map-green)] hover:stroke-opacity-100 focus-visible:stroke-[var(--map-ink)]"
                  fill={step || on ? P.green : P.ink} fillOpacity={Math.max(on ? 0.08 : 0, showDensity ? CHORO[step] : 0)} stroke={on ? P.ink : P.ink} strokeOpacity={showDistricts ? (on ? 0.95 : 0.35) : 0}
                  strokeWidth={on ? 2.5 : 1} strokeDasharray={on ? undefined : '4 3'} vectorEffect="non-scaling-stroke" />
              )
            })}
          </g>
          {/* district names: chosen ones always, the rest when there is room */}
          {showDistricts ? paths.map((p) => {
            const on = chosen.has(p.id)
            const wpx = (projX(p.bbox[2]) - projX(p.bbox[0])) * v.k
            if (!on && wpx < 70) return null
            const x = sx((p.bbox[0] + p.bbox[2]) / 2), y = sy((p.bbox[1] + p.bbox[3]) / 2)
            if (x < -50 || y < -20 || x > size.w + 50 || y > size.h + 20) return null
            return <text key={`l${p.id}`} x={x} y={y} textAnchor="middle" dominantBaseline="middle" pointerEvents="none"
              className="text-[12px] font-semibold" fill={on ? P.green : P.label} stroke={P.white} strokeWidth={3} paintOrder="stroke">{p.ar}</text>
          }) : null}
          {site ? (
            <g pointerEvents="none">
              <circle cx={sx(site.lon)} cy={sy(site.lat)} r={siteR} fill={P.green} fillOpacity={0.06} stroke={P.green} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="6 4" />
            </g>
          ) : null}
          {/* dense streets: a soft glow under a green core, width and strength by establishments per 100 m; a pill at the middle */}
          {streets.map((st) => {
            const ratio = Math.min(1, st.props.per_100m / maxPer)
            const w = 3 + 5 * ratio, on = activeStreet === st.id
            const d = st.lines.map((line) => line.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join('')).join('')
            const go = () => onStreet(st.id)
            return (
              <g key={st.id} role="button" tabIndex={0} aria-pressed={on} aria-label={st.props.label_ar || `${st.props.street_ar} — ${st.props.n} منشأة`} data-street={st.props.street_ar}
                className={`cursor-pointer ${FOCUS_RING}`} onClick={(e) => { e.stopPropagation(); if (!wasDrag()) go() }} onKeyDown={enter(go)}>
                <path d={d} fill="none" stroke={P.green} strokeOpacity={on ? 0.35 : 0.16 + 0.12 * ratio} strokeWidth={w * 3.2} strokeLinecap="round" strokeLinejoin="round" />
                {on ? <path d={d} fill="none" stroke={P.white} strokeWidth={w + 4} strokeLinecap="round" strokeLinejoin="round" /> : null}
                <path d={d} fill="none" stroke={P.green} strokeOpacity={0.55 + 0.45 * ratio} strokeWidth={on ? w + 1.5 : w} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )
          })}
          {labels.map(({ st, x, y, w, text }) => {
            const on = activeStreet === st.id
            return (
              <g key={`p${st.id}`} transform={`translate(${x - w / 2} ${y - 13})`} className="cursor-pointer" aria-hidden onClick={(e) => { e.stopPropagation(); if (!wasDrag()) onStreet(st.id) }}>
                <rect width={w} height={22} rx={11} fill={on ? P.ink : P.white} stroke={P.green} strokeWidth={1.5} />
                <text x={w / 2} y={12} textAnchor="middle" dominantBaseline="middle" className="text-[11px] font-semibold" fill={on ? P.white : P.ink}>{text}</text>
              </g>
            )
          })}
          {showPlaces ? clusters.map((c, i) => {
            const x = sx(c.lon), y = sy(c.lat)
            const r = Math.max(12, Math.min(22, 6 + Math.sqrt(c.n) * 2))
            const label = c.popular_ar || (c.level === 'street' ? c.street_ar : c.district_ar) || c.label_ar
            return (
              <g key={`c${i}`} data-interest={c.level} role="button" tabIndex={0} className={`cursor-pointer ${FOCUS_RING}`}
                aria-label={`${c.popular_ar ? `${c.popular_ar} — ` : ''}${c.label_ar} — ${c.n} منشأة${c.wholesale_pct >= 30 ? ' · جملة' : ''}`}
                onClick={(e) => { e.stopPropagation(); if (!wasDrag()) onCluster(c) }} onKeyDown={enter(() => onCluster(c))}>
                <circle cx={x} cy={y} r={r} fill={P.green} fillOpacity={0.14} stroke={P.green} strokeOpacity={0.55} strokeWidth={1.5} />
                <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" className="text-[12px] font-semibold" fill={P.green}>{c.n.toLocaleString('ar-SA')}</text>
                <text x={x} y={y + r + 12} textAnchor="middle" className="text-[11px] font-medium" fill={P.ink} stroke={P.white} strokeWidth={3} paintOrder="stroke">{label}</text>
              </g>
            )
          }) : null}
          {showPlaces ? ordered.map((p) => {
            const x = sx(p.lon), y = sy(p.lat)
            const highlighted = p.key === highlightedPinKey
            const name = nameOf(p.key)
            const pinLabel = `${name} — ${FIT_LABEL[p.fit]}`
            const common = { role: 'button', tabIndex: 0, 'aria-label': pinLabel, className: `cursor-pointer ${FOCUS_RING}`, 'data-pin': p.layer, 'data-pin-key': p.key, 'data-highlighted': highlighted ? 'true' : undefined,
              onClick: (e: React.MouseEvent) => { e.stopPropagation(); if (!wasDrag()) onPin(p.key) }, onKeyDown: enter(() => onPin(p.key)) } as const
            const halo = highlighted ? <circle cx={x} cy={y - (p.layer === 'main' ? 8 : p.layer === 'spec' ? 18 : 0)} r={18} fill={P.green} fillOpacity={0.18} stroke={P.green} strokeOpacity={0.8} strokeWidth={2} pointerEvents="none" /> : null
            if (p.layer === 'main') return (
              <g key={p.key}>{halo}<g {...common} transform={`translate(${x - 14} ${y - 33}) scale(.7)`}>
                <title>{pinLabel}</title>
                <path d={TEARDROP} fill={P.ink} stroke={p.chosen ? P.green : P.white} strokeWidth={p.chosen ? 4 : 2} />
                <g transform="translate(9 7) scale(.92)" fill="none" stroke={P.white} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: MAP_ICON_BODY(p.icon) }} />
                <g dangerouslySetInnerHTML={{ __html: fitBadgeSvg(p.fit, P) }} />
              </g></g>
            )
            if (p.layer === 'sub') return (
              <g key={p.key}>{halo}<g {...common} transform={`translate(${x - 13} ${y - 13}) scale(.7)`}>
                <title>{pinLabel}</title>
                <circle cx={19} cy={19} r={17} fill={P.green} stroke={p.chosen ? P.ink : P.white} strokeWidth={p.chosen ? 4 : 2.5} />
                <g transform="translate(8.2 8.2) scale(.9)" fill="none" stroke={P.white} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: MAP_ICON_BODY(p.icon) }} />
                <g dangerouslySetInnerHTML={{ __html: fitBadgeSvg(p.fit, P) }} />
              </g></g>
            )
            const w = chipWidth(p.text)
            return (
              <g key={p.key}>{halo}<g {...common} transform={`translate(${x - w / 2} ${y - 32})`}>
                <title>{pinLabel}</title>
                <rect width={w} height={26} rx={8} fill={P.navy} stroke={p.chosen ? P.green : 'none'} strokeWidth={3} />
                <path d={`M${w / 2 - 5} 26l5 6 5-6z`} fill={P.navy} />
                <text x={w / 2} y={14} textAnchor="middle" dominantBaseline="middle" className="text-[12px] font-semibold" fill={P.white}>{clip(p.text)}</text>
                <g transform={`translate(${w - 38} 0)`} dangerouslySetInnerHTML={{ __html: fitBadgeSvg(p.fit, P) }} />
              </g></g>
            )
          }) : null}
          {site ? (
            <g pointerEvents="none" transform={`translate(${sx(site.lon) - 12} ${sy(site.lat) - 12})`}>
              <circle cx={12} cy={12} r={11} fill={P.white} stroke={P.ink} strokeWidth={2} />
              <circle cx={12} cy={12} r={5} fill={P.green} />
            </g>
          ) : null}
        </svg>
      ) : null}
      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] shadow-[var(--farq-soft-shadow)]">
        <button type="button" aria-label="تكبير" onClick={(e) => { e.stopPropagation(); zoomBy(1.5) }} className={`flex size-9 items-center justify-center hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}><Icon name="plus" size={16} /></button>
        <button type="button" aria-label="تصغير" onClick={(e) => { e.stopPropagation(); zoomBy(1 / 1.5) }} className={`flex size-9 items-center justify-center border-t border-[var(--color-border-default)] hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}><span aria-hidden className="text-[18px] leading-none">−</span></button>
      </div>
    </div>
  )
}
