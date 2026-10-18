const CONSENT_KEY = 'farq:pricing-map-analytics-consent-v1'
const SESSION_KEY = 'farq:pricing-map-analytics-session-v1'
const MAP_EVENTS = [
  'map_search',
  'map_search_results_empty',
  'map_search_results_1_4',
  'map_search_results_5_plus',
  'map_search_failed',
  'map_browse_succeeded',
  'map_browse_failed',
  'map_browse_refresh_failed',
  'map_street_density_started',
  'map_street_density_succeeded',
  'map_street_density_failed',
  'map_street_density_retry',
  'map_browse_more_succeeded',
  'map_browse_more_failed',
  'map_results_status_notice',
  'map_data_quality_notice_seen',
  'map_data_quality_notice_open',
  'map_results_shortcut_seen',
  'map_results_jump',
  'map_district_select',
  'map_district_clear',
  'map_street_select',
  'map_activity_select',
  'map_activity_filter_open',
  'map_activity_main_select',
  'map_activity_sub_select',
  'map_activity_clear',
  'map_profile_open',
  'map_result_profile_open',
  'map_profile_status_unconfirmed',
  'map_profile_whatsapp_unverified',
  'map_profile_quote_start',
  'map_legend_hide',
  'map_legend_show',
  'map_legend_hide_control_seen',
  'map_legend_show_control_seen',
  'map_supplier_add',
  'map_supplier_remove',
  'map_seller_add_products',
  'fit_filter_all',
  'fit_filter_likely',
  'fit_filter_maybe',
  'fit_filter_low',
  'fit_filter_unknown',
  'fit_supplier_selection',
  'site_unlocated_show',
  'site_unlocated_hide',
  'site_unlocated_batch_found',
  'site_unlocated_batch_empty',
  'site_unlocated_batch_failed',
  'start_mode_buyer',
  'start_mode_seller',
  'map_lens_market',
  'map_lens_sellers',
  'map_lens_buyers',
  'map_supplier_prompt_seen',
  'map_buyer_prompt_seen',
  'map_supplier_search_started',
  'map_buyer_search_started',
  'map_supplier_search_results_empty',
  'map_supplier_search_results_1_4',
  'map_supplier_search_results_5_plus',
  'map_supplier_search_failed',
  'map_supplier_search_latency_under_1s',
  'map_supplier_search_latency_1_to_3s',
  'map_supplier_search_latency_over_3s',
  'map_buyer_search_results_empty',
  'map_buyer_search_results_1_4',
  'map_buyer_search_results_5_plus',
  'map_buyer_search_failed',
  'map_buyer_search_latency_under_1s',
  'map_buyer_search_latency_1_to_3s',
  'map_buyer_search_latency_over_3s',
  'map_supplier_result_profile_open',
  'map_buyer_result_profile_open',
  'market_summary_retry',
  'map_filter_open_district',
  'map_filter_select_district',
  'map_filter_open_street',
  'map_filter_select_street',
  'map_filter_open_role',
  'map_filter_select_role',
  'map_filter_open_specialty',
  'map_filter_select_specialty',
  'map_filter_open_site_radius',
  'map_filter_select_site_radius',
  'map_filter_wholesale_on',
  'map_filter_wholesale_off',
  'map_filter_wholesale_results_empty',
  'map_filter_wholesale_results_1_4',
  'map_filter_wholesale_results_5_plus',
  'map_filter_wholesale_results_failed',
  'map_sheet_open',
  'map_sheet_close',
  'map_sheet_peek',
  'map_sheet_half',
  'map_sheet_full',
  'map_focus_open',
  'map_focus_close',
  'map_ready_under_2s',
  'map_ready_2_5s',
  'map_ready_over_5s',
] as const

type MapEventName = typeof MAP_EVENTS[number]
const ALLOWED_EVENTS: ReadonlySet<string> = new Set(MAP_EVENTS)

type MapEvent = { event_type: 'click'; session_id: string; path: '/opportunity-map'; element_label: string }
let queue: MapEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let flushInFlight = false
let rateLimitRetries = 0
let rateLimitRetryAt = 0

export function mapAnalyticsConsent(): 'accepted' | 'rejected' | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY)
    return value === 'accepted' || value === 'rejected' ? value : null
  } catch { return null }
}

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = `pricing-map-${crypto.randomUUID()}`
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch { return `pricing-map-${crypto.randomUUID()}` }
}

function retryAfterMs(response: Response) {
  const value = response.headers.get('Retry-After')
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}

function flush() {
  if (!queue.length || mapAnalyticsConsent() !== 'accepted') { queue = []; return }
  if (flushInFlight) return
  if (Date.now() < rateLimitRetryAt) return
  // Keep the batch queued until the API confirms it accepted the request. A
  // transient network/server failure should not erase opt-in usage signals.
  const events = queue.slice(0, 25)
  flushInFlight = true
  void fetch('/_api/events/track', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
    keepalive: true,
  }).then((response) => {
    // Retry server errors and network failures on the next flush. A client
    // error cannot be repaired by retrying the same payload, so discard it.
    const sameBatchIsQueued = queue.slice(0, events.length).every((event, index) => event === events[index])
    if (!response.ok) {
      if (response.status === 429) {
        // A rate limit is temporary: keep the opt-in batch and back off instead
        // of retrying every 10 seconds or discarding it as a permanent 4xx.
        rateLimitRetries += 1
        const backoffMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(rateLimitRetries - 1, 5))
        rateLimitRetryAt = Date.now() + Math.max(backoffMs, retryAfterMs(response))
        return
      }
      if (response.status >= 400 && response.status < 500 && sameBatchIsQueued) queue.splice(0, events.length)
      return
    }
    if (sameBatchIsQueued) {
      queue.splice(0, events.length)
      rateLimitRetries = 0
      rateLimitRetryAt = 0
    }
  }).catch(() => { /* retain the batch for the next flush; never interrupt map use */ })
    .finally(() => { flushInFlight = false })
}

function startFlush() {
  if (flushTimer) return
  flushTimer = setInterval(flush, 10_000)
  window.addEventListener('pagehide', flush)
}

export function recordMapInteraction(name: MapEventName) {
  if (mapAnalyticsConsent() !== 'accepted' || !ALLOWED_EVENTS.has(name)) return
  startFlush()
  queue.push({ event_type: 'click', session_id: sessionId(), path: '/opportunity-map', element_label: `pricing_map_${name}` })
  if (queue.length >= 20) flush()
}

export function mapSearchResultEvent(total: number): MapEventName {
  if (total <= 0) return 'map_search_results_empty'
  if (total < 5) return 'map_search_results_1_4'
  return 'map_search_results_5_plus'
}

type SearchObjective = 'purchase' | 'marketing'

export function mapSearchStartedEvent(objective: SearchObjective): MapEventName {
  return objective === 'purchase' ? 'map_supplier_search_started' : 'map_buyer_search_started'
}

/** Coarse successful-search latency buckets; the exact duration remains in the browser. */
export function mapSearchLatencyEvent(elapsedMs: number, objective: SearchObjective): MapEventName {
  if (objective === 'purchase') {
    if (elapsedMs < 1_000) return 'map_supplier_search_latency_under_1s'
    if (elapsedMs < 3_000) return 'map_supplier_search_latency_1_to_3s'
    return 'map_supplier_search_latency_over_3s'
  }
  if (elapsedMs < 1_000) return 'map_buyer_search_latency_under_1s'
  if (elapsedMs < 3_000) return 'map_buyer_search_latency_1_to_3s'
  return 'map_buyer_search_latency_over_3s'
}

export function mapSearchOutcomeEvent(total: number, objective: SearchObjective): MapEventName {
  if (objective === 'purchase') {
    if (total <= 0) return 'map_supplier_search_results_empty'
    if (total < 5) return 'map_supplier_search_results_1_4'
    return 'map_supplier_search_results_5_plus'
  }
  if (total <= 0) return 'map_buyer_search_results_empty'
  if (total < 5) return 'map_buyer_search_results_1_4'
  return 'map_buyer_search_results_5_plus'
}

export function mapSearchFailedEvent(objective: SearchObjective): MapEventName {
  return objective === 'purchase' ? 'map_supplier_search_failed' : 'map_buyer_search_failed'
}

export function mapResultProfileOpenEvent(objective: SearchObjective): MapEventName {
  return objective === 'purchase' ? 'map_supplier_result_profile_open' : 'map_buyer_result_profile_open'
}

export function mapWholesaleFilterOutcomeEvent(total: number): MapEventName {
  if (total <= 0) return 'map_filter_wholesale_results_empty'
  if (total < 5) return 'map_filter_wholesale_results_1_4'
  return 'map_filter_wholesale_results_5_plus'
}

/** Coarse readiness buckets only; the exact duration stays in the browser. */
export function mapReadinessEvent(elapsedMs: number): MapEventName {
  if (elapsedMs < 2_000) return 'map_ready_under_2s'
  if (elapsedMs < 5_000) return 'map_ready_2_5s'
  return 'map_ready_over_5s'
}

export function setMapAnalyticsConsent(value: 'accepted' | 'rejected') {
  try { localStorage.setItem(CONSENT_KEY, value) } catch { /* consent UI remains usable for this page */ }
  queue = []
  rateLimitRetries = 0
  rateLimitRetryAt = 0
  if (value === 'rejected' && flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
    window.removeEventListener('pagehide', flush)
  }
}
