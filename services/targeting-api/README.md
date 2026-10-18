# Farq Targeting API source

This directory tracks the Python service source used by the opportunity map. It includes the read-only aggregate endpoints consumed by `FARQ-B2B`:

- `POST /market-summary`
- `POST /district-counts`
- `POST /district-insights` — selected districts with aggregate activity mix, dominant and least represented activities, and city activities without a classified district record. Missing means not recorded in the directory, not confirmed absent in reality.
- `POST /who-buys`

`POST /market-summary` accepts an optional `districts` list and returns city or selected-district aggregate totals. Its `summary.main_activities` array contains distinct directory businesses per approved main activity at high or medium taxonomy confidence. A business can appear under more than one activity, so category counts are not mutually exclusive and need not sum to `summary.total`. `summary.main_activities_basis` states this classification coverage caveat. Counts contain no business identifiers or contact data.
- `POST /map-focus` — creates a short-lived read-only map tile cohort matching a selected taxonomy level, so background vector tiles stay aligned with focused pins.

`/market-summary` and `/district-counts` resolve `q` locally through the targeting taxonomy. If `q` is combined with `main_id` and/or `sub_ids`, the resolved text activities are intersected with the explicit activity filters; an unmatched intersection returns zero matches. `specialty_ids` further restricts the cohort to businesses whose directory row carries one of those exact specialty IDs. When the deployed target snapshot lacks the `specialty_ids` column, exact-specialty aggregates return zero rather than silently widening to the parent activity. District filters further narrow the same cohort. These endpoints return directory aggregates, not evidence of real-world demand or complete market coverage. `/street-density` accepts the same exact specialty IDs only when its asset has a `specialty_ids` field; otherwise it returns no lines with an explanation rather than presenting parent-subcategory lines as exact-specialty results.

The deployment's business directory and taxonomy assets are intentionally excluded from Git. A deployment requires a separately maintained, access-controlled `data/` directory containing the exact production assets listed in the `Dockerfile`. Do not substitute older local data files: the map counts and supplier coverage depend on the deployed snapshot.

Before connecting Railway deployments to this folder, verify the staged data asset versions and hashes against the approved production snapshot, then deploy a preview service and check its aggregate results against the current production directory. Never commit `.parquet`, `.geojson`, contact, evaluation, or operational log data here.

`market_analytics.py` shares the directory's open-record policy and taxonomy classification. It returns aggregate values only; it does not expose business names, contact details, or row identifiers. Buyer counts describe taxonomy-based typical purchasing, not confirmed intent or actual transactions. The WhatsApp count reflects the source flag, not independent verification.

## Directory contact filters

For `/search` (including `objective: "browse"`), `/map-query`, and the resulting map tiles, an omitted or `all` `filters.contact` means **no contact-channel restriction**. This keeps the full eligible directory available for discovery and map analysis. `contact: "whatsapp"` and `contact: "email"` explicitly restrict results to those channels. Browse and search remain paginated; map tiles aggregate locations at lower zoom levels.

Showing a directory record does not make it eligible for a WhatsApp campaign. The Pricing UI disables campaign selection when no WhatsApp channel is available; the send endpoint re-resolves each selected `poi_key` against the directory, applies status eligibility, and requires WhatsApp eligibility for template sends. The `has_whatsapp` source flag is not independent verification that a number is active on WhatsApp.
