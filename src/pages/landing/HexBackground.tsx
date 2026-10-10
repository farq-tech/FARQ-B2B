import { useEffect, useRef } from 'react'

/*
 * Landing background (owner brief 2026-10-10): a fine hexagon grid from the Farq mark, a few connection points
 * travelling slowly along its edges, a limited turquoise glow, and a light scroll parallax on desktop only.
 * One fixed canvas behind the page: the grid is drawn once per resize into an offscreen canvas; each frame only
 * moves the points (≈30 fps). Stops while the tab is hidden; prefers-reduced-motion = the still grid, no points.
 */

const R = 30                     // hexagon radius (px)
const W = Math.sqrt(3) * R       // pointy-top hex width
const POINTS = 16

type Pt = { x: number; y: number }
type Walker = { a: Pt; b: Pt; t: number; speed: number }

function vertices(cols: number, rows: number) {
  // pointy-top lattice: every hex centre, and its six corners
  const vs: Pt[] = []
  const key = (p: Pt) => `${Math.round(p.x)}:${Math.round(p.y)}`
  const seen = new Set<string>()
  for (let r = -1; r <= rows; r++) for (let c = -1; c <= cols; c++) {
    const cx = c * W + (r & 1 ? W / 2 : 0), cy = r * R * 1.5
    for (let k = 0; k < 6; k++) {
      const ang = (Math.PI / 3) * k - Math.PI / 6
      const p = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }
      const kk = key(p)
      if (!seen.has(kk)) { seen.add(kk); vs.push(p) }
    }
  }
  return vs
}

export default function HexBackground() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const css = getComputedStyle(cv)
    const line = css.getPropertyValue('--ld-hex-line').trim()
    const node = css.getPropertyValue('--ld-hex-node').trim()
    const glow = css.getPropertyValue('--ld-accent-a24').trim()
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const desktop = matchMedia('(min-width: 1024px)').matches
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let grid: HTMLCanvasElement | null = null, verts: Pt[] = [], walkers: Walker[] = []
    let w = 0, h = 0, raf = 0, last = 0

    const neighbours = (p: Pt) => verts.filter((q) => { const d = Math.hypot(q.x - p.x, q.y - p.y); return d > R * 0.9 && d < R * 1.1 })
    const newWalker = (): Walker => {
      const a = verts[Math.floor(Math.random() * verts.length)]
      const ns = neighbours(a)
      return { a, b: ns[Math.floor(Math.random() * ns.length)] || a, t: Math.random(), speed: 0.25 + Math.random() * 0.25 }
    }
    const build = () => {
      w = window.innerWidth; h = window.innerHeight
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr)
      cv.style.width = `${w}px`; cv.style.height = `${h}px`
      const cols = Math.ceil(w / W) + 2, rows = Math.ceil((h + R * 3) / (R * 1.5)) + 2
      grid = document.createElement('canvas')
      grid.width = cv.width; grid.height = Math.round((h + R * 3) * dpr)
      const g = grid.getContext('2d')!
      g.scale(dpr, dpr); g.strokeStyle = line; g.lineWidth = 1
      for (let r = -1; r <= rows; r++) for (let c = -1; c <= cols; c++) {
        const cx = c * W + (r & 1 ? W / 2 : 0), cy = r * R * 1.5
        g.beginPath()
        for (let k = 0; k <= 6; k++) { const ang = (Math.PI / 3) * k - Math.PI / 6; const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang); if (k) g.lineTo(x, y); else g.moveTo(x, y) }
        g.stroke()
      }
      verts = vertices(cols, rows).filter((p) => p.x > 0 && p.x < w && p.y > 0 && p.y < h)
      walkers = reduce ? [] : Array.from({ length: POINTS }, newWalker)
    }
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 33) return
      const dt = Math.min(0.1, (now - last) / 1000); last = now
      // parallax: the grid drifts at a fraction of the scroll (desktop only), wrapped to one hexagon period
      const off = desktop && !reduce ? (window.scrollY * 0.12) % (R * 3) : 0
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, cv.width, cv.height)
      if (grid) ctx.drawImage(grid, 0, -off * dpr)
      ctx.scale(dpr, dpr)
      for (const k of walkers) {
        k.t += dt * k.speed
        if (k.t >= 1) { const ns = neighbours(k.b); k.a = k.b; k.b = ns[Math.floor(Math.random() * ns.length)] || k.a; k.t = 0 }
        const x = k.a.x + (k.b.x - k.a.x) * k.t, y = k.a.y + (k.b.y - k.a.y) * k.t - off
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = node; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill()
      }
    }
    const still = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); if (grid) ctx.drawImage(grid, 0, 0) }
    const start = () => { cancelAnimationFrame(raf); if (reduce) still(); else { last = performance.now(); raf = requestAnimationFrame(draw) } }
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else start() }
    let t: number | undefined
    const onResize = () => { window.clearTimeout(t); t = window.setTimeout(() => { build(); start() }, 150) }
    build(); start()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('resize', onResize) }
  }, [])
  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-0" />
}
