# Activity inventory (read-only, 2026-10-15)

Source: `targets.parquet`, byte-identical to the deployed targeting release (`/Users/m4pro/farq-targeting-b2b-release/data`). Closed and cancelled businesses are excluded. Activity = first value of `category`.

- Active rows: 1,933,848. Rows with an activity: 988,729 (51 %). About 49k more rows without `category` still have a google, secondary or Arabic category.
- Distinct activities: 5,247. The top 100 cover 84.7 % of rows with an activity, the top 300 cover 92.9 %, and the top 1000 cover 98.2 %. 467 activities have at least 100 rows.
- Mixed taxonomies: Hudhud-style English names (`Restaurants`) sit next to snake_case trade groups (`building_materials`) and near-duplicates (`Coffee Shops`, `Coffee shop`, `Cafe / Restaurants`).
- Some buckets are too coarse for buy/sell rules: `Corporate`, `Shopping`, `Home Goods`. They need `category_ar`, `secondary_category`, `google_category` or the business name.
- `category_ar` does not always match its activity (for example `equipment_rental` → «روافع هيدروليكية», `Saudi Post POI` → «مساجد»).
- Example coverage (keyword match across all category fields): plumbing 4,825 (1,761 with WhatsApp); gypsum 682 (96); roasteries and coffee beans about 901 (391); cafés 34,067 (12,221).

`activities-all.csv`: rank, activity, most common Arabic label, row count, WhatsApp, phone, e-mail, number of cities.
