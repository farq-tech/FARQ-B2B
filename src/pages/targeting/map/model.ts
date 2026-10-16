import { waNumber, type DistrictFeature, type TargetRow } from '../../../api/targetingClient'
import { MAINS, SUBS } from './taxonomy.data'

/*
 * خريطة الفرص v2 — the pure part: taxonomy path of a row, the three map layers, districts (point in polygon),
 * the live counters and the guide tree. No contact field ever leaves this file: names are cleaned of digit runs.
 */

export type Layer = 'main' | 'sub' | 'spec'
export const LAYERS: { key: Layer; label: string }[] = [
  { key: 'main', label: 'الأنشطة الرئيسية' },
  { key: 'sub', label: 'الأنشطة الفرعية' },
  { key: 'spec', label: 'التخصصات' },
]
/** A guide-tree pick: one main, one sub or one specialty name. */
export type Focus = { level: Layer; id: string } | null

/** 7+ digits in a row (Latin or Arabic-Indic, spaces / dashes / + between them) = a phone number: never shown. */
const DIGIT_RUN = /\+?[\d٠-٩۰-۹](?:[\s\-.]*[\d٠-٩۰-۹]){6,}/g
export function safeName(r: Pick<TargetRow, 'name_ar' | 'name_en'>): string {
  const raw = r.name_ar || r.name_en || ''
  const out = raw.replace(DIGIT_RUN, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-|،,:]+|[\s\-|،,:]+$/g, '').trim()
  return out || 'منشأة بدون اسم'
}

export const subIdOf = (r: TargetRow) => (r.taxonomy_sub && SUBS[r.taxonomy_sub] ? r.taxonomy_sub : null)
export const mainIdOf = (r: TargetRow) => { const s = subIdOf(r); const m = s ? s.split('.')[0] : null; return m && MAINS[m] ? m : 'unc' }
export const mainAr = (id: string) => MAINS[id]?.[0] || 'غير مصنّف'
export const subAr = (id: string | null) => (id ? SUBS[id]?.[0] : null) || null
export const mainIcon = (id: string) => MAINS[id]?.[1] || 'help-circle'
export const subIcon = (id: string | null) => (id ? SUBS[id]?.[1] : null) || 'map-pin'

/** Role badges in a fixed order; «جملة» also when the business says it sells wholesale. */
export const ROLE_ORDER = ['يبيع', 'يشتري', 'جملة', 'تجزئة', 'مصنع', 'خدمات وتنفيذ'] as const
export function rolesOf(r: TargetRow): string[] {
  const set = new Set(r.role_badges || [])
  if (r.is_wholesale) set.add('جملة')
  const rank = (x: string) => { const i = (ROLE_ORDER as readonly string[]).indexOf(x); return i < 0 ? 99 : i }
  return [...set].sort((a, b) => rank(a) - rank(b))
}
export const specsOf = (r: TargetRow) => (r.specialties || []).filter(Boolean)
export const hasPoint = (r: TargetRow) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && r.latitude != null && r.longitude != null
export const completenessOf = (r: TargetRow): number | null => {
  const v = r.completeness ?? r.completeness_pct
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null
}

// ---------- districts
export type District = { id: string; ar: string; feature: DistrictFeature | null; bbox: [number, number, number, number] | null }

function ringsOf(f: DistrictFeature): number[][][][] {
  const g = f.geometry
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates
}
function inRing(x: number, y: number, ring: number[][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export function inFeature(lon: number, lat: number, d: District): boolean {
  if (!d.feature || !d.bbox) return false
  const [w, s, e, n] = d.bbox
  if (lon < w || lon > e || lat < s || lat > n) return false
  return ringsOf(d.feature).some((poly) => inRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lon, lat, hole)))
}
export function bboxOf(f: DistrictFeature): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const poly of ringsOf(f)) for (const [x, y] of poly[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y }
  return [w, s, e, n]
}
export function districtsFrom(fc: GeoJSON.FeatureCollection | null | undefined): District[] {
  return ((fc?.features || []) as DistrictFeature[])
    .filter((f) => f?.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') && f.properties?.ar)
    .map((f) => ({ id: String(f.properties.id ?? f.properties.ar), ar: f.properties.ar, feature: f, bbox: bboxOf(f) }))
}
/** Cities without polygons: the districts of the search answer, matched by name. */
export const districtsFromNames = (names: { name: string }[]): District[] => names.map((d) => ({ id: `name:${d.name}`, ar: d.name, feature: null, bbox: null }))

const norm = (s: string | null | undefined) => (s || '').replace(/^(حي|حى)\s+/, '').replace(/[ةه]$/, 'ه').replace(/[أإآ]/g, 'ا').trim()
/** Is the row inside one of the chosen districts? A point uses its polygon; a row without a point (or a polygon) its district name. */
export function inDistricts(r: TargetRow, chosen: District[]): boolean {
  if (!chosen.length) return false
  if (hasPoint(r)) {
    const poly = chosen.filter((d) => d.feature)
    if (poly.length && poly.some((d) => inFeature(r.longitude!, r.latitude!, d))) return true
  }
  const name = norm(r.district_ar)
  return Boolean(name) && chosen.some((d) => norm(d.ar) === name)
}

// ---------- focus (guide tree) and the visible cohort
export function matchesFocus(r: TargetRow, focus: Focus): boolean {
  if (!focus) return true
  if (focus.level === 'main') return mainIdOf(r) === focus.id
  if (focus.level === 'sub') return subIdOf(r) === focus.id
  return specsOf(r).includes(focus.id)
}

// ---------- counters
export type Counters = { n: number; districts: number; subs: number; specs: number; wholesale: number; factory: number; whatsapp: number; cr: number }
export const COUNTERS: { key: keyof Counters; label: string; lead?: boolean }[] = [
  { key: 'n', label: 'المنشآت', lead: true },
  { key: 'districts', label: 'الأحياء المختارة' },
  { key: 'subs', label: 'الأنشطة الفرعية' },
  { key: 'specs', label: 'التخصصات' },
  { key: 'wholesale', label: 'جملة' },
  { key: 'factory', label: 'مصانع' },
  { key: 'whatsapp', label: 'قناة واتساب' },
  { key: 'cr', label: 'سجل تجاري' },
]
export function countersOf(rows: TargetRow[], districts: number): Counters {
  const subs = new Set<string>(), specs = new Set<string>()
  let wholesale = 0, factory = 0, whatsapp = 0, cr = 0
  for (const r of rows) {
    const s = subIdOf(r); if (s) subs.add(s)
    for (const x of specsOf(r)) specs.add(x)
    const roles = rolesOf(r)
    if (roles.includes('جملة')) wholesale++
    if (roles.includes('مصنع')) factory++
    if (waNumber(r)) whatsapp++
    if (r.saudi_registered || r.cr_number || r.commercial_license) cr++
  }
  return { n: rows.length, districts, subs: subs.size, specs: specs.size, wholesale, factory, whatsapp, cr }
}

// ---------- guide tree: main ▸ sub ▸ specialty with counts
export type GuideSub = { id: string; ar: string; n: number; specs: { name: string; n: number }[] }
export type GuideMain = { id: string; ar: string; n: number; subs: GuideSub[] }
export function guideOf(rows: TargetRow[]): GuideMain[] {
  const mains = new Map<string, { n: number; subs: Map<string, { n: number; specs: Map<string, number> }> }>()
  for (const r of rows) {
    const m = mainIdOf(r), s = subIdOf(r) || `${m}.?`
    const mm = mains.get(m) || { n: 0, subs: new Map() }; mains.set(m, mm); mm.n++
    const ss = mm.subs.get(s) || { n: 0, specs: new Map() }; mm.subs.set(s, ss); ss.n++
    for (const x of specsOf(r)) ss.specs.set(x, (ss.specs.get(x) || 0) + 1)
  }
  return [...mains.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, mm]) => ({
    id, ar: mainAr(id), n: mm.n,
    subs: [...mm.subs.entries()].sort((a, b) => b[1].n - a[1].n).map(([sid, ss]) => ({
      id: sid, ar: subAr(sid) || 'نشاط غير محدد', n: ss.n,
      specs: [...ss.specs.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
    })),
  }))
}

// ---------- pins
export type Pin = { key: string; lon: number; lat: number; layer: Layer; icon: string; text: string; chosen: boolean }
export function pinsOf(rows: TargetRow[], layer: Layer, chosen: Set<string>, focus: Focus): Pin[] {
  const out: Pin[] = []
  for (const r of rows) {
    if (!hasPoint(r)) continue
    const spec = focus?.level === 'spec' ? focus.id : specsOf(r)[0]
    if (layer === 'spec' && !spec) continue
    const m = mainIdOf(r), s = subIdOf(r)
    out.push({ key: r.poi_key, lon: r.longitude!, lat: r.latitude!, layer, icon: layer === 'main' ? mainIcon(m) : subIcon(s), text: layer === 'spec' ? spec! : '', chosen: chosen.has(r.poi_key) })
  }
  return out
}

/** Great-circle distance in km. */
export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
