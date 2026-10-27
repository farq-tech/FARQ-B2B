# Farq Targeting API source

This directory tracks the Python service source used by the opportunity map. It includes the read-only aggregate endpoints consumed by `FARQ-B2B`:

- `POST /market-summary`
- `POST /district-counts`
- `POST /district-insights` — selected districts with aggregate activity mix, dominant and least represented activities, and city activities without a classified district record. Missing means not recorded in the directory, not confirmed absent in reality.
- `POST /who-buys`

`POST /market-summary` accepts an optional `districts` list and returns city or selected-district aggregate totals. Its `summary.main_activities` array contains distinct directory businesses per approved main activity at high or medium taxonomy confidence. A business can appear under more than one activity, so category counts are not mutually exclusive and need not sum to `summary.total`. `summary.main_activities_basis` states this classification coverage caveat. Counts contain no business identifiers or contact data.
- `POST /map-focus` — creates a short-lived read-only map tile cohort matching a selected taxonomy level, so background vector tiles stay aligned with focused pins.
- `GET /population-demographics?city=...` — returns modeled WorldPop age-band totals by sex, aggregated to the same official district IDs. Optional repeated `district=` parameters narrow results (up to 50 IDs). The endpoint is authenticated and serves only district aggregates; source GeoTIFFs stay on the private server data volume.

`/market-summary` and `/district-counts` resolve `q` locally through the targeting taxonomy. If `q` is combined with `main_id` and/or `sub_ids`, the resolved text activities are intersected with the explicit activity filters; an unmatched intersection returns zero matches. `specialty_ids` further restricts the cohort to businesses whose directory row carries one of those exact specialty IDs. When the deployed target snapshot lacks the `specialty_ids` column, exact-specialty aggregates return zero rather than silently widening to the parent activity. District filters further narrow the same cohort. These endpoints return directory aggregates, not evidence of real-world demand or complete market coverage. `/street-density` accepts the same exact specialty IDs only when its asset has a `specialty_ids` field; otherwise it returns no lines with an explanation rather than presenting parent-subcategory lines as exact-specialty results.

`/market-summary` and `/district-counts` also accept an optional `bounds` array in `[west, south, east, north]` order. When supplied, both headline and district counts use the same clipped entity cohort. A viewport summary intentionally omits the “densest street” signal until the street source can apply the same spatial clipping; it never labels a city-wide street as an in-view result.

The Atlas market summary includes additional cohort counts: precise point locations, records with a commercial-license value, wholesale-classified businesses, distinct high/medium-confidence specialties, and districts with reliable labels. WhatsApp counts require both the source marker and a valid Saudi mobile format; they are signals for review, not proof that a number is currently active on WhatsApp. All figures describe the available directory snapshot, not complete real-world coverage.

`GET /metrics` is authenticated like the rest of the service and emits Prometheus-compatible, low-cardinality counters and duration sums for API routes. It deliberately excludes search text, district names, POI identifiers, coordinates, and contact data.

`GET /healthz` is the public Railway readiness check. It returns `200` with `{"ok":true,"service":"farq-targeting"}` when the primary directory asset is readable and DuckDB responds to a minimal query; otherwise it returns `503`. It does not expose data or credentials.

## Startup data jobs

Jobs that read or write the mounted data volume run inside the service, because nothing else can reach it. Each is switched on by one environment variable, runs on a background thread after the server is listening, is skipped (`reason=inputs_unchanged`) when its version and the size and modification time of every input match its last successful run, and reports through the service log in aggregate form only. Unset the variable to make the next boot skip it.

- `FARQ_BUILD_BUILDING_POPULATION=1` runs `build_building_population.py`: dwellings per home building from `buildings_ingest/normalized/buildings.parquet` (flats, villas and unsurveyed homes by floor area, a share of administrative upper floors). District totals come from the 910ths reference where it lists the district, else from dwellings × the people per dwelling of the city's referenced districts, else from `buildings_ingest/population/official_city_population.csv` or the WorldPop city sum shared by dwellings. It writes `district_population_buildings_<year>.parquet`, `_report.json`, `building_points_<year>.parquet` (each home building with its dwellings and its share of the district's people, used by `/population-around`) and `district_growth_<year>.parquet` under `buildings_ingest/population/`, and logs the report as `building_population_done {...}`. `FARQ_BUILDING_ELEVATION_MODE` (`auto`, `height`, `floors`, `ignore`) overrides how `Elevation` is read.

## Canonical city and district names

At startup the service writes a canonical copy of `targets.parquet`, `trade_clusters.parquet` and `street_density.parquet` into scratch space (`canonical_data.py`) and serves every read from that copy; the mounted data directory is never modified. One English spelling per city (from the alias table shared with `services/data-cleaning/city_names.py`) with its Arabic name filled in, district labels matched to the official district atlas spelling with any «حي» prefix dropped, and values that are not district names at all (serialised objects, `False`, Latin street names) set to null with `district_reliable = false`. The copy is rebuilt only when a source file, the district atlas or `district_corrections.json` changes, and any failure falls back to the original asset. `FARQ_TARGETING_CANONICAL_DIR` chooses the scratch directory (default: the system temp dir, which is empty after every container start, so the copy is rebuilt before the server listens: about four minutes for the production directory). In production set it to a dedicated folder on the volume (`/app/data/.canonical`) so a restart reuses the copy and only a data release pays for the rebuild; nothing outside that folder is written. `FARQ_TARGETING_CANONICALIZE=0` serves the mounted files as they are.

## District reference (910ths)

`reference/districts_910ths.json` lists, per canonical district, the population, male and Saudi shares and average monthly income per working person published on the 910ths demographic map; `build_910ths_reference.py` builds it from a browse of that map and keeps a district only when the 910ths name equals the atlas name. `district_reference.py` applies it: `/population-districts`, `/population-demographics`, market gaps, territories and the district profile take the 910ths total and male share where it lists the district. WorldPop's male/female split comes from a regional table (every district of Riyadh reads 61.9% male), so outside the reference the split is served as unavailable (`null`) rather than as a district figure; the WorldPop totals and age shape stay.

The deployment's business directory and taxonomy assets are intentionally excluded from Git. A deployment requires a separately maintained, access-controlled `data/` directory containing the exact production assets listed in the `Dockerfile`. Do not substitute older local data files: the map counts and supplier coverage depend on the deployed snapshot.

Before connecting Railway deployments to this folder, verify the staged data asset versions and hashes against the approved production snapshot, then deploy a preview service and check its aggregate results against the current production directory. Never commit `.parquet`, `.geojson`, contact, evaluation, or operational log data here.

`market_analytics.py` shares the directory's open-record policy and taxonomy classification. It returns aggregate values only; it does not expose business names, contact details, or row identifiers. Buyer counts describe taxonomy-based typical purchasing, not confirmed intent or actual transactions. The WhatsApp aggregate requires both the source flag and a phone number in a supported Saudi mobile format; it does not independently verify that the number receives messages.

Unexpected failures in map read endpoints keep the existing `503 UNAVAILABLE` response and emit a structured `farq.targeting` error log with a fixed endpoint label, exception class, and a short source stack. Exception messages, request bodies, search text, locations, and directory data are deliberately omitted.

## Street scope options

`POST /search` with `objective: "browse"` returns `areas.streets`: every distinct directory street for the selected city, or for the selected district when `filters.district` is supplied. Each item contains `{name, district, n}`. The list deliberately ignores the current `filters.street` value so people can switch streets from the same picker. Counts are directory records and do not imply street-density coverage.

## Directory contact filters

For `/search` (including `objective: "browse"`), `/map-query`, and the resulting map tiles, an omitted or `all` `filters.contact` means **no contact-channel restriction**. This keeps the full eligible directory available for discovery and map analysis. `contact: "whatsapp"` requires both the source WhatsApp marker and a valid Saudi mobile number; `contact: "email"` restricts results to email. Browse and search remain paginated; map tiles aggregate locations at lower zoom levels.

Showing a directory record does not make it eligible for a WhatsApp campaign. The Atlas campaign sender re-resolves each selected `poi_key` against the directory and requires WhatsApp eligibility for template sends. For Atlas campaigns only, a missing status (`unknown_empty`) does not block sending; known closed, inactive, hidden, or invalid statuses remain blocked. Other send paths keep the stricter status policy. The `has_whatsapp` source flag is not independent verification that a number is active on WhatsApp.
