# Golden directory + taxonomy search — deploy of 2026-10-16 (owner: «انشر موافق»)

Service: Railway project farq-targeting, service c3390278…, deployed with `railway up` from `/Users/m4pro/farq-targeting-b2b-release`
(not a git repo — this folder archives the change). Backup of the previous release: `/Volumes/Archive/backups/farq-targeting-b2b-release_before_golden_2026-10-16`.

Changes in the release folder:
- `data/targets.parquet` ← `export/targets_golden.parquet` (golden set, 2,250,123 targetable rows), re-written sorted by city/subcategory with zstd level 19 (199 MB → 124 MB; same rows, keys, phones, subcategories — checked) because Railway refuses uploads over ~200 MB.
- `data/poi_taxonomy.parquet` ← `export/poi_taxonomy_golden.parquet` (zstd 19, 21 → 8 MB).
- `data/taxonomy/` ← farq_taxonomy.json, product_families.csv, sub_family_relations.csv, saudi_market_terms.csv, search_lexicon.csv.
- `taxonomy_search.py` ← `services/targeting-taxonomy/taxonomy_search.py`.
- `trial_search.py`: the taxonomy hook at the top of `Directory.search` (trial_search.patch).
- `Dockerfile`: copies taxonomy_search.py, data/poi_taxonomy.parquet and data/taxonomy (Dockerfile.patch).
Service tests (tests/*.py) and the taxonomy tests passed before upload. Send policy unchanged (verified WhatsApp only).
Rollback: copy the backup folder back and `railway up`.
