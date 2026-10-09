import { useEffect, useMemo, useRef, useState } from 'react'
import { waNumber, type TargetRow } from '../../api/targetingClient'
import { FOCUS_RING } from '../../ui/cx'

/*
 * Map of the search results — Figma 07 «Map» (51:252) on the dark tone. Positions are the places'
 * real coordinates (equirectangular, fitted to the results). No tiles and no drawn roads: nothing on
 * this map is invented. Map Marker (24:188): colour = best reachable channel; Selected = ring; Cluster =
 * count in a dark circle (tap to zoom in). The segment is the outline around the chosen places.
 */

type Pt = { r: TargetRow; x: number; y: number }
const CELL = 50
const COLOR = { wa: 'var(--brand-accent)', email: 'var(--brand-action-light)', none: 'var(--brand-text-3)' }
const colorOf = (r: TargetRow) => (waNumber(r) ? COLOR.wa : r.email ? COLOR.email : COLOR.none)

function hull(ps: { x: number; y: number }[]) {
  if (ps.length < 3) return ps
  const p = [...ps].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: typeof p[0], a: typeof p[0], b: typeof p[0]) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lo: typeof p = [], up: typeof p = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

export default function TargetMap({ rows, selected, onToggle, topInset = 72, legend = true }: { rows: TargetRow[]; selected: Set<string>; onToggle: (r: TargetRow) => void; /** px kept free at the top (search overlay on phones) */ topInset?: number; bottomInset?: number; legend?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // zoom belongs to one result set: a new search shows everything again
  const [zoomed, setZoomed] = useState<{ rows: TargetRow[]; keys: string[] } | null>(null)
  const zoom = zoomed && zoomed.rows === rows ? zoomed.keys : null
  const setZoom = (keys: string[] | null) => setZoomed(keys ? { rows, keys } : null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => rows.filter((r) => r.latitude != null && r.longitude != null && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)), [rows])
  const { pts, clusters, outside } = useMemo(() => {
    let outside = 0
    const view = zoom ? geo.filter((r) => zoom.includes(r.poi_key)) : geo
    if (!view.length || !size.w || !size.h) return { pts: [] as Pt[], clusters: [] as Pt[][], outside: 0 }
    // robust frame: the middle 96% of the places, so a few far-off points do not shrink the dense area
    const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))]
    const lons = view.map((r) => r.longitude!).sort((a, b) => a - b), lats = view.map((r) => r.latitude!).sort((a, b) => a - b)
    const cut = view.length > 20 ? 0.02 : 0
    const x0 = q(lons, cut), x1 = q(lons, 1 - cut), y0 = q(lats, cut), y1 = q(lats, 1 - cut)
    const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180)
    const pad = 56, top = topInset, bottom = 56
    const spanX = Math.max((x1 - x0) * k, 0.01), spanY = Math.max(y1 - y0, 0.01)
    const s = Math.min((size.w - pad * 2) / spanX, (size.h - top - bottom) / spanY)
    const ox = (size.w - spanX * s) / 2, oy = top + (size.h - top - bottom - spanY * s) / 2
    const all: Pt[] = view.map((r) => ({ r, x: ox + (r.longitude! - x0) * k * s, y: oy + (y1 - r.latitude!) * s }))
    const inside = all.filter((p) => p.x > 12 && p.x < size.w - 12 && p.y > (legend ? 56 : topInset - 24) && p.y < size.h - 12)
    // greedy clustering: a place joins the first group whose centre is closer than CELL
    const groups: { x: number; y: number; ps: Pt[] }[] = []
    for (const p of inside) {
      const g = groups.find((c) => Math.abs(c.x - p.x) < CELL && Math.abs(c.y - p.y) < CELL)
      if (g) { g.ps.push(p); g.x += (p.x - g.x) / g.ps.length; g.y += (p.y - g.y) / g.ps.length } else groups.push({ x: p.x, y: p.y, ps: [p] })
    }
    const single: Pt[] = [], many: Pt[][] = []
    for (const g of groups) { if (g.ps.length === 1) single.push(g.ps[0]); else many.push(g.ps) }
    outside = view.length - inside.length
    return { pts: single, clusters: many, outside }
  }, [geo, zoom, size, topInset, legend])

  const seg = useMemo(() => {
    const ch = [...pts, ...clusters.flat()].filter((p) => selected.has(p.r.poi_key))
    return ch.length >= 3 ? hull(ch) : []
  }, [pts, clusters, selected])

  return (
    <div ref={box} className="absolute inset-0">
      <svg width={size.w} height={size.h} className="absolute inset-0" aria-hidden>
        {seg.length ? <polygon points={seg.map((p) => `${p.x},${p.y}`).join(' ')} fill={COLOR.wa} fillOpacity={0.12} stroke={COLOR.wa} strokeWidth={2} strokeLinejoin="round" /> : null}
      </svg>
      {clusters.map((c) => {
        const x = c.reduce((a, p) => a + p.x, 0) / c.length, y = c.reduce((a, p) => a + p.y, 0) / c.length
        const big = c.length >= 100
        return (
          <button key={c[0].r.poi_key} type="button" aria-label={`${c.length} جهة هنا — قرّب`} onClick={() => setZoom(c.map((p) => p.r.poi_key))}
            className={`absolute flex ${big ? 'size-12 text-[14px]' : 'size-11 text-[16px]'} -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-[var(--color-text-on-inverse)] bg-[var(--color-bg-inverse)] font-[family-name:var(--font-display)] leading-[24px] font-semibold text-[var(--color-text-on-inverse)] ${FOCUS_RING}`}
            style={{ left: x, top: y }}>{c.length > 999 ? '999+' : c.length}</button>
        )
      })}
      {pts.map(({ r, x, y }) => {
        const on = selected.has(r.poi_key)
        return (
          <button key={r.poi_key} type="button" aria-pressed={on} aria-label={r.name_ar || r.name_en || 'جهة'} title={r.name_ar || r.name_en || ''} onClick={() => onToggle(r)}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full ${on ? 'size-7 border-[3px]' : 'size-5 border-2'} border-[var(--color-text-on-inverse)] ${FOCUS_RING}`}
            style={{ left: x, top: y, background: colorOf(r) }} />
        )
      })}
      {legend ? <div className="absolute start-auto end-4 top-4 flex items-center gap-3 rounded-full bg-[var(--white-a16)] px-3 py-2 text-[12px] leading-[18px] font-medium text-[var(--color-text-on-inverse)]">
        {[['واتساب', COLOR.wa], ['إيميل', COLOR.email], ['لا يمكن', COLOR.none]].map(([l, c]) => (
          <span key={l} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c }} />{l}</span>
        ))}
      </div> : null}
      {zoom ? (
        <button type="button" onClick={() => setZoom(null)} style={{ top: legend ? 16 : topInset - 40 }} className={`absolute start-4 rounded-full bg-[var(--color-bg-surface)] px-3 py-1.5 text-[12px] leading-[18px] font-medium ${FOCUS_RING}`}>عرض الكل</button>
      ) : null}
      {!rows.length ? <p className="absolute inset-0 flex items-center justify-center text-[14px] leading-[22px] text-[var(--color-text-on-inverse-secondary)]">الخريطة تظهر بعد البحث</p> : geo.length < rows.length || outside > 0 ? (
        <p className="absolute bottom-3 end-4 text-[12px] leading-[18px] text-[var(--color-text-on-inverse-secondary)]">
          {[geo.length < rows.length ? `${(rows.length - geo.length).toLocaleString('en-US')} بدون موقع` : null, outside > 0 ? `${outside.toLocaleString('en-US')} خارج الإطار` : null].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
