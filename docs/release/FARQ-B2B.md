# FARQ B2B release preparation

2026-10-13

## Scope
Public landing at /, existing authenticated login, Explore, purchase creation with selected businesses, request tracking/comparison/award, local sales opportunities and Account. Forest/lime identity, FARQ English with small B2B at bottom corner, ITF Huwiya Arabic, restrained glass buttons. Separate pricing checkout; construction frontend untouched.

## Evidence
- TypeScript, token lint and production Vite build passed. Lint reports warnings; not a warning-free build.
- 11 Playwright scenarios passed on 390px and 1440px: clinic chairs, wholesale selling, direct company name, empty recovery, landing/login and explicit purchase dispatch consent. Network mutations were mocked, never sent to real businesses.
- Companion API: 3 focused GENERAL business request tests passed. Required correspondence verification passed backend, frontend and types with mocked providers.
- Existing SQL request-flow fixture fails on clean API main with missing suppliers.source_system; reproduced baseline. This does not establish SQL production integration success.
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
- No production deployment, merge or live supplier-send verification has occurred.

## Status
Implemented and locally tested. Publication and production integration remain unverified. Do not describe the entire requested sales automation as production-ready.
