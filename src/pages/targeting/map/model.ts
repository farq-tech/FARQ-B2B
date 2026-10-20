import { waNumber, type DistrictFeature, type StreetDensityProps, type StreetLine, type TargetRow } from '../../../api/targetingClient'
import { formatNumber } from '../../../lib/formatNumber'
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
/** A guide-tree pick: one main, one sub or one specialty scoped to its parent subcategory. */
export type Focus = { level: 'main'; id: string } | { level: 'sub'; id: string } | { level: 'spec'; id: string; sub_id?: string } | null

/** 7+ digits in a row (Latin or Arabic-Indic, spaces / dashes / + between them) = a phone number: never shown. */
const DIGIT_RUN = /\+?[\d٠-٩۰-۹](?:[\s\-.]*[\d٠-٩۰-۹]){6,}/g
export function safeName(r: Pick<TargetRow, 'name_ar' | 'name_en'>): string {
  const raw = r.name_ar || r.name_en || ''
  const out = raw.replace(DIGIT_RUN, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-|،,:]+|[\s\-|،,:]+$/g, '').trim()
  return out || 'منشأة بدون اسم'
}

/** Location fields occasionally arrive as serialized empty objects; never print transport debris as a place name. */
export function safeLocationName(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    if (text.startsWith('{') || text.startsWith('[')) {
      try { return safeLocationName(JSON.parse(text)) } catch { return null }
    }
    return text
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  for (const key of ['name_ar', 'district_ar', 'name', 'ar', 'name_en', 'district_en', 'en']) {
    const name = safeLocationName(record[key])
    if (name) return name
  }
  return null
}

export const subIdOf = (r: TargetRow) => (r.taxonomy_sub && SUBS[r.taxonomy_sub] ? r.taxonomy_sub : null)
export const mainIdOf = (r: TargetRow) => { const s = subIdOf(r); const m = s ? s.split('.')[0] : null; return m && MAINS[m] ? m : 'unc' }
export const mainAr = (id: string) => MAINS[id]?.[0] || 'غير مصنّف'
export const subAr = (id: string | null) => (id ? SUBS[id]?.[0] : null) || null
export const mainIcon = (id: string) => MAINS[id]?.[1] || 'help-circle'
export const subIcon = (id: string | null) => (id ? SUBS[id]?.[1] : null) || 'map-pin'

/** Pick a small semantic glyph for a specialty; fall back to its parent activity icon. */
export function specialtyIcon(name: string, parentSubId: string): string {
  const text = name.toLowerCase().replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا')
  const rules: [RegExp, string][] = [
    [/مواسير|انابيب|سباك|خلاط|حنفيه|صحي|مياه|water|pipe|plumb|mixer|tap/, 'droplet'],
    [/دهان|طلاء|بويات|paint|coating/, 'paint'],
    [/كهرب|اسلاك|قواطع|افياش|مقابس|elect|circuit|socket|wire/, 'bolt'],
    [/اناره|اضاءه|مصابيح|كشاف|lighting|lamp/, 'lamp'],
    [/خشب|نجاره|wood|timber/, 'wood'],
    [/زجاج|glass/, 'glass'],
    [/ابواب|باب|door/, 'door'],
    [/تكييف|مكيف|تبريد|تدفئه|air.condition|hvac|cooling/, 'air-conditioning'],
    [/ادوات|عدد|معدات|مفكات|مسامير|tools|hardware/, 'tools'],
    [/قهوه|بن|coffee|espresso/, 'coffee'],
    [/خبز|مخبوز|مخبز|معجنات|bread|bakery/, 'bread'],
    [/اسماك|سمك|بحري|fish|seafood/, 'fish'],
    [/لحوم|لحوم|ذبائح|دجاج|لحوم|meat|butcher|poultry/, 'meat'],
    [/خضار|جزر|carrot/, 'carrot'],
    [/فواكه|تفاح|apple|fruit/, 'apple'],
    [/البان|حليب|اجبان|milk|dairy|cheese/, 'milk'],
    [/جوال|هاتف|محمول|mobile|phone/, 'device-mobile'],
    [/حاسب|كمبيوتر|لابتوب|computer|laptop/, 'device-laptop'],
    [/ملابس|ازياء|ثياب|shirt|fashion/, 'shirt'],
    [/خياطه|تفصيل|تطريز|needle|tailor/, 'needle-thread'],
    [/دواء|ادويه|صيدليه|علاج|medicine|pharmacy|pill/, 'pill'],
    [/زهور|ورد|نبات|flower|plant/, 'flower'],
    [/مصنع|تصنيع|factory|manufactur/, 'building-factory'],
    [/نقل|شحن|توصيل|لوجست|truck|shipping|delivery/, 'truck-delivery'],
    [/اثاث|كنب|ارائك|sofa|furniture/, 'sofa'],
    [/تصوير|كاميرا|camera|photography/, 'camera'],
    [/مستودع|تخزين|warehouse|storage/, 'building-warehouse'],
    [/فيش|قابس|plug/, 'plug'],
    [/قص|مقص|scissor/, 'scissors'],
  ]
  return rules.find(([pattern]) => pattern.test(text))?.[1] || subIcon(parentSubId)
}

/** Role badges in a fixed order; «جملة» also when the business says it sells wholesale. */
export const ROLE_ORDER = ['يبيع', 'يشتري', 'جملة', 'تجزئة', 'مصنع', 'خدمات وتنفيذ'] as const
export function rolesOf(r: TargetRow): string[] {
  // The service may include a family's possible roles on every place in that family.
  // When present, the place-level wholesale flag is the factual value.
  const set = new Set((r.role_badges || []).filter((role) => role !== 'جملة' || r.is_wholesale == null || r.is_wholesale))
  if (r.is_wholesale === true) set.add('جملة')
  const rank = (x: string) => { const i = (ROLE_ORDER as readonly string[]).indexOf(x); return i < 0 ? 99 : i }
  return [...set].sort((a, b) => rank(a) - rank(b))
}
export const specsOf = (r: TargetRow) => (r.specialties || []).filter(Boolean)
/** Only an explicit point location belongs on the map; approximate coordinates stay list-only. */
export const hasPoint = (r: TargetRow) => r.location_precision === 'point' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && r.latitude != null && r.longitude != null
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
export const districtsFromNames = (names: { name: string }[]): District[] => names.flatMap((d) => {
  const ar = safeLocationName(d?.name)
  return ar ? [{ id: `name:${ar}`, ar, feature: null, bbox: null }] : []
})

const norm = (s: string | null | undefined) => (s || '').replace(/^(حي|حى)\s+/, '').replace(/[ةه]$/, 'ه').replace(/[أإآ]/g, 'ا').trim()
/** Is the row inside a chosen district? Precise points use valid polygons; district names cover rows or districts without usable geometry. */
export function inDistricts(r: TargetRow, chosen: District[]): boolean {
  if (!chosen.length) return false
  const name = norm(safeLocationName(r.district_ar))
  if (hasPoint(r)) {
    const polygons = chosen.filter((d) => d.feature && d.bbox)
    if (polygons.length && polygons.some((d) => inFeature(r.longitude!, r.latitude!, d))) return true
    // A precise point outside a selected polygon must not be brought back by a stale district label.
    // Name matching remains available only for selected districts without usable geometry.
    const nameOnlyDistricts = polygons.length ? chosen.filter((d) => !d.feature || !d.bbox) : chosen
    return Boolean(name) && nameOnlyDistricts.some((d) => norm(d.ar) === name)
  }
  return Boolean(name) && chosen.some((d) => norm(d.ar) === name)
}

// ---------- focus (guide tree) and the visible cohort
export function matchesFocus(r: TargetRow, focus: Focus): boolean {
  if (!focus) return true
  if (focus.level === 'main') return mainIdOf(r) === focus.id
  if (focus.level === 'sub') return subIdOf(r) === focus.id
  if (focus.level === 'spec') return specsOf(r).includes(focus.id) && (!focus.sub_id || subIdOf(r) === focus.sub_id)
  return false
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
  { key: 'whatsapp', label: 'إشارة واتساب من المصدر' },
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
// Pins communicate activity taxonomy and selection only. The map does not present or
// apply an unverified automated suitability score to a commercial decision.
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

// ---------- dense streets (POST /street-density) and district density (choropleth)
export type Street = {
  id: string
  props: StreetDensityProps
  lines: number[][][]
  /** a point half-way along the longest piece: where the label pill sits */
  mid: [number, number]
  bbox: [number, number, number, number]
}
const segLen = (a: number[], b: number[]) => Math.hypot((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1])
function halfway(line: number[][]): [number, number] {
  const total = line.slice(1).reduce((s, p, i) => s + segLen(line[i], p), 0)
  let left = total / 2
  for (let i = 1; i < line.length; i++) {
    const d = segLen(line[i - 1], line[i])
    if (d >= left && d > 0) { const t = left / d; return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t] }
    left -= d
  }
  return [line[0][0], line[0][1]]
}
export function streetsFrom(fc: { features?: StreetLine[] } | null | undefined): Street[] {
  const seen = new Set<string>()
  return (fc?.features || []).filter((f) => f?.geometry && f.properties?.street_ar).map((f) => {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates
    const longest = [...lines].sort((a, b) => b.reduce((s, p, k) => s + (k ? segLen(b[k - 1], p) : 0), 0) - a.reduce((s, p, k) => s + (k ? segLen(a[k - 1], p) : 0), 0))[0]
    const xs = lines.flat().map((p) => p[0]), ys = lines.flat().map((p) => p[1])
    let id = `${f.properties.street_ar}|${f.properties.sub_id ?? ''}|${f.properties.district_ar ?? ''}`
    while (seen.has(id)) id += '+'
    seen.add(id)
    return { id, props: f.properties, lines, mid: halfway(longest), bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number] }
  })
}
/** Most shops first (the service's own order), then shops per 100 m. */
export const topStreets = (streets: Street[], max = 10) => [...streets].sort((a, b) => b.props.n - a.props.n || b.props.per_100m - a.props.per_100m).slice(0, max)
/** «يوسف بن عبدالعزيز · الملز · إنارة» */
export const streetLine = (st: Street) => {
  const name = /^\d{3,}$/.test(st.props.street_ar.trim()) ? 'شارع غير مسمّى' : st.props.street_ar
  return [name, st.props.district_ar, st.props.sub_ar || st.props.main_ar].filter(Boolean).join(' · ')
}
/** The district (polygon) a point falls in. */
export const districtAt = (lon: number, lat: number, districts: District[]) => districts.find((d) => inFeature(lon, lat, d)) || null
/** How many places of this request each district holds: the service's own district counts by name, else the rows inside. */
export function densityOf(districts: District[], counts: { name: string; n: number }[], rows: TargetRow[]): Map<string, number> {
  const out = new Map<string, number>()
  const byName = new Map(counts.map((c) => [norm(c.name), c.n]))
  for (const d of districts) {
    const n = byName.get(norm(d.ar))
    if (n) out.set(d.id, n)
  }
  if (!out.size) for (const r of rows) {
    const d = hasPoint(r) ? districtAt(r.longitude!, r.latitude!, districts) : null
    if (d) out.set(d.id, (out.get(d.id) || 0) + 1)
  }
  return out
}
/** 0 (none) … 4 (densest) on a square-root scale, so one huge district does not wash out the rest. */
export const densityStep = (n: number, max: number) => (!n || !max ? 0 : Math.max(1, Math.min(4, Math.ceil((Math.sqrt(n) / Math.sqrt(max)) * 4))))
export const fmtMeters = (m: number) => (m >= 1000 ? `${formatNumber(m / 1000, { maximumFractionDigits: 1 })} كم` : `${formatNumber(Math.round(m))} م`)
