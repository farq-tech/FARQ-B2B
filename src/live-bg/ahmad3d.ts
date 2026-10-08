/*
 * Ahmad 3D (Meshy model, owner 2026-10-08): one sheet, 16-frame run cycle x 8 directions (rows in DIRS order) and a
 * standing row (S, SE, SW). Rendered by the owner with a fixed camera (ortho 2.05, 22 deg elevation); the scripts and
 * the sprite JSON are in docs/handoff/ahmad-3d/. Frame = floor(distance / 7.2 px) so the planted foot keeps pace with
 * the ground; shown 82 px tall. The 2D illustrations stay available behind AHMAD (flag) for a quick way back.
 */
const URLS = import.meta.glob<string>('../assets/live-bg/ahmad3d-run-sheet.webp', { eager: true, import: 'default', query: '?no-inline' })

/** '3d' (default) or '2d' (the old illustrations); ?ahmad=2d in the page URL switches back for a check. */
export const AHMAD: '2d' | '3d' = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ahmad') === '2d' ? '2d' : '3d'

export type Dir8 = 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE'
const R3 = { fw: 111, fh: 160, n: 16, dirs: ["S", "SE", "E", "NE", "N", "NW", "W", "SW"] as Dir8[], stand: ["S", "SE", "SW"] as Dir8[], anchor: {"S":[55.3,143.6],"SE":[57.2,143.3],"E":[58.0,142.5],"NE":[57.2,141.8],"N":[55.2,141.5],"NW":[53.3,141.8],"W":[52.5,142.6],"SW":[53.3,143.3],"stand_S":[55.0,143.1],"stand_SE":[56.0,143.0],"stand_SW":[54.1,142.8]} as Record<string, [number, number]> }
export const R3H = 82, STRIDE3 = 7.2
const R3S = R3H / R3.fh

/** Screen angle (y down): 0 = E, 90 = S. */
export function bucket8(deg: number): Dir8 { const D: Dir8[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']; return D[((Math.round(deg / 45) % 8) + 8) % 8] }

let sheet: HTMLImageElement | null = null
export function sheet3(): HTMLImageElement {
  if (!sheet) { sheet = new Image(); sheet.decoding = 'async'; sheet.src = Object.values(URLS)[0] }
  return sheet
}
const ready = (im: HTMLImageElement) => im.complete && im.naturalWidth > 0
function frame3(ctx: CanvasRenderingContext2D, row: number, col: number, anchor: string, x: number, y: number, alpha: number) {
  const im = sheet3(); if (!ready(im)) return
  const a = R3.anchor[anchor]
  ctx.save(); ctx.globalAlpha = alpha
  ctx.drawImage(im, col * R3.fw, row * R3.fh, R3.fw, R3.fh, x - a[0] * R3S, y - a[1] * R3S, R3.fw * R3S, R3.fh * R3S)
  ctx.restore()
}
/** One running frame; dist is the distance actually covered (odometer), so the cycle never plays backwards. */
export function run3(ctx: CanvasRenderingContext2D, dir: Dir8, dist: number, x: number, y: number, alpha = 1) {
  const fi = Math.floor(dist / STRIDE3)
  frame3(ctx, R3.dirs.indexOf(dir), ((fi % R3.n) + R3.n) % R3.n, dir, x, y, alpha)
}
/** Standing still (at the supplier, at the head office): faces S, or turned towards the side he was going. */
export function stand3(ctx: CanvasRenderingContext2D, x: number, y: number, dir: Dir8) {
  const face: Dir8 = dir === 'E' || dir === 'SE' || dir === 'NE' ? 'SE' : dir === 'W' || dir === 'SW' || dir === 'NW' ? 'SW' : 'S'
  const k = Math.max(0, R3.stand.indexOf(face))
  frame3(ctx, R3.dirs.length, k, 'stand_' + R3.stand[k], x, y, 1)
}
