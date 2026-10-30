# نموذج بيانات فرق الموحّد

مسودة للمراجعة قبل كتابة أي جدول أو تغيير أي خدمة. النموذج للشركة كلها: أطلس منتج يقرأ منه، وليس شكله.

**المراجع:**
- مصادره مجرودة في `docs/atlas-data-inventory.md`.
- قواعد العرض في `docs/atlas-product-foundation.md`.
- الجداول الذهبية الحالية في `docs/golden-data.md`.

**العلاقة بتصميم دورة الحياة** (`docs/establishment-lifecycle.md`، النسخة 4، PR #638):
- **المرجع في ستة جداول:** هو المرجع في `source_records`، و`record_links`، و`events`، و`establishments`، و`sites`، و`buildings`، وفي قواعد الهوية والموقع (قسمه 4) وخطة التحقق (قسمه 5).
- **ما يضيفه هذا النموذج:** لا يعيد تعريف تلك الجداول. يذكر حقولها المشتركة ليُقرأ وحده، ويضيف ما حولها: سجل المصادر، والادعاءات، وبيانات الاتصال، والوقائع المكانية، والمؤشرات، والواجهات.
- **عند الاختلاف:** تصميم دورة الحياة يغلب، ويُصحَّح هذا الملف.
- **أسماء الجداول:** بصيغة الجمع كما في تصميم دورة الحياة.

## 1. لماذا

- **اليوم كل شيء صف منشأة.** السجل الذهبي يحمل 110 أعمدة (`GOLDEN_SCHEMA.md`) من نحو 45 مصدراً، بأعمدة `*_source` منفصلة لبعضها فقط. والسكان دخلوا صف المنشأة أيضاً في `farq_golden_v3` (`build_poi_population_links.py`).
- **المصدر يضيع عند الدمج.** لا يُعرف لكل قيمة متى رُصدت، ولا بأي ترخيص، ولا بأي نسخة قاعدة.
- **الربط بالهوية لقطة بلا تاريخ.** `source_to_farq_atlas_id.parquet` يقول أين يذهب المفتاح الآن، لا متى ربط ولا بماذا كان مربوطاً قبل الدمج.
- **الموقع هو الإحداثية.** لا يمكن قول إن منشأة انتقلت، أو إن منشأة جديدة خلفت أخرى في المحل نفسه.
- **المؤشرات تُركَّب في أماكن مختلفة.** السكان لكل منشأة يُحسب في أربعة أماكن في الواجهة، وحجم الأسرة مكرر في ملفين.

## 2. الطبقات الأربع

| الطبقة | ما تمثله | الجداول |
| --- | --- | --- |
| 1. المصادر والأدلة | ما ورد من كل مصدر، ومتى، وبأي ترخيص، وماذا يقول | `source_registry`، `source_releases`، `source_records`، `attribute_assertions`، `contact_points` |
| 2. الكيانات الموحّدة وروابطها | ما تتعامل معه منتجات فرق، وروابطه المنسوخة | `establishments`، `sites`، `buildings`، `brands`، `legal_entities`، `cities`، `districts`، `taxonomy`؛ والروابط `record_links`، `establishment_site_links`، `site_building_links` |
| 3. الوقائع عبر الزمن | أحداث المنشأة، وقياسات لها فترة ومكان وأبعاد | `events`؛ و`population_facts`، `income_facts`، `housing_facts`، `building_growth_facts`، `menu_price_facts`، `search_demand_facts`، `property_deal_facts`، `listing_observations` |
| 4. المؤشرات والإصدارات | تعريف الحساب وقيمه المنشورة | `metric_definitions`، `metric_values`، `data_releases` |

الاتجاه واحد: 1 ← 2 ← 3 ← 4.
- المنتجات تقرأ من 2 و3 و4 عبر واجهات مسمّاة (القسم 4).
- لا منتج يقرأ من الطبقة 1 مباشرة.

## 3. الجداول

### 3.1 المصادر والأدلة

**`source_registry`**: صف لكل مصدر في الكتالوج.
- `source_id` (مثل `hudhud_poi_logs`، `overture_places`، `worldpop`)
- `owner`، `license`، `license_terms_url`
- `share_alike`: هل يفرض الترخيص بقاء المشتق بترخيصه (ODbL)
- `attribution_required`
- `contains_personal_data`، `lawful_basis`
- `contact_fields`: أسماء حقول الاتصال في حمولة هذا المصدر (انظر سياسة الحمولة)
- `raw_retention_days`
- `refresh_cadence`، `grain`
- `status`: `active` / `archived` / `blocked_license`

**`source_releases`**: لقطة واحدة من مصدر.
- `source_release_id`، `source_id`
- `extracted_at`، `valid_from`، `valid_to` (فترة اللقطة نفسها، لا فترة ربط)
- `file_sha256`، `row_count`
- `ingest_script` و`ingest_commit`

**`source_records`**: كما في تصميم دورة الحياة (3.4)، صف لكل سجل وارد، لا يُعدَّل ولا يُحذف.
- **حقول تصميم دورة الحياة:**
  - `source_record_id` (مثل `poi_log:567668`)، و`source`.
  - `source_poi_id`: معرّف المعاملة أو النقطة في المصدر.
  - `observed_at`، `ingested_at`.
- **يضيف هذا النموذج:**
  - `source_release_id`.
  - `payload`: القيم كما وردت، بعد التنقيح أدناه.
  - `raw_ref`: مرجع النسخة الخام في الأرشيف المقيّد، أو فارغ بعد انتهاء الاحتفاظ.
  - `geom`، `geom_precision` (`point` / `district` / `city`).

#### سياسة حمولة `source_records`

بيانات الاتصال تعيش في `contact_points` وحده. الحمولة الخام قد تحملها، فتُعامل هكذا عند الإدخال:

1. **الاستخراج:** كل حقل مذكور في `contact_fields` يُستخرج إلى `contact_points` مع `source_record_id`.
2. **التنقيح:** يُحذف من `payload` الحقل كله، لا قيمته فقط. يبقى مكانه في `payload` مفتاح `contact_point_ids`.
3. **الفحص:** فحص الإدخال يبحث في كل الحقول النصية الباقية عن أنماط الهاتف السعودي والبريد والروابط المباشرة لواتساب. أي تطابق يوقف إصدار المصدر حتى يُضاف الحقل إلى `contact_fields`. هذا يلتقط الأرقام المكتوبة داخل الاسم أو الوصف.
4. **الخام:** الملف الأصلي كما ورد يُحفظ خارج قاعدة البيانات في أرشيف مشفّر مقيّد الصلاحية:
   - يُشار إليه بـ`raw_ref`.
   - يُستعمل فقط لإعادة بناء التحويل أو للتدقيق.
   - لا تقرؤه أي واجهة ولا أي مؤشر.
5. **الاحتفاظ:** بعد `raw_retention_days` يُحذف الخام ويُفرَّغ `raw_ref`.
   - السجل المنقّح والبصمة في `source_releases` يبقيان.
   - المدة قرار المالك (القسم 7).
   - المصدر الذي يحمل بيانات شخصية لا يدخل إصداراً بلا مدة مكتوبة.
6. **السجلات الشخصية الخالصة:** محرّر SPD واسم الشريك في رخصة 2GIS لا تُستخرج إلى `contact_points`. تُحذف من `payload` ولا تبقى إلا في الخام.

#### الادعاءات وبيانات الاتصال: مفتاحها السجل وحده

`attribute_assertions` و`contact_points` يتبعان قاعدة `events` في تصميم دورة الحياة: **مفتاحهما `source_record_id` فقط، ولا يُخزَّن فيهما `farq_atlas_id`**. المنشأة تُستنتج عند القراءة من `record_links`. السبب: هكذا لا يتغير الادعاء بعد كتابته، ولا يُنسخ حين يُعاد ربط سجله. وإعادة الربط نسخة جديدة في `record_links` وحدها.

**`attribute_assertions`**: قيمة واحدة لحقل واحد كما قالها سجل مصدر واحد. لا يُعدَّل ولا يُحذف منه صف.
- `assertion_id`، `source_record_id`
- `attribute` (`name_ar`، `sub_id`، `opening_hours`، `rating`، `license_end`…)، `value`
- `observed_at` (من السجل)، `valid_at` (متى تصدق، إن ذكرها المصدر)
- `confidence`، `transform_version`
- `license` (موروث من المصدر، ويُحفظ هنا ليفصل ODbL)

**ما لا يدخل هنا:**
- **الموقع:** مكانه `establishment_site_links`.
- **التغيّر:** «تغيّر الاسم» حدث `attribute_changed` في `events`، مشتق من سجلين متتاليين لنقطة المصدر نفسها. الادعاء يقول ما قاله السجل، والحدث يقول إن شيئاً تغيّر.
- **الحي:** ادعاء فقط للمنشأة التي لا موقع لها (3.3).

**`contact_points`**:
- `contact_id`، `source_record_id`
- `kind` (phone / whatsapp / email)، `value`
- `is_personal`، `verified`، `lawful_basis`، `observed_at`
- لا يدخل جداول المؤشرات.

**القراءة: أي منشأة؟** القراءتان تأتيان من `record_links`:
- **القيمة الحالية لمنشأة:** ادعاءات كل السجلات المربوطة بها في النسخة السارية اليوم. ثم يُختار لكل حقل ادعاء واحد بترتيب أولوية مكتوب في الكود.
  - هذا الترتيب موجود اليوم في عمود «Source priority» في `GOLDEN_SCHEMA.md`.
  - يصير بيانات قابلة للاختبار بدل منطق داخل سكربتات البناء.
- **القيمة كما كانت في تاريخ ت:** ادعاءات السجلات المربوطة بها في النسخة السارية عند ت، و`observed_at` فيها ≤ ت.

### 3.2 آلية واحدة لتاريخ الروابط

القواعد كلها في تصميم دورة الحياة، ولا يضيف هذا الملف قاعدة عليها:
- **3.4:** زمنا الصلاحية والتسجيل، والاستعلامان، والقيد الفريد.
- **3.4.1:** التصحيح، ومنه تصحيح `valid_from`.
- **3.4.2:** الجداول الثلاثة.
- **6.5:** ضمانات الكتابة.

| جدول النسخ | المفتاح | القيمة (الفارغ حالة صريحة) | الحدث الذي يكتب النسخة |
| --- | --- | --- | --- |
| `record_links` | `source_record_id` | `farq_atlas_id` (فارغ = `unresolved`) | `identity_resolved` |
| `establishment_site_links` | `farq_atlas_id` | `site_id` (فارغ = بلا موقع) | `site_reassigned`، والتعيين الأول منه بـ`from_site_id` فارغ |
| `site_building_links` | `site_id` | `building_id` (فارغ = المبنى غير معروف) | `site_rebased` |

**ما يعنيه ذلك لبقية هذا النموذج:**
- **حقول كل نسخة:** `link_id`، و`valid_from` (زمن الصلاحية، وقد يكون بأثر رجعي)، و`recorded_at` (زمن التسجيل = `decided_at` لحدثها بساعة النظام، لا `observed_at` ولا `ingested_at`)، و`decision_event_id`، و`method`، و`confidence`.
- **القيد الفريد:** (المفتاح، `valid_from`، `recorded_at`).
- **القرارات بأثر رجعي مسموحة**، وكل تصحيح يُكتب بـ`set_interval`. تصحيح `valid_from` نفسه، تقديماً أو تأخيراً، حالة منها.
- **القراءة للعرض والمؤشرات:** الاستعلام الأول، «أفضل ما نعرفه اليوم عن الزمن ت». هو ما تقرؤه الواجهات عند `as_of` الإصدار.
- **القراءة للتدقيق ولإعادة بناء إصدار سابق:** الاستعلام الثاني، «ما كان النظام يعرفه في الزمن ك»، بـ`recorded_at` ≤ ك. لكل إصدار `recorded_as_of` (3.6)، فيُعاد بناؤه كما نُشر.
- **الحقول الحالية مشتقة:** `establishments.site_id`، و`sites.building_id`، وملف `source_to_farq_atlas_id.parquet`، و`merged_source_poi_keys` نتيجة الاستعلام الأول عند الآن، ولا تُكتب مباشرة.

### 3.3 الكيانات الموحّدة

**`establishments`**: كما في تصميم دورة الحياة (3.3).

| الحقل | المعنى |
| --- | --- |
| `farq_atlas_id` | الهوية، ولا تُعاد لمنشأة أخرى أبداً. المنشأة فرع تشغيلي واحد في وحدة أو محل واحد |
| `site_id` | الموقع الحالي، **مشتق** من آخر نسخة في `establishment_site_links`، ومعه `assignment_confidence` |
| `legal_entity_id`، `brand_id` | روابط اختيارية بمصادرها |
| `lifecycle_status` | `unknown` · `operating` · `temporarily_closed` · `permanently_closed` |
| `identity_resolution_status` | `unresolved` · `resolved` · `duplicate_of:<id>` · `split_from:<id>` · `needs_review` |
| `data_quality_status` | `valid` · `needs_review` · `invalid` |
| `first_observed_at`، `last_observed_at` | أول وآخر رصد قائمة، ومصدر كل منهما |
| `opened_on`، `closed_on` | فارغان ما لم يذكر المصدر التاريخ صراحة، ولكل منهما `*_evidence` |
| `closure_observed_at` | أول رصد لحالة الإغلاق، ويختلف عن `closed_on` |
| `predecessor_id`، `successor_id` | تعاقب في الوحدة المعروفة نفسها، بقرار `succeeded_by` فقط |

هذه الحقول الحالية خلاصة مشتقة من `events` و`record_links`، والتاريخ فيهما لا هنا.

**`sites`**: كما في تصميم دورة الحياة (3.2). الموقع هو **الوحدة أو المحل**، لا المبنى ولا الإحداثية الخام.

| الحقل | المعنى |
| --- | --- |
| `site_id` | دائم: يُعطى مرة واحدة، ولا يُعاد حسابه من الإحداثيات |
| `building_id` | **مشتق** من آخر نسخة في `site_building_links` |
| `site_basis` | `unit`: وحدة أو محل معروف. `provisional` (**الموقع المؤقت**): الوحدة غير معروفة |
| `unit_ref`، `floor` | مع مصدر كل قيمة |
| `lon`، `lat` | |
| `assignment_confidence` | `high` للوحدة المعروفة، و`low` لكل موقع مؤقت |

**الموقع المؤقت وتعيين المنشأة إليه:**
- **عند الإنشاء:** المنشأة التي لا تُعرف وحدتها تُعيَّن إلى موقع مؤقت جديد، بنسخة في `establishment_site_links`.
- **حين تُعرف الوحدة:** نسخة جديدة تعيّنها إلى موقع `unit`، والمؤقت يبقى في التاريخ.
- **لا ربط بالقرب وحده:** الموقع المؤقت لا يُربط بموقع قائم قريب. يُربط فقط إن ربطته قاعدة هوية بالمنشأة التي تشغل ذلك الموقع (قسمه 4.2).
- **لا موقع للمبنى كله:** ولا مفتاح من الإحداثية أو من خلية 10 م. الخلية للترشيح فقط.
- **يضيف هذا النموذج:** المنشأة بإحداثية `district` أو `city` لا تُعيَّن إلى موقع، ولا يُنشأ لها موقع مؤقت. حيّها أو مدينتها ادعاء في `attribute_assertions`، والواجهة تعرض نقطة مرجع الحي كما اليوم. لو أُنشئ لها موقع لصارت كل منشآت الحي «في مكان واحد».

**`buildings`**: كما في تصميم دورة الحياة (3.1): `building_id` دائم، و`refs` بمصدر كل مرجع، و`lon`، و`lat`، و`district_id`، و`city_en`.

**بقية الكيانات** (من هذا النموذج):

| الكيان | المفتاح | من أين اليوم | ملاحظات |
| --- | --- | --- | --- |
| `brands` | `brand_id` | `brand`، `hh_brand_id`، Urbi brand | السلسلة تُعرَّف كما في `chain_consensus.py`، داخل المدينة |
| `legal_entities` | `legal_entity_id` | `license_no`، `legal_name` | لا دمج للمنشآت على رقم الرخصة وحده |
| `cities` | `city_id` | `CITY_ALIAS` | إملاء واحد بالعربية والإنجليزية |
| `districts` | `atlas_district_id` | `districts.geojson` + `district_corrections.json` | الاسم ليس هوية. الأسماء البديلة (910ths، وزارة العدل) في `district_aliases` |
| `taxonomy` | `main_id` / `sub_id` / `specialty_id` | `farq_taxonomy.json`، `specialties.csv` | تسميات المصادر في `taxonomy_crosswalk` |

`establishment_classifications` (`farq_atlas_id`، `sub_id`، `confidence`، `source`، `evidence`) يبقى جدولاً منفصلاً، كما هو `poi_taxonomy.parquet` اليوم.

### 3.4 أحداث المنشأة: `events`

تعريف واحد: `events` في تصميم دورة الحياة (3.6)، إضافة فقط. يحل محل `lifecycle_event` و`establishment_observation` في المسودة السابقة.

**مصدر الحدث:**
- كل حدث **قائم على `source_record_id`**، أي سجل المصدر الذي أظهره.
- `farq_atlas_id` **لا يُخزَّن في الحدث**.
- تُحفظ أيضاً `observed_at` (تاريخ صف المصدر) و`ingested_at`.
- `effective_at` و`effective_precision` (`day` · `month` · `unknown`) فقط إن ذكر المصدر تاريخ التغيير صراحة.
- القرارات تضيف `decision` و`confidence` و`method`.

**ربطه التاريخي:** المنشأة تُستنتج عند القراءة من `record_links` بمفتاح `source_record_id`:
- **ربطه يوم صدوره كما نعرفه اليوم:** الاستعلام الأول عند `observed_at` للحدث.
- **ربطه اليوم:** الاستعلام الأول عند الآن.
- **ربطه كما عرفه النظام في زمن ك:** الاستعلام الثاني (للتدقيق).

إعادة الربط لا تلمس الحدث، فالسؤالان لهما جواب دائماً.

**الأنواع** كما في التصميم:
- `observed`
- `attribute_changed`
- `site_reassigned`
- `lifecycle_observed`
- `identity_resolved`
- `quality_changed`
- `record_withdrawn`
- `succeeded_by`

و`site_rebased` لنسخ `site_building_links`، أُضيف إلى التصميم في نسخته 5 (3.4.2).

**ما كانت المسودة السابقة تسمّيه حدثاً، وأين صار:**

| في المسودة السابقة | في التصميم المدمج |
| --- | --- |
| `opened` | لا حدث. `opened_on` يُملأ فقط إن ذكره مصدر صراحة |
| `closed_temporary` / `closed_permanent` / `reopened` | `lifecycle_observed` بالحالة كما وردت. `closure_observed_at` غير `closed_on` |
| `relocated` | `site_reassigned` بالموقعين والدليل، وهو الذي يكتب نسخة `establishment_site_links` (لا العكس) |
| `deleted_by_surveyor` | `record_withdrawn`، ولا يغيّر أي حالة بنفسه |
| `license_expired` | ليس حدثاً: `license_end` ادعاء. انتهاء الرخصة لا يعني الإغلاق |
| التقييم وعدد المراجعات والساعات | ادعاءات في `attribute_assertions` بتاريخ رصدها |

### 3.5 الوقائع المكانية عبر الزمن

كل جدول وقائع يحمل الأعمدة المشتركة نفسها:
- **المكان:** `geo_level` (`building` / `district` / `city`)، و`geo_id`
- **الزمن:** `period_start`، `period_end`
- **القيمة:** `measure`، `value`، `unit`
- **الأصل:** `source_release_id`، `method`
- **التغطية:** `coverage` (مثل عدد المطاعم في الوسيط، أو عدد الصفقات)
- **الحالة:** `status`، وقيمه `measured` / `modelled` / `not_available`

ولكل نوع أبعاده الخاصة، كل بُعد من قائمة مضبوطة (جدول أبعاد في الطبقة 2)، لا نصاً حراً.

**`all`** قيمة صريحة للإجمالي. هكذا لا يُخلط صف الإجمالي بصف شريحة، ولا تُجمع الشرائح مرتين.

| الجدول | الحبيبة | الأبعاد | القياس (`measure`) | من أين اليوم |
| --- | --- | --- | --- | --- |
| `population_facts` | حي أو مبنى × سنة × شريحة | `sex` (all / male / female)، `nationality` (all / saudi / non_saudi)، `age_band` (all، ثم شرائح WorldPop كما هي: 0-1، 1-4، 5-9 … 85-89، 90+) | `count`، `share` | `golden.population` / `golden.demographics`، `building_points_<yr>` |
| `income_facts` | حي × فترة | `population_basis` (worker) | `mean_income` | `districts_910ths.json` |
| `building_growth_facts` | حي × سنة | `building_status` (under_construction / new) | `buildings`، `homes_under_construction`، `floor_area_m2` | `district_growth_<yr>` (`growth_by_district`) |
| `housing_facts` (مستوى السكن) | حي × سنة | `dwelling_type` (all / villa / flat) | `dwellings`، `share`، `mean_unit_area` | نموذج المباني (`build_building_population.py`) |
| `menu_price_facts` | حي × فترة | `price_basis` (cheapest_across_apps). لا بُعد نشاط اليوم: النقطة تعيد رقماً واحداً لكل حي | `median_item_price`، `priced_places` | api.farq.sa menu-prices (`min_places`، `min_items`) |
| `search_demand_facts` | حي × مصطلح × فترة | `term` كما أعادته فرق (all للإجمالي)، و`term_id`/`sub_id` إن رُبط المصطلح بـ`search_lexicon` (لا يُربط اليوم) | `searches`، `empty_results` (الطلب غير الملبّى) | api.farq.sa demand (`top_terms`، `top_unmet_terms`، `min_searches`، `min_days`، `window_days`) |
| `property_deal_facts` | حي × فئة × نافذة الأرباع | `property_class` (residential / commercial). الشروط ثابتة لا أبعاد: بيع، عقار واحد، 50 م² فأكثر | `median_price_per_m2`، `deals` | `registered_deals.json`: وسيط واحد مجمّع لـ4 أرباع (2025-Q2 حتى 2026-Q1)، لا لكل ربع |
| `listing_observations` | عرض × تاريخ الالتقاط | `offer_type` (rent / sale)، `property_type` (apartment / studio / floor / villa / house / room / other…)، `rent_period` | `price`، `area_m2`، `price_per_m2` | عقار (`aqar_id`، بلا هاتف المعلن) |

القواعد:
- **«غير متاح» قيمة مخزّنة:** `not_available` صف موجود لا صف مفقود. هكذا تعرف الشاشة الفرق بين «لم نقسه» و«قسناه ولا يوجد».
- **حدود ما قِيس:** بُعد لم يقسه المصدر لا يُملأ بنسبة مفترضة.
  - الجنس والجنسية `measured` في أحياء 910ths فقط. شرائح WorldPop للجنس والعمر `modelled`، كما في وثيقة المنتج.
  - الجنسية خارج 910ths `not_available`، لأن WorldPop لا يقيسها.
- **لا ضرب بين بُعدين:** شريحتان مقاستان كلٌّ على حدة لا تُضربان لتقدير تقاطعهما. يُخزَّن التقاطع فقط إن قاسه المصدر. هذا يمنع ما يفعله `audience-tool.tsx:108` اليوم.
- **ما لا يُربط بحي يبقى `unresolved`:** صف «أخرى» في صفقات وزارة العدل، والاسم الذي لا يطابق حياً في الأطلس، لا يُوزَّع على الأحياء.
- **لا مؤشر تاريخي للمنشآت** (معدل فشل، أو افتتاحات، أو «نشاط صمد») قبل انتهاء التحقق في تصميم دورة الحياة (قسماه 5 و6).

### 3.6 المؤشرات والإصدارات

**`metric_definitions`**: تعريف واحد لكل مؤشر يُعرض.
- `metric_id`، `name_ar`
- `numerator`، `denominator`، `unit`، `geo_level`
- `dimensions`: أبعاد الوقائع التي يقبلها (مثل `sub_id` للتشبّع)
- `min_coverage`: الحد الذي تحته تكون القيمة «غير متاح»
- `formula_ref`: مسار الدالة الوحيدة التي تحسبه
- `explanation_key`: مفتاحه في `apps/atlas/lib/explanations.ts`
- `comparable_across_cities`: false للدرجات من 100

**`metric_values`**: `metric_id`، `geo_id`، `period`، `dimension_values`، `value`، `status`، `data_release_id`.

**`data_releases`**: يعمّم `release.manifest.json` الحالي.
- الأصول وبصماتها
- `source_release_id` لكل مصدر داخل الإصدار
- `as_of`: زمن الصلاحية الذي تُقرأ عنده الروابط بالاستعلام الأول (3.2)
- `recorded_as_of`: آخر `recorded_at` دخل الإصدار، فيُعاد بناؤه بالاستعلام الثاني كما نُشر
- نتيجة فحوص القبول

**المنشآت المحسوبة في المؤشرات:** المنشآت التي تعرضها سياسة العرض في تصميم دورة الحياة (3.5). أي يُستبعد `permanently_closed` و`invalid` و`duplicate_of` فقط.

أمثلة لمؤشرات تُركَّب اليوم خارج مكانها، وتنتقل إلى `metric_definitions`:
- السكان لكل منشأة
- التشبّع
- حجم الجمهور
- أولوية الحي للتوزيع
- جاذبية الموقع
- الفجوة في `market_gaps`

## 4. واجهات المنتجات

- **ما تجمعه الواجهة:** كل منتج يقرأ واجهة مسمّاة تجمع ثلاثة أشياء:
  - الكيانات ونسخ روابطها السارية عند `as_of` الإصدار (الطبقة 2)؛
  - الوقائع والأحداث (الطبقة 3)؛
  - المؤشرات المحسوبة (الطبقة 4).
- **ما تمنعه:** لا تعيد الواجهة حساب مؤشر، ولا تقرأ من الطبقة 1.
- **الخام:** الأرقام الخام من الطبقة 3 تُعرض كما هي بحالتها (`measured` / `modelled` / `not_available`).

| المستخدم | الواجهة | الطبقة 2 | الطبقة 3 | الطبقة 4 |
| --- | --- | --- | --- | --- |
| صاحب المتجر | `v_site_selection` | `establishments` حسب النشاط، و`sites` عبر `establishment_site_links` السارية، و`districts` | `population_facts`، `income_facts`، `housing_facts`، `building_growth_facts` | الجاذبية، السكان لكل منشأة |
| المسوّق | `v_audience` | `districts`، `establishments`، وعدد المنشآت التي لها `contact_points` قابلة للتواصل، بلا القيم | `population_facts` المقاس فقط، `income_facts` | كثافة الجمهور المستهدف |
| الموزّع | `v_distribution` | `establishments`، `sites`، `districts` | `building_growth_facts` | أولوية الحي |
| المحلّل | `v_district_metrics` | `districts`، `cities` | كل الوقائع المكانية بأبعادها | كل المؤشرات، والتشبّع |
| الباحث عن عقار | `v_listings` | `districts` | `listing_observations`، `property_deal_facts` | السعر مقارنة بوسيط الحي |
| طلب التسعير (قاعدة البناء) | `v_supplier_directory` | `establishments` بسياسة العرض، و`contact_points` بعد المراجعة | `events` (`lifecycle_observed` لوسم المغلق مؤقتاً) | — |

«سجل المشاهدات» لكل وحدة (تصميم دورة الحياة، قسمه 6) واجهة لاحقة من `events` و`establishment_site_links`، بعد التحقق.

## 5. قواعد ملزمة

1. **معرّف المصدر ليس معرّف فرق.** `source_records` لا يُعدَّل ولا يُحذف، والخام وحده يخضع للاحتفاظ.
2. **آلية واحدة للتاريخ:** كل علاقة متغيرة جدول نسخ كما في تصميم دورة الحياة (3.4 حتى 3.4.2):
   - إضافة فقط، بزمني `valid_from` و`recorded_at`.
   - الاستعلامان، وكل تصحيح بـ`set_interval`.
   - لا `valid_to` ولا تعديل صف.
3. **الأدلة والأحداث مفتاحها `source_record_id`:** `attribute_assertions` و`contact_points` و`events` لا تخزّن `farq_atlas_id`. المنشأة تُستنتج من `record_links`، يوم الحدث أو اليوم.
4. **المنشأة والموقع والمبنى ثلاثة أشياء:** الموقع وحدة، والمؤقت `provisional`، ولا موقع للمبنى كله ولا ربط بالقرب وحده.
5. **كل قياس بحبيبته وأبعاده.**
   - قياس الحي لا يُنسخ إلى صف المنشأة. الربط يحدث وقت القراءة عبر `district_id`.
   - الشرائح لا تُضرب لتقدير تقاطعها.
6. **الربط بالمعرّف.** الاسم يمرّ عبر `district_aliases` أو `CITY_ALIAS` مرة واحدة عند الإدخال.
7. **الترخيص يُحمل مع القيمة.** ODbL لا يُخلط في ادعاء واحد مع مصدر مغلق. المصدر بـ`blocked_license` لا يدخل إصداراً.
8. **بيانات الاتصال في `contact_points` فقط.**
   - `payload` منقّحة ومفحوصة.
   - الخام في أرشيف مقيّد بمدة احتفاظ.
   - الإرسال يبقى يدوياً وبعد مراجعة.
9. **«غير متاح» حالة مخزّنة**، لا صفر ولا تقدير.
10. **لا قاعدة هوية أو موقع تعمل آلياً** قبل اجتياز عتبات تصميم دورة الحياة (قسمه 5.4).
11. **لا إصدار بلا manifest وفحوص قبول:** المفاتيح، والتصنيف، والإحداثيات، والتغطية، والترخيص، وفرادة (المفتاح، `valid_from`، `recorded_at`) في جداول النسخ الثلاثة، ولكل نسخة حدثها، وخلو `payload` من بيانات الاتصال.

## 6. الترتيب المقترح

لا شيء من هذا يغيّر الإنتاج قبل المراجعة. ترتيب دورة الحياة (قسمه 7) يبقى كما هو، وهذه الخطوات حوله:

1. **الكتالوج كبيانات:**
   - `source_registry` ملف في المستودع (YAML أو CSV) بأعمدة `docs/atlas-data-inventory.md`، ومعها `contact_fields` و`raw_retention_days`.
   - اختبار يمنع مصدراً بلا ترخيص أو بلا مدة احتفاظ من دخول `stage_release.py`.
2. **الحبيبة أولاً:**
   - إخراج السكان من صف المنشأة (`build_poi_population_links.py`).
   - نقل حسابات السكان لكل منشأة وحجم الجمهور إلى دالة واحدة في الخدمة.
3. **أول نسخ `record_links`:**
   - من `source_to_farq_atlas_id.parquet` الحالي: نسخة لكل مفتاح، وحدث `identity_resolved` لكل نسخة في المعاملة نفسها (6.5).
   - `valid_from` = تاريخ الإصدار الذي ورد منه الربط، و`recorded_at` = `decided_at` لحظة الترحيل، و`method = rule:farq_atlas_identity@<version>`.
   - أي تاريخ أقدم يُعرف لاحقاً يدخل بـ`set_interval`، لا بتعديل هذه النسخ.
   - ثم يشتق `build_farq_atlas_identity.py` الملف منها بدل كتابته مباشرة.
4. **أول نسخ `establishment_site_links`:**
   - موقع مؤقت لكل منشأة بإحداثية `point`. مستوى الوحدة صفر في تصميم دورة الحياة (3.2.1 و3.2.2)، فلا `unit` اليوم.
   - لا دمج للمواقع على تطابق الإحداثية.
   - المنشآت بدقة `district` و`city` بلا موقع.
   - `site_building_links` لا تُكتب من مرشحات دليل المبنى (3.2.2) قبل أن تجتاز كل قرينة عينة التحقق في كل مدينة. وإلى ذلك يبقى «المبنى غير معروف».
5. **`district_aliases`:** نقل `n910_names` وأسماء وزارة العدل إليه، فتُربط الصفقات بالمعرّف.
6. **`metric_definitions`** للمؤشرات الستة أعلاه، مربوطة بـ`explanations.ts`.
7. **الأدلة:** `source_records` المنقّحة و`attribute_assertions` في PostGIS ضمن خطة `docs/atlas-data-platform.md`، بدءاً بالمصادر المفتوحة (تراخيصها معروفة).
8. **الوقائع والواجهات:** بعد تطابق الأعداد مع الإصدار الحالي لكل مدينة وحي ونشاط.

## 7. قرارات مطلوبة من المالك

**تكمّل قرارات تصميم دورة الحياة (قسمه 8):**
- **تعديلات النسخة 5 من التصميم:** 3.4.1 (`set_interval`)، و3.4.2 (الجداول الثلاثة، و`site_rebased`، والتعيين الأول بـ`site_reassigned`)، و3.2.2 (مرشحات المبنى المكانية وصيغ رقم الوحدة). هي في التصميم المرجعي نفسه، وتُعتمد هناك.
- **سجل المصادر وبيانات الاتصال:** هل يُعتمدان جزءاً من `source_records` في دورة الحياة: `source_registry`، و`payload` المنقّحة، و`raw_ref`، و`contact_points`.

**خاصة بهذا النموذج:**
- **التراخيص:** ترخيص 910ths وعقار وGoogle عبر Serper، وهي معروضة أو مستخدمة اليوم.
- **الإصدار المنشور:** أي إصدار ذهبي هو المنشور: 2,271,487 أو 2,250,123 أو 2,657,921 صفاً.
- **الأصول الغائبة:** مكان بانياتها: الدليل الأساسي، و`street_density`، و`districts.geojson`، وبحيرة الكيانات.
- **احتفاظ الخام:** مدة احتفاظ الخام لكل مصدر يحمل بيانات شخصية، ومن يملك صلاحية الأرشيف.
- **الملفات الخارجية:** قائمة الملفات المرسلة خارج المستودع لتُضاف إلى الكتالوج.
