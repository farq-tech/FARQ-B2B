// relative imports with extensions, so node --test can load this file for lib/inbox-feed.test.ts
import type { InboxMessage, RequestItem } from './types.ts'

/**
 * WhatsApp replies from the account's server feed (`/api/inbox`, received by the targeting service's webhook) joined
 * to the inbox the device already keeps. The feed carries the request and the directory record (poiKey) each reply
 * answers, never a phone number; the business is named from the request's own saved businesses.
 */

export type ServerInboxMessage = {
  id: string
  requestId: string
  poiKey: string
  kind: string
  body: string
  receivedAt: string
  /** Read on any of the person's devices (kept by the service). */
  read: boolean
}

/** The delivery state of the newest campaign message a recipient of a request was sent. */
export type ServerDelivery = { requestId: string; poiKey: string; status: 'sent' | 'delivered' | 'read' | 'failed'; at: string | null }

export type ServerFeed = { messages: ServerInboxMessage[]; deliveries: ServerDelivery[]; owner: boolean }

/** What a reply without words of its own is, in the inbox's words. Text kinds have none. */
const KIND_LABEL: Record<string, string> = {
  image: 'صورة',
  video: 'مقطع فيديو',
  audio: 'رسالة صوتية',
  voice: 'رسالة صوتية',
  document: 'مستند',
  sticker: 'ملصق',
  location: 'موقع',
  contacts: 'جهة اتصال',
  reaction: 'تفاعل',
  order: 'طلب',
  unsupported: 'رسالة',
}

export const kindLabel = (kind: string | undefined) => (kind ? KIND_LABEL[kind] ?? null : null)

/** The line a list row shows: the reply's words, else what kind of attachment it is. */
export function previewText(message: Pick<InboxMessage, 'body' | 'kind'>) {
  if (message.body.trim()) return message.body
  const label = kindLabel(message.kind)
  return label ? `مرفق: ${label}` : 'غير متاح'
}

/** Under a reply that is not text: Atlas keeps only the words, so the attachment is named and left to WhatsApp. */
export function kindNote(kind: string | undefined) {
  const label = kindLabel(kind)
  if (!label || kind === 'reaction') return null
  return kind === 'unsupported' ? 'رسالة لا يعرضها أطلس. افتحها في واتساب.' : `مرفق (${label}) لا يعرضه أطلس. افتحه في واتساب.`
}

/** The request a reply answers, by the id it was sent under (its local id, kept in the account copy too) or its cloud id. */
export function requestFor<T extends Pick<RequestItem, 'id' | 'remoteId'>>(requests: readonly T[], requestId: string): T | undefined {
  return requests.find((request) => request.id === requestId) ?? requests.find((request) => request.remoteId === requestId)
}

export function fromServer(message: ServerInboxMessage): InboxMessage {
  return {
    id: message.id,
    source: 'campaign',
    origin: 'whatsapp',
    requestId: message.requestId,
    businessId: message.poiKey,
    body: message.body,
    kind: message.kind === 'text' || message.kind === 'button' || message.kind === 'interactive' ? undefined : message.kind,
    receivedAt: message.receivedAt,
    unread: !message.read,
  }
}

/**
 * The server's replies joined to the inbox on screen. Device-only items are never touched. A reply the device already
 * has keeps its draft and takes the read state the service holds (read on another device reads here too), except one
 * whose read state this device changed a moment ago and has not heard back about yet (`pending`). Returns the same
 * array when nothing changed, so the store can skip the update.
 */
export function mergeServerInbox(current: InboxMessage[], server: readonly ServerInboxMessage[], pending: ReadonlySet<string> = new Set()): InboxMessage[] {
  const byId = new Map(server.map((message) => [message.id, message]))
  let changed = false
  const next = current.map((message) => {
    const remote = message.origin === 'whatsapp' ? byId.get(message.id) : undefined
    if (!remote || pending.has(message.id) || message.unread === !remote.read) return message
    changed = true
    return { ...message, unread: !remote.read }
  })
  const have = new Set(current.map((message) => message.id))
  for (const message of byId.values()) {
    if (have.has(message.id)) continue
    changed = true
    next.push(fromServer(message))
  }
  return changed ? next : current
}

/** Unread messages, for the badge on the inbox link: device items and replies alike. */
export const unreadCount = (inbox: readonly Pick<InboxMessage, 'unread'>[]) => inbox.reduce((n, message) => n + (message.unread ? 1 : 0), 0)

/**
 * WhatsApp replies that arrived unread since the inbox was last looked at (`seen`: the reply ids known then), oldest
 * first, so a notice can say a new one came in. The first look (`seen` null) announces nothing: a page load is not news.
 */
export function freshReplies(seen: ReadonlySet<string> | null, inbox: readonly InboxMessage[]): InboxMessage[] {
  if (!seen) return []
  return inbox.filter((message) => message.origin === 'whatsapp' && message.unread && !seen.has(message.id))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
}

const DELIVERY_LABEL: Record<ServerDelivery['status'], string> = { sent: 'أُرسلت', delivered: 'وصلت', read: 'قُرئت', failed: 'لم تصل' }
export const deliveryLabel = (status: ServerDelivery['status']) => DELIVERY_LABEL[status]

/** Every recipient's delivery state in one request, by recipient id (the request's local or cloud id). */
export function trackedFor(deliveries: readonly ServerDelivery[], request: Pick<RequestItem, 'id' | 'remoteId'>): Record<string, ServerDelivery['status']> {
  const out: Record<string, ServerDelivery['status']> = {}
  for (const d of deliveries) if (d.requestId === request.id || (request.remoteId != null && d.requestId === request.remoteId)) out[d.poiKey] ??= d.status
  return out
}

/** A recipient's delivery state in a request, found by the request's local or cloud id. */
export function deliveryFor(deliveries: readonly ServerDelivery[], request: Pick<RequestItem, 'id' | 'remoteId'>, poiKey: string): ServerDelivery | undefined {
  return deliveries.find((d) => d.poiKey === poiKey && (d.requestId === request.id || (request.remoteId != null && d.requestId === request.remoteId)))
}

const STATUSES = new Set(['sent', 'delivered', 'read', 'failed'])

/** Reads `/api/inbox`'s answer; anything not in the expected shape is dropped. */
export function parseServerFeed(payload: unknown): ServerFeed {
  const root = payload && typeof payload === 'object' ? payload as { messages?: unknown; deliveries?: unknown; owner?: unknown } : {}
  const messages = (Array.isArray(root.messages) ? root.messages : []).flatMap((item) => {
    const m = (item ?? {}) as Partial<Record<keyof ServerInboxMessage, unknown>>
    if (typeof m.id !== 'string' || typeof m.requestId !== 'string' || typeof m.poiKey !== 'string' || typeof m.receivedAt !== 'string' || Number.isNaN(Date.parse(m.receivedAt))) return []
    return [{ id: m.id, requestId: m.requestId, poiKey: m.poiKey, kind: typeof m.kind === 'string' ? m.kind : 'unsupported', body: typeof m.body === 'string' ? m.body : '', receivedAt: m.receivedAt, read: m.read === true }]
  })
  const deliveries = (Array.isArray(root.deliveries) ? root.deliveries : []).flatMap((item) => {
    const d = (item ?? {}) as Record<string, unknown>
    if (typeof d.requestId !== 'string' || typeof d.poiKey !== 'string' || typeof d.status !== 'string' || !STATUSES.has(d.status)) return []
    return [{ requestId: d.requestId, poiKey: d.poiKey, status: d.status as ServerDelivery['status'], at: typeof d.at === 'string' && !Number.isNaN(Date.parse(d.at)) ? d.at : null }]
  })
  return { messages, deliveries, owner: root.owner === true }
}
