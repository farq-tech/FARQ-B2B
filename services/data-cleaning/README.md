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
