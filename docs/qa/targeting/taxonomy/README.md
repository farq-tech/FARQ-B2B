# Farq activity taxonomy (2026-10-15)

- `farq_taxonomy.json` / `.csv`: the owner's taxonomy. It has 25 main categories and 431 subcategories, with roles (wholesale, retail, service, end_user), ISIC4 codes and match hints. `build_taxonomy.py` generates both files.
- `activity_map.csv`: maps every raw directory activity (all 5,247 first values of `category` on active rows) to exactly one subcategory. Each row has a confidence (high, medium or low) and an optional note.

How the map was made: each label was judged in-session against the taxonomy, in 8 parallel batches, with no paid or external service. The output was validated (every id exists, every activity mapped exactly once), and the largest activities were reviewed by hand.

Coverage by directory rows (988,729 rows with an activity):
- high 51.3 %, medium 13.0 %, low 35.7 %.
- Low is mostly the broad source buckets: Corporate (66,933), Automotive Services, Shopping, Hotels and Accommodations, Education, Beauty and Spa, Home Goods, Public Services, Transportation, Food and Beverages. These need row-level classification from the business name and secondary or google categories (next step).
- Numeric codes (19, 8, 23, 16, 11, 22, 1 …) are source top-level ids. They are mapped through their Arabic bucket label (19 = الشركات, 8 = التسوق, 23 = احتياجات المنزل, 16 = خدمات السيارات, 11 = التموينات, 22 = الجمال والعناية, 1 = مطاعم).
- 416 of 431 subcategories are used. The 15 unused ones have no directory activity yet, which marks a data gap.

## Row-level classification (2026-10-15)

`rowlevel/classify_rows.py` (with `rowlevel/name_rules.py`) assigns every active directory row one subcategory. It reads the directory without changing it and writes `/Users/m4pro/farq-taxonomy-data/poi_taxonomy.parquet` (`poi_key, sub_id, source, confidence, evidence`). That file is kept outside the repo and outside the targeting deploy folder on purpose.

Order of evidence:
1. The row's activity, when the map gives high or medium confidence.
2. The secondary, Google or Arabic category label, when it matches a confident activity label.
3. Keywords in the business name. Arabic is tried first, because `name_en` is sometimes another entity's name. A specific trade word in the name beats a noisy secondary label.
4. Otherwise the low-confidence activity mapping, or `unc.unknown`.

Results across 1,933,848 rows:

| | before | after |
|---|---|---|
| rows with a real subcategory (any confidence) | 852,000 (activity only) | 1,444,481 (75 %) |
| rows with a real subcategory, high or medium | about 636,000 | 1,098,155 (57 %) |
| rows with no usable signal | | 452,618 (name has no trade word, no category) |

- `Corporate` (66,933): 45,968 rows reclassified from name or labels; 20,965 stay as company with unknown activity.
- `Shopping` (48,243): 35,514 rows reclassified; 12,728 stay as shop with unknown activity.
- Rows with WhatsApp: 221,313 of 250,286 now have a commercial subcategory.
- Spot checks (random samples of about 40 rows per source) put name-based medium rows at roughly 90 % correct. The secondary-label source was noisier, which is why name words override it.

## Product families and sells/buys (2026-10-15)

- `product_families.csv`: 350 product families in 29 groups (263 goods, 87 services). Each has Arabic and English names and 3 to 6 example items, used to match free text such as «حبوب قهوة» or «جبس بورد».
- `sub_family_relations.csv`: 5,136 rows of `sub_id, relation (sells|buys), family_id, strength (core|common)` covering all 427 non-«unc» subcategories.
  - Drafted in 4 parallel in-session batches, then validated: ids exist, there are no duplicates, every commercial sub sells something, and every sub buys something.
  - 18 families had no seller and were filled by hand.
  - The coffee relations were corrected by hand: cafés buy beans and do not sell them; supermarkets, wholesalers and spice shops also sell coffee.
- Example answers (rows classified with high or medium confidence, from `poi_taxonomy.parquet`):
  - Who buys coffee beans: cafés 44,011 (11,552 with WhatsApp), hotels 12,385, roasteries, hookah lounges, restaurants and supermarkets.
  - Who sells gypsum board: 1,042 gypsum shops (84 with WhatsApp).
  - Who sells plumbing pipes and fittings: about 5,800 (about 1,450 with WhatsApp).
- `buys` is a typical-need inference, not evidence of a purchase. The UI must say «مشترٍ محتمل».
