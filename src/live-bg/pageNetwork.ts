import { webMesh, drawWebExpansion } from './webMesh'
/*
 * «الشبكة الحية» for the landing page — a port of docs/reference/landing-live-network.html (owner, 2026-10-08):
 * the whole page is ONE network with ONE head office and ONE round. A screen-sized fixed canvas (above the section
 * backgrounds, below their content) draws the part of the page-sized world that is on screen (translate by scrollY).
 *
 * Differences from the reference, on purpose:
 *  - colours come from the tokens (--live-go / --live-back, surface and ink), sprites are the WebP set in sprites.ts;
 *  - what to avoid is read from the page itself (readObstacles: text, controls, cards), not from a CSS selector list;
 *  - the next round is planned ahead in idle time (requestIdleCallback, setTimeout fallback), never inside a frame;
 *  - no debug UI. Owner rules: head office in the top half of the first screen (≥ 38 px from content, centre first);
 *    requests only go down, each in its own column (±0.8 column); a request shorter than 55 % of the median sits out;
 *    pace ~150 px/s with suppliers within ~2 screens of the head office (SPEED / DEPTH below).
 */
import { CHANNELS, CYCLE, POSES, url, type Pose } from './sprites'
import { AHMAD, bucket8, run3, stand3, sheet3, type Dir8 } from './ahmad3d'
import { readObstacles } from './engine'

type RGB = [number, number, number]
type Vert = { x: number; y: number; r: number; c: number }
type Edge = { a: number; b: number; L: number }
type Walker = {
  k: number; ch: number; runner: boolean; rest: boolean; target: number; pts: number[][]; fd: number[]; cum: number[]; len: number
  start: number; arrive: number; tc: number; home: number; done: number; price: number; near?: boolean
}
type Round = { walkers: Walker[]; allHome: number; best: number; end: number; ahmadHome: boolean }
export type PageStats = { frames: number; avg: number; p95: number; p99: number; max: number; rounds: number; sync: number }

const FONT = '"ITF Huwiya Arabic", Tajawal, "Readex Pro", system-ui, sans-serif'
const FONT_NUM = '"Readex Pro", Tajawal, system-ui, sans-serif'
const TAU = 6.283
const fmt = (n: number) => n.toLocaleString('en-US') + ' ر.س'
const col = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
function readColor(value: string): RGB {
  const p = document.createElement('i'); p.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden'; p.style.color = value
  document.body.appendChild(p); const m = getComputedStyle(p).color.match(/[\d.]+/g) || ['0', '0', '0']; p.remove()
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}
function mulberry(seed: number) {
  let a = seed
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function heapPush(h: Array<[number, number]>, x: [number, number]) { h.push(x); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p } }
function heapPop(h: Array<[number, number]>) {
  const top = h[0], last = h.pop()!
  if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m } }
  return top
}
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]] } return a }

// sprites: decoded off the main thread before the loop starts
const IMGS = new Map<string, HTMLImageElement>()
function img(stem: string, scale: 1 | 2) {
  const key = `${stem}@${scale}`; let im = IMGS.get(key)
  if (!im) { im = new Image(); im.decoding = 'async'; im.src = url(stem, scale); IMGS.set(key, im) }
  return im
}
const ready = (im: HTMLImageElement) => im.complete && im.naturalWidth > 0
// Pace (owner, 2026-10-08): a request must read as «a request walking to a supplier», not a streak. ~150 px/s,
// suppliers within ~2 screens below the head office, peak speed 1.3× the average (not 2×), calmer return.
const SPEED = 150, DEPTH = 1800
/*
 * Ahmad's gait, measured on the run-cycle sheet (ahmad-cycle, 6 frames): the planted foot travels back 17 px per frame
 * inside the drawing, so he must advance 17 px per frame for the foot to stay put (it was 13: a 4 px backward slide every
 * frame). The flight frames (2, 5) already lift him 1.5 px, so the side run gets no extra bob. Frames follow an odometer
 * (distance actually covered), so the return trip plays the cycle forwards, not in reverse.
 */
const STRIDE = 17, CONTACT = new Set([0, 1, 3, 4])
// What each messenger is, in words — the first thing a visitor must read (owner, 2026-10-08)
const CH_LABEL: Record<string, string> = { whatsapp: 'واتساب · طلب عرض سعر', haraj: 'حراج · طلب عرض سعر', sms: 'رسالة نصية · طلب سعر', call: 'مكالمة · نسأل عن السعر', mail: 'إيميل · طلب عرض سعر' }
const AHMAD_LABEL = 'أحمد · يدور بنفسه'
/** Trapezoid speed profile on [0,1]: accelerate over `ra`, cruise, slow down over `rd`. Returns [position, speed/cruise]. */
function trap(x: number, ra: number, rd: number): [number, number] {
  x = Math.max(0, Math.min(1, x)); ra = Math.min(ra, 0.45); rd = Math.min(rd, 0.45)
  const v = 1 / (1 - ra / 2 - rd / 2)
  if (x < ra) return [(v * x * x) / (2 * ra), x / ra]
  if (x > 1 - rd) return [1 - (v * (1 - x) ** 2) / (2 * rd), (1 - x) / rd]
  return [v * (ra / 2 + (x - ra)), 1]
}
const calm = (x: number) => 0.7 * x + 0.3 * (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)

export class PageNetwork {
  private ctx: CanvasRenderingContext2D
  private W = 0; private H = 0; private VW = 0; private VH = 0; private DPR = 1; private scale: 1 | 2 = 1; private SY = 0
  private V: Vert[] = []; private E: Edge[] = []; private adj: number[][] = []; private PH: number[] = []; private VD: number[] = []
  private VF: number[] = []; private BLK: boolean[] = []; private UI: number[][] = []; private HUB = 0
  private pings: Array<{ i: number; t0: number }> = []
  private S!: Round; private next: Round | null = null; private LAST: Record<number, number> = {}
  private RS = { ang: 0, bucket: 'E', prev: null as string | null, want: null as string | null, fade: 1, lastT: 0, lastState: null as string | null, tilt: 0, odo: 0, lastD: -1, frame: -1, v: 0 }
  private go: RGB = [107, 142, 61]; private back: RGB = [198, 174, 130]; private surface: RGB = [255, 255, 255]; private ink: RGB = [0, 0, 0]; private ink2: RGB = [0, 0, 0]
  private raf = 0; private simT = 0; private last = 0; private alive = true; private reduced: boolean
  private mouse = { x: 0, y: 0, on: false }
  private times = new Float32Array(8192); private nTimes = 0; private rounds = 0; private sync = 0
  private cleanup: Array<() => void> = []
  private played = 0 // rounds that ran to the end: only the very first one is the short «see it whole» round
  private buckets = new Map<number, number[]>()
  private meshEdges: Edge[] = []
  private meshVertices: Array<{ x: number; y: number; d: number; side?: number }> = []
  private meshCanvas = document.createElement('canvas')
  private meshScroll = NaN
  private widths = new Map<string, number>()
  /** measureText once per (font, text): the chips repeat every frame */
  private tw(font: string, text: string) { const k = font + '|' + text; let w = this.widths.get(k); if (w === undefined) { this.ctx.font = font; w = this.ctx.measureText(text).width; this.widths.set(k, w) } return w }
  private F: Array<{ w: Walker; dOut: number; dBack: number | null }> = []; private FE = 1

  /** story: false = the grid and its search waves only (no head office, no routes) — the landing hero tells the story in its own scene */
  constructor(private canvas: HTMLCanvasElement, private scope: Element, private story = true) {
    this.ctx = canvas.getContext('2d')!
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)'); this.reduced = mq.matches
    const onMq = () => { this.reduced = mq.matches; this.run() }; mq.addEventListener('change', onMq)
    const run = () => this.run(); document.addEventListener('visibilitychange', run)
    const onScroll = () => { if (this.reduced) this.drawStatic() }; window.addEventListener('scroll', onScroll, { passive: true })
    const onMove = (e: PointerEvent) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY + window.scrollY; this.mouse.on = e.pointerType === 'mouse' }
    const onLeave = () => { this.mouse.on = false }
    window.addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerleave', onLeave)
    // rebuild only when the page size changes (the head office stays put while scrolling)
    let rt = 0, lastW = 0, lastH = 0
    const ro = new ResizeObserver(() => {
      const w = document.documentElement.clientWidth, h = document.documentElement.scrollHeight
      if (w === lastW && Math.abs(h - lastH) < 40) return
      lastW = w; lastH = h; clearTimeout(rt); rt = window.setTimeout(() => this.reset(), 150)
    })
    ro.observe(document.body)
    this.cleanup.push(() => { mq.removeEventListener('change', onMq); document.removeEventListener('visibilitychange', run); window.removeEventListener('scroll', onScroll); window.removeEventListener('pointermove', onMove); document.removeEventListener('pointerleave', onLeave); ro.disconnect(); clearTimeout(rt) })
    lastW = document.documentElement.clientWidth; lastH = document.documentElement.scrollHeight
    this.reset()
    void document.fonts?.ready.then(() => { if (this.alive) this.reset() })
  }

  destroy() { this.alive = false; cancelAnimationFrame(this.raf); this.cleanup.forEach((f) => f()) }
  stats(): PageStats {
    const n = Math.min(this.nTimes, this.times.length), a = Array.from(this.times.subarray(0, n)).sort((x, y) => x - y)
    const q = (f: number) => (n ? a[Math.min(n - 1, Math.floor(n * f))] : 0)
    return { frames: this.nTimes, avg: n ? a.reduce((s, x) => s + x, 0) / n : 0, p95: q(0.95), p99: q(0.99), max: n ? a[n - 1] : 0, rounds: this.rounds, sync: this.sync }
  }

  private inUI(x: number, y: number, m = 0) { return this.UI.some((b) => x > b[0] - m && x < b[2] + m && y > b[1] - m && y < b[3] + m) }
  private dist(x: number, y: number) { let m = 1e9; for (const b of this.UI) { const dx = Math.max(b[0] - x, 0, x - b[2]), dy = Math.max(b[1] - y, 0, y - b[3]); m = Math.min(m, Math.hypot(dx, dy)) } return m }
  private freeBox(X: number, Y: number, w: number, h: number) { return !this.UI.some((b) => X < b[2] + 6 && X + w > b[0] - 6 && Y < b[3] + 6 && Y + h > b[1] - 6) }

  private reset() {
    if (!this.alive) return
    this.build()
    this.next = null
    if (!this.reduced && this.story) this.commit(this.plan(this.played === 0), this.simT)
    this.run()
  }

  private build() {
    const de = document.documentElement
    this.VW = window.innerWidth; this.VH = window.innerHeight; this.W = de.clientWidth; this.H = de.scrollHeight
    this.DPR = Math.min(2, window.devicePixelRatio || 1); this.scale = this.DPR > 1 ? 2 : 1
    this.canvas.width = Math.round(this.VW * this.DPR); this.canvas.height = Math.round(this.VH * this.DPR)
    if (AHMAD === '3d') void sheet3().decode?.().catch(() => {}) // decoded before he first appears
    this.go = readColor('var(--live-go)'); this.back = readColor('var(--live-back)')
    this.surface = readColor('var(--color-bg-surface)'); this.ink = readColor('var(--color-text-primary)'); this.ink2 = readColor('var(--color-text-secondary)')
    this.UI = readObstacles(this.canvas.parentElement as HTMLElement, this.scope, true).boxes
    const { W, H, VH } = this
    const cell = W < 640 ? 44 : 54, rnd = mulberry(11), jit = 0.12
    const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1, cw = W / (cols - 1), ch = H / (rows - 1)
    const V: Vert[] = [], id = (r: number, c: number) => r * cols + c
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) V.push({ x: c * cw + (c > 0 && c < cols - 1 ? (rnd() * 2 - 1) * jit * cw : 0), y: r * ch + (r > 0 && r < rows - 1 ? (rnd() * 2 - 1) * jit * ch : 0), r, c })
    const key = new Set<string>(), tris: number[][] = []
    let E: Edge[] = []
    const add = (a: number, b: number) => { const k = a < b ? a + '_' + b : b + '_' + a; if (key.has(k)) return; key.add(k); E.push({ a, b, L: Math.hypot(V[a].x - V[b].x, V[a].y - V[b].y) }) }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = id(r, c), b = id(r, c + 1), d = id(r + 1, c + 1), e = id(r + 1, c)
      for (const q of rnd() < 0.5 ? [[a, b, d], [a, d, e]] : [[a, b, e], [b, d, e]]) { tris.push(q); add(q[0], q[1]); add(q[1], q[2]); add(q[2], q[0]) }
    }
    this.V = V
    // ONE head office: the top half of the first screen only, ≥ 38 px from any content, open space and the middle first
    let best = -1, bs = -1e9
    V.forEach((v, i) => {
      if (v.x < 70 || v.x > W - 70 || v.y < 70 || v.y > VH * 0.5) return
      const c = Math.min(this.dist(v.x, v.y), 110); if (c < 38) return
      const s = c - Math.abs(v.x - W / 2) * 0.12 - v.y * 0.12
      if (s > bs) { bs = s; best = i }
    })
    let hub = best
    if (hub < 0) { let bd = 1e18; V.forEach((v, i) => { const d = (v.x - W / 2) ** 2 + (v.y - Math.min(VH * 0.2, 160)) ** 2; if (d < bd) { bd = d; hub = i } }) }
    // open the mesh around the hub so paths leave in every direction
    {
      const ring = new Set<number>(); for (const q of tris) if (q.includes(hub)) for (const v of q) if (v !== hub) ring.add(v)
      const border = (v: number) => V[v].c === 0 || V[v].r === 0 || V[v].c === cols - 1 || V[v].r === rows - 1
      const gone = new Set([...ring].filter((v) => !border(v)))
      const region = tris.filter((q) => q.includes(hub) || q.some((v) => gone.has(v)))
      const cnt = new Map<string, number>()
      for (const q of region) for (const [x, y] of [[q[0], q[1]], [q[1], q[2]], [q[2], q[0]]]) { if (x === hub || y === hub || gone.has(x) || gone.has(y)) continue; const k = x < y ? x + '_' + y : y + '_' + x; cnt.set(k, (cnt.get(k) || 0) + 1) }
      const rs = new Set(region), keep = tris.filter((q) => !rs.has(q)), fan: number[][] = []
      for (const [k, c] of cnt) if (c === 1) { const [x, y] = k.split('_').map(Number); fan.push([hub, x, y]) }
      tris.length = 0; tris.push(...keep, ...fan); key.clear(); E = []; for (const q of tris) { add(q[0], q[1]); add(q[1], q[2]); add(q[2], q[0]) }
      this.HUB = hub
    }
    this.E = E; this.adj = V.map(() => []); E.forEach((e, i) => { this.adj[e.a].push(i); this.adj[e.b].push(i) })
    this.PH = V.map(() => Math.random() * TAU)
    const dd = V.map((v) => this.dist(v.x, v.y))
    this.VF = dd.map((d) => (d <= 4 ? 0 : Math.min(1, (d - 4) / 40))); this.BLK = dd.map((d) => d < 22)
    // Spacious webs grow inward from the two margins. Keep the request-routing graph independent.
    this.meshVertices = V.map((v) => ({ ...v, d: 0 }))
    let mesh = E
    if (!this.story) {
      const { points, edges } = webMesh(W, H, VH)
      this.meshVertices = points; mesh = edges
    }
    // Test the entire edge once, so neither the grid nor its pulses pass behind content.
    this.meshEdges = mesh.filter((e) => {
      const a = this.meshVertices[e.a], b = this.meshVertices[e.b], steps = Math.ceil(e.L / 6)
      for (let i = 0; i <= steps; i++) if (this.inUI(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 22)) return false
      return true
    })
    this.meshCanvas.width = this.canvas.width; this.meshCanvas.height = this.canvas.height
    this.meshScroll = NaN
    const C = V[this.HUB]; this.VD = V.map((v) => Math.hypot(v.x - C.x, v.y - C.y)); this.pings = []
    // shape the Arabic labels once, outside any frame
    const c = this.ctx; c.save()
    for (const f of [`700 11px ${FONT}`, `500 11px ${FONT}`, `500 12px ${FONT}`, `700 14px ${FONT_NUM}`]) { c.font = f; c.direction = 'rtl'; c.measureText('طلب عرض سعر مقر الشركة أرخص سعر مورد 0123456789 ر.س ✓…') }
    c.restore()
  }

  // ---------- one round: head office → one request per channel + Ahmad, each down its own column → prices back ----------
  private routeV(from: number, to: number, blocked: (v: number) => boolean) {
    const { V, E, adj, BLK } = this
    const d = new Float64Array(V.length).fill(Infinity), pv = new Int32Array(V.length).fill(-1), h: Array<[number, number]> = []
    d[from] = 0; heapPush(h, [0, from])
    while (h.length) {
      const [x, u] = heapPop(h); if (x > d[u]) continue; if (u === to) break
      for (const ei of adj[u]) {
        const e = E[ei], v = e.a === u ? e.b : e.a; if (v !== to && blocked(v)) continue
        // going up is expensive, so is passing behind content (×3.5)
        const nx = x + e.L * (0.75 + Math.random() * 1.1) * (BLK[v] ? 3.5 : 1) + Math.max(0, V[u].y - V[v].y) * 6
        if (nx < d[v]) { d[v] = nx; pv[v] = u; heapPush(h, [nx, v]) }
      }
    }
    if (!isFinite(d[to])) return null
    const path: number[] = []; let v = to; while (v !== from) { path.unshift(v); v = pv[v] } return path
  }

  /** Smooth route from the head office along `plan`: a cubic launch down to the first point ≥ 90 px away, then Chaikin ×3. */
  private shape(plan: number[], launch = true) {
    const { V } = this, C = V[this.HUB]
    if (!launch) return this.smooth([[C.x, C.y], ...plan.map((i) => [V[i].x, V[i].y])])
    const rest = plan.slice(); while (rest.length > 3 && V[rest[0]].y < C.y + 90) rest.shift()
    const P = V[rest[0]], N = V[rest[1]] || P, tl = Math.hypot(N.x - P.x, N.y - P.y) || 1, tx = (N.x - P.x) / tl, ty = (N.y - P.y) / tl, dy = Math.max(40, P.y - C.y)
    let pts: number[][] = []
    const c1 = [C.x + (P.x - C.x) * 0.08, C.y + dy * 0.55], c2 = [P.x - tx * dy * 0.45, P.y - ty * dy * 0.45]
    for (let i = 0; i <= 18; i++) { const u = i / 18, a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3; pts.push([a * C.x + b * c1[0] + c * c2[0] + d * P.x, a * C.y + b * c1[1] + c * c2[1] + d * P.y]) }
    for (const i of rest.slice(1)) pts.push([V[i].x, V[i].y])
    return this.smooth(pts)
  }
  /** Chaikin ×3, cumulative length, and the line strength along the route (soft behind content, never cut). */
  private smooth(pts: number[][]) {
    for (let it = 0; it < 3; it++) { const q = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]) } q.push(pts[pts.length - 1]); pts = q }
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    // line strength along the route: soft behind content (0.12), full in open space — never cut
    const fd = pts.map(([x, y]) => Math.round((0.12 + 0.88 * Math.max(0, Math.min(1, (this.dist(x, y) - 2) / 30))) * (y > this.VH ? 0.55 : 1) * 6) / 6) // fainter below the first screen
    return { pts, fd, cum }
  }

  /** Plans a round with times relative to its start (0). Runs in idle time for the next round. */
  private plan(first = false, tries = 0): Round {
    const { V, E, adj, W, VW, VH } = this, S_client = this.HUB
    const base = 3000 + Math.random() * 9000, C = V[S_client]
    const NB = (ei: number) => { const e = E[ei]; return e.a === S_client ? e.b : e.a }, ANG = (ei: number) => Math.atan2(V[NB(ei)].y - C.y, V[NB(ei)].x - C.x)
    const all = [...adj[S_client]].filter((ei) => { const a = ANG(ei); return a > -0.5 && a < Math.PI + 0.5 }).sort((a, b) => ANG(a) - ANG(b)), M = Math.min(6, all.length)
    const out = [...new Set(Array.from({ length: M }, (_, k) => all[Math.round((k * (all.length - 1)) / Math.max(1, M - 1))]))]
    const CW = W / out.length, jit = (Math.random() - 0.5) * CW * 0.3 // each request owns one column below the head office
    const RK = (Math.random() * out.length) | 0, RMAX = Math.max(360, Math.min(VH * 0.9, 760)) // Ahmad: a shorter track
    // the first round after the page opens is short, and the two columns nearest the head office keep their supplier on
    // the first screen — a visitor sees a whole trip (out, price, back) without scrolling
    const depth = first ? Math.min(DEPTH, VH * 1.4) : DEPTH
    const cx = (k: number) => W - k * CW + jit - CW / 2
    const near = new Set(out.map((_, k) => k).filter((k) => k !== RK).sort((a, b) => Math.abs(cx(a) - C.x) - Math.abs(cx(b) - C.x)).slice(0, 2))
    // launch order: from the head office outwards, half a second apart, so every label can be read
    const launch = out.map((_, k) => k).sort((a, b) => Math.abs(cx(a) - C.x) - Math.abs(cx(b) - C.x))
    const owner = new Int16Array(V.length).fill(-1); owner[S_client] = 999
    const walkers: Walker[] = []
    out.forEach((ei, k) => { owner[NB(ei)] = k })
    out.forEach((ei, k) => {
      const nb = NB(ei), x1 = W - k * CW + jit, x0 = x1 - CW // first edges sorted right→left, so columns run right→left
      const cand: Array<[number, number]> = [], onFirst = near.has(k)
      for (let pass = 0; pass < 2 && !cand.length; pass++) for (let i = 0; i < V.length; i++) {
        if (owner[i] >= 0) continue; const v = V[i]
        if (pass === 0 && onFirst && (v.y > VH - 90 || v.y < C.y + 140)) continue // a supplier the visitor can see
        if (v.y < C.y + 70 || v.y > C.y + depth || v.x < x0 - CW * 0.35 || v.x > x1 + CW * 0.35 || this.inUI(v.x, v.y, 30)) continue // suppliers below, in open space
        if (k === RK && Math.hypot(v.x - C.x, v.y - C.y) > RMAX) continue
        cand.push([v.y, i]) // the deepest points of the column: every trip is about as long
      }
      cand.sort((x, y) => y[0] - x[0])
      let plan = [nb], target = nb
      const far = cand.filter((c) => c[0] >= (cand[0]?.[0] ?? 0) * 0.82 && c[1] !== this.LAST[k])
      for (const [, i] of [...shuffle(far), ...cand].slice(0, 24)) {
        if (i === nb) continue
        const r = this.routeV(nb, i, (v) => owner[v] >= 0 || (V[v].y > C.y + 120 && (V[v].x < x0 - CW * 0.8 || V[v].x > x1 + CW * 0.8))) // own lane only
        if (r) { plan = [nb, ...r]; target = i; break }
      }
      this.LAST[k] = target; plan.forEach((v) => (owner[v] = k))
      const { pts, fd, cum } = this.shape(plan)
      const start = launch.indexOf(k) * 0.5 + Math.random() * 0.1
      walkers.push({ near: onFirst, k, ch: 0, runner: false, rest: false, target, pts, fd, cum, len: cum[cum.length - 1], start, arrive: start, tc: 0, home: 0, done: 0, price: Math.round((base * (0.82 + Math.random() * 0.36)) / 10) * 10 })
    })
    { // a request that couldn't get through this round sits it out: trips stay about equal
      const ls = walkers.filter((w) => w.k !== RK).map((w) => w.len).sort((a, b) => a - b), med = ls[ls.length >> 1] || 0
      for (let i = walkers.length - 1; i >= 0; i--) if (walkers[i].k !== RK && !walkers[i].near && walkers[i].len < med * 0.55) walkers.splice(i, 1)
    }
    { // one shared outbound time D = clamp(longest ÷ 320, 6, 9) s (±4 %), return 0.62·D
      const maxL = Math.max(...walkers.map((w) => w.len)), D = first ? Math.max(7, Math.min(10, maxL / SPEED)) : Math.max(8, Math.min(14, maxL / SPEED)), Rt = Math.max(first ? 5 : 6, D * 0.8)
      for (const w of walkers) { w.arrive = w.start + D * (0.96 + Math.random() * 0.08); w.tc = w.arrive + 0.6 + Math.random() * 0.3; w.home = w.tc + Rt * (0.96 + Math.random() * 0.08); w.done = w.home }
    }
    const clear = (w: Walker) => { if (V[w.target].y <= 90) return false; for (let d = 40; d <= w.len; d += 8) { const [x, y] = this.at(w, d); if (this.inUI(x, y, 22) || this.inUI(x, y - 42, 10) || this.inUI(x, y - 80, 6)) return false } return true } // feet, body and head (82 px) all clear
    let pick = walkers.filter((w) => w.k === RK && w.len > Math.min(VW, VH) * 0.3 && clear(w))
    if (!pick.length && tries < 8) return this.plan(first, tries + 1)
    if (!pick.length) pick = walkers.filter((w) => w.len < RMAX * 1.6 && clear(w))
    let r: Walker | null = pick[(Math.random() * pick.length) | 0] ?? null, ahmadHome = false
    // no clean track: he waits next to the head office (present) — never runs behind text
    if (!r || r.len < 200 || !clear(r)) {
      // no clean track down his column: his own way through the free space of the first screen (any direction),
      // never behind text; only if there is none, he waits next to the head office
      const blockV = (v: number) => (owner[v] >= 0 && owner[v] !== RK) || this.inUI(V[v].x, V[v].y, 24)
      const cand: Array<[number, number]> = []
      for (let pass = 0; pass < 2 && cand.length < 4; pass++) for (let i = 0; i < V.length; i++) { const v = V[i]; if (blockV(i) || this.inUI(v.x, v.y, 40) || v.y <= 90 || v.y > (pass ? VH * 1.5 : VH - 90)) continue; /* first screen first, then down to 1.5 screens */ const d = Math.hypot(v.x - C.x, v.y - C.y); if (d >= Math.min(260, W * 0.55) && d <= RMAX) cand.push([d, i]) } // a phone is narrow: a shorter clean run still counts
      cand.sort((a, b) => b[0] - a[0])
      let alt: Walker | null = null
      for (const [, i] of cand.slice(0, 16)) {
        const route = this.routeV(S_client, i, blockV); if (!route) continue
        const { pts, fd, cum } = this.shape(route, false), len = cum[cum.length - 1]
        const w: Walker = { k: RK, ch: 0, runner: false, rest: false, target: i, pts, fd, cum, len, start: launch.indexOf(RK) * 0.5, arrive: 0, tc: 0, home: 0, done: 0, price: Math.round((base * (0.82 + Math.random() * 0.36)) / 10) * 10 }
        if (len >= 200 && clear(w)) { alt = w; break }
      }
      const i0 = walkers.findIndex((w) => w.k === RK); if (i0 >= 0) walkers.splice(i0, 1)
      if (alt) { walkers.push(alt); r = alt } else { r = null; ahmadHome = true }
    }
    if (r) { r.runner = true; r.rest = false; r.arrive = r.start + Math.max(4, r.len / 115); r.tc = r.arrive + 2.2; r.home = r.tc + Math.max(4, r.len / 110); r.done = r.home + 1.2 }
    const order = shuffle(CHANNELS.map((_, i) => i)); let j = 0
    for (const w of walkers) if (!w.runner) w.ch = order[j++ % order.length]
    const allHome = Math.max(...walkers.map((w) => w.done || w.home))
    return { walkers, allHome, best: Math.min(...walkers.map((w) => w.price)), end: allHome + 2.4, ahmadHome }
  }
  private commit(R: Round, t: number) {
    for (const w of R.walkers) { w.start += t; w.arrive += t; w.tc += t; w.home += t; w.done += t }
    R.allHome += t; R.end += t; this.S = R; this.rounds++
    // the round after this one, planned while this one plays
    const job = () => { if (this.alive && !this.next) this.next = this.plan() }
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 300)); idle(job, { timeout: 4000 })
  }
  /** Ahmad's position on his trip: 2–3 steps to get going (0.5 s), cruise, ease into the supplier (0.6 s). */
  private outD(w: Walker, t: number): [number, number] { const D = w.arrive - w.start, [p, v] = trap((t - w.start) / D, 0.5 / D, 0.6 / D); return [w.len * p, v] }
  /** Back home: quick start, then a long slow-down (1.2 s) — he comes in walking, out of breath. */
  private backD(w: Walker, t: number): [number, number] { const R = w.home - w.tc, [p, v] = trap((t - w.tc) / R, 0.4 / R, 1.2 / R); return [w.len * (1 - p), v] }
  private at(w: Walker, d: number): [number, number] {
    d = Math.max(0, Math.min(w.len, d)); let lo = 1, hi = w.cum.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (w.cum[m] < d) lo = m + 1; else hi = m }
    const a = w.pts[lo - 1], b = w.pts[lo], f = (d - w.cum[lo - 1]) / (w.cum[lo] - w.cum[lo - 1] || 1)
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
  }

  // ---------- drawing ----------
  private mesh(t: number, live: boolean) {
    const { ctx, meshVertices: V, meshEdges, SY, VH, DPR } = this
    if (this.meshScroll !== SY) {
      const c = this.meshCanvas.getContext('2d')!
      c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, this.VW, VH)
      c.translate(0, -SY); c.lineWidth = 0.9; c.strokeStyle = col(this.go, 0.12); c.beginPath()
      for (const e of meshEdges) {
        const a = V[e.a], b = V[e.b]
        if (Math.max(a.y, b.y) < SY || Math.min(a.y, b.y) > SY + VH) continue
        c.moveTo(a.x, a.y); c.lineTo(b.x, b.y)
      }
      c.stroke(); this.meshScroll = SY
    }
    ctx.drawImage(this.meshCanvas, 0, SY, this.VW, VH)
    if (!live) return
    drawWebExpansion(ctx, V, meshEdges, t, col(this.go, 0.35), col(this.back, 0.4), SY, SY + VH)

  }
  private dots(t: number, live: boolean) {
    const { ctx, V, VF, VD, PH, mouse } = this, SP = 320, PER = 3 * SP, mx = mouse.on ? mouse.x : -1e4, my = mouse.y, y0 = this.SY - 12, y1 = this.SY + this.VH + 12
    for (let i = 0; i < V.length; i++) {
      const v = V[i]; if (v.y < y0 || v.y > y1 || VF[i] <= 0) continue
      const below = v.y > this.VH ? 0.5 : 1 // the story lives on the first screen; below it the grid just breathes
      let a = 0.18 * below, r = 1.3
      if (live) { // a search wave sweeps out from the head office every 3 s; points answer
        const ph = t * SP - VD[i]
        if (ph > 0) { const q = ph % PER, f = Math.exp(-(((q - 18) / 26) ** 2)) * (1 - 0.7 * Math.min(1, VD[i] / 1800)) * below; a += 0.32 * f; r += 0.8 * f }
        a += 0.04 * below * Math.sin(t * 1.4 + PH[i])
        const dm = Math.hypot(v.x - mx, v.y - my); if (dm < 150) { const k = (1 - dm / 150) ** 1.5; a += 0.35 * k; r += 0.8 * k }
      }
      const key = Math.round(Math.min(0.9, a) * VF[i] * 50) * 64 + Math.round(r * 4) // alpha in 1/50, radius in 1/4 px
      let b = this.buckets.get(key); if (!b) this.buckets.set(key, (b = [])); b.push(v.x, v.y)
    }
    for (const [key, b] of this.buckets) { // one path + one fill per bucket
      if (!b.length) continue
      const r = (key % 64) / 4, al = Math.floor(key / 64) / 50
      ctx.fillStyle = col(this.go, al); ctx.beginPath()
      for (let j = 0; j < b.length; j += 2) { ctx.moveTo(b[j] + r, b[j + 1]); ctx.arc(b[j], b[j + 1], r, 0, TAU) }
      ctx.fill(); b.length = 0
    }
    if (!live) return
    if (Math.random() < 0.05) for (let k = 0; k < 6; k++) { const i = (Math.random() * V.length) | 0; if (V[i].y > y0 && V[i].y < y1) { this.pings.push({ i, t0: t }); break } }
    ctx.lineWidth = 1
    for (let k = this.pings.length - 1; k >= 0; k--) {
      const p = this.pings[k], u = (t - p.t0) / 1.1; if (u > 1 || u < 0) { this.pings.splice(k, 1); continue }
      const v = V[p.i]; ctx.strokeStyle = col(this.go, 0.3 * (v.y > this.VH ? 0.5 : 1) * (1 - u)); ctx.beginPath(); ctx.arc(v.x, v.y, 2 + 12 * u, 0, TAU); ctx.stroke()
    }
  }
  /** Strokes part of a route; its strength fades smoothly where it passes behind content (batched by level). */
  private sline(w: Walker, d0: number, d1: number, c: RGB, a: number, lw: number, dash?: number[], phase = 0) {
    if (d1 <= d0) return
    const ctx = this.ctx; ctx.lineWidth = lw; if (dash) ctx.setLineDash(dash)
    let lvl = -1, started = false
    const flush = () => { if (started) ctx.stroke(); started = false }
    for (let i = 1; i < w.cum.length; i++) {
      const c0 = w.cum[i - 1], c1 = w.cum[i]; if (c1 <= d0) continue; if (c0 >= d1) break
      const ya = w.pts[i - 1][1], yb = w.pts[i][1]
      if ((ya < this.SY - 24 && yb < this.SY - 24) || (ya > this.SY + this.VH + 24 && yb > this.SY + this.VH + 24)) { flush(); continue } // off screen
      const s0 = Math.max(c0, d0), s1 = Math.min(c1, d1), L = w.fd[i]
      if (L !== lvl || !started) { flush(); lvl = L; ctx.strokeStyle = col(c, a * L); if (dash) ctx.lineDashOffset = phase + s0; ctx.beginPath(); const p = this.at(w, s0); ctx.moveTo(p[0], p[1]); started = true }
      const q = s1 === c1 ? w.pts[i] : this.at(w, s1); ctx.lineTo(q[0], q[1])
    }
    flush(); if (dash) { ctx.setLineDash([]); ctx.lineDashOffset = 0 }
  }
  private rr(X: number, Y: number, w: number, h: number, r: number) {
    const c = this.ctx; c.beginPath(); c.moveTo(X + r, Y); c.arcTo(X + w, Y, X + w, Y + h, r); c.arcTo(X + w, Y + h, X, Y + h, r); c.arcTo(X, Y + h, X, Y, r); c.arcTo(X, Y, X + w, Y, r); c.closePath()
  }
  private pill(x: number, y: number, text: string, solid: boolean, dot = true) {
    const c = this.ctx; c.save(); c.font = `700 11px ${FONT}`; c.direction = 'rtl'; c.textAlign = 'center'; c.textBaseline = 'middle'
    const w = this.tw(c.font, text) + 14, h = 18, X = x - w / 2, Y = y - h - 6
    if (!this.freeBox(X, Y, w, h + 8)) { c.restore(); return } // a chip is drawn only where it covers no content
    this.rr(X, Y, w, h, 9); c.fillStyle = solid ? col(this.back, 0.95) : col(this.surface, 0.95); c.fill()
    c.lineWidth = 1; c.strokeStyle = solid ? col(this.back, 0.95) : col(this.go, 0.55); c.stroke()
    c.fillStyle = solid ? col(this.surface, 1) : col(this.go, 0.95); c.fillText(text, x, Y + h / 2 + 1)
    if (dot) { c.fillStyle = solid ? col(this.back, 0.95) : col(this.go, 0.6); c.beginPath(); c.arc(x, y, 2.6, 0, TAU); c.fill() }
    c.restore()
  }
  private doc(x: number, y: number, k = 0, lift = 6, noIcon = false) {
    const c = this.ctx, label = noIcon ? AHMAD_LABEL : CH_LABEL[CHANNELS[k % CHANNELS.length]] ?? 'طلب عرض سعر'
    c.save(); c.font = `700 12px ${FONT}`; c.direction = 'rtl'; c.textBaseline = 'middle'
    const tw = this.tw(c.font, label), w = tw + (noIcon ? 18 : 38), h = 24, X = x - w / 2, Y = y - h - lift
    if (!this.freeBox(X, Y, w, h + lift)) { c.restore(); return }
    this.rr(X, Y, w, h, 11); c.fillStyle = col(this.surface, 0.97); c.fill(); c.lineWidth = 1; c.strokeStyle = col(this.go, 0.6); c.stroke()
    c.textAlign = 'right'; c.fillStyle = col(this.go, 1); c.fillText(label, X + w - 9, Y + h / 2 + 1)
    const im = img('channel-' + CHANNELS[k % CHANNELS.length], this.scale); if (!noIcon && ready(im)) c.drawImage(im, X + 3, Y + 2, 20, 20)
    c.restore()
    if (lift === 6) { c.fillStyle = col(this.go, 0.6); c.beginPath(); c.arc(x, y, 2.6, 0, TAU); c.fill() }
  }
  private hq(x: number, y: number) {
    const c = this.ctx; c.save(); c.translate(x, y)
    this.rr(-15, -15, 30, 30, 7); c.fillStyle = col(this.surface, 1); c.fill(); c.lineWidth = 1.4; c.strokeStyle = col(this.go, 0.9); c.stroke()
    c.fillStyle = col(this.go, 0.9); c.fillRect(-7, -8, 9, 16); c.fillRect(3, -2, 5, 10)
    c.fillStyle = col(this.surface, 1); for (const [wx, wy] of [[-5, -6], [-1.5, -6], [-5, -2.5], [-1.5, -2.5], [-5, 1], [-1.5, 1]]) c.fillRect(wx, wy, 2, 2)
    c.fillRect(-3.5, 4.5, 2.5, 3.5); c.fillRect(4.5, 0, 2, 2); c.fillRect(4.5, 3.5, 2, 2)
    c.font = `500 11px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'top'; c.direction = 'rtl'
    c.fillStyle = col(this.surface, 0.92); const lw = this.tw(c.font, 'مقر الشركة') + 10; c.fillRect(-lw / 2, 26, lw, 15)
    c.fillStyle = col(this.ink2, 1); c.fillText('مقر الشركة', 0, 28); c.restore()
  }
  // ---- Ahmad (same sprites, same steering as the app layer) ----
  private bucketOf(deg: number) { if (deg > -30 && deg <= 50) return 'E'; if (deg > 50 && deg <= 130) return 'S'; if (deg > 130 || deg <= -150) return 'W'; if (deg > -150 && deg <= -90) return 'NW'; return 'NE' }
  private steer(t: number, hx: number, hy: number, snap: boolean) {
    const RS = this.RS
    if (AHMAD === '3d') { // 8 directions straight from the path angle (0 = E, 90 = S); the model needs no tilt
      if (snap) { RS.ang = Math.atan2(hy, hx); RS.bucket = bucket8((RS.ang * 180) / Math.PI); RS.prev = null; RS.fade = 1; RS.lastT = t; return }
      const dt = Math.min(0.1, Math.max(0, t - RS.lastT)); RS.lastT = t
      const target = Math.atan2(hy, hx), diff = Math.atan2(Math.sin(target - RS.ang), Math.cos(target - RS.ang)); RS.ang += diff * Math.min(1, dt * 6)
      const deg = (RS.ang * 180) / Math.PI, b = bucket8(deg)
      if (b !== RS.bucket && bucket8(deg - 10) === b && bucket8(deg + 10) === b) { RS.prev = RS.bucket; RS.bucket = b; RS.fade = 0 } // hysteresis ±10°: no flicker on a 45° border
      RS.fade = Math.min(1, RS.fade + dt / 0.14); RS.tilt = 0
      return
    }
    if (snap) { RS.ang = Math.atan2(hy, hx); RS.bucket = this.bucketOf((RS.ang * 180) / Math.PI); RS.prev = null; RS.fade = 1; RS.lastT = t; return }
    const dt = Math.min(0.1, Math.max(0, t - RS.lastT)); RS.lastT = t
    const target = Math.atan2(hy, hx), diff = Math.atan2(Math.sin(target - RS.ang), Math.cos(target - RS.ang)); RS.ang += diff * Math.min(1, dt * 7)
    const deg = (RS.ang * 180) / Math.PI, b = this.bucketOf(deg)
    if (this.bucketOf(deg - 12) === b && this.bucketOf(deg + 12) === b) RS.want = b !== RS.bucket ? b : null // switched on the next planted foot
    RS.fade = Math.min(1, RS.fade + dt / 0.12)
    let rel = 0; if (RS.bucket === 'E') rel = RS.ang; else if (RS.bucket === 'W') rel = Math.atan2(Math.sin(RS.ang - Math.PI), Math.cos(RS.ang - Math.PI))
    const want = Math.max(-0.34, Math.min(0.34, rel * 0.45)); RS.tilt += (want - RS.tilt) * Math.min(1, dt * 6)
  }
  private cycle(i: number, x: number, y: number, alpha: number, mirror: boolean) {
    const im = img(CYCLE.f, this.scale); if (!ready(im)) return
    const fw = im.naturalWidth / CYCLE.n, f = ((i % 6) + 6) % 6, c = this.ctx
    const lean = 0.1 * this.RS.v // ≈ 6° forward at cruise, upright when starting / stopping
    c.save(); c.globalAlpha = alpha; c.translate(x, y); c.rotate(this.RS.tilt + (mirror ? -lean : lean)); if (mirror) c.scale(-1, 1)
    c.drawImage(im, f * fw, 0, fw, im.naturalHeight, -CYCLE.w / 2, -CYCLE.h, CYCLE.w, CYCLE.h); c.restore()
  }
  private pose(g: string, i: number, x: number, y: number, alpha: number, breath = 0) {
    if (g === 'E' || g === 'W') { this.cycle(i, x, y, alpha, g === 'W'); return }
    const set = POSES[g]; if (!set) return
    const f: Pose = set[i % set.length], im = img(f.f, this.scale); if (!ready(im)) return
    const c = this.ctx; c.save(); c.globalAlpha = alpha; c.translate(x, y); if (breath) c.scale(1, 1 + breath); c.drawImage(im, -f.ax, -f.ay, f.w, f.h); c.restore()
  }
  private runner(x: number, y: number, d: number, state: string, t: number) {
    const c = this.ctx, RS = this.RS
    if (AHMAD === '3d') {
      c.save(); c.fillStyle = col(this.ink, 0.14); c.beginPath(); c.ellipse(x, y, 14, 3.4, 0, 0, TAU); c.fill(); c.restore()
      if (state === 'run' || state === 'tired') {
        if (RS.prev && RS.fade < 1) run3(c, RS.prev as Dir8, d, x, y, 1 - RS.fade)
        run3(c, RS.bucket as Dir8, d, x, y, RS.prev && RS.fade < 1 ? RS.fade : 1)
      } else stand3(c, x, y, RS.bucket as Dir8) // at the supplier and next to the head office
      return
    }
    c.save(); c.fillStyle = col(this.ink, 0.13); c.beginPath(); c.ellipse(x, y, 13, 3, 0, 0, TAU); c.fill(); c.restore()
    if (state === 'run') {
      const u = d / STRIDE, fi = Math.floor(u), vi = Math.floor(u / 3)
      // turn only on a planted foot, never mid-stride
      if (fi !== RS.frame) { RS.frame = fi; if (RS.want && RS.want !== RS.bucket && CONTACT.has(((fi % 6) + 6) % 6)) { RS.prev = RS.bucket; RS.bucket = RS.want; RS.want = null; RS.fade = 0 } }
      // the side cycle carries its own rise; the single-frame views (S/NE/NW) get a step bob, scaled by speed
      const bob = (g: string) => (g === 'E' || g === 'W' ? 0 : Math.abs(Math.sin((u / 3) * Math.PI)) * 1.6 * RS.v)
      const idx = (g: string) => (g === 'E' || g === 'W' ? fi : vi)
      if (RS.prev && RS.fade < 1) this.pose(RS.prev, idx(RS.prev), x, y - bob(RS.prev), 1 - RS.fade)
      this.pose(RS.bucket, idx(RS.bucket), x, y - bob(RS.bucket), RS.prev && RS.fade < 1 ? RS.fade : 1); return
    }
    const side = RS.bucket === 'E' ? 'tiredR' : RS.bucket === 'W' ? 'tiredL' : 'tiredF'
    if (state === 'tired') this.pose(side, Math.floor(t * 0.7), x, y, 1, Math.sin(t * 5.5) * 0.012)
    else if (state === 'tiredFront') this.pose('tiredF', Math.floor(t * 0.6), x, y, 1, Math.sin(t * 5.5) * 0.012)
    else this.pose('present', 0, x, y, 1)
  }

  private prep(t: number) {
    this.F = this.S.walkers.map((w) => {
      const ease = w.runner ? (x: number) => x : calm
      const dOut = w.runner ? (t <= w.start ? 0 : t >= w.arrive ? w.len : this.outD(w, t)[0]) : t < w.start ? 0 : w.len * ease(Math.min(1, (t - w.start) / (w.arrive - w.start)))
      const dBack = t >= w.tc ? w.len * (1 - ease(Math.min(1, (t - w.tc) / (w.home - w.tc)))) : null
      return { w, dOut, dBack }
    })
  }
  /** The network itself: grid points, dotted request trails, return lines, supplier marks. */
  private scene(t: number) {
    const { ctx, S, V, go, back } = this
    this.dots(t, true); const FE = (this.FE = Math.max(0, Math.min(1, (S.end - t) / 1.8))) // lines fade out over the last 1.8 s
    { // launch: a soft double ripple leaves the head office
      const C = V[this.HUB], t0 = Math.min(...S.walkers.map((w) => w.start))
      for (const k of [0, 0.35]) { const u = (t - t0 - k) / 1.4; if (u < 0 || u > 1) continue; ctx.strokeStyle = col(go, 0.35 * (1 - u)); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(C.x, C.y, 18 + 46 * u, 0, TAU); ctx.stroke() }
    }
    for (const { w, dOut, dBack } of this.F) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      const isBack = dBack !== null
      this.sline(w, 0, dOut, go, (isBack ? 0.18 : 0.42) * FE, 1.3, [1.5, 4.5]) // outbound: thin dotted
      if (t >= w.start && t < w.arrive) { // the head: a tail (last 70 px, then 28 px) and a glowing point
        this.sline(w, Math.max(0, dOut - 70), dOut, go, 0.35 * FE, 1.6); this.sline(w, Math.max(0, dOut - 28), dOut, go, 0.8 * FE, 1.9)
        const [hx, hy] = this.at(w, dOut), hi = w.cum.findIndex((c) => c >= dOut), hf = w.fd[Math.min(w.fd.length - 1, Math.max(0, hi))] || 1
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 10); g.addColorStop(0, col(go, 0.45 * hf)); g.addColorStop(1, col(go, 0))
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 10, 0, TAU); ctx.fill(); ctx.fillStyle = col(go, 0.95 * hf); ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, TAU); ctx.fill()
      }
      if (w.runner && t < w.arrive) { ctx.fillStyle = col(go, 0.45); for (let d = Math.ceil((dOut + 6) / 12) * 12; d < w.len; d += 12) { const [px, py] = this.at(w, d); if (py < this.SY - 10 || py > this.SY + this.VH + 10) continue; ctx.beginPath(); ctx.arc(px, py, 1.6, 0, TAU); ctx.fill() } }
      if (dBack !== null) { // return: champagne 1.5 px with a 4.5 px glow
        this.sline(w, dBack, w.len, back, 0.08 * FE, 4.5); this.sline(w, dBack, w.len, back, 0.7 * FE, 1.5)
        if (t < w.home) { const [hx, hy] = this.at(w, dBack); ctx.fillStyle = col(back, 0.95); ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, TAU); ctx.fill() }
      }
      const v = V[w.target], hit = t >= w.arrive, gold = t >= w.tc
      if ((t >= w.start && dOut >= w.len * 0.98) || hit) {
        ctx.globalAlpha = FE; ctx.lineWidth = 1.2; ctx.strokeStyle = gold ? col(back, 0.9) : col(go, 0.75); ctx.fillStyle = gold ? col(back, 0.85) : col(this.surface, 1)
        ctx.beginPath(); ctx.arc(v.x, v.y, 4.2, 0, TAU); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1
      }
    }
  }
  /** Labels, chips, Ahmad, the head office — drawn only where they cover no content. */
  private overlay(t: number) {
    const { ctx, S, V, W } = this
    let got = 0, RUN: Walker | null = null
    for (const { w, dOut, dBack } of this.F) {
      if (t >= (w.done || w.home)) got++
      {
        const v = V[w.target]
        if (v.y > this.SY - 30 && v.y < this.SY + this.VH + 30) { // «مورد», only on screen and only on free space
        ctx.save(); ctx.font = `500 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.direction = 'rtl'
        const lx = Math.min(W - 16, Math.max(16, v.x)), ly = v.y + 8, lw = this.tw(ctx.font, 'مورد') + 8
        if (this.freeBox(lx - lw / 2, ly - 1, lw, 14)) { ctx.fillStyle = col(this.surface, 0.85); ctx.fillRect(lx - lw / 2, ly - 1, lw, 14); ctx.fillStyle = col(this.ink2, 1); ctx.fillText('مورد', lx, ly) }
        ctx.restore()
        }
      }
      if (w.runner) { RUN = w; continue }
      if (t >= w.start && t < w.arrive && dOut > 110) { const [x, y] = this.at(w, dOut); this.doc(x, y, w.ch) } // «طلب عرض سعر» after 110 px
      else if (t >= w.arrive && t < w.tc) { const v = V[w.target]; this.pill(v.x, v.y, fmt(w.price), true) }
      else if (t >= w.tc && t < w.home && dBack !== null) { const [x, y] = this.at(w, dBack); this.pill(x, y, fmt(w.price), true) }
    }
    if (RUN) {
      const w = RUN, RS = this.RS, [dBack, vBack] = t >= w.tc && t < w.home ? this.backD(w, t) : [0, 0]
      let d = 0, state: string | null = null, head: [number, number] | null = null
      if (t < w.start) { d = 0; state = 'present' }
      else if (t < w.arrive) { const [dd, vv] = this.outD(w, t); d = dd; RS.v = vv; state = 'run'; const a2 = this.at(w, Math.min(w.len, d + 16)), p2 = this.at(w, d); head = [a2[0] - p2[0], a2[1] - p2[1]] }
      else if (t < w.arrive + 1.1) { d = w.len; state = 'tiredFront' }
      else if (t < w.tc) { d = w.len; state = 'present' }
      else if (t < w.home) { d = dBack; RS.v = vBack; state = 'run'; const a2 = this.at(w, Math.max(0, d - 16)), p2 = this.at(w, d); head = [a2[0] - p2[0], a2[1] - p2[1]] }
      else if (t < w.done) { d = Math.min(w.len, 30); state = 'tiredFront' }
      if (state) {
        if (head && (head[0] || head[1])) this.steer(t, head[0], head[1], state === 'run' && RS.lastState !== 'run' && RS.lastState !== 'tired'); else { RS.lastT = t; RS.tilt *= 0.85 }
        RS.lastState = state
        if (state !== 'run') RS.v = 0
        // odometer: distance actually covered, either way — the stride always plays forwards
        if (RS.lastD >= 0 && Math.abs(d - RS.lastD) < 80) RS.odo += Math.abs(d - RS.lastD)
        RS.lastD = d
        const pos = this.at(w, d)
        if (pos[1] > this.SY - 90 && pos[1] < this.SY + this.VH + 90) {
          this.runner(pos[0], pos[1] + 1, RS.odo, state, t)
          const cy = pos[1] - (AHMAD === '3d' ? 88 : 76)
          if (t >= w.start && t < w.arrive) this.doc(pos[0], cy, 0, 0, true) // «أحمد · يدور بنفسه»
          else if (t >= w.arrive && t < w.arrive + 1.1) this.pill(pos[0], cy + 6, 'وصل… يلتقط أنفاسه', false, false)
          else if (t >= w.arrive && t < w.tc - 0.9) this.pill(pos[0], cy + 6, 'يسعّر عند المورد…', false, false)
          else if (t >= w.arrive && t < w.home) this.pill(pos[0], cy + 6, fmt(w.price), true, false)
          else if (t >= w.home && t < w.done) this.pill(pos[0], cy + 6, 'سلّم السعر ✓', true, false)
        }
      }
    }
    const C = V[this.HUB]
    if (S.ahmadHome && this.freeBox(C.x + 16, C.y - 72, 34, 76)) { if (AHMAD === '3d') stand3(ctx, C.x + 34, C.y + 4, 'SW'); else this.pose('present', 0, C.x + 32, C.y + 4, 1) }
    this.hq(C.x, C.y)
    { // what is happening, in one line under the head office
      const arrived = S.walkers.filter((w) => t >= w.arrive).length, back = S.walkers.filter((w) => t >= w.home).length
      const line = t >= S.allHome ? '' : back ? `وصلت ${back} أسعار وتتوالى` : arrived ? 'الموردين يسعّرون…' : 'نرسل طلبك لأكثر من 150 ألف مورد بـ6 طرق'
      if (line) {
        ctx.save(); ctx.font = `600 13px ${FONT}`; ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const lw = this.tw(ctx.font, line) + 22, lh = 26, X = C.x - lw / 2, Y = C.y + 46
        if (this.freeBox(X, Y, lw, lh)) {
          this.rr(X, Y, lw, lh, 13); ctx.fillStyle = col(this.surface, 0.96); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = col(this.go, 0.45); ctx.stroke()
          ctx.fillStyle = col(this.ink, 1); ctx.fillText(line, C.x, Y + lh / 2 + 1)
        }
        ctx.restore()
      }
    }
    const n = S.walkers.length; ctx.lineWidth = 2; ctx.strokeStyle = col(this.back, 0.9)
    for (let k = 0; k < got; k++) { const a0 = -Math.PI / 2 + (k * TAU) / n + 0.08, a1 = a0 + TAU / n - 0.16; ctx.beginPath(); ctx.arc(C.x, C.y, 22, a0, a1); ctx.stroke() }
    if (t >= S.allHome && n) {
      ctx.save(); ctx.direction = 'rtl'; ctx.textBaseline = 'middle'
      const lab = 'أرخص سعر', val = fmt(S.best); const w1 = this.tw(`500 12px ${FONT}`, lab)
      const w2 = this.tw(`700 14px ${FONT_NUM}`, val)
      const w = w1 + w2 + 34, h = 30, X = C.x - w / 2, Y = C.y - 58; this.rr(X, Y, w, h, 15)
      ctx.fillStyle = col(this.surface, 1); ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = col(this.back, 0.95); ctx.stroke()
      ctx.textAlign = 'right'; ctx.font = `500 12px ${FONT}`; ctx.fillStyle = col(this.ink2, 1); ctx.fillText(lab, X + w - 12, Y + h / 2 + 1)
      ctx.textAlign = 'left'; ctx.font = `700 14px ${FONT_NUM}`; ctx.fillStyle = col(this.ink, 1); ctx.fillText(val, X + 12, Y + h / 2 + 1); ctx.restore()
    }
  }
  private begin() { this.SY = window.scrollY; const c = this.ctx; c.setTransform(this.DPR, 0, 0, this.DPR, 0, 0); c.clearRect(0, 0, this.VW, this.VH); c.translate(0, -this.SY) }
  private draw(t: number) { this.begin(); this.mesh(t, true); if (!this.story) return; this.prep(t); this.scene(t); this.overlay(t) }
  private drawStatic() { this.begin(); this.mesh(0, false); if (this.story) this.dots(0, false); const C = this.V[this.HUB]; if (C && this.story) this.hq(C.x, C.y) }

  private loop = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.simT += dt
    const t0 = performance.now()
    if (this.story && this.simT > this.S.end) { this.played++; let R = this.next; this.next = null; if (!R) { R = this.plan(); this.sync++ } this.commit(R, this.simT) }
    this.draw(this.simT)
    this.times[this.nTimes++ % this.times.length] = performance.now() - t0
    this.raf = requestAnimationFrame(this.loop)
  }
  private run() {
    cancelAnimationFrame(this.raf); this.raf = 0
    if (!this.alive) return
    if (this.reduced) { this.drawStatic(); return } // reduced motion: the still grid and the head office
    if (!this.S && this.story) this.commit(this.plan(this.played === 0), this.simT)
    if (!document.hidden) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop) }
  }
}
