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

export function trackSelectionChange({ city, selected, selectedCount }: { city: string; selected: boolean; selectedCount: number }) {
  track('atlas_selection_changed', { city, action: selected ? 'selected' : 'removed', selection_size: countBucket(selectedCount) })
}

export function trackDraftPrepared({ city, type, source, count }: { city: string; type: RequestType; source: 'assistant' | 'selection'; count: number }) {
  track('atlas_draft_prepared', { city, type, source, selection_size: countBucket(count) })
}
