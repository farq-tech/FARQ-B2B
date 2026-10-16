// Copied (moved from src/mobile/ to src/lib/, imports unchanged in meaning: '../api/…' paths are the same depth) from فرق بناء (read-only source): farqconstraction/src/mobile/purchaseRequests.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
/**
 * Purchase request photo → a local draft of a quote request.
 * The server reads the pages (POST /api/construction/purchase-requests/scan);
 * the draft lives on this phone until it is sent from «طلب تسعير جديد».
 */
import { apiBase } from '../api/apiBase'
import { constructionHeaders } from '../api/constructionAuth'
import { farqSession } from '../api/farqSession'

export type ScannedItem = { description: string; quantity: number | null; unit: string | null; specification: string | null }
export type ScannedRequest = {
  is_purchase_request: boolean
  project: string | null
  request_number: string | null
  request_date: string | null
  requester: string | null
  items: ScannedItem[]
  pages_read: number
  pages_failed: number
}

export type DraftLine = { name: string; qty: string; unit: string; spec?: string }
export type Draft = {
  id: string
  created_at: string
  updated_at: string
  project: string
  reference: string | null
  requester: string | null
  lines: DraftLine[]
}

async function post<T>(path: string, body: unknown, retried = false): Promise<T> {
  const res = await fetch(`${apiBase()}/api/construction/${path}`, {
    method: 'POST',
    headers: constructionHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }).catch(() => null)
  if (!res) throw new Error('تعذّر الاتصال بالخادم. تحقق من الإنترنت وأعد المحاولة.')
  if (res.status === 401 && !retried) {
    const outcome = await farqSession.refreshForRequest(farqSession.getAccessToken()).catch(() => null)
    if (outcome?.status === 'refreshed') return post<T>(path, body, true)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.ok === false || json?.success === false) {
    const code = json?.errors?.[0]?.code
    throw new Error(
      code === 'PURCHASE_REQUEST_READ_FAILED'
        ? 'تعذّرت قراءة الصورة. صوّر الصفحة كاملة وبإضاءة جيدة ثم أعد المحاولة.'
        : code === 'INVALID_IMAGE'
          ? 'الصورة غير صالحة. جرّب صورة أخرى.'
          : 'حدث خطأ أثناء القراءة. أعد المحاولة.',
    )
  }
  return (json?.data ?? json) as T
}

export function scanPurchaseRequest(pages: Array<{ mime: string; base64: string }>) {
  return post<{ request: ScannedRequest; model?: string; read_ms?: number }>('purchase-requests/scan', {
    images: pages.map((p) => ({ mime: p.mime, image_base64: p.base64 })),
  })
}

/* ---------- drafts for this tab (memory only: nothing is kept on the device) ---------- */

let drafts: Draft[] = []

function load(): Draft[] {
  return [...drafts]
}
function store(list: Draft[]) {
  drafts = list.slice(0, 30)
}

export function listDrafts(): Draft[] {
  return load().sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}
export function getDraft(id: string): Draft | null {
  return load().find((d) => d.id === id) || null
}
export function saveDraft(draft: Omit<Draft, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Draft {
  const now = new Date().toISOString()
  const list = load()
  const existing = draft.id ? list.find((d) => d.id === draft.id) : null
  const next: Draft = {
    id: existing?.id || `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: existing?.created_at || now,
    updated_at: now,
    project: draft.project,
    reference: draft.reference,
    requester: draft.requester,
    lines: draft.lines,
  }
  store([next, ...list.filter((d) => d.id !== next.id)])
  return next
}
export function deleteDraft(id: string) {
  store(load().filter((d) => d.id !== id))
}
