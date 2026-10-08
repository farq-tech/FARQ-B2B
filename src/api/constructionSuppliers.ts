// Copied from فرق بناء (read-only source): farqconstraction/src/api/constructionSuppliers.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
import type { SupplierEntry } from '../types'
import { apiBase } from './apiBase'
import { constructionHeaders, shouldRetryAfterRefresh } from './constructionAuth'
import {
  assertConstructionRateLimitOpen,
  recordConstructionResponse,
} from './constructionClient'
import { farqSession } from './farqSession'

/**
 * Farq-aligned construction suppliers client.
 *
 * Calls GET /api/construction/catalog (Express: api/routes/construction.js),
 * same path as Frontend/src/services/constructionService.ts — never Postgres
 * from the browser or Vite.
 *
 * Identity comes from `constructionAuth` — the same single definition
 * `constructionClient` uses. This file used to carry its own copy, and the two
 * copies are how the app ended up able to send different credentials for the
 * same API depending on which module made the call.
 *
 * There is no unauthenticated supplier list on api.farq.sa today. For a
 * permanent no-auth directory, Farq needs a small public GET (see .env.example).
 */

export type FarqApiSupplier = {
  id: string
  /** Present on some payloads; createRfq rejects this — use `id` (external_key). */
  database_id?: string
  name_ar?: string
  name_en?: string
  city?: string
  service_regions_ar?: string
  activity?: string | null
  qualification_status?: string
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  has_email?: boolean
  has_whatsapp?: boolean
  contact_channels?: { email?: boolean; whatsapp?: boolean; haraj?: boolean }
  source_system?: string | null
  source?: string | null
  import_batch_id?: string | null
  updated_at?: string | null
}

export type SupplierListResult = {
  suppliers: SupplierEntry[]
  total: number
  limit: number
  offset: number
  source: 'farq-construction-api'
}

type CatalogCache = {
  at: number
  suppliers: FarqApiSupplier[]
}

let catalogCache: CatalogCache | null = null
const pageCache = new Map<string, { at: number; value: { suppliers: FarqApiSupplier[]; total: number } }>()
const CATALOG_TTL_MS = 60_000

/**
 * The directory is scoped to the signed-in buyer's account, so a cache that
 * outlived a sign-in would show one account the other's suppliers.
 */
farqSession.subscribe((event) => {
  if (event === 'IDENTITY_CHANGED') {
    catalogCache = null
    pageCache.clear()
  }
})
/** Full directory is ~10k+ rows / multi-MB — never wait forever in the browser. */
const CATALOG_FETCH_TIMEOUT_MS = 45_000

function formatRelative(value?: string | null): string {
  if (!value) return '—'
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return '—'
  const diffMs = Date.now() - ts
  const days = Math.floor(diffMs / 86_400_000)
  if (days <= 0) return 'اليوم'
  if (days === 1) return 'منذ يوم'
  if (days < 7) return `منذ ${days} أيام`
  if (days < 30) return `منذ ${Math.floor(days / 7)} أسابيع`
  return `منذ ${Math.floor(days / 30)} شهر`
}

function cleanCategory(raw?: string | null): string {
  const text = String(raw || '')
    .split(/[,|]/)
    .map((part) => part.trim())
    .filter(Boolean)
  // Unknown activity is shown as unknown, never as an invented category.
  if (!text.length) return '—'
  const arabic = text.find((part) => /[\u0600-\u06FF]/.test(part))
  if (arabic) return arabic
  return text[0]!.replace(/-/g, ' ')
}

export function mapFarqSupplier(row: FarqApiSupplier): SupplierEntry {
  const name = String(row.name_ar || row.name_en || row.id).trim()
  const cityRaw = row.city as unknown
  const cityFromObj =
    cityRaw && typeof cityRaw === 'object'
      ? String(
          (cityRaw as { original?: string; key?: string }).original ||
            (cityRaw as { key?: string }).key ||
            '',
        ).trim()
      : String(cityRaw || '').trim()
  const city =
    cityFromObj ||
    String(row.service_regions_ar || '').trim() ||
    '—'
  const email = String(row.email || '').trim()
  const phone = String(row.phone || row.whatsapp || '').trim()
  const id = String(row.id)
  const source = String(row.source_system || row.source || '')
  const isHaraj = /^haraj:seller:\d+$/i.test(id) || source === 'HARAJ'
  return {
    id,
    name,
    city,
    category: cleanCategory(row.activity),
    phone,
    email,
    interactions: 0,
    lastSeen: formatRelative(row.updated_at),
    qualificationStatus: row.qualification_status || undefined,
    activity: row.activity || undefined,
    hasEmail: Boolean(row.has_email ?? row.contact_channels?.email ?? email),
    hasWhatsapp: Boolean(row.has_whatsapp ?? row.contact_channels?.whatsapp ?? phone),
    hasHaraj: Boolean(row.contact_channels?.haraj || isHaraj),
    sourceSystem: source || (isHaraj ? 'HARAJ' : undefined),
    importBatchId: row.import_batch_id || null,
  }
}

function matchesQuery(row: FarqApiSupplier, query?: string): boolean {
  if (!query) return true
  const q = String(query)
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .trim()
    .toLowerCase()
  if (!q) return true
  const hay =
    `${row.name_ar || ''} ${row.name_en || ''} ${row.city || ''} ${row.service_regions_ar || ''} ${row.activity || ''} ${row.id}`
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .toLowerCase()
  // Match all tokens so «علي» hits names containing علي, not only exact phrase.
  return q.split(/\s+/).filter(Boolean).every((token) => hay.includes(token))
}

function isVerified(row: FarqApiSupplier): boolean {
  const status = String(row.qualification_status || '').toUpperCase()
  return status === 'VERIFIED_DIRECTORY' || status === 'VERIFIED'
}

/**
 * createRfq matches `selected_supplier_ids` to `construction.suppliers.external_key`
 * and accepts email, WhatsApp, or Haraj sellers (`haraj:seller:*`).
 */
export function isRfqContactableSupplier(row: {
  id?: string
  hasEmail?: boolean
  hasWhatsapp?: boolean
  hasHaraj?: boolean
  has_email?: boolean
  has_whatsapp?: boolean
  contact_channels?: { email?: boolean; whatsapp?: boolean; haraj?: boolean }
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  source_system?: string | null
  source?: string | null
}): boolean {
  const id = String(row.id || '')
  const source = String(row.source_system || row.source || '')
  if (/^haraj:seller:\d+$/i.test(id) || source === 'HARAJ' || row.contact_channels?.haraj || row.hasHaraj) {
    return true
  }
  return Boolean(
    row.hasEmail ||
      row.has_email ||
      row.contact_channels?.email ||
      String(row.email || '').trim() ||
      row.hasWhatsapp ||
      row.has_whatsapp ||
      row.contact_channels?.whatsapp ||
      String(row.whatsapp || '').trim() ||
      String(row.phone || '').trim(),
  )
}

/*
 * The directory is searched and paged on the server (supplier_page=1). The old
 * path downloaded all 94,855 suppliers (97 MB of JSON, then 52 MB) on every
 * visit and filtered them here; a phone could not hold it.
 */
async function fetchCatalogPage(extra: Record<string, string>): Promise<{ suppliers: FarqApiSupplier[]; total: number }> {
  const key = JSON.stringify(extra)
  const hit = pageCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  const payload = await fetchCatalogPayload(extra)
  const value = {
    suppliers: (payload?.data?.suppliers || []) as FarqApiSupplier[],
    total: Number(payload?.data?.supplier_total ?? (payload?.data?.suppliers || []).length),
  }
  if (pageCache.size > 50) pageCache.clear()
  pageCache.set(key, { at: Date.now(), value })
  return value
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCatalogPayload(extra: Record<string, string>): Promise<any> {

  // This 6 MB catalogue shares the API's single per-IP `/api/construction` budget
  // with every other screen. Spending a request we already know will be refused
  // pushes back the countdown the inbox is showing the owner, so this transport
  // goes through the same gate as `constructionClient` despite having its own
  // fetch. Measured with the bucket empty: 8 catalogue requests became 0.
  assertConstructionRateLimitOpen()

  // Catalog `limit` paginates catalog *items* only; `data.suppliers` is the full
  // active directory (~10k). Keep items page small — do not truncate suppliers.
  const params = new URLSearchParams()
  params.set('limit', '1')
  // We read `data.suppliers` and nothing else, so ask the API to skip the brand
  // and category facets it was computing for us to throw away, and to send only
  // the supplier fields `mapFarqSupplier` reads. Measured: 10.9 MB → 5.9 MB and
  // ~3s of server work the directory never used.
  params.set('include_facets', 'false')
  params.set('supplier_fields', 'directory')
  for (const [k, v] of Object.entries(extra)) params.set(k, v)

  const attempt = async () => {
    const usedToken = farqSession.getAccessToken()
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(`${apiBase()}/api/construction/catalog?${params}`, {
        headers: constructionHeaders(),
        signal: controller.signal,
      })
      return { response, usedToken }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('انتهت مهلة تحميل دليل الموردين — أعد المحاولة.')
      }
      throw err
    } finally {
      window.clearTimeout(timer)
    }
  }

  let { response, usedToken } = await attempt()
  // Same one-shot recovery the RFQ client uses: an access token that expired
  // mid-session should not read to the user as "the directory is broken".
  if (shouldRetryAfterRefresh(response.status, usedToken)) {
    const outcome = await farqSession.refreshForRequest(usedToken)
    if (outcome.status === 'refreshed') ({ response } = await attempt())
  }
  const payload = await response.json().catch(() => null)

  // Before any other reading of the failure: a rate limit is not an empty
  // directory and not a missing CONSTRUCTION_DB_URL. Shown as either, it costs
  // the owner a hunt through settings that are already correct.
  const limited = recordConstructionResponse(response, payload?.retryAfterSec)
  if (limited) throw limited

  if (!response.ok || payload?.ok === false) {
    const code = payload?.errors?.[0]?.code || payload?.message || payload?.error
    if (response.status === 401 || code === 'CONSTRUCTION_AUTH_REQUIRED') {
      throw new Error(
        farqSession.isAuthenticated()
          ? 'انتهت جلستك — سجّل الدخول من جديد لتحميل دليل الموردين.'
          : 'دليل الموردين يتطلب تسجيل الدخول. سجّل الدخول بحسابك ثم أعد المحاولة.',
      )
    }
    if (
      response.status === 503 ||
      code === 'CONSTRUCTION_PERSISTENCE_UNAVAILABLE' ||
      code === 'CONSTRUCTION_READ_DISABLED'
    ) {
      throw new Error(
        'خدمة البناء غير متاحة الآن. أعد المحاولة بعد قليل، وإن استمر الأمر تواصل مع فرق.',
      )
    }
    throw new Error(code || `Farq construction API error (${response.status})`)
  }

  return payload
}

export async function listConstructionSuppliers(options: {
  query?: string
  limit?: number
  offset?: number
  verifiedOnly?: boolean
  /** When true, only suppliers createRfq will accept (email/WhatsApp/Haraj). */
  contactableOnly?: boolean
  /** Only rows a given upload created — how a bad batch is reviewed. */
  importBatchId?: string | null
} = {}): Promise<SupplierListResult> {
  const limit = Math.min(options.limit ?? 50, 500)
  const offset = options.offset ?? 0
  const extra: Record<string, string> = {
    supplier_page: '1',
    supplier_limit: String(limit),
    supplier_offset: String(offset),
  }
  if (options.query?.trim()) extra.supplier_q = options.query.trim()
  if (options.contactableOnly) extra.supplier_contactable = '1'
  if (options.verifiedOnly) extra.supplier_verified = '1'
  if (options.importBatchId) extra.supplier_batch = options.importBatchId
  const { suppliers, total } = await fetchCatalogPage(extra)
  return {
    suppliers: suppliers.map(mapFarqSupplier),
    total,
    limit,
    offset,
    source: 'farq-construction-api',
  }
}

/**
 * Keep contactable external_key ids that exist in the catalog (email / WhatsApp /
 * Haraj). Drops unknown ids and database UUIDs that are not in the directory.
 */
export async function resolveRfqSupplierIds(ids: string[]): Promise<string[]> {
  const wanted = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
  if (!wanted.length) return []
  const rows: FarqApiSupplier[] = []
  for (let i = 0; i < wanted.length; i += 200) {
    const chunk = wanted.slice(i, i + 200)
    const page = await fetchCatalogPage({
      supplier_page: '1',
      supplier_ids: chunk.join(','),
      supplier_limit: String(chunk.length),
      supplier_contactable: '1',
    })
    rows.push(...page.suppliers)
  }
  const byExternal = new Map(
    rows.filter(isRfqContactableSupplier).map((row) => [String(row.id), String(row.id)]),
  )
  return wanted.map((id) => byExternal.get(id)).filter((id): id is string => Boolean(id))
}

export async function getConstructionSupplier(id: string): Promise<SupplierEntry> {
  const { suppliers } = await fetchCatalogPage({ supplier_page: '1', supplier_ids: id, supplier_limit: '1' })
  const found = suppliers.find((row) => String(row.id) === id)
  if (found) return mapFarqSupplier(found)
  throw new Error('المورد غير موجود')
}
