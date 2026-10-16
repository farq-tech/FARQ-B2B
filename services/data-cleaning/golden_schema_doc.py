"""Writes GOLDEN_SCHEMA.md — the data dictionary of the golden set, the reference schema (owner, 2026-10-16: the golden record and its
schema are the final authority; every source feeds these columns, the targeting export is derived from them). Each column: type, fill on
targetable rows (in_golden), meaning, source priority. Re-run after every schema change.
Usage: python3 golden_schema_doc.py"""
import duckdb
G = '/Users/m4pro/farq-taxonomy-data/golden/golden_set.parquet'
DOC = {
 'poi_key': ('Unique key. hh:<HudHud id>, new:<n> (merged new sources), ov:<Overture id>, gm:<Google cid>, farq:<Farq supplier id>, urbi_coords:… etc.', 'pipeline'),
 'origin': ('directory (live targeting directory) or new (added by the golden pipeline).', 'pipeline'),
 'name_ar': ('Arabic name (cleaned; placeholders and links removed).', 'surveyor CR → source → same business in other sources → name dictionary → Google Maps'),
 'name_en': ('English name.', 'surveyor CR → source → same business in other sources → name dictionary → Google Maps'),
 'name_ar_source': ('Where name_ar came from.', ''), 'name_en_source': ('Where name_en came from.', ''),
 'sub_id': ('Farq subcategory id (431 subcategories; unc.* = unclassified, noncom.* = non-commercial).', 'surveyor CR → Farq supplier items → row classifier → 2GIS/Overture/OSM/Google categories (fill unclassified/low only)'),
 'sub_ar': ('Subcategory name (Arabic).', 'taxonomy'), 'main_id': ('Main category id (25).', 'taxonomy'), 'main_ar': ('Main category (Arabic).', 'taxonomy'),
 'roles': ('Market roles of the subcategory (seller/buyer/service …).', 'taxonomy'), 'isic4': ('Primary ISIC4 code of the subcategory.', 'taxonomy'),
 'cls_source': ('Evidence used for the subcategory.', ''), 'cls_confidence': ('high / medium / low.', ''),
 'sector': ('government / private for schools, hospitals, universities, institutes.', 'sector rules'),
 'latitude': ('Latitude (WGS84). For location_precision city/district it is a reference point, not the address.', 'source → Farq district/city point'),
 'longitude': ('Longitude (WGS84).', ''), 'location_precision': ('point (exact) / district (district reference point) / city (city reference point).', ''),
 'farq_district_ar': ('Farq supplier district matched to an official district of the same city.', 'Farq construction DB'), 'farq_district_en': ('Same, English.', ''),
 'farq_merged_into': ('For a Farq supplier row merged into an existing located row: that row\'s poi_key (the row itself is kept, excluded as merged_into_existing).', ''),
 'farq_suppliers_merged': ('Number of Farq supplier records merged into this row.', ''), 'farq_items_merged': ('What those suppliers supply.', ''),
 'farq_supplier_phone': ('Phone given by the Farq supplier record (kept even when the row has another phone).', 'Farq construction DB'),
 'farq_supplier_whatsapp': ('WhatsApp given by the Farq supplier (self-declared, not verified).', 'Farq construction DB'),
 'farq_city_method': ('How a supplier\'s city was set: supplier_city / landline_011 / name_mentions_city / assumed_riyadh (owner rule, rank below known).', ''),
 'specialty_ids': ('Specialties of the row inside its subcategory (docs/qa/targeting/taxonomy/specialties.csv, 4,073); several allowed; none when there is no evidence.', 'Farq supplier items → explicit source labels → business name'),
 'specialties_ar': ('Specialty names (Arabic), same order as specialty_ids.', ''), 'specialty_sources': ('Evidence per specialty: farq_items / source_label / name.', ''),
 'specialty_confidence': ('high when any specialty comes from supplier items or a source label, else medium (name only).', ''),
 'fsq_categories': ('Foursquare category labels of the matched place.', 'Foursquare OS Places'), 'fsq_facebook_id': ('Facebook page id from Foursquare.', 'Foursquare OS Places'),
 'farq_items': ('Items the Farq supplier supplies.', 'Farq construction DB'), 'farq_activities': ('Supplier activities.', ''), 'farq_trade': ('Supplier trade.', ''),
 'farq_business_type': ('Supplier business type.', ''), 'farq_qualification': ('Supplier qualification status.', ''), 'farq_source_system': ('Origin system in the Farq DB.', ''),
 'farq_visibility': ('PUBLIC / PRIVATE / REVIEW in the Farq DB.', ''),
 'city_en': ('City, one spelling per city (targeting service spellings).', 'official boundary → OSM settlement → source → Farq supplier city → neighbours'),
 'city_ar': ('City (Arabic).', ''), 'city_method': ('How city_en was set.', ''), 'city_source_en': ('City as written by the source (often the region).', ''),
 'osm_city_m': ('Distance to the OSM settlement used (m).', ''), 'governorate_ar': ('Governorate (OSM admin level 6).', 'OSM boundaries'), 'governorate_en': ('Governorate, English.', ''),
 'district': ('District as best known (Arabic when available).', 'official boundary → surveyor CR → source → Urbi/2GIS → OSM boundary → nearest boundary → OSM place → neighbours'),
 'district_ar': ('District (Arabic, from a boundary or a named source).', ''), 'district_en': ('District (English).', ''), 'district_method': ('How district was set.', ''),
 'phone': ('Main phone, +966…', 'surveyor CR → source → contact overlay → Drive sheets → Google Maps (Serper) → Overture → OSM → Farq supplier'),
 'phone_source': ('Where phone came from.', ''),
 'license_no': ('Commercial licence number.', 'surveyor CR → 2GIS firms-with-licence'), 'license_type': ('Licence type.', '2GIS'), 'license_end': ('Licence end date.', '2GIS (Feb 2024)'),
 'license_expired': ('Licence end date before today.', ''), 'legal_form': ('Legal form.', '2GIS'), 'national_address': ('Saudi national short address.', 'surveyor CR'),
 'surveyor_verified_at': ('Date of the latest approved surveyor change request.', 'HudHud CRS'), 'building_no': ('Building number.', 'surveyor CR'), 'postal_code': ('Postal code.', 'surveyor CR'),
 'floor_no': ('Floor.', 'surveyor CR'), 'street_ar': ('Street (Arabic).', 'surveyor CR → nearest named OSM street ≤ 80 m'), 'street_en': ('Street (English).', ''),
 'street_m': ('Distance to the OSM street (m; 0 when from the surveyor).', ''), 'street_source': ('crs_surveyor / osm.', ''),
 'opening_hours': ('Opening hours (raw JSON/text as given).', 'surveyor CR → live directory → Drive TRX sheet → Google Maps'),
 'menu_link': ('Menu link.', 'surveyor CR'), 'order_link': ('Ordering link.', 'surveyor CR'), 'reservation_link': ('Reservation link.', 'surveyor CR'),
 'x_link': ('X (Twitter).', 'surveyor CR → directory → Drive sheet'), 'snapchat': ('Snapchat.', ''), 'tiktok': ('TikTok.', ''), 'overture_socials': ('Social links from Overture.', 'Overture'),
 'description_ar': ('Description (Arabic).', 'surveyor CR → directory'), 'description_en': ('Description (English).', ''), 'tradename': ('Trade name.', 'surveyor CR'),
 'amenities_ids': ('HudHud amenity ids.', 'surveyor CR'), 'hh_brand_id': ('HudHud brand id.', 'surveyor CR'), 'hh_status': ('Surveyor status: open / temporary closed / permanently closed.', 'surveyor CR'),
 'hh_duplicate_of': ('Surveyor says this is a duplicate of another HudHud POI.', 'surveyor CR'), 'google_place_id': ('Google place id.', 'surveyor CR → GMB match'),
 'reviews_count': ('Number of reviews.', 'directory → surveyor CR → GMB → Drive sheet → Google Maps'), 'google_cid': ('Google Maps cid (Serper).', 'Serper'),
 'has_whatsapp': ('WhatsApp flag from the directory/overlay (not a verification).', ''), 'email': ('E-mail.', 'source → Urbi attrs → Overture'),
 'website': ('Website.', 'source → Urbi attrs → brand → Drive sheet → Overture → OSM'), 'instagram': ('Instagram.', 'source → surveyor CR → Urbi → brand → Drive sheet'),
 'linkedin': ('LinkedIn.', 'Urbi attrs'), 'twitter': ('Twitter (Urbi).', 'Urbi attrs'), 'employees_band': ('Company size band.', 'Urbi attrs'), 'branches_count': ('Branches.', 'Urbi attrs'),
 'legal_name': ('Legal name.', 'Urbi attrs'), 'makani': ('Makani code.', 'Urbi attrs'), 'commercial_license': ('Licence from the live directory.', 'directory'),
 'brand': ('Brand / chain.', 'brand branches'), 'google_categories': ('Google categories (GMB match).', 'GMB'), 'google_rating': ('Rating.', 'GMB → Google Maps → surveyor CR → Drive sheet'),
 'google_reviews': ('Reviews (GMB, text).', 'GMB'), 'google_perm_closed': ('Google says permanently closed.', 'GMB'), 'google_temp_closed': ('Google says temporarily closed.', 'GMB'),
 'hudhud_deleted': ('Deleted by HudHud surveyors (logs, TRX state or CR).', 'HudHud'), 'hudhud_state': ('HudHud TRX state.', 'HudHud'),
 'curated_contracting_supplier': ('In the owner\'s curated contracting-supplier list.', 'Archive 11'), 'qualified_distributor': ('Qualified distributor in that list.', 'Archive 11'),
 'dup_group': ('Directory duplicate group (first pass).', ''), 'dup_primary': ('Primary row of that group.', ''),
 'gdup_group': ('Golden-wide duplicate group.', ''), 'gdup_primary': ('Primary row of that group.', ''), 'gdup_size': ('Group size.', ''),
 'sources': ('All source names of the row.', ''), 'missing_fields': ('Which of the six checks are missing: name, subcategory, location, city, district, contact.', ''),
 'exclude_reason': ('Why the row is not targetable (null = targetable).', ''), 'complete': ('All six checks present.', ''),
 'completeness_score': ('0–6.', ''), 'in_golden': ('Targetable row (exclude_reason is null).', ''),
}
db = duckdb.connect()
cols = db.execute(f"describe select * from read_parquet('{G}')").fetchall()
n = db.execute(f"select count(*) from read_parquet('{G}') where in_golden").fetchone()[0]
fill = db.execute("select " + ", ".join(f'count("{c[0]}")' for c in cols) + f" from read_parquet('{G}') where in_golden").fetchone()
out = ['# Golden set — data dictionary (reference schema)', '',
       'The golden record and this schema are the final authority. Every source feeds these columns; the targeting export',
       '(`export_golden_targets.py`) is derived from them. Values from extra sources are added in their own columns and never overwrite a',
       'better source. Regenerate with `python3 golden_schema_doc.py`.', '', f'Targetable rows (`in_golden`): **{n:,}**.', '',
       '| Column | Type | Filled (in_golden) | Meaning | Source priority |', '|---|---|---|---|---|']
missing = []
for (c, t, *_), f in zip(cols, fill):
    m, src = DOC.get(c, ('', ''))
    if not m: missing.append(c)
    out.append(f'| `{c}` | {t} | {f:,} ({100 * f / n:.0f}%) | {m} | {src} |')
open('/Users/m4pro/farq-pricing/services/data-cleaning/GOLDEN_SCHEMA.md', 'w').write('\n'.join(out) + '\n')
print('columns', len(cols), 'undocumented', missing)
