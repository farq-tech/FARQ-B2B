# Atlas intent flows

The entry point presents five distinct jobs. Shared search, district selection, and map review keep similar tasks together without duplicating choices.

| Goal | Flow |
| --- | --- |
| Understand the market | Search an activity, compare its district and street presence, and review market density. |
| Choose an expansion site | Compare estimated residents with observed activity results by district, then inspect candidate areas on the map. |
| Reach new customers | Find buyer businesses, select a cohort, then save the list or prepare a campaign. |
| Find a supplier and request a quote | Search suppliers, select recipients, describe quote items, then follow responses in Inbox. |
| Plan distribution and coverage | Search customer locations, select a depot first and stops after it, then calculate a truck route and distance/time summary. |

## Road data

- The Drive layer index identifies the complete `All Roads` shapefiles under `خريطة_الطبقات/gis-platform/01_keep_base/roads/` for Riyadh, Jeddah, Makkah, Madinah, Dammam, and Khobar.
- The same index marks those shapefiles `routable=no`; they are source geometry, not a route-cost graph.
- The local Valhalla data at `/Users/m4pro/farq-valhalla/custom_files/valhalla_tiles` has 3,492 graph tiles. Its config enables `route`, `optimized_route`, `isochrone`, and `sources_to_targets`.
- Atlas calls Valhalla through the authenticated `/api/routing/*` proxy. When Atlas is hosted outside Railway, it must call a token-protected public gateway; the gateway then forwards requests to Valhalla over Railway private networking. Set `VALHALLA_ORIGIN` and `VALHALLA_GATEWAY_TOKEN` as server-only variables in Atlas and configure the same token on the gateway. Never expose the raw Valhalla service publicly.

The population comparison uses WorldPop 2025 estimates. It helps shortlist districts; route time comes from the Valhalla graph, and observed businesses are supplied by Atlas market search.
