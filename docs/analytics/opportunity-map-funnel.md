# Opportunity map funnel

Use this query for a weekly, consented map funnel review. It groups only the anonymous map session key to count steps; it does not return session keys, search terms, or establishment identifiers.

Run this query against the **main application database used by `api.farq.sa`** (`COMPARISONS_DB_URL`, falling back to `DATABASE_URL`), where the API writes `public.analytics_events`. Do not select a database only because it has a table with this name: the separate comparison Supabase database is not the analytics source. Use an authorized read-only connection and return aggregates only; never copy connection strings or raw session rows into reports.

```sql
WITH map_events AS (
  SELECT
    session_id,
    occurred_at,
    element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_search',
      'pricing_map_map_search_results_empty',
      'pricing_map_map_search_results_1_4',
      'pricing_map_map_search_results_5_plus',
      'pricing_map_map_search_failed',
      'pricing_map_map_browse_succeeded',
      'pricing_map_map_browse_failed',
      'pricing_map_map_browse_refresh_failed',
      'pricing_map_map_results_shortcut_seen',
      'pricing_map_map_results_jump',
      'pricing_map_map_district_select',
      'pricing_map_map_street_select',
      'pricing_map_map_profile_open',
      'pricing_map_map_result_profile_open',
      'pricing_map_map_profile_status_unconfirmed',
      'pricing_map_map_profile_whatsapp_unverified',
      'pricing_map_map_profile_quote_start'
    )
),
search_sessions AS (
  SELECT
    session_id,
    min(occurred_at) FILTER (
      WHERE element_label IN (
        'pricing_map_map_search',
        'pricing_map_map_search_results_empty',
        'pricing_map_map_search_results_1_4',
        'pricing_map_map_search_results_5_plus',
        'pricing_map_map_search_failed'
      )
    ) AS searched_at
  FROM map_events
  GROUP BY session_id
  HAVING count(*) FILTER (
    WHERE element_label IN (
      'pricing_map_map_search',
      'pricing_map_map_search_results_empty',
      'pricing_map_map_search_results_1_4',
      'pricing_map_map_search_results_5_plus',
      'pricing_map_map_search_failed'
    )
  ) > 0
),
search_actions AS (
  SELECT
    s.session_id,
    s.searched_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_results_shortcut_seen'
        AND e.occurred_at > s.searched_at
    ) AS results_shortcut_seen_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_results_jump'
        AND e.occurred_at > s.searched_at
    ) AS results_jumped_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_district_select'
        AND e.occurred_at > s.searched_at
    ) AS district_selected_after_search_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_street_select'
        AND e.occurred_at > s.searched_at
    ) AS street_selected_after_search_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_open'
        AND e.occurred_at > s.searched_at
    ) AS profile_after_search_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_status_unconfirmed'
        AND e.occurred_at > s.searched_at
    ) AS unconfirmed_status_profile_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_whatsapp_unverified'
        AND e.occurred_at > s.searched_at
    ) AS unverified_whatsapp_profile_at
  FROM search_sessions s
  LEFT JOIN map_events e USING (session_id)
  GROUP BY s.session_id, s.searched_at
),
session_context AS (
  SELECT
    s.*,
    COALESCE(result_bucket.bucket, 'unknown') AS result_bucket
  FROM search_actions s
  LEFT JOIN LATERAL (
    SELECT CASE e.element_label
      WHEN 'pricing_map_map_search_results_empty' THEN 'zero'
      WHEN 'pricing_map_map_search_results_1_4' THEN '1–4'
      WHEN 'pricing_map_map_search_results_5_plus' THEN '5+'
      WHEN 'pricing_map_map_search_failed' THEN 'failed'
      WHEN 'pricing_map_map_search' THEN 'legacy/unknown'
    END AS bucket
    FROM map_events e
    WHERE e.session_id = s.session_id
      AND e.element_label IN (
        'pricing_map_map_search',
        'pricing_map_map_search_results_empty',
        'pricing_map_map_search_results_1_4',
        'pricing_map_map_search_results_5_plus',
        'pricing_map_map_search_failed'
      )
      AND e.occurred_at <= COALESCE(s.results_shortcut_seen_at, s.searched_at)
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) result_bucket ON true
),
session_steps AS (
  SELECT
    s.session_id,
    s.searched_at,
    s.result_bucket,
    s.results_shortcut_seen_at,
    s.results_jumped_at,
    s.district_selected_after_search_at,
    s.street_selected_after_search_at,
    s.profile_after_search_at,
    s.unconfirmed_status_profile_at,
    s.unverified_whatsapp_profile_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_district_select'
        AND s.results_shortcut_seen_at IS NOT NULL
        AND e.occurred_at > s.results_shortcut_seen_at
    ) AS district_selected_after_shortcut_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_street_select'
        AND s.results_shortcut_seen_at IS NOT NULL
        AND e.occurred_at > s.results_shortcut_seen_at
    ) AS street_selected_after_shortcut_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_result_profile_open'
        AND s.results_shortcut_seen_at IS NOT NULL
        AND s.results_jumped_at > s.results_shortcut_seen_at
        AND e.occurred_at > s.results_jumped_at
    ) AS profile_after_results_jump_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_quote_start'
        AND s.profile_after_search_at IS NOT NULL
        AND e.occurred_at > s.profile_after_search_at
    ) AS quote_after_profile_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_quote_start'
        AND s.unconfirmed_status_profile_at IS NOT NULL
        AND e.occurred_at > s.unconfirmed_status_profile_at
    ) AS quote_after_unconfirmed_status_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_quote_start'
        AND s.unverified_whatsapp_profile_at IS NOT NULL
        AND e.occurred_at > s.unverified_whatsapp_profile_at
    ) AS quote_after_unverified_whatsapp_at
  FROM session_context s
  LEFT JOIN map_events e USING (session_id)
  GROUP BY s.session_id, s.searched_at, s.result_bucket, s.results_shortcut_seen_at, s.results_jumped_at,
    s.district_selected_after_search_at, s.street_selected_after_search_at, s.profile_after_search_at,
    s.unconfirmed_status_profile_at, s.unverified_whatsapp_profile_at
),
weekly AS (
  SELECT
    date_trunc('week', searched_at AT TIME ZONE 'UTC') AS week_utc,
    result_bucket,
    count(*) AS search_sessions,
    count(*) FILTER (WHERE district_selected_after_search_at IS NOT NULL OR street_selected_after_search_at IS NOT NULL) AS area_select_sessions,
    count(*) FILTER (WHERE district_selected_after_search_at IS NOT NULL) AS district_select_sessions,
    count(*) FILTER (WHERE street_selected_after_search_at IS NOT NULL) AS street_select_sessions,
    count(*) FILTER (WHERE profile_after_search_at IS NOT NULL) AS profile_after_search_sessions,
    count(*) FILTER (WHERE unconfirmed_status_profile_at IS NOT NULL) AS unconfirmed_status_profile_sessions,
    count(*) FILTER (WHERE unverified_whatsapp_profile_at IS NOT NULL) AS unverified_whatsapp_profile_sessions,
    count(*) FILTER (WHERE results_shortcut_seen_at IS NOT NULL) AS results_shortcut_seen_sessions,
    count(*) FILTER (WHERE results_jumped_at > results_shortcut_seen_at) AS results_jump_sessions,
    count(*) FILTER (WHERE district_selected_after_shortcut_at IS NOT NULL) AS district_select_after_shortcut_sessions,
    count(*) FILTER (WHERE street_selected_after_shortcut_at IS NOT NULL) AS street_select_after_shortcut_sessions,
    count(*) FILTER (WHERE profile_after_results_jump_at IS NOT NULL) AS profile_after_results_jump_sessions,
    count(*) FILTER (WHERE quote_after_profile_at IS NOT NULL) AS quote_after_profile_sessions,
    count(*) FILTER (WHERE quote_after_unconfirmed_status_at IS NOT NULL) AS quote_after_unconfirmed_status_sessions,
    count(*) FILTER (WHERE quote_after_unverified_whatsapp_at IS NOT NULL) AS quote_after_unverified_whatsapp_sessions
  FROM session_steps
  GROUP BY 1, 2
)
SELECT
  week_utc,
  result_bucket,
  search_sessions,
  area_select_sessions,
  round(100.0 * area_select_sessions / nullif(search_sessions, 0), 1) AS search_to_area_select_pct,
  district_select_sessions,
  street_select_sessions,
  profile_after_search_sessions,
  unconfirmed_status_profile_sessions,
  unverified_whatsapp_profile_sessions,
  round(100.0 * profile_after_search_sessions / nullif(search_sessions, 0), 1)
    AS search_to_profile_pct,
  results_shortcut_seen_sessions,
  district_select_after_shortcut_sessions,
  round(100.0 * district_select_after_shortcut_sessions
    / nullif(results_shortcut_seen_sessions, 0), 1) AS shortcut_to_district_select_pct,
  street_select_after_shortcut_sessions,
  round(100.0 * street_select_after_shortcut_sessions
    / nullif(results_shortcut_seen_sessions, 0), 1) AS shortcut_to_street_select_pct,
  results_jump_sessions,
  round(100.0 * results_jump_sessions / nullif(results_shortcut_seen_sessions, 0), 1)
    AS shortcut_seen_to_jump_pct,
  profile_after_results_jump_sessions,
  round(100.0 * profile_after_results_jump_sessions / nullif(results_jump_sessions, 0), 1)
    AS results_jump_to_profile_pct,
  quote_after_profile_sessions,
  quote_after_unconfirmed_status_sessions,
  round(100.0 * quote_after_unconfirmed_status_sessions / nullif(unconfirmed_status_profile_sessions, 0), 1)
    AS status_notice_session_to_quote_start_pct,
  quote_after_unverified_whatsapp_sessions,
  round(100.0 * quote_after_unverified_whatsapp_sessions / nullif(unverified_whatsapp_profile_sessions, 0), 1)
    AS whatsapp_notice_session_to_quote_start_pct,
  round(100.0 * quote_after_profile_sessions / nullif(profile_after_search_sessions, 0), 1)
    AS profile_to_quote_start_pct
FROM weekly
ORDER BY week_utc DESC, result_bucket;
```

To see whether searches return zero, few, or several matches, run this second aggregate against the same 56-day window:

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_empty') AS searches_with_zero_results,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_1_4') AS searches_with_1_to_4_results,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_5_plus') AS searches_with_5_plus_results,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_failed') AS failed_searches,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_browse_succeeded') AS browse_loads_succeeded,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_browse_failed') AS browse_loads_failed,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_browse_refresh_failed') AS browse_refreshes_failed_with_previous_results,
  round(100.0 * count(*) FILTER (WHERE element_label = 'pricing_map_map_browse_failed')
    / nullif(count(*) FILTER (WHERE element_label IN ('pricing_map_map_browse_succeeded', 'pricing_map_map_browse_failed')), 0), 1)
    AS browse_load_failure_pct,
  count(DISTINCT session_id) FILTER (WHERE element_label = 'pricing_map_map_browse_failed') AS sessions_with_browse_failures,
  count(DISTINCT session_id) FILTER (WHERE element_label = 'pricing_map_map_browse_refresh_failed') AS sessions_with_browse_refresh_failures,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search') AS legacy_searches_without_result_bucket,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_results_status_notice') AS status_notice_impressions,
  count(DISTINCT session_id) FILTER (WHERE element_label = 'pricing_map_map_results_status_notice') AS sessions_shown_status_notice,
  count(*) FILTER (WHERE element_label = 'pricing_map_market_summary_retry') AS market_summary_retry_clicks,
  count(DISTINCT session_id) FILTER (WHERE element_label = 'pricing_map_market_summary_retry') AS sessions_with_market_summary_retry
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND element_label IN (
    'pricing_map_map_search_results_empty',
    'pricing_map_map_search_results_1_4',
    'pricing_map_map_search_results_5_plus',
    'pricing_map_map_search_failed',
    'pricing_map_map_search',
    'pricing_map_map_results_status_notice',
    'pricing_map_map_browse_succeeded',
    'pricing_map_map_browse_failed',
    'pricing_map_map_browse_refresh_failed',
    'pricing_map_market_summary_retry'
  )
GROUP BY 1
ORDER BY 1 DESC;
```

## Reading the numbers

- `map_profile_quote_start` means the user opened the quote-request flow from a supplier profile. It does not mean a request was submitted or a supplier replied.
- `map_results_shortcut_seen` means the shortcut was rendered after a search in the regular mobile layout. `map_results_jump` means the user tapped it to reach the results list. `map_result_profile_open` identifies an establishment opened specifically from that list, while `map_profile_open` includes opens from any map surface. These events are logged only with map analytics consent.
- `district_select_sessions` and `street_select_sessions` count search sessions with an area selection later in the same session. `results_shortcut_seen_sessions` is only a proxy for a regular mobile-layout search session; the district/street-after-shortcut counts require the map-area selection to follow that mobile-only shortcut impression. This does not identify every mobile user or prove the map-first change caused an interaction.
- `map_profile_status_unconfirmed` counts a consenting session that opened at least one profile whose source status is missing or unrecognized. It contains no establishment identifier. Do not attribute a later quote start to that same establishment; the event stream intentionally does not identify profiles.
- `map_profile_whatsapp_unverified` counts a consenting session that opened a profile whose WhatsApp flag is not explicitly marked verified. `quote_after_unverified_whatsapp_sessions` counts a later quote start in that same session only; it does not identify the establishment or prove that the notice caused the action.
- `market_summary_retry_clicks` and `sessions_with_market_summary_retry` count the user-triggered manual retry only, after analytics consent. Automatic retry attempts are intentionally not logged. These counts indicate that a visible summary failure led to a retry click; they do not count all failures, identify their technical cause, or represent users who declined analytics consent.
- `quote_after_unconfirmed_status_sessions` means a quote flow began later in a session that had shown the notice. This is a session-level sequence only: it cannot prove the quote came from the same profile or that the notice caused the action.
- New search clicks are labeled by result bucket (`0`, `1–4`, `5+`) or failure. Older `map_search` rows remain in the funnel but have no outcome bucket.
- `map_browse_succeeded`, `map_browse_failed`, and `map_browse_refresh_failed` count completed browse-load attempts from consenting sessions. Refresh failures are also included in `map_browse_failed`; calculate the failure rate as failed browse loads divided by succeeded plus failed browse loads. Superseded requests without a terminal response are not counted. These events contain no query, city, filter, or establishment identifiers.
- `map_results_status_notice` is emitted when the visible results include rows whose operating status is missing or unrecognized. It records only a consented session-level impression, never a business identifier; compare it with profile opens and quote starts as a directional funnel, not as causal evidence.
- Each session's funnel row is grouped by the most recent search-result bucket recorded before the shortcut was shown (or, if it was not shown, before the first search timestamp). This helps compare shortcut use when the map returned no results, a few results, or many results; it is a session-level view, not a per-search conversion rate.
- Shortcut use is divided by sessions in which the shortcut was actually shown, avoiding a desktop-inclusive denominator. The list-discovery step counts only `map_result_profile_open` events after a shortcut jump, not pin opens elsewhere on the map; quote-start counts must follow a profile open after search. Each session is assigned to the UTC week of its first search.
- These events are recorded only after analytics consent. The funnel describes consenting sessions, not all map users.
- Use at least two complete weeks for an initial comparison. If a week has fewer than 30 search sessions, treat the rate as directional and combine it with observed task completion; do not claim an experiment caused a change.
- Compare changes in search-to-profile and profile-to-quote-start separately. If the first step is weak, inspect map discoverability and result relevance before changing the quote flow.

## Expanded map mode engagement

`map_focus_open` records entry to the full-screen map and `map_focus_close` records use of its “رجوع للتخطيط” control. Both are recorded only when the user has accepted map analytics consent. They carry the existing anonymous session key, but no search phrase, city, location, or establishment identifier. The query below groups each session by its first focus-mode entry in the 56-day window; repeat visits in one session are intentionally not counted separately. Closing the tab or navigating away does not emit `map_focus_close`. It is not device-specific, so do not label these sessions as mobile.

Run it only against the same authorized, read-only main application database described above:

```sql
WITH map_events AS (
  SELECT session_id, occurred_at, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_focus_open',
      'pricing_map_map_focus_close',
      'pricing_map_map_sheet_open',
      'pricing_map_map_sheet_peek',
      'pricing_map_map_sheet_half',
      'pricing_map_map_sheet_full',
      'pricing_map_map_result_profile_open'
    )
), focus_entries AS (
  SELECT session_id, min(occurred_at) AS opened_at
  FROM map_events
  WHERE element_label = 'pricing_map_map_focus_open'
  GROUP BY session_id
), focus_actions AS (
  SELECT
    f.session_id,
    f.opened_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_focus_close' AND e.occurred_at > f.opened_at
    ) AS closed_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_sheet_open' AND e.occurred_at > f.opened_at
    ) AS sheet_opened_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_sheet_peek' AND e.occurred_at > f.opened_at
    ) AS peek_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_sheet_half' AND e.occurred_at > f.opened_at
    ) AS half_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_sheet_full' AND e.occurred_at > f.opened_at
    ) AS full_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_result_profile_open' AND e.occurred_at > f.opened_at
    ) AS result_profile_opened_at
  FROM focus_entries f
  LEFT JOIN map_events e USING (session_id)
  GROUP BY f.session_id, f.opened_at
), weekly AS (
  SELECT
    date_trunc('week', opened_at AT TIME ZONE 'UTC') AS week_utc,
    count(*) AS focus_entry_sessions,
    count(*) FILTER (WHERE closed_at IS NOT NULL) AS focus_closed_sessions,
    count(*) FILTER (WHERE sheet_opened_at IS NOT NULL) AS result_panel_sessions,
    count(*) FILTER (WHERE peek_at IS NOT NULL) AS peek_sessions,
    count(*) FILTER (WHERE half_at IS NOT NULL) AS half_sessions,
    count(*) FILTER (WHERE full_at IS NOT NULL) AS full_sessions,
    count(*) FILTER (WHERE result_profile_opened_at IS NOT NULL) AS result_profile_sessions
  FROM focus_actions
  GROUP BY 1
)
SELECT
  week_utc,
  focus_entry_sessions,
  focus_closed_sessions,
  result_panel_sessions,
  round(100.0 * result_panel_sessions / nullif(focus_entry_sessions, 0), 1) AS focus_to_results_panel_pct,
  peek_sessions,
  half_sessions,
  full_sessions,
  result_profile_sessions,
  round(100.0 * result_profile_sessions / nullif(result_panel_sessions, 0), 1) AS panel_to_result_profile_pct
FROM weekly
ORDER BY week_utc DESC;
```

These are session-level navigation signals, not task completion or evidence that focus mode caused a profile open. Only sessions recorded after deployment contain the new entry/exit events. Wait for two complete weeks and at least 30 consenting focus-entry sessions before treating rates as directional; pair them with observed task completion and time-to-profile. Never infer mobile use from this query because no device class is recorded.
