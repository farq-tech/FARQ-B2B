# Population opportunity signal

Atlas reads WorldPop 2025 modeled population totals from the existing Farq targeting service. The raster and the district-level output stay on the shared server data volume; the browser receives only the selected city's district aggregates.

## Source and aggregation

- Source raster: `sau_pop_2025_CN_100m_R2025A_v1.tif` (WorldPop R2025A v1, EPSG:4326, 3 arc-seconds; about 100 m at the equator).
- Neighborhood boundaries: the official district polygons already served by Atlas, joined by exact district ID.
- Each raster cell is assigned to the district containing its center. NoData cells are excluded; the estimate, valid-cell coverage, source, and license are stored on the server in `buildings_ingest/population/district_population_2025.parquet`.
- The targeting API exposes city-scoped district aggregates through authenticated `GET /population-districts?city=...`; the browser proxy allows the same read-only call.
- Rebuild the server-side dataset with `services/data-cleaning/build_population_districts.py` when the raster or official boundaries change. No population records are bundled into the Atlas web application.

## How Atlas presents it

After a user chooses or searches an activity, the expansion panel compares each mapped district's estimated residents with the number of same-activity establishments reported by Atlas. Districts with less than 50% raster-cell coverage are withheld from the ranking; coverage is shown for each displayed district. It ranks by residents per observed establishment. This is an exploratory screening signal; it is not a demand forecast, a claim that other districts have no competitors, or a substitute for sales, rent, accessibility, and daytime-population data. Establishment coverage affects the ratio.

WorldPop describes these as constrained population estimates per grid cell, rather than person-level census records. See [WorldPop Population Counts](https://hub.worldpop.org/geodata/listing?id=135).
