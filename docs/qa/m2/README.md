# م2 — مكتبة المكونات src/ui ونقل الشاشتين 03 و04

الفرع: `design/figma-sync`. ما فيه push.

## جدول الربط: مكوّن Figma ← مكوّن الكود

| مكوّن Figma (العقدة) | مكوّن الكود | الحالة | ملاحظات |
|---|---|---|---|
| Button (9:110) | `Button`, `IconButton` | تم | Style: Primary, Secondary, Ghost, Danger, Accent. Size: S, M, L. الحالات hover وfocus-visible وactive وdisabled وloading. |
| Input (21:74) | `Input` | تم | default وhover وfocus وfilled وerror وdisabled. اللاحقة «ر.س» ونص المساعدة. aria-invalid وaria-describedby. ما يُستخدم في 03 و04، ومكانه 01 و02. |
| Chip (21:99) | `Chip` | تم | default وhover وselected وdisabled، وزر الإزالة. aria-pressed. مستخدم في فلاتر 04. |
| Badge (18:41) | `Badge` | تم | Tone: Success, Warning, Danger, Info, Neutral. النقطة في بداية السطر. |
| Evidence Badge (18:57) | `EvidenceBadge` | جزئي | المكوّن جاهز. ما يظهر في الشاشات لأن الـAPI ما يرجّع حقل الدليل. |
| Channel Badge (18:73) | `ChannelBadge` | تم | WhatsApp وEmail وUnreachable. أضفنا Haraj لأنها قناة حقيقية في الـAPI وغير موجودة في Figma. |
| Stat (24:145) | `Stat` | تم | Neutral وSuccess وWarning وDanger. |
| Timeline Step (24:128) | `TimelineStep` | تم | Done وActive وPending وFailed. Active ينبض مرة واحدة فقط. |
| Quote Card (25:209) | `QuoteCard` | تم | Default وNew وBest. الحقائق تظهر فقط إذا ذكرها المورد. New يدخل من inline-end. |
| Price Cell (24:91) | `PriceCell` | تم | Best وNormal وHigher وNot comparable وPending. الإشارة والنسبة معزولة اتجاهيًا. |
| Dropzone (21:153) | `Dropzone` | تم | Idle وDragOver وUploading وSuccess وError. تشغيل بالكيبورد. الربط الفعلي في شاشة 01 (م4). |
| Tab (25:102) | `Tab`, `Tabs` | تم | role=tablist. الأسهم تتبع RTL، وHome وEnd. |
| Top Bar (26:600) | `TopBar`, `SearchField` | جزئي | مسار الصفحة يعمل. البحث والتنبيهات والوضع الداكن ما تظهر لأن الخصائص غير موجودة. |
| Nav Item (25:95) / Sidebar (26:599) | `NavItem`, `Sidebar` | جزئي | الشعار وطلبات التسعير والاستهداف (رابط خارجي) والحساب. «طلب تسعير جديد» ينتظر شاشة 01. الرئيسية والوارد والموردين مؤجلة. |
| Toast (24:173) | `Toast` | تم | Success وWarning وError. أعلى الطرف inline-end كما في Figma. role=status أو alert. |
| Logo (24:64) | `Logo` | تم | Default وInverse بالألوان من الـtokens. |
| Icons (7:2) | `Icon` | تم | 44 أيقونة بلون currentColor. |
| Confidence, Toggle, Checkbox, Map Marker, Supplier Row, Confirm Sheet | — | مؤجل | خارج نطاق 01–04 في م2. Confirm Sheet في م6. |

ما أضفنا أي مكتبة UI. Dialog وTabs وToast مبنية بدون مكتبات.

## الشاشات 03 و04

- **وش لقيت:** الشاشتان كانتا معكوستين أفقيًا. ترتيب العناصر نُقل من Figma وهي بترتيب يسار-يمين، والصفحة RTL.
- **وش عدلت:** الشاشتان صارتا على src/ui وبترتيب القراءة.
  - العنوان ومسار الصفحة في البداية، يعني اليمين.
  - الإحصاءات والأعمدة والتوصية والشريط الداكن بنفس ترتيب Figma.
  - ما تغيّر أي منطق أو استدعاء API أو رقم.
- **مقارنة البكسل:** الفرق مقابل baseline كبير ومقصود، لأنه تصحيح للاتجاه حسب Figma. الدليل في `compare-03.png` و`compare-04.png` (Figma ← قبل ← بعد).
- **تغييرات نص صغيرة:**
  - عنوان مسار الصفحة في 04 صار «مقارنة العروض» كما في Figma.
  - سبب تعطيل الترسية صار يظهر نصًا تحت الزر بدل التلميح فقط.

## نسخ من مصدر غير مُلتزم (تحتاج قرارك)

- `src/api/constructionClient.ts`: أُضيف فلتر `request_number` لصندوق الوارد. 3 أسطر، والملف في `source-diffs/`.
- `src/lib/requestFile.ts`:
  - أُضيفت `invitesForMessage`.
  - صار لـ`quoteCoverage` معامل ثانٍ هو عدد البنود المطلوبة.
  - شاشة 04 تستخدم المعامل الثاني، فهي تعتمد على النسخة غير المُلتزمة.

## حقول API ناقصة

1. مستوى الدليل لكل مورد مدعو: «سبق سعّر نفس البند» أو «يبيع نفس الفئة» أو «مطابقة تقديرية». بدونه ما تظهر Evidence Badge.
2. سبب الرد بدون سعر، مثل «رد · يسأل عن الكمية» في Figma. الموجود اليوم هو opened_at وأحداث LINE_DECLINED فقط.
3. أرقام عدّادات الشريط الجانبي، مثل عدد الطلبات المفتوحة والرسائل غير المقروءة.
4. التوصيل والضمان كحقول منظّمة في العرض. اليوم تأتي ضمن الملاحظات النصية.
