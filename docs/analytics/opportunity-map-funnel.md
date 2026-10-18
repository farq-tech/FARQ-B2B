# Opportunity map funnel

Use this query for a weekly, consented map funnel review. It groups only the anonymous map session key to count steps; it does not return session keys, search terms, or establishment identifiers.

Run this query against the **main application database used by `api.farq.sa`** (`COMPARISONS_DB_URL`, falling back to `DATABASE_URL`), where the API writes `public.analytics_events`. Do not select a database only because it has a table with this name: the separate comparison Supabase database is not the analytics source. Use an authorized read-only connection and return aggregates only; never copy connection strings or raw session rows into reports.

## Consented map page entries

The map records one `pageview` event each time an accepted-consent tab enters the map. This provides a denominator for page entries, including entries with no tracked interaction, without collecting a referrer, page content, location, or establishment identifier. Rejected or undecided sessions are not counted. Counts are consenting tab sessions, not all users or unique people.

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) AS map_page_entries,
  count(DISTINCT session_id) AS consenting_map_sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'pageview'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;
```

Compare page-entry sessions with sessions carrying map interaction events in the same weekly window. Do not interpret a missing pageview as a bounce: analytics requires consent, and browser/network failures can prevent delivery. Wait for at least two complete weeks and 30 consenting page-entry sessions before treating changes as directional.

```sql
WITH map_events AS (
  SELECT
    id,
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
      'pricing_map_map_supplier_search_failure_server',
      'pricing_map_map_supplier_search_failure_client',
      'pricing_map_map_supplier_search_failure_network',
      'pricing_map_map_supplier_search_failure_other',
      'pricing_map_map_buyer_search_failure_server',
      'pricing_map_map_buyer_search_failure_client',
      'pricing_map_map_buyer_search_failure_network',
      'pricing_map_map_buyer_search_failure_other',
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
    (array_agg(occurred_at ORDER BY id) FILTER (
      WHERE element_label IN (
        'pricing_map_map_search',
        'pricing_map_map_search_results_empty',
        'pricing_map_map_search_results_1_4',
        'pricing_map_map_search_results_5_plus',
        'pricing_map_map_search_failed'
      )
    ))[1] AS searched_at,
    min(id) FILTER (
      WHERE element_label IN (
        'pricing_map_map_search',
        'pricing_map_map_search_results_empty',
        'pricing_map_map_search_results_1_4',
        'pricing_map_map_search_results_5_plus',
        'pricing_map_map_search_failed'
      )
    ) AS searched_id
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
    s.searched_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_results_shortcut_seen'
        AND e.id > s.searched_id
    ) AS results_shortcut_seen_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_results_jump'
        AND e.id > s.searched_id
    ) AS results_jumped_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_district_select'
        AND e.id > s.searched_id
    ) AS district_selected_after_search_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_street_select'
        AND e.id > s.searched_id
    ) AS street_selected_after_search_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_open'
        AND e.id > s.searched_id
    ) AS profile_after_search_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_status_unconfirmed'
        AND e.id > s.searched_id
    ) AS unconfirmed_status_profile_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_whatsapp_unverified'
        AND e.id > s.searched_id
    ) AS unverified_whatsapp_profile_id
  FROM search_sessions s
  LEFT JOIN map_events e USING (session_id)
  GROUP BY s.session_id, s.searched_at, s.searched_id
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
      AND e.id <= COALESCE(s.results_shortcut_seen_id, s.searched_id)
    ORDER BY e.id DESC
    LIMIT 1
  ) result_bucket ON true
),
session_steps AS (
  SELECT
    s.session_id,
    s.searched_at,
    s.searched_id,
    s.result_bucket,
    s.results_shortcut_seen_id,
    s.results_jumped_id,
    s.district_selected_after_search_id,
    s.street_selected_after_search_id,
    s.profile_after_search_id,
    s.unconfirmed_status_profile_id,
    s.unverified_whatsapp_profile_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_district_select'
        AND s.results_shortcut_seen_id IS NOT NULL
        AND e.id > s.results_shortcut_seen_id
    ) AS district_selected_after_shortcut_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_street_select'
        AND s.results_shortcut_seen_id IS NOT NULL
        AND e.id > s.results_shortcut_seen_id
    ) AS street_selected_after_shortcut_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_result_profile_open'
        AND s.results_shortcut_seen_id IS NOT NULL
        AND s.results_jumped_id > s.results_shortcut_seen_id
        AND e.id > s.results_jumped_id
    ) AS profile_after_results_jump_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_quote_start'
        AND s.profile_after_search_id IS NOT NULL
        AND e.id > s.profile_after_search_id
    ) AS quote_after_profile_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_quote_start'
        AND s.unconfirmed_status_profile_id IS NOT NULL
        AND e.id > s.unconfirmed_status_profile_id
    ) AS quote_after_unconfirmed_status_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_quote_start'
        AND s.unverified_whatsapp_profile_id IS NOT NULL
        AND e.id > s.unverified_whatsapp_profile_id
    ) AS quote_after_unverified_whatsapp_id
  FROM session_context s
  LEFT JOIN map_events e USING (session_id)
  GROUP BY s.session_id, s.searched_at, s.searched_id, s.result_bucket, s.results_shortcut_seen_id, s.results_jumped_id,
    s.district_selected_after_search_id, s.street_selected_after_search_id, s.profile_after_search_id,
    s.unconfirmed_status_profile_id, s.unverified_whatsapp_profile_id
),
weekly AS (
  SELECT
    date_trunc('week', searched_at AT TIME ZONE 'UTC') AS week_utc,
    result_bucket,
    count(*) AS search_sessions,
    count(*) FILTER (WHERE district_selected_after_search_id IS NOT NULL OR street_selected_after_search_id IS NOT NULL) AS area_select_sessions,
    count(*) FILTER (WHERE district_selected_after_search_id IS NOT NULL) AS district_select_sessions,
    count(*) FILTER (WHERE street_selected_after_search_id IS NOT NULL) AS street_select_sessions,
    count(*) FILTER (WHERE profile_after_search_id IS NOT NULL) AS profile_after_search_sessions,
    count(*) FILTER (WHERE unconfirmed_status_profile_id IS NOT NULL) AS unconfirmed_status_profile_sessions,
    count(*) FILTER (WHERE unverified_whatsapp_profile_id IS NOT NULL) AS unverified_whatsapp_profile_sessions,
    count(*) FILTER (WHERE results_shortcut_seen_id IS NOT NULL) AS results_shortcut_seen_sessions,
    count(*) FILTER (WHERE results_jumped_id > results_shortcut_seen_id) AS results_jump_sessions,
    count(*) FILTER (WHERE district_selected_after_shortcut_id IS NOT NULL) AS district_select_after_shortcut_sessions,
    count(*) FILTER (WHERE street_selected_after_shortcut_id IS NOT NULL) AS street_select_after_shortcut_sessions,
    count(*) FILTER (WHERE profile_after_results_jump_id IS NOT NULL) AS profile_after_results_jump_sessions,
    count(*) FILTER (WHERE quote_after_profile_id IS NOT NULL) AS quote_after_profile_sessions,
    count(*) FILTER (WHERE quote_after_unconfirmed_status_id IS NOT NULL) AS quote_after_unconfirmed_status_sessions,
    count(*) FILTER (WHERE quote_after_unverified_whatsapp_id IS NOT NULL) AS quote_after_unverified_whatsapp_sessions
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

## Search result contact availability

This query measures whether a non-empty batch returned by the targeting search contained a phone or email for none, some, or all rows. It counts response batches and consenting sessions; it does not include contact values, result counts, search terms, location, or establishment identifiers. Empty search results remain in the existing search outcome metrics. A batch was received by the page but may not have been fully viewed, so this is a data-availability measure, not an impression or contact-success rate.

Run it against the same authorized, read-only main application database:

```sql
WITH contact_batches AS (
  SELECT
    date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
    session_id,
    element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_search_results_contact_none',
      'pricing_map_map_search_results_contact_some',
      'pricing_map_map_search_results_contact_all'
    )
)
SELECT
  week_utc,
  count(*) AS nonempty_result_batches,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_contact_none') AS batches_no_contact,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_contact_some') AS batches_mixed_contact,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_contact_all') AS batches_all_contact,
  round(100.0 * count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_contact_none') / nullif(count(*), 0), 1) AS batches_no_contact_pct,
  count(DISTINCT session_id) AS consenting_sessions
FROM contact_batches
GROUP BY week_utc
ORDER BY week_utc DESC;
```

These events use only phone/email presence returned to the page, including verified phone enrichment when configured. The base Parquet coverage is not a substitute for this service-response measure. Read at least two complete weeks and require 30 consenting sessions before treating a weekly share as more than directional. With no customer traffic, no conclusion about user experience can yet be drawn.

## Street activity discovery funnel

This query measures the consenting-session path from either opening the activity selector or choosing a taxonomy focus in the guide, through selecting an activity, a dense street, opening a result profile, and starting a quote request. It groups by the week of selector open or first activity action. It does not store or return category names, city, search text, or establishment identifiers. The `map_guide_focus_select` and `map_guide_focus_clear` events distinguish the guide-tree entry point without recording the chosen activity. Per-level counters continue to describe the activity selector; guide-tree selections are reported separately as a source-level count. The legacy `map_activity_select` event is included for comparison with clients that predate the more specific event labels. Exact-specialty selections filter map entities and only show street lines when the density source supports exact specialties; the app hides broader parent lines when it does not.

Run it against the same authorized, read-only main application database:

```sql
WITH map_events AS (
  SELECT id, session_id, occurred_at, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_activity_filter_open',
      'pricing_map_map_activity_main_select',
      'pricing_map_map_activity_sub_select',
      'pricing_map_map_activity_spec_select',
      'pricing_map_map_activity_clear',
      'pricing_map_map_guide_focus_select',
      'pricing_map_map_guide_focus_clear',
      'pricing_map_map_activity_select',
      'pricing_map_map_street_select',
      'pricing_map_map_result_profile_open',
      'pricing_map_map_profile_quote_start'
    )
), selector_sessions AS (
  SELECT
    session_id,
    (array_agg(occurred_at ORDER BY id) FILTER (
      WHERE element_label = 'pricing_map_map_activity_filter_open'
    ))[1] AS opened_at,
    min(id) FILTER (WHERE element_label = 'pricing_map_map_activity_filter_open') AS opened_id
  FROM map_events
  GROUP BY session_id
  HAVING count(*) FILTER (WHERE element_label IN (
    'pricing_map_map_activity_filter_open',
    'pricing_map_map_activity_main_select',
    'pricing_map_map_activity_sub_select',
    'pricing_map_map_activity_spec_select',
    'pricing_map_map_activity_clear',
    'pricing_map_map_guide_focus_select',
    'pricing_map_map_guide_focus_clear',
    'pricing_map_map_activity_select'
  )) > 0
), selections AS (
  SELECT
    s.session_id,
    s.opened_at,
    s.opened_id,
    (array_agg(e.occurred_at ORDER BY e.id) FILTER (WHERE e.element_label IN (
      'pricing_map_map_activity_main_select',
      'pricing_map_map_activity_sub_select',
      'pricing_map_map_activity_spec_select',
      'pricing_map_map_guide_focus_select',
      'pricing_map_map_activity_select'
    ) AND (s.opened_id IS NULL OR e.id >= s.opened_id)))[1] AS selected_at,
    min(e.id) FILTER (WHERE e.element_label IN (
      'pricing_map_map_activity_main_select',
      'pricing_map_map_activity_sub_select',
      'pricing_map_map_activity_spec_select',
      'pricing_map_map_guide_focus_select',
      'pricing_map_map_activity_select'
    ) AND (s.opened_id IS NULL OR e.id >= s.opened_id)) AS selected_id,
    (array_agg(e.occurred_at ORDER BY e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_activity_main_select'
        AND (s.opened_id IS NULL OR e.id >= s.opened_id)
    ))[1] AS main_selected_at,
    min(e.id) FILTER (WHERE e.element_label = 'pricing_map_map_activity_main_select'
      AND (s.opened_id IS NULL OR e.id >= s.opened_id)) AS main_selected_id,
    (array_agg(e.occurred_at ORDER BY e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_activity_sub_select'
        AND (s.opened_id IS NULL OR e.id >= s.opened_id)
    ))[1] AS sub_selected_at,
    min(e.id) FILTER (WHERE e.element_label = 'pricing_map_map_activity_sub_select'
      AND (s.opened_id IS NULL OR e.id >= s.opened_id)) AS sub_selected_id,
    min(e.id) FILTER (WHERE e.element_label = 'pricing_map_map_activity_spec_select'
      AND (s.opened_id IS NULL OR e.id >= s.opened_id)) AS specialty_selected_id,
    (array_agg(e.occurred_at ORDER BY e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_activity_select'
        AND (s.opened_id IS NULL OR e.id >= s.opened_id)
    ))[1] AS legacy_selected_at,
    min(e.id) FILTER (WHERE e.element_label = 'pricing_map_map_activity_select'
      AND (s.opened_id IS NULL OR e.id >= s.opened_id)) AS legacy_selected_id,
    (array_agg(e.occurred_at ORDER BY e.id) FILTER (
      WHERE e.element_label IN ('pricing_map_map_activity_clear', 'pricing_map_map_guide_focus_clear')
        AND (s.opened_id IS NULL OR e.id >= s.opened_id)
    ))[1] AS cleared_at,
    min(e.id) FILTER (WHERE e.element_label IN ('pricing_map_map_activity_clear', 'pricing_map_map_guide_focus_clear')
      AND (s.opened_id IS NULL OR e.id >= s.opened_id)) AS cleared_id
  FROM selector_sessions s
  LEFT JOIN map_events e USING (session_id)
  GROUP BY s.session_id, s.opened_at, s.opened_id
), activity_actions AS (
  SELECT
    s.*,
    min(e.id) FILTER (WHERE e.element_label = 'pricing_map_map_street_select'
      AND s.selected_id IS NOT NULL AND e.id > s.selected_id) AS street_after_activity_id
  FROM selections s
  LEFT JOIN map_events e USING (session_id)
  GROUP BY s.session_id, s.opened_at, s.opened_id, s.selected_at, s.selected_id, s.main_selected_at,
    s.main_selected_id, s.sub_selected_at, s.sub_selected_id, s.specialty_selected_id, s.legacy_selected_at, s.legacy_selected_id,
    s.cleared_at, s.cleared_id
), profile_actions AS (
  SELECT
    a.*,
    min(e.id) FILTER (WHERE e.element_label = 'pricing_map_map_result_profile_open'
      AND a.street_after_activity_id IS NOT NULL AND e.id > a.street_after_activity_id) AS profile_after_street_id
  FROM activity_actions a
  LEFT JOIN map_events e USING (session_id)
  GROUP BY a.session_id, a.opened_at, a.opened_id, a.selected_at, a.selected_id, a.main_selected_at,
    a.main_selected_id, a.sub_selected_at, a.sub_selected_id, a.specialty_selected_id, a.legacy_selected_at, a.legacy_selected_id,
    a.cleared_at, a.cleared_id, a.street_after_activity_id
), quote_actions AS (
  SELECT
    p.*,
    min(e.id) FILTER (WHERE e.element_label = 'pricing_map_map_profile_quote_start'
      AND p.profile_after_street_id IS NOT NULL AND e.id > p.profile_after_street_id) AS quote_after_profile_id
  FROM profile_actions p
  LEFT JOIN map_events e USING (session_id)
  GROUP BY p.session_id, p.opened_at, p.opened_id, p.selected_at, p.selected_id, p.main_selected_at,
    p.main_selected_id, p.sub_selected_at, p.sub_selected_id, p.specialty_selected_id, p.legacy_selected_at, p.legacy_selected_id,
    p.cleared_at, p.cleared_id, p.street_after_activity_id, p.profile_after_street_id
), guide_sessions AS (
  SELECT
    date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
    count(DISTINCT session_id) FILTER (
      WHERE element_label = 'pricing_map_map_guide_focus_select'
    ) AS guide_focus_sessions,
    count(DISTINCT session_id) FILTER (
      WHERE element_label = 'pricing_map_map_guide_focus_clear'
    ) AS guide_clear_sessions
  FROM map_events
  GROUP BY 1
), weekly AS (
  SELECT
    date_trunc('week', COALESCE(opened_at, selected_at, cleared_at) AT TIME ZONE 'UTC') AS week_utc,
    count(*) FILTER (WHERE opened_at IS NOT NULL) AS selector_open_sessions,
    count(*) FILTER (WHERE selected_at IS NOT NULL) AS activity_selection_sessions,
    count(*) FILTER (WHERE main_selected_at IS NOT NULL) AS main_activity_selection_sessions,
    count(*) FILTER (WHERE sub_selected_at IS NOT NULL) AS subactivity_selection_sessions,
    count(*) FILTER (WHERE specialty_selected_id IS NOT NULL) AS specialty_selection_sessions,
    count(*) FILTER (WHERE legacy_selected_at IS NOT NULL) AS legacy_activity_selection_sessions,
    count(*) FILTER (WHERE cleared_at IS NOT NULL) AS activity_clear_sessions,
    count(*) FILTER (WHERE street_after_activity_id IS NOT NULL) AS street_after_activity_sessions,
    count(*) FILTER (WHERE profile_after_street_id IS NOT NULL) AS profile_after_street_sessions,
    count(*) FILTER (WHERE quote_after_profile_id IS NOT NULL) AS quote_after_profile_sessions
  FROM quote_actions
  GROUP BY 1
)
SELECT
  w.week_utc,
  w.selector_open_sessions,
  w.activity_selection_sessions,
  w.main_activity_selection_sessions,
  w.subactivity_selection_sessions,
  w.specialty_selection_sessions,
  w.legacy_activity_selection_sessions,
  w.activity_clear_sessions,
  coalesce(g.guide_focus_sessions, 0) AS guide_focus_sessions,
  coalesce(g.guide_clear_sessions, 0) AS guide_clear_sessions,
  w.street_after_activity_sessions,
  round(100.0 * street_after_activity_sessions / nullif(activity_selection_sessions, 0), 1)
    AS activity_to_street_pct,
  w.profile_after_street_sessions,
  round(100.0 * w.profile_after_street_sessions / nullif(w.street_after_activity_sessions, 0), 1)
    AS street_to_profile_pct,
  w.quote_after_profile_sessions,
  round(100.0 * w.quote_after_profile_sessions / nullif(w.profile_after_street_sessions, 0), 1)
    AS profile_to_quote_start_pct
FROM weekly w
LEFT JOIN guide_sessions g USING (week_utc)
ORDER BY w.week_utc DESC;
```

`activity_to_street_pct` is a session-level sequence, not a per-click conversion rate. It cannot prove that the later street choice came from the selected activity or that the UI caused the action. Events are consent-gated; low weekly volume is directional only. Use at least two complete weeks and pair these aggregates with a moderated task test before concluding that the new selector improves supplier discovery.

## Expanded map mode engagement

`map_focus_open` records entry to the full-screen map and `map_focus_close` records use of its “رجوع للتخطيط” control. Both are recorded only when the user has accepted map analytics consent. They carry the existing anonymous session key, but no search phrase, city, location, or establishment identifier. The query below groups each session by its first focus-mode entry in the 56-day window; repeat visits in one session are intentionally not counted separately. Closing the tab or navigating away does not emit `map_focus_close`. It is not device-specific, so do not label these sessions as mobile.

Run it only against the same authorized, read-only main application database described above:

```sql
WITH map_events AS (
  SELECT id, session_id, occurred_at, element_label
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
  SELECT
    session_id,
    (array_agg(occurred_at ORDER BY id))[1] AS opened_at,
    min(id) AS opened_id
  FROM map_events
  WHERE element_label = 'pricing_map_map_focus_open'
  GROUP BY session_id
), focus_actions AS (
  SELECT
    f.session_id,
    f.opened_at,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_focus_close' AND e.id > f.opened_id
    ) AS closed_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_sheet_open' AND e.id > f.opened_id
    ) AS sheet_opened_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_sheet_peek' AND e.id > f.opened_id
    ) AS peek_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_sheet_half' AND e.id > f.opened_id
    ) AS half_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_sheet_full' AND e.id > f.opened_id
    ) AS full_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_result_profile_open' AND e.id > f.opened_id
    ) AS result_profile_opened_id
  FROM focus_entries f
  LEFT JOIN map_events e USING (session_id)
  GROUP BY f.session_id, f.opened_at, f.opened_id
), weekly AS (
  SELECT
    date_trunc('week', opened_at AT TIME ZONE 'UTC') AS week_utc,
    count(*) AS focus_entry_sessions,
    count(*) FILTER (WHERE closed_id IS NOT NULL) AS focus_closed_sessions,
    count(*) FILTER (WHERE sheet_opened_id IS NOT NULL) AS result_panel_sessions,
    count(*) FILTER (WHERE peek_id IS NOT NULL) AS peek_sessions,
    count(*) FILTER (WHERE half_id IS NOT NULL) AS half_sessions,
    count(*) FILTER (WHERE full_id IS NOT NULL) AS full_sessions,
    count(*) FILTER (WHERE result_profile_opened_id IS NOT NULL) AS result_profile_sessions
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
  SELECT id, session_id, occurred_at, element_label
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
    min(id) AS prompt_id,
    (array_agg(occurred_at ORDER BY id))[1] AS prompt_at
  FROM map_events
  WHERE element_label IN (
    'pricing_map_map_supplier_prompt_seen',
    'pricing_map_map_buyer_prompt_seen'
  )
  GROUP BY session_id, prompt_type
), search_ids AS (
  SELECT
    p.session_id,
    p.prompt_type,
    p.prompt_id,
    p.prompt_at,
    min(e.id) FILTER (WHERE e.element_label = CASE p.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_started'
      ELSE 'pricing_map_map_buyer_search_started'
    END AND e.id > p.prompt_id) AS search_started_id
  FROM prompt_sessions p
  LEFT JOIN map_events e ON e.session_id = p.session_id
  GROUP BY p.session_id, p.prompt_type, p.prompt_id, p.prompt_at
), outcomes AS (
  SELECT
    s.session_id,
    s.prompt_type,
    s.prompt_at,
    s.search_started_id,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_results_empty'
      ELSE 'pricing_map_map_buyer_search_results_empty'
    END) FILTER (WHERE e.id > s.search_started_id) AS zero_results,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_results_1_4'
      ELSE 'pricing_map_map_buyer_search_results_1_4'
    END) FILTER (WHERE e.id > s.search_started_id) AS results_1_4,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_results_5_plus'
      ELSE 'pricing_map_map_buyer_search_results_5_plus'
    END) FILTER (WHERE e.id > s.search_started_id) AS results_5_plus,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_search_failed'
      ELSE 'pricing_map_map_buyer_search_failed'
    END) FILTER (WHERE e.id > s.search_started_id) AS search_failed,
    bool_or(e.element_label = CASE s.prompt_type
      WHEN 'supplier' THEN 'pricing_map_map_supplier_result_profile_open'
      ELSE 'pricing_map_map_buyer_result_profile_open'
    END) FILTER (WHERE e.id > s.search_started_id) AS result_profile_opened
  FROM search_ids s
  LEFT JOIN map_events e ON e.session_id = s.session_id
  GROUP BY s.session_id, s.prompt_type, s.prompt_at, s.search_started_id
)
SELECT
  date_trunc('week', prompt_at AT TIME ZONE 'UTC') AS week_utc,
  prompt_type,
  count(*) AS prompt_sessions,
  count(*) FILTER (WHERE search_started_id IS NOT NULL) AS search_started_sessions,
  round(100.0 * count(*) FILTER (WHERE search_started_id IS NOT NULL) / nullif(count(*), 0), 1) AS prompt_to_search_pct,
  count(*) FILTER (WHERE zero_results) AS zero_result_sessions,
  count(*) FILTER (WHERE results_1_4) AS sessions_with_1_4_results,
  count(*) FILTER (WHERE results_5_plus) AS sessions_with_5_plus_results,
  count(*) FILTER (WHERE search_failed) AS failed_search_sessions,
  count(*) FILTER (WHERE result_profile_opened) AS sessions_opening_result_profile,
  round(100.0 * count(*) FILTER (WHERE result_profile_opened) / nullif(count(*) FILTER (WHERE search_started_id IS NOT NULL), 0), 1) AS search_to_profile_pct
FROM outcomes
GROUP BY 1, 2
ORDER BY week_utc DESC, prompt_type;
```

Wait for at least two complete weeks and 30 consented prompt sessions per prompt type before interpreting the percentages. Profile opens are a navigation signal, not proof of relevance, contact, or a successful match. Pair them with moderated supplier-discovery tasks, relevance ratings, and time-to-first-relevant-profile. Missing events can reflect analytics consent or blocked requests; they do not prove the prompt was not shown.

> **ترتيب الأحداث وحدود الاستدلال:** قد تحمل أحداث الدفعة الواحدة قيمة `occurred_at` نفسها لأن PostgreSQL يعيد `now()` نفسه طوال المعاملة. استعلامات التسلسل في هذا المستند تستخدم `id` لترتيب الإدخال، لا وقت تفاعل العميل؛ وقد يختلف ترتيب وصول طلبين متزامنين عن ترتيب تفاعل المستخدم. يبقى `occurred_at` لتحديد نافذة القياس والتجميع الأسبوعي، وقد لا يطابق أسبوع التفاعل عند تأخر الإرسال. المقاييس على مستوى الجلسة وليست لكل عملية بحث أو لكل ظهور، ولا تثبت أن خطوة سابقة سببت الخطوة التالية. يلزم جمع `client_sequence` أو توقيت رتيب من المتصفح في إصدار لاحق لتحسين الدقة؛ وحتى ذلك الحين تعامل مع القمع كإشارة اتجاهية فقط.

## Map legend control exposure and use

**Historical only:** this query describes the former floating map control. The guide and filter now live in a collapsed section at the top of the results panel across all tabs, so the control impression events below will no longer be emitted after that UI release. Do not use this exposure denominator for post-release sessions.

The legend records a control impression only after at least half of the control is visible in the viewport and map analytics consent is accepted. `show_control_seen` is the collapsed info button; `hide_control_seen` is the hide action after the guide is open. Both are emitted at most once per control per mounted map component. The query returns weekly session counts and the share of exposed sessions that later used that control. It never returns session keys or other user and establishment data.

Run against the same authorized, read-only main application database described above:

```sql
WITH map_events AS (
  SELECT id, session_id, occurred_at, element_label
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
    id AS exposed_id,
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
        AND action.id > exposures.exposed_id
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
        AND action.id > exposures.exposed_id
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

## Map layer visibility controls

The controls `pricing_map_map_filter_layer_places_on/off`, `pricing_map_map_filter_layer_streets_on/off`, `pricing_map_map_filter_layer_density_on/off`, and `pricing_map_map_filter_layer_districts_on/off` record when a consenting user shows or hides establishment and trade-cluster markers, dense street overlays, district density shading, or district outlines and labels. These controls change map presentation only; search results, filters, selections, and campaign recipients are unchanged. Count actions and consenting sessions by control and state:

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  CASE
    WHEN element_label LIKE '%_places_%' THEN 'establishment and trade-cluster markers'
    WHEN element_label LIKE '%_density_%' THEN 'district density shading'
    WHEN element_label LIKE '%_districts_%' THEN 'district outlines and labels'
  END AS control,
  CASE WHEN element_label LIKE '%_on' THEN 'shown' ELSE 'hidden' END AS state,
  count(*) AS actions,
  count(DISTINCT session_id) AS consenting_sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
  AND element_label IN (
    'pricing_map_map_filter_layer_places_on',
    'pricing_map_map_filter_layer_places_off',
    'pricing_map_map_filter_layer_streets_on',
    'pricing_map_map_filter_layer_streets_off',
    'pricing_map_map_filter_layer_density_on',
    'pricing_map_map_filter_layer_density_off',
    'pricing_map_map_filter_layer_districts_on',
    'pricing_map_map_filter_layer_districts_off'
  )
GROUP BY 1, 2, 3
ORDER BY week_utc DESC, control, state;
```

These are consented UI interactions, not evidence that users found the map clearer or that a search filter changed. Wait for two complete weeks and at least 30 consenting sessions per control before interpreting the pattern; pair it with a short task that asks users to locate an area or establishment with layers visible and hidden. Missing events may mean consent was not granted or the analytics request was blocked.

## Wholesale filter in supplier search

The «جملة فقط» chip is shown with supplier-search results. The current city-wide browse response has no area facets, so this chip is not rendered in that view. The events below measure supplier-search sessions in which it is enabled, plus a coarse result bucket. They never include the search phrase, city, selected district, or establishment key. All events require the existing map-analytics consent.

The query below counts the first filter-enable interval per consenting session. It measures result availability and whether a supplier profile was opened while the filter remained enabled. A quote start is counted only after that profile open. It is a directional funnel, not proof that the filter caused the later action. Run against the same authorized, read-only database described above:

```sql
WITH map_events AS (
  SELECT id, session_id, occurred_at, element_label
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
    (array_agg(occurred_at ORDER BY id))[1] AS entry_at,
    min(id) AS entry_id
  FROM map_events
  WHERE element_label = 'pricing_map_map_supplier_search_started'
  GROUP BY session_id
), enabled AS (
  SELECT s.session_id, s.entry_at, s.entry_id, min(e.id) AS enabled_id
  FROM supplier_search s
  JOIN map_events e USING (session_id)
  WHERE e.element_label = 'pricing_map_map_filter_wholesale_on'
    AND e.id > s.entry_id
  GROUP BY s.session_id, s.entry_at, s.entry_id
), filter_window AS (
  SELECT
    f.session_id,
    f.entry_at,
    f.entry_id,
    f.enabled_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_filter_wholesale_off'
        AND e.id > f.enabled_id
    ) AS disabled_id
  FROM enabled f
  LEFT JOIN map_events e USING (session_id)
  GROUP BY f.session_id, f.entry_at, f.entry_id, f.enabled_id
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
    AND e.id > w.enabled_id
    AND (w.disabled_id IS NULL OR e.id < w.disabled_id)
  ORDER BY w.session_id, e.id
), scored AS (
  SELECT
    w.session_id,
    date_trunc('week', w.entry_at AT TIME ZONE 'UTC') AS week_utc,
    o.outcome,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_profile_open'
        AND e.id > w.enabled_id
        AND (w.disabled_id IS NULL OR e.id < w.disabled_id)
    ) AS profile_opened_while_enabled_id
  FROM filter_window w
  LEFT JOIN first_filter_outcome o USING (session_id)
  LEFT JOIN map_events e ON e.session_id = w.session_id
    AND e.id > w.enabled_id
    AND (w.disabled_id IS NULL OR e.id < w.disabled_id)
  GROUP BY w.session_id, w.entry_at, o.outcome
), with_quote AS (
  SELECT
    s.*,
    EXISTS (
      SELECT 1
      FROM map_events q
      WHERE q.session_id = s.session_id
        AND q.element_label = 'pricing_map_map_profile_quote_start'
        AND s.profile_opened_while_enabled_id IS NOT NULL
        AND q.id > s.profile_opened_while_enabled_id
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
  count(*) FILTER (WHERE profile_opened_while_enabled_id IS NOT NULL) AS profile_open_sessions,
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
  SELECT id, session_id, occurred_at, element_label
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
    (array_agg(occurred_at ORDER BY id) FILTER (
      WHERE element_label = 'pricing_map_map_data_quality_notice_seen'
    ))[1] AS first_seen_at,
    min(id) FILTER (
      WHERE element_label = 'pricing_map_map_data_quality_notice_seen'
    ) AS first_seen_id,
    (array_agg(occurred_at ORDER BY id) FILTER (
      WHERE element_label = 'pricing_map_map_data_quality_notice_open'
    ))[1] AS first_open_at,
    min(id) FILTER (
      WHERE element_label = 'pricing_map_map_data_quality_notice_open'
    ) AS first_open_id
  FROM notice_events
  GROUP BY session_id
  HAVING count(*) FILTER (
    WHERE element_label = 'pricing_map_map_data_quality_notice_seen'
  ) > 0
)
SELECT
  date_trunc('week', first_seen_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) AS sessions_with_notice,
  count(*) FILTER (WHERE first_open_id > first_seen_id) AS sessions_opening_notice,
  round(
    100.0 * count(*) FILTER (WHERE first_open_id > first_seen_id) / nullif(count(*), 0),
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

## Street-density load health

The street-density load records consented `started`, `succeeded`, `failed`, manual `retry`, and automatic-retry outcome events. These labels contain no city, activity, query, or establishment data. One logical load may make a single automatic retry after a transient network failure or 502/503/504; the events describe the logical load, not individual HTTP attempts. The outcome rate uses completed loads only; loads superseded by a newer selection or still in flight at the end of the window have a start but no terminal event. The automatic-retry result is recorded separately as retry started, recovered, or failed.

Run against the same authorized, read-only main application database:

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_street_density_started') AS loads_started,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_street_density_succeeded') AS loads_succeeded,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_street_density_failed') AS loads_failed,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_street_density_retry') AS manual_retries,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_street_density_auto_retry') AS automatic_retries,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_street_density_auto_retry_recovered') AS automatic_retry_recoveries,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_street_density_auto_retry_failed') AS automatic_retry_failures,
  round(100.0 * count(*) FILTER (WHERE element_label = 'pricing_map_map_street_density_auto_retry_recovered')
    / nullif(count(*) FILTER (WHERE element_label IN (
      'pricing_map_map_street_density_auto_retry_recovered',
      'pricing_map_map_street_density_auto_retry_failed'
    )), 0), 1) AS automatic_retry_recovery_pct,
  round(100.0 * count(*) FILTER (WHERE element_label = 'pricing_map_map_street_density_failed')
    / nullif(count(*) FILTER (WHERE element_label IN (
      'pricing_map_map_street_density_succeeded',
      'pricing_map_map_street_density_failed'
    )), 0), 1) AS completed_load_failure_pct,
  count(DISTINCT session_id) FILTER (
    WHERE element_label = 'pricing_map_map_street_density_failed'
  ) AS sessions_with_failure
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
  AND element_label IN (
    'pricing_map_map_street_density_started',
    'pricing_map_map_street_density_succeeded',
    'pricing_map_map_street_density_failed',
    'pricing_map_map_street_density_retry',
    'pricing_map_map_street_density_auto_retry',
    'pricing_map_map_street_density_auto_retry_recovered',
    'pricing_map_map_street_density_auto_retry_failed'
  )
GROUP BY 1
ORDER BY 1 DESC;
```

These are logical-load events, not unique users, physical HTTP attempts, or streets. Use at least two complete weeks and 30 completed loads before interpreting load failure; use 30 completed automatic retries before interpreting recovery. When volume is lower, treat the percentages as directional and pair them with aggregate HTTP status counts.

## Supplier and buyer search retry health

Map supplier and buyer searches are read-only requests. The map retries one time after a transient browser-to-Pricing network failure or HTTP 502/503/504. These role-only events are recorded only after map analytics consent; they include no search text, city, filters, or establishment identifiers. The retry-start event is recorded once per retried request, followed by one recovery or failure event if the request reaches a terminal response. A tab closed during the retry may have no terminal event.

Use this query to review the recovery rate of completed automatic retries by week and map direction:

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  CASE
    WHEN element_label IN (
      'pricing_map_map_supplier_search_auto_retry',
      'pricing_map_map_supplier_search_auto_retry_recovered',
      'pricing_map_map_supplier_search_auto_retry_failed'
    ) THEN 'supplier'
    ELSE 'buyer'
  END AS search_direction,
  count(*) FILTER (WHERE element_label IN (
    'pricing_map_map_supplier_search_auto_retry',
    'pricing_map_map_buyer_search_auto_retry'
  )) AS retries_started,
  count(*) FILTER (WHERE element_label IN (
    'pricing_map_map_supplier_search_auto_retry_recovered',
    'pricing_map_map_buyer_search_auto_retry_recovered'
  )) AS retries_recovered,
  count(*) FILTER (WHERE element_label IN (
    'pricing_map_map_supplier_search_auto_retry_failed',
    'pricing_map_map_buyer_search_auto_retry_failed'
  )) AS retries_failed,
  round(100.0 * count(*) FILTER (WHERE element_label IN (
    'pricing_map_map_supplier_search_auto_retry_recovered',
    'pricing_map_map_buyer_search_auto_retry_recovered'
  )) / nullif(count(*) FILTER (WHERE element_label IN (
    'pricing_map_map_supplier_search_auto_retry_recovered',
    'pricing_map_map_buyer_search_auto_retry_recovered',
    'pricing_map_map_supplier_search_auto_retry_failed',
    'pricing_map_map_buyer_search_auto_retry_failed'
  )), 0), 1) AS completed_retry_recovery_pct
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
  AND element_label IN (
    'pricing_map_map_supplier_search_auto_retry',
    'pricing_map_map_supplier_search_auto_retry_recovered',
    'pricing_map_map_supplier_search_auto_retry_failed',
    'pricing_map_map_buyer_search_auto_retry',
    'pricing_map_map_buyer_search_auto_retry_recovered',
    'pricing_map_map_buyer_search_auto_retry_failed'
  )
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

These counts describe retry attempts, not unique people or proof that results were relevant. Compare them with the existing search failure and latency funnels. Wait for two complete weeks and at least 30 completed retries per direction before interpreting a recovery rate; with lower volume, report counts and treat percentages as directional.

## District insight reach and activity-list expansion

The map records `map_district_insight_seen` when a loaded district-insight panel intersects the visible scroll viewport, and `map_district_activities_expand` when the user expands the complete activity list. Both are consented, generic events: neither includes the district name, activity name, count, query, or business identifier. The first event means that some portion of the panel entered the viewport; it does not prove that the user read or understood it.

Run this aggregate query against the main application database described above. It returns session counts only, and requires that the earliest insight view and activity expansion follow the earliest district selection in the same tab session:

```sql
WITH district_events AS (
  SELECT id, session_id, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_district_select',
      'pricing_map_map_district_insight_seen',
      'pricing_map_map_district_activities_expand'
    )
), per_session AS (
  SELECT
    session_id,
    min(id) FILTER (WHERE element_label = 'pricing_map_map_district_select') AS selected_id,
    min(id) FILTER (WHERE element_label = 'pricing_map_map_district_insight_seen') AS insight_seen_id,
    min(id) FILTER (WHERE element_label = 'pricing_map_map_district_activities_expand') AS activities_expanded_id
  FROM district_events
  GROUP BY session_id
)
SELECT
  count(*) FILTER (WHERE selected_id IS NOT NULL) AS district_selection_sessions,
  count(*) FILTER (WHERE selected_id IS NOT NULL AND insight_seen_id > selected_id) AS selected_then_insight_seen_sessions,
  count(*) FILTER (WHERE selected_id IS NOT NULL AND insight_seen_id > selected_id AND activities_expanded_id > insight_seen_id) AS selected_seen_then_expanded_sessions,
  round(100.0 * count(*) FILTER (WHERE selected_id IS NOT NULL AND insight_seen_id > selected_id)
    / nullif(count(*) FILTER (WHERE selected_id IS NOT NULL), 0), 1) AS selected_to_insight_seen_pct,
  round(100.0 * count(*) FILTER (WHERE selected_id IS NOT NULL AND insight_seen_id > selected_id AND activities_expanded_id > insight_seen_id)
    / nullif(count(*) FILTER (WHERE selected_id IS NOT NULL AND insight_seen_id > selected_id), 0), 1) AS insight_seen_to_expanded_pct
FROM per_session;
```

These are session-level reach and interest signals, not evidence that the summaries improved a business outcome. The query cannot reliably distinguish QA from customer sessions and only compares the earliest event of each kind in a session; treat results as directional, inspect counts with percentages, and wait for at least 30 eligible sessions before deciding whether the activity distribution needs a product change.

## Selecting loaded wholesale-intent candidates for review

For an explicit wholesale purchase query, the results are activity-based candidates; neither the query nor a directory WhatsApp field confirms that an establishment sells wholesale or receives messages. The UI keeps the narrower batch action for rows tagged wholesale and separately lets the user add the loaded candidates matching the current filters with a WhatsApp field to the campaign review tray. The batch action does not send or schedule anything. It does not fetch unseen pages; after loading more, users can add the next batch. A consented generic event records use of this broader batch action and contains no query, district, activity, establishment key, or selected count.

Count sessions that used this action by week:

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) AS candidate_batch_actions,
  count(DISTINCT session_id) AS consenting_tab_sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND element_label = 'pricing_map_map_supplier_candidate_batch_add'
GROUP BY 1
ORDER BY week_utc DESC;
```

This is an interaction count, not proof that selected candidates are valid wholesalers, were reviewed, or produced a successful campaign. Analytics consent is required, so missing events do not mean that no one used the action. Wait for two full weeks and at least 30 consenting sessions before treating the trend as directional; review candidate accuracy with a human before any outreach.

## Search inside map filters

For filter lists with eight or more choices, the map offers an inline search. With analytics consent, the first non-empty search in an opened filter records `map_filter_search_used` once. The event intentionally omits the typed text and filter value. Existing `map_filter_select_*` events can show whether the same tab session later selected a filter; this is a navigation signal, not proof that the option was correct or useful.

```sql
WITH filter_events AS (
  SELECT id, session_id, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND (element_label = 'pricing_map_map_filter_search_used'
      OR element_label IN (
        'pricing_map_map_filter_select_district',
        'pricing_map_map_filter_select_street',
        'pricing_map_map_filter_select_role',
        'pricing_map_map_filter_select_specialty'
      ))
), searched_sessions AS (
  SELECT session_id, min(id) AS searched_id
  FROM filter_events
  WHERE element_label = 'pricing_map_map_filter_search_used'
  GROUP BY session_id
), outcomes AS (
  SELECT
    s.session_id,
    s.searched_id,
    min(e.id) FILTER (
      WHERE e.element_label IN (
        'pricing_map_map_filter_select_district',
        'pricing_map_map_filter_select_street',
        'pricing_map_map_filter_select_role',
        'pricing_map_map_filter_select_specialty'
      ) AND e.id > s.searched_id
    ) AS selected_after_search_id
  FROM searched_sessions s
  LEFT JOIN filter_events e USING (session_id)
  GROUP BY s.session_id, s.searched_id
)
SELECT
  count(*) AS sessions_that_searched_a_filter,
  count(*) FILTER (WHERE selected_after_search_id IS NOT NULL) AS sessions_that_later_selected_a_filter,
  round(100.0 * count(*) FILTER (WHERE selected_after_search_id IS NOT NULL)
    / nullif(count(*), 0), 1) AS search_to_filter_selection_pct
FROM outcomes;
```

Wait for two complete weeks and at least 30 consenting sessions before interpreting the percentage. A low rate can mean the search did not help, the user was comparing options, or the session ended; inspect counts and validate with a short task study before changing the taxonomy.

## Search inside the activity guide

The activity guide records `map_guide_search_used` once per mounted guide after the first non-empty query and only when map analytics consent is accepted. It never records the query, selected taxonomy, location, or establishment. Compare guide-search sessions with later guide-focus selections in the same tab session. This is a navigation signal only; it cannot show whether the search returned a useful result or caused the selection.

```sql
WITH guide_events AS (
  SELECT id, session_id, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_guide_search_used',
      'pricing_map_map_guide_focus_select'
    )
), searches AS (
  SELECT session_id, min(id) AS searched_id
  FROM guide_events
  WHERE element_label = 'pricing_map_map_guide_search_used'
  GROUP BY session_id
), outcomes AS (
  SELECT
    s.session_id,
    min(e.id) FILTER (
      WHERE e.element_label = 'pricing_map_map_guide_focus_select'
        AND e.id > s.searched_id
    ) AS selected_after_search_id
  FROM searches s
  LEFT JOIN guide_events e USING (session_id)
  GROUP BY s.session_id, s.searched_id
)
SELECT
  count(*) AS sessions_that_searched_the_guide,
  count(*) FILTER (WHERE selected_after_search_id IS NOT NULL) AS sessions_that_later_selected_a_focus,
  round(100.0 * count(*) FILTER (WHERE selected_after_search_id IS NOT NULL)
    / nullif(count(*), 0), 1) AS search_to_focus_selection_pct
FROM outcomes;
```

Require two complete weeks and at least 30 consenting sessions before treating the rate as directional. Pair it with a short task study: a focus selection after searching does not prove that the selected activity was the user's intended one.

## Multi-intent search first-page coverage

When a combined search contains multiple activity-and-district requests, the map records exactly one successful first-page outcome: `map_multi_intent_groups_all_visible`, `map_multi_intent_groups_some_visible`, or `map_multi_intent_groups_none_visible`. A group is visible when at least one row passes the existing activity-name evidence check. If any request fails and the combined results are not shown, the map records `map_multi_intent_search_failed` instead. Events require map analytics consent and omit the search text, activity, district, business, and number of groups. Successful outcomes describe only the initially loaded page, not all matching directory rows, campaign eligibility, or whether the user found the result useful.

```sql
SELECT
  element_label,
  count(*) AS multi_intent_search_events,
  count(DISTINCT session_id) AS consenting_sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
  AND element_label IN (
    'pricing_map_map_multi_intent_groups_all_visible',
    'pricing_map_map_multi_intent_groups_some_visible',
    'pricing_map_map_multi_intent_groups_none_visible',
    'pricing_map_map_multi_intent_search_failed'
  )
GROUP BY element_label
ORDER BY element_label;
```

One user session can contain multiple combined searches, so compare both event and session counts. Review at least two complete weeks and 30 consenting sessions before treating the distribution as directional; pair it with a task check of each request group and its loaded-more path.

## City, district, and street selector use

The map records a level-specific `map_filter_open_*` event when a location menu opens and `map_filter_select_*` when a location is chosen. This aggregate measures how often a consenting session that opened each selector later chose a location from that same level. It does not record the selected place, search text, or establishment, and it does not prove the map moved to the right feature or that the selected area was useful.

Run against the same authorized, read-only application database. A session is counted once per level and UTC week, using the first open event and the first subsequent selection event for that level.

```sql
WITH selector_events AS (
  SELECT
    id,
    session_id,
    occurred_at,
    CASE
      WHEN element_label IN ('pricing_map_map_filter_open_city', 'pricing_map_map_filter_select_city') THEN 'city'
      WHEN element_label IN ('pricing_map_map_filter_open_district', 'pricing_map_map_filter_select_district') THEN 'district'
      WHEN element_label IN ('pricing_map_map_filter_open_street', 'pricing_map_map_filter_select_street') THEN 'street'
    END AS scope,
    CASE
      WHEN element_label LIKE 'pricing_map_map_filter_open_%' THEN 'open'
      ELSE 'select'
    END AS action
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_filter_open_city',
      'pricing_map_map_filter_select_city',
      'pricing_map_map_filter_open_district',
      'pricing_map_map_filter_select_district',
      'pricing_map_map_filter_open_street',
      'pricing_map_map_filter_select_street'
    )
), selector_sessions AS (
  SELECT
    date_trunc('week', opened.occurred_at AT TIME ZONE 'UTC') AS week_utc,
    opened.scope,
    opened.session_id,
    min(opened.id) AS opened_id
  FROM selector_events opened
  WHERE opened.action = 'open'
  GROUP BY 1, 2, 3
), outcomes AS (
  SELECT
    s.week_utc,
    s.scope,
    s.session_id,
    min(e.id) FILTER (
      WHERE e.action = 'select'
        AND e.scope = s.scope
        AND e.id > s.opened_id
        AND date_trunc('week', e.occurred_at AT TIME ZONE 'UTC') = s.week_utc
    ) AS selected_id
  FROM selector_sessions s
  LEFT JOIN selector_events e USING (session_id)
  GROUP BY s.week_utc, s.scope, s.session_id
)
SELECT
  week_utc,
  scope,
  count(*) AS selector_open_sessions,
  count(*) FILTER (WHERE selected_id IS NOT NULL) AS selector_selection_sessions,
  round(100.0 * count(*) FILTER (WHERE selected_id IS NOT NULL) / nullif(count(*), 0), 1)
    AS open_to_selection_pct
FROM outcomes
GROUP BY week_utc, scope
ORDER BY week_utc DESC, scope;
```

The selection may happen after another location scope was opened in the same session, so this is a session-level directional measure rather than proof that one specific menu caused one specific choice. Review at least two complete weeks and 30 selector-open sessions per scope before treating differences as directional. Pair the counts with a manual task check that each selection updates the map viewport, result scope, and selected-state display correctly.


## Saved-product buyer search

This aggregate query counts the consented saved-product discovery events only. It does not return product text, locations, establishment identifiers, or session identifiers.

```sql
SELECT
  element_label,
  count(*) AS event_count,
  count(DISTINCT session_id) AS sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
  AND element_label IN (
    'pricing_map_map_buyer_products_search_started',
    'pricing_map_map_buyer_products_search_results_empty',
    'pricing_map_map_buyer_products_search_results_1_4',
    'pricing_map_map_buyer_products_search_results_5_plus',
    'pricing_map_map_buyer_products_search_failed',
    'pricing_map_map_buyer_products_search_under_1s',
    'pricing_map_map_buyer_products_search_1_to_3s',
    'pricing_map_map_buyer_products_search_over_3s',
    'pricing_map_map_buyer_products_more_started',
    'pricing_map_map_buyer_products_more_succeeded',
    'pricing_map_map_buyer_products_more_failed'
  )
GROUP BY element_label
ORDER BY element_label;
```

Treat sessions as a broad denominator rather than independent product searches: one session may run the flow multiple times. The results buckets refer to unique establishments loaded across all saved products on the first page, not the server's full result totals. Pagination events count a request per saved-product group, not unique products; they do not include which group was loaded. Requests superseded by a newer search have a start but no terminal outcome. QA sessions are not currently separated from customer sessions.

Use this aggregate to review whether subsequent pages load successfully. The failure percentage uses only terminal outcomes so an interrupted or superseded request does not inflate the denominator.

```sql
WITH page_events AS (
  SELECT occurred_at, session_id, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_buyer_products_more_started',
      'pricing_map_map_buyer_products_more_succeeded',
      'pricing_map_map_buyer_products_more_failed'
    )
)
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_buyer_products_more_started') AS page_requests_started,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_buyer_products_more_succeeded') AS page_requests_succeeded,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_buyer_products_more_failed') AS page_requests_failed,
  round(
    100.0 * count(*) FILTER (WHERE element_label = 'pricing_map_map_buyer_products_more_failed')
      / nullif(count(*) FILTER (WHERE element_label IN (
        'pricing_map_map_buyer_products_more_succeeded',
        'pricing_map_map_buyer_products_more_failed'
      )), 0),
    1
  ) AS terminal_page_failure_pct,
  count(DISTINCT session_id) FILTER (WHERE element_label = 'pricing_map_map_buyer_products_more_started') AS sessions_loading_more
FROM page_events
GROUP BY 1
ORDER BY week_utc DESC;
```

Use at least two complete weeks and 30 terminal page outcomes before treating the failure percentage as directional. Compare it with the first-page latency and result-profile signals above; do not infer that a successful page was relevant or that the user completed a buyer match.

## Main category detail exposure

This funnel measures whether consenting sessions that opened the main-category counter details later selected one of the category cards inside that panel. The exposure and selection events record only the interaction type; they contain no category, location, search, or establishment value. Results are aggregate counts by the week of the first panel open.

```sql
WITH category_events AS (
  SELECT id, session_id, occurred_at, element_label
  FROM public.analytics_events
  WHERE occurred_at >= now() - interval '56 days'
    AND event_type = 'click'
    AND path = '/opportunity-map'
    AND session_id IS NOT NULL
    AND element_label IN (
      'pricing_map_map_activity_counter_panel_open',
      'pricing_map_map_activity_counter_detail_select'
    )
), panel_sessions AS (
  SELECT
    session_id,
    min(id) FILTER (WHERE element_label = 'pricing_map_map_activity_counter_panel_open') AS panel_open_id,
    min(occurred_at) FILTER (WHERE element_label = 'pricing_map_map_activity_counter_panel_open') AS panel_opened_at
  FROM category_events
  GROUP BY session_id
  HAVING count(*) FILTER (WHERE element_label = 'pricing_map_map_activity_counter_panel_open') > 0
), outcomes AS (
  SELECT
    p.session_id,
    p.panel_opened_at,
    min(e.id) FILTER (WHERE e.element_label = 'pricing_map_map_activity_counter_detail_select' AND e.id > p.panel_open_id) AS detail_card_selected_id
  FROM panel_sessions p
  LEFT JOIN category_events e USING (session_id)
  GROUP BY p.session_id, p.panel_opened_at, p.panel_open_id
)
SELECT
  date_trunc('week', panel_opened_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) AS panel_open_sessions,
  count(*) FILTER (WHERE detail_card_selected_id IS NOT NULL) AS detail_card_selection_sessions,
  round(100.0 * count(*) FILTER (WHERE detail_card_selected_id IS NOT NULL) / nullif(count(*), 0), 1) AS panel_open_to_detail_card_selection_pct
FROM outcomes
GROUP BY 1
ORDER BY week_utc DESC;
```

The selection event is emitted only by a category card inside the opened details panel, so this measures the intended entry point directly. It remains a session-level measure: a later card selection may follow a subsequent close and reopen. Review at least two complete weeks and 30 panel-open sessions before treating changes as directional. With less traffic, use the counts to confirm instrumentation only, not to infer customer preference.

## Desktop results panel visibility

This aggregate measures use of the hide/show controls for the standard desktop results panel. Events require accepted map-analytics consent and contain no panel contents, filters, or establishment identifiers.

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_results_panel_hide') AS hide_events,
  count(DISTINCT session_id) FILTER (WHERE element_label = 'pricing_map_map_results_panel_hide') AS sessions_hiding_panel,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_results_panel_show') AS show_events,
  count(DISTINCT session_id) FILTER (WHERE element_label = 'pricing_map_map_results_panel_show') AS sessions_showing_panel
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
  AND element_label IN (
    'pricing_map_map_results_panel_hide',
    'pricing_map_map_results_panel_show'
  )
GROUP BY 1
ORDER BY 1 DESC;
```

These counts show control use, not whether hiding the panel improved map-task completion. Compare them with a short desktop task check and map-search/profile outcomes after two complete weeks and at least 30 consenting sessions; internal QA traffic must not be treated as customer preference.


## Supplier discovery choices and selection actions

This weekly aggregate counts consented sessions that choose a search direction, filter the visible map results by estimated fit, select or deselect a supplier, or bulk-select the current visible candidates. It also counts use of the add-products entry point. These events contain no search text, location, supplier identifier, or selection contents.

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  CASE element_label
    WHEN 'pricing_map_start_mode_buyer' THEN 'search for suppliers'
    WHEN 'pricing_map_start_mode_seller' THEN 'search for buyers'
    WHEN 'pricing_map_fit_filter_all' THEN 'show all fit estimates'
    WHEN 'pricing_map_fit_filter_likely' THEN 'filter to likely fit'
    WHEN 'pricing_map_fit_filter_maybe' THEN 'filter to possible fit'
    WHEN 'pricing_map_fit_filter_low' THEN 'filter to low fit'
    WHEN 'pricing_map_fit_filter_unknown' THEN 'filter to unestimated fit'
    WHEN 'pricing_map_fit_supplier_selection' THEN 'bulk-select visible fit candidates'
    WHEN 'pricing_map_map_supplier_add' THEN 'select one supplier'
    WHEN 'pricing_map_map_supplier_remove' THEN 'remove one supplier selection'
    WHEN 'pricing_map_map_seller_add_products' THEN 'open add-products flow'
  END AS interaction,
  count(*) AS actions,
  count(DISTINCT session_id) AS consenting_sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
  AND element_label IN (
    'pricing_map_start_mode_buyer',
    'pricing_map_start_mode_seller',
    'pricing_map_fit_filter_all',
    'pricing_map_fit_filter_likely',
    'pricing_map_fit_filter_maybe',
    'pricing_map_fit_filter_low',
    'pricing_map_fit_filter_unknown',
    'pricing_map_fit_supplier_selection',
    'pricing_map_map_supplier_add',
    'pricing_map_map_supplier_remove',
    'pricing_map_map_seller_add_products'
  )
GROUP BY 1, 2
ORDER BY week_utc DESC, interaction;
```

These counts describe interaction, not supplier relevance, purchase intent, campaign completion, or successful contact. Individual selection is temporary on the page, and bulk selection does not send messages. Review at least two complete weeks and 30 consenting sessions for the interaction family before interpreting a pattern; when volume is lower, treat the result as instrumentation confirmation only.

## Search failures by cause

Search failures already have role-specific events. The additional failure-class events distinguish server responses, client responses, network failures, and unclassified failures without recording the search phrase, location, response body, or business data. They are emitted for failed search attempts after the request is still current; superseded requests are ignored. This query reports aggregate event counts and consenting sessions only.

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  CASE
    WHEN element_label LIKE 'pricing_map_map_supplier_search_failure_%' THEN 'supplier search'
    ELSE 'buyer search'
  END AS search_type,
  split_part(element_label, '_failure_', 2) AS failure_cause,
  count(*) AS failed_attempts,
  count(DISTINCT session_id) AS consenting_sessions
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND session_id IS NOT NULL
  AND element_label IN (
    'pricing_map_map_supplier_search_failure_server',
    'pricing_map_map_supplier_search_failure_client',
    'pricing_map_map_supplier_search_failure_network',
    'pricing_map_map_supplier_search_failure_other',
    'pricing_map_map_buyer_search_failure_server',
    'pricing_map_map_buyer_search_failure_client',
    'pricing_map_map_buyer_search_failure_network',
    'pricing_map_map_buyer_search_failure_other'
  )
GROUP BY 1, 2, 3
ORDER BY week_utc DESC, search_type, failure_cause;
```

The cause is a coarse diagnostic, not proof of the upstream root cause: for example, a server response can originate from a gateway or a dependency. Compare aggregate counts with service-side logs for the same period. Consent is required, so this does not represent all attempts or all users; keep internal QA separate from customer usage.
