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

## 2026-10-16 (2) — owner: show only places with WhatsApp; show all results; sending on
- `directory_tiles.py`: `WHATSAPP_ONLY = True` — '' and 'all' contact filters mean WhatsApp-only for search, map and browse (directory_tiles_whatsapp_only.patch). A place appears as soon as its WhatsApp is in the directory.
- Export: `has_whatsapp` also true when the Farq supplier gave a WhatsApp number (190,756 rows).
- pricing `/targeting`: 200 rows per server page and «حمّل أكثر» appends the next page (was 10 rows).
- pricing service variable `TARGETING_SEND=1` set on the owner's explicit request («فعل الارسال»). Service eligibility unchanged: open/temporarily closed + WhatsApp (source flag accepted since 2026-10-15); the Meta template must be approved.

## Note 2026-10-16 (later)
staging-targeting/data/*.parquet were symlinks into the release folder; copying the specialty export into staging overwrote
the release folder's data (nothing deployed). Staging now holds real copies of the specialty export (2,271,487 rows, specialty columns).
The release folder was restored to `export/targets_golden_z19.parquet` (2,250,123 rows, 188,777 WhatsApp) — the live service was
deployed from a later export with 190,756 WhatsApp, whose exact bytes were not kept. The live service is unaffected; the next deploy
should ship the staging export, which includes the Farq-supplier WhatsApp numbers.

## Deploy 2 — specialties (owner «انشر», 2026-10-16)
Staging → release: specialty-first search with category fallback, POST /suggest-specialties (auth required), delivery-radius `site`
filter, data/taxonomy/specialties.csv, export with specialty columns (2,271,487 rows, 190,756 WhatsApp, 483,692 with a specialty).
Tests: taxonomy_search 15 OK, staging tests 9 OK. railway up → Deploy complete, health 200, container started cleanly.
Backup of the previous release: /Volumes/Archive/backups/farq-targeting-b2b-release_before_specialties_2026-10-16.
