# Farq Targeting API source

This directory tracks the Python service source used by the opportunity map. It includes the read-only aggregate endpoints consumed by `FARQ-B2B`:

- `POST /market-summary`
- `POST /district-counts`
- `POST /district-insights` — selected districts with aggregate activity mix, dominant and least represented activities, and city activities without a classified district record. Missing means not recorded in the directory, not confirmed absent in reality.
- `POST /who-buys`

`POST /market-summary` accepts an optional `districts` list and returns city or selected-district aggregate totals. Its `summary.main_activities` array contains distinct directory businesses per approved main activity at high or medium taxonomy confidence. A business can appear under more than one activity, so category counts are not mutually exclusive and need not sum to `summary.total`. `summary.main_activities_basis` states this classification coverage caveat. Counts contain no business identifiers or contact data.
- `POST /map-focus` — creates a short-lived read-only map tile cohort matching a selected taxonomy level, so background vector tiles stay aligned with focused pins.

`/market-summary` and `/district-counts` resolve `q` locally through the targeting taxonomy. If `q` is combined with `main_id` and/or `sub_ids`, the resolved text activities are intersected with the explicit activity filters; an unmatched intersection returns zero matches. `specialty_ids` further restricts the cohort to businesses whose directory row carries one of those exact specialty IDs. When the deployed target snapshot lacks the `specialty_ids` column, exact-specialty aggregates return zero rather than silently widening to the parent activity. District filters further narrow the same cohort. These endpoints return directory aggregates, not evidence of real-world demand or complete market coverage. `/street-density` accepts the same exact specialty IDs only when its asset has a `specialty_ids` field; otherwise it returns no lines with an explanation rather than presenting parent-subcategory lines as exact-specialty results.

The deployment's business directory and taxonomy assets are intentionally excluded from Git. They must come from one separately maintained, access-controlled data release. Do not substitute older local data files: the map counts and supplier coverage depend on the deployed snapshot.

## Durable deployment inside Railway

The service image no longer copies a developer's `data/` directory at build time.
Its production source of truth is one immutable release in the **Railway Bucket
belonging to the same Railway project**. The process downloads it only at start,
checks every SHA-256 listed in `manifest.json`, and activates it atomically. A
failed download or checksum leaves the previous release untouched and prevents a
new unhealthy process from serving incomplete map results.

Create a release under `releases/<release-id>/` in the Bucket. Its
`manifest.json` must have schema version `1` and this shape:

```json
{
  "schema_version": 1,
  "release_id": "2026-10-23-example",
  "files": [
    {"path": "targets.parquet", "sha256": "<64 lowercase hex chars>", "size": 123}
  ]
}
```

The manifest must include the directory, district, aggregation, and taxonomy
assets. The service rejects incomplete releases rather than presenting partial
or sample results. Configure only the following values on the **targeting
service**, using Railway variable references for credentials:

| Variable | Purpose |
| --- | --- |
| `TARGETING_DATA_REQUIRED=1` | Fails closed when a release is not configured. |
| `TARGETING_DATA_BUCKET` | Bucket name in this Railway project. |
| `TARGETING_DATA_RELEASE` | Immutable prefix, such as `releases/2026-10-23-r1`. |
| `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Railway Bucket S3 connection values; never commit or expose these. |
| `TARGETING_DATA_DIR=/var/lib/farq-targeting/current` | Active verified release path. |
| `TARGETING_RUNTIME_DIR=/var/lib/farq-targeting/runtime` | Mutable audit logs, separate from the data release. |

Attach a Railway Volume at `/var/lib/farq-targeting` for the runtime cache and
logs. The Bucket remains the canonical release store; the Volume is never the
only copy. Railway health checks call the unauthenticated, minimal `GET
/healthz`, which returns only `{ "ok": true }` after the full data release has
loaded. The existing authenticated `/status` endpoint remains for operator
diagnostics.

The Atlas frontend and the legacy B2B proxy must use the new private service
address (`TARGETING_ORIGIN` pointing to the targeting service's Railway private
domain). They must not retain a public URL from a separate Railway project.

Before connecting Railway deployments to this folder, verify the staged data asset versions and hashes against the approved production snapshot, then deploy a preview service and check its aggregate results against the current production directory. Never commit `.parquet`, `.geojson`, contact, evaluation, or operational log data here.

`market_analytics.py` shares the directory's open-record policy and taxonomy classification. It returns aggregate values only; it does not expose business names, contact details, or row identifiers. Buyer counts describe taxonomy-based typical purchasing, not confirmed intent or actual transactions. The WhatsApp aggregate requires both the source flag and a phone number in a supported Saudi mobile format; it does not independently verify that the number receives messages.

Unexpected failures in map read endpoints keep the existing `503 UNAVAILABLE` response and emit a structured `farq.targeting` error log with a fixed endpoint label, exception class, and a short source stack. Exception messages, request bodies, search text, locations, and directory data are deliberately omitted.

## Street scope options

`POST /search` with `objective: "browse"` returns `areas.streets`: every distinct directory street for the selected city, or for the selected district when `filters.district` is supplied. Each item contains `{name, district, n}`. The list deliberately ignores the current `filters.street` value so people can switch streets from the same picker. Counts are directory records and do not imply street-density coverage.

## Directory contact filters

For `/search` (including `objective: "browse"`), `/map-query`, and the resulting map tiles, an omitted or `all` `filters.contact` means **no contact-channel restriction**. This keeps the full eligible directory available for discovery and map analysis. `contact: "whatsapp"` requires both the source WhatsApp marker and a valid Saudi mobile number; `contact: "email"` restricts results to email. Browse and search remain paginated; map tiles aggregate locations at lower zoom levels.

Showing a directory record does not make it eligible for a WhatsApp campaign. The Pricing UI disables campaign selection when no WhatsApp channel is available; the send endpoint re-resolves each selected `poi_key` against the directory, applies status eligibility, and requires WhatsApp eligibility for template sends. The `has_whatsapp` source flag is not independent verification that a number is active on WhatsApp.
