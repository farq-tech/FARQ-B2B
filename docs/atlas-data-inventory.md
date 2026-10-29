# كتالوج مصادر بيانات فرق

كل مصدر يقرؤه المستودع أو يستورده، مربوطاً بمكانه في النموذج الموحّد (`docs/unified-data-model.md`). المرجع الذي تحيل إليه `docs/atlas-product-foundation.md`.

- جُرد من الكود في 2026-10-29. كل خلية «غير مذكور» تعني أن المستودع لا يذكرها، لا أنها غير موجودة.
- الأعمدة: الحبيبة (مستوى السجل)، ومفتاح الربط، والترخيص كما هو مكتوب في الكود، والجدول المقترح في النموذج.
- اختصارات المسارات: DC = `services/data-cleaning`، TA = `services/targeting-api`، CE = `services/contact-enrichment`، TX = `docs/qa/targeting/taxonomy`.
- **حقول الاتصال** في أي مصدر تذهب إلى `contact_points`، لا إلى الجدول المذكور في عمود «الجدول المقترح» (سياسة الحمولة في النموذج).
- «(مطلق)» = مسار محلي مطلق على جهاز مطوّر. هذا المسار لا يُعاد بناؤه من مستودع نظيف.

## 1. المنشآت ودليلها

| المصدر | سكربت الإدخال | المدخل | الحبيبة | مفتاح الربط | الترخيص | التاريخ | الحقول الحساسة | الجدول المقترح |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| الدليل الحي (هدهد، ووسوم مصادر مختلطة) | لا باني في المستودع | `targets.parquet` (مطلق، و`/app/data` على الخادم) | منشأة | `poi_key` (`hh:`) | غير مذكور | غير مذكور | هاتف، واتساب، بريد | `source_records` ← `establishments` |
| سجلات وطلبات تعديل هدهد (CSV/xlsx) | DC/import_hudhud_logs.py، وDC/lifecycle_profile.py (أعداد مجمّعة لتصميم دورة الحياة) | مجلد CSV | سجل تعديل لكل منشأة | `hh:` + المعرّف | غير مذكور | 2025-08-28 | المحرّر، هاتف، عنوان وطني | `attribute_assertions`، `events` |
| تصدير CRS الكامل لهدهد (110,831 طلباً) | DC/import_crs_full.py | `/Volumes/Archive/Cr/crs_export.csv` (مطلق) | آخر طلب معتمد لكل منشأة | `hh:` + eid | غير مذكور | غير مذكور | هاتف، حسابات، عنوان وطني، رخصة | `attribute_assertions` (أعلى أولوية) |
| قاعدة poi_logs لهدهد (SQLite) | DC/import_poi_logs_db.py | ملف `.db` | آخر سجل معتمد | `transaction_id` | غير مذكور | 2024-10 حتى 2025-09 | المحرّر | `events` |
| أرشيف 13: حالة TRX ودفعات Google | DC/import_archive13.py | مجلد CSV | معاملة / مكان | `hh:` أو الهاتف | غير مذكور | 2026-10-15 | هاتف | `events`، `attribute_assertions` |
| أوراق Drive لهدهد | DC/import_drive_sheets.py | xlsx في Google Drive (مطلق) | منشأة | معرّف TRX | غير مذكور | 2024-12 | هاتف، موقع، حسابات | `attribute_assertions` |
| قاموس أسماء هدهد | DC/name_dictionary.py | ملف (نسخة على `/Volumes/Archive`) | زوج أسماء | الاسم المطبّع | غير مذكور | 2025-08-16 | — | مرجع تحويل، لا جدول حقائق |
| بحيرة الكيانات (4.41 مليون، 12 مصدراً) | DC/lake_gap.py، build_new_entities.py، fill_names.py | `entities_master.parquet` (مطلق) | كيان | `entity_id`، SynCode، الهاتف ضمن 2 كم | غير مذكور | غير مذكور | جوال، بريد | `source_records` لكل مصدر داخلها |
| master_poi_candidates (1.9 مليون) | DC/candidates_gap.py | غير مذكور | مرشّح | `dedupe_key`، google_id | غير مذكور | غير مذكور | هاتف | `source_records`، ومعظمه `unresolved` |
| Urbi/2GIS cleaned_data وwestern_cleaning (عمود `makani` فيه العنوان الوطني المختصر، و`building_id` معرّف مبنى 2GIS) | DC/import_cleaned_data.py | CSV | منشأة | الهاتف ضمن 2 كم، أو الاسم ضمن 150 م | غير مذكور | 2025-03 | هاتف، اسم قانوني | `attribute_assertions`، `legal_entities` |
| 2GIS بطاقات الشرقية | DC/import_eastern_cards.py | CSV | بطاقة | SynCode | غير مذكور | 2024-01 | — | `attribute_assertions` |
| 2GIS منشآت برخصة تجارية (232,458) | DC/import_firms_license.py، build_farq_golden.py | dbf/xlsx/shp | بطاقة | SynCode ← `urbi_coords:` | حقوق تجارية أكّدها المالك (DC/FARQ_GOLDEN_V1.md:3) | 2024-02 | اسم الشريك (شخص) | `legal_entities`، `attribute_assertions` |
| 2GIS Rubricator 2025 | DC/apply_rubricator.py | xlsx | تصنيف | التسمية ← `sub_id` | غير مذكور | 2025 | — | `taxonomy_crosswalk` |
| Urbi brand 2025، bluepages | DC/build_cleaned_brand_enrichment.py | xlsx/CSV | منشأة / علامة | غير مذكور | غير مذكور | 2025 | غير مذكور | `brands`، `attribute_assertions` |
| أرشيف 11: العلامات، GMB، موردو المقاولات | DC/import_archive11.py | CSV | منشأة / علامة | معرّف هدهد، Google place id | غير مذكور | GMB 2024-05-21 | هاتف | `brands`، `attribute_assertions` |
| Overture Maps places | DC/overture_match.py، overture_new.py | parquet | مكان | الاسم ضمن ~100 م؛ `ov:` | CDLA-Permissive-2.0، وODbL لما أصله OSM (overture_match.py:1) | 2026-09-23.1 | هاتف، بريد | `source_records` |
| Foursquare OS Places | DC/fsq_places.py | `/Volumes/Archive/FSQ` (مطلق) | مكان | الاسم ضمن ~100 م؛ `fsq:` | Apache-2.0 (fsq_places.py:1) | 2026-10-15 | هاتف، معرّف فيسبوك | `source_records` |
| OpenStreetMap (أماكن، شوارع، حدود إدارية، محلات) | DC/osm_*.py | `.osm.pbf` | عقدة / طريق / علاقة | النقطة داخل المضلع، أو الأقرب | ODbL، مع إسناد وبقاء مشتق (README.md:63) | غير مذكور | هاتف | `attribute_assertions` بترخيص منفصل |
| Google Maps عبر Serper | CE/serper_*.py، DC/serper_discover_new.py | API، والمفتاح خارج المستودع | مكان | ضمن 50 م بالنشاط الرئيسي نفسه؛ `gm:` | مفتاح بموافقة المالك (README.md:81)؛ شروط Google غير مذكورة | 2026-10-16 | هاتف | `attribute_assertions` |
| مواقع المنشآت | CE/website_phones.py | زحف يحترم robots.txt | منشأة | `poi_key` | — | 2026-10-15 | جوال التاجر الفرد بيانات شخصية (CE/README.md:16) | `contact_points` |
| موردو قاعدة البناء في فرق (146,201) | DC/farq_suppliers_layer.py | `farq_suppliers.parquet` (مطلق) | مورد | `farq:`، الهاتف والاسم | داخلي | 2026-10-09 | هاتف، واتساب (تصريح ذاتي) | `source_records`، `contact_points` |
| قاعدة البناء (Postgres) | TA/server.py | `CONSTRUCTION_DB_URL` | طلب تسعير / مورد / دعوة | `external_key = 'golden:<poi_key>'` | داخلي | حي | واتساب، بريد | خارج النموذج: منتج يستهلكه |

## 2. الجغرافيا والسكان والعقار

| المصدر | سكربت الإدخال | المدخل | الحبيبة | مفتاح الربط | الترخيص | التاريخ | المدن | الجدول المقترح |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| أطلس الأحياء (777 حياً من وزارة البلديات + 6 حدود مدن) | لا باني في المستودع | `farq-poi-atlas.gpkg` (مطلق)، `districts.geojson` | مضلع حي | `id` ← المعرّف الموحّد عبر `district_corrections.json` | غير مذكور | غير مذكور | الرياض، جدة، مكة، المدينة، الدمام، الخبر | `districts`، `cities` |
| WorldPop 2025 (100 م، وأعمار وجنس) | DC/build_population_districts.py، build_population_demographics.py | GeoTIFF | حي × شريحة | `district_id` | CC-BY-4.0 | 2025 | مدن الأطلس | `population_facts` |
| مخططات المباني (2GIS) | TA/normalize_buildings.py، build_building_population.py، DC/unit_gap_profile.py | `buildings_ingest`، ومخزن مُعرَّف بـSHA | مبنى | `houseid`، المركز داخل المضلع | غير مذكور | غير مذكور | 7 مدن، منها الطائف | `buildings`، `population_facts`، `housing_facts`، `building_growth_facts` |
| نسخة المخططات المحلية (`Lenovo PS8S/GIS_UNIQUE/shapefiles/Buildings.shp`) | DC/unit_gap_profile.py | shp (مطلق) | مبنى | `HouseId`، وهو `building_id` في بطاقات Urbi | غير مذكور | غير مذكور | 1,800,958 مخططاً في 4 طبقات: الرياض، ومنطقة مكة (ومنها جدة)، والمدينة، والدمام (ومنها الخبر) | `buildings`، `site_building_links` |
| ربط المنشأة بالمبنى | DC/build_business_building_links.py | CSV | بطاقة ↔ مبنى | SynCode ↔ BuildSynCode | غير مذكور | غير مذكور | غير مذكور | `site_building_links` |
| خريطة 910ths | TA/build_910ths_reference.py (أداة الجمع خارج المستودع) | JSONL | حي | `district_ar` + `polygon_ids`، و`n910_names` | **غير مذكور** | 2026-10-27 | الرياض، الدرعية، جدة، مكة، الدمام، الخبر | `population_facts`، `income_facts` |
| سكان المدن الرسمي (تعداد 2022) | build_building_population `--official` | CSV مثال بلا أرقام | مدينة | `city_en` | غير مذكور | 2022 | الرياض، جدة | `population_facts` (معايرة) |
| صفقات البيع المسجلة (وزارة العدل) | TA/build_registered_deals.py | CSV | صفقة ← وسيط حي × تصنيف | اسم الحي نصاً، وصف «أخرى» لا يُربط | رخصة البيانات المفتوحة السعودية | 2025-Q2 حتى 2026-Q1، وسيط مجمّع | 138 مدينة | `property_deal_facts` |
| عروض عقار | TA/parse_aqar_list.py، build_real_estate_reference.py (أداة الجمع خارج المستودع) | JSON | عرض ← وسيط حي | الإحداثيات داخل المضلع؛ `aqar_id` | **غير مذكور** | `--retrieved` | حسب `--atlas` | `listing_observations`، `metric_values` |
| شبكة الطرق (فالهالا) | apps/atlas/app/api/routing | `VALHALLA_ORIGIN` | — | — | غير مذكور | — | — | خدمة، لا جدول |

## 3. تجميعات فرق (من مستودع farq-tech/farq)

لكل حي، تُقرأ من `api.farq.sa` بـ`atlas_district_id`، وتغطي 6 مدن. الحساب هناك، والأطلس يقرأ الناتج فقط.

| المؤشر | النقطة | القاعدة | الجدول المقترح |
| --- | --- | --- | --- |
| المطاعم على تطبيقات التوصيل | `/api/intelligence/map/city/<city>/districts` | المطعم الذي تتباعد فروعه لا يُنسب لحي | `metric_values` |
| مستوى الإنفاق (سعر الصنف) | `/map/city/<city>/menu-prices` | 5 مطاعم على الأقل لكل حي | `menu_price_facts` ← `metric_values` |
| الطلب غير الملبّى | `/api/intelligence/demand/city/<city>/districts` | 10 عمليات بحث في 3 أيام خلال 90 يوماً | `search_demand_facts` ← `metric_values` |
| أحداث الخريطة | `public.analytics_events` | جلسات بموافقة فقط | خارج النموذج: قياس المنتج |

## 4. التصنيف

| الملف | الحبيبة | المفتاح | الجدول المقترح |
| --- | --- | --- | --- |
| `farq_taxonomy.json` | 25 نشاطاً رئيسياً، و431 فرعياً | `main_id`، `sub_id` | `taxonomy` |
| `specialties.csv` (4,073)، `specialty_concepts.csv` | تخصص | `specialty_id`، `concept_id` | `taxonomy` (مستوى ثالث) |
| `activity_map.csv`، `hudhud_sub_map.csv`، Rubricator | تسمية مصدر ← فرعي | التسمية | `taxonomy_crosswalk` |
| `product_families.csv`، `sub_family_relations.csv`، `search_lexicon.csv` | عائلة / علاقة / مصطلح | `family_id`، المصطلح | `taxonomy` (علاقات) |
| `poi_taxonomy.parquet`، `poi_sector.parquet` | منشأة | `poi_key` | `establishment_classifications` |

## 5. أصول الإصدار الحالية

`TA/data_release.py:19` يطلب 7 أصول، و`release_data.py` يضيف `holder_rfq.json`.

| الأصل | الحبيبة | المفتاح | الجدول المقترح |
| --- | --- | --- | --- |
| `targets.parquet` | منشأة | `poi_key`، `farq_atlas_id` | واجهة `establishments` منشورة |
| `poi_taxonomy.parquet` | منشأة | `poi_key` | `establishment_classifications` |
| `street_density.parquet` | شارع × فرعي | غير مذكور (**لا باني في المستودع**) | `metric_values` |
| `trade_clusters.parquet` | تجمّع | DC/trade_clusters.py | `metric_values` |
| `districts.geojson` | حي | `id` | `districts` |
| `taxonomy/farq_taxonomy.json` | تصنيف | `sub_id` | `taxonomy` |
| `identity/source_to_farq_atlas_id.parquet` | مفتاح مصدر | `source_poi_key` | `record_links` |

## 6. ما كشفه الجرد

### بيانات لا يصح دمجها أو عرضها معاً
- **OSM مشروط بـODbL:** القاعدة الموزّعة التي تحمل قيمه تبقى ODbL. لذلك يبقى في ادعاءات مستقلة بترخيصها، ولا يُخلط في عمود واحد مع مصدر مغلق (README.md:63).
- **جوال التاجر الفرد بيانات شخصية** (نظام حماية البيانات الشخصية). الواتساب في دليل فرق تصريح ذاتي لا تحقق. يُحفظ في `contact_points` مع أساس المعالجة، ولا يُنسخ إلى جداول المؤشرات.
- **910ths وعقار بلا ترخيص مكتوب.** كلاهما يُعرض اليوم في الأطلس. يلزم تثبيت الترخيص قبل أي منتج جديد يقرأ منهما.
- **شروط Google عبر Serper غير مذكورة.** المذكور موافقة المالك على المفتاح والميزانية فقط.

### أرقام يُعاد تركيبها خارج جدولها الذهبي
- السكان لكل منشأة يُحسب في الواجهة: `apps/atlas/components/lens/lenses.ts:24`، و`advisor-panel.tsx:28`، و`tools/around-tool.tsx:96`، و`tools/competitors-tool.tsx:108`.
- حجم الجمهور = السكان × نسبة الذكور × نسبة السعوديين في `tools/audience-tool.tsx:108`. هذا يفترض استقلال النسبتين.
- حجم الأسرة `5.0` مكرر: `TA/server.py:120` و`build_building_population.py:66`.
- `market_analytics.market_gaps` يحسب معدل المدينة والعدد المتوقع داخل الخدمة.
- `DC/build_poi_population_links.py` ينسخ سكان WorldPop إلى صف كل منشأة، ويدخل `farq_golden_v3`. هذا خلط حبيبة الحي بحبيبة المنشأة، ويتجاوز `golden.population`.
- صفقات البيع تُربط بالحي بالاسم لا بالمعرّف.

### فجوات في قابلية إعادة البناء
- لا باني في المستودع لثلاثة أصول: الدليل الأساسي `targets.parquet`، و`street_density.parquet`، و`districts.geojson`. ولا باني لبحيرة الكيانات أيضاً.
- 46 سكربتاً في DC وTA وCE والتصنيف تذكر مسارات مطلقة (`/Users/m4pro/...`، `/Volumes/...`).
- عدد السجلات الذهبية مختلف بين `GOLDEN_SCHEMA.md` (2,271,487) و`DC/README.md:93` (2,250,123)، و2,657,921 في إصدار الهوية المرحلي. لا يوجد manifest يقول أيها المنشور.
- الترخيص مكتوب للمصادر المفتوحة فقط (Overture، Foursquare، OSM، WorldPop، وزارة العدل) ولـ2GIS برخصة المالك. أغلب البقية غير مذكور.

### مصادر مذكورة بلا سكربت إدخال
المسح الميداني `finalgeo` (1,324 نقطة، فبراير ومارس 2026، مذكور في `docs/establishment-lifecycle.md` 4.5)، وقاعدة معاملات هدهد (592,710 معاملة)، و1,215 مضلع مسح، وأداتا جمع 910ths وعقار، وأرقام التعداد الرسمي، وجدول «Google to Hudhud Categories» الأصلي.

## 7. المطلوب لإكمال الكتالوج

- **الملفات التي وصلت خارج المستودع:** تُضاف هنا صفاً صفاً بالأعمدة نفسها.
- **المالك ودورية التحديث ونسبة النقص لكل مصدر:** لا يذكرها الكود. يملؤها صاحب كل مصدر.
- **الترخيص:** كل «غير مذكور» في عمود الترخيص يحتاج قراراً مكتوباً قبل أن يدخل المصدر إصداراً جديداً.
