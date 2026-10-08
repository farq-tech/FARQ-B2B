/*
 * «الشبكة الحية» — Canvas 2D port of
 * docs/handoff/farq-live-background/reference/live-background-prototype.html (source of truth for
 * behaviour and timings). Differences from the prototype are deliberate and listed in docs/qa/m3/report.md:
 * colours come from CSS variables, the faint mesh is painted once on the static layer, the head office
 * and Ahmad's track avoid the real page elements (not a fixed overlay), and there is no pointer input.
 */
import { CHANNELS, CYCLE, POSES, url, type Pose } from './sprites'

export type Tone = 'light' | 'deep' | 'accent'
type RGB = [number, number, number]
type Vert = { x: number; y: number; r: number; c: number }
type Edge = { a: number; b: number; L: number }
type Box = [number, number, number, number]
type Prof = { n: number; cum: Float64Array; tot: number; g: (t: number) => number }
const NO_PROF: Prof = { n: 0, cum: new Float64Array(1), tot: 1, g: () => 1 }
// -0 is a heap number: fields that start at 0 and turn fractional keep one (double) representation, so V8 never
// deoptimises the draw loop the first time Ahmad turns or a round's timings change shape.
const D0 = -0
type Walker = {
  k: number; ch: number; runner: boolean; rest: boolean; target: number; path: number[]; cum: number[]; len: number
  far0: number; ang: number; start: number; arrive: number; tc: number; home: number; done: number; price: number; prof: Prof
}
type Plan = { walkers: Walker[]; mode: 'far' | 'near' | 'none'; rerolls: number; gen: number; k: number }
type Round = { walkers: Walker[]; allHome: number; best: number; end: number; k: number }

const FONT = 'Tajawal, "Readex Pro", system-ui, sans-serif'
const FONT_NUM = '"Readex Pro", Tajawal, system-ui, sans-serif'
const TAU = 6.283

// ---------- colour: tokens → RGB (computed once per build) ----------
// colour strings are built once per (colour, alpha): no string garbage in the frame loop
const RGBA = new WeakMap<RGB, Map<number, string>>()
const rgba = (c: RGB, a: number) => {
  let m = RGBA.get(c); if (!m) RGBA.set(c, (m = new Map()))
  let v = m.get(a); if (v === undefined) m.set(a, (v = `rgba(${c[0]},${c[1]},${c[2]},${a})`))
  return v
}
function readColor(parent: HTMLElement, value: string): RGB {
  const p = document.createElement('i')
  p.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden'
  p.style.color = value
  parent.appendChild(p)
  const m = getComputedStyle(p).color.match(/[\d.]+/g) || ['0', '0', '0']
  p.remove()
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}
// Facet shades: --live-facet-1..5 per tone (tokens.css, values from the reference prototype).
const FACETS = [1, 2, 3, 4, 5].map((i) => `var(--live-facet-${i})`)

// ---------- sprites (WebP 1x/2x, loaded lazily, never inlined) ----------
const IMGS = new Map<string, HTMLImageElement>()
function img(stem: string, scale: 1 | 2) {
  const key = `${stem}@${scale}`
  let im = IMGS.get(key)
  if (!im) { im = new Image(); im.decoding = 'async'; im.src = url(stem, scale); IMGS.set(key, im) }
  return im
}
const ready = (im: HTMLImageElement) => im.complete && im.naturalWidth > 0

// ---------- chips: every label is rendered once into its own small canvas, the frame loop only blits ----------
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
/** A pre-rendered chip; x/y/w/h is its box relative to the anchor point it is drawn at. */
type Chip = { c: CanvasImageSource; x: number; y: number; w: number; h: number }
const PAD = 2
const surface = (w: number, h: number) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }))
function rr(c: Ctx2D, X: number, Y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(X + r, Y); c.arcTo(X + w, Y, X + w, Y + h, r); c.arcTo(X + w, Y + h, X, Y + h, r); c.arcTo(X, Y + h, X, Y, r); c.arcTo(X, Y, X + w, Y, r); c.closePath()
}
const RUNNER_LABELS = ['وصل… يلتقط أنفاسه', 'يسعّر عند المورد…', 'سلّم السعر ✓']

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
// Rounds are seeded from the shared clock (round number), so every screen plays the same round: `rand` is
// re-pointed to a seeded generator while a round is planned.
let rand: () => number = Math.random
const shuffle = <T,>(a: T[], r: () => number = rand) => { for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]] } return a }
/** One shared clock for every page and tab: wall time in seconds. A round is ROUND seconds; round k starts at k·ROUND. */
export const ROUND = 24
const ALL_HOME = 20.6 // every request (and Ahmad) is back by then; «أرخص سعر» shows until the next round
const wall = () => (performance.timeOrigin + performance.now()) / 1000
const seedOf = (k: number, salt: number) => (Math.imul(k | 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) | 0
const fmt = (n: number) => n.toLocaleString('en-US') + ' ر.س'

// ---------- page elements the network must keep clear of ----------
const REPLACED = new Set(['IMG', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'VIDEO', 'CANVAS', 'IFRAME'])
const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'BR'])
function ownText(el: Element) { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent && n.textContent.trim()) return true; return false }
const painted = (c: string) => c !== 'transparent' && !/,\s*0\)$/.test(c)
/** Rectangles (relative to `host`) of every visible text, control, image or card that overlaps it. */
export function readObstacles(host: HTMLElement, scope: Element = document.body, page = false): { boxes: Box[]; title: Box | null } {
  const hr0 = host.getBoundingClientRect(), de = document.documentElement
  // page mode: the whole document, in page coordinates
  const hr = page ? { left: -window.scrollX, top: -window.scrollY, right: de.scrollWidth - window.scrollX, bottom: de.scrollHeight - window.scrollY, width: de.scrollWidth, height: de.scrollHeight } : hr0
  const area = hr.width * hr.height, boxes: Box[] = []
  let title: Box | null = null, titleRank = 9
  const walk = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT)
  for (let n = walk.nextNode() as Element | null; n; n = walk.nextNode() as Element | null) {
    if (SKIP.has(n.tagName.toUpperCase()) || host.contains(n)) continue
    const r = n.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || r.right < hr.left || r.left > hr.right || r.bottom < hr.top || r.top > hr.bottom) continue
    if (r.width * r.height > area * 0.5) continue // page / screen wrappers, not obstacles
    if (page && r.width >= hr.width * 0.9 && !ownText(n)) continue // full-bleed bands: section backgrounds
    const tag = n.tagName.toUpperCase()
    let solid = REPLACED.has(tag) || ownText(n)
    if (!solid) {
      const cs = getComputedStyle(n)
      solid = painted(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 || cs.boxShadow !== 'none'
      if (solid && (cs.visibility === 'hidden' || cs.opacity === '0')) solid = false
    }
    if (!solid) continue
    const b: Box = [r.left - hr.left, r.top - hr.top, r.right - hr.left, r.bottom - hr.top]
    boxes.push(b)
    const rank = tag === 'H1' ? 0 : tag === 'H2' ? 1 : 9
    if (rank < titleRank) { titleRank = rank; title = b }
  }
  return { boxes, title }
}

export type EngineOpts = { reduced: boolean; /** where to look for page elements (default: the whole page) */ scope?: Element }
export type FrameStats = { frames: number; avg: number; p95: number; p99: number; max: number; rounds: number; far: number; near: number; none: number; sync: number }

export class LiveEngine {
  private bctx: CanvasRenderingContext2D
  private ctx: CanvasRenderingContext2D
  private W = 0; private H = 0; private DPR = 1; private scale: 1 | 2 = 1
  private V: Vert[] = []; private E: Edge[] = []; private adj: number[][] = []
  private FLOW: Array<{ sp: number; ph: number; rev: boolean }> = []
  private HUB = 0; private S!: Round; private S_client = 0
  private boxes: Box[] = []; private title: Box | null = null
  private go: RGB = [0, 0, 0]; private back: RGB = [0, 0, 0]; private base: RGB = [255, 255, 255]; private meshLine: RGB = [0, 0, 0]
  private surface: RGB = [255, 255, 255]; private ink: RGB = [0, 0, 0]; private ink2: RGB = [0, 0, 0]
  private RS = { ang: D0, bucket: 'E', prev: null as string | null, fade: 1.5, lastT: D0, lastState: null as string | null, tilt: D0, odo: D0, lastD: -1 }
  private raf = 0; private simT = 0; private last = 0; private onScreen = true; private alive = true
  private times = new Float32Array(8192); private nTimes = 0
  private next: Plan | null = null; private gen = 0; private warmed = false; private warming = false
  private chips = new Map<string, Chip>(); private mctx = surface(1, 1).getContext('2d') as Ctx2D
  private counts = { rounds: 0, far: 0, near: 0, none: 0, rerolls: 0, sync: 0 }
  private cleanup: Array<() => void> = []
  private host: HTMLElement; private bg: HTMLCanvasElement; private fx: HTMLCanvasElement; private opts: EngineOpts

  private get story() { return true }
  private tris: number[][] = []; private shades: string[] = []
  constructor(host: HTMLElement, bg: HTMLCanvasElement, fx: HTMLCanvasElement, opts: EngineOpts) {
    this.host = host; this.bg = bg; this.fx = fx; this.opts = opts
    this.bctx = bg.getContext('2d')!
    fx.style.opacity = '0' // fades in once the warm-up is done
    this.ctx = fx.getContext('2d')!
    const run = () => this.run()
    document.addEventListener('visibilitychange', run)
    this.cleanup.push(() => document.removeEventListener('visibilitychange', run))
    const io = new IntersectionObserver((es) => { this.onScreen = es[es.length - 1].isIntersecting; this.run() })
    io.observe(host)
    let rt = 0
    const ro = new ResizeObserver(() => { clearTimeout(rt); rt = window.setTimeout(() => this.reset(), 120) })
    ro.observe(host)
    // the page changes under us (route, data, scroll): re-read what to avoid while idle; move the head office only if it got covered
    let mt = 0
    const recheck = () => { clearTimeout(mt); mt = window.setTimeout(() => this.recheck(), 300) }
    // ignore our own probes (readColor appends to the host) — otherwise a covered hub resets in a loop
    const mo = new MutationObserver((rs) => { if (rs.some((r) => !host.contains(r.target))) recheck() })
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    window.addEventListener('scroll', recheck, { passive: true, capture: true })
    this.cleanup.push(() => { io.disconnect(); ro.disconnect(); mo.disconnect(); clearTimeout(rt); clearTimeout(mt); window.removeEventListener('scroll', recheck, { capture: true }) })
    this.reset()
  }

  destroy() { this.alive = false; cancelAnimationFrame(this.raf); this.cleanup.forEach((f) => f()) }
  setReduced(r: boolean) { if (r !== this.opts.reduced) { this.opts.reduced = r; this.reset() } }
  stats(): FrameStats {
    const n = Math.min(this.nTimes, this.times.length), a = Array.from(this.times.subarray(0, n)).sort((x, y) => x - y)
    const q = (f: number) => (n ? a[Math.min(n - 1, Math.floor(n * f))] : 0), c = this.counts
    return { frames: this.nTimes, avg: n ? a.reduce((s, x) => s + x, 0) / n : 0, p95: q(0.95), p99: q(0.99), max: n ? a[n - 1] : 0, rounds: c.rounds, far: c.far, near: c.near, none: c.none, sync: c.sync }
  }

  private recheck() {
    if (!this.alive || !this.V.length) return
    const o = readObstacles(this.host, this.opts.scope)
    const changed = JSON.stringify(o.boxes.map((b) => b.map(Math.round))) !== JSON.stringify(this.boxes.map((b) => b.map(Math.round)))
    this.boxes = o.boxes; this.title = o.title
    if (changed) this.paintStatic()
    if (changed && !this.opts.reduced && this.story) { this.gen++; this.next = null; this.schedulePlan() } // the pre-planned round may now pass behind something
    const h = this.V[this.HUB]
    if (o.boxes.some((b) => h.x > b[0] - 24 && h.x < b[2] + 24 && h.y > b[1] - 24 && h.y < b[3] + 24) && changed) this.reset() // same layout still covering it: a rebuild would land here again
  }

  private reset() {
    if (!this.alive) return
    this.build()
    this.gen++; this.next = null
    this.chips.clear() // colours / DPR may have changed
    this.S = undefined as unknown as Round
    if (!this.opts.reduced && this.story) { this.simT = wall(); this.sync(this.simT, false) }
    this.run()
  }

  private readColors() {
    const h = this.host
    this.go = readColor(h, 'var(--live-go)'); this.back = readColor(h, 'var(--live-back)')
    this.base = readColor(h, 'var(--live-base)'); this.meshLine = readColor(h, 'var(--live-mesh-line)')
    // chips sit on a light surface in every tone → read surface/ink outside the tone scope
    this.surface = readColor(document.body, 'var(--color-bg-surface)')
    this.ink = readColor(document.body, 'var(--color-text-primary)'); this.ink2 = readColor(document.body, 'var(--color-text-secondary)')
  }

  // ---------- mesh + head office (static layer, painted once per build) ----------
  private build() {
    const r = this.host.getBoundingClientRect()
    const W = (this.W = Math.max(1, r.width)), H = (this.H = Math.max(1, r.height))
    this.DPR = Math.min(2, window.devicePixelRatio || 1); this.scale = this.DPR > 1 ? 2 : 1
    for (const c of [this.bg, this.fx]) { c.width = Math.round(W * this.DPR); c.height = Math.round(H * this.DPR) }
    this.readColors()
    const o = readObstacles(this.host, this.opts.scope); this.boxes = o.boxes; this.title = o.title
    const cell = W < 640 ? 56 : 72, rnd = mulberry(11), jit = 0.28
    const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1, cw = W / (cols - 1), chh = H / (rows - 1)
    const V: Vert[] = (this.V = []), id = (r: number, c: number) => r * cols + c
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      V.push({ x: c * cw + (c > 0 && c < cols - 1 ? (rnd() * 2 - 1) * jit * cw : 0), y: r * chh + (r > 0 && r < rows - 1 ? (rnd() * 2 - 1) * jit * chh : 0), r, c })
    const key = new Set<string>(), tris: number[][] = []
    let E: Edge[] = []
    const add = (a: number, b: number) => { const k = a < b ? a + '_' + b : b + '_' + a; if (key.has(k)) return; key.add(k); E.push({ a, b, L: Math.hypot(V[a].x - V[b].x, V[a].y - V[b].y) }) }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = id(r, c), b = id(r, c + 1), d = id(r + 1, c + 1), e = id(r + 1, c)
      for (const q of rnd() < 0.5 ? [[a, b, d], [a, d, e]] : [[a, b, e], [b, d, e]]) { tris.push(q); add(q[0], q[1]); add(q[1], q[2]); add(q[2], q[0]) }
    }
    // head office: nearest clear vertex above the screen title — never under any element, away from the edges
    const t = this.title
    const pref = t ? [(t[0] + t[2]) / 2, Math.max(40, t[1] - 48)] : [W / 2, Math.min(H * 0.3, 140)]
    // margin around every element, widest first: room for the six «طلب عرض سعر» chips (≈ one mesh cell + a chip),
    // then the reference's 46 px, then just outside it — never under an element while any free vertex exists
    let hub = -1
    const hit = (r: number[]) => this.boxes.some((b) => r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1])
    const gapOf = (v: Vert) => this.boxes.reduce((m, b) => Math.min(m, Math.hypot(Math.max(b[0] - v.x, 0, v.x - b[2]), Math.max(b[1] - v.y, 0, v.y - b[3]))), Math.min(v.x, W - v.x, v.y, H - v.y))
    for (const [mx, my] of [[96, 80], [60, 56], [40, 40]]) {
      const ui = this.boxes.map((b) => [b[0] - mx, b[1] - my, b[2] + mx, b[3] + my])
      // the «أرخص سعر» chip (≈ 180×30, 58 px above) and the «مقر الشركة» label below must clear text too
      const ok = (v: Vert) => v.x > 60 && v.x < W - 60 && v.y > 44 && v.y < H - 60 && !ui.some((b) => v.x > b[0] && v.x < b[2] && v.y > b[1] && v.y < b[3]) && !hit([v.x - 95, v.y - 100, v.x + 95, v.y + 48])
      const pick = (above: boolean) => { let best = -1, bd = 1e18; V.forEach((v, i) => { if (!ok(v) || (above && t && v.y > t[1] - 20)) return; const d = (v.x - pref[0]) ** 2 + (v.y - pref[1]) ** 2; if (d < bd) { bd = d; best = i } }); return best }
      hub = pick(true); if (hub < 0) hub = pick(false)
      if (hub >= 0) break
    }
    if (hub < 0) { // no clear spot: the widest free space (farthest from every element), never on text
      let bd = -1
      V.forEach((v, i) => { const g = gapOf(v); if (g > bd) { bd = g; hub = i } })
    }
    // open the mesh around the hub: drop its ring and fan straight to the outer rim, so paths leave in every direction
    {
      const ring = new Set<number>(); for (const q of tris) if (q.includes(hub)) for (const v of q) if (v !== hub) ring.add(v)
      const border = (v: number) => V[v].c === 0 || V[v].r === 0 || V[v].c === cols - 1 || V[v].r === rows - 1
      const gone = new Set([...ring].filter((v) => !border(v)))
      const region = tris.filter((q) => q.includes(hub) || q.some((v) => gone.has(v)))
      const cnt = new Map<string, number>()
      for (const q of region) for (const [x, y] of [[q[0], q[1]], [q[1], q[2]], [q[2], q[0]]]) {
        if (x === hub || y === hub || gone.has(x) || gone.has(y)) continue
        const k = x < y ? x + '_' + y : y + '_' + x; cnt.set(k, (cnt.get(k) || 0) + 1)
      }
      const keep = tris.filter((q) => !region.includes(q)), fan: number[][] = []
      for (const [k, c] of cnt) if (c === 1) { const [x, y] = k.split('_').map(Number); fan.push([hub, x, y]) }
      tris.length = 0; tris.push(...keep, ...fan)
      key.clear(); E = []; for (const q of tris) { add(q[0], q[1]); add(q[1], q[2]); add(q[2], q[0]) }
      this.HUB = hub
    }
    this.E = E
    this.adj = V.map(() => []); E.forEach((e, i) => { this.adj[e.a].push(i); this.adj[e.b].push(i) })
    const fr = mulberry(29) // ambient pulse seeded like the mesh: the same on every page of the same size
    this.FLOW = E.map((e) => ({ sp: 14 + fr() * 22, ph: fr() * (e.L + 60), rev: fr() < 0.5 }))
    // static layer: facets + the faint mesh
    const shades = FACETS.map((v) => rgba(readColor(this.host, v), 1))
    this.tris = tris; this.shades = tris.map(() => shades[(rnd() * shades.length) | 0]); this.base0 = shades[0]
    this.paintStatic()
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0)
    this.ctx.clearRect(0, 0, W, H)
  }

  private base0 = 'transparent'
  /** Facets + mesh lines; under every text / control / card the mesh drops to 30 % (readability). */
  private paintStatic() {
    const b = this.bctx, { V, E, W, H } = this
    b.setTransform(this.DPR, 0, 0, this.DPR, 0, 0); b.globalCompositeOperation = 'source-over'; b.clearRect(0, 0, W, H)
    b.fillStyle = this.base0; b.fillRect(0, 0, W, H)
    this.tris.forEach((q, i) => { b.beginPath(); b.moveTo(V[q[0]].x, V[q[0]].y); b.lineTo(V[q[1]].x, V[q[1]].y); b.lineTo(V[q[2]].x, V[q[2]].y); b.closePath(); b.fillStyle = this.shades[i]; b.fill() })
    // ambient is clearly lighter than the story layer: a sense of motion, not a drawing
    const line = this.story ? (this.opts.reduced ? 0.14 : 0.07) : (this.opts.reduced ? 0.07 : 0.035)
    // the lines go on their own layer so only the network fades under text — the facets stay whole (no patches)
    const L = (this.lines ??= document.createElement('canvas')); L.width = this.bg.width; L.height = this.bg.height
    const l = L.getContext('2d')!; l.setTransform(this.DPR, 0, 0, this.DPR, 0, 0)
    l.lineCap = 'round'; l.lineWidth = 0.8; l.strokeStyle = rgba(this.go, line); l.beginPath()
    for (const e of E) { l.moveTo(V[e.a].x, V[e.a].y); l.lineTo(V[e.b].x, V[e.b].y) } l.stroke()
    this.shield(l)
    b.setTransform(1, 0, 0, 1, 0, 0); b.drawImage(L, 0, 0); b.setTransform(this.DPR, 0, 0, this.DPR, 0, 0)
  }
  private lines: HTMLCanvasElement | null = null
  /** Readability: the layer keeps ≤ 30 % of its opacity under every element it avoids (text, controls, cards). */
  private shield(c: CanvasRenderingContext2D) {
    c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = rgba([0, 0, 0], 0.7) // destination-out: only the alpha counts
    for (const x of this.boxes) c.fillRect(x[0] - 6, x[1] - 6, x[2] - x[0] + 12, x[3] - x[1] + 12)
    c.restore()
  }

  // ---------- one round: head office → 6 requests → prices back ----------
  private routeV(from: number, to: number, blocked: (v: number) => boolean) {
    const { V, E, adj } = this
    const d = new Float64Array(V.length).fill(Infinity), pv = new Int32Array(V.length).fill(-1), h: Array<[number, number]> = []
    d[from] = 0; heapPush(h, [0, from])
    while (h.length) {
      const [x, u] = heapPop(h); if (x > d[u]) continue; if (u === to) break
      for (const ei of adj[u]) { const e = E[ei], v = e.a === u ? e.b : e.a; if (v !== to && blocked(v)) continue; const nx = x + e.L * (0.3 + rand() * 2.7); if (nx < d[v]) { d[v] = nx; pv[v] = u; heapPush(h, [nx, v]) } }
    }
    if (!isFinite(d[to])) return null
    const path: number[] = []; let v = to; while (v !== from) { path.unshift(v); v = pv[v] } return path
  }

  /**
   * Plans one round (times relative to its start). Runs ahead of time in an idle callback, so the frame
   * that starts a round only shifts times. Ahmad's track, in order of preference:
   *   1. far   — a long path whose whole track (and his 70 px of height) stays clear; up to 8 re-rolls (as the reference)
   *   2. near  — on any of those rolls: a clear prefix of a path, or a fresh route around the elements, ending ≥ 60% of the
   *              farthest point in its direction (and still never touching another request's path)
   *   3. none  — last resort: he sits the round out (counted in stats)
   */
  private planRound(k: number): Plan {
    try {
      const rolls: Walker[][] = []
      for (let i = 0; i < 8; i++) {
        rand = mulberry(seedOf(k, i)) // geometry: the same roll on the same layout is always the same
        const ws = this.routes(); rolls.push(ws)
        const r = this.pickFar(ws); if (r) return this.finish(ws, r, 'far', i, k)
      }
      rand = mulberry(seedOf(k, 99))
      for (const ws of rolls) { const r = this.pickNear(ws) || this.pickRoute(ws); if (r) return this.finish(ws, r, 'near', 8, k) }
      return this.finish(rolls[rolls.length - 1], null, 'none', 8, k)
    } finally { rand = Math.random }
  }

  /** Six non-crossing paths from the head office, one per direction, each to the farthest reachable point. */
  private routes(): Walker[] {
    const { V, E, adj } = this
    const S_client = this.HUB
    const base = 3000 + rand() * 9000, C = V[S_client]
    const NB = (ei: number) => { const e = E[ei]; return e.a === S_client ? e.b : e.a }, ANG = (ei: number) => Math.atan2(V[NB(ei)].y - C.y, V[NB(ei)].x - C.x)
    const all = [...adj[S_client]].sort((a, b) => ANG(a) - ANG(b)), M = Math.min(6, all.length), rot = rand()
    const out = [...new Set(Array.from({ length: M }, (_, k) => all[Math.floor(((k + rot) * all.length) / M) % all.length]))], sec = Math.PI / out.length
    const owner = new Int16Array(V.length).fill(-1); owner[S_client] = 999
    const walkers: Walker[] = []
    // text keep-out for every request: its chip rides ~40 px above the point, «مورد» sits ~16 px below the supplier
    const tb = this.boxes.map((b) => [b[0] - 16, b[1] - 18, b[2] + 16, b[3] + 46])
    const inT = (v: { x: number; y: number }) => tb.some((b) => v.x > b[0] && v.x < b[2] && v.y > b[1] && v.y < b[3])
    const clearOf = (p: number[]) => { for (let j = 1; j < p.length; j++) { const a = V[p[j - 1]], b = V[p[j]], L = Math.hypot(b.x - a.x, b.y - a.y); for (let d = 0; d <= L; d += 8) if (inT({ x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L })) return false } return true }
    out.forEach((ei, k) => { owner[NB(ei)] = k })
    out.forEach((ei, k) => {
      const nb = NB(ei), ang = Math.atan2(V[nb].y - C.y, V[nb].x - C.x)
      // destination: the farthest point in this direction reachable without touching another request's path
      const cand: Array<[number, number]> = []
      for (let i = 0; i < V.length; i++) { if (owner[i] >= 0) continue; const v = V[i], an = Math.atan2(v.y - C.y, v.x - C.x), da = Math.abs(Math.atan2(Math.sin(an - ang), Math.cos(an - ang))); if (da <= sec) cand.push([Math.hypot(v.x - C.x, v.y - C.y), i]) }
      cand.sort((x, y) => y[0] - x[0])
      if (inT(V[nb])) return // this direction starts behind text: one request fewer this round
      const far = cand.filter((c) => c[0] >= (cand[0]?.[0] ?? 0) * 0.82)
      let path: number[] | null = null, target = -1
      for (const [, i] of [...shuffle(far), ...cand].slice(0, 24)) {
        if (i === nb || inT(V[i])) continue
        const r = this.routeV(nb, i, (v) => owner[v] >= 0 || inT(V[v]))
        if (!r) continue
        const p = [S_client, nb, ...r]
        if (!clearOf(p)) continue // an edge between two clear points can still cut through a line of text
        path = p; target = i; break
      }
      if (!path) return // no clear path in this direction: drop it rather than draw behind text
      path.slice(1).forEach((v) => (owner[v] = k))
      const cum = [0]
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(V[path[i]].x - V[path[i - 1]].x, V[path[i]].y - V[path[i - 1]].y))
      const start = 0, arrive = 9, tc = 10, home = 16 // placeholders: finish() sets the round's timeline from the clock seed
      walkers.push({ k, ch: k % CHANNELS.length, runner: false, rest: false, target, path, cum, len: cum[cum.length - 1], far0: cand[0]?.[0] ?? 0, ang, start, arrive, tc, home, done: home, price: Math.round((base * (0.82 + rand() * 0.36)) / 10) * 10, prof: NO_PROF })
    })
    return walkers
  }

  private runnerBoxes() { return this.boxes.map((b) => [b[0] - 40, b[1] - 30, b[2] + 40, b[3] + 70]) }
  /** Distance along the path of the first point where Ahmad would be behind an element (Infinity = clear all the way). */
  private blockedAt(w: Walker, boxes: number[][]) {
    for (let d = 46; d <= w.len; d += 8) { const [x, y] = this.at(w, d); if (boxes.some((b) => x > b[0] && x < b[2] && y > b[1] && y < b[3])) return d }
    return Infinity
  }
  private pickFar(ws: Walker[]) {
    const boxes = this.runnerBoxes(), long = Math.min(this.W, this.H) * 0.35
    const ok = ws.filter((w) => w.len > long && this.V[w.target].y > 90 && this.blockedAt(w, boxes) === Infinity)
    return ok.length ? ok[(rand() * ok.length) | 0] : null
  }
  private pickNear(ws: Walker[]) {
    const boxes = this.runnerBoxes(), C = this.V[this.HUB], ok: Array<[Walker, number]> = []
    for (const w of ws) {
      const stop = this.blockedAt(w, boxes)
      for (let i = w.path.length - 1; i >= 2; i--) {
        const v = this.V[w.path[i]]
        if (w.cum[i] >= stop - 8 || v.y <= 90) continue
        const dv = Math.hypot(v.x - C.x, v.y - C.y)
        if (dv >= 0.6 * w.far0) ok.push([w, i])
        break
      }
    }
    if (!ok.length) return null
    const [w, i] = ok[(rand() * ok.length) | 0]
    w.path = w.path.slice(0, i + 1); w.cum = w.cum.slice(0, i + 1); w.len = w.cum[i]; w.target = w.path[i]
    return w
  }
  /** A dedicated route for Ahmad in one walker's direction that steers around every element (vertex-disjoint from the others). */
  private pickRoute(ws: Walker[]) {
    const V = this.V, C = V[this.HUB], boxes = this.runnerBoxes(), sec = Math.PI / ws.length
    const inB = (v: Vert) => boxes.some((b) => v.x > b[0] && v.x < b[2] && v.y > b[1] && v.y < b[3])
    const owner = new Int16Array(V.length).fill(-1); owner[this.HUB] = 999
    for (const w of ws) for (const v of w.path.slice(1)) owner[v] = w.k
    for (const w of shuffle([...ws])) {
      const firsts = this.adj[this.HUB].map((ei) => (this.E[ei].a === this.HUB ? this.E[ei].b : this.E[ei].a)).filter((v) => {
        if (owner[v] >= 0 && owner[v] !== w.k) return false
        const an = Math.atan2(V[v].y - C.y, V[v].x - C.x)
        return !inB(V[v]) && Math.abs(Math.atan2(Math.sin(an - w.ang), Math.cos(an - w.ang))) <= sec
      })
      for (const nb of firsts) {
      const cand: Array<[number, number]> = []
      for (let i = 0; i < V.length; i++) {
        if (i === nb || (owner[i] >= 0 && owner[i] !== w.k)) continue
        const v = V[i], an = Math.atan2(v.y - C.y, v.x - C.x), d = Math.hypot(v.x - C.x, v.y - C.y)
        if (v.y <= 90 || inB(v) || d < 0.6 * w.far0 || Math.abs(Math.atan2(Math.sin(an - w.ang), Math.cos(an - w.ang))) > sec) continue
        cand.push([d, i])
      }
      cand.sort((x, y) => y[0] - x[0])
      for (const [, i] of cand.slice(0, 12)) {
        const r = this.routeV(nb, i, (v) => (owner[v] >= 0 && owner[v] !== w.k) || inB(V[v]))
        if (!r) continue
        const path = [this.HUB, nb, ...r], cum = [0]
        for (let j = 1; j < path.length; j++) cum.push(cum[j - 1] + Math.hypot(V[path[j]].x - V[path[j - 1]].x, V[path[j]].y - V[path[j - 1]].y))
        const t: Walker = { ...w, path, cum, len: cum[cum.length - 1], target: i }
        if (this.blockedAt(t, boxes) !== Infinity) continue // an edge between two clear points can still clip a corner
        Object.assign(w, { path, cum, len: t.len, target: i })
        return w
      }
      }
    }
    return null
  }
  private finish(walkers: Walker[], r: Walker | null, mode: Plan['mode'], rerolls: number, k: number): Plan {
    // Everything the eye compares between screens comes from the round number alone: when each request leaves,
    // arrives and returns, the prices (so «أرخص سعر» is the same), the channel order and Ahmad's timeline.
    // Only the geometry (where the head office is, which way each path goes) follows each screen's layout.
    const c = mulberry(seedOf(k, 1000)), base = 3000 + c() * 9000
    walkers.forEach((w, i) => {
      const s0 = c() * 0.6, a0 = c(), t0 = c(), h0 = c(), p0 = c()
      w.start = s0; w.arrive = s0 + 8.5 + a0 * 1.2; w.tc = w.arrive + 0.8 + t0 * 0.6; w.home = w.tc + 5.5 + h0 * 0.8; w.done = w.home
      w.price = Math.round((base * (0.82 + p0 * 0.36)) / 10) * 10; w.ch = i % CHANNELS.length
    })
    if (r) {
      // fixed timeline on every screen (speed follows the path length): run 9.5 s with a catch-breath half-way,
      // 2.9 s at the supplier, 6 s back, 1.5 s next to the head office
      r.runner = true; r.rest = true
      r.arrive = r.start + 9.5; r.tc = r.arrive + 2.9; r.home = r.tc + 6; r.done = r.home + 1.5
    }
    // the other paths: one channel each, never repeated (a 6th path only when Ahmad sits out)
    const order = shuffle(CHANNELS.map((_, i) => i), c); let j = 0
    for (const w of walkers) if (!w.runner) w.ch = order[j++ % order.length]
    return { walkers, mode, rerolls, gen: this.gen, k }
  }
  /** Start planned round k at its clock time k·ROUND (cheap: shifts times, builds Ahmad's speed profile). */
  private commit(p: Plan) {
    const t = p.k * ROUND
    for (const w of p.walkers) { w.start += t; w.arrive += t; w.tc += t; w.home += t; w.done += t; if (w.runner) this.profile(w) }
    this.counts.rounds++; this.counts[p.mode]++; this.counts.rerolls += p.rerolls
    this.S_client = this.HUB
    this.S = { walkers: p.walkers, allHome: t + ALL_HOME, best: p.walkers.length ? Math.min(...p.walkers.map((w) => w.price)) : 0, end: t + ROUND, k: p.k }
  }
  /** Make the live round the one the shared clock is in (a page opened mid-round joins it where it is). */
  private sync(t: number, inFrame: boolean) {
    const k = Math.floor(t / ROUND)
    if (this.S && this.S.k === k) return
    let p = this.next; this.next = null
    if (!p || p.gen !== this.gen || p.k !== k) { p = this.planRound(k); this.prerender(p.walkers); if (inFrame) this.counts.sync++ } // only if the idle plan did not run in time
    this.commit(p); this.schedulePlan()
  }
  /**
   * Warm-up before the first animated frame (the first time a frame meets a new state — an image's GPU upload, a
   * label's shaping, a code path V8 has not optimised — it can cost 5–30 ms on a slow CPU):
   *   1. await img.decode() for every sprite (Ahmad + channels);
   *   2. render every chip once (fonts shaped and measured, off-screen canvases);
   *   3. replay the round's timeline (run, tired, chips, prices) on the effects layer while it is still invisible
   *      (opacity 0), in idle slices, so V8 optimises draw() and the GPU has every texture;
   *   4. one more idle turn, then the loop starts and the layer fades in over 300 ms.
   */
  private warm() {
    if (this.warmed || this.warming) return
    this.warming = true
    const stems = [CYCLE.f, ...Object.values(POSES).flat().map((p) => p.f), ...CHANNELS.map((c) => 'channel-' + c)]
    const ims = stems.map((s) => img(s, this.scale))
    const idle = (f: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(f, { timeout: 1000 }) : setTimeout(f, 16))
    const done = () => idle(() => {
      this.warming = false; this.warmed = true
      this.ctx.clearRect(0, 0, this.W, this.H)
      this.fx.style.transition = 'opacity 300ms ease-out'; this.fx.style.opacity = '1'
      this.run()
    })
    void Promise.all(ims.map((im) => im.decode().catch(() => {}))).then(() => idle(() => {
      if (!this.alive) return
      if (this.opts.reduced || !this.S) { done(); return }
      this.chips.clear(); this.prerender(this.S.walkers) // icons are decoded now: chips carry their channel mark
      const c = this.ctx; c.save(); c.globalAlpha = 0.01
      for (const im of ims) if (ready(im)) c.drawImage(im, 0, 0, 2, 2)
      c.restore()
      const S = this.S, RS = { ...this.RS }, t0 = S.walkers[0]?.start ?? this.simT, ts: number[] = []
      for (let t = t0; t <= S.end; t += 0.25) ts.push(t)
      const slice = () => {
        if (!this.alive) return
        for (const t of ts.splice(0, 12)) this.draw(t)
        if (ts.length) { idle(slice); return }
        this.RS = RS; done()
      }
      slice()
    }))
  }

  /** Plan the next round while this one plays: requestIdleCallback, setTimeout where it is missing. */
  private schedulePlan() {
    const gen = this.gen
    const k = (this.S?.k ?? Math.floor(wall() / ROUND)) + 1
    const job = () => { if (this.alive && gen === this.gen && !this.next) { this.next = this.planRound(k); this.prerender(this.next.walkers) } }
    if ('requestIdleCallback' in window) window.requestIdleCallback(job, { timeout: 3000 })
    else setTimeout(job, 200)
  }
  /** Dev/QA: plan n rounds on the current layout and count how Ahmad was placed (does not touch the live round). */
  sampleRounds(n: number) {
    const c = { far: 0, near: 0, none: 0, rerolls: 0 }, k0 = Math.floor(wall() / ROUND)
    for (let i = 0; i < n; i++) { const p = this.planRound(k0 + i); c[p.mode]++; c.rerolls += p.rerolls }
    return c
  }

  // speed profile: run → slow to a stop half-way on long trips (catches his breath) → pick up again
  private profile(w: Walker) {
    const D = w.arrive - w.start, a = w.rest ? w.start + 0.45 * (D - 2.7) : null
    const g = (t: number) => { if (a === null) return 1; if (t < a) return 1; if (t < a + 0.5) return 0.5 + 0.5 * Math.cos(((t - a) / 0.5) * Math.PI); if (t < a + 2.1) return 0; if (t < a + 2.7) return 0.5 - 0.5 * Math.cos(((t - a - 2.1) / 0.6) * Math.PI); return 1 }
    const n = Math.max(2, Math.ceil(D * 60)), cum = new Float64Array(n + 1)
    for (let i = 1; i <= n; i++) cum[i] = cum[i - 1] + g(w.start + (D * (i - 0.5)) / n)
    w.prof = { n, cum, tot: cum[n], g }
  }
  private runD(w: Walker, t: number) {
    if (t <= w.start) return 0; if (t >= w.arrive) return w.len
    const P = w.prof, u = ((t - w.start) / (w.arrive - w.start)) * P.n, i = Math.floor(u), f = u - i
    return (w.len * (P.cum[i] + (P.cum[Math.min(P.n, i + 1)] - P.cum[i]) * f)) / P.tot
  }
  private at(w: Walker, d: number): [number, number] {
    d = Math.max(0, Math.min(w.len, d)); let i = 1
    while (i < w.cum.length - 1 && w.cum[i] < d) i++
    const a = this.V[w.path[i - 1]], b = this.V[w.path[i]], f = (d - w.cum[i - 1]) / (w.cum[i] - w.cum[i - 1] || 1)
    return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f]
  }

  // ---------- drawing ----------
  private poly(w: Walker, d0: number, d1: number) {
    if (d1 <= d0) return
    const ctx = this.ctx; ctx.beginPath(); let [x, y] = this.at(w, d0); ctx.moveTo(x, y)
    for (let i = 1; i < w.cum.length; i++) if (w.cum[i] > d0 && w.cum[i] < d1) { const v = this.V[w.path[i]]; ctx.lineTo(v.x, v.y) }
    ;[x, y] = this.at(w, d1); ctx.lineTo(x, y); ctx.stroke()
  }
  private chip(key: string, make: (m: Ctx2D) => [number, number, number, number, (c: Ctx2D) => void]): Chip {
    let e = this.chips.get(key)
    if (e) return e
    if (this.chips.size > 400) this.chips.clear() // prices accumulate round after round
    const [x, y, w, h, paint] = make(this.mctx)
    const s = this.DPR, cv = surface(Math.ceil((w + PAD * 2) * s), Math.ceil((h + PAD * 2) * s)), c = cv.getContext('2d') as Ctx2D
    c.scale(s, s); c.translate(PAD - x, PAD - y); paint(c)
    e = { c: cv, x, y, w, h }; this.chips.set(key, e)
    return e
  }
  private blit(e: Chip, ax: number, ay: number) {
    const s = this.DPR, X = Math.round((ax + e.x - PAD) * s) / s, Y = Math.round((ay + e.y - PAD) * s) / s // whole device pixels: no resampling blur
    this.ctx.drawImage(e.c, X, Y, e.w + PAD * 2, e.h + PAD * 2)
  }
  private pillChip(text: string, solid: boolean) {
    return this.chip(`p${solid ? 1 : 0}|${text}`, (m) => {
      m.font = `700 11px ${FONT}`; m.direction = 'rtl'
      const w = m.measureText(text).width + 14, h = 18
      return [-w / 2, -h - 6, w, h, (c) => {
        rr(c, -w / 2, -h - 6, w, h, 9); c.fillStyle = solid ? rgba(this.back, 0.95) : rgba(this.surface, 0.95); c.fill()
        c.lineWidth = 1; c.strokeStyle = solid ? rgba(this.back, 0.95) : rgba(this.go, 0.55); c.stroke()
        c.font = `700 11px ${FONT}`; c.direction = 'rtl'; c.textAlign = 'center'; c.textBaseline = 'middle'
        c.fillStyle = solid ? rgba(this.contrastOn(this.back), 1) : rgba(this.go, 0.95); c.fillText(text, 0, -h - 6 + h / 2 + 1)
      }]
    })
  }
  private pill(x: number, y: number, text: string, solid: boolean, dot = true) {
    this.blit(this.pillChip(text, solid), x, y)
    if (dot) { const c = this.ctx; c.fillStyle = solid ? rgba(this.back, 0.95) : rgba(this.go, 0.6); c.beginPath(); c.arc(x, y, 2.6, 0, 7); c.fill() }
  }
  /** Text on a filled return-colour chip: white in the prototype; on a white return colour (accent tone) use ink. */
  private contrastOn(c: RGB): RGB { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 200 ? this.ink : this.surface }
  private docChip(k: number, lift: number, noIcon: boolean) {
    const im = img('channel-' + CHANNELS[k % CHANNELS.length], this.scale), icon = !noIcon && ready(im)
    return this.chip(`d${noIcon ? '-' : k}|${lift}|${icon ? 'i' : ''}`, (m) => {
      const label = 'طلب عرض سعر'
      m.font = `700 11px ${FONT}`; m.direction = 'rtl'
      const w = m.measureText(label).width + (noIcon ? 18 : 38), h = 22, X = -w / 2, Y = -h - lift
      return [X, Y, w, h, (c) => {
        rr(c, X, Y, w, h, 11); c.fillStyle = rgba(this.surface, 0.97); c.fill(); c.lineWidth = 1; c.strokeStyle = rgba(this.go, 0.6); c.stroke()
        c.font = `700 11px ${FONT}`; c.direction = 'rtl'; c.textBaseline = 'middle'; c.textAlign = 'right'; c.fillStyle = rgba(this.go, 1); c.fillText(label, X + w - 9, Y + h / 2 + 1)
        if (icon) c.drawImage(im, X + 3, Y + 1, 20, 20)
      }]
    })
  }
  private doc(x: number, y: number, k: number, lift = 6, noIcon = false) {
    this.blit(this.docChip(k, lift, noIcon), x, y)
    if (lift === 6) { const c = this.ctx; c.fillStyle = rgba(this.go, 0.6); c.beginPath(); c.arc(x, y, 2.6, 0, 7); c.fill() }
  }
  private supplierChip() {
    return this.chip('m', (m) => {
      m.font = `500 11px ${FONT}`; m.direction = 'rtl'
      const lw = m.measureText('مورد').width + 8
      return [-lw / 2, -1, lw, 14, (c) => {
        c.fillStyle = rgba(this.surface, 0.85); c.fillRect(-lw / 2, -1, lw, 14)
        c.font = `500 11px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'top'; c.direction = 'rtl'; c.fillStyle = rgba(this.ink2, 1); c.fillText('مورد', 0, 0)
      }]
    })
  }
  private hqChip() {
    return this.chip('hq', (m) => {
      m.font = `500 11px ${FONT}`; m.direction = 'rtl'
      const lw = m.measureText('مقر الشركة').width + 10, half = Math.max(16, lw / 2)
      return [-half, -16, half * 2, 58, (c) => {
        rr(c, -15, -15, 30, 30, 7); c.fillStyle = rgba(this.surface, 1); c.fill(); c.lineWidth = 1.4; c.strokeStyle = rgba(this.go, 0.9); c.stroke()
        c.fillStyle = rgba(this.go, 0.9); c.fillRect(-7, -8, 9, 16); c.fillRect(3, -2, 5, 10)
        c.fillStyle = rgba(this.surface, 1)
        for (const [wx, wy] of [[-5, -6], [-1.5, -6], [-5, -2.5], [-1.5, -2.5], [-5, 1], [-1.5, 1]]) c.fillRect(wx, wy, 2, 2)
        c.fillRect(-3.5, 4.5, 2.5, 3.5); c.fillRect(4.5, 0, 2, 2); c.fillRect(4.5, 3.5, 2, 2)
        c.font = `500 11px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'top'; c.direction = 'rtl'
        c.fillStyle = rgba(this.surface, 0.9); c.fillRect(-lw / 2, 26, lw, 15)
        c.fillStyle = rgba(this.ink2, 1); c.fillText('مقر الشركة', 0, 28)
      }]
    })
  }
  private bestChip(val: string) {
    return this.chip(`b|${val}`, (m) => {
      const lab = 'أرخص سعر'
      m.direction = 'rtl'; m.font = `500 12px ${FONT}`; const w1 = m.measureText(lab).width
      m.font = `700 14px ${FONT_NUM}`; const w2 = m.measureText(val).width
      const w = w1 + w2 + 34, h = 30, X = -w / 2, Y = -58
      return [X, Y, w, h, (c) => {
        rr(c, X, Y, w, h, 15); c.fillStyle = rgba(this.surface, 1); c.fill(); c.lineWidth = 1.2; c.strokeStyle = rgba(this.back, 0.95); c.stroke()
        c.direction = 'rtl'; c.textBaseline = 'middle'
        c.textAlign = 'right'; c.font = `500 12px ${FONT}`; c.fillStyle = rgba(this.ink2, 1); c.fillText(lab, X + w - 12, Y + h / 2 + 1)
        c.textAlign = 'left'; c.font = `700 14px ${FONT_NUM}`; c.fillStyle = rgba(this.ink, 1); c.fillText(val, X + 12, Y + h / 2 + 1)
      }]
    })
  }
  /** Render every chip a round can show — before it is on screen (idle time, or reset), never inside a frame. */
  private prerender(walkers: Walker[] | null) {
    for (let k = 0; k < CHANNELS.length; k++) this.docChip(k, 6, false)
    this.docChip(0, 0, true); this.supplierChip(); this.hqChip()
    for (const t of RUNNER_LABELS) this.pillChip(t, t === 'سلّم السعر ✓')
    this.pillChip(RUNNER_LABELS[0], false); this.pillChip(RUNNER_LABELS[1], false)
    if (!walkers) return
    for (const w of walkers) this.pillChip(fmt(w.price), true)
    if (walkers.length) this.bestChip(fmt(Math.min(...walkers.map((w) => w.price))))
  }

  // ---------- Ahmad ----------
  private bucketOf(deg: number) { // screen angle, y down: up (even diagonally) shows his back, down shows his face
    if (deg > -30 && deg <= 50) return 'E'; if (deg > 50 && deg <= 130) return 'S'; if (deg > 130 || deg <= -150) return 'W'; if (deg > -150 && deg <= -90) return 'NW'; return 'NE'
  }
  private steer(t: number, hx: number, hy: number, snap: boolean) {
    const RS = this.RS
    if (snap) { RS.ang = Math.atan2(hy, hx); RS.bucket = this.bucketOf((RS.ang * 180) / Math.PI); RS.prev = null; RS.fade = 1; RS.lastT = t; return }
    const dt = Math.min(0.1, Math.max(0, t - RS.lastT)); RS.lastT = t
    const target = Math.atan2(hy, hx), diff = Math.atan2(Math.sin(target - RS.ang), Math.cos(target - RS.ang)); RS.ang += diff * Math.min(1, dt * 7)
    const deg = (RS.ang * 180) / Math.PI, b = this.bucketOf(deg)
    if (b !== RS.bucket && this.bucketOf(deg - 12) === b && this.bucketOf(deg + 12) === b) { RS.prev = RS.bucket; RS.bucket = b; RS.fade = 0 } // 12° hysteresis
    RS.fade = Math.min(1, RS.fade + dt / 0.22) // 0.22 s crossfade
    let rel = 0
    if (RS.bucket === 'E') rel = RS.ang; else if (RS.bucket === 'W') rel = Math.atan2(Math.sin(RS.ang - Math.PI), Math.cos(RS.ang - Math.PI))
    const want = Math.max(-0.34, Math.min(0.34, rel * 0.45)); RS.tilt += (want - RS.tilt) * Math.min(1, dt * 6) // soft lean, capped ≈20°
  }
  private cycle(i: number, x: number, y: number, alpha: number, mirror: boolean) {
    const im = img(CYCLE.f, this.scale); if (!ready(im)) return
    const fw = im.naturalWidth / CYCLE.n, f = ((i % 6) + 6) % 6, c = this.ctx
    c.save(); c.globalAlpha = alpha; c.translate(x, y); c.rotate(this.RS.tilt); if (mirror) c.scale(-1, 1)
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
    c.save(); c.fillStyle = rgba(this.ink, 0.13); c.beginPath(); c.ellipse(x, y, 13, 3, 0, 0, 7); c.fill(); c.restore()
    if (state === 'run') {
      // measured on the run-cycle sheet: the planted foot moves back 17 px per frame → advance 17 px per frame (no slide);
      // the side cycle already rises in its flight frames, so only the single-frame views get a step bob
      const u = d / 17, fi = Math.floor(u), vi = Math.floor(u / 3), idx = (g: string) => (g === 'E' || g === 'W' ? fi : vi)
      const bob = (g: string) => (g === 'E' || g === 'W' ? 0 : Math.abs(Math.sin((u / 3) * Math.PI)) * 1.6)
      if (RS.prev && RS.fade < 1) this.pose(RS.prev, idx(RS.prev), x, y - bob(RS.prev), 1 - RS.fade)
      this.pose(RS.bucket, idx(RS.bucket), x, y - bob(RS.bucket), RS.prev && RS.fade < 1 ? RS.fade : 1); return
    }
    const side = RS.bucket === 'E' ? 'tiredR' : RS.bucket === 'W' ? 'tiredL' : 'tiredF'
    if (state === 'tired') this.pose(side, Math.floor(t * 0.7), x, y, 1, Math.sin(t * 5.5) * 0.012)
    else if (state === 'tiredFront') this.pose('tiredF', Math.floor(t * 0.6), x, y, 1, Math.sin(t * 5.5) * 0.012)
    else this.pose('present', 0, x, y, 1)
  }

  private draw(t: number) {
    const { ctx, V, E, FLOW, W, H, S, go, back } = this
    ctx.clearRect(0, 0, W, H)
    // ambient: a soft pulse on every edge, forever
    ctx.lineCap = 'round'; ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(go, 0.22); ctx.beginPath()
    for (let i = 0; i < E.length; i++) {
      const e = E[i], f = FLOW[i], per = e.L + 60, pos = ((t * f.sp + f.ph) % per) - 30
      const p0 = Math.max(0, pos - 7) / e.L, p1 = Math.min(e.L, pos + 7) / e.L
      if (p1 <= 0 || p0 >= 1) continue
      let a = V[e.a], b = V[e.b]; if (f.rev) { const c = a; a = b; b = c }
      ctx.moveTo(a.x + (b.x - a.x) * p0, a.y + (b.y - a.y) * p0); ctx.lineTo(a.x + (b.x - a.x) * Math.min(1, p1), a.y + (b.y - a.y) * Math.min(1, p1))
    }
    ctx.stroke()
    if (!this.story || !S) { this.shield(ctx); return }
    ctx.lineCap = 'round'; ctx.lineWidth = 1.2
    let got = 0, RUN: Walker | null = null
    for (const w of S.walkers) {
      if (t >= w.done) got++
      const ease = w.runner ? (x: number) => x : (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)
      const dOut = w.runner ? this.runD(w, t) : t < w.start ? 0 : w.len * ease(Math.min(1, (t - w.start) / (w.arrive - w.start)))
      // outbound: dashed request line
      ctx.setLineDash([4, 5]); ctx.strokeStyle = rgba(go, 0.32); ctx.lineWidth = 1.2; this.poly(w, 0, dOut); ctx.setLineDash([])
      if (w.runner && t < w.arrive) { ctx.fillStyle = rgba(go, 0.45); for (let d = Math.ceil((dOut + 6) / 12) * 12; d < w.len; d += 12) { const [px, py] = this.at(w, d); ctx.beginPath(); ctx.arc(px, py, 1.6, 0, 7); ctx.fill() } }
      ctx.fillStyle = rgba(go, 0.32)
      for (let i = 1; i < w.path.length; i++) if (w.cum[i] <= dOut) { const v = V[w.path[i]]; ctx.beginPath(); ctx.arc(v.x, v.y, 1.8, 0, 7); ctx.fill() }
      // return: the same path in the return colour
      let dBack = 0
      if (t >= w.tc) { dBack = w.len * (1 - ease(Math.min(1, (t - w.tc) / (w.home - w.tc)))); ctx.strokeStyle = rgba(back, 0.75); ctx.lineWidth = 1.6; this.poly(w, dBack, w.len) }
      // supplier: a ring labelled «مورد» that fills on arrival
      {
        const v = V[w.target], hit = t >= w.arrive, gold = t >= w.tc
        ctx.lineWidth = 1.2; ctx.strokeStyle = gold ? rgba(back, 0.9) : hit ? rgba(go, 0.75) : rgba(go, 0.5); ctx.fillStyle = gold ? rgba(back, 0.8) : hit ? rgba(go, 0.6) : rgba(this.surface, 1)
        ctx.beginPath(); ctx.arc(v.x, v.y, 5, 0, 7); ctx.fill(); ctx.stroke()
        this.blit(this.supplierChip(), Math.min(W - 16, Math.max(16, v.x)), v.y > H - 24 ? v.y - 22 : v.y + 8)
      }
      if (w.runner) { RUN = w; continue }
      if (t >= w.start && t < w.arrive) { const [x, y] = this.at(w, dOut); this.doc(x, y, w.ch) }
      else if (t >= w.arrive && t < w.tc) { const v = V[w.target]; this.pill(v.x, v.y, fmt(w.price), true) }
      else if (t >= w.tc && t < w.home) { const [x, y] = this.at(w, dBack); this.pill(x, y, fmt(w.price), true) }
    }
    if (RUN) {
      const w = RUN, RS = this.RS
      const dBack = t >= w.tc ? w.len * (1 - Math.min(1, (t - w.tc) / (w.home - w.tc))) : 0
      let d = 0, state: string | null = null, head: [number, number] | null = null
      if (t < w.start) { d = 0; state = 'present' }
      else if (t < w.arrive) { d = this.runD(w, t); state = w.prof.g(t) < 0.12 ? 'tired' : 'run'; const a2 = this.at(w, Math.min(w.len, d + 16)), p2 = this.at(w, d); head = [a2[0] - p2[0], a2[1] - p2[1]] }
      else if (t < w.arrive + 1.1) { d = w.len; state = 'tiredFront' }
      else if (t < w.tc) { d = w.len; state = 'present' }
      else if (t < w.home) { d = dBack; state = 'run'; const a2 = this.at(w, Math.max(0, d - 16)), p2 = this.at(w, d); head = [a2[0] - p2[0], a2[1] - p2[1]] }
      else if (t < w.done) { d = Math.min(w.len, 30); state = 'tiredFront' } // catches his breath next to the head office
      if (state) {
        if (head && (head[0] || head[1])) this.steer(t, head[0], head[1], state === 'run' && RS.lastState !== 'run' && RS.lastState !== 'tired')
        else { RS.lastT = t; RS.tilt *= 0.85 }
        RS.lastState = state
        // odometer: distance actually covered either way, so the stride plays forwards on the way back too
        if (RS.lastD >= 0 && Math.abs(d - RS.lastD) < 80) RS.odo += Math.abs(d - RS.lastD)
        RS.lastD = d
        const pos = this.at(w, d); this.runner(pos[0], pos[1] + 1, RS.odo, state, t)
        const cy = Math.max(30, pos[1] - 76)
        if (t >= w.start && t < w.arrive) this.doc(pos[0], cy, 0, 0, true)
        else if (t >= w.arrive && t < w.arrive + 1.1) this.pill(pos[0], cy + 6, 'وصل… يلتقط أنفاسه', false, false)
        else if (t >= w.arrive && t < w.tc - 0.9) this.pill(pos[0], cy + 6, 'يسعّر عند المورد…', false, false)
        else if (t >= w.arrive && t < w.home) this.pill(pos[0], cy + 6, fmt(w.price), true, false)
        else if (t >= w.home && t < w.done) this.pill(pos[0], cy + 6, 'سلّم السعر ✓', true, false)
      }
    }
    const C = V[this.S_client]; this.blit(this.hqChip(), C.x, C.y)
    const n = S.walkers.length; ctx.lineWidth = 2; ctx.strokeStyle = rgba(back, 0.9)
    for (let k = 0; k < got; k++) { const a0 = -Math.PI / 2 + (k * TAU) / n + 0.08, a1 = a0 + TAU / n - 0.16; ctx.beginPath(); ctx.arc(C.x, C.y, 22, a0, a1); ctx.stroke() }
    if (t >= S.allHome && n) this.blit(this.bestChip(fmt(S.best)), C.x, C.y) // «أرخص سعر»
    this.shield(ctx)
  }

  // ---------- clock: pauses with the page / off-screen; reduced motion = static mesh only ----------
  private loop = (now: number) => {
    this.last = now; this.simT = (performance.timeOrigin + now) / 1000 // the shared clock, not time since this page loaded
    const t0 = performance.now()
    if (this.story && this.simT >= this.S.end) this.sync(this.simT, true)
    this.draw(this.simT)
    this.times[this.nTimes++ % this.times.length] = performance.now() - t0
    this.raf = requestAnimationFrame(this.loop)
  }
  private run() {
    cancelAnimationFrame(this.raf); this.raf = 0
    if (!this.alive || this.opts.reduced) { this.ctx.clearRect(0, 0, this.W, this.H); return }
    if (!this.warmed) { this.warm(); return } // starts the loop when done
    if (!document.hidden && this.onScreen) {
      this.simT = wall(); if (this.story) this.sync(this.simT, false) // back from a hidden tab: join the current round outside a frame
      this.last = performance.now(); this.raf = requestAnimationFrame(this.loop)
    }
  }
}
