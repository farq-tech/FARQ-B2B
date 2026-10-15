# Farq activity taxonomy (2026-10-15)

- `farq_taxonomy.json` / `.csv`: the owner's taxonomy. It has 25 main categories and 431 subcategories, with roles (wholesale, retail, service, end_user), ISIC4 codes and match hints. `build_taxonomy.py` generates both files.
- `activity_map.csv`: maps every raw directory activity (all 5,247 first values of `category` on active rows) to exactly one subcategory. Each row has a confidence (high, medium or low) and an optional note.

How the map was made: each label was judged in-session against the taxonomy, in 8 parallel batches, with no paid or external service. The output was validated (every id exists, every activity mapped exactly once), and the largest activities were reviewed by hand.

Coverage by directory rows (988,729 rows with an activity):
- high 51.3 %, medium 13.0 %, low 35.7 %.
- Low is mostly the broad source buckets: Corporate (66,933), Automotive Services, Shopping, Hotels and Accommodations, Education, Beauty and Spa, Home Goods, Public Services, Transportation, Food and Beverages. These need row-level classification from the business name and secondary or google categories (next step).
- Numeric codes (19, 8, 23, 16, 11, 22, 1 …) are source top-level ids. They are mapped through their Arabic bucket label (19 = الشركات, 8 = التسوق, 23 = احتياجات المنزل, 16 = خدمات السيارات, 11 = التموينات, 22 = الجمال والعناية, 1 = مطاعم).
- 416 of 431 subcategories are used. The 15 unused ones have no directory activity yet, which marks a data gap.
