# Farq Atlas entity identity and duplicate policy

The Golden release assigns every retained business one deterministic `farq_atlas_id` (`FA-` plus a SHA-256 prefix derived from its canonical source `poi_key`). Identifiers do not depend on row order and are distinct from source IDs and taxonomy codes.

Automatic merges are limited to strong identity evidence:

- repeated exact Google Place IDs only when city, near-identical point coordinates, names, known Farq subcategory, phone, legal name, floor, building number, license values, and lifecycle fields do not conflict;
- rare exact normalized Arabic or English names at the same exact precise point, in the same city, only when those same known fields are consistent.

Approximate locations, common names (more than 50 source rows), and any group with conflicting known identity fields are kept separate. Missing values do not prove identity. We do not merge on commercial-license ID alone, source category codes, or fuzzy name similarity.

Merged rows retain their original keys in `merged_source_poi_keys`. The `source_to_farq_atlas_id.parquet` crosswalk preserves every pre-merge key and resolves it to one canonical key and Farq Atlas ID, so saved links and profiles continue to resolve. Taxonomy rows are collapsed through this same canonical identity, with the strongest existing confidence retained.

## Staged verification (2026-10-25)

- Input Golden: 2,713,267 rows.
- Automatic merges: 54,942 groups covering 110,288 source records; 55,346 excess rows removed.
- Final directory: 2,657,921 rows, 2,657,921 unique `poi_key` values, and 2,657,921 unique Farq Atlas IDs; zero ID collisions and zero invalid coordinates.
- Crosswalk: all 2,713,267 input keys resolve; canonical keys and IDs agree with the final directory.
- Taxonomy: 2,472,191 rows, zero orphan POIs, and every used subcategory exists in the Farq taxonomy.
- Audit withheld 22,319 common-name groups and groups with conflicting identity evidence; the per-reason counts overlap and must not be summed.
- The immutable candidate release is staged on the existing service volume at `/app/data/releases/atlas-2026-10-25-v4-identity`, release ID `59197b1c113279705f4b1421672d685f0efc4c3948328de4a9d1cd00848d281c`.
- Live `/app/data/targets.parquet` and `/app/data/poi_taxonomy.parquet` still match their pre-build SHA-256 fingerprints. The candidate has not been activated.

The full production Golden remains unchanged until the candidate passes row/key/ID uniqueness, crosswalk coverage, taxonomy referential integrity, coordinate, release-manifest, and application checks.
