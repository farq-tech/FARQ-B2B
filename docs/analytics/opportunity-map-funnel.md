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
      'pricing_map_map_results_shortcut_seen',
      'pricing_map_map_results_jump',
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
    s.profile_after_search_at,
    s.unconfirmed_status_profile_at,
    s.unverified_whatsapp_profile_at,
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
  GROUP BY s.session_id, s.searched_at, s.result_bucket, s.results_shortcut_seen_at, s.results_jumped_at, s.profile_after_search_at, s.unconfirmed_status_profile_at, s.unverified_whatsapp_profile_at
),
weekly AS (
  SELECT
    date_trunc('week', searched_at AT TIME ZONE 'UTC') AS week_utc,
    result_bucket,
    count(*) AS search_sessions,
    count(*) FILTER (WHERE profile_after_search_at IS NOT NULL) AS profile_after_search_sessions,
    count(*) FILTER (WHERE unconfirmed_status_profile_at IS NOT NULL) AS unconfirmed_status_profile_sessions,
    count(*) FILTER (WHERE unverified_whatsapp_profile_at IS NOT NULL) AS unverified_whatsapp_profile_sessions,
    count(*) FILTER (WHERE results_shortcut_seen_at IS NOT NULL) AS results_shortcut_seen_sessions,
    count(*) FILTER (WHERE results_jumped_at > results_shortcut_seen_at) AS results_jump_sessions,
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
  profile_after_search_sessions,
  unconfirmed_status_profile_sessions,
  unverified_whatsapp_profile_sessions,
  round(100.0 * profile_after_search_sessions / nullif(search_sessions, 0), 1)
    AS search_to_profile_pct,
  results_shortcut_seen_sessions,
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
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search') AS legacy_searches_without_result_bucket,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_results_status_notice') AS status_notice_impressions,
  count(DISTINCT session_id) FILTER (WHERE element_label = 'pricing_map_map_results_status_notice') AS sessions_shown_status_notice
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
    'pricing_map_map_results_status_notice'
  )
GROUP BY 1
ORDER BY 1 DESC;
```

## Reading the numbers

- `map_profile_quote_start` means the user opened the quote-request flow from a supplier profile. It does not mean a request was submitted or a supplier replied.
- `map_results_shortcut_seen` means the shortcut was rendered after a search in the regular mobile layout. `map_results_jump` means the user tapped it to reach the results list. `map_result_profile_open` identifies an establishment opened specifically from that list, while `map_profile_open` includes opens from any map surface. These events are logged only with map analytics consent.
- `map_profile_status_unconfirmed` counts a consenting session that opened at least one profile whose source status is missing or unrecognized. It contains no establishment identifier. Do not attribute a later quote start to that same establishment; the event stream intentionally does not identify profiles.
- `map_profile_whatsapp_unverified` counts a consenting session that opened a profile whose WhatsApp flag is not explicitly marked verified. `quote_after_unverified_whatsapp_sessions` counts a later quote start in that same session only; it does not identify the establishment or prove that the notice caused the action.
- `quote_after_unconfirmed_status_sessions` means a quote flow began later in a session that had shown the notice. This is a session-level sequence only: it cannot prove the quote came from the same profile or that the notice caused the action.
- New search clicks are labeled by result bucket (`0`, `1–4`, `5+`) or failure. Older `map_search` rows remain in the funnel but have no outcome bucket.
- `map_results_status_notice` is emitted when the visible results include rows whose operating status is missing or unrecognized. It records only a consented session-level impression, never a business identifier; compare it with profile opens and quote starts as a directional funnel, not as causal evidence.
- Each session's funnel row is grouped by the most recent search-result bucket recorded before the shortcut was shown (or, if it was not shown, before the first search timestamp). This helps compare shortcut use when the map returned no results, a few results, or many results; it is a session-level view, not a per-search conversion rate.
- Shortcut use is divided by sessions in which the shortcut was actually shown, avoiding a desktop-inclusive denominator. The list-discovery step counts only `map_result_profile_open` events after a shortcut jump, not pin opens elsewhere on the map; quote-start counts must follow a profile open after search. Each session is assigned to the UTC week of its first search.
- These events are recorded only after analytics consent. The funnel describes consenting sessions, not all map users.
- Use at least two complete weeks for an initial comparison. If a week has fewer than 30 search sessions, treat the rate as directional and combine it with observed task completion; do not claim an experiment caused a change.
- Compare changes in search-to-profile and profile-to-quote-start separately. If the first step is weak, inspect map discoverability and result relevance before changing the quote flow.
