# FARQ B2B release preparation

2026-10-13

## Scope
Public landing at /, existing authenticated login, Explore, purchase creation with selected businesses, request tracking/comparison/award, local sales opportunities and Account. Forest/lime identity, FARQ English with small B2B at bottom corner, ITF Huwiya Arabic, restrained glass buttons. Separate pricing checkout; construction frontend untouched.

## Evidence
- TypeScript, token lint and production Vite build passed. Lint reports warnings; not a warning-free build.
- 11 Playwright scenarios passed on 390px and 1440px: clinic chairs, wholesale selling, direct company name, empty recovery, landing/login and explicit purchase dispatch consent. Network mutations were mocked, never sent to real businesses.
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
- Map area action filters currently loaded search results; the UI discloses this. It does not perform a new spatial server query.
- Mobile bottom sheet has explicit mini/half/full controls; no drag gesture implemented.
- Mapbox is lazy-loaded but large; build reports a chunk-size warning.
- No live supplier-send verification was performed. Publication does not certify real WhatsApp/email delivery.
- Companion API draft PR remains unmerged; the specific API service was deployed directly to avoid unrelated construction frontend changes.

## Status
Published to https://pricing.farq.sa on 2026-10-13. API, pricing and targeting deployments report SUCCESS. Read-only production checks cover landing, authenticated requests/account, map, 20-chair review and supplier activity results, wholesale coffee potential buyers, direct company profile, and saved-draft recovery. Desktop 1440 and mobile 390 layout checks have no horizontal page overflow. Sales automation remains unavailable; local manual opportunities must not be described as cloud CRM or automated sales dispatch.

## Published artifacts
- API: `7ee24b4d-22a9-4984-9ede-7ae9b6ff3530`, source `cbc926eb2`. Previous deployment `98c67375-3c5d-4097-925b-cbc9431ef12c`.
- Pricing: `733a2d3f-5d74-4a5f-be35-2f8cf2e09447`, source `fab8851`. Previous release `14ca5dca-9089-401a-9d49-d159bab1fa9a`.
- Targeting: `6d2b0a09-a674-40d1-a40a-fbfaca8c7ce3`. Previous `7d58cb2d-b09f-4ef0-b248-a8c8799c0cb4`; immutable source hashes in targeting-release.json. Four supplier-role regression tests passed.
- Production chair search initially returned clinics; fixed known-family rule preservation, required seller evidence for AI-expanded purchase, removed coordinate-name artifact, and made category inference/availability limits explicit.
- Existing API/auth/Mapbox configuration preserved. SITE_URL corrected to pricing.farq.sa. Construction UI and other service deployments untouched.
- A tab open across bundle replacement needed reload to fetch new dynamic chunks; fresh page loading succeeded.
