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

`evaluate.py --help` runs 12 real/adversarial goals, 20 reproducibly sampled catalog cases and 12 warm repeats. Use the same geographic alias source as the server. `export_package.py --output /absolute/review/output` writes the delivery CSVs from a read-only database connection.

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
