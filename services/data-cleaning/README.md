# Data cleaning (free, read-only on the directory)

Outputs go to `/Users/m4pro/farq-taxonomy-data/`. Nothing in the directory is changed or deleted; every row keeps its key.

1. `city_normalize.py` → `poi_city.parquet` (one canonical city per row, with the method used).
   - 925,592 rows: English and Arabic agree. 905,605 rows: English only.
   - 54,280 rows: English and Arabic name different cities; the closer city centre wins.
   - 921 rows: Arabic only. The service's English-only city filter could not find these rows before.
   - 47,444 rows have no city and, apart from 55, no coordinates either. They are left empty, never guessed.
2. `dedupe.py` → `poi_groups.parquet` (`group_id`, `is_primary`, `size`) and `group_contacts.parquet` (each member's missing phone, website or e-mail filled from its group).
   - A link means either the same non-generic name within 150 m, or the same phone with a shared name prefix within 1 km.
   - Result: 1,813,646 rows with coordinates form 1,695,831 businesses. There are 90,699 duplicate groups covering 208,514 rows, so 117,815 rows are extra copies.
   - 32,089 rows gain a phone from another row in their group.
3. `neighbour_hint.py` → `neighbour_hints.parquet`. A low-confidence hint for unclassified rows: at least 3 classified neighbours within about 30 m, and at least 70 % of them in one subcategory. It never overwrites the classification.
   - Result: 8,136 hints, of which 2,894 have 90 % or higher agreement. The most common are furniture, restaurants, schools, spare parts and vegetable markets.
4. `import_archive11.py` → `enrich/` layers from the owner's reference files (Archive 11):
   - Brand branches: 16,302 rows, all matched by hudhud id.
   - Brand-name classification: 51,771 rows.
   - Google (GMB) matches: 147,366 rows, of which 1,202 are permanently closed and 5,743 temporarily closed.
   - Curated contracting suppliers: 2,456 rows, 138 of them qualified.
5. `lake_gap.py` compares the local KSA entity lake (`/Users/m4pro/ksa-entity-lake`, 4.41 M entities from 12 sources incl. 2GIS «Firms with Coordinates», trade-licence firms, TRX, atlas, golden, registry) with the directory:
   - 2,761,651 lake entities match a directory row; **1,166,534 do not**. Of those, 106,469 have a mobile and 505,020 have a category.
   - The lake fills a missing number for 99,346 directory rows (61,046 of them mobile), now included in `contacts_overlay.parquet`.
6. `import_cleaned_data.py` imports «cleaned_data (3)» (69,122 rows). 44,458 match a directory row; their extra fields are in `enrich/cleaned_data_attrs.parquet`: company size band (27,358 rows, 2,080 of them with 16+ employees), branches, legal name, Makani, address, payment methods, socials and hours. 24,664 rows are not in the directory (`cleaned_data_new.parquet`).
7. `candidates_gap.py` compares «master_poi_candidates.csv» (Drive, 1,917,110 rows from 6 sources) with the directory and the lake.
   - Final_Mecca (716 k rows) has no coordinates, so it cannot be placed. About half of ready_pois_enriched has Arabic names saved as «????»; for those rows the English name, phone or TRX id is used instead.
   - 1,147,073 rows have Saudi coordinates. 999,565 of them are already in the directory and 147,508 are not; 123,474 are not in the lake's new set either (full_data_26_7_2025: 119,911, of which 113 k have a category).
   - The file fills a missing number for 8,777 directory rows (now in the contact overlay).
8. `import_hudhud_logs.py` reads the HudHud surveyor export of 2025-08-28 (CRs = change requests, TRX = transactions, POI logs = 361,137 edits). TRX id = the directory's `hh:` key.
   - `enrich/hudhud_logs_status.parquet`: latest log per directory row (230,581 rows) with operation, review status, editor and date, plus `duplicate_of` (313 rows).
   - **76,283 directory rows have an approved delete as their latest HudHud log**, and 676 more have a delete pending. Most are still `open` in the directory, and 21,579 of them have WhatsApp. They are flagged, never removed. The export does not say why each POI was deleted (closed or duplicate).
   - `enrich/hudhud_cr_contacts.parquet`: 692 change requests with their last phone (442), website, e-mail, Instagram, licence number (49) and national address.
9. `build_new_entities.py` → `golden/new_entities.parquet`. 1,314,672 rows not in the directory (lake new set, master_poi_candidates, cleaned_data) collapse to **1,238,937 unique new businesses** (same phone within 2 km or same non-generic name within 150 m). They are classified by the same engine (`CLASSIFY_INPUT=… classify_rows.py`) → `golden/new_taxonomy.parquet`: 786,595 have a real subcategory, 569,508 of them high or medium confidence.
10. `build_golden.py` → `golden/golden_set.parquet` + `completeness_report.json`. One row per business, 3,172,785 rows in total (1,933,848 directory + 1,238,937 new), with every layer joined: subcategory, sector, normalised city, best phone with its source, socials, company size, legal name, Makani, brand, Google categories, rating and closure, HudHud delete, curated supplier and duplicate group. Keys are asserted unique.
   - Nothing is dropped. `exclude_reason` records why a row is not targetable: no name 281,861; non-commercial 196,496; no location 120,171; duplicate copy 112,361; HudHud deleted 76,283; vacant unit 20,617; Google permanently closed 674.
   - **Golden (targetable, de-duplicated): 2,364,322.** Of those, subcategory is set for 1,807,934 (1,249,235 high or medium), city for 2,109,238, any contact for 439,592, phone for 408,896, mobile for 278,826 and WhatsApp for 190,785. **371,838 rows are complete on all five checks** (name, subcategory, location, city, contact). The main gap is contact (1,924,730 rows), then subcategory (556,388), then city (255,084).
11. `import_archive13.py` (Archive 13):
   - `enrich/hudhud_trx_state.parquet`: final state of 751,457 HudHud transactions after cleaning («draft_full_datav»), of which 92,415 are deleted. The golden set now treats a row as deleted when either the logs or this file say so: **101,541 rows excluded as HudHud-deleted**.
   - `enrich/google_batches.parquet`: 34,067 Google-scrape rows (batches 2–4) with the manual review of the LLM-normalised names (25,507 good, 5,569 bad). 21,434 have a phone and 8,648 match a directory row by TRX id or phone. Their phones join the contact overlay.
   - Golden after this step: 2,350,303 targetable rows, 365,029 complete on all five checks.
12. `infer_place.py` → `golden/place_fill.parquet`. A missing city or district takes the most common value of the known points in the surrounding 3×3 cells (about 5 km cells for city, about 500 m for district). It is kept only with at least 60 % agreement and 3 or more known points, and is marked `city_method / district_method = neighbours`. Across all 3.17 M rows this fills 299,330 cities and 424,018 districts.
   Classifier: TRX-style labels (`{'name_en': 'Restaurants'}`) and Arabic labels in `category` are now read, raising classified new businesses from 786,595 to 856,350. What stays unmapped is mostly uninformative (SERVICES 80,738, UNAVAILABLE 23,617, «غير محدد», Corporate, Shopping).
   Golden (now six checks, district added): 2,348,740 targetable rows. Name and location are set for all of them, city for 2,306,011, district for 1,622,297, subcategory for 1,797,095 (1,255,468 high or medium) and any contact for 432,332. **371,448 rows are complete on all six checks.**
13. `fill_names.py` → `golden/name_fill.parquet`. A missing Arabic or English name is taken only from another source of the same business: the lake's source rows for the matched entity, duplicate-group members, or Google-batch names reviewed as good. Nothing is translated. In the golden set this filled 180,800 English names (162,282 still missing) but only 8,981 Arabic names (1,279,233 still missing), because those businesses only ever appear with English (machine-translated) names. Districts are still missing mostly in the big cities (Riyadh 217 k, Dammam 208 k, Mecca 158 k, Medina 56 k); the fix is the district polygons on Drive.
14. `assign_districts.py` → `golden/district_official.parquet`. Point-in-polygon against `farq-poi-atlas.gpkg` (777 MOMRAH neighbourhoods with Arabic and English names, plus 6 city outlines: Riyadh, Jeddah, Mecca, Medina, Dammam, Al Khobar). 2,100,705 points get an official district.
    The golden set now prefers the official boundary, then the source value, then neighbours (`district_method`, `city_method`). Districts missing in the golden set fell from 726,443 to 363,185, mostly points outside the 6 outlines (the Dammam metro area, Riyadh suburbs, Mecca outskirts) and smaller cities. **389,894 rows are complete on all six checks.**
15. `import_eastern_cards.py` → `enrich/eastern_cards.parquet`. Eastern Province 2GIS/Urbi cards (2024-01, 64,335 firms): SynCode, 2GIS categories, administrative district (AR/EN), trade-licence flag. They join through SynCode = the lake's `business_id`, matching 54,295 rows, of which 52,576 get a subcategory from their 2GIS category and 53,268 get a district.
    In the golden set a 2GIS category replaces only a missing, unclassified or low-confidence subcategory (`urbi_category`), and its district fills only a missing district (`urbi_admin_district`). Golden now: subcategory 1,809,646 (1,275,802 high or medium), district missing 350,972, **390,727 rows complete on all six checks**.
