
/*
 * Targeting service client (screens 07–10). Same origin: server.py proxies /_targeting/* to the
 * targeting service after server-side account validation (the session cookie; no token in the browser), with that service's password from its own environment.
 *
 * Endpoints (the service's own, unchanged):
 *   POST /suggest-specialties — { text, main_id? } → specialties a seller's products fit (read only)
 *   POST /clusters          — { city, q?, objective?, sub_ids?, wholesale?, bounds? } → where a trade concentrates (street / district / cell)
 *   POST /map-focus         — { query, level, id, sub_id?, specialty_id? } → short-lived map tile cohort for the focused taxonomy
 *   POST /street-density    — { city, q?, objective?, sub_ids? } → GeoJSON LineStrings: the densest streets for a trade (n, length_m, per_100m)
 *   GET  /status            — dataset size
 *   GET  /template-status   — Meta status of farq_outreach_ar + the holder request
 *   GET  /send-status       — answered by server.py itself: { send } (read-only view of TARGETING_SEND)
 *   GET  /cities            — cities with enough places (English key + Arabic name)
 *   POST /search            — { q, city, limit, only_sendable } → counts + rows; each row says how it matched
 *                             (names the product / likely seller) and the AI's fit (likely / maybe / not)
 *   GET  /templates         — every template of the WhatsApp Business account with its Meta status
 *   POST /templates         — submits one template to Meta for review (sends nothing to anyone)
 *   POST /send-farq         — registers the chosen places on the holder request, then (mode: 'template')
 *                             sends farq_outreach_ar to each. Closed unless server.py has TARGETING_SEND=1;
 *                             held by server.py during prayer (409 PRAYER_WINDOW + message_ar, owner 2026-10-16);
 *                             the dev server always answers 403.
 */

import { recordMapInteraction } from '../lib/mapAnalytics'
import { farqSession } from './farqSession'

export type TargetRow = {
  category_main?: string
  subcategories?: string[]
  entity_type?: string
  registered_location_count?: number
  keyword_name_match?: boolean
  phone_source?: string
  phone_source_name?: string
  phone_lookup?: string
  target_role?: "buyer" | "seller"
  reason?: string
  match_confidence?: { score: number; basis: string; method: string }
  poi_key: string
  name_ar: string | null
  name_en: string | null
  category: string | null
  category_ar: string | null
  region_en: string | null
  region_ar: string | null
  city_en: string | null
  /** Street name from the place's address, when known. */
  street_ar?: string | null
  /** The business says it sells wholesale (جملة). */
  is_wholesale?: boolean
  district_en: string | null
  district_ar: string | null
  latitude: number | null
  longitude: number | null
  phone: string | null
  phone_kind: string | null
  /** Source-provided WhatsApp marker; not independent verification that the number is active. */
  has_whatsapp: boolean
  /** Explicit contact verification state when the targeting API returns one. A source flag alone is not verification. */
  whatsapp_verification_state?: 'verified' | 'unverified' | 'unknown' | null
  email: string | null
  source_count: number | null
  sources?: string[] | null
  /** 'product' = names the product · 'seller' = its type of shop usually sells it */
  match?: 'product' | 'seller'
  /** AI fit: L likely · M maybe · N not · null = not checked */
  ai?: 'L' | 'M' | 'N' | null
  /** HudHud surveyors deleted this place after a field visit (closed or duplicate): shown last, never a campaign recipient. */
  hudhud_deleted?: boolean
  sendable?: boolean
  warning?: string
  /** Commercial registration / trade licence when the service returns them (for «منشأة سعودية»; never guessed). */
  cr_number?: string | null
  commercial_license?: string | null
  /** Normalized status from the service (raw status never leaves it). */
  status_class?: 'open' | 'closed_temporary' | 'inactive' | 'hidden' | 'unknown_empty' | 'unknown_invalid' | 'closed_permanent'
  /** Farq taxonomy subcategory id, e.g. «build.plumbing_supply» (main = the part before the dot). */
  taxonomy_sub?: string | null
  /** يبيع، يشتري، جملة، تجزئة، مصنع، خدمات وتنفيذ */
  role_badges?: string[]
  /** De-duplicated specialty names (Arabic). */
  specialties?: string[]
  /** A commercial registration / municipal licence is on file (presence only, never the number). */
  saudi_registered?: boolean
  /** 'point' = a real position; otherwise the service sends latitude/longitude null (city or district centre). */
  location_precision?: string | null
  district_reliable?: boolean
  /** Data completeness 0–100, when the service sends it. */
  completeness?: number | null
  completeness_pct?: number | null
  /** Public rating out of 5, when the service sends it. */
  rating?: number | null
  service_radius_km?: number | null
}

export type TargetParse = { keywords?: string[]; category_hints?: string[]; seller_terms?: string[]; seller_label?: string | null; city?: string | null; region?: string | null; explain?: string; ai?: boolean }

export type TargetSearch = {
  contact_enrichment?: "enabled" | "not_configured"
  parsed: TargetParse
  located_total?: number
  map_query?: string
  total: number
  has_more?: boolean
  next_offset?: number | null
  offset?: number
  product_total?: number
  ai_checked?: number
  ai_likely?: number
  ai_maybe?: number
  with_whatsapp: number
  with_email: number
  by_region: [string | null, number][]
  rows: TargetRow[]
  /** Districts and streets of this request's places, counted before the district / street filters (so pickers keep their options). */
  areas?: SearchAreas
  /** What the service read from the request: wholesale = it asks for «جملة»; sub_ids = the targeted subcategories. */
  understood?: { wholesale?: boolean; sub_ids?: (string | number)[] } & Record<string, unknown>
}

export type SearchAreas = { districts: { name: string; n: number }[]; streets: { name: string; district: string; n: number }[]; wholesale: number; /** role badges with counts (before the role filter) */ roles?: { name: string; n: number }[]; /** specialties with counts (before the specialty filter) */ specialties?: { name: string; n: number }[] }

/** A place where one trade concentrates (POST /clusters), e.g. «أدوات صحية وسباكة — شارع خالد بن الوليد، الملك فيصل», 37 shops. */
export type TradeCluster = {
  level: 'street' | 'district' | 'cell'
  label_ar: string
  sub_id: string | number | null
  sub_ar: string | null
  district_ar: string | null
  street_ar: string | null
  n: number
  n_wholesale: number
  wholesale_pct: number
  lift: number
  lat: number
  lon: number
  /** Set by the page, not the service: the curated popular name («سوق الزل للأقمشة») when city + district + trade match. */
  popular_ar?: string | null
}
export type TradeClusters = { clusters: TradeCluster[]; wholesale?: number; basis?: string }
/** One street where a trade concentrates, drawn along the real street (POST /street-density). */
export type StreetDensityProps = { sub_id: string | number | null; sub_ar: string | null; street_ar: string; n: number; n_wholesale: number; length_m: number; per_100m: number; lift: number; label_ar: string; district_ar?: string | null; main_ar?: string | null }
export type StreetLine = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString, StreetDensityProps>
export type StreetDensity = { type?: 'FeatureCollection'; features: StreetLine[]; specialty_available?: boolean; basis?: string }
/** No activity = the densest streets of ALL activities in the city (up to 80, by n). Exact specialty lines require a specialty-aware data asset. */
export type StreetDensityQuery = { city: string; q?: string; objective?: string; main_id?: string; sub_ids?: (string | number)[]; specialty_ids?: string[]; districts?: string[] }
export const streetDensity = (body: StreetDensityQuery) => call<StreetDensity>('POST', '/street-density', body, true, (outcome) => {
  const event = outcome === 'retrying'
    ? 'map_street_density_auto_retry'
    : outcome === 'recovered'
      ? 'map_street_density_auto_retry_recovered'
      : 'map_street_density_auto_retry_failed'
  recordMapInteraction(event)
})
/** Which activities have dense streets in this city (optionally inside these districts): mains with their subs, counts. */
export type StreetCatalog = { mains: { main_id: string; main_ar: string; streets: number; shops: number; subs: { sub_id: string | number; sub_ar: string; streets: number; shops: number }[] }[] }
export const streetCatalog = (body: { city: string; districts?: string[] }) => call<StreetCatalog>('POST', '/street-density/catalog', body).then((value) => ({
  mains: Array.isArray(value?.mains)
    ? value.mains.filter((main): main is StreetCatalog['mains'][number] => Boolean(main && typeof main === 'object')).map((main) => ({
      ...main,
      subs: Array.isArray(main.subs) ? main.subs : [],
    }))
    : [],
}))

export type DistrictCount = { district_ar: string; n: number; n_wholesale: number; n_whatsapp: number }
export type DistrictCounts = { ok: boolean; city: string; districts: DistrictCount[]; total: number; specialty_available?: boolean; basis: string }
export type DistrictActivity = { main_id: string; main_ar: string; n: number; top_subactivities?: { sub_id: string; sub_ar: string; n: number }[] }
export type DistrictInsight = {
  district_ar: string
  total: number
  classified: number
  classification_pct: number
  dominant_activity: DistrictActivity | null
  least_activity: DistrictActivity | null
  activities: DistrictActivity[]
  absent_from_directory: string[]
}
export type DistrictInsights = { ok: boolean; city: string; districts: DistrictInsight[]; basis: string }
export type BuyerTrade = { sub_id: string; sub_ar: string; main_id: string; main_ar: string; strength: 'core' | 'common'; n: number; n_whatsapp: number }
export type WhoBuys = { ok: boolean; buyers: BuyerTrade[]; subject: { sub_ids: string[]; label_ar: string }; basis: string }
export type MarketSummary = {
  ok: boolean
  summary: {
    total: number; districts_count: number; top_districts: { district_ar: string; n: number }[]; specialty_available?: boolean
    densest_street: { street_ar: string; district_ar: string | null; n: number; length_m: number; per_100m: number; sub_ar: string | null } | null
    n_wholesale: number; n_whatsapp: number; n_specialties: number; n_approx: number; n_cr?: number; basis: string
    main_activities?: { main_id: string; main_ar: string; n: number }[]; main_activities_basis?: string
  }
}
/** q is resolved locally to taxonomy activities; activity/specialty/district filters intersect. */
export type MarketAnalyticsQuery = { city: string; sub_ids?: (string | number)[]; main_id?: string; specialty_ids?: string[]; q?: string; districts?: string[] }
export const districtCounts = (body: MarketAnalyticsQuery) => call<DistrictCounts>('POST', '/district-counts', body)
export const districtInsights = (body: { city: string; districts: string[] }) => call<DistrictInsights>('POST', '/district-insights', body)
export const whoBuys = (body: { city: string; q?: string; sub_ids?: (string | number)[] }) => call<WhoBuys>('POST', '/who-buys', body)
export const marketSummary = (body: MarketAnalyticsQuery) => call<MarketSummary>('POST', '/market-summary', body)

export type TemplateStatus = {
  name: string
  status: string
  category?: string
  rejected_reason?: string
  holder?: { holder_rfq_id?: string; title?: string }
}

export type SendResult = { ok: boolean; error?: string; fatal?: string; sent?: { poi_key: string }[]; failed?: { poi_key: string; error: string }[] }

/** The approved default Meta template and its two body variables: {{1}} the place's name, {{2}} the campaign context. */
export const OUTREACH_TEMPLATE = 'farq_discover_ar_20261019'

export class TargetingError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message) }
}

type TransientRetryOutcome = 'retrying' | 'recovered' | 'failed'

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  retryTransient = false,
  onTransientRetryOutcome?: (outcome: TransientRetryOutcome) => void,
): Promise<T> {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {}
  const request = { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' as const }
  const requestWithTimeout = async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10_000)
    try {
      return await fetch(`/_targeting${path}`, { ...request, signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TargetingError('TIMEOUT', 'استغرق البحث وقتًا أطول من المعتاد. عدّل النطاق أو أعد المحاولة.', 408)
      }
      throw error
    } finally {
      window.clearTimeout(timeout)
    }
  }
  const notifyRetry = (outcome: TransientRetryOutcome) => {
    try { onTransientRetryOutcome?.(outcome) } catch { /* telemetry must not affect the request */ }
  }
  let retried = false
  let r: Response
  for (let attempt = 0; ; attempt++) {
    try {
      r = await requestWithTimeout()
    } catch (error) {
      // Explicitly opted-in map reads are idempotent. Recover once from a dropped network
      // connection; let aborts and all other errors keep their normal behavior.
      if (!retryTransient || attempt > 0 || !(error instanceof TypeError)) {
        if (retried) notifyRetry('failed')
        throw error
      }
      retried = true
      notifyRetry('retrying')
      await new Promise(resolve => window.setTimeout(resolve, 200))
      continue
    }
    if (!retryTransient || attempt > 0 || ![502, 503, 504].includes(r.status)) break
    retried = true
    notifyRetry('retrying')
    await new Promise(resolve => window.setTimeout(resolve, 200))
  }
  let data: unknown = null
  try { data = await r.json() } catch { /* empty or not JSON */ }
  const d = (data || {}) as { error?: string; message_ar?: string }
  // PRAYER_WINDOW: server.py holds campaign sends during prayer (owner rule 2026-10-16) and says until when
  if (!r.ok) {
    // A protected targeting response can arrive after an expired proxy cookie.
    // Re-read the session so the app returns to sign-in instead of leaving a stale map interactive.
    if (r.status === 401) void farqSession.loadUser()
    if (retried) notifyRetry('failed')
    throw new TargetingError(String(d.error || r.status), d.error === 'SEND_DISABLED' ? 'الإرسال مقفل في هذه البيئة.' : d.error === 'LOCAL_TARGETING_AUTH_REQUIRED' && d.message_ar ? d.message_ar : d.error === 'PRAYER_WINDOW' && d.message_ar ? d.message_ar : r.status === 401 ? 'انتهت جلسة الصفحة. حدّث الصفحة وادخل من جديد.' : 'خدمة الاستهداف ما ردّت. حاول بعد شوي.', r.status)
  }
  if (retried) notifyRetry('recovered')
  return data as T
}

export type MetaTemplate = { id?: string; name: string; status: string; category?: string; language?: string; rejected_reason?: string; components?: { type: string; text?: string }[] }
export type MetaComponent = Record<string, unknown> & { type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' }

export const listTemplates = () => call<{ ok: boolean; error?: string; data: MetaTemplate[] }>('GET', '/templates')
export const submitTemplate = (t: { name: string; language: string; category: string; components: MetaComponent[] }) =>
  call<{ ok: boolean; id?: string; status?: string; error?: string }>('POST', '/templates', t)

export const targetingStatus = () => call<{ pois: number; whatsapp: number; email: number; ai: boolean }>('GET', '/status')
/** Whether this environment lets a campaign leave (server.py TARGETING_SEND). Any error reads as closed. */
export const sendStatus = () => call<{ send?: boolean }>('GET', '/send-status').then((r) => r?.send === true, () => false)
export const templateStatus = () => call<TemplateStatus>('GET', '/template-status')
export type SearchFilters = {keyword?:string; category?:string; subcategory?:string; entity_type?:string; branches_only?:boolean; sort?:string; name_only?:boolean; contact?:string; bounds?:[number,number,number,number]; /** exact district, e.g. «الفيصلية» */ district?:string; /** part of the street name */ street?:string; /** only businesses that say they sell wholesale */ wholesale?:boolean; /** one role badge, e.g. «مصنع» */ role?:string; /** one specialty name */ specialty?:string}
export type DirectoryFacets = {categories:{value:string;label:string;count:number;subcategories:{value:string;label:string;count:number}[]}[]; size_available:boolean}
export const directoryFacets = (city:string) => call<DirectoryFacets>('GET', '/facets?city='+encodeURIComponent(city))
export const mapQuery = (city:string,filters:SearchFilters) => call<TargetSearch>('POST','/map-query',{city,filters})
export const mapFocusQuery = (query:string, focus:{level:'main'|'sub'|'spec'; id:string; sub_id?:string; specialty_id?:string}) => call<{map_query:string}>('POST','/map-focus',{query,...focus})
export const mapProfile = (query:string,poi_key:string) => call<{row:TargetRow}>('POST','/map-profile',{query,poi_key})
export const searchTargets = (
  q: string,
  city: string,
  limit = 30,
  objective: 'purchase' | 'marketing' | 'name' | 'browse' = 'purchase',
  offset = 0,
  filters: SearchFilters = {},
  retryTransient = objective === 'browse',
  onTransientRetryOutcome?: (outcome: 'retrying' | 'recovered' | 'failed') => void,
) => call<TargetSearch>('POST', '/search', { q, city, limit, objective, offset, filters, only_sendable: false }, retryTransient, onTransientRetryOutcome)
export const tradeClusters = (body: { city: string; q?: string; objective?: string; sub_ids?: (string | number)[]; wholesale?: boolean; bounds?: [number, number, number, number] }) => call<TradeClusters>('POST', '/clusters', body)
export type SpecialtySuggestion = { specialty_id: string | number; specialty_ar: string; sub_id?: string | number | null; sub_ar?: string | null; main_ar?: string | null }
export const suggestSpecialties = (text: string, mainId?: string) => call<{ suggestions: SpecialtySuggestion[] }>('POST', '/suggest-specialties', { text, ...(mainId ? { main_id: mainId } : {}) })
export type City = { en: string; ar: string | null; n: number }
/** District polygons of one city (GET /districts?city=Riyadh): properties ar, en, city_en, id. 404 or empty = no polygons for this city. */
export type DistrictFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { ar: string; en?: string | null; city_en?: string | null; id: string | number }>
export const listDistricts = (city: string) => call<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, DistrictFeature['properties']>>('GET', '/districts?city=' + encodeURIComponent(city))
export const listCities = () => call<City[]>('GET', '/cities').then((value) => Array.isArray(value) ? value : [])

/** Body text of a Meta template. */
export const templateBody = (t: MetaTemplate) => (t.components || []).find((c) => c.type === 'BODY')?.text || ''
/**
 * The send path fills {{1}} with the directory recipient name. Every following
 * contiguous body variable is shown as an explicit campaign field and sent in
 * its numbered order, so Meta always receives a complete template payload.
 */
export const templateVariables = (t: MetaTemplate): number[] => [...new Set((templateBody(t).match(/\{\{\s*(\d+)\s*\}\}/g) || []).map((m) => Number(m.replace(/\D/g, ''))))].sort((a, b) => a - b)

export const templateFits = (t: MetaTemplate) => {
  if (t.status !== 'APPROVED') return false
  if (t.language && t.language !== 'ar') return false
  // the send path fills the body only: a media header (logo image…) or variables in a header / button need values it never sends
  const needsMore = (t.components || []).some((c) => {
    const x = c as { type: string; text?: string; format?: string; buttons?: { url?: string; text?: string }[] }
    if (x.type === 'HEADER') return (x.format && x.format !== 'TEXT') || /\{\{/.test(x.text || '')
    if (x.type === 'BUTTONS') return (x.buttons || []).some((b) => /\{\{/.test(`${b.url || ''}${b.text || ''}`))
    return false
  })
  if (needsMore) return false
  const vars = templateVariables(t)
  // Some Meta list responses omit components for the known default template.
  // Its contract is fixed at {{1}}, {{2}}, so do not hide the only safe
  // fallback while the account response is incomplete.
  if (!vars.length) return t.name === OUTREACH_TEMPLATE
  // {{1}} is always the directory recipient name. Additional contiguous body
  // variables are entered by the campaign owner and passed through untouched.
  return vars.length >= 2 && vars[0] === 1 && vars.every((value, index) => value === index + 1)
}
/** Normalize a valid Saudi mobile only when the directory source flags it as WhatsApp. The flag is not independent verification. */
/** «مغلق مؤقتاً» / «غير نشط» shown next to a result. Campaign eligibility is rechecked by the send API. */
export const statusLabel = (r: TargetRow): string | null => (r.hudhud_deleted ? 'محذوفة في هدهد' : r.status_class === 'closed_temporary' ? 'مغلق مؤقتاً' : r.status_class === 'inactive' ? 'غير نشط' : null)
export const hasUnconfirmedStatus = (r: Pick<TargetRow, 'status_class'>): boolean => ['hidden', 'unknown_empty', 'unknown_invalid'].includes(r.status_class || '')
export const waNumber = (r: TargetRow) => {
  if (r.has_whatsapp !== true) return null
  let n = String(r.phone || '').replace(/[^0-9]/g, '')
  if (n.startsWith('00')) n = n.slice(2)
  if (n.length === 10 && n.startsWith('05')) n = `966${n.slice(1)}`
  else if (n.length === 9 && n.startsWith('5')) n = `966${n}`
  return /^9665[0-9]{8}$/.test(n) ? n : null
}

/**
 * Sends the campaign: register the places on the holder request (no dispatch), then send the template.
 * Called only from the confirm sheet (screen 10) after the owner's explicit yes.
 */
export async function sendCampaign(holderRfqId: string, rows: TargetRow[], message: string, query: string, template: string = OUTREACH_TEMPLATE, templateValues: Record<string, string> = {}): Promise<SendResult> {
  const targets = rows.map((r) => ({ poi_key: r.poi_key, name_ar: r.name_ar, name_en: r.name_en, city: r.city_en, category: r.category, whatsapp: waNumber(r), email: r.email || null, message }))
  const out: SendResult = { ok: true, sent: [], failed: [] }
  // the service takes at most 500 places per call
  for (let i = 0; i < targets.length; i += 200) {
    const chunk = targets.slice(i, i + 200)
    const reg = await call<SendResult>('POST', '/send-farq', { rfq_id: holderRfqId, dispatch: false, query, targets: chunk })
    if (!reg.ok) return { ...out, ok: false, error: reg.error || reg.fatal }
    const res = await call<SendResult>('POST', '/send-farq', { rfq_id: holderRfqId, mode: 'template', template, query, template_values: { '2': message, ...templateValues }, targets: chunk })
    if (!res.ok) return { ...out, ok: false, error: res.error || res.fatal }
    out.sent!.push(...(res.sent || [])); out.failed!.push(...(res.failed || []))
  }
  return out
}

/*
 * Scheduled sends (server.py → schedule.py, same origin, same account login). Off unless the server has
 * TARGETING_SCHEDULE_ENABLED=1: every route then answers 404, read here as `available: false` → «الجدولة قريباً».
 * Recipients are poi_keys only; the targeting service takes names and numbers from its directory.
 */
export type ScheduledCampaign = { id: string; status: 'scheduled' | 'running' | 'sent' | 'partial' | 'failed' | 'cancelled' | 'interrupted'; send_at: string; requested_send_at: string; template: string; message: string; keys: string[]; notes: { kind: string; message_ar?: string }[]; recipients: Record<string, number> }
export type ScheduleAnswer<T> = { available: false } | ({ available: true } & T)
export const SCHEDULE_SOON = 'الجدولة قريباً'
async function scheduleCall<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ScheduleAnswer<T>> {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {}
  // the login travels in the HttpOnly session cookie (server.py adds the bearer); nothing is read from the page
  const r = await fetch(`/api/targeting/schedule${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
  let data: Record<string, unknown> = {}
  try { data = await r.json() } catch { /* empty */ }
  // flag off: {"error":"not_found"} on every route
  if (r.status === 404 && data.error === 'not_found') return { available: false }
  if (!r.ok) throw new TargetingError(String(data.error || r.status), r.status === 401 ? 'انتهت جلسة الصفحة. حدّث الصفحة وادخل من جديد.' : data.error === 'SEND_DISABLED' ? 'الإرسال مقفل في هذه البيئة.' : 'ما قدرنا نجدول الحملة. حاول بعد شوي.', r.status)
  return { available: true, ...(data as T) }
}
export const scheduleCampaign = (b: { keys: string[]; message: string; template: string; send_at: string; cities?: string[]; query?: string }) =>
  scheduleCall<{ id: string; send_at: string; send_at_ar: string; shifted: boolean; message_ar?: string; eligible: number; rejected: Record<string, string> }>('POST', '', b)
export const listScheduled = () => scheduleCall<{ data: ScheduledCampaign[] }>('GET', '')
export const cancelScheduled = (id: string) => scheduleCall<{ id: string; status: 'cancelled' }>('POST', `/${encodeURIComponent(id)}/cancel`)
