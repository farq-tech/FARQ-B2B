'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { CATEGORIES, DEFAULT_VARIABLES, businessById, cityById } from './mock-data'
import { makeId } from './format'
import type { GoalId, InboxMessage, LiveBusinessSnapshot, RequestItem, RequestType } from './types'

const LOCAL_STORAGE_KEY = 'farq-atlas-workspace-v3'
const LEGACY_SESSION_STORAGE_KEY = 'farq-atlas-workspace-v2'

interface State {
  requests: RequestItem[]
  inbox: InboxMessage[]
  selection: string[]
}

type CloudRequest = { id?: unknown; title?: unknown; payload?: unknown }

type Action =
  | { type: 'toggle-select'; id: string }
  | { type: 'set-selection'; ids: string[] }
  | { type: 'add-request'; request: RequestItem }
  | { type: 'update-request'; id: string; patch: Partial<RequestItem> }
  | { type: 'mark-read'; id: string; unread?: boolean }
  | { type: 'update-message'; id: string; patch: Partial<InboxMessage> }
  | { type: 'restore'; state: Pick<State, 'requests' | 'inbox'> }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'restore':
      return { ...state, requests: action.state.requests, inbox: action.state.inbox }
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
  goal?: GoalId | null
  query?: string
  categoryHint?: string
  districtHint?: string
  liveBusinesses?: LiveBusinessSnapshot[]
}

function buildDraft(input: DraftInput): RequestItem {
  const now = new Date().toISOString()
  const ids = input.businessIds
  const firstLiveBusiness = input.liveBusinesses?.find((business) => ids.includes(business.id))
  const firstCategory =
    input.categoryHint ?? firstLiveBusiness?.category ?? (ids.length ? businessById.get(ids[0])?.category : undefined) ?? 'منشآت'
  const place = input.districtHint ?? firstLiveBusiness?.district ?? cityById.get(input.cityId)?.name ?? ''
  const cat = CATEGORIES.find((c) => c.name === firstCategory)
  const base: RequestItem = {
    id: makeId(input.type === 'rfq' ? 'rfq' : input.type === 'campaign' ? 'cmp' : 'lst'),
    type: input.type,
    title: '',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    cityId: input.cityId,
    businessIds: ids,
    liveBusinesses: input.liveBusinesses?.filter((business) => ids.includes(business.id)),
    goal: input.goal ?? undefined,
    query: input.query,
  }
  if (input.type === 'rfq') {
    return {
      ...base,
      title: `طلب تسعير ${firstCategory} - ${place}`,
      rfq: {
        lineItems: [
          { id: makeId('l'), name: cat?.specialties[0] ?? 'بند جديد', qty: 100, unit: 'حبة', spec: '' },
        ],
        deadline: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
        deliveryCity: cityById.get(input.cityId)?.name ?? '',
        notes: '',
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
  const eligibleIds = request.businessIds.filter((id) => {
    const business = businessById.get(id)
    return Boolean(business?.whatsapp || liveById.get(id)?.whatsapp)
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

function readWorkspace(): Pick<State, 'requests' | 'inbox'> | null {
  try {
    // v2 used the browser session, so a carefully prepared draft disappeared
    // as soon as the user closed the tab. Keep v2 readable for a one-time
    // migration, then persist the same safe local workspace on this device.
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? window.sessionStorage.getItem(LEGACY_SESSION_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { requests?: unknown; inbox?: unknown }
    if (!Array.isArray(value.requests) || !Array.isArray(value.inbox)) return null
    const requests = value.requests.filter(isRequest).map(normalizeCampaignRecipients)
    const inbox = value.inbox.filter(isInboxMessage)
    return requests.length === value.requests.length && inbox.length === value.inbox.length ? { requests, inbox } : null
  } catch {
    return null
  }
}

interface StoreValue extends State {
  toggleSelect: (id: string) => void
  setSelection: (ids: string[]) => void
  createDraft: (input: DraftInput) => string
  updateRequest: (id: string, patch: Partial<RequestItem>) => void
  markRead: (id: string, unread?: boolean) => void
  updateMessage: (id: string, patch: Partial<InboxMessage>) => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    requests: [],
    inbox: [],
    selection: [],
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
        if (!cloud.length) return
        const local = readWorkspace()?.requests ?? []
        const localIds = new Set(local.map((request) => request.remoteId ?? request.id))
        dispatch({ type: 'restore', state: { requests: [...local, ...cloud.filter((request) => !localIds.has(request.remoteId ?? request.id))], inbox: readWorkspace()?.inbox ?? [] } })
      })
      .catch(() => undefined)
      .finally(() => setWorkspaceReady(true))
  }, [])

  useEffect(() => {
    if (!workspaceReady) return
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ requests: state.requests, inbox: state.inbox }))
    } catch {
      // Retain the current behavior on privacy-restricted browsers, even when
      // durable local storage is unavailable.
      try {
        window.sessionStorage.setItem(LEGACY_SESSION_STORAGE_KEY, JSON.stringify({ requests: state.requests, inbox: state.inbox }))
      } catch {
        // The active workspace remains usable if this browser blocks storage.
      }
    }
  }, [workspaceReady, state.requests, state.inbox])

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
  const markRead = useCallback((id: string, unread?: boolean) => dispatch({ type: 'mark-read', id, unread }), [])
  const updateMessage = useCallback(
    (id: string, patch: Partial<InboxMessage>) => dispatch({ type: 'update-message', id, patch }),
    [],
  )

  const value = useMemo(
    () => ({ ...state, toggleSelect, setSelection, createDraft, updateRequest, markRead, updateMessage }),
    [state, toggleSelect, setSelection, createDraft, updateRequest, markRead, updateMessage],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useAppStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider')
  return ctx
}
