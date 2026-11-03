'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { CATEGORIES, DEFAULT_VARIABLES, businessById } from './mock-data'
import { makeId } from './format'
import type { GoalId, InboxMessage, LiveBusinessSnapshot, RequestItem, RequestType, RfqDetails } from './types'
import { mergeCloudRequests } from './workspace-merge'
import { safeMapOrigin } from './handoff'
import { mergeIntoRequest, removeFromRequest } from './request-add'
import { readView, saveView, type SavedView } from './saved-views'

const LOCAL_STORAGE_KEY = 'farq-atlas-workspace-v3'
const LEGACY_SESSION_STORAGE_KEY = 'farq-atlas-workspace-v2'

interface State {
  requests: RequestItem[]
  inbox: InboxMessage[]
  selection: string[]
  /** Comparisons saved by name (lib/saved-views.ts), on this device with the requests. */
  views: SavedView[]
}

type CloudRequest = { id?: unknown; title?: unknown; payload?: unknown }

type Action =
  | { type: 'toggle-select'; id: string }
  | { type: 'set-selection'; ids: string[] }
  | { type: 'add-request'; request: RequestItem }
  | { type: 'update-request'; id: string; patch: Partial<RequestItem> }
  | { type: 'mark-read'; id: string; unread?: boolean }
  | { type: 'update-message'; id: string; patch: Partial<InboxMessage> }
  | { type: 'restore'; state: Pick<State, 'requests' | 'inbox' | 'views'> }
  | { type: 'set-views'; views: SavedView[] }
  | { type: 'add-cloud'; requests: RequestItem[] }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'restore':
      return { ...state, requests: action.state.requests, inbox: action.state.inbox, views: action.state.views }
    case 'set-views':
      return { ...state, views: action.views }
    case 'add-cloud': {
      // the account's saved requests join what is on screen now; nothing local is replaced (lib/workspace-merge.ts)
      const requests = mergeCloudRequests(state.requests, action.requests)
      return requests === state.requests ? state : { ...state, requests }
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

function readWorkspace(): Pick<State, 'requests' | 'inbox' | 'views'> | null {
  try {
    // v2 used the browser session, so a carefully prepared draft disappeared
    // as soon as the user closed the tab. Keep v2 readable for a one-time
    // migration, then persist the same safe local workspace on this device.
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? window.sessionStorage.getItem(LEGACY_SESSION_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { requests?: unknown; inbox?: unknown; views?: unknown }
    if (!Array.isArray(value.requests) || !Array.isArray(value.inbox)) return null
    const requests = value.requests.filter(isRequest).map(normalizeCampaignRecipients)
    const inbox = value.inbox.filter(isInboxMessage)
    // a workspace saved before comparisons could be saved has none; a saved one that does not read back is left out
    const views = Array.isArray(value.views) ? value.views.map(readView).filter((view): view is SavedView => Boolean(view)) : []
    return requests.length === value.requests.length && inbox.length === value.inbox.length ? { requests, inbox, views } : null
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
  updateMessage: (id: string, patch: Partial<InboxMessage>) => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    requests: [],
    inbox: [],
    selection: [],
    views: [],
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

  useEffect(() => {
    if (!workspaceReady) return
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ requests: state.requests, inbox: state.inbox, views: state.views }))
    } catch {
      // Retain the current behavior on privacy-restricted browsers, even when
      // durable local storage is unavailable.
      try {
        window.sessionStorage.setItem(LEGACY_SESSION_STORAGE_KEY, JSON.stringify({ requests: state.requests, inbox: state.inbox, views: state.views }))
      } catch {
        // The active workspace remains usable if this browser blocks storage.
      }
    }
  }, [workspaceReady, state.requests, state.inbox, state.views])

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
  const viewsRef = useRef<SavedView[]>([])
  useEffect(() => { viewsRef.current = state.views }, [state.views])
  const saveComparison = useCallback((view: SavedView) => dispatch({ type: 'set-views', views: saveView(viewsRef.current, view) }), [])
  const removeComparison = useCallback((id: string) => dispatch({ type: 'set-views', views: viewsRef.current.filter((view) => view.id !== id) }), [])
  const markRead = useCallback((id: string, unread?: boolean) => dispatch({ type: 'mark-read', id, unread }), [])
  const updateMessage = useCallback(
    (id: string, patch: Partial<InboxMessage>) => dispatch({ type: 'update-message', id, patch }),
    [],
  )

  const value = useMemo(
    () => ({ ...state, toggleSelect, setSelection, createDraft, updateRequest, addToRequest, removeFromRequest: removeFrom, markRead, updateMessage, saveComparison, removeComparison }),
    [state, toggleSelect, setSelection, createDraft, updateRequest, addToRequest, removeFrom, markRead, updateMessage, saveComparison, removeComparison],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useAppStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider')
  return ctx
}
