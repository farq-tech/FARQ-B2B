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

## Street activity discovery funnel

This query measures the consenting-session path from opening the activity selector through selecting an activity, selecting a dense street, opening a result profile from the list, and starting a quote request. It groups by the week the selector was opened (or the first activity event for older clients). It does not store or return category names, city, search text, or establishment identifiers. The legacy `map_activity_select` event is included for comparison with clients that predate the more specific event labels; it cannot distinguish a main activity, subactivity, or clearing the filter.

Run it against the same authorized, read-only main application database:

```sql
WITH map_events AS (
  SELECT session_id, occurred_at, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_activity_filter_open',
      'pricing_map_map_activity_main_select',
      'pricing_map_map_activity_sub_select',
      'pricing_map_map_activity_clear',
      'pricing_map_map_activity_select',
      'pricing_map_map_street_select',
      'pricing_map_map_result_profile_open',
      'pricing_map_map_profile_quote_start'
    )
), selector_sessions AS (
  SELECT
    session_id,
    min(occurred_at) FILTER (WHERE element_label = 'pricing_map_map_activity_filter_open') AS opened_at
  FROM map_events
  GROUP BY session_id
  HAVING count(*) FILTER (WHERE element_label IN (
    'pricing_map_map_activity_filter_open',
    'pricing_map_map_activity_main_select',
    'pricing_map_map_activity_sub_select',
    'pricing_map_map_activity_clear',
    'pricing_map_map_activity_select'
  )) > 0
), selections AS (
  SELECT
    s.session_id,
    s.opened_at,
    min(e.occurred_at) FILTER (WHERE e.element_label IN (
      'pricing_map_map_activity_main_select',
      'pricing_map_map_activity_sub_select',
      'pricing_map_map_activity_select'
    ) AND (s.opened_at IS NULL OR e.occurred_at >= s.opened_at)) AS selected_at,
    min(e.occurred_at) FILTER (WHERE e.element_label = 'pricing_map_map_activity_main_select'
      AND (s.opened_at IS NULL OR e.occurred_at >= s.opened_at)) AS main_selected_at,
    min(e.occurred_at) FILTER (WHERE e.element_label = 'pricing_map_map_activity_sub_select'
      AND (s.opened_at IS NULL OR e.occurred_at >= s.opened_at)) AS sub_selected_at,
    min(e.occurred_at) FILTER (WHERE e.element_label = 'pricing_map_map_activity_select'
      AND (s.opened_at IS NULL OR e.occurred_at >= s.opened_at)) AS legacy_selected_at,
    min(e.occurred_at) FILTER (WHERE e.element_label = 'pricing_map_map_activity_clear'
      AND (s.opened_at IS NULL OR e.occurred_at >= s.opened_at)) AS cleared_at
  FROM selector_sessions s
  LEFT JOIN map_events e USING (session_id)
  GROUP BY s.session_id, s.opened_at
), activity_actions AS (
  SELECT
    s.*,
    min(e.occurred_at) FILTER (WHERE e.element_label = 'pricing_map_map_street_select'
      AND s.selected_at IS NOT NULL AND e.occurred_at > s.selected_at) AS street_after_activity_at
  FROM selections s
  LEFT JOIN map_events e USING (session_id)
  GROUP BY s.session_id, s.opened_at, s.selected_at, s.main_selected_at,
    s.sub_selected_at, s.legacy_selected_at, s.cleared_at
), profile_actions AS (
  SELECT
    a.*,
    min(e.occurred_at) FILTER (WHERE e.element_label = 'pricing_map_map_result_profile_open'
      AND a.street_after_activity_at IS NOT NULL AND e.occurred_at > a.street_after_activity_at) AS profile_after_street_at
  FROM activity_actions a
  LEFT JOIN map_events e USING (session_id)
  GROUP BY a.session_id, a.opened_at, a.selected_at, a.main_selected_at,
    a.sub_selected_at, a.legacy_selected_at, a.cleared_at, a.street_after_activity_at
), quote_actions AS (
  SELECT
    p.*,
    min(e.occurred_at) FILTER (WHERE e.element_label = 'pricing_map_map_profile_quote_start'
      AND p.profile_after_street_at IS NOT NULL AND e.occurred_at > p.profile_after_street_at) AS quote_after_profile_at
  FROM profile_actions p
  LEFT JOIN map_events e USING (session_id)
  GROUP BY p.session_id, p.opened_at, p.selected_at, p.main_selected_at,
    p.sub_selected_at, p.legacy_selected_at, p.cleared_at, p.street_after_activity_at,
    p.profile_after_street_at
), weekly AS (
  SELECT
    date_trunc('week', COALESCE(opened_at, selected_at, cleared_at) AT TIME ZONE 'UTC') AS week_utc,
    count(*) FILTER (WHERE opened_at IS NOT NULL) AS selector_open_sessions,
    count(*) FILTER (WHERE selected_at IS NOT NULL) AS activity_selection_sessions,
    count(*) FILTER (WHERE main_selected_at IS NOT NULL) AS main_activity_selection_sessions,
    count(*) FILTER (WHERE sub_selected_at IS NOT NULL) AS subactivity_selection_sessions,
    count(*) FILTER (WHERE legacy_selected_at IS NOT NULL) AS legacy_activity_selection_sessions,
    count(*) FILTER (WHERE cleared_at IS NOT NULL) AS activity_clear_sessions,
    count(*) FILTER (WHERE street_after_activity_at IS NOT NULL) AS street_after_activity_sessions,
    count(*) FILTER (WHERE profile_after_street_at IS NOT NULL) AS profile_after_street_sessions,
    count(*) FILTER (WHERE quote_after_profile_at IS NOT NULL) AS quote_after_profile_sessions
  FROM quote_actions
  GROUP BY 1
)
SELECT
  week_utc,
  selector_open_sessions,
  activity_selection_sessions,
  main_activity_selection_sessions,
  subactivity_selection_sessions,
  legacy_activity_selection_sessions,
  activity_clear_sessions,
  street_after_activity_sessions,
  round(100.0 * street_after_activity_sessions / nullif(activity_selection_sessions, 0), 1)
    AS activity_to_street_pct,
  profile_after_street_sessions,
  round(100.0 * profile_after_street_sessions / nullif(street_after_activity_sessions, 0), 1)
    AS street_to_profile_pct,
  quote_after_profile_sessions,
  round(100.0 * quote_after_profile_sessions / nullif(profile_after_street_sessions, 0), 1)
    AS profile_to_quote_start_pct
FROM weekly
ORDER BY week_utc DESC;
```

`activity_to_street_pct` is a session-level sequence, not a per-click conversion rate. It cannot prove that the later street choice came from the selected activity or that the UI caused the action. Events are consent-gated; low weekly volume is directional only. Use at least two complete weeks and pair these aggregates with a moderated task test before concluding that the new selector improves supplier discovery.

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

## Market browse pagination

Use this aggregate query to monitor whether consented sessions successfully load additional pages while exploring the city market. It returns weekly totals only; it does not expose session keys, search terms, cities, filters, or establishment identifiers.

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_browse_more_succeeded') AS browse_pages_loaded,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_browse_more_failed') AS browse_page_failures,
  round(
    100.0 * count(*) FILTER (WHERE element_label = 'pricing_map_map_browse_more_failed')
      / nullif(count(*), 0),
    1
  ) AS browse_page_failure_pct
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND element_label IN (
    'pricing_map_map_browse_more_succeeded',
    'pricing_map_map_browse_more_failed'
  )
GROUP BY 1
ORDER BY week_utc DESC;
```

The events are recorded only with accepted map-analytics consent and only after a browse page request completes. A superseded request is not counted. Treat the rate as a UI/service signal, not proof that a user found a relevant supplier; pair it with an observed discovery task and time-to-profile.

## Blank supplier/buyer prompt visibility

These events record a blank search prompt only after at least half of the prompt intersects the visible viewport: `pricing_map_map_supplier_prompt_seen` for supplier search and `pricing_map_map_buyer_prompt_seen` for buyer discovery. A prompt rendered below the map but outside the viewport is not counted. New role-specific events distinguish search start, result bucket, failure, and result-profile open for the selected task direction. They contain no search text, location, or establishment key. Events are consented and session-scoped, and leaving/hiding the prompt before returning is a new impression.

The following aggregate query reports the session funnel by task direction: prompt shown, search started, result bucket/failure, and result profile opened. Legacy generic result events continue to be emitted for existing reports; do not add generic and role-specific event counts together because they represent the same searches.

```sql
WITH map_events AS (
  SELECT session_id, occurred_at, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_supplier_prompt_seen',
      'pricing_map_map_buyer_prompt_seen',
      'pricing_map_map_supplier_search_started',
      'pricing_map_map_supplier_search_results_empty',
      'pricing_map_map_supplier_search_results_1_4',
      'pricing_map_map_supplier_search_results_5_plus',
      'pricing_map_map_supplier_search_failed',
      'pricing_map_map_supplier_result_profile_open',
      'pricing_map_map_buyer_search_started',
      'pricing_map_map_buyer_search_results_empty',
      'pricing_map_map_buyer_search_results_1_4',
      'pricing_map_map_buyer_search_results_5_plus',
      'pricing_map_map_buyer_search_failed',
      'pricing_map_map_buyer_result_profile_open'
    )
), prompt_sessions AS (
  SELECT
    session_id,
    CASE element_label
      WHEN 'pricing_map_map_supplier_prompt_seen' THEN 'supplier'
      ELSE 'buyer'
    END AS prompt_type,
    min(occurred_at) AS prompt_at
  FROM map_events
  WHERE element_label IN (
    'pricing_map_map_supplier_prompt_seen',
    'pricing_map_map_buyer_prompt_seen'
  )
  GROUP BY session_id, prompt_type
), searches AS (
  SELECT
    p.session_id,
    p.prompt_type,
    p.prompt_at,
    min(e.occurred_at) FILTER (WHERE e.element_label = CASE p.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_started'
      ELSE 'pricing_map_map_buyer_search_started'
    END AND e.occurred_at > p.prompt_at) AS search_started_at
  FROM prompt_sessions p
  LEFT JOIN map_events e ON e.session_id = p.session_id
  GROUP BY p.session_id, p.prompt_type, p.prompt_at
), outcomes AS (
  SELECT
    s.session_id,
    s.prompt_type,
    s.prompt_at,
    s.search_started_at,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_results_empty'
      ELSE 'pricing_map_map_buyer_search_results_empty'
    END) FILTER (WHERE e.occurred_at > s.search_started_at) AS zero_results,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_results_1_4'
      ELSE 'pricing_map_map_buyer_search_results_1_4'
    END) FILTER (WHERE e.occurred_at > s.search_started_at) AS results_1_4,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_results_5_plus'
      ELSE 'pricing_map_map_buyer_search_results_5_plus'
    END) FILTER (WHERE e.occurred_at > s.search_started_at) AS results_5_plus,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_failed'
      ELSE 'pricing_map_map_buyer_search_failed'
    END) FILTER (WHERE e.occurred_at > s.search_started_at) AS search_failed,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_result_profile_open'
      ELSE 'pricing_map_map_buyer_result_profile_open'
    END) FILTER (WHERE e.occurred_at > s.search_started_at) AS result_profile_opened
  FROM searches s
  LEFT JOIN map_events e ON e.session_id = s.session_id
  GROUP BY s.session_id, s.prompt_type, s.prompt_at, s.search_started_at
)
SELECT
  date_trunc('week', prompt_at AT TIME ZONE 'UTC') AS week_utc,
  prompt_type,
  count(*) AS prompt_sessions,
  count(*) FILTER (WHERE search_started_at IS NOT NULL) AS search_started_sessions,
  round(100.0 * count(*) FILTER (WHERE search_started_at IS NOT NULL) / nullif(count(*), 0), 1) AS prompt_to_search_pct,
  count(*) FILTER (WHERE zero_results) AS zero_result_sessions,
  count(*) FILTER (WHERE results_1_4) AS sessions_with_1_4_results,
  count(*) FILTER (WHERE results_5_plus) AS sessions_with_5_plus_results,
  count(*) FILTER (WHERE search_failed) AS failed_search_sessions,
  count(*) FILTER (WHERE result_profile_opened) AS sessions_opening_result_profile,
  round(100.0 * count(*) FILTER (WHERE result_profile_opened) / nullif(count(*) FILTER (WHERE search_started_at IS NOT NULL), 0), 1) AS search_to_profile_pct
FROM outcomes
GROUP BY 1, 2
ORDER BY week_utc DESC, prompt_type;
```

Wait for at least two complete weeks and 30 consented prompt sessions per prompt type before interpreting the percentages. Profile opens are a navigation signal, not proof of relevance, contact, or a successful match. Pair them with moderated supplier-discovery tasks, relevance ratings, and time-to-first-relevant-profile. Missing events can reflect analytics consent or blocked requests; they do not prove the prompt was not shown.

## Map legend control exposure and use

**Historical only:** this query describes the former floating map control. The guide and filter now live in a collapsed section at the top of the results panel across all tabs, so the control impression events below will no longer be emitted after that UI release. Do not use this exposure denominator for post-release sessions.

The legend records a control impression only after at least half of the control is visible in the viewport and map analytics consent is accepted. `show_control_seen` is the collapsed info button; `hide_control_seen` is the hide action after the guide is open. Both are emitted at most once per control per mounted map component. The query returns weekly session counts and the share of exposed sessions that later used that control. It never returns session keys or other user and establishment data.

Run against the same authorized, read-only main application database described above:

```sql
WITH map_events AS (
  SELECT session_id, occurred_at, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_legend_show_control_seen',
      'pricing_map_map_legend_hide_control_seen',
      'pricing_map_map_legend_show',
      'pricing_map_map_legend_hide'
    )
), exposures AS (
  SELECT
    session_id,
    occurred_at AS exposed_at,
    CASE element_label
      WHEN 'pricing_map_map_legend_show_control_seen' THEN 'show'
      ELSE 'hide'
    END AS control
  FROM map_events
  WHERE element_label IN (
    'pricing_map_map_legend_show_control_seen',
    'pricing_map_map_legend_hide_control_seen'
  )
)
SELECT
  date_trunc('week', exposed_at AT TIME ZONE 'UTC') AS week_utc,
  control,
  count(DISTINCT session_id) AS control_seen_sessions,
  count(DISTINCT session_id) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM map_events action
      WHERE action.session_id = exposures.session_id
        AND action.element_label = CASE control
          WHEN 'show' THEN 'pricing_map_map_legend_show'
          ELSE 'pricing_map_map_legend_hide'
        END
        AND action.occurred_at > exposures.exposed_at
    )
  ) AS control_used_after_seen_sessions,
  round(100.0 * count(DISTINCT session_id) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM map_events action
      WHERE action.session_id = exposures.session_id
        AND action.element_label = CASE control
          WHEN 'show' THEN 'pricing_map_map_legend_show'
          ELSE 'pricing_map_map_legend_hide'
        END
        AND action.occurred_at > exposures.exposed_at
    )
  ) / nullif(count(DISTINCT session_id), 0), 1) AS seen_to_use_pct
FROM exposures
GROUP BY 1, 2
ORDER BY week_utc DESC, control;
```

These events are consented, session-level UI signals, not evidence that the guide content was understood or that the map task succeeded. The query is not device-specific. Wait for two complete weeks and 30 consenting sessions per control before treating the rate as directional; pair it with a phone task observing whether users can show, use, and hide the guide without covering the map. Missing events can reflect consent or blocked analytics requests, not absence of exposure.

## Map legend use after moving it into the guide panel

After the UI release, `map_legend_show` and `map_legend_hide` mean that a user opened or closed the disclosure at the top of the results panel, available across its tabs. They no longer mean that a floating overlay was shown or dismissed. Count sessions and actions without an exposure denominator:

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  element_label,
  count(*) AS actions,
  count(DISTINCT session_id) AS consenting_sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND element_label IN ('pricing_map_map_legend_show', 'pricing_map_map_legend_hide')
GROUP BY 1, 2
ORDER BY week_utc DESC, element_label;
```

These events require map analytics consent and indicate a disclosure interaction only. They do not prove the key was read or understood. Wait for two complete weeks and 30 consenting sessions before interpreting the trend; pair it with a short usability task that checks whether users can find the key without losing map context.

## Wholesale filter in supplier search

The «جملة فقط» chip is shown with supplier-search results. The current city-wide browse response has no area facets, so this chip is not rendered in that view. The events below measure supplier-search sessions in which it is enabled, plus a coarse result bucket. They never include the search phrase, city, selected district, or establishment key. All events require the existing map-analytics consent.

The query below counts the first filter-enable interval per consenting session. It measures result availability and whether a supplier profile was opened while the filter remained enabled. A quote start is counted only after that profile open. It is a directional funnel, not proof that the filter caused the later action. Run against the same authorized, read-only database described above:

```sql
WITH map_events AS (
  SELECT session_id, occurred_at, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_supplier_search_started',
      'pricing_map_map_filter_wholesale_on',
      'pricing_map_map_filter_wholesale_off',
      'pricing_map_map_filter_wholesale_results_empty',
      'pricing_map_map_filter_wholesale_results_1_4',
      'pricing_map_map_filter_wholesale_results_5_plus',
      'pricing_map_map_filter_wholesale_results_failed',
      'pricing_map_map_profile_open',
      'pricing_map_map_profile_quote_start'
    )
), supplier_search AS (
  SELECT
    session_id,
    min(occurred_at) AS entry_at
  FROM map_events
  WHERE element_label = 'pricing_map_map_supplier_search_started'
  GROUP BY session_id
), enabled AS (
  SELECT s.session_id, s.entry_at, min(e.occurred_at) AS enabled_at
  FROM supplier_search s
  JOIN map_events e USING (session_id)
  WHERE e.element_label = 'pricing_map_map_filter_wholesale_on'
    AND e.occurred_at > s.entry_at
  GROUP BY s.session_id, s.entry_at
), filter_window AS (
  SELECT
    f.session_id,
    f.entry_at,
    f.enabled_at,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_filter_wholesale_off'
        AND e.occurred_at > f.enabled_at
    ) AS disabled_at
  FROM enabled f
  LEFT JOIN map_events e USING (session_id)
  GROUP BY f.session_id, f.entry_at, f.enabled_at
), first_filter_outcome AS (
  SELECT DISTINCT ON (w.session_id)
    w.session_id,
    e.element_label AS outcome
  FROM filter_window w
  JOIN map_events e USING (session_id)
  WHERE e.element_label IN (
      'pricing_map_map_filter_wholesale_results_empty',
      'pricing_map_map_filter_wholesale_results_1_4',
      'pricing_map_map_filter_wholesale_results_5_plus',
      'pricing_map_map_filter_wholesale_results_failed'
    )
    AND e.occurred_at > w.enabled_at
    AND (w.disabled_at IS NULL OR e.occurred_at < w.disabled_at)
  ORDER BY w.session_id, e.occurred_at
), scored AS (
  SELECT
    w.session_id,
    date_trunc('week', w.entry_at AT TIME ZONE 'UTC') AS week_utc,
    o.outcome,
    min(e.occurred_at) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_open'
        AND e.occurred_at > w.enabled_at
        AND (w.disabled_at IS NULL OR e.occurred_at < w.disabled_at)
    ) AS profile_opened_while_enabled_at
  FROM filter_window w
  LEFT JOIN first_filter_outcome o USING (session_id)
  LEFT JOIN map_events e ON e.session_id = w.session_id
    AND e.occurred_at > w.enabled_at
    AND (w.disabled_at IS NULL OR e.occurred_at < w.disabled_at)
  GROUP BY w.session_id, w.entry_at, o.outcome
), with_quote AS (
  SELECT
    s.*,
    EXISTS (
      SELECT 1
      FROM map_events q
      WHERE q.session_id = s.session_id
        AND q.element_label = 'pricing_map_map_profile_quote_start'
        AND s.profile_opened_while_enabled_at IS NOT NULL
        AND q.occurred_at > s.profile_opened_while_enabled_at
    ) AS quote_after_profile
  FROM scored s
)
SELECT
  week_utc,
  count(*) AS sessions_that_enabled_wholesale,
  count(*) FILTER (WHERE outcome = 'pricing_map_map_filter_wholesale_results_empty') AS zero_result_sessions,
  count(*) FILTER (WHERE outcome = 'pricing_map_map_filter_wholesale_results_1_4') AS sessions_with_1_to_4_results,
  count(*) FILTER (WHERE outcome = 'pricing_map_map_filter_wholesale_results_5_plus') AS sessions_with_5_plus_results,
  count(*) FILTER (WHERE outcome = 'pricing_map_map_filter_wholesale_results_failed') AS filter_request_failed_sessions,
  count(*) FILTER (WHERE profile_opened_while_enabled_at IS NOT NULL) AS profile_open_sessions,
  count(*) FILTER (WHERE quote_after_profile) AS quote_start_after_profile_sessions
FROM with_quote
GROUP BY week_utc
ORDER BY week_utc DESC;
```

The query intentionally uses only the first enable-to-disable interval in each session; a later re-enable in the same session is not counted separately. Events may be missing when analytics consent is declined, so this is not a count of all users. Wait for two complete weeks and at least 30 consenting sessions before treating the rates as directional, and review result quality with a human task check. Do not claim the filter caused a profile open or quote start from this sequence alone.

## Successful map readiness buckets

`map_ready_under_2s`, `map_ready_2_5s`, and `map_ready_over_5s` are recorded only after the Mapbox `load` event succeeds, and only for production sessions that have accepted map analytics. The timer starts when the map component first renders, so it includes the lazy-loaded map chunk and Mapbox initialization. Only a coarse bucket is sent; the exact duration stays in the browser. Sessions that have not accepted analytics or whose map never reaches `load` are not represented, and a user who accepts after the map is already ready is counted on a later map visit. Counts are map initializations, not unique people. This performance signal does not establish that the map is useful or that results are accurate.

```sql
SELECT
  CASE element_label
    WHEN 'pricing_map_map_ready_under_2s' THEN 'under 2 seconds'
    WHEN 'pricing_map_map_ready_2_5s' THEN '2 to 5 seconds'
    WHEN 'pricing_map_map_ready_over_5s' THEN 'over 5 seconds'
  END AS readiness_bucket,
  count(*) AS successful_map_initializations,
  count(DISTINCT session_id) AS consenting_tab_sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
  AND element_label IN (
    'pricing_map_map_ready_under_2s',
    'pricing_map_map_ready_2_5s',
    'pricing_map_map_ready_over_5s'
  )
GROUP BY 1
ORDER BY 1;
```

Do not set a performance target from this first release. First collect at least 30 successful map initializations across two complete weeks, then inspect the bucket distribution alongside user-task completion and map/search error rates. The measurements exclude load failures and nonconsenting sessions, so they are not a complete page-load success rate.

## Finding unlocated supplier results

Use this aggregate query to assess whether the optional “load next batch” action in the unlocated-results panel is finding establishments without precise coordinates. Events are recorded only after accepted map-analytics consent; they contain no search phrase, city, or establishment key.

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) FILTER (WHERE element_label = 'pricing_map_site_unlocated_batch_found') AS batches_with_unlocated_rows,
  count(*) FILTER (WHERE element_label = 'pricing_map_site_unlocated_batch_empty') AS batches_without_unlocated_rows,
  count(*) FILTER (WHERE element_label = 'pricing_map_site_unlocated_batch_failed') AS failed_batches,
  count(DISTINCT session_id) AS consenting_sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND element_label IN (
    'pricing_map_site_unlocated_batch_found',
    'pricing_map_site_unlocated_batch_empty',
    'pricing_map_site_unlocated_batch_failed'
  )
GROUP BY 1
ORDER BY week_utc DESC;
```

`batches_with_unlocated_rows` means the newly fetched page contained at least one previously unloaded result without a precise map point. It does not measure whether that establishment was useful or contacted. Read rates only after two complete weeks and at least 30 consenting batch attempts; pair the aggregate with observed discovery tasks and time-to-profile.

## Supplier data-quality notice exposure and opening

The map emits `pricing_map_map_data_quality_notice_seen` when the first matching result set on a page visit displays the warning and `pricing_map_map_data_quality_notice_open` when a user expands its details. These events require accepted map analytics consent and contain no search text or establishment identifiers. The percentage below is the share of consenting tab sessions with at least one recorded notice exposure that opened its details; it does not measure comprehension or trust.

```sql
WITH notice_events AS (
  SELECT session_id, occurred_at, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_data_quality_notice_seen',
      'pricing_map_map_data_quality_notice_open'
    )
),
sessions AS (
  SELECT
    session_id,
    min(occurred_at) FILTER (
      WHERE element_label = 'pricing_map_map_data_quality_notice_seen'
    ) AS first_seen_at,
    min(occurred_at) FILTER (
      WHERE element_label = 'pricing_map_map_data_quality_notice_open'
    ) AS first_open_at
  FROM notice_events
  GROUP BY session_id
  HAVING count(*) FILTER (
    WHERE element_label = 'pricing_map_map_data_quality_notice_seen'
  ) > 0
)
SELECT
  date_trunc('week', first_seen_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) AS sessions_with_notice,
  count(*) FILTER (WHERE first_open_at > first_seen_at) AS sessions_opening_notice,
  round(
    100.0 * count(*) FILTER (WHERE first_open_at > first_seen_at) / nullif(count(*), 0),
    1
  ) AS session_open_rate_pct
FROM sessions
GROUP BY 1
ORDER BY week_utc DESC;
```

Use the rate only after two complete weeks and at least 30 consenting sessions with a notice. A low opening rate may mean the short warning is already clear, that users overlook the disclosure, or that details are not relevant to their task; a high rate does not show the warning was understood. Pair it with a moderated task that asks users what the WhatsApp and operating-status labels mean. Sessions are browser tabs, not unique people.

## Successful search response-time buckets

On a fresh supplier or buyer search, the browser records one coarse duration bucket after the API returns and the response has been parsed: under 1 second, 1–3 seconds, or over 3 seconds. Only the bucket and search direction are sent; exact duration, search phrase, city, and establishment identifiers remain in the browser. Existing search-failure events remain separate, so these buckets describe completed requests, including successful zero-result searches, not failed requests.

```sql
WITH latency_events AS (
  SELECT
    occurred_at,
    session_id,
    CASE
      WHEN element_label LIKE 'pricing_map_map_supplier_search_latency_%' THEN 'supplier'
      ELSE 'buyer'
    END AS search_type,
    CASE
      WHEN element_label LIKE '%_under_1s' THEN 'under 1 second'
      WHEN element_label LIKE '%_1_to_3s' THEN '1 to 3 seconds'
      ELSE 'over 3 seconds'
    END AS latency_bucket
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_supplier_search_latency_under_1s',
      'pricing_map_map_supplier_search_latency_1_to_3s',
      'pricing_map_map_supplier_search_latency_over_3s',
      'pricing_map_map_buyer_search_latency_under_1s',
      'pricing_map_map_buyer_search_latency_1_to_3s',
      'pricing_map_map_buyer_search_latency_over_3s'
    )
)
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  search_type,
  latency_bucket,
  count(*) AS completed_searches,
  count(DISTINCT session_id) AS consenting_tab_sessions
FROM latency_events
GROUP BY 1, 2, 3
ORDER BY week_utc DESC, search_type, latency_bucket;
```

The buckets measure wait for a completed API search, not relevance, time-to-first-card paint, or time-to-useful-profile. Pair them with the existing result-count and failure buckets. Wait for two complete weeks and at least 30 completed searches per direction before setting a performance target; low consented volume is directional only.
