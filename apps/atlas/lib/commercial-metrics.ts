'use client'

import { track } from '@vercel/analytics'
import type { GoalId, RequestType } from './types'
import type { MapLevel } from './map-summary'

type CountBucket = '0' | '1' | '2-5' | '6-15' | '16-30' | '31+'
type QueryBucket = 'empty' | '1-12' | '13-40' | '41+'

function countBucket(value: number): CountBucket {
  if (value <= 0) return '0'
  if (value === 1) return '1'
  if (value <= 5) return '2-5'
  if (value <= 15) return '6-15'
  if (value <= 30) return '16-30'
  return '31+'
}

function queryBucket(value: string): QueryBucket {
  const length = value.trim().length
  if (!length) return 'empty'
  if (length <= 12) return '1-12'
  if (length <= 40) return '13-40'
  return '41+'
}

/**
 * Commercial-funnel telemetry for Atlas. It intentionally never sends search
 * text, business identifiers, names, locations, or contact details.
 */
export function trackMarketSearch({ city, goal, query }: { city: string; goal: GoalId; query: string }) {
  track('atlas_market_search', { city, goal, query_size: queryBucket(query) })
}

export function trackMapDetailLevel({ city, level }: { city: string; level: MapLevel }) {
  track('atlas_map_detail_opened', { city, level })
}

/** Measures commercial investigation steps without sending map coordinates or names. */
export function trackMarketInsightOpened({ city, kind, count }: { city: string; kind: 'cluster' | 'street'; count: number }) {
  track('atlas_market_insight_opened', { city, kind, opportunity_size: countBucket(count) })
}

/** Records taxonomy use as an aggregate size bucket, never the chosen category label. */
export function trackLiveActivityScopeApplied({ city, shops }: { city: string; shops: number }) {
  track('atlas_live_activity_scope_applied', { city, scope_size: countBucket(shops) })
}

export function trackSelectionChange({ city, selected, selectedCount, source }: { city: string; selected: boolean; selectedCount: number; source: 'map_pin' | 'directory' | 'group' }) {
  track('atlas_selection_changed', { city, action: selected ? 'selected' : 'removed', source, selection_size: countBucket(selectedCount) })
}

export function trackDraftPrepared({ city, type, source, count }: { city: string; type: RequestType; source: 'assistant' | 'selection'; count: number }) {
  track('atlas_draft_prepared', { city, type, source, selection_size: countBucket(count) })
}

/** A reviewed draft is ready for a user-controlled commercial hand-off. */
export function trackDraftReviewed({ city, type, count }: { city: string; type: RequestType; count: number }) {
  track('atlas_draft_reviewed', { city, type, selection_size: countBucket(count) })
}

/**
 * Captures the commercial decision point without reporting supplier identity,
 * price, quote contents, or the request identifier.
 */
export function trackQuoteAccepted({ city, quoteCount }: { city: string; quoteCount: number }) {
  track('atlas_rfq_quote_accepted', { city, quote_count: countBucket(quoteCount) })
}

/** A user copied a reviewed hand-off. This does not claim that anything was sent. */
export function trackManualHandoffCopied({ city, type, count }: { city: string; type: 'rfq' | 'campaign'; count: number }) {
  track('atlas_manual_handoff_copied', { city, type, selection_size: countBucket(count) })
}

type OnboardingStep = 'shown' | 'goal_picked' | 'district_picked' | 'completed' | 'skipped' | 'restarted'

/**
 * The map's first-visit tour, one event name for every step: the step, the goal's lens id when one is picked, the
 * step a visitor left from, and how the tour ended (opening a figure's source or «فهمت»). No names, places or text.
 */
export function trackOnboardingStep(step: OnboardingStep, detail: { lens?: string; at?: string; via?: 'explain' | 'button' } = {}) {
  track('atlas_onboarding_step', { step, ...detail })
}
