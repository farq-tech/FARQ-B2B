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
}

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
    unread: true,
  }
}

/**
 * The server's replies added to the inbox on screen. Nothing on the device is replaced: a reply the device already has
 * keeps its read state and its reply draft. Returns the same array when nothing is new, so the store can skip it.
 */
export function mergeServerInbox(current: InboxMessage[], server: readonly ServerInboxMessage[]): InboxMessage[] {
  const have = new Set(current.map((message) => message.id))
  const fresh: InboxMessage[] = []
  for (const message of server) {
    if (have.has(message.id)) continue
    have.add(message.id)
    fresh.push(fromServer(message))
  }
  return fresh.length ? [...current, ...fresh] : current
}

/** Reads `/api/inbox`'s answer; anything not in the expected shape is dropped. */
export function parseServerInbox(payload: unknown): ServerInboxMessage[] {
  const messages = payload && typeof payload === 'object' ? (payload as { messages?: unknown }).messages : null
  if (!Array.isArray(messages)) return []
  return messages.flatMap((item) => {
    const m = item as Partial<Record<keyof ServerInboxMessage, unknown>>
    if (typeof m?.id !== 'string' || typeof m.requestId !== 'string' || typeof m.poiKey !== 'string' || typeof m.receivedAt !== 'string' || Number.isNaN(Date.parse(m.receivedAt))) return []
    return [{ id: m.id, requestId: m.requestId, poiKey: m.poiKey, kind: typeof m.kind === 'string' ? m.kind : 'unsupported', body: typeof m.body === 'string' ? m.body : '', receivedAt: m.receivedAt }]
  })
}
