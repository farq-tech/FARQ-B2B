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
| الدليل الحي (SPD، ووسوم مصادر مختلطة) | لا باني في المستودع | `targets.parquet` (مطلق، و`/app/data` على الخادم) | منشأة | `poi_key` (`hh:`) | غير مذكور | غير مذكور | هاتف، واتساب، بريد | `source_records` ← `establishments` |
| سجلات وطلبات تعديل SPD (CSV/xlsx) | DC/import_spd_logs.py، وDC/lifecycle_profile.py (أعداد مجمّعة لتصميم دورة الحياة) | مجلد CSV | سجل تعديل لكل منشأة | `hh:` + المعرّف | غير مذكور | 2025-08-28 | المحرّر، هاتف، عنوان وطني | `attribute_assertions`، `events` |
| تصدير CRS الكامل لSPD (110,831 طلباً) | DC/import_crs_full.py | `/Volumes/Archive/Cr/crs_export.csv` (مطلق) | آخر طلب معتمد لكل منشأة | `hh:` + eid | غير مذكور | غير مذكور | هاتف، حسابات، عنوان وطني، رخصة | `attribute_assertions` (أعلى أولوية) |
| قاعدة poi_logs لSPD (SQLite) | DC/import_poi_logs_db.py | ملف `.db` | آخر سجل معتمد | `transaction_id` | غير مذكور | 2024-10 حتى 2025-09 | المحرّر | `events` |
| أرشيف 13: حالة TRX ودفعات Google | DC/import_archive13.py | مجلد CSV | معاملة / مكان | `hh:` أو الهاتف | غير مذكور | 2026-10-15 | هاتف | `events`، `attribute_assertions` |
| أوراق Drive لSPD | DC/import_drive_sheets.py | xlsx في Google Drive (مطلق) | منشأة | معرّف TRX | غير مذكور | 2024-12 | هاتف، موقع، حسابات | `attribute_assertions` |
| قاموس أسماء SPD | DC/name_dictionary.py | ملف (نسخة على `/Volumes/Archive`) | زوج أسماء | الاسم المطبّع | غير مذكور | 2025-08-16 | — | مرجع تحويل، لا جدول حقائق |
| بحيرة الكيانات (4.41 مليون، 12 مصدراً) | DC/lake_gap.py، build_new_entities.py، fill_names.py | `entities_master.parquet` (مطلق) | كيان | `entity_id`، SynCode، الهاتف ضمن 2 كم | غير مذكور | غير مذكور | جوال، بريد | `source_records` لكل مصدر داخلها |
| master_poi_candidates (1.9 مليون) | DC/candidates_gap.py | غير مذكور | مرشّح | `dedupe_key`، google_id | غير مذكور | غير مذكور | هاتف | `source_records`، ومعظمه `unresolved` |
| Urbi/2GIS cleaned_data وwestern_cleaning (عمود `makani` فيه العنوان الوطني المختصر، و`building_id` معرّف مبنى 2GIS) | DC/import_cleaned_data.py | CSV | منشأة | الهاتف ضمن 2 كم، أو الاسم ضمن 150 م | غير مذكور | 2025-03 | هاتف، اسم قانوني | `attribute_assertions`، `legal_entities` |
| 2GIS بطاقات الشرقية | DC/import_eastern_cards.py | CSV | بطاقة | SynCode | غير مذكور | 2024-01 | — | `attribute_assertions` |
| 2GIS منشآت برخصة تجارية (232,458) | DC/import_firms_license.py، build_farq_golden.py | dbf/xlsx/shp | بطاقة | SynCode ← `urbi_coords:` | حقوق تجارية أكّدها المالك (DC/FARQ_GOLDEN_V1.md:3) | 2024-02 | اسم الشريك (شخص) | `legal_entities`، `attribute_assertions` |
| 2GIS Rubricator 2025 | DC/apply_rubricator.py | xlsx | تصنيف | التسمية ← `sub_id` | غير مذكور | 2025 | — | `taxonomy_crosswalk` |
| Urbi brand 2025، bluepages | DC/build_cleaned_brand_enrichment.py | xlsx/CSV | منشأة / علامة | غير مذكور | غير مذكور | 2025 | غير مذكور | `brands`، `attribute_assertions` |
| أرشيف 11: العلامات، GMB، موردو المقاولات | DC/import_archive11.py | CSV | منشأة / علامة | معرّف SPD، Google place id | غير مذكور | GMB 2024-05-21 | هاتف | `brands`، `attribute_assertions` |
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
| مخططات المباني (2GIS) | TA/normalize_buildings.py، build_building_population.py، DC/unit_gap_profile.py | `buildings_ingest`، ومخزن مُعرَّف بـSHA | مبنى | `houseid`، المركز داخل المضلع | غير مذكور | غير مذكور | `normalize_buildings.py` يعرف 7 أسماء مدن منها الطائف؛ الطبقة المقيسة في `establishment-lifecycle.md` 3.2.1 تغطي 6 بلا الطائف | `buildings`، `population_facts`، `housing_facts`، `building_growth_facts` |
| نسخة المخططات المحلية (`Lenovo PS8S/GIS_UNIQUE/shapefiles/Buildings.shp`) | DC/unit_gap_profile.py | shp (مطلق) | مبنى | `HouseId`، وهو `building_id` في بطاقات Urbi | غير مذكور | غير مذكور | 1,800,958 مخططاً في 4 طبقات: الرياض، ومنطقة مكة (ومنها جدة)، والمدينة، والدمام (ومنها الخبر) | `buildings`، `site_building_links` |
| ربط المنشأة بالمبنى | DC/build_business_building_links.py | CSV | بطاقة ↔ مبنى | SynCode ↔ BuildSynCode | غير مذكور | غير مذكور | غير مذكور | `site_building_links` |
| خريطة 910ths | TA/build_910ths_reference.py (أداة الجمع خارج المستودع) | JSONL | حي | `district_ar` + `polygon_ids`، و`n910_names` | **غير مذكور** | 2026-10-27 | نسب السكان والجنسية ضمن مدن المصدر؛ دخل العامل المقاس في واجهة الإنتاج حالياً بالرياض فقط (143 حياً) | `population_facts`، `income_facts` |
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
| `activity_map.csv`، `spd_sub_map.csv`، Rubricator | تسمية مصدر ← فرعي | التسمية | `taxonomy_crosswalk` |
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
- السكان لكل منشأة يردان محسوبين من خدمة الاستهداف عبر `district_metrics.residents_per`؛ واجهات الخريطة والدوائر والمنافسين تقرأ `residents_per` من رد الخدمة وتقرّب الرقم للعرض فقط.
- حجم كل شريحة جمهور يُحسب مرة واحدة في الخدمة في `services/targeting-api/district_metrics.py:53`، ثم يستهلكه `district-audience`: السكان × الحصة المقاسة للرجال أو النساء، والسكان × الحصة المقاسة للسعوديين أو غير السعوديين. عند اختيار الجنس والجنسية معاً تعرض الواجهة الرقمين منفصلين، وتلوّن الخريطة وفق الشريحة المختارة للترتيب؛ لا يتوفر قياس تقاطع مثل «الرجال السعوديين»، فلا يُركّب من النسبتين.
- حجم الأسرة `5.0` افتراض معلن واحد في `build_building_population.py:66` لنموذج إجمالي السكان المبني على الوحدات؛ لا تستخدمه الواجهة بديلاً عن قياس السكان الذهبي.
- `market_analytics.market_gaps` يحسب معدل المدينة والعدد المتوقع داخل الخدمة.
- `DC/build_poi_population_links.py` ينسخ سكان WorldPop إلى صف كل منشأة، ويدخل `farq_golden_v3`. هذا خلط حبيبة الحي بحبيبة المنشأة، ويتجاوز `golden.population`.
- صفقات البيع تُربط بالحي بالاسم لا بالمعرّف.

### فجوات في قابلية إعادة البناء
- لا باني في المستودع لثلاثة أصول: الدليل الأساسي `targets.parquet`، و`street_density.parquet`، و`districts.geojson`. ولا باني لبحيرة الكيانات أيضاً.
- 46 سكربتاً في DC وTA وCE والتصنيف تذكر مسارات مطلقة (`/Users/m4pro/...`، `/Volumes/...`).
- عدد السجلات الذهبية مختلف بين `GOLDEN_SCHEMA.md` (2,271,487) و`DC/README.md:93` (2,250,123)، و2,657,921 في إصدار الهوية المرحلي. لا يوجد manifest يقول أيها المنشور.
- الترخيص مكتوب للمصادر المفتوحة فقط (Overture، Foursquare، OSM، WorldPop، وزارة العدل) ولـ2GIS برخصة المالك. أغلب البقية غير مذكور.

### مصدر حدود الأحياء للمدن خارج أطلس الأحياء الأساسي

- `services/targeting-api/import_national_address_districts.py` يقرأ مجموعة `yasseralsamman/saudi-national-address` المثبتة على commit `deedf8ce8afa6eabe1abd0b7b8ec1ada7dddddf4`، ويضيف أحياء المدن الغائبة فقط إلى نسخة مرشحة من `districts.geojson` في مجلد البيانات الخارجي. لا يكتب فوق المدخلات ولا يضع الهندسة في Git.
- نشرت المجموعة 3,732 مضلع حي بمعرّفات SPL، وأعلنت CC0-1.0 لملفات البيانات، وذكرت أن أصل البيانات `homaily/Saudi-Arabia-Regions-Cities-and-Districts`، الذي يضع GPL-2.0. العلاقة بين الترخيصين وحق إعادة الترخيص لم يُتحقق منها مستقلاً؛ اعتمد المستخدم هذا المصدر صراحةً وأُدخلت البيانات في v19، ويظل هذا التعارض موثقاً إلى أن يُحسم.
- بُني في 2026-11-08 مرشح إصدار خارجي مستقل من `/Volumes/farq/release_build/atlas-2026-11-02-v8-unified/districts.geojson`: أضاف 3,052 مضلعاً إلى الـ777 الموجودة، فأصبح الإجمالي 3,829 مضلعاً. أوردت المراجعة وقتها 152 مدينة، لكن لم يكن العدد مبنياً على مفتاح مدينة موحّد، فلا يُستخدم كمقياس للتغطية. تشمل الإضافات 90 حياً في عنيزة. أصلح المستورد 13 هندسة، واستبعد شكلاً غير صالح/خارج النطاق، ونسخة حدود مكررة، ومضلعين ملتبسين يتداخلان كلياً تقريباً مع أحياء مدن أخرى. فحص المرشح الكامل لم يجد هندسات غير صالحة أو معرفات مكررة أو تداخلات جديدة بين المدن. الإصدار المرشح: `/Volumes/farq/release_build/atlas-2026-11-08-v9-national-districts-release-candidate/`، ومعرّفه `b164e22516057c6b8af87a8c64c0e80dff5b0af2ada161b724a47e3538554e12`. لم يُفعّل في الإنتاج.
- مراجعة `atlas-2026-11-03-v18-dedup` (بصمة الأساس `04fff1d8ef770f590600990ad47f77b488c3d32df1da3f2c51ce60a73f00026f`) وجدت أن 3,072 مضلعاً من المصدر موجودة أصلاً بمعرّف وهندسة مطابقين؛ لم تُستورد ثانية. أضيفت 11 حدوداً لمدينة الظهران، واستُبعد حد «أجيال» لتداخله بالكامل مع حد قائم في الخبر وحد مطابق. أصلح المستورد 13 هندسة مع تغيّر مساحة دون 0.5%، وترك هندسة مطار الملك خالد (تغيّر المساحة 8%) وحد «السيح» ذي المساحة الصفرية دون تعديل. مرشح الملف: `/Volumes/farq/release_build/atlas-2026-11-08-v19-national-districts-candidate/districts.geojson`، بصمة `65119fccbef5964182a33f82c015760e27dc755d6cb192c18d14463bb855dec5`.
- الإصدار النشط في Railway production هو `atlas-2026-11-08-v19-national-districts`، مبني كنسخة كاملة من v18 مع استبدال `districts.geojson` فقط. يحتوي 3,860 مضلعاً و192 قيمة إنجليزية مميزة في `city_en`، بينما تحمل 152 قيمة عربية مميزة في `city_ar`؛ لا يصلح أي من عددي الأسماء وحده لقياس تغطية المدن بسبب اختلاف الأسماء بين العمودين. من 74 مدينة فيها 1,500 منشأة فأكثر في إصدار الإنتاج، تطابق 69 مدينة مفتاح حدودها `city_en` حرفياً؛ المدن الخمس غير المغطاة هي المظيلف وساجر ومطيعة وأضم وبارق. المعرّفات فريدة ولا توجد تداخلات جديدة بين المدن، وتبقى هندستان غير صالحتين من بيانات الأساس. تحقق `release.manifest.json` وملف `manifest.json` من جميع الأصول الـ18 وبصمة ملف الحدود. نُشر في Railway deployment `8fdd557f-4197-4a47-88ce-ed1c5e89dc81`؛ الخدمة Online و`/healthz` يعيد 200. بقي إصدار v18 على القرص للرجوع.
- **قراءة الإنتاج الحالية (2026-11-10):** أعاد `GET https://atlas.farq.sa/api/market/cities` الرياض مع `districts: 193`، وأعاد `GET /api/market/districts?city=Riyadh` 193 مضلعاً بأسماء ومعرّفات فريدة. ما زال الكتالوج يعرض 74 مدينة، 69 منها ذات حدود، والخمس غير المغطاة كما سبق. لذلك فإن رقم 192 في سجل v19 أعلاه يصف لقطة الملف وقت توثيق الإصدار؛ لا يطابق عدد حدود الرياض الذي تعرضه الخدمة الآن. واجهات الإنتاج لا تعيد معرّف إصدار أو بصمة، لذلك لا يمكن نسبة الفرق بثقة إلى إصدار ملف بعينه.
- **تصحيحات الخرج واستيراد الأحياء (مرشح محلي، لم يُنشر، 2026-11-10):** معرّف SPL `10101061033` («قاعدة الأمير سلطان الجوية») ومعرّف `10101061032` («المدينة الصناعية بالخرج») كانا ضمن حدود الرياض وAd Dilam؛ هندستهما تطابق سجل National Address المثبت للخرج (`city_id=1061`). دليل الطيران السعودي يضع OEPS في الخرج. نُقل الحدان في التصحيحات ووُحّد «السيح» مع «الخرج»؛ الأدلة: [National Address dataset pinned commit](https://github.com/yasseralsamman/saudi-national-address/tree/deedf8ce8afa6eabe1abd0b7b8ec1ada7dddddf4) و[Saudi AIP، Al Kharj / Prince Sultan Air Base](https://aimss.sans.com.sa/assets/FileManagerFiles/AIRAC%20AIP%20AMDT%2011_26_2026_10_29/eAIP/AD%202%20OEPS%20AL%20KHARJ%20-%20PRINCE%20SULTAN%20AIR%20BASE-en-US.html). يحتوي المصدر على 43 معرّفاً للخرج: 34 كانت تحت «السيح»، واثنان صُحّح إسنادهما، وثلاثة أضيفت في مرشح الحدود. أربعة أخرى موجودة في الإنتاج تحت «Al Hayathim» وتطابق هندستها المصدر؛ أُبقِيت هناك لأن لها بلدية مستقلة في [موقع وزارة البلديات والإسكان](https://momah.gov.sa/ar/branches/bldyt-alhyathm) و[أمانة الرياض](https://alriyadh.gov.sa/ar/municipalities/al-haytham)، ما يعني أن مصدر العنوان يجمع وحدات بلدية أدق تحت مدينة الخرج ولا يكفي وحده لإعادة تصنيفها.

- **فحص مرشح الاستكمال:** جُمعت حدود المدن الـ74 من واجهة الإنتاج (2,597 معلماً، وتطابقت أعداد كل مدينة مع الكتالوج) ثم شُغّل المستورد على المصدر المثبت. المرشح خارج Git يضم 3,817 معلماً فريداً؛ استورد 1,220 حداً، منها ثلاثة للخرج، وتخطى أربع حالات تداخل بين مدن للمراجعة، ولم يُدخل تداخلات جديدة بين المدن. استُبدلت خمس هندسات مكة غير الصالحة بنظائر صالحة مطابقة للمدينة والاسم، بتداخل بين 95.7% و99.1% مع الإصلاح الهندسي المؤقت؛ بقي مضلع مطار الملك خالد فقط غير صالح لعدم وجود حد مصدري صالح مطابق. لا يبقى تداخل بين المدن بعد التوحيد. المصدر المعلن CC0 لكن مستودعه الأعلى يشير إلى GPL-2.0؛ يلزم حسم الترخيص ومراجعة حالات التداخل والمضلع المتبقي قبل اعتماد إصدار بيانات أو نشره.
- تدقيق التغطية في 2026-11-08: فهرس طبقة [NCM `districts.mbtiles`](https://meteo.ncm.gov.sa/tileserver/data/districts.json) يعلن 3,732 مضلعاً و152 قيمة `city_id` بمعرّفات أحياء من 11 خانة؛ لم يظهر في بياناته العددية ما يثبت تغطية المدن الخمس. معاينة بيانات OSM مباشرة ضمن صناديق المدن الخمس لم تجد مضلعات `place=neighbourhood/suburb/quarter`؛ أظهرت فقط حدود مناطق/محافظات إدارية في بعض المواقع. خدمة [الخرائط الحضرية من بلدي](https://momah.gov.sa/en/node/15098) مرشح رسمي لتغطية المدن، لكن [دليل الاستخدام](https://balady.gov.sa/sites/default/files/service/User_Guide_for_The_Service_of_the_Urban_Maps.pdf) المتاح يمر بتسجيل الدخول ولا يوثق تنزيل طبقة الحدود. لا تُنشأ أحياء اصطناعية من النقاط أو حدود المحافظات.
- فحص طبقة مرئية أخرى على [خادم بلاطات NCM](https://meteo.ncm.gov.sa/tileserver/data/Districts_Boundaries.json) في 2026-11-09: بياناتها الوصفية تعلن 5,251 مضلعاً وحقول المدينة والحي والبلدية. عينة بلاطات z13 ضمن 5×5 حول مركزي المدن وجدت 11 حياً لساجر و4 لأضم، ولم تجد أحياءً للمظيلف أو مطيعة أو بارق. لم تُستورد البلاطات أو تُدمج، لأنها ليست ملف الحدود المصدر ولا تحمل ترخيص بيانات واضحاً، كما أن شروط [مركز الأرصاد](https://www.ncm.gov.sa/en/term-of-use) تمنع النسخ والتعديل والتوزيع والاستخدام التجاري لمحتوى الموقع دون إذن كتابي. هذه قرينة تغطية أولية وليست هندسةً صالحة للإصدار.
- استكمال تدقيق GEOSA في 2026-11-09: ملف [فهرس البيانات المتجهة المفتوح](https://www.geosa.gov.sa/ar/About/Documents/opendatafiles/%D8%A8%D9%8A%D8%A7%D9%86%D8%A7%D8%AA%20%D9%85%D8%AA%D8%AC%D9%87%D8%A9%20Vector.xlsx) يذكر قاعدة بيانات متجهة وطنية بمقياس 1:25,000 وتغطية المملكة (2016–2017)، لكنه لا يسرد طبقاتها أو يتيح تنزيل قاعدة البيانات. صفحة [مخرجات مشروع GEOSA](https://www.geosa.gov.sa/en/About/NationalProject/ProductionProjects/FifthProject/Pages/ProjectOutputs.aspx) تؤكد وجود بيانات حدود إدارية، ومثالها الأحياء، ضمن قاعدة تضم 15 مجموعة؛ لا تكشف الصفحة ملف الحدود أو تغطية المدن الخمس. قواعد [المنصة الجيومكانية الوطنية](https://www.geoportal.sa/Geoportal/TermsOfUse) تقصر الاستخدام العام على الشخصي، وتحظر النسخ والتعديل والاستخدام التجاري لمحتواها دون موافقة خطية مسبقة؛ كما يذكر [إطار حوكمة البيانات الجيومكانية الوطنية](https://www.geoportal.sa/Geoportal/pdf/National%20Geospatial%20Data%20Governance%20Framework.pdf) أن الاستخدام التجاري يخضع لترخيص وتسعير المنتج والجهات المالكة. النتيجة: GEOSA أقوى مسار رسمي لطلب البيانات، لكنه ليس مصدراً صالحاً للإدخال التجاري حتى تُمنح صلاحية مكتوبة وتُسلّم هندسة الأحياء وتُفحص تغطيتها.
- فحص واجهة [العنوان الوطني للمطورين](https://api.address.gov.sa/apireference) في 2026-11-09: توثّق `LookupsGetDistricts` قائمة أحياء بحسب معرّف المدينة، وتوثّق [واجهة Get Extents](https://api.address.gov.sa/getextentsoffeature) حقول `districts` ونتيجةً هي `minx/miny/maxx/maxy` فقط، مع اشتراط رمز اشتراك؛ باقة Starter محدودة بـ5 طلبات في الدقيقة و100 طلب أسبوعياً لكل API. لم يظهر في المرجع العام تنزيل هندسة المضلع؛ أسماء الأحياء أو صندوق إحاطة لا يكفيان لبناء حدود. يمكن طلب صلاحية وصول إلى طبقة الحدود من الجهة، لكن لا تُحوّل هذه الواجهة الحالية إلى مصدر هندسي.
- فحص [usefksa/Saudi_GIS_Data](https://github.com/usefksa/Saudi_GIS_Data) عند الالتزام `13f218ecb41b64d8baa0af331f4a84dd4d95cfd7` في 2026-11-09: ملف `sa_neighborhoods.sql` يحوي `neCoordinates` و`swCoordinates` فقط، أي زاويتي صندوق لكل حي لا حدوده، وقائمة ملفات المستودع لا تتضمن تصريح ترخيص. رُفض كمصدر للمضلعات ولم تُحوّل الصناديق إلى أشكال؛ لا يسد فجوة المدن الخمس.
- تدقيق مباشر لملفي `cities.csv` و`districts.geojson` في الالتزام المثبت أعلاه، بعد مطابقة SHA-256 الموثقة في المستورد: معرّفات المدن `1631` المظيلف، `682` ساجر، `438` مطيعة، `3684` أضم، و`1297` بارق موجودة في فهرس المدن لكن لها **صفر** صفوف في مضلعات الأحياء. لذلك لا يستطيع هذا الإصدار من المصدر سد فجوة المدن الخمس؛ لا تُحوّل مراكز المدن أو صناديقها إلى أحياء.
- المصدر المنشور لا يغطي كل المدن التي يعرضها التطبيق. المدن التي لا يطابق اسمها قاموس الأطلس تُترك خارج المرشح حتى يراجع اسمها الموحّد ومطابقتها مع بيانات السوق.

### مصادر مذكورة بلا سكربت إدخال
المسح الميداني `finalgeo` (1,324 نقطة، فبراير ومارس 2026، مذكور في `docs/establishment-lifecycle.md` 4.5)، وقاعدة معاملات SPD (592,710 معاملة)، و1,215 مضلع مسح، وأداتا جمع 910ths وعقار، وأرقام التعداد الرسمي، وجدول «Google to Hudhud Categories» الأصلي.

## 7. المطلوب لإكمال الكتالوج

- **الملفات التي وصلت خارج المستودع:** تُضاف هنا صفاً صفاً بالأعمدة نفسها.
- **المالك ودورية التحديث ونسبة النقص لكل مصدر:** لا يذكرها الكود. يملؤها صاحب كل مصدر.
- **الترخيص:** كل «غير مذكور» في عمود الترخيص يحتاج قراراً مكتوباً قبل أن يدخل المصدر إصداراً جديداً.
