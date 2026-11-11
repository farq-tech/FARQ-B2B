# Lessons from SPD surveyors (CRs, POI logs, TRX after cleaning; 2024-10 → 2025-08)

These are human judgements made in the field. They are used as ground truth.

## Deletes (230,581 surveyed directory rows, 33 % deleted)
- No activity: 95 % deleted. Unclassified by us: 98 %.
- Street furniture, toilets and signs: 95 %. Parking: 87 %. Residential: 72 %. Parks: 72 %. ATMs: 72 %.
- Rows in one of our duplicate groups: 42–51 % deleted, against 31 % for singletons. This confirms `dedupe.py`.
- Name-classified rows: 22 % deleted, against 40 % for activity-only rows. A clear trade word in the name signals a real business.
- Most stable: banks, abayas, real-estate offices, mobile shops (13–18 %).
- By source: google_scrape 13 %, nationwide 16 %; gmb, golden and urbi 34–42 %.
- Leakage to avoid when learning: lifecycle `archived`, company status, completeness and the `hh_*`/`trx_*`/`golden*` tags change *because of* a delete.

## Categories (TRX after cleaning)
- Our name-based subcategory agrees with the surveyor's top category on 88.6 % of 64,560 rows.
- The misses are context errors. «صيانة», «مغسلة» or «كهربائي» inside Automotive Services means a car workshop, car wash or car electrician. These are now corrected (`surveyor_categories.py`, 7,511 rows).

## Names (12,328 approved name edits)
- Legal-form words are removed: شركة 211, مؤسسة 119, للتجارة 55, المحدودة 24.
- A generic activity prefix is removed when the brand stands alone (محمصة الرفاعي → الرفاعي).
- An activity word is added when the name alone is ambiguous (… لصيانة السيارات, صيدلية, للحلاقة, تموينات).
- Arabic-Indic digits become Latin (٣٥٤ → 354). Bidi control marks (U+202C, U+200F) are stripped.
- English names get proper casing and spacing (YVESSAINTLAURENT → Yves Saint Laurent). About half of all name edits are English-only.

## Validity model: not usable yet
`learn_from_surveyors.py` reaches a holdout AUC of 0.97–0.98, which is too good to be true. The top features are pipeline artefacts: the `nationwide` tag (added to rows that survived the review), whether a category exists (removed with the row), and before that `archived`, status and completeness. Applied to the 1.7 M unsurveyed rows, it flags 65 % of them as invalid, which is not credible. Its outputs are renamed `DO_NOT_USE_*`.

The right training set is the **pre-survey state**: the first POI log of each transaction (original name, coordinates, creator: field surveyor or `bot_scraper`, date), with the label taken from the final log. Until that is built, only the rule-level lessons above are applied.
