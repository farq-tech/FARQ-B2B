# Farq Golden Set v1

This is a staged, server-side Golden output built from the live Atlas target and the uploaded coordinate/license source files. It does not replace `/app/data/targets.parquet` and is not a production release. Farq's commercial data rights were confirmed by the owner during this task.

## Build

Run on the existing Railway `farq-targeting` service:

```sh
PYTHONPATH=/tmp/farq-audit-libs python /app/data/buildings_ingest/build_farq_golden.py
```

The script writes:

- `/app/data/buildings_ingest/golden/farq_golden_v1.parquet`
- `/app/data/buildings_ingest/golden/farq_golden_v1_report.json`

The production input SHA-256 is recorded in the report. Original Atlas columns and values are preserved; exact-ID source fields are added as separate provenance columns.

## Verified output

- 2,271,487 live Atlas rows copied.
- 219,889 existing rows receive exact coordinate/license source provenance fields through `urbi_coords:<SynCode>` = `card_id`.
- 441,780 new rows appended using a valid coordinate, visible source record, exact `SynCode` = `card_id`, and a usable source or license name.
- 2,713,267 total rows and unique `poi_key` values.
- All 2,713,267 rows have valid coordinate pairs.
- Existing `name_ar`, `name_en`, coordinates, and `company_status` were checked unchanged.
- Added candidates have `company_status=unknown`; no status is inferred from source visibility or license expiry.
- License source duplicates conflict only in `PartnerName` (4,122 card IDs); the conflicting partner values are blanked in the Golden output.

## Added source fields

`golden_match_method`, `golden_match_confidence`, `source_coordinate_id`, `source_coordinate_name`, `source_coordinate_partner_name`, `source_project`, `coordinate_source`, `source_license_name`, `source_trade_license`, `source_license_type`, `source_license_end_date`, `source_legal_form`, `source_license_partner_name`, and `license_source`.

## Scope and release limits

This is the verified entity core, not yet the complete Atlas analytical package. Population is an independent district layer at `/app/data/buildings_ingest/population/district_population_2025.parquet`; it must be joined by a validated district key, not a guessed name. Roads remain a routing/network layer and are served through the existing Valhalla service. The full FSQ source is absent from this server. Other exact-ID enrichment layers and the source-based classification extension are being added in the next Golden release.
