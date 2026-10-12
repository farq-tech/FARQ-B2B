const ink = (rgb: number[], alpha: number) => `rgba(${rgb.join(',')},${alpha})`
const searchInk = [16, 139, 160], opportunityInk = [187, 135, 71]
export const WEB_INK = { line: ink(searchInk, 0.22), go: ink(searchInk, 0.55), back: ink(opportunityInk, 0.58) }
type Edge = { a: number; b: number; L: number }
export function webMesh(W: number, H: number, VH: number = H) {
      prepareStamps()
      const points: Array<{ x: number; y: number; d: number; side: number }> = [], edges: Edge[] = []
      const add = (a: number, b: number) => edges.push({ a, b, L: Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) })
      const rays = W < 640 ? 7 : 10, factor = W < 640 ? 0.65 : 1
      for (let y = VH * 0.35; y < H + VH; y += VH * 1.6) for (const side of [0, 1]) {
        const x = side ? W + 36 : -36, rings: number[][] = []
        for (const radius of [70, 145, 250, 390, 570, 790, 1050]) {
          const ring: number[] = []
          for (let j = 0; j <= rays; j++) {
            const angle = -Math.PI / 2 + j * Math.PI / rays + (side ? Math.PI : 0)
            const r = radius * factor * (1 + 0.035 * Math.sin(j * 5 + radius))
            ring.push(points.length); points.push({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r, d: radius, side })
            if (j > 0) add(ring[j - 1], ring[j])
            if (rings.length) add(rings[rings.length - 1][j], ring[j])
          }
          rings.push(ring)
        }
      }
  return { points, edges }
}

const connectedNodes = new WeakMap<Edge[], Set<number>>()

/** A quiet frontier expands from both sides, lights new junctions, then brings opportunities back. */
export function drawWebExpansion(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number; d: number; side?: number }>, edges: Edge[],
  t: number, go: string, back: string, y0 = 0, y1 = Infinity,
) {
  let connected = connectedNodes.get(edges)
  if (!connected) { connected = new Set(edges.flatMap((e) => [e.a, e.b])); connectedNodes.set(edges, connected) }
  const width = ctx.canvas.width / Math.min(2, window.devicePixelRatio || 1)
  const reach = width < 640 ? 790 : 1100
  const cycle = (t + 3) % 26, returning = cycle >= 12 && cycle < 24
  const frontier = returning ? reach * (1 - (cycle - 12) / 12) : reach * Math.min(1, cycle / 12)
  const fade = cycle > 24 ? (26 - cycle) / 2 : Math.min(1, cycle / 1.2)
  const packets = new Map<number, { x: number; y: number; score: number; icon: number }>()
  const slots = width < 640 ? 2 : 3
  ctx.save(); ctx.globalAlpha = fade; ctx.lineWidth = 1.4; ctx.lineCap = 'round'
  ctx.strokeStyle = returning ? back : go; ctx.beginPath()
  for (const e of edges) {
    const a = points[e.a], b = points[e.b]
    if (Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) continue
    const diff = b.d - a.d
    if (Math.abs(diff) < 1) continue
    for (const wave of [0, 160]) {
    const travel = (frontier + (returning ? -wave : wave) + reach) % reach
    const f = (travel - a.d) / diff
    if (f < 0 || f > 1) continue
    const start = Math.max(0, f - 16 / e.L), end = Math.min(1, f + 3 / e.L)
    const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f
    const side = a.side ?? 0, slot = Math.max(0, Math.min(slots - 1, Math.floor((y - y0) / (y1 - y0) * slots)))
    const key = side * slots + slot, score = Math.abs(y - (y0 + (slot + 0.5) * (y1 - y0) / slots))
    if (x >= 16 && x <= width - 16 && y >= y0 + 24 && y <= y1 - 24 && (!packets.has(key) || score < packets.get(key)!.score)) packets.set(key, { x, y, score, icon: (side + slot + Math.floor(t / 26)) % 4 })
    ctx.moveTo(a.x + (b.x - a.x) * start, a.y + (b.y - a.y) * start)
    ctx.lineTo(a.x + (b.x - a.x) * end, a.y + (b.y - a.y) * end)
    }
  }
  ctx.stroke(); ctx.fillStyle = returning ? back : go
  for (let i = 0; i < points.length; i++) {
    if (!connected.has(i)) continue
    const p = points[i]
    if (p.y < y0 || p.y > y1) continue
    const age = returning ? (p.d - frontier) / 92 : (frontier - p.d) / 92
    if (age < 0 || age > 2.5) continue
    ctx.globalAlpha = fade * (1 - age / 2.5)
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = fade * (1 - age / 2.5) * 0.4
    ctx.beginPath(); ctx.arc(p.x, p.y, 3 + age * 3, 0, Math.PI * 2); ctx.stroke()
  }
  const atlas = returning ? stamps.back : stamps.go
  ctx.globalAlpha = fade * 0.92
  const drawn: Array<{ x: number; y: number }> = []
  for (const p of packets.values()) {
    if (drawn.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 94)) continue
    const stamp = atlas[p.icon]
    if (stamp) { ctx.drawImage(stamp, p.x - 35, p.y - 13, 70, 26); drawn.push(p) }
  }
  ctx.restore()
}

const stamps: { go: HTMLCanvasElement[]; back: HTMLCanvasElement[] } = { go: [], back: [] }
function prepareStamps() {
  if (stamps.go.length || typeof document === 'undefined') return
  const labels = ['تسويق', 'تسعير', 'استفسار', 'عرض']
  const make = (label: string, color: number[]) => {
    const c = document.createElement('canvas'); c.width = 140; c.height = 52
    const x = c.getContext('2d')!; x.scale(2, 2)
    x.fillStyle = ink([255, 255, 255], 0.96); x.strokeStyle = ink(color, 0.8); x.lineWidth = 1
    x.beginPath(); x.roundRect(1, 1, 68, 24, 12); x.fill(); x.stroke()
    x.font = '600 12px sans-serif'; x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'middle'
    x.fillStyle = ink(color, 1); x.fillText(label, 35, 13)
    return c
  }
  // Shape text once; the animation draws only cached images.
  stamps.go = labels.map(label => make(label, searchInk))
  stamps.back = labels.map(label => make(label, opportunityInk))
}
