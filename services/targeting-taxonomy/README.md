# Taxonomy search (targeting service)

Turns a free-text request into: product family → sells or buys relation → subcategories → directory rows. The targeting page already calls `/search` with `objective` set to `purchase` (I want to buy, so show sellers) or `marketing` (I sell, so show likely buyers). This module answers that same call when it understands the text. Otherwise the existing search answers, unchanged.

- `taxonomy_search.py`: the engine. It reads the directory and never writes to it.
- `test_taxonomy_search.py`: 9 tests (`python3 services/targeting-taxonomy/test_taxonomy_search.py`).
- Data it needs, from `docs/qa/targeting/taxonomy/`: `farq_taxonomy.json`, `product_families.csv`, `sub_family_relations.csv`, plus `poi_taxonomy.parquet` (built by `rowlevel/classify_rows.py`).

## How a request is understood
1. Product words are matched against family names, examples and a short alias list. Arabic prefixes are handled carefully: «بورد» stays «بورد».
2. Business types named in the text («محلات سباكة», «شركة نظافة») win when the user asks for shops or suppliers.
3. Sellers can name their customers («أبيع زي موحد للمطاعم»), and only those customers are returned.
4. A loose one-word match, or text with no match at all, can ask the model (`ANTHROPIC_API_KEY`, one bounded call of at most 6 s) to pick family ids. With no key, the old search answers.
5. Non-commercial and unclassified places are never returned.
6. Every buyer row says «احتياج الشراء غير مثبت». Every seller row says that availability and price need confirming.

## Integration into farq-targeting (not applied; needs the owner's «انشر»)
1. Copy `taxonomy_search.py` next to `trial_search.py`. Copy the four data files to `data/taxonomy/` (three files) and `data/poi_taxonomy.parquet`.
2. Dockerfile: add `taxonomy_search.py` to the first COPY, and `COPY data/taxonomy ./data/taxonomy` and `COPY data/poi_taxonomy.parquet ./data/`. Set `TAXONOMY_DIR=/app/data/taxonomy` and `POI_TAXONOMY=/app/data/poi_taxonomy.parquet`, or keep the module's default paths.
3. `trial_search.py`, at the top of `Directory.search`, right after the pagination check:
   ```python
   import taxonomy_search
   hit = taxonomy_search.directory_search(self, q, city, objective, limit, offset, filters)
   if hit is not None: return hit
   ```
   The result has the same shape as the existing search (`rows`, `total`, `understood`, `_map_rows` via `page`), so `server.py` and the page need no change.
4. Re-run the service tests and this module's tests, then check a few requests against the real data before any deploy.
