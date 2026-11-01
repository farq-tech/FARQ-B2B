# Golden set — data dictionary (reference schema)

The golden record and this schema are the final authority. Every source feeds these columns; the targeting export
(`export_golden_targets.py`) is derived from them. Values from extra sources are added in their own columns and never overwrite a
better source. Regenerate with `python3 golden_schema_doc.py`.

Targetable rows (`in_golden`): **2,271,487**.

| Column | Type | Filled (in_golden) | Meaning | Source priority |
|---|---|---|---|---|
| `poi_key` | VARCHAR | 2,271,487 (100%) | Unique key. hh:<SPD id>, new:<n> (merged new sources), ov:<Overture id>, gm:<Google cid>, farq:<Farq supplier id>, urbi_coords:… etc. | pipeline |
| `origin` | VARCHAR | 2,271,487 (100%) | directory (live targeting directory) or new (added by the golden pipeline). | pipeline |
| `name_ar` | VARCHAR | 1,289,885 (57%) | Arabic name (cleaned; placeholders and links removed). | surveyor CR → source → same business in other sources → name dictionary → Google Maps |
| `name_en` | VARCHAR | 2,039,226 (90%) | English name. | surveyor CR → source → same business in other sources → name dictionary → Google Maps |
| `name_ar_source` | VARCHAR | 1,181,189 (52%) | Where name_ar came from. |  |
| `name_en_source` | VARCHAR | 1,990,716 (88%) | Where name_en came from. |  |
| `sub_id` | VARCHAR | 2,271,487 (100%) | Farq subcategory id (431 subcategories; unc.* = unclassified, noncom.* = non-commercial). | surveyor CR → Farq supplier items → row classifier → 2GIS/Overture/OSM/Google categories → exact known-brand name match (fills unclassified/low only) |
| `sub_ar` | VARCHAR | 2,271,487 (100%) | Subcategory name (Arabic). | taxonomy |
| `main_id` | VARCHAR | 2,271,487 (100%) | Main category id (25). | taxonomy |
| `main_ar` | VARCHAR | 2,271,487 (100%) | Main category (Arabic). | taxonomy |
| `roles` | VARCHAR | 2,271,487 (100%) | Market roles of the subcategory (seller/buyer/service …). | taxonomy |
| `isic4` | VARCHAR | 2,271,487 (100%) | Primary ISIC4 code of the subcategory. | taxonomy |
| `cls_source` | VARCHAR | 2,271,487 (100%) | Evidence used for the subcategory. |  |
| `cls_confidence` | VARCHAR | 2,271,487 (100%) | high / medium / low. |  |
| `specialty_ids` | VARCHAR[] | 436,575 (19%) | Specialties of the row inside its subcategory (docs/qa/targeting/taxonomy/specialties.csv, 4,073); several allowed; none when there is no evidence. | Farq supplier items → explicit source labels → business name |
| `specialties_ar` | VARCHAR[] | 436,575 (19%) | Specialty names (Arabic), same order as specialty_ids. |  |
| `specialty_sources` | VARCHAR[] | 436,575 (19%) | Evidence per specialty: farq_items / source_label / name. |  |
| `specialty_confidence` | VARCHAR | 436,575 (19%) | high when any specialty comes from supplier items or a source label, else medium (name only). |  |
| `sector` | VARCHAR | 68,497 (3%) | government / private for schools, hospitals, universities, institutes. | sector rules |
| `latitude` | DOUBLE | 2,271,487 (100%) | Latitude (WGS84). For location_precision city/district it is a reference point, not the address. | source → Farq district/city point |
| `longitude` | DOUBLE | 2,271,487 (100%) | Longitude (WGS84). |  |
| `location_precision` | VARCHAR | 2,271,487 (100%) | point (exact) / district (district reference point) / city (city reference point). |  |
| `farq_district_ar` | VARCHAR | 37,743 (2%) | Farq supplier district matched to an official district of the same city. | Farq construction DB |
| `farq_district_en` | VARCHAR | 37,575 (2%) | Same, English. |  |
| `farq_merged_into` | VARCHAR | 0 (0%) | For a Farq supplier row merged into an existing located row: that row's poi_key (the row itself is kept, excluded as merged_into_existing). |  |
| `farq_suppliers_merged` | BIGINT | 5,244 (0%) | Number of Farq supplier records merged into this row. |  |
| `farq_items_merged` | VARCHAR | 5,243 (0%) | What those suppliers supply. |  |
| `farq_supplier_phone` | VARCHAR | 61,405 (3%) | Phone given by the Farq supplier record (kept even when the row has another phone). | Farq construction DB |
| `farq_supplier_whatsapp` | VARCHAR | 16,038 (1%) | WhatsApp given by the Farq supplier (self-declared, not verified). | Farq construction DB |
| `farq_city_method` | VARCHAR | 113,297 (5%) | How a supplier's city was set: supplier_city / landline_011 / name_mentions_city / assumed_riyadh (owner rule, rank below known). |  |
| `farq_items` | VARCHAR | 113,282 (5%) | Items the Farq supplier supplies. | Farq construction DB |
| `farq_activities` | VARCHAR | 64,280 (3%) | Supplier activities. |  |
| `farq_trade` | VARCHAR | 67,972 (3%) | Supplier trade. |  |
| `farq_business_type` | VARCHAR | 113,297 (5%) | Supplier business type. |  |
| `farq_qualification` | VARCHAR | 113,297 (5%) | Supplier qualification status. |  |
| `farq_source_system` | VARCHAR | 113,297 (5%) | Origin system in the Farq DB. |  |
| `farq_visibility` | VARCHAR | 113,297 (5%) | PUBLIC / PRIVATE / REVIEW in the Farq DB. |  |
| `city_en` | VARCHAR | 2,271,116 (100%) | City, one spelling per city (targeting service spellings). | official boundary → OSM settlement → source → Farq supplier city → neighbours |
| `city_ar` | VARCHAR | 2,270,458 (100%) | City (Arabic). |  |
| `city_method` | VARCHAR | 2,271,111 (100%) | How city_en was set. |  |
| `city_source_en` | VARCHAR | 2,109,161 (93%) | City as written by the source (often the region). |  |
| `osm_city_m` | DOUBLE | 552,050 (24%) | Distance to the OSM settlement used (m). |  |
| `governorate_ar` | VARCHAR | 2,195,892 (97%) | Governorate (OSM admin level 6). | OSM boundaries |
| `governorate_en` | VARCHAR | 2,195,892 (97%) | Governorate, English. |  |
| `district` | VARCHAR | 2,138,851 (94%) | District as best known (Arabic when available). | official boundary → surveyor CR → source → Urbi/2GIS → OSM boundary → nearest boundary → OSM place → neighbours |
| `district_ar` | VARCHAR | 1,697,993 (75%) | District (Arabic, from a boundary or a named source). |  |
| `district_en` | VARCHAR | 1,697,817 (75%) | District (English). |  |
| `district_method` | VARCHAR | 2,138,851 (94%) | How district was set. |  |
| `phone` | VARCHAR | 538,891 (24%) | Main phone, +966… | surveyor CR → source → contact overlay → Drive sheets → Google Maps (Serper) → Overture → OSM → Farq supplier |
| `phone_source` | VARCHAR | 538,891 (24%) | Where phone came from. |  |
| `license_no` | VARCHAR | 42,036 (2%) | Commercial licence number. | surveyor CR → 2GIS firms-with-licence |
| `license_type` | VARCHAR | 33,044 (1%) | Licence type. | 2GIS |
| `license_end` | DATE | 29,205 (1%) | Licence end date. | 2GIS (Feb 2024) |
| `license_expired` | BOOLEAN | 29,205 (1%) | Licence end date before today. |  |
| `legal_form` | VARCHAR | 0 (0%) | Legal form. | 2GIS |
| `national_address` | VARCHAR | 25,663 (1%) | Saudi national short address. | surveyor CR |
| `surveyor_verified_at` | VARCHAR | 50,174 (2%) | Date of the latest approved surveyor change request. | SPD CRS |
| `building_no` | VARCHAR | 2,744 (0%) | Building number. | surveyor CR |
| `postal_code` | VARCHAR | 9,632 (0%) | Postal code. | surveyor CR |
| `floor_no` | VARCHAR | 150 (0%) | Floor. | surveyor CR |
| `street_ar` | VARCHAR | 1,174,061 (52%) | Street (Arabic). | surveyor CR → nearest named OSM street ≤ 80 m |
| `street_en` | VARCHAR | 1,171,807 (52%) | Street (English). |  |
| `street_m` | DOUBLE | 1,302,132 (57%) | Distance to the OSM street (m; 0 when from the surveyor). |  |
| `street_source` | VARCHAR | 1,174,061 (52%) | crs_surveyor / osm. |  |
| `opening_hours` | VARCHAR | 264,658 (12%) | Opening hours (raw JSON/text as given). | surveyor CR → live directory → Drive TRX sheet → Google Maps |
| `menu_link` | VARCHAR | 446 (0%) | Menu link. | surveyor CR |
| `order_link` | VARCHAR | 5 (0%) | Ordering link. | surveyor CR |
| `reservation_link` | VARCHAR | 481 (0%) | Reservation link. | surveyor CR |
| `x_link` | VARCHAR | 12,153 (1%) | X (Twitter). | surveyor CR → directory → Drive sheet |
| `snapchat` | VARCHAR | 706 (0%) | Snapchat. |  |
| `tiktok` | VARCHAR | 1,353 (0%) | TikTok. |  |
| `overture_socials` | VARCHAR[] | 16,411 (1%) | Social links from Overture. | Overture |
| `fsq_categories` | VARCHAR | 40,486 (2%) | Foursquare category labels of the matched place. | Foursquare OS Places |
| `fsq_facebook_id` | BIGINT | 1,635 (0%) | Facebook page id from Foursquare. | Foursquare OS Places |
| `description_ar` | VARCHAR | 119,211 (5%) | Description (Arabic). | surveyor CR → directory |
| `description_en` | VARCHAR | 41,875 (2%) | Description (English). |  |
| `tradename` | VARCHAR | 10,717 (0%) | Trade name. | surveyor CR |
| `amenities_ids` | VARCHAR | 9,131 (0%) | SPD amenity ids. | surveyor CR |
| `hh_brand_id` | VARCHAR | 1,308 (0%) | SPD brand id. | surveyor CR |
| `hh_status` | VARCHAR | 46,358 (2%) | Surveyor status: open / temporary closed / permanently closed. | surveyor CR |
| `hh_duplicate_of` | VARCHAR | 0 (0%) | Surveyor says this is a duplicate of another SPD POI. | surveyor CR |
| `google_place_id` | VARCHAR | 78,967 (3%) | Google place id. | surveyor CR → GMB match |
| `reviews_count` | INTEGER | 140,384 (6%) | Number of reviews. | directory → surveyor CR → GMB → Drive sheet → Google Maps |
| `google_cid` | VARCHAR | 24,332 (1%) | Google Maps cid (Serper). | Serper |
| `has_whatsapp` | BOOLEAN | 2,271,487 (100%) | WhatsApp flag from the directory/overlay (not a verification). |  |
| `email` | VARCHAR | 90,066 (4%) | E-mail. | source → Urbi attrs → Overture |
| `website` | VARCHAR | 139,529 (6%) | Website. | source → Urbi attrs → brand → Drive sheet → Overture → OSM |
| `instagram` | VARCHAR | 29,898 (1%) | Instagram. | source → surveyor CR → Urbi → brand → Drive sheet |
| `linkedin` | VARCHAR | 867 (0%) | LinkedIn. | Urbi attrs |
| `twitter` | VARCHAR | 4,468 (0%) | Twitter (Urbi). | Urbi attrs |
| `employees_band` | VARCHAR | 28,052 (1%) | Company size band. | Urbi attrs |
| `branches_count` | VARCHAR | 132,940 (6%) | Branches. | Urbi attrs |
| `legal_name` | VARCHAR | 20,601 (1%) | Legal name. | Urbi attrs |
| `makani` | VARCHAR | 26,821 (1%) | Makani code. | Urbi attrs |
| `commercial_license` | VARCHAR | 284,668 (13%) | Licence from the live directory. | directory |
| `brand` | VARCHAR | 10,872 (0%) | Brand / chain. | brand branches |
| `google_categories` | VARCHAR | 58,306 (3%) | Google categories (GMB match). | GMB |
| `google_rating` | DOUBLE | 104,852 (5%) | Rating. | GMB → Google Maps → surveyor CR → Drive sheet |
| `google_reviews` | VARCHAR | 51,026 (2%) | Reviews (GMB, text). | GMB |
| `google_perm_closed` | BOOLEAN | 2,271,487 (100%) | Google says permanently closed. | GMB |
| `google_temp_closed` | BOOLEAN | 2,271,487 (100%) | Google says temporarily closed. | GMB |
| `hudhud_deleted` | BOOLEAN | 2,271,487 (100%) | Deleted by SPD surveyors (logs, TRX state or CR). | SPD |
| `hudhud_state` | VARCHAR | 388,050 (17%) | SPD TRX state. | SPD |
| `curated_contracting_supplier` | BOOLEAN | 2,271,487 (100%) | In the owner's curated contracting-supplier list. | Archive 11 |
| `qualified_distributor` | BOOLEAN | 2,271,487 (100%) | Qualified distributor in that list. | Archive 11 |
| `dup_group` | VARCHAR | 1,313,551 (58%) | Directory duplicate group (first pass). |  |
| `dup_primary` | BOOLEAN | 2,271,487 (100%) | Primary row of that group. |  |
| `gdup_group` | BIGINT | 55,225 (2%) | Golden-wide duplicate group. |  |
| `gdup_primary` | BOOLEAN | 55,225 (2%) | Primary row of that group. |  |
| `gdup_size` | BIGINT | 55,225 (2%) | Group size. |  |
| `sources` | VARCHAR[] | 2,271,487 (100%) | All source names of the row. |  |
| `missing_fields` | VARCHAR[] | 2,271,487 (100%) | Which of the six checks are missing: name, subcategory, location, city, district, contact. |  |
| `exclude_reason` | VARCHAR | 0 (0%) | Why the row is not targetable (null = targetable). |  |
| `complete` | BOOLEAN | 2,271,487 (100%) | All six checks present. |  |
| `completeness_score` | BIGINT | 2,271,487 (100%) | 0–6. |  |
| `in_golden` | BOOLEAN | 2,271,487 (100%) | Targetable row (exclude_reason is null). |  |
