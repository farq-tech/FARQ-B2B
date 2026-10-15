# Golden set — data dictionary (reference schema)

The golden record and this schema are the final authority. Every source feeds these columns; the targeting export
(`export_golden_targets.py`) is derived from them. Values from extra sources are added in their own columns and never overwrite a
better source. Regenerate with `python3 golden_schema_doc.py`.

Targetable rows (`in_golden`): **2,250,123**.

| Column | Type | Filled (in_golden) | Meaning | Source priority |
|---|---|---|---|---|
| `poi_key` | VARCHAR | 2,250,123 (100%) | Unique key. hh:<HudHud id>, new:<n> (merged new sources), ov:<Overture id>, gm:<Google cid>, farq:<Farq supplier id>, urbi_coords:… etc. | pipeline |
| `origin` | VARCHAR | 2,250,123 (100%) | directory (live targeting directory) or new (added by the golden pipeline). | pipeline |
| `name_ar` | VARCHAR | 1,277,000 (57%) | Arabic name (cleaned; placeholders and links removed). | surveyor CR → source → same business in other sources → name dictionary → Google Maps |
| `name_en` | VARCHAR | 2,030,874 (90%) | English name. | surveyor CR → source → same business in other sources → name dictionary → Google Maps |
| `name_ar_source` | VARCHAR | 1,168,289 (52%) | Where name_ar came from. |  |
| `name_en_source` | VARCHAR | 1,982,335 (88%) | Where name_en came from. |  |
| `sub_id` | VARCHAR | 2,250,123 (100%) | Farq subcategory id (431 subcategories; unc.* = unclassified, noncom.* = non-commercial). | surveyor CR → Farq supplier items → row classifier → 2GIS/Overture/OSM/Google categories (fill unclassified/low only) |
| `sub_ar` | VARCHAR | 2,250,123 (100%) | Subcategory name (Arabic). | taxonomy |
| `main_id` | VARCHAR | 2,250,123 (100%) | Main category id (25). | taxonomy |
| `main_ar` | VARCHAR | 2,250,123 (100%) | Main category (Arabic). | taxonomy |
| `roles` | VARCHAR | 2,250,123 (100%) | Market roles of the subcategory (seller/buyer/service …). | taxonomy |
| `isic4` | VARCHAR | 2,250,123 (100%) | Primary ISIC4 code of the subcategory. | taxonomy |
| `cls_source` | VARCHAR | 2,250,123 (100%) | Evidence used for the subcategory. |  |
| `cls_confidence` | VARCHAR | 2,250,123 (100%) | high / medium / low. |  |
| `sector` | VARCHAR | 68,501 (3%) | government / private for schools, hospitals, universities, institutes. | sector rules |
| `latitude` | DOUBLE | 2,250,123 (100%) | Latitude (WGS84). For location_precision city/district it is a reference point, not the address. | source → Farq district/city point |
| `longitude` | DOUBLE | 2,250,123 (100%) | Longitude (WGS84). |  |
| `location_precision` | VARCHAR | 2,250,123 (100%) | point (exact) / district (district reference point) / city (city reference point). |  |
| `farq_district_ar` | VARCHAR | 37,742 (2%) | Farq supplier district matched to an official district of the same city. | Farq construction DB |
| `farq_district_en` | VARCHAR | 37,574 (2%) | Same, English. |  |
| `farq_merged_into` | VARCHAR | 0 (0%) | For a Farq supplier row merged into an existing located row: that row's poi_key (the row itself is kept, excluded as merged_into_existing). |  |
| `farq_suppliers_merged` | BIGINT | 5,244 (0%) | Number of Farq supplier records merged into this row. |  |
| `farq_items_merged` | VARCHAR | 5,243 (0%) | What those suppliers supply. |  |
| `farq_supplier_phone` | VARCHAR | 61,405 (3%) | Phone given by the Farq supplier record (kept even when the row has another phone). | Farq construction DB |
| `farq_supplier_whatsapp` | VARCHAR | 16,038 (1%) | WhatsApp given by the Farq supplier (self-declared, not verified). | Farq construction DB |
| `farq_city_method` | VARCHAR | 113,296 (5%) | How a supplier's city was set: supplier_city / landline_011 / name_mentions_city / assumed_riyadh (owner rule, rank below known). |  |
| `farq_items` | VARCHAR | 113,281 (5%) | Items the Farq supplier supplies. | Farq construction DB |
| `farq_activities` | VARCHAR | 64,280 (3%) | Supplier activities. |  |
| `farq_trade` | VARCHAR | 67,971 (3%) | Supplier trade. |  |
| `farq_business_type` | VARCHAR | 113,296 (5%) | Supplier business type. |  |
| `farq_qualification` | VARCHAR | 113,296 (5%) | Supplier qualification status. |  |
| `farq_source_system` | VARCHAR | 113,296 (5%) | Origin system in the Farq DB. |  |
| `farq_visibility` | VARCHAR | 113,296 (5%) | PUBLIC / PRIVATE / REVIEW in the Farq DB. |  |
| `city_en` | VARCHAR | 2,249,920 (100%) | City, one spelling per city (targeting service spellings). | official boundary → OSM settlement → source → Farq supplier city → neighbours |
| `city_ar` | VARCHAR | 2,249,474 (100%) | City (Arabic). |  |
| `city_method` | VARCHAR | 2,207,107 (98%) | How city_en was set. |  |
| `city_source_en` | VARCHAR | 2,092,002 (93%) | City as written by the source (often the region). |  |
| `osm_city_m` | DOUBLE | 539,575 (24%) | Distance to the OSM settlement used (m). |  |
| `governorate_ar` | VARCHAR | 2,174,551 (97%) | Governorate (OSM admin level 6). | OSM boundaries |
| `governorate_en` | VARCHAR | 2,174,551 (97%) | Governorate, English. |  |
| `district` | VARCHAR | 2,120,852 (94%) | District as best known (Arabic when available). | official boundary → surveyor CR → source → Urbi/2GIS → OSM boundary → nearest boundary → OSM place → neighbours |
| `district_ar` | VARCHAR | 1,682,996 (75%) | District (Arabic, from a boundary or a named source). |  |
| `district_en` | VARCHAR | 1,682,820 (75%) | District (English). |  |
| `district_method` | VARCHAR | 2,120,852 (94%) | How district was set. |  |
| `phone` | VARCHAR | 520,002 (23%) | Main phone, +966… | surveyor CR → source → contact overlay → Drive sheets → Google Maps (Serper) → Overture → OSM → Farq supplier |
| `phone_source` | VARCHAR | 520,002 (23%) | Where phone came from. |  |
| `license_no` | VARCHAR | 42,052 (2%) | Commercial licence number. | surveyor CR → 2GIS firms-with-licence |
| `license_type` | VARCHAR | 33,059 (1%) | Licence type. | 2GIS |
| `license_end` | DATE | 29,220 (1%) | Licence end date. | 2GIS (Feb 2024) |
| `license_expired` | BOOLEAN | 29,220 (1%) | Licence end date before today. |  |
| `legal_form` | VARCHAR | 0 (0%) | Legal form. | 2GIS |
| `national_address` | VARCHAR | 25,663 (1%) | Saudi national short address. | surveyor CR |
| `surveyor_verified_at` | VARCHAR | 50,178 (2%) | Date of the latest approved surveyor change request. | HudHud CRS |
| `building_no` | VARCHAR | 2,744 (0%) | Building number. | surveyor CR |
| `postal_code` | VARCHAR | 9,631 (0%) | Postal code. | surveyor CR |
| `floor_no` | VARCHAR | 150 (0%) | Floor. | surveyor CR |
| `street_ar` | VARCHAR | 1,160,642 (52%) | Street (Arabic). | surveyor CR → nearest named OSM street ≤ 80 m |
| `street_en` | VARCHAR | 1,158,879 (52%) | Street (English). |  |
| `street_m` | DOUBLE | 1,287,654 (57%) | Distance to the OSM street (m; 0 when from the surveyor). |  |
| `street_source` | VARCHAR | 1,160,642 (52%) | crs_surveyor / osm. |  |
| `opening_hours` | VARCHAR | 264,670 (12%) | Opening hours (raw JSON/text as given). | surveyor CR → live directory → Drive TRX sheet → Google Maps |
| `menu_link` | VARCHAR | 446 (0%) | Menu link. | surveyor CR |
| `order_link` | VARCHAR | 5 (0%) | Ordering link. | surveyor CR |
| `reservation_link` | VARCHAR | 481 (0%) | Reservation link. | surveyor CR |
| `x_link` | VARCHAR | 8,687 (0%) | X (Twitter). | surveyor CR → directory → Drive sheet |
| `snapchat` | VARCHAR | 706 (0%) | Snapchat. |  |
| `tiktok` | VARCHAR | 1,353 (0%) | TikTok. |  |
| `overture_socials` | VARCHAR[] | 16,448 (1%) | Social links from Overture. | Overture |
| `description_ar` | VARCHAR | 119,210 (5%) | Description (Arabic). | surveyor CR → directory |
| `description_en` | VARCHAR | 41,877 (2%) | Description (English). |  |
| `tradename` | VARCHAR | 10,717 (0%) | Trade name. | surveyor CR |
| `amenities_ids` | VARCHAR | 9,131 (0%) | HudHud amenity ids. | surveyor CR |
| `hh_brand_id` | VARCHAR | 1,308 (0%) | HudHud brand id. | surveyor CR |
| `hh_status` | VARCHAR | 46,362 (2%) | Surveyor status: open / temporary closed / permanently closed. | surveyor CR |
| `hh_duplicate_of` | VARCHAR | 0 (0%) | Surveyor says this is a duplicate of another HudHud POI. | surveyor CR |
| `google_place_id` | VARCHAR | 78,977 (4%) | Google place id. | surveyor CR → GMB match |
| `reviews_count` | INTEGER | 140,396 (6%) | Number of reviews. | directory → surveyor CR → GMB → Drive sheet → Google Maps |
| `google_cid` | VARCHAR | 24,343 (1%) | Google Maps cid (Serper). | Serper |
| `has_whatsapp` | BOOLEAN | 2,250,123 (100%) | WhatsApp flag from the directory/overlay (not a verification). |  |
| `email` | VARCHAR | 88,171 (4%) | E-mail. | source → Urbi attrs → Overture |
| `website` | VARCHAR | 131,251 (6%) | Website. | source → Urbi attrs → brand → Drive sheet → Overture → OSM |
| `instagram` | VARCHAR | 25,135 (1%) | Instagram. | source → surveyor CR → Urbi → brand → Drive sheet |
| `linkedin` | VARCHAR | 867 (0%) | LinkedIn. | Urbi attrs |
| `twitter` | VARCHAR | 4,468 (0%) | Twitter (Urbi). | Urbi attrs |
| `employees_band` | VARCHAR | 28,055 (1%) | Company size band. | Urbi attrs |
| `branches_count` | VARCHAR | 132,951 (6%) | Branches. | Urbi attrs |
| `legal_name` | VARCHAR | 20,603 (1%) | Legal name. | Urbi attrs |
| `makani` | VARCHAR | 26,824 (1%) | Makani code. | Urbi attrs |
| `commercial_license` | VARCHAR | 284,692 (13%) | Licence from the live directory. | directory |
| `brand` | VARCHAR | 10,870 (0%) | Brand / chain. | brand branches |
| `google_categories` | VARCHAR | 58,315 (3%) | Google categories (GMB match). | GMB |
| `google_rating` | DOUBLE | 104,873 (5%) | Rating. | GMB → Google Maps → surveyor CR → Drive sheet |
| `google_reviews` | VARCHAR | 51,035 (2%) | Reviews (GMB, text). | GMB |
| `google_perm_closed` | BOOLEAN | 2,250,123 (100%) | Google says permanently closed. | GMB |
| `google_temp_closed` | BOOLEAN | 2,250,123 (100%) | Google says temporarily closed. | GMB |
| `hudhud_deleted` | BOOLEAN | 2,250,123 (100%) | Deleted by HudHud surveyors (logs, TRX state or CR). | HudHud |
| `hudhud_state` | VARCHAR | 388,064 (17%) | HudHud TRX state. | HudHud |
| `curated_contracting_supplier` | BOOLEAN | 2,250,123 (100%) | In the owner's curated contracting-supplier list. | Archive 11 |
| `qualified_distributor` | BOOLEAN | 2,250,123 (100%) | Qualified distributor in that list. | Archive 11 |
| `dup_group` | VARCHAR | 1,313,611 (58%) | Directory duplicate group (first pass). |  |
| `dup_primary` | BOOLEAN | 2,250,123 (100%) | Primary row of that group. |  |
| `gdup_group` | BIGINT | 54,841 (2%) | Golden-wide duplicate group. |  |
| `gdup_primary` | BOOLEAN | 54,841 (2%) | Primary row of that group. |  |
| `gdup_size` | BIGINT | 54,841 (2%) | Group size. |  |
| `sources` | VARCHAR[] | 2,250,123 (100%) | All source names of the row. |  |
| `missing_fields` | VARCHAR[] | 2,250,123 (100%) | Which of the six checks are missing: name, subcategory, location, city, district, contact. |  |
| `exclude_reason` | VARCHAR | 0 (0%) | Why the row is not targetable (null = targetable). |  |
| `complete` | BOOLEAN | 2,250,123 (100%) | All six checks present. |  |
| `completeness_score` | BIGINT | 2,250,123 (100%) | 0–6. |  |
| `in_golden` | BOOLEAN | 2,250,123 (100%) | Targetable row (exclude_reason is null). |  |
