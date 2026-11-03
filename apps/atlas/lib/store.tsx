'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { CATEGORIES, DEFAULT_VARIABLES, businessById } from './mock-data'
import { makeId } from './format'
import type { GoalId, InboxMessage, LiveBusinessSnapshot, RequestItem, RequestType, RfqDetails } from './types'
import { mergeCloudRequests } from './workspace-merge'
import { mergeServerInbox, parseServerFeed, type ServerDelivery, type ServerElsewhere, type ServerFeed, type ServerReplyStat } from './inbox-feed'
import { safeMapOrigin } from './handoff'
import { mergeIntoRequest, removeFromRequest } from './request-add'
import { deviceOnlyViews, mergeSavedViews, readView, saveView, viewKey, type SavedView } from './saved-views'
import { SESSION_CHANGED } from './use-signed-in'

const LOCAL_STORAGE_KEY = 'farq-atlas-workspace-v3'
const LEGACY_SESSION_STORAGE_KEY = 'farq-atlas-workspace-v2'
/** The shortest gap between two account syncs of the saved comparisons started by returning to the tab. */
const FOCUS_SYNC_MS = 30_000

interface State {
  requests: RequestItem[]
  inbox: InboxMessage[]
  selection: string[]
  /** Comparisons saved by name (lib/saved-views.ts), on this device with the requests and, signed in, in the account. */
  views: SavedView[]
  /** Addresses of comparisons deleted here that the account has not confirmed yet (asked again on the next sync). */
  viewsRemoved: string[]
  /** Delivery state of the account's WhatsApp campaign messages, per request and recipient (from /api/inbox; not stored). */
  deliveries: ServerDelivery[]
  /** Whether the signed-in person reviews unlinked replies (a Farq owner); only shows a link, the page checks again. */
  inboxOwner: boolean
  /** How many feeds of replies have arrived this visit (0 before the first), so a notice can tell new from loaded. */
  repliesVersion: number
  /** Per request, from the service: recipients reached, replied, median time to a first reply (not stored). */
  replyStats: ServerReplyStat[]
  /** Recipients who answered another of the person's campaigns instead of this one (not stored). */
  repliedElsewhere: ServerElsewhere[]
}

type CloudRequest = { id?: unknown; title?: unknown; payload?: unknown }

type Action =
  | { type: 'toggle-select'; id: string }
  | { type: 'set-selection'; ids: string[] }
  | { type: 'add-request'; request: RequestItem }
  | { type: 'update-request'; id: string; patch: Partial<RequestItem> }
  | { type: 'mark-read'; id: string; unread?: boolean }
  | { type: 'update-message'; id: string; patch: Partial<InboxMessage> }
  | { type: 'restore'; state: Pick<State, 'requests' | 'inbox' | 'views' | 'viewsRemoved'> }
  | { type: 'set-views'; views: SavedView[]; viewsRemoved?: string[] }
  | { type: 'add-cloud'; requests: RequestItem[] }
  | { type: 'add-replies'; feed: ServerFeed; pending: ReadonlySet<string> }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'restore':
      return { ...state, requests: action.state.requests, inbox: action.state.inbox, views: action.state.views, viewsRemoved: action.state.viewsRemoved }
    case 'set-views':
      return { ...state, views: action.views, viewsRemoved: action.viewsRemoved ?? state.viewsRemoved }
    case 'add-cloud': {
      // the account's saved requests join what is on screen now; nothing local is replaced (lib/workspace-merge.ts)
      const requests = mergeCloudRequests(state.requests, action.requests)
      return requests === state.requests ? state : { ...state, requests }
    }
    case 'add-replies': {
      // WhatsApp replies from the account's feed join the device's inbox with the read state the service keeps;
      // drafts and device-only items stay as they are (lib/inbox-feed.ts)
      const inbox = mergeServerInbox(state.inbox, action.feed.messages, action.pending)
      return { ...state, inbox, deliveries: action.feed.deliveries, inboxOwner: action.feed.owner, repliesVersion: state.repliesVersion + 1,
        replyStats: action.feed.requests, repliedElsewhere: action.feed.elsewhere }
    }
    case 'toggle-select':
      return {
        ...state,
        selection: state.selection.includes(action.id)
          ? state.selection.filter((x) => x !== action.id)
          : [...state.selection, action.id],
      }
    case 'set-selection':
      return { ...state, selection: action.ids }
    case 'add-request':
      return { ...state, requests: [action.request, ...state.requests] }
    case 'update-request':
      return {
        ...state,
        requests: state.requests.map((r) =>
          r.id === action.id ? { ...r, ...action.patch, updatedAt: new Date().toISOString() } : r,
        ),
      }
    case 'mark-read':
      return {
        ...state,
        inbox: state.inbox.map((m) => (m.id === action.id ? { ...m, unread: action.unread ?? false } : m)),
      }
    case 'update-message':
      return { ...state, inbox: state.inbox.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)) }
  }
}

export interface DraftInput {
  type: RequestType
  businessIds: string[]
  cityId: string
  /** the city's Arabic name as the map shows it (from the shared city list) */
  cityName?: string
  goal?: GoalId | null
  query?: string
  categoryHint?: string
  districtHint?: string
  liveBusinesses?: LiveBusinessSnapshot[]
  /** The map view the businesses were picked in (lib/handoff.ts safeMapOrigin checks it). */
  origin?: string
  /** A quote request's own title and details when the page that starts it already knows them (a priced property). */
  title?: string
  rfq?: Partial<RfqDetails>
}

function buildDraft(input: DraftInput): RequestItem {
  const now = new Date().toISOString()
  const ids = input.businessIds
  const firstLiveBusiness = input.liveBusinesses?.find((business) => ids.includes(business.id))
  const firstCategory =
    input.categoryHint ?? firstLiveBusiness?.category ?? (ids.length ? businessById.get(ids[0])?.category : undefined) ?? 'منشآت'
  const cityName = input.cityName
  const place = input.districtHint ?? firstLiveBusiness?.district ?? cityName ?? ''
  const cat = CATEGORIES.find((c) => c.name === firstCategory)
  const base: RequestItem = {
    id: makeId(input.type === 'rfq' ? 'rfq' : input.type === 'campaign' ? 'cmp' : 'lst'),
    type: input.type,
    title: '',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    cityId: input.cityId,
    cityName,
    businessIds: ids,
    liveBusinesses: input.liveBusinesses?.filter((business) => ids.includes(business.id)),
    goal: input.goal ?? undefined,
    query: input.query,
    origin: safeMapOrigin(input.origin) ?? undefined,
  }
  if (input.type === 'rfq') {
    return {
      ...base,
      title: input.title ?? `طلب تسعير ${firstCategory} - ${place}`,
      rfq: {
        lineItems: [
          { id: makeId('l'), name: cat?.specialties[0] ?? 'بند جديد', qty: 100, unit: 'حبة', spec: '' },
        ],
        deadline: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
        deliveryCity: cityName ?? '',
        notes: '',
        ...input.rfq,
      },
    }
  }
  if (input.type === 'campaign') {
    const liveById = new Map(input.liveBusinesses?.map((business) => [business.id, business]))
    return {
      ...base,
      title: `حملة ${firstCategory} - ${place}`,
      campaign: {
        templateId: 't-intro',
        variables: { ...DEFAULT_VARIABLES },
        included: ids.filter((id) => {
          const b = businessById.get(id)
          return Boolean(b?.whatsapp || liveById.get(id)?.whatsapp)
        }),
      },
    }
  }
  return { ...base, title: `قائمة ${firstCategory} - ${place}`, notes: '' }
}

function cloudKind(request: RequestItem) {
  return request.type === 'rfq' ? 'PURCHASE_REQUEST' : request.type === 'campaign' ? 'SELLER_CATALOG' : 'SEARCH'
}

/** Store Atlas-owned fields under the Farq request payload; omit live contacts and coordinates. */
function cloudPayload(request: RequestItem) {
  const { remoteId: _remoteId, liveBusinesses: _liveBusinesses, ...atlasDraft } = request
  return { atlasDraft, schema: 'atlas-request-v1' }
}

function cloudRequest(value: CloudRequest): RequestItem | null {
  const payload = value.payload && typeof value.payload === 'object' ? value.payload as { atlasDraft?: unknown; schema?: unknown } : null
  if (payload?.schema !== 'atlas-request-v1' || !isRequest(payload.atlasDraft) || typeof value.id !== 'string') return null
  return { ...normalizeCampaignRecipients(payload.atlasDraft), remoteId: value.id }
}

function normalizeCampaignRecipients(request: RequestItem): RequestItem {
  if (!request.campaign) return request
  const liveById = new Map(request.liveBusinesses?.map((business) => [business.id, business]))
  // a recipient the person left out at review stays out after a reload: only a workspace saved without a recipient
  // list starts from everyone on the list who can receive WhatsApp
  const chosen = Array.isArray(request.campaign.included) ? new Set(request.campaign.included) : null
  const eligibleIds = request.businessIds.filter((id) => {
    if (chosen && !chosen.has(id)) return false
    const business = businessById.get(id)
    const liveBusiness = liveById.get(id)
    if (business) return Boolean(business.whatsapp)
    if (liveBusiness) return liveBusiness.whatsapp
    // A cloud-restored request intentionally has no directory snapshot. Preserve
    // its previously selected POI keys; the sender re-resolves them server-side.
    return chosen?.has(id) ?? false
  })
  return { ...request, campaign: { ...request.campaign, included: [...new Set(eligibleIds)] } }
}

async function createCloudRequest(request: RequestItem) {
  const response = await fetch('/api/requests', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: cloudKind(request), title: request.title, payload: cloudPayload(request) }),
  })
  if (!response.ok) return null
  const body = await response.json().catch(() => null) as { data?: { request?: { id?: unknown } }; request?: { id?: unknown } } | null
  const id = body?.data?.request?.id ?? body?.request?.id
  return typeof id === 'string' ? id : null
}

async function updateCloudRequest(request: RequestItem) {
  if (!request.remoteId) return
  await fetch(`/api/requests/${encodeURIComponent(request.remoteId)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: request.title, payload: cloudPayload(request) }),
  }).catch(() => undefined)
}

function isRequest(value: unknown): value is RequestItem {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<RequestItem>
  return typeof request.id === 'string' && typeof request.title === 'string' && Array.isArray(request.businessIds) && typeof request.status === 'string' && typeof request.type === 'string'
}

function isInboxMessage(value: unknown): value is InboxMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<InboxMessage>
  return typeof message.id === 'string' && typeof message.requestId === 'string' && typeof message.body === 'string'
}

/** Where saved comparisons can be kept: 'in' the account, 'out' (signed out), 'off' (this account cannot keep them),
 * 'error' (the account did not answer), null before the first answer. */
export type ViewsAccount = 'in' | 'out' | 'off' | 'error' | null

/** The account's saved comparisons; 'out' when signed out; 'off' when the account cannot keep them; null when out of reach. */
async function fetchViews(): Promise<SavedView[] | 'out' | 'off' | null> {
  try {
    const response = await fetch('/api/saved-views', { cache: 'no-store' })
    if (response.status === 401) return 'out'
    if (response.status === 404) return 'off'
    if (!response.ok) return null
    const body = await response.json().catch(() => null) as { views?: unknown } | null
    return Array.isArray(body?.views) ? body.views.map(readView).filter((view): view is SavedView => Boolean(view)) : null
  } catch {
    return null
  }
}

async function sendView(view: SavedView) {
  const response = await fetch('/api/saved-views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ view }) }).catch(() => null)
  return Boolean(response?.ok)
}

async function deleteView(href: string) {
  const response = await fetch('/api/saved-views', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ href }) }).catch(() => null)
  return Boolean(response?.ok)
}

function readWorkspace(): Pick<State, 'requests' | 'inbox' | 'views' | 'viewsRemoved'> | null {
  try {
    // v2 used the browser session, so a carefully prepared draft disappeared
    // as soon as the user closed the tab. Keep v2 readable for a one-time
    // migration, then persist the same safe local workspace on this device.
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? window.sessionStorage.getItem(LEGACY_SESSION_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { requests?: unknown; inbox?: unknown; views?: unknown; viewsRemoved?: unknown }
    if (!Array.isArray(value.requests) || !Array.isArray(value.inbox)) return null
    const requests = value.requests.filter(isRequest).map(normalizeCampaignRecipients)
    const inbox = value.inbox.filter(isInboxMessage)
    // a workspace saved before comparisons could be saved has none; a saved one that does not read back is left out
    const views = Array.isArray(value.views) ? value.views.map(readView).filter((view): view is SavedView => Boolean(view)) : []
    const viewsRemoved = Array.isArray(value.viewsRemoved) ? value.viewsRemoved.filter((href): href is string => typeof href === 'string' && href.length <= 600).slice(0, 100) : []
    return requests.length === value.requests.length && inbox.length === value.inbox.length ? { requests, inbox, views, viewsRemoved } : null
  } catch {
    return null
  }
}

interface StoreValue extends State {
  toggleSelect: (id: string) => void
  setSelection: (ids: string[]) => void
  createDraft: (input: DraftInput) => string
  updateRequest: (id: string, patch: Partial<RequestItem>) => void
  /** Adds businesses picked on the map to a draft; how many were new (0 when none, or the request is past its draft). */
  addToRequest: (id: string, businesses: LiveBusinessSnapshot[]) => number
  /** Takes businesses off a draft; how many came off (0 when none, or the request is past its draft). */
  removeFromRequest: (id: string, businessIds: string[]) => number
  markRead: (id: string, unread?: boolean) => void
  /** Saves a comparison by name (the same address again is renamed, not copied); removes one by id. */
  saveComparison: (view: SavedView) => void
  removeComparison: (id: string) => void
  /** Where the saved comparisons can be kept now (lib/store.tsx ViewsAccount). */
  viewsAccount: ViewsAccount
  /** Joins this device's comparisons to the account again (the «احفظ في حسابك» retry); true when all are kept there. */
  syncComparisons: () => Promise<boolean>
  updateMessage: (id: string, patch: Partial<InboxMessage>) => void
  /** Asks the account's feed for new WhatsApp replies now (the inbox calls it when it opens). */
  refreshReplies: (force?: boolean) => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    requests: [],
    inbox: [],
    selection: [],
    views: [],
    viewsRemoved: [],
    deliveries: [],
    inboxOwner: false,
    repliesVersion: 0,
    replyStats: [],
    repliedElsewhere: [],
  })
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const requestsRef = useRef<RequestItem[]>([])
  const cloudUpdateTimers = useRef(new Map<string, number>())

  useEffect(() => { requestsRef.current = state.requests }, [state.requests])
  useEffect(() => () => { cloudUpdateTimers.current.forEach((timer) => clearTimeout(timer)) }, [])

  useEffect(() => {
    const saved = readWorkspace()
    if (saved) dispatch({ type: 'restore', state: saved })
    fetch('/api/requests?hidden=include&archived=include', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return [] as RequestItem[]
        const body = await response.json().catch(() => null) as { data?: { requests?: CloudRequest[] }; requests?: CloudRequest[] } | null
        return (body?.data?.requests ?? body?.requests ?? []).map(cloudRequest).filter((request): request is RequestItem => Boolean(request))
      })
      .then((cloud) => {
        // merged into the live state, not rebuilt from storage: storage is only written once this settles, so an
        // edit or a new draft made while the account loaded would otherwise be thrown away
        if (cloud.length) dispatch({ type: 'add-cloud', requests: cloud })
      })
      .catch(() => undefined)
      .finally(() => setWorkspaceReady(true))
  }, [])

  // WhatsApp replies to the account's campaigns (app/api/inbox): on open, when the tab comes back, when the inbox
  // opens, and every minute while the tab is in view. Signed out or not configured (401/403/503), the minute checks
  // pause until the tab comes back or the inbox opens; the inbox stays as it is.
  const repliesPaused = useRef(false)
  const repliesInFlight = useRef(false)
  // replies whose read state this device just changed: the next feed must not undo it before the service has it
  const pendingRead = useRef(new Set<string>())
  const refreshReplies = useCallback((force = false) => {
    if (repliesInFlight.current || document.visibilityState !== 'visible' || (repliesPaused.current && !force)) return
    repliesInFlight.current = true
    fetch('/api/inbox', { cache: 'no-store' })
      .then(async (response) => {
        repliesPaused.current = response.status === 401 || response.status === 403 || response.status === 503
        return response.ok ? parseServerFeed(await response.json().catch(() => null)) : null
      })
      .then((feed) => { if (feed) dispatch({ type: 'add-replies', feed, pending: new Set(pendingRead.current) }) })
      .catch(() => undefined)
      .finally(() => { repliesInFlight.current = false })
  }, [])
  useEffect(() => {
    refreshReplies(true)
    const timer = window.setInterval(() => refreshReplies(), 60_000)
    const back = () => refreshReplies(true)
    document.addEventListener('visibilitychange', back)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', back) }
  }, [refreshReplies])

  useEffect(() => {
    if (!workspaceReady) return
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ requests: state.requests, inbox: state.inbox, views: state.views, viewsRemoved: state.viewsRemoved }))
    } catch {
      // Retain the current behavior on privacy-restricted browsers, even when
      // durable local storage is unavailable.
      try {
        window.sessionStorage.setItem(LEGACY_SESSION_STORAGE_KEY, JSON.stringify({ requests: state.requests, inbox: state.inbox, views: state.views, viewsRemoved: state.viewsRemoved }))
      } catch {
        // The active workspace remains usable if this browser blocks storage.
      }
    }
  }, [workspaceReady, state.requests, state.inbox, state.views, state.viewsRemoved])

  const toggleSelect = useCallback((id: string) => dispatch({ type: 'toggle-select', id }), [])
  const setSelection = useCallback((ids: string[]) => dispatch({ type: 'set-selection', ids }), [])
  const createDraft = useCallback((input: DraftInput) => {
    const request = buildDraft(input)
    dispatch({ type: 'add-request', request })
    // A draft is only saved to Farq after the user deliberately created it.
    // This creates no recipient, campaign or external message.
    void createCloudRequest(request).then((remoteId) => {
      if (!remoteId) return
      dispatch({ type: 'update-request', id: request.id, patch: { remoteId } })
      // If the user edited while the initial save was in flight, send the latest draft next.
      window.setTimeout(() => {
        const latest = requestsRef.current.find((item) => item.id === request.id)
        if (latest) void updateCloudRequest({ ...latest, remoteId })
      }, 0)
    })
    return request.id
  }, [])
  const updateRequest = useCallback(
    (id: string, patch: Partial<RequestItem>) => {
      const current = requestsRef.current.find((request) => request.id === id)
      const next = current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : null
      dispatch({ type: 'update-request', id, patch })
      if (next?.remoteId) {
        const existing = cloudUpdateTimers.current.get(next.id)
        if (existing) clearTimeout(existing)
        cloudUpdateTimers.current.set(next.id, window.setTimeout(() => {
          cloudUpdateTimers.current.delete(next.id)
          void updateCloudRequest(next)
        }, 600))
      }
    },
    [],
  )
  const addToRequest = useCallback((id: string, businesses: LiveBusinessSnapshot[]) => {
    const current = requestsRef.current.find((request) => request.id === id)
    const merged = current ? mergeIntoRequest(current, businesses) : null
    if (!merged || !merged.added) return 0
    updateRequest(id, merged.patch)
    return merged.added
  }, [updateRequest])
  const removeFrom = useCallback((id: string, businessIds: string[]) => {
    const current = requestsRef.current.find((request) => request.id === id)
    const result = current ? removeFromRequest(current, businessIds) : null
    if (!result || !result.removed) return 0
    updateRequest(id, result.patch)
    return result.removed
  }, [updateRequest])
  // ── saved comparisons: on this device, and in the signed-in account (app/api/saved-views, lib/saved-views.ts) ──
  const viewsRef = useRef<SavedView[]>([])
  const removedRef = useRef<string[]>([])
  /** 'in' once the account answered, 'out' once it said signed out, null before or when it could not be reached. */
  const accountRef = useRef<ViewsAccount>(null)
  const [viewsAccount, setViewsAccount] = useState<ViewsAccount>(null)
  const setAccount = useCallback((next: ViewsAccount) => { accountRef.current = next; setViewsAccount(next) }, [])
  useEffect(() => { viewsRef.current = state.views; removedRef.current = state.viewsRemoved }, [state.views, state.viewsRemoved])
  const setViews = useCallback((views: SavedView[], viewsRemoved = removedRef.current) => {
    // the refs move with the dispatch, so a save and a sync answer arriving together both see the latest list
    viewsRef.current = views
    removedRef.current = viewsRemoved
    dispatch({ type: 'set-views', views, viewsRemoved })
  }, [])
  const markSynced = useCallback((href: string) => {
    const key = viewKey(href)
    setViews(viewsRef.current.map((view) => (viewKey(view.href) === key ? { ...view, synced: true } : view)))
  }, [setViews])
  const pushView = useCallback((view: SavedView) => {
    void sendView(view).then((ok) => { if (ok) markSynced(view.href) })
  }, [markSynced])
  const dropView = useCallback((href: string) => {
    void deleteView(href).then((ok) => {
      if (ok) setViews(viewsRef.current, removedRef.current.filter((item) => viewKey(item) !== viewKey(href)))
    })
  }, [setViews])
  const syncViews = useCallback(async () => {
    const cloud = await fetchViews()
    if (cloud === 'out') {
      setAccount('out')
      // signed out: the account's comparisons stay in the account, this device keeps the ones saved on it
      const own = deviceOnlyViews(viewsRef.current)
      if (own.length !== viewsRef.current.length) setViews(own)
      return false
    }
    if (cloud === 'off' || cloud === null) { setAccount(cloud === 'off' ? 'off' : 'error'); return false }
    setAccount('in')
    const plan = mergeSavedViews(viewsRef.current, cloud, removedRef.current)
    setViews(plan.views, plan.remove)
    plan.remove.forEach(dropView)
    // waited for, so a retry can say whether everything is in the account now
    const sent = await Promise.all(plan.upload.map(async (view) => {
      const ok = await sendView(view)
      if (ok) markSynced(view.href)
      return ok
    }))
    return sent.every(Boolean)
  }, [setViews, dropView, markSynced, setAccount])
  useEffect(() => {
    if (!workspaceReady) return
    void syncViews()
    // signing in or out on this page (the login form, the app bar's «خروج») joins or separates the account's list
    const again = () => { void syncViews() }
    window.addEventListener(SESSION_CHANGED, again)
    // coming back to this tab (from another device's tab, or the phone unlocked) picks up what changed meanwhile;
    // at most once every FOCUS_SYNC_MS, so switching windows back and forth does not ask the account each time
    let last = Date.now()
    const back = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < FOCUS_SYNC_MS) return
      last = Date.now()
      void syncViews()
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => {
      window.removeEventListener(SESSION_CHANGED, again)
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    }
  }, [workspaceReady, syncViews])
  /** Takes a view out of the account; remembered until the account confirms, so it is not merged back meanwhile. */
  const removeFromAccount = useCallback((href: string) => {
    if (accountRef.current === 'out' || accountRef.current === 'off') return
    setViews(viewsRef.current, [...removedRef.current.filter((item) => viewKey(item) !== viewKey(href)), href].slice(-100))
    if (accountRef.current === 'in') dropView(href)
  }, [setViews, dropView])
  const saveComparison = useCallback((view: SavedView) => {
    const before = viewsRef.current
    const views = saveView(before, view)
    setViews(views)
    const saved = views.find((item) => item.href === view.href)
    if (saved && accountRef.current === 'in') pushView(saved)
    // a comparison pushed off the end by the cap leaves the account as well
    for (const old of before) if (old.synced && !views.some((item) => viewKey(item.href) === viewKey(old.href))) removeFromAccount(old.href)
  }, [setViews, pushView, removeFromAccount])
  const removeComparison = useCallback((id: string) => {
    const view = viewsRef.current.find((item) => item.id === id)
    setViews(viewsRef.current.filter((item) => item.id !== id))
    if (view && (view.synced || accountRef.current === 'in')) removeFromAccount(view.href)
  }, [setViews, removeFromAccount])
  // a WhatsApp reply's read state is also kept by the service, so it follows the person to every device. Marks made
  // together (one click on «علّم المعروض كمقروء») go in one request.
  const inboxRef = useRef<InboxMessage[]>([])
  useEffect(() => { inboxRef.current = state.inbox }, [state.inbox])
  const readQueue = useRef<{ read: Set<string>; unread: Set<string>; timer: number | null }>({ read: new Set(), unread: new Set(), timer: null })
  const flushRead = useCallback(() => {
    const queue = readQueue.current
    queue.timer = null
    for (const [read, ids] of [[true, queue.read], [false, queue.unread]] as const) {
      if (!ids.size) continue
      const batch = [...ids]
      ids.clear()
      fetch('/api/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: batch, read }) })
        .catch(() => undefined)
        .finally(() => { for (const id of batch) pendingRead.current.delete(id) })
    }
  }, [])
  const markRead = useCallback((id: string, unread?: boolean) => {
    dispatch({ type: 'mark-read', id, unread })
    if (inboxRef.current.find((message) => message.id === id)?.origin !== 'whatsapp') return
    const queue = readQueue.current
    pendingRead.current.add(id)
    ;(unread ? queue.unread : queue.read).add(id)
    ;(unread ? queue.read : queue.unread).delete(id)
    if (queue.timer == null) queue.timer = window.setTimeout(flushRead, 250)
  }, [flushRead])
  const updateMessage = useCallback(
    (id: string, patch: Partial<InboxMessage>) => dispatch({ type: 'update-message', id, patch }),
    [],
  )

  const value = useMemo(
    () => ({ ...state, toggleSelect, setSelection, createDraft, updateRequest, addToRequest, removeFromRequest: removeFrom, markRead, updateMessage, saveComparison, removeComparison, viewsAccount, syncComparisons: syncViews, refreshReplies }),
    [state, toggleSelect, setSelection, createDraft, updateRequest, addToRequest, removeFrom, markRead, updateMessage, saveComparison, removeComparison, viewsAccount, syncViews, refreshReplies],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useAppStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider')
  return ctx
}
