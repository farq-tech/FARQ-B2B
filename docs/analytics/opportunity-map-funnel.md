# Opportunity map funnel

Use this query for a weekly, consented map funnel review. It groups only the anonymous map session key to count steps; it does not return session keys, search terms, or establishment identifiers.

```sql
WITH map_sessions AS (
  SELECT
    date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
    session_id,
    min(occurred_at) FILTER (
      WHERE element_label IN (
        'pricing_map_map_search',
        'pricing_map_map_search_results_empty',
        'pricing_map_map_search_results_1_4',
        'pricing_map_map_search_results_5_plus',
        'pricing_map_map_search_failed'
      )
    ) AS searched_at,
    min(occurred_at) FILTER (
      WHERE element_label = 'pricing_map_map_profile_open'
    ) AS profile_opened_at,
    min(occurred_at) FILTER (
      WHERE element_label = 'pricing_map_map_profile_quote_start'
    ) AS quote_started_at
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
      'pricing_map_map_profile_open',
      'pricing_map_map_profile_quote_start'
    )
  GROUP BY 1, 2
),
weekly AS (
  SELECT
    week_utc,
    count(*) FILTER (WHERE searched_at IS NOT NULL) AS search_sessions,
    count(*) FILTER (
      WHERE searched_at IS NOT NULL
        AND profile_opened_at > searched_at
    ) AS profile_after_search_sessions,
    count(*) FILTER (
      WHERE searched_at IS NOT NULL
        AND profile_opened_at > searched_at
        AND quote_started_at > profile_opened_at
    ) AS quote_after_profile_sessions
  FROM map_sessions
  GROUP BY week_utc
)
SELECT
  week_utc,
  search_sessions,
  profile_after_search_sessions,
  round(100.0 * profile_after_search_sessions / nullif(search_sessions, 0), 1)
    AS search_to_profile_pct,
  quote_after_profile_sessions,
  round(100.0 * quote_after_profile_sessions / nullif(profile_after_search_sessions, 0), 1)
    AS profile_to_quote_start_pct
FROM weekly
ORDER BY week_utc DESC;
```

To see whether searches return zero, few, or several matches, run this second aggregate against the same 56-day window:

```sql
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC') AS week_utc,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_empty') AS searches_with_zero_results,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_1_4') AS searches_with_1_to_4_results,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_results_5_plus') AS searches_with_5_plus_results,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search_failed') AS failed_searches,
  count(*) FILTER (WHERE element_label = 'pricing_map_map_search') AS legacy_searches_without_result_bucket
FROM public.analytics_events
WHERE occurred_at >= now() - interval '56 days'
  AND event_type = 'click'
  AND path = '/opportunity-map'
  AND element_label IN (
    'pricing_map_map_search_results_empty',
    'pricing_map_map_search_results_1_4',
    'pricing_map_map_search_results_5_plus',
    'pricing_map_map_search_failed',
    'pricing_map_map_search'
  )
GROUP BY 1
ORDER BY 1 DESC;
```

## Reading the numbers

- `map_profile_quote_start` means the user opened the quote-request flow from a supplier profile. It does not mean a request was submitted or a supplier replied.
- New search clicks are labeled by result bucket (`0`, `1–4`, `5+`) or failure. Older `map_search` rows remain in the funnel but have no outcome bucket.
- These events are recorded only after analytics consent. The funnel describes consenting sessions, not all map users.
- Use at least two complete weeks for an initial comparison. If a week has fewer than 30 search sessions, treat the rate as directional and combine it with observed task completion; do not claim an experiment caused a change.
- Compare changes in search-to-profile and profile-to-quote-start separately. If the first step is weak, inspect map discoverability and result relevance before changing the quote flow.
