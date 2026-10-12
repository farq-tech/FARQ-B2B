# Supplier trial service

This module adds authenticated `/trial-search` to the existing farq-targeting service. The pricing server exposes only its sanitised top ten through `/_trial/search`.

Run isolated tests (requires the existing duckdb dependency):

    python3 services/targeting-trial/test_trial_search.py
    python3 docs/qa/trial/test_trial.py

The fixture Parquet is synthetic and temporary. The local benchmark reads the existing supplier directory in place; it does not copy it to a test environment or change it.

`integration.patch` records only the import, dedicated read endpoint, Docker copy and upload allowlist. `baseline.sha256` identifies the production server fetched read-only through Railway SSH; it matched the local source before changes. Existing search/send/RFQ endpoints are unchanged.

Common product families use business name/category evidence, city isolation, exclusions, deduplication, contactability and ranking by category specificity/wholesale evidence/data completeness. Quantity and buyer activity never become seller categories. Unknown products use lexical matching with at most one four-second bounded intent call using the service's existing model configuration; on failure, honest lexical results or empty results are returned. No fake rows, stock claims or endorsement claims. Results are cached for five minutes, capped at 128 searches; private contact fields never leave this module.
