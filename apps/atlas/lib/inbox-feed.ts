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

/** A request's reply figures from the service: recipients reached, how many replied, median seconds to a first reply. */
export type ServerReplyStat = { requestId: string; sent: number; replied: number; medianReplySeconds: number | null }
/** A recipient that has not answered this request but answered another of the person's campaigns lately. */
export type ServerElsewhere = { requestId: string; poiKey: string; otherRequestId: string; messageId: string; at: string | null }

export type ServerFeed = { messages: ServerInboxMessage[]; deliveries: ServerDelivery[]; owner: boolean; requests: ServerReplyStat[]; elsewhere: ServerElsewhere[] }

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
  const root = payload && typeof payload === 'object' ? payload as { messages?: unknown; deliveries?: unknown; owner?: unknown; requests?: unknown; elsewhere?: unknown } : {}
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
  const whole = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
  const requests = (Array.isArray(root.requests) ? root.requests : []).flatMap((item) => {
    const r = (item ?? {}) as Record<string, unknown>
    const sent = whole(r.sent); const replied = whole(r.replied)
    return typeof r.requestId === 'string' && sent != null && replied != null ? [{ requestId: r.requestId, sent, replied, medianReplySeconds: whole(r.medianReplySeconds) }] : []
  })
  const elsewhere = (Array.isArray(root.elsewhere) ? root.elsewhere : []).flatMap((item) => {
    const e = (item ?? {}) as Record<string, unknown>
    return typeof e.requestId === 'string' && typeof e.poiKey === 'string' && typeof e.otherRequestId === 'string' && typeof e.messageId === 'string'
      ? [{ requestId: e.requestId, poiKey: e.poiKey, otherRequestId: e.otherRequestId, messageId: e.messageId, at: typeof e.at === 'string' ? e.at : null }] : []
  })
  return { messages, deliveries, owner: root.owner === true, requests, elsewhere }
}

/** The latest reply of each recipient of one request, by recipient id: whether, and with which message, they answered. */
export function repliesFor(inbox: readonly InboxMessage[], request: Pick<RequestItem, 'id' | 'remoteId'>): Record<string, string> {
  const out: Record<string, { id: string; at: string }> = {}
  for (const m of inbox) {
    if (m.requestId !== request.id && (request.remoteId == null || m.requestId !== request.remoteId)) continue
    const seen = out[m.businessId]
    if (!seen || m.receivedAt > seen.at) out[m.businessId] = { id: m.id, at: m.receivedAt }
  }
  return Object.fromEntries(Object.entries(out).map(([businessId, reply]) => [businessId, reply.id]))
}

export type SourceHealth = { running: boolean; lastOkAt: string | null; lastErrorAt: string | null; lastErrorKind: string | null; failures: number }

/** A read older than this (several missed minute polls) is worth a word to the owner. */
export const STALE_AFTER_MS = 10 * 60_000

/**
 * Where the reply source stands, for the owner: not running at all, never read yet, failing now (its last poll
 * failed), stale (no success for a while), or reading normally.
 */
export function healthState(health: SourceHealth | null | undefined, nowMs: number): 'unknown' | 'off' | 'never' | 'failing' | 'stale' | 'ok' {
  if (!health) return 'unknown'
  if (!health.running) return 'off'
  if (health.failures > 0) return 'failing'
  if (!health.lastOkAt) return 'never'
  return nowMs - Date.parse(health.lastOkAt) > STALE_AFTER_MS ? 'stale' : 'ok'
}

/** A recipient's message went out: WhatsApp reported on it (and not a failure), or this device saw it sent. */
export function wasSent(id: string, tracked: Readonly<Record<string, ServerDelivery['status']>> | undefined, delivery: Readonly<Record<string, string>> | undefined): boolean {
  const reported = tracked?.[id]
  return reported ? reported !== 'failed' : delivery?.[id] === 'sent'
}

export type ReplyFilter = 'all' | 'waiting' | 'replied'

/** The recipients a campaign's reply filter shows: everyone, those sent to who have not answered, or those who did. */
export function replyGroups(ids: readonly string[], sent: (id: string) => boolean, replied: Readonly<Record<string, string>> | undefined): Record<ReplyFilter, string[]> {
  return {
    all: [...ids],
    waiting: ids.filter((id) => sent(id) && !replied?.[id]),
    replied: ids.filter((id) => Boolean(replied?.[id])),
  }
}

/**
 * A campaign's reply rate: of the recipients its messages reached (sent and not failed), how many answered. Null when
 * nothing went out yet, so a list never says «0%» for a campaign that was not sent.
 */
export function replyRate(ids: readonly string[], sent: (id: string) => boolean, replied: Readonly<Record<string, string>> | undefined): { sent: number; replied: number; percent: number } | null {
  const reached = ids.filter(sent)
  if (!reached.length) return null
  const answered = reached.filter((id) => replied?.[id]).length
  return { sent: reached.length, replied: answered, percent: Math.round((answered / reached.length) * 100) }
}

const matchesRequest = (id: string, request: Pick<RequestItem, 'id' | 'remoteId'>) => id === request.id || (request.remoteId != null && id === request.remoteId)

/** The service's reply figures for one request (by its local or cloud id); undefined before the feed has them. */
export function statFor(stats: readonly ServerReplyStat[], request: Pick<RequestItem, 'id' | 'remoteId'>): ServerReplyStat | undefined {
  return stats.find((s) => matchesRequest(s.requestId, request))
}

/**
 * Recipients of the original who answered one of its follow-ups (this device's inbox), in the same shape as the
 * service's «replied elsewhere», so the original does not call them silent before the service says so.
 */
export function answeredFollowUps(inbox: readonly InboxMessage[], original: Pick<RequestItem, 'id' | 'remoteId'>, followUps: readonly Pick<RequestItem, 'id' | 'remoteId'>[]): Record<string, ServerElsewhere> {
  const own = repliesFor(inbox, original)
  const out: Record<string, ServerElsewhere> = {}
  for (const f of followUps) {
    for (const [poiKey, messageId] of Object.entries(repliesFor(inbox, f))) {
      if (!own[poiKey] && !out[poiKey]) out[poiKey] = { requestId: original.id, poiKey, otherRequestId: f.id, messageId, at: null }
    }
  }
  return out
}

/** Recipients of one request who answered another of the person's campaigns instead, by recipient id. */
export function elsewhereFor(elsewhere: readonly ServerElsewhere[], request: Pick<RequestItem, 'id' | 'remoteId'>): Record<string, ServerElsewhere> {
  const out: Record<string, ServerElsewhere> = {}
  for (const e of elsewhere) if (matchesRequest(e.requestId, request)) out[e.poiKey] ??= e
  return out
}

/**
 * The reply rate as a list or a header shows it: the service's figures when it has them (every device the same), else
 * this device's own count. Null when nothing went out.
 */
export function rateFor(stat: ServerReplyStat | undefined, local: { sent: number; replied: number; percent: number } | null): { sent: number; replied: number; percent: number; medianReplySeconds: number | null } | null {
  if (stat && stat.sent > 0) return { sent: stat.sent, replied: Math.min(stat.replied, stat.sent), percent: Math.round((Math.min(stat.replied, stat.sent) / stat.sent) * 100), medianReplySeconds: stat.medianReplySeconds }
  return local ? { ...local, medianReplySeconds: null } : null
}

/** A reply time in whole units: minutes under an hour, hours under two days, else days. */
export function durationParts(seconds: number): { value: number; unit: 'minute' | 'hour' | 'day' } {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return { value: minutes, unit: 'minute' }
  const hours = Math.round(seconds / 3600)
  if (hours < 48) return { value: hours, unit: 'hour' }
  return { value: Math.round(seconds / 86400), unit: 'day' }
}

/** The recipient filter in the request page's address (`?replies=waiting|replied`); anything else is «الكل». */
export function readReplyFilter(search: string): ReplyFilter {
  const value = new URLSearchParams(search).get('replies')
  return value === 'waiting' || value === 'replied' ? value : 'all'
}

export function writeReplyFilter(search: string, filter: ReplyFilter): string {
  const query = new URLSearchParams(search)
  if (filter === 'all') query.delete('replies')
  else query.set('replies', filter)
  const text = query.toString()
  return text ? `?${text}` : ''
}

/**
 * A campaign and its follow-ups as one result: of the original's recipients the messages reached, how many answered
 * the original or any follow-up. Null when the original reached nobody.
 */
export function combinedRate(
  original: Pick<RequestItem, 'id' | 'remoteId' | 'campaign'>,
  followUps: readonly Pick<RequestItem, 'id' | 'remoteId'>[],
  inbox: readonly InboxMessage[],
  sent: (id: string) => boolean,
): { sent: number; replied: number; percent: number; viaFollowUps: number } | null {
  const reached = (original.campaign?.included ?? []).filter(sent)
  if (!reached.length) return null
  const own = repliesFor(inbox, original)
  const later = followUps.map((f) => repliesFor(inbox, f))
  const repliedOwn = reached.filter((id) => own[id])
  const viaFollowUps = reached.filter((id) => !own[id] && later.some((r) => r[id])).length
  const replied = repliedOwn.length + viaFollowUps
  return { sent: reached.length, replied, percent: Math.round((replied / reached.length) * 100), viaFollowUps }
}

/** WhatsApp lets a business answer freely for 24 hours after a person's last message; after that only an approved
 * template may be sent. */
export const REPLY_WINDOW_MS = 24 * 3600_000

/**
 * The 24-hour window a WhatsApp reply opened, for information only (Atlas sends no reply from the inbox): it runs from
 * the business's latest message on that request, so an older message of the same conversation names the same end.
 * Null for a message that is not a WhatsApp reply.
 */
export function replyWindow(inbox: readonly InboxMessage[], message: InboxMessage, nowMs: number): { open: boolean; until: string } | null {
  if (message.origin !== 'whatsapp') return null
  const latest = inbox
    .filter((m) => m.origin === 'whatsapp' && m.requestId === message.requestId && m.businessId === message.businessId)
    .reduce((best, m) => (m.receivedAt > best ? m.receivedAt : best), message.receivedAt)
  const until = Date.parse(latest) + REPLY_WINDOW_MS
  if (Number.isNaN(until)) return null
  return { open: nowMs < until, until: new Date(until).toISOString() }
}

/** Where a request page keeps its recipient filter for this tab, so leaving for the inbox and coming back keeps it. */
export const replyFilterKey = (requestId: string) => `atlas.replies|${requestId}`

/** The filter to open on: the address wins; else the one this tab last used on this request; else «الكل». */
export function openingReplyFilter(search: string, remembered: string | null | undefined): ReplyFilter {
  if (new URLSearchParams(search).has('replies')) return readReplyFilter(search)
  return remembered === 'waiting' || remembered === 'replied' ? remembered : 'all'
}
