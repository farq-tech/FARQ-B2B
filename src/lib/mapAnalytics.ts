const CONSENT_KEY = 'farq:pricing-map-analytics-consent-v2'
const SESSION_KEY = 'farq:pricing-map-analytics-session-v1'
const MAP_EVENTS = [
  'map_search',
  'map_search_results_empty',
  'map_search_results_1_4',
  'map_search_results_5_plus',
  'map_search_failed',
  'map_supplier_search_failure_server',
  'map_supplier_search_failure_client',
  'map_supplier_search_failure_network',
  'map_supplier_search_failure_other',
  'map_buyer_search_failure_server',
  'map_buyer_search_failure_client',
  'map_buyer_search_failure_network',
  'map_buyer_search_failure_other',
  'map_supplier_fresh_search_failure_server',
  'map_supplier_fresh_search_failure_client',
  'map_supplier_fresh_search_failure_network',
  'map_supplier_fresh_search_failure_other',
  'map_buyer_fresh_search_failure_server',
  'map_buyer_fresh_search_failure_client',
  'map_buyer_fresh_search_failure_network',
  'map_buyer_fresh_search_failure_other',
  'map_supplier_filter_refresh_failure_server',
  'map_supplier_filter_refresh_failure_client',
  'map_supplier_filter_refresh_failure_network',
  'map_supplier_filter_refresh_failure_other',
  'map_buyer_filter_refresh_failure_server',
  'map_buyer_filter_refresh_failure_client',
  'map_buyer_filter_refresh_failure_network',
  'map_buyer_filter_refresh_failure_other',
  'map_browse_succeeded',
  'map_browse_failed',
  'map_browse_refresh_failed',
  'map_street_density_started',
  'map_street_density_succeeded',
  'map_street_density_failed',
  'map_street_density_retry',
  'map_street_density_auto_retry',
  'map_street_density_auto_retry_recovered',
  'map_street_density_auto_retry_failed',
  'map_browse_more_succeeded',
  'map_browse_more_failed',
  'map_results_status_notice',
  'map_data_quality_notice_seen',
  'map_data_quality_notice_open',
  'map_results_shortcut_seen',
  'map_results_jump',
  'map_district_select',
  'map_district_clear',
  'map_filter_layer_density_on',
  'map_filter_layer_density_off',
  'map_filter_layer_city_on',
  'map_filter_layer_city_off',
  'map_filter_layer_districts_on',
  'map_filter_layer_districts_off',
  'map_filter_layer_places_on',
  'map_filter_layer_places_off',
  'map_filter_layer_streets_on',
  'map_filter_layer_streets_off',
  'map_district_insight_seen',
  'map_district_activities_expand',
  'map_district_activity_select',
  'map_city_summary_activity_select',
  'map_district_subactivity_select',
  'map_street_select',
  'map_activity_select',
  'map_activity_filter_open',
  'map_activity_counter_panel_open',
  'map_activity_counter_detail_select',
  'map_counter_scope_reset',
  'map_counter_district_picker_open',
  'map_counter_whatsapp_filter_on',
  'map_counter_whatsapp_filter_off',
  'map_counter_wholesale_filter_on',
  'map_counter_wholesale_filter_off',
  'map_activity_main_select',
  'map_activity_sub_select',
  'map_activity_spec_select',
  'map_activity_clear',
  'map_guide_focus_select',
  'map_guide_focus_clear',
  'map_guide_main_select',
  'map_guide_sub_select',
  'map_guide_spec_select',
  'map_guide_search_used',
  'map_multi_intent_groups_all_visible',
  'map_multi_intent_groups_some_visible',
  'map_multi_intent_groups_none_visible',
  'map_multi_intent_search_failed',
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
  'map_supplier_candidate_batch_add',
  'map_review_list_saved',
  'map_review_list_save_failed',
  'map_review_to_rfq',
  'map_campaign_draft_saved',
  'map_campaign_draft_save_failed',
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
  'map_supplier_search_auto_retry',
  'map_supplier_search_auto_retry_recovered',
  'map_supplier_search_auto_retry_failed',
  'map_supplier_search_latency_under_1s',
  'map_supplier_search_latency_1_to_3s',
  'map_supplier_search_latency_over_3s',
  'map_search_results_contact_none',
  'map_search_results_contact_some',
  'map_search_results_contact_all',
  'map_buyer_search_results_empty',
  'map_buyer_search_results_1_4',
  'map_buyer_search_results_5_plus',
  'map_buyer_search_failed',
  'map_buyer_search_auto_retry',
  'map_buyer_search_auto_retry_recovered',
  'map_buyer_search_auto_retry_failed',
  'map_buyer_search_latency_under_1s',
  'map_buyer_search_latency_1_to_3s',
  'map_buyer_search_latency_over_3s',
  'map_buyer_products_search_started',
  'map_buyer_products_search_results_empty',
  'map_buyer_products_search_results_1_4',
  'map_buyer_products_search_results_5_plus',
  'map_buyer_products_search_failed',
  'map_buyer_products_search_under_1s',
  'map_buyer_products_search_1_to_3s',
  'map_buyer_products_search_over_3s',
  'map_buyer_products_more_started',
  'map_buyer_products_more_succeeded',
  'map_buyer_products_more_failed',
  'map_supplier_result_profile_open',
  'map_buyer_result_profile_open',
  'market_summary_retry',
  'map_filter_open_city',
  'map_filter_select_city',
  'map_filter_open_district',
  'map_filter_select_district',
  'map_filter_open_street',
  'map_filter_select_street',
  'map_filter_open_role',
  'map_filter_select_role',
  'map_filter_open_specialty',
  'map_filter_select_specialty',
  'map_filter_search_used',
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
  'map_results_panel_hide',
  'map_results_panel_show',
  'map_ready_under_2s',
  'map_ready_2_5s',
  'map_ready_over_5s',
] as const

type MapEventName = typeof MAP_EVENTS[number]
const ALLOWED_EVENTS: ReadonlySet<string> = new Set(MAP_EVENTS)

type MapEvent =
  | { event_type: 'pageview'; session_id: string; path: '/opportunity-map' }
  | { event_type: 'click'; session_id: string; path: '/opportunity-map'; element_label: string }
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

/** Record a category-card choice with only its stable taxonomy ID, never its display name. */
export function recordMapActivityCounterSelection(mainId: string) {
  if (mapAnalyticsConsent() !== 'accepted' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(mainId)) return
  startFlush()
  queue.push({
    event_type: 'click',
    session_id: sessionId(),
    path: '/opportunity-map',
    element_label: `pricing_map_map_activity_counter_select_${mainId.toLowerCase()}`,
  })
  if (queue.length >= 20) flush()
}

/** Record a consented map-page entry without collecting referrer or page content. */
export function recordMapPageView() {
  if (mapAnalyticsConsent() !== 'accepted') return
  startFlush()
  queue.push({ event_type: 'pageview', session_id: sessionId(), path: '/opportunity-map' })
  if (queue.length >= 20) flush()
}

export function mapSearchResultEvent(total: number): MapEventName {
  if (total <= 0) return 'map_search_results_empty'
  if (total < 5) return 'map_search_results_1_4'
  return 'map_search_results_5_plus'
}

type SearchObjective = 'purchase' | 'marketing'
type SearchRetryOutcome = 'retrying' | 'recovered' | 'failed'

/** Role-only retry telemetry; never includes search text, city, or establishment data. */
export function mapSearchRetryEvent(objective: SearchObjective, outcome: SearchRetryOutcome): MapEventName {
  if (objective === 'purchase') {
    if (outcome === 'retrying') return 'map_supplier_search_auto_retry'
    if (outcome === 'recovered') return 'map_supplier_search_auto_retry_recovered'
    return 'map_supplier_search_auto_retry_failed'
  }
  if (outcome === 'retrying') return 'map_buyer_search_auto_retry'
  if (outcome === 'recovered') return 'map_buyer_search_auto_retry_recovered'
  return 'map_buyer_search_auto_retry_failed'
}

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

/** Coarse contact availability for a received result batch; no contact values or counts are sent. */
export function mapSearchContactAvailabilityEvent(totalRows: number, rowsWithContact: number): MapEventName | null {
  if (totalRows <= 0) return null
  if (rowsWithContact <= 0) return 'map_search_results_contact_none'
  if (rowsWithContact >= totalRows) return 'map_search_results_contact_all'
  return 'map_search_results_contact_some'
}

export function mapSearchFailedEvent(objective: SearchObjective): MapEventName {
  return objective === 'purchase' ? 'map_supplier_search_failed' : 'map_buyer_search_failed'
}

/** Request scope and failure class only; never records query text, location, response body, or establishment data. */
export function mapSearchFailureEvent(
  objective: SearchObjective,
  status?: number,
  networkFailure = false,
  scope: 'fresh_search' | 'filter_refresh' = 'fresh_search',
): MapEventName {
  const cause = networkFailure ? 'network' : status != null && status >= 500 ? 'server' : status != null && status >= 400 ? 'client' : 'other'
  return `map_${objective === 'purchase' ? 'supplier' : 'buyer'}_${scope}_failure_${cause}` as MapEventName
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
