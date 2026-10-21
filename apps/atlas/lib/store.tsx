'use client'

import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react'
import { CATEGORIES, DEFAULT_VARIABLES, SEED_INBOX, SEED_REQUESTS, businessById, cityById } from './mock-data'
import { makeId } from './format'
import type { GoalId, InboxMessage, LiveBusinessSnapshot, RequestItem, RequestType } from './types'

interface State {
  requests: RequestItem[]
  inbox: InboxMessage[]
  selection: string[]
}

type Action =
  | { type: 'toggle-select'; id: string }
  | { type: 'set-selection'; ids: string[] }
  | { type: 'add-request'; request: RequestItem }
  | { type: 'update-request'; id: string; patch: Partial<RequestItem> }
  | { type: 'mark-read'; id: string; unread?: boolean }
  | { type: 'update-message'; id: string; patch: Partial<InboxMessage> }

function reducer(state: State, action: Action): State {
  switch (action.type) {
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
    return {
      ...base,
      title: `حملة ${firstCategory} - ${place}`,
      campaign: {
        templateId: 't-intro',
        variables: { ...DEFAULT_VARIABLES },
        included: ids.filter((id) => {
          const b = businessById.get(id)
          return b?.whatsapp && b.consent === 'granted'
        }),
      },
    }
  }
  return { ...base, title: `قائمة ${firstCategory} - ${place}`, notes: '' }
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
    requests: SEED_REQUESTS,
    inbox: SEED_INBOX,
    selection: [],
  })

  const toggleSelect = useCallback((id: string) => dispatch({ type: 'toggle-select', id }), [])
  const setSelection = useCallback((ids: string[]) => dispatch({ type: 'set-selection', ids }), [])
  const createDraft = useCallback((input: DraftInput) => {
    const request = buildDraft(input)
    dispatch({ type: 'add-request', request })
    return request.id
  }, [])
  const updateRequest = useCallback(
    (id: string, patch: Partial<RequestItem>) => dispatch({ type: 'update-request', id, patch }),
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
