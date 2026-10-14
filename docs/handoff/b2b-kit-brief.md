# برومبت الوكيل — FARQ B2B: إعادة بناء شاشات ما بعد تسجيل الدخول على حزم Figma المشتراة

أنت مسؤول عن إعادة تصميم ثم تنفيذ FARQ B2B (pricing.farq.sa) داخل المستودع
https://github.com/farq-tech/FARQ-B2B (محلياً `/Users/m4pro/farq-pricing`، الفرع الافتراضي `master` = كود
الإنتاج، فرع العمل `design/b2b-kit-restyle`). الهدف: كل واجهة بعد تسجيل الدخول — للمشتري وللمورد —
تُبنى من نظام التصميم المشترى في Figma، مع رحلة «حملة موردين» كاملة، ثم تُنفَّذ في التطبيق بعد اعتماد
Figma. اقرأ هذا الملف كاملاً قبل أي شيء. توقّف واسأل المالك حيث يقول «توقّف».

---

## 1. القواعد الصارمة

1. **لا كود قبل Figma.** تنهي Figma وتعرض الروابط وتتوقف حتى يقول المالك «ابدأ».
2. **لا Component جديد في Figma بلا موافقة كتابية.** أي عنصر لا توفره الحزم يُكتب في قسم GAPS مع أقرب بديل من الحزم، وتتوقف.
3. **Instances فقط** من Nucleus Pro / Foodie / Shoppay ومكونات FARQ الموجودة (القسم 4). لا رسم يدوي «مؤقت».
4. **لا تعدّل** صفحات المكتبات الأصلية ولا شاشات المستهلك ولا وضعَي Light/Dark للمستهلك. صفحتك: «✦ Farq B2B: Screens» (و«✦ Farq B2B: Components» فقط إن اعتمد المالك مكوناً).
5. **الألوان متغيرات فقط** (Figma Variables / CSS tokens). ممنوع hex داخل شاشة أو مكوّن أو CSS.
6. **لا إرسال فعلي** (WhatsApp / Meta / بريد / حراج). لا تضبط `TARGETING_SEND`. لا تلمس الأسرار ولا OAuth ولا الفوترة ولا كلمات المرور (`PRICING_PASSWORD`, `TARGETING_PASSWORD`, رموز Meta/Mapbox) ولا تطبعها.
7. **لا نشر ولا دمج** إلى `master` إلا بكلمة «انشر» أو «ادمج» من المالك.
8. **لا بيانات تجريبية** في التطبيق أو معاينة يراها المالك. في Figma مسموحة إن وُسم الإطار بوضوح «بيانات تجريبية».
9. **لا ادّعاء نجاح** إرسال أو تسليم أو قراءة بلا دليل من النظام. قُبل من المزوّد ≠ وصل ≠ قُرئ ≠ ردّ ≠ عولج.
10. **المستودع المسموح: `FARQ-B2B` فقط.** لا تفتح `farqconstraction` ولا `farq-construction-*` ولا `farq` (مستودع الأفراد). ملفات `src/api/*` نسخ للقراءة فقط: تُستدعى ولا تُعدَّل. الـ API (`FARQ_API_ORIGIN` = api.farq.sa) وخدمة الاستهداف (`TARGETING_ORIGIN`) اعتماديات HTTP؛ أي حقل أو endpoint ناقص = GAP للمالك.
11. **لا أسماء مصادر بيانات** في الواجهة (مزوّدو الدليل، أسماء اللقطات). أسماء المنشآت مسموحة.
12. **RTL أولاً. الأرقام LTR دائماً** (الأسعار، الهواتف، التواريخ، العدادات، أرقام متغيرات القالب `{{n}}`): `<bdi dir="ltr">` في الكود ونص LTR في Figma. لا تعكس Steppers أو Sliders.

## 2. الهوية البصرية B2B (كما تُعرض في اللاندنق، اعتمدها المالك 2026-10-14)

| الدور | القيمة | أين في اللاندنق |
|---|---|---|
| `b2b/primary` نصوص وعناوين وأيقونات وحدود مميزة | `#254834` | h1، النصوص، «دخول» |
| `b2b/canvas` | `#f4f8f2` (تدرّج `#f4f8f2 → #e7f1e5`) | خلفية الصفحة |
| `b2b/surface` | `#ffffff` | البطاقات، الشريط العلوي |
| `b2b/cta` زر الإجراء | `#d8ee8c` بنص `#254834`، زوايا 14 | «حدد هدفك وابدأ» |
| `b2b/border` | `#d7e3db` | الحدود والحبوب |
| `b2b/sage` نص ثانوي / فواصل / معطّل | `#93A89F` | الملصقات الثانوية |
| `b2b/selected` | `#edf4dd` | الخيار المحدد |
| `b2b/olive-gold` / `b2b/rose` لهجات ثالثية للرسوم فقط | `#A59859` / `#947C7C` | رسوم اللاندنق |
| نجاح / تحذير / خطر | `#22a55b` / `#ff652f` / `#c94f66` | الشارات فقط |
| شريط الفرق (مشترك مع الأفراد) | `#a3b80f` = `color/gap/fill` `VariableID:18274:30` | صفوف المقارنة |

ملاحظة: متغيرات `--brand-*` السوداء/الخضراء في `src/styles/tokens.css` لا تُعرض فعلياً (يتجاوزها ثيم `--farq-*`). لا تستخدمها.

**العلاقة بنظام الأفراد (قرار المالك: نظام واحد بتعبيرين)**: نفس الحزمة والخط والزوايا والمسافات وألوان الحالات وشريط الفرق؛ يختلف B2B فقط في الأساسي (`#254834` بدل الزيتوني `#3e573b`) والكانفس وزر الإجراء الليموني بنص أخضر (المستهلك زيتوني بنص أبيض).

**التنفيذ في Figma**: أنشئ مجموعة متغيرات «Farq B2B — Brand» بالأسماء أعلاه، وأسماء بديلة: `color/brand/primary → b2b/primary`، `color/text/base → b2b/primary`، `color/text/muted → b2b/sage`، `color/bg/canvas → b2b/canvas`، `color/bg/surface → b2b/surface`، `color/border/subtle → b2b/border`، `color/action/fill → b2b/cta`، `color/action/text → b2b/primary`. ثم **أضف وضعاً (Mode) باسم «B2B» على مجموعة Nucleus** `VariableCollectionId:1760:21728` (أوضاعها الحالية Light `1760:3` وDark `1760:4` لا تُمس) يعيد توجيه `global/brand/10…100` إلى سلّم مبني من `#254834` (90) حتى `#edf4dd` (10)، فتتلوّن Instances نوكليوس بلا Detach. **مجموعة الأفراد الوحيدة المعتمدة** هي «Farq — Brand (owner palette)» `VariableCollectionId:18147:19617`؛ «Farq — Proposed Brand» و«FARQ / Business — isolated» قديمتان ممنوع الربط بهما. تحقّق بلقطة أن Buttons - Full width على إطار B2B يظهر `#d8ee8c` بنص `#254834`، وBadge - Status success يظهر `#22a55b`.

**الخط**: ITF Huwiya Arabic (متغير Nucleus `typography/font-family/primary` `VariableID:4170:8188`)؛ الأنماط `Farq/*` (Display 28، Heading 22، Subheading 18، Body 16، Body Small 14، Label 13، Price 24) أو سلّم Nucleus. ممنوع بنفسجي Nucleus وأخضر Foodie وكحلي/مرجاني Shoppay والزيتوني الاستهلاكي.

## 3. ما الموجود اليوم (تعيد تصميمه، لا تعيد كتابته)

`src/App.tsx` يوجّه بالـ `view`: `login` → `LoginV2`؛ `create-upload` → `NewRequestV2` (رفع BOQ ومراجعة البنود)؛ `rfq-list` → `RfqListV2`؛ `rfq-detail` → `RequestTrackingV2`؛ `comparison` → `ComparisonV2`؛ `award` → `pages/award` + `AwardConfirmSheet`؛ `inbox` → `pages/inbox` (للقراءة)؛ `targeting` → `pages/targeting/index.tsx` مع `TargetMap`/`MapboxMap`/`CampaignConfirmSheet` (تعرض `cost` تقديرية)؛ `templates` → `Templates.tsx` (كل قوالب حساب واتساب بحالتها من Meta عبر `GET /templates`)؛ `template-new` → `TemplateEditor.tsx` (قالب بشكل Meta: الاسم، اللغة، التصنيف، header، body بمتغيرات `{{n}}` وأمثلتها، footer، buttons؛ «أرسل للاعتماد» → `submitTemplate` → `POST /templates`؛ الحالات PENDING / APPROVED / REJECTED مع السبب). العملاء: `src/api/targetingClient.ts`، `constructionClient.ts`، `constructionSuppliers.ts`، `farqSession.ts`/`useFarqSession.ts`. المكونات اليدوية الحالية `src/ui/*` (Button, Chip, Badge, Input, Tabs, TopBar, Sidebar, MobileNav, FlowShell, OptionCard, QuoteCard, PriceCell, TimelineStep, Toast, Dropzone, Stat, Confidence, Icon, Logo) هي ما تستبدله بمكونات الحزم مع إبقاء props. المسودات في المتصفح (`drafts.ts`). القالب المعتمد في الإنتاج `farq_outreach_ar`. `docs/PRODUCTION.md` فيه خريطة Figma القديمة وما أُسقط لغياب بيانات حقيقية (لا تُعِده بأرقام وهمية).

**المخرج 1 قبل أي Figma**: `docs/handoff/screen-inventory.md` — كل route وview، ملفات كل شاشة، hooks وendpoints، الحالات (loading / empty / error / disabled send / read-only)، ومكونات `src/ui/*` المستخدمة. لا تغيّر ملفاً قبل تسليمه.

## 4. الحزم: من أين تأخذ كل شيء (معرّفات حقيقية)

**ملف Nucleus Pro** `gxlY4uu8hzkUNrcN61uQZt` (الصفحات بمعرّفاتها): Foundation `14469:14606` · Web Ecommerce & Marketing Patterns `3529:684` (44 قسماً: هيكل 1440 والـ Sidebar والجداول — ابدأ منه كل صفحة ويب) · Native (Mobile) `14403:7196` (التنبيهات وAction Sheets والإشعارات ولوحات المفاتيح) · Mobile Patterns & Kit `14404:5973` · Icons: Line `1739:21390` · Buttons `14403:5758` · Chips `14476:12977` · Badges `14403:7195` · Lists `14410:5965` · Dialogs `14410:5999` · Action Sheets `14410:5988` · Tabs `14410:5979` · Segmented `14410:5967` · Skeletons `14410:5998` · Progress `14410:5989` · Top Bars `14410:5952` · Tab Bars `14410:5980` · Search Bar `14410:5981` · Text Fields `14500:15409` · Text Area `14507:10721` · Dropdowns `2192:22015` · Mobile Number `2192:22014` · PIN `14507:10720` · Date Picker `17101:33890` · Checkbox `14500:14721` · Radio `14500:14052` · Toggles `14478:13842` · Steppers `14478:13465` · Sliders `14500:15408`.

**معرّفات مكونات تُستخدم مباشرة**: Status bar `1743:30942` · Top Bar - Center `6:51` · Search Bar `961:20425` · Chips - Filled `14446:7569` / نشط `14446:7571` · Tab Bars `37:271` · Home indicator `21:117` · Buttons - Full width `1:7` · Buttons - Small `2195:25958` · Badge - Status success `1721:20797` / warning `16667:32525` · Avatars image `16656:38563` / icon `16656:38579` / initial `16656:38591` · Divider `27:62` · Skeleton rect `17120:29470` / circle `17118:29127` · Stepper minimal `17106:30088` · Text Field - Standard `16835:33262` · Keyboard `2054:27815` · Segmented `2005:21306` · List - Has Padding `1834:21010` (Action=Label) / `1834:21013` (Action=Icon) · Dropdown - Standard `16842:33325` (Filled `16842:33335`) · Mobile Number Field Filled `16844:33803` · Pin Input `17131:30015` (Focus `17131:30022`, Enabled `17131:30024`, Filled `17131:30028`) · Progress Indicator - Bar `16854:33155` (مثلاً 30% `16854:33434`) · Aspect Ratio `113:1322`.

**مكونات FARQ الموجودة** (صفحة «✦ Farq: Components» `18293:19868`): Comparison Card set `18299:143` (Complete `18299:7` / Partial `18299:59` / Loading `18299:108`) · Difference Indicator `18299:2` · Grocery Item `18306:112` · مجموعة `Farq / Food (from Foodie) / …` `18319:252…368` (صفوف المتاجر والأصناف، Order Card Progress `18319:325` / Finished `18319:339`، Review `18319:368`) · علم السعودية `18291:201` · أيقونات 3D `18279:2` (صح) و`18279:19617` (عربة) · ألواح الأيقونات «Farq icon sheet 1–5» (`18360:18754`, `18360:18795`, `18360:18836`, `18360:18877`, `18362:176`).

**Foodie** `J33vly135dSelpHci4CN2F`: صفحة Patterns `858:8367` (88 إطاراً كاملاً 375×812: Home `13650:5981`، Pricing/المنيو `13650:6058`، Order `13650:6347`، Order History `13650:6439`، Chat `13650:6387`، Reviews `13650:6161` / `13650:6452` / `13650:6486`، Search `13650:6222`، Cart `13650:6263`، Action Sheet `13650:5934`، Loading `13650:6335`، Welcome/Signup/Verification/Account Setup `13650:5834…5964`) · UI Kits `768:5811` · Alternative Components `13568:5355` (FAB `13604:6116`، Floating-label fields `21:218`، Rating `13534:5464`، شريط بحث شفاف `961:7140`، Nav dropdown `13516:5383`، Progress thick `13582:5896`، Radio field `13582:5884`) · Icons by Keyicons `784:6801` · Assets `13581:10546`.

**Shoppay** `1oiuThQRCRXePR0WDXL6Jo`: صفحة Patterns `858:8368` (42 شاشة 375×812: Item List `14675:11103`، Filter `14675:11119`، Checkout & Order Review `14675:11154`، Reviews `14675:11183`، Action Sheet `14675:11195`، Discover `14675:11216`، Signup `14675:11280`، Login `14675:11290`، Account Setup `14675:11310…11327`، Confirmation `14675:11360` / `14675:11684`، Payment Method `14675:11373…11411` / `14675:11590`، Home `14675:11417`، Bookmarks `14675:11447`، Order History `14675:11460`، Sort by `14675:11487`، Location & Address `14675:11570`، Account/Profile `14675:11599…11733`، Acknowledgement & Success `14675:11624`، Product Detail `14675:11741`، Verification `14675:11791`) · Components `784:6805` (125 قسماً: Date Pickers، Bottom Sheets `878:7298`، Popovers `902:7221`، Action Sheets `907:7392`، Snackbars `871:7397`، Tables `66:735`، Ratings، Size/Color pickers) · UI Kits `14654:11359` (Product card `14567:7445`، Product List `14571:8482`، Add To Cart `14588:7236`، Category `14601:9819`، Banner `14626:8379`، Saved `14598:8688`، Suggestion `14621:13863`، Payment Card `14567:6246`، صفوف Order `14613:12589` / Address `14598:7291` / Brand `14576:9490` / Review `14599:9330`، تركيبات Filter `14659:18732`، Size `14661:19530`، Sort `14661:19003`، Brands `14661:19044`، Field-verification `14659:18568`).

**الاستيراد إلى ملف Pro**: `await figma.importComponentByKeyAsync(key)` ثم `createInstance()`. مفاتيح معروفة: Foodie — Store row Basic `73c639ee…` / Tagged `f170a65b…`، Food row Default `5bc20b3a…` / Stepper `0379f506…`، Category `c4bfbfbd…`، Order Card Progress `3681822c…` / Finished `e4f40ce3…` (المجموعة `3b0c9b62…`)، Image Store `6f24ec5d…` / Food `194cd2fb…` / Category `5a64c0fe…`، Review `7896cfc7…`، Rider `744e0132…`، FAB set `1777d1ae…` (Primary Center `8a6c55e9…`)، Radio Field `03974d9d…`، Rating `90494e0b…` / `06478896…`، Bottom Sheet Light `dfba5a30…`، Action Sheet Light `7116c80e…`، Numeric keyboard `e055934e…`، Illustration set `6d53f65a…`. Shoppay — Product `a322c083…`، Product List `deb1f1bc…`، Add To Cart `a421ae6f…`، Banner `04b9f4c0…`، Category `6f795db3…`، Brand `f7d99357…`، Order `a384c582…`، Address `50df18aa…`، Payment Card `1ae33411…`، Review `a8108c58…`، Suggestion `ab7b662e…`، Saved `b75adadc…`، Tables set `1554a596…`، Tabs set `100cea91…`، Tabs: Chips `62cb9a67…`، Text Fields set `814c2f1d…`، Nav Standard set `8764ddcd…`، Bottom Sheets set `fdb16886…`، Action Sheets set `b05b99df…`، Auth buttons set `da1343f7…`، Size partial `fa52e538…`. الفقرة ناقصة المفاتيح الكاملة عمداً؛ اقرأها من Figma عبر `search_design_system` أو `node.key`.

**قاعدة البناء**: ابدأ كل شاشة من *نمط شاشة كامل* موجود (Patterns) ثم بدّل المحتوى؛ لا تجمّع الشاشة من ذرّات إلا إذا لم يوجد نمط. على الجوال استخدم الـ Bottom Sheets وAction Sheets من الحزم؛ على الويب Sidebar ولوحة محتوى من صفحة الويب Nucleus.

## 5. مهارات Figma MCP ومصائد معروفة

- حمّل `skill://figma/figma-use/SKILL.md` و`figma-generate-design` (و`figma-generate-library` لو أنشأت متغيرات) قبل كل `use_figma`؛ مرّر `skillNames`؛ تبديل صفحة واحد لكل استدعاء؛ أعد كل المعرّفات؛ لا تنفّذ `use_figma` بالتوازي على نفس الصفحة.
- Instances المنفصلة (Detach) تحتفظ بنصوص Montserrat/Inter → احذف النص وأنشئ `figma.createText()` جديداً بخط Huwiya؛ صور «Views / Images: Ratio» المتداخلة لا تقبل التبديل → استبدلها بمستطيل؛ رفع WebP يظهر فارغاً → PNG؛ `Social - Button/Apple` يُعرض مكسوراً → Buttons - Full width Secondary؛ إطارات `createAutoLayout` بيضاء افتراضياً → `fills=[]`؛ تغيير `x` لطفل Instance يفشل → إطارات عادية؛ `opacity` على paint مربوط بمتغير لا يعمل → `node.opacity`؛ الشرائح في «Categories» المنسوخة مرتبة من اليمين لليسار (الطفل 0 = الأيمن).
- خصائص الـ Instances: Top bar `Title#17776:50`، `(L) Icon#1743:18`، `(R) Icon - 1#1743:50`؛ Search `Value#608:12`؛ Chips `Is Active`؛ Full width button `Text Label#2194:15` + `Hierarchy` (Primary/Secondary) + `State`؛ Small button `Text Label#2195:85`؛ Badge - Status `Status` / `Variant` / `Contrast`؛ Tab Bars `Tabs`؛ Segmented `Segments`.
- الأيقونات: صدّر ما تحتاجه من Icons: Line كألواح (إطار Auto-layout فيه Instances مسماة باسم الأيقونة) عبر `download_assets` بصيغة SVG، ثم قصّها بـ viewBox الشبكة إلى `currentColor`، وولّدها مكونات في الكود (كما في مستودع الأفراد `Frontend/scripts/gen-next-icons.mjs`). لا lucide في شاشات B2B.

## 6. الشاشات المطلوبة (Figma ثم كود) ومصدر كل واحدة

| الشاشة | النمط الأساس | ملاحظات |
|---|---|---|
| تسجيل الدخول | Shoppay Login `14675:11290` / نمط الأفراد Auth / Sign in `18340:1766` بألوان B2B | بريد + كلمة مرور كما في `LoginV2` |
| Workspace shell (Top Bar / Sidebar / Mobile Nav) | Nucleus Web page `3529:684` للويب، Top Bar `6:51` + Tab Bars `37:271` للجوال | |
| قائمة طلبات التسعير | Foodie Order History `13650:6439` + Order Card `3b0c9b62…` | |
| طلب جديد ورفع BOQ ومراجعة البنود | Shoppay Checkout & Order Review `14675:11154`؛ منطقة الرفع: عنصر الحزم إن وُجد وإلا GAP | |
| تتبع الطلب | Foodie Order `13650:6347` (شريط تقدم يمتلئ من اليمين، الخطوات المثبتة فقط) | |
| مقارنة العروض | `Farq / Comparison Card` `18299:143` + Shoppay Tables | «عرض ناقص» = Badge warning، لا «الأرخص المكتمل» |
| قرار الترسية | Shoppay Confirmation `14675:11360` + Acknowledgement & Success `14675:11624` + الصح 3D `18279:2` | |
| Inbox والمحادثات | Foodie Chat `13650:6387` كما في Taseer/Chat `18320:763`، Review `7896cfc7…` حيث يوجد تقييم | |
| الاستهداف والخريطة | Nucleus Chips + List rows + Checkbox + شريط ملخص ثابت (نمط «Basket bar» `18308:485`)؛ الخريطة Mapbox كما هي | |
| قائمة القوالب | Nucleus List rows + Badge - Status | |
| محرر قالب WhatsApp | Text Field `16835:33262` + Dropdown `16842:33325` + Text Area (`14507:10721`) + معاينة فقاعة Foodie | |
| حالة اعتماد Meta | بطاقة حالة + Badge - Status + Buttons - Full width (`State=Disabled` حتى APPROVED) | |
| مراجعة الحملة والتكلفة | Shoppay Bottom Sheets `fdb16886…` / Action Sheets `b05b99df…` بسكريم 50% | |
| نتائج الإرسال | Nucleus List rows + Badge - Status لكل مستلم | |
| عرض المورد وتقديم عرض سعر | Foodie Product `13650:6183` + Text Fields / Steppers `17106:30088` / Dropdowns | |
| حالة «عرض ناقص» | Badge - Status warning `16667:32525` داخل بطاقة المقارنة | |

الجوال 390×844 أو 393×852؛ الويب 1440×900. لكل شاشة حالات Loading (Skeletons) وEmpty وError من الحزم عند الحاجة.

## 7. رحلة «حملة موردين»

1. **الشريطة المستهدفة**: بحث باسم المنشأة (Search Bar)؛ Chips للفئة والمدينة والقناة (واتساب/بريد/حراج حسب ما يثبته السجل فقط) والرد السابق ودليل البيع بالجملة؛ صف لكل مورد (Avatar + الاسم + «{المدينة} · أيقونات القنوات» + «آخر رد قبل N يوم» عمراً لا تاريخاً) مع Checkbox؛ مورد بلا قناة مؤكدة: Badge warning «بلا قناة مؤكدة» وغير قابل للاختيار؛ «تحديد الكل المطابق»؛ شريط ثابت «اخترت N مورداً · واتساب N · بريد N» + «التالي»؛ الخريطة والقائمة متزامنتان.
2. **الرسالة**: القوالب المعتمدة أولاً؛ جسم القالب المعتمد لا يُعدَّل (المتغيرات فقط)؛ قالب جديد: الاسم، اللغة، التصنيف، body، المتغيرات وأمثلتها، footer، buttons؛ معاينة محادثة مطابقة لما يصل للمورد.
3. **اعتماد Meta**: Pending / Approved / Rejected مع سبب Meta الحقيقي؛ زر الإرسال Disabled حتى Approved؛ عند غياب الربط: «خدمة الاستهداف غير متصلة»؛ لا وعود بمدة: «عادةً خلال دقائق وقد تصل إلى 24 ساعة».
4. **المراجعة والتكلفة والإرسال**: المستلمون حسب القناة، اسم القالب، التكلفة الفعلية من الخادم (إن أرجع تقديراً فقط اعرضه بوسم «تقديرية» وسجّلها نقطة توقف)، الضريبة، الرصيد والمتبقي عند توفره، «الرصيد لا يكفي» يحجب الإرسال، تأكيد واحد «أرسل إلى N مورداً · التكلفة X ر.س»، وإن كان الإرسال مقفلاً: «الإرسال مقفل حتى يفعّله المالك».
5. **النتائج والمتابعة**: لكل مستلم «قُبل من المزوّد → وصل → قُرئ → ردّ → عولج»؛ غير المؤكد «غير مؤكد — تحقق» بتسوية لا إعادة إرسال؛ الردود في Inbox الحالي.

النصوص: «حملة موردين» · «الشريحة المستهدفة» · «اخترت N مورداً» · «بلا قناة مؤكدة» · «الرسالة» · «قالب معتمد» · «قيد المراجعة» · «مرفوض: {سبب ميتا}» · «أرسل للاعتماد» · «المراجعة والتكلفة» · «التكلفة X ر.س» · «يُخصم N من رصيدك (المتبقي M)» · «أرسل إلى N مورداً» · «الإرسال مقفل حتى يفعّله المالك» · «قُبل من المزوّد» · «وصل» · «قُرئ» · «ردّ» · «غير مؤكد — تحقق» · «عرض ناقص» · «الأرخص المكتمل». لا «تم الإرسال بنجاح» إلا إذا قبل المزوّد كل رسالة.

## 8. المخرجات قبل الكود (ثم توقّف)

1. صفحة «✦ Farq B2B: Screens» بكل الشاشات (جوال + ويب) ومجموعة «Farq B2B — Brand» ووضع «B2B».
2. Prototype «Farq B2B — حملة موردين».
3. `docs/handoff/figma-map.md`: لكل شاشة: node id، كل Instance ومصدرها (ملف/مكوّن/مفتاح)، مصدر البيانات، **نسبة الاستفادة** (عدد العناصر التي هي Instances من الحزم ÷ كل العناصر)، قائمة بكل إطار بُني يدوياً وسببه، وقسم GAPS.
4. أرسل الروابط وتوقّف حتى «ابدأ».

## 9. بعد «ابدأ» (الكود)

- فرع جديد من `design/b2b-kit-restyle`؛ `npm ci`؛ احتفظ بكل API calls والجلسات والمسودات وبوابة القراءة فقط.
- استبدل مظهر ومحتوى `src/ui/*` فقط ليطابق مكونات الحزم بنفس props؛ أضف الأدوار الناقصة إلى `src/styles/tokens.css` (ثيم `--farq-*`) ولا hex في المكونات؛ `scripts/lint-tokens.mjs` يبقى أخضر.
- لا تعدّل خدمات API الخارجية أو الأسرار أو الفوترة.
- شغّل `npm run typecheck`، `npm run lint`، `npm run build`، `npm run test:keyboard`، و`python3 services/targeting-trial/test_trial_search.py`.
- لقطات Playwright/webkit 390×844 و1440×900 لكل شاشة بجانب لقطات Figma.
- ارفع Preview على خدمة Railway `farq-pricing-preview` (`81c29ac0`) أو `vite preview`؛ لا إنتاج إلا بـ«انشر».

## 10. شكل كل تقرير

افصل: **تم تصميمه** · **تم تنفيذه** · **تم اختباره محلياً** (الأعداد حرفياً) · **تم رفعه للمعاينة** (الرابط) · **غير متحقق أو يحتاج قراراً مني**. أضف دائماً نسبة الاستفادة من الحزم ونقاط التوقف المفتوحة.

## 11. نقاط التوقف (اسأل المالك)

1. أي فجوة مكوّن (GAPS).
2. نموذج التكلفة إن أرجعت خدمة الاستهداف تقديراً فقط.
3. تفعيل `TARGETING_SEND` أو أي بيانات Meta/واتساب أو إرسال كناري واحد.
4. وضع «Night» للشاشات (اللاندنق فيه توكنات ليلية).
