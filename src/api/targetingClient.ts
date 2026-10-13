import { farqSession } from './farqSession'

/*
 * Targeting service client (screens 07–10). Same origin: server.py proxies /_targeting/* to the
 * targeting service after server-side account validation, with that service's password from its own environment.
 *
 * Endpoints (the service's own, unchanged):
 *   GET  /status            — dataset size
 *   GET  /template-status   — Meta status of farq_outreach_ar + the holder request
 *   GET  /cities            — cities with enough places (English key + Arabic name)
 *   POST /search            — { q, city, limit, only_sendable } → counts + rows; each row says how it matched
 *                             (names the product / likely seller) and the AI's fit (likely / maybe / not)
 *   GET  /templates         — every template of the WhatsApp Business account with its Meta status
 *   POST /templates         — submits one template to Meta for review (sends nothing to anyone)
 *   POST /send-farq         — registers the chosen places on the holder request, then (mode: 'template')
 *                             sends farq_outreach_ar to each. Closed unless server.py has TARGETING_SEND=1;
 *                             the dev server always answers 403.
 */

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
  district_en: string | null
  district_ar: string | null
  latitude: number | null
  longitude: number | null
  phone: string | null
  phone_kind: string | null
  has_whatsapp: boolean
  email: string | null
  source_count: number | null
  sources?: string[] | null
  /** 'product' = names the product · 'seller' = its type of shop usually sells it */
  match?: 'product' | 'seller'
  /** AI fit: L likely · M maybe · N not · null = not checked */
  ai?: 'L' | 'M' | 'N' | null
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
}

export type TemplateStatus = {
  name: string
  status: string
  category?: string
  rejected_reason?: string
  holder?: { holder_rfq_id?: string; title?: string }
}

export type SendResult = { ok: boolean; error?: string; fatal?: string; sent?: { poi_key: string }[]; failed?: { poi_key: string; error: string }[] }

/** The approved Meta template and its two body variables: {{1}} the place's name, {{2}} the campaign text. */
export const OUTREACH_TEMPLATE = 'farq_outreach_ar'

export class TargetingError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {}
  const token = farqSession.getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`/_targeting${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
  let data: unknown = null
  try { data = await r.json() } catch { /* empty or not JSON */ }
  const d = (data || {}) as { error?: string }
  if (!r.ok) throw new TargetingError(String(d.error || r.status), d.error === 'SEND_DISABLED' ? 'الإرسال مقفل في هذه البيئة.' : r.status === 401 ? 'انتهت جلسة الصفحة. حدّث الصفحة وادخل من جديد.' : 'خدمة الاستهداف ما ردّت. حاول بعد شوي.')
  return data as T
}

export type MetaTemplate = { id?: string; name: string; status: string; category?: string; language?: string; rejected_reason?: string; components?: { type: string; text?: string }[] }
export type MetaComponent = Record<string, unknown> & { type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' }

export const listTemplates = () => call<{ ok: boolean; error?: string; data: MetaTemplate[] }>('GET', '/templates')
export const submitTemplate = (t: { name: string; language: string; category: string; components: MetaComponent[] }) =>
  call<{ ok: boolean; id?: string; status?: string; error?: string }>('POST', '/templates', t)

export const targetingStatus = () => call<{ pois: number; whatsapp: number; email: number; ai: boolean }>('GET', '/status')
export const templateStatus = () => call<TemplateStatus>('GET', '/template-status')
export type SearchFilters = {keyword?:string; category?:string; subcategory?:string; entity_type?:string; branches_only?:boolean; sort?:string; name_only?:boolean; contact?:string; bounds?:[number,number,number,number]}
export type DirectoryFacets = {categories:{value:string;label:string;count:number;subcategories:{value:string;label:string;count:number}[]}[]; size_available:boolean}
export const directoryFacets = (city:string) => call<DirectoryFacets>('GET', '/facets?city='+encodeURIComponent(city))
export const mapQuery = (city:string,filters:SearchFilters) => call<TargetSearch>('POST','/map-query',{city,filters})
export const mapProfile = (query:string,poi_key:string) => call<{row:TargetRow}>('POST','/map-profile',{query,poi_key})
export const searchTargets = (q: string, city: string, limit = 30, objective: 'purchase' | 'marketing' | 'name' | 'browse' = 'purchase', offset = 0, filters:SearchFilters = {}) => call<TargetSearch>('POST', '/search', { q, city, limit, objective, offset, filters, only_sendable: false })
export type City = { en: string; ar: string | null; n: number }
export const listCities = () => call<City[]>('GET', '/cities')

/** Valid Saudi mobile for WhatsApp, as the service checks it (9665XXXXXXXX). */
export const waNumber = (r: TargetRow) => {
  const n = String(r.phone || '').replace(/[^0-9]/g, '')
  return r.has_whatsapp && /^9665[0-9]{8}$/.test(n) ? n : null
}

/**
 * Sends the campaign: register the places on the holder request (no dispatch), then send the template.
 * Called only from the confirm sheet (screen 10) after the owner's explicit yes.
 */
export async function sendCampaign(holderRfqId: string, rows: TargetRow[], message: string, query: string): Promise<SendResult> {
  const targets = rows.map((r) => ({ poi_key: r.poi_key, name_ar: r.name_ar, name_en: r.name_en, city: r.city_en, category: r.category, whatsapp: waNumber(r), email: r.email || null, message }))
  const out: SendResult = { ok: true, sent: [], failed: [] }
  // the service takes at most 500 places per call
  for (let i = 0; i < targets.length; i += 200) {
    const chunk = targets.slice(i, i + 200)
    const reg = await call<SendResult>('POST', '/send-farq', { rfq_id: holderRfqId, dispatch: false, query, targets: chunk })
    if (!reg.ok) return { ...out, ok: false, error: reg.error || reg.fatal }
    const res = await call<SendResult>('POST', '/send-farq', { rfq_id: holderRfqId, mode: 'template', template: OUTREACH_TEMPLATE, query, targets: chunk })
    if (!res.ok) return { ...out, ok: false, error: res.error || res.fatal }
    out.sent!.push(...(res.sent || [])); out.failed!.push(...(res.failed || []))
  }
  return out
}
