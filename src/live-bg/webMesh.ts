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
  const cycle = t % 26, returning = cycle >= 12 && cycle < 24
  const frontier = returning ? 1100 * (1 - (cycle - 12) / 12) : 1100 * Math.min(1, cycle / 12)
  const fade = cycle > 24 ? (26 - cycle) / 2 : Math.min(1, cycle / 1.2)
  const packets = new Map<number, { x: number; y: number; score: number }>()
  ctx.save(); ctx.globalAlpha = fade; ctx.lineWidth = 1.4; ctx.lineCap = 'round'
  ctx.strokeStyle = returning ? back : go; ctx.beginPath()
  for (const e of edges) {
    const a = points[e.a], b = points[e.b]
    if (Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) continue
    const diff = b.d - a.d
    if (Math.abs(diff) < 1) continue
    const f = (frontier - a.d) / diff
    if (f < 0 || f > 1) continue
    const start = Math.max(0, f - 16 / e.L), end = Math.min(1, f + 3 / e.L)
    const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f
    const side = a.side ?? 0, score = Math.abs(y - (y0 + y1) / 2)
    if (y >= y0 + 20 && y <= y1 - 20 && (!packets.has(side) || score < packets.get(side)!.score)) packets.set(side, { x, y, score })
    ctx.moveTo(a.x + (b.x - a.x) * start, a.y + (b.y - a.y) * start)
    ctx.lineTo(a.x + (b.x - a.x) * end, a.y + (b.y - a.y) * end)
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
  const stamp = returning ? stamps.quote : stamps.request
  if (stamp) { ctx.globalAlpha = fade * 0.85; for (const p of packets.values()) ctx.drawImage(stamp, p.x - 18, p.y - 10, 36, 20) }
  ctx.restore()
}

const stamps: { request: HTMLCanvasElement | null; quote: HTMLCanvasElement | null } = { request: null, quote: null }
function prepareStamps() {
  if (stamps.request || typeof document === 'undefined') return
  const make = (word: string, color: number[]) => {
    const c = document.createElement('canvas'); c.width = 72; c.height = 40
    const x = c.getContext('2d')!; x.scale(2, 2)
    x.fillStyle = ink(color, 0.08); x.strokeStyle = ink(color, 0.65); x.lineWidth = 0.7
    x.beginPath(); x.roundRect(1, 1, 34, 18, 6); x.fill(); x.stroke()
    x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '600 11px Tajawal, sans-serif'; x.fillStyle = ink(color, 0.95); x.fillText(word, 18, 10)
    return c
  }
  stamps.request = make('طلب', searchInk); stamps.quote = make('عرض', opportunityInk)
}
