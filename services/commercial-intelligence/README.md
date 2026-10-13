# Commercial intelligence — isolated review

This is a shared **read-only review** service. It never creates RFQs, sends correspondence, changes production records, or treats source observations as merged legal companies.

## Local run

Use Python 3.9+ and the installed Node runtime. Install the existing project dependencies for the Vite review page. The CPO source must be an existing Farq Construction `api` directory; no ontology is copied into this service.

```sh
FARQ_COMMERCIAL_INTELLIGENCE=1 \
FARQ_GEO_CANDIDATE=/absolute/path/saudi-unified-candidate.geojson \
python3 services/commercial-intelligence/server.py \
  --db /absolute/path/knowledge.db \
  --node /absolute/path/node \
  --construction-source /absolute/path/farq/api
VITE_FARQ_COMMERCIAL_INTELLIGENCE=1 npm run dev -- --host 127.0.0.1 --port 5194
```

Open `/commercial-review`. The local header `X-Local-Review-Actor` is a rehearsal scope, **not production authentication**. Default flag-off returns 404. This page is excluded from production builds.

Construction adds an authenticated owner-only `/api/construction/commercial-intelligence/review` adapter. Set `FARQ_COMMERCIAL_REVIEW_OWNERS` explicitly for isolated test owners. It is permanently disabled when `NODE_ENV=production`, accepts loopback origin only, and derives the scoped actor from existing authorization.

## Repeatable import/export

`build.py --help` lists explicit source inputs. It opens registry read-only, writes an atomic derived database, preserves source IDs and records source size/mtime. Never point its output at a source file. Run supplementary/contact/geo/triage/demand overlays **sequentially** on the derived database. All overlays use stable keys and can be rerun; rerunning `build.py` replaces only its own derived database, so overlays must then be reapplied.

`evaluate.py --help` runs 20 real/adversarial goals, 20 reproducibly sampled catalog cases, five source-sector probes and 20 warm repeats. Use the same geographic alias source as the server. `export_package.py --output /absolute/review/output` writes the delivery CSVs from a read-only database connection.

```sh
python3 -m unittest discover -s services/commercial-intelligence -p test_core.py
FARQ_CONSTRUCTION_SOURCE=/absolute/farq/api node --test services/goal-foundation/tests/construction-reuse.test.cjs
```

## Evidence contract

- SG identifiers are snapshot aliases, never ownership anchors.
- Exact name + host produces a review candidate, not a legal merge.
- Saved page presence does not prove branch stock, delivery, legal ownership, or current contact validity.
- `direct` requires product + identity + relationship gates. Current public demand verifies publication only; eligibility and exact specifications remain separate.
- Historical retail prices do not establish wholesale supply.
- Marketing activity candidates do not establish willingness to purchase; proven-only mode suppresses them.
- Partners require relationship evidence; seller results are not inverted into partner results.
- Private evidence requires matching review scope in BOTH evidence and relation retrieval.
- VERIFIED exports remain empty if gates are unmet. This is intentional.
- Independent Precision@5/10 remains null until blinded human review; automated tests are not human quality measurements.

No production migration is supplied. The output DB and review-key file are local restricted artifacts, excluded from Git; the human reviewer receives the blinded file without its key.

## PRAGMATIC mode (independent flag)

Set `FARQ_PRAGMATIC_MATCHING=1` on the local shared service; `NODE_ENV=production` disables it. Default strict behavior remains available. A/B are commercial recommendations, C/D expansion. X is excluded. `verified` remains false unless its separate gates are met. Scores use 40/20/15/10/10/5 experimental weights, not a trained model. Missing phone does not veto a source-supported product. Contacts come only from the same saved public source profile; no SG inheritance. No branch or delivery geocoding is borrowed from unresolved identities.

Run `commercial_profiles.py` then `catalog_source_links.py` against the owned derived DB. Their receipts record source profiles, source-owned contacts, and structured catalog candidates. `enrichment_ledger` is an idempotent dry-run queue with a maximum one-call field per stable source-profile ID; approved budget is zero and no Serper implementation is called. Existing approval of a one-company two-credit run does not authorize this queue.

Golden directory read-only expansion: set `FARQ_GOLDEN_DIRECTORY` to the original `golden_pois_ksa.parquet`. The reader reuses the pure `interpret`, `evidence` and `buyer_intent` functions from existing Targeting; it does not import its network/model module. Stable original poi_key is required. C-layer results expose source activity, never assert product stock/current buying. The optional FARQ_GOLDEN_INDEX is a minimal derived SQLite retrieval index over original poi_key, names, activities, source geography and contact-presence flags; it copies no phone/email values. When enabled, marketing uses this wider indexed directory instead of the older activity scan.

Response cache: actor-scoped, derived-input mtime/size invalidation, 30-second TTL, maximum 100 entries. Cold queries and warm cache hits are reported separately; the cache is not evidence of faster uncached retrieval. First local request remains around 4.4 seconds in the current measurement.

Delivery: `deliver_pragmatic.py --root /absolute/output` exports recommendations with evidence, a randomized blinded review CSV and a separate system key. Human quality remains pending. Ranking is experimental and does not measure actual consumption or demand.

## Riyadh specialty coverage

`riyadh_coverage.py --db DERIVED_DB --node NODE --source EXISTING_CPO_API --index DERIVED_GOLDEN_INDEX --geo RECOVERED_GEO_JSON --output NEW_OUTPUT_DIR` exercises 14 product/service families in both directions through the shared core. Inputs are read-only and size/mtime checked before and after. Top lists require a recorded Riyadh city and contain at most ten candidates; no padding. Missing city sources remain separate. It writes a detailed Arabic report, ranked evidence CSV, source-conflict exclusions, JSON receipt, blinded review packet and separate rank key. No provider/model requests, paid enrichment or messages are invoked.

Activity conflicts are conservatively quarantined during retrieval, without correcting the source. These rules can abstain from legitimate diversified firms and do not fix every bad category. Named activity, product-level selling proof, current demand and independent validation remain different dimensions. Results are experimental rankings, never measured consumption or actual willingness to buy.

Explicit `direction=activity` searches recorded activity without requiring selling or demand evidence. Results are organizations with no inferred buyer/seller role. Pagination uses `offset`, page `limit` and uncapped `total`/`next_offset`; SQL counts all eligible activity matches without the former 3,000 retrieval ceiling. The local UI shows total and continuation. Six common literal activity aliases assist Arabic/English discovery; other activity phrases use literal matching, not a closed product whitelist. This is source-record discovery, not a verified census of Saudi businesses. Role-specific product searches retain their separate evidence-ranking semantics and bounded review sampling.
