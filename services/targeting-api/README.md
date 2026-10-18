# Farq Targeting API source

This directory tracks the Python service source used by the opportunity map. It includes the read-only aggregate endpoints consumed by `FARQ-B2B`:

- `POST /market-summary`
- `POST /district-counts`
- `POST /district-insights` — selected districts with aggregate activity mix, dominant and least represented activities, and city activities without a classified district record. Missing means not recorded in the directory, not confirmed absent in reality.
- `POST /who-buys`

The deployment's business directory and taxonomy assets are intentionally excluded from Git. A deployment requires a separately maintained, access-controlled `data/` directory containing the exact production assets listed in the `Dockerfile`. Do not substitute older local data files: the map counts and supplier coverage depend on the deployed snapshot.

Before connecting Railway deployments to this folder, verify the staged data asset versions and hashes against the approved production snapshot, then deploy a preview service and check its aggregate results against the current production directory. Never commit `.parquet`, `.geojson`, contact, evaluation, or operational log data here.

`market_analytics.py` shares the directory's open-record policy and taxonomy classification. It returns aggregate values only; it does not expose business names, contact details, or row identifiers. Buyer counts describe taxonomy-based typical purchasing, not confirmed intent or actual transactions. The WhatsApp count reflects the source flag, not independent verification.
