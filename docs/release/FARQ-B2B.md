# FARQ B2B release preparation

2026-10-13

## Scope
Public landing at /, existing authenticated login, Explore, purchase creation with selected businesses, request tracking/comparison/award, local sales opportunities and Account. Forest/lime identity, FARQ English with small B2B at bottom corner, ITF Huwiya Arabic, restrained glass buttons. Separate pricing checkout; construction frontend untouched.

## Evidence
- TypeScript, token lint and production Vite build passed. Lint reports warnings; not a warning-free build.
- 13 Playwright scenarios passed on 390px and 1440px: clinic chairs, wholesale selling, direct company name, empty recovery, landing/login and explicit purchase dispatch consent. Network mutations were mocked, never sent to real businesses.
- Companion API: 3 focused GENERAL business request tests passed. Required correspondence verification passed backend, frontend and types with mocked providers.
- Updated the stale SQL fixture for current supplier columns and dispatch adapter. SQL GENERAL custom-requirement and existing request-flow regression passed (10 tests). This remains local SQL evidence, not a live supplier send.
- Screenshots: ../qa/b2b/. Screenshots are local/mock-data evidence, not production data validation.

## Release sequence
1. Review and deploy companion API branch codex/farq-b2b-api. It adds /api/construction/b2b/capabilities and guarded GENERAL request origin farq-b2b, keeping the four construction departments unchanged.
2. Confirm authorized buyer GET capability reports general_requests:true. Pricing blocks business creation if capability is missing.
3. Build pricing with existing API/auth environment and existing public VITE_MAPBOX_TOKEN. Never commit .env.local or secrets.
4. Deploy dist using the existing pricing.farq.sa deployment process, preserving SPA route fallback and /api routing. Do not deploy this bundle to construction.
5. Verify public landing, login, authorized read-only search, name search and existing request views in production.
6. Live messaging canary requires exact supplier, destination, channel, RFQ and message approval under backend AGENTS.md. No canary is implied by UI test success.
7. Rollback: restore previous pricing artifact and previous API revision together if business request regression occurs.

## Limitations
- Sales opportunities and manual quote drafts are browser-local, not cloud shared. Sales dispatch is unavailable; UI states this explicitly. Backend returns sales_dispatch:false.
- Account business defaults and purchase wizard drafts are browser-local per user.
- Map area action now filters the entire search/catalog query on the server. Authenticated MVT XYZ tiles cover every located result or every filtered catalog point, with grid aggregation at low zoom. Coordinates missing from the directory remain list-only.
- Match confidence is a heuristic name/activity score, not a calibrated probability of stock or purchasing intent. Institution/company type is name-derived, and registered brand locations are not independently verified branches. Business size is absent; the small-institution option is explicitly unavailable.
- Tile query contexts expire after 30 minutes. Refresh the layer or rerun search after expiry. Tiles are private, do not embed credentials in URLs and bypass shared HTTP caches.
- Mobile bottom sheet has explicit mini/half/full controls; no drag gesture implemented.
- Mapbox is lazy-loaded but large; build reports a chunk-size warning.
- No live supplier-send verification was performed. Publication does not certify real WhatsApp/email delivery.
- Companion API draft PR remains unmerged; the specific API service was deployed directly to avoid unrelated construction frontend changes.

## Status
Published to https://pricing.farq.sa on 2026-10-13. API, pricing and targeting deployments report SUCCESS. Read-only production checks cover landing, authenticated requests/account, map, 20-chair review and supplier activity results, wholesale coffee potential buyers, direct company profile, and saved-draft recovery. Desktop 1440 and mobile 390 layout checks have no horizontal page overflow. Sales automation remains unavailable; local manual opportunities must not be described as cloud CRM or automated sales dispatch.

## Published artifacts
- API: `7ee24b4d-22a9-4984-9ede-7ae9b6ff3530`, source `cbc926eb2`. Previous deployment `98c67375-3c5d-4097-925b-cbc9431ef12c`.
- Pricing: `d8a36e06-ff6e-4996-a70c-75253e8893ab`, source `eb1eb3d`. Initial directory UI release `e6f468dc-1431-4d08-9c58-9d65c5cd3a87`; previous B2B release `733a2d3f-5d74-4a5f-be35-2f8cf2e09447`.
- Targeting: `7efdedc3-5b5e-45c4-8da4-5a3760e14dd9`. Initial vector release `e5b94a6d-29a6-492c-821f-2c62b33a557b`; previous B2B service `6d2b0a09-a674-40d1-a40a-fbfaca8c7ce3`; immutable source hashes in targeting-release.json. Nine directory/tile/supplier-role regression tests passed.
- Production chair search initially returned clinics; fixed known-family rule preservation, required seller evidence for AI-expanded purchase, removed coordinate-name artifact, and made category inference/availability limits explicit.
- Existing API/auth/Mapbox configuration preserved. SITE_URL corrected to pricing.farq.sa. Construction UI and other service deployments untouched.
- A tab open across bundle replacement needed reload to fetch new dynamic chunks; fresh page loading succeeded.

## Directory enhancement verification
- 9 Python tests passed over the actual read-only Parquet directory: no ten-result cap, stable nonoverlapping pages, filters and name priority before pagination, query-scoped profiles, MVT counts across XYZ boundaries, no per-tile top-N truncation.
- 13 UI scenarios passed at 390px and 1440px, including 65 results across three pages, category/subcategory/company/literal-name filters and catalog map option. Browser tests use isolated fixture responses; live checks are recorded separately after deployment.
- Local authenticated HTTP search and MVT requests succeeded; unauthenticated facets and tile requests returned 401.
- Target source archive and SHA-256 manifest: targeting-vector-tiles-source.tar.gz / targeting-release.json.

### Live directory/map checks
- Porcelain query: 30 loaded of 1,750 inferred matches, 1,746 located. Name-priority option put the four businesses naming porcelain first and retained the semantic tail. This differs from the local deterministic result count because production has AI interpretation enabled.
- Full Riyadh catalog map: 693,595 filtered directory records, 648,552 located. Map tiled point/cluster layer rendered successfully; missing coordinates explicitly counted as list-only.
- Shopping/company/multiple registered locations: 732 results, 60 loaded successfully across two pages.
- Individual MVT point opened its query-scoped business profile and focused map ring. No supplier communications or business requests were submitted.
- Service replacement expired in-memory query contexts; the visible Refresh Layer action recovered successfully.
- Direct targeting and pricing-proxy unauthenticated facets/tile paths returned 401. Desktop and mobile document widths do not overflow.

- Final published screenshot: docs/qa/production/vector-tiles-desktop.png (732 filtered located records; catalog title and vector clusters visible). Temporary browser viewport restored after capture.
