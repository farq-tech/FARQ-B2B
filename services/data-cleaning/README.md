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
