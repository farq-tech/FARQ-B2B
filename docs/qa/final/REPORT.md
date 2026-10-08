# التقرير النهائي — نقل «فرق تسعير» من Figma إلى الكود (2026-10-08)

**الحالة الحقيقية:** كل الشغل محلي على الفرع `integration/today`، في المجلد `~/farq-pricing-wt/integration`. ما انعمل push ولا PR، وهذي بقرار المالك بعد المراجعة.
- الفرع مبني على `design/figma-sync` عند a2feafb، وهو آخر commit معتمد من م2 وم4.
- **المسار C ملغى** حسب التحديث. وكيله انوقف، وفرعه `design/request-flow` ما اندمج.

## وش لقيت
- **م4 خلّصت أشياء كانت ضمن خطة اليوم:** مسار الطلب كامل (01 ← 02 ← التوصيل ← الإرسال، والـpayload مطابق)، وجوال 01 إلى 04، وملف الروابط في `procurementContext.tsx`. عشان كذا ألغيت C وقصرت D على 05 و06.
- **خطوتا «التوصيل» و«الإرسال» ما لها تصميم في Figma.** انبنت من نفس مكونات `src/ui`، وتعتبر مقبولة.
- **وكيل الخلفية عدّل نفس الملف اللي كنت أعدّل فيه.** سوّى إصلاحي أحمد وحساب الجولة المسبق على `design/live-bg` عند 49c8300، وأنا سويتهم على integration بالتوازي.
  - اعتمدت نسخته من `engine.ts` كاملة. نسخته أشمل: فيها مسار مخصص يلف حول العناصر، وتسخين قبل بداية الحركة.
  - فوقها رجّعت إصلاحاتي اللي ما تتعارض معها، وهي مذكورة تحت.
- **خطأ قديم في الخلفية:** إذا كان المقر مغطّى، الخلفية تعيد بناء نفسها كل 300ms تقريبًا. السبب إن قراءة ألوان الـtokens تضيف عنصر للصفحة، وهذا يشغّل مراقب التغييرات. على شاشة 390 صارت 90 جولة في 25 ثانية، والصحيح 4.
- **الصفحة ما كانت عامة فعليًا:** `server.py` يعرض نموذج كلمة المرور لكل المسارات.
- **endpoint التسجيل الموجود** (`POST /signup`) لزميل مدعو في حساب فرق بناء، مو لمشترك عام. عشان كذا «ابدأ التسعير» و«سجّل» يفتحون واتساب بالرسالة الجاهزة (القرار 3).
- **الرابط `/requests/:id/review` ما يقدر يفتح مراجعة حقيقية.** المراجعة (02) خطوة داخل `/new` قبل ما يكون للطلب رقم. عشان كذا الرابط يحوّل لمتابعة الطلب.

## وش عدلت (المسار A)
| البند | التعديل | الـcommit |
|---|---|---|
| فرع التكامل | `integration/today` من a2feafb، ودمج B وD وlive-bg | 8776e2c · a7007ae · 17c8fbb · 738db24 |
| تعارض App.tsx | خليت القائمة الجانبية من `src/ui` وشريط الجوال ومسار الطلب، وأضفت `<LiveBackground/>` | 17c8fbb |
| أحمد + حساب الجولة المسبق | اعتمدت نسخة وكيل الخلفية (8 محاولات، ثم هدف أقرب ضمن 60%، ثم مسار يلف حول العناصر، ويقعد كحل أخير فقط. والجولة الجاية تنحسب بـrequestIdleCallback، وإذا ما توفر فبـsetTimeout) | 49c8300 |
| إصلاحاتي على الخلفية | درجات المضلعات من الـtokens · إيقاف حلقة إعادة البناء · هامش أكبر حول المقر عشان بطاقات «طلب عرض سعر» ما تغطي النص (لاحظتها في هيرو الهبوط) | 738db24 |
| tokens | `--live-facet-1..5` لكل درجة (light وdeep وaccent)، بقيم المرجع حرفيًا | 1275001 |
| الروابط | `/` يفتح الهبوط في bundle منفصل، وأي مسار ثاني يفتح التطبيق (`main.tsx`). وأضفت `/login` و`/inbox` و`/requests/:id/award` و`/requests/:id/review` لملف الروابط الموجود. الشاشات صارت lazy، وصندوق الوارد صار في القائمة الجانبية وشريط الجوال. `/ui` و`/live-bg` للتطوير فقط | 258e4e3 |
| الخلفية في الهبوط | تنحط في كل خانة `data-live-bg` قريبة من الشاشة، بعد أول رسم | 0766cca |
| شفافية الشاشات | الغلاف الخارجي لشاشات الدخول والتتبع والمقارنة صار شفاف، والبطاقات باقية بلون surface | b6d6aba |
| server.py | الهبوط عام، والتطبيق و`/_api` محميين. التفاصيل تحت | 90236a0 |

## server.py — الـdiff الكامل
```diff
@@ -1,19 +1,55 @@
 # -*- coding: utf-8 -*-
 """فرق تسعير — hosts the built app (dist/) behind a site password and proxies /_api/* to the Farq API
 (same origin, so the browser needs no CORS). Nothing is cached; every API call carries the user's own
-Authorization header from the Farq login, so the API still decides what this person may see."""
-import os, json, hashlib, urllib.request, urllib.parse, mimetypes
+Authorization header from the Farq login, so the API still decides what this person may see.
+
+Public without the password: the landing page at / and only the files it loads (computed from the Vite
+manifest: index.html and its imports, minus the App chunk and everything only the app uses), plus
+robots.txt, sitemap.xml and the favicon. Every app route, every app chunk and /_api/* stay behind the gate."""
+import os, json, hashlib, html, urllib.request, urllib.parse, mimetypes
 from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
 
 HERE = os.path.dirname(os.path.abspath(__file__)); DIST = os.path.join(HERE, 'dist')
 PORT = int(os.environ.get('PORT', '8080')); PASSWORD = os.environ.get('PRICING_PASSWORD', '')
 API = os.environ.get('FARQ_API_ORIGIN', 'https://api.farq.sa').rstrip('/')
 TOKEN = hashlib.sha256(PASSWORD.encode()).hexdigest()[:32] if PASSWORD else ''
+SITE_URL = os.environ.get('SITE_URL', '').rstrip('/')  # public origin for canonical / sitemap (unset: from the Host header)
 LOGIN = '''...(بدون تغيير)...'''
+# The landing's <head> for crawlers (docs/qa/requests.md B3); app routes keep noindex.
+LANDING_TITLE = 'فرق تسعير — قبل ما تشتري، شوف الفرق'
+LANDING_DESC = 'ارفع الكراسة أو اكتب الطلبات أو صوّرها، ونجيب لك عروض أسعار من موردين حقيقيين، محسوبة شامل التوصيل والضريبة، مرتبة من الأوفر.'
+def landing_head(origin): ...  # title, description, robots index, Open Graph, Twitter Card, canonical
+
+_PUBLIC = {'mtime': None, 'files': set()}
+def public_files():
+    """Files under dist/ the landing needs: index.html's chunk + imports + dynamic imports, never the App chunk."""
+    ... (يقرأ dist/.vite/manifest.json، ويتخطى src/App.tsx وكل اللي ما يوصله إلا هو)
 
@@ class H
+    def _origin(self) / def _file(self, f) / def _landing(self)   # الهبوط = index.html مع head الزواحف بدل noindex
     def do_GET(self):
         if self.path.startswith('/_api/'): return self._proxy() if self._authed() else self._send(401, ...)
-        if not self._authed(): return self._send(200, LOGIN.encode())
+        if p == '/' and 'rfq=' not in u.query: return self._landing()
+        if p == '/robots.txt': ...   if p == '/sitemap.xml': ...
+        if p in public_files() or p in ('/favicon.ico', '/favicon.svg'): return self._file(f)
+        if p == '/__gate': نموذج كلمة المرور نفسه، مع next
+        if not self._authed():
+            ملفات التطبيق → 401 · صفحات التطبيق → 303 إلى /__gate?next=<المسار>
         (المستخدم الداخل: نفس السلوك القديم)
+    def _next(self, query): مسار داخل الموقع فقط (بدون //host أو /\host أو رموز تحكم)
     def do_POST(self):
-        if self.path == '/__gate':
+        if urllib.parse.urlparse(self.path).path == '/__gate':
-            self.send_response(303); self.send_header('Location', '/')
+            self.send_response(303); self.send_header('Location', <next المتحقق منه>)
```
الـdiff الحرفي كامل: `git diff design/figma-sync..integration/today -- server.py`.
- **طريقة الدخول ما تغيّرت:** نفس كلمة المرور، ونفس الكوكي `fp_gate`، ونفس النموذج.
- **التغيير الوحيد:** بعد الدخول يرجعك للصفحة اللي كنت طالبها.

## كيف اختبرته
**curl بدون كوكي**، على بناء إنتاج محلي (كلمة المرور في الاختبار `test-only-pw`، مو الحقيقية). النتائج كاملة في `docs/qa/final/curl.txt`.

| الطلب | النتيجة |
|---|---|
| `/` و`/robots.txt` و`/sitemap.xml` | 200 |
| ملفات الهبوط: index وBelow وLiveBackgroundCanvas | 200 |
| ملفات التطبيق: App وconstructionClient وComparisonV2 و`.vite/manifest.json` | 401 |
| `/requests` و`/requests/x` و`/requests/x/compare` و`/inbox` و`/login` و`/?rfq=x` | 303 إلى `/__gate?next=…` |
| `/_api/…` بـGET وPOST | 401 |
| بعد كلمة المرور الصحيحة | `/requests/x` 200، وملف App ‏200، و`/_api` يمر للبروكسي |

- **الهبوط ما يوصل لكود التطبيق:** فحصت ملفات الهبوط العامة (9 ملفات JS)، وما فيها `/_api` ولا `constructionClient` ولا `farqSession` ولا `api.farq.sa`.
- **الهبوط في المتصفح من البناء:** يفتح بدون ولا طلب فاشل، والخلفية الحية شغالة.

**Playwright** (كل الاختبارات على سيرفر التكامل 5190):

| المجموعة | النتيجة | وش تغطي |
|---|---|---|
| اختبارات الريبو | 11 من 11 | الكيبورد في 03 و04 وفي `/ui`، وجوال 01 إلى 04، ومسار الطلب 01 ← الإرسال بدون شبكة، والروابط |
| اختبارات B | 8 من 8 | RTL، وSEO، وروابط واتساب والإيميل (الـhref فقط، بدون ضغط فعلي)، والكيبورد، وحالتا التحميل والخطأ، وحدود الاستيراد |
| اختبارات D | 6 من 6 | استدعاءات الترسية مطابقة لـAwardDialog، والتركيز ينتقل لداخل النافذة ويبقى محصور فيها وEscape يقفلها ويرجّعه، وحالة «وصل عرض واحد»، وصندوق الوارد للقراءة فقط بدون أي طلب كتابة |

**المسار الكامل على بيانات الاختبار:** كل خطوة مجرّبة لوحدها على fixtures، ما انمشى كجلسة وحدة متصلة.
- 01 ← 02 ← التوصيل ← الإرسال: في `tests/new-request.spec.ts`، والـpayload مطابق حسب إثبات م4.
- 03 و04: harness.
- 05: harness، ومعه إثبات الاستدعاءات.
- **السبب:** المسار المتصل يحتاج دخول حقيقي وإرسال فعلي، وهذا ممنوع أثناء الاختبار.

build وtypecheck وlint: نظيفة. فيه تحذيرات oxlint قديمة في `ComparisonV2`، وما فيه ولا خطأ.

## قبل ← بعد
| | قبل | بعد |
|---|---|---|
| أعلى زمن إطار للخلفية | 8.3ms عند بداية كل جولة (تقرير م3) | تحت 1ms على شاشات حقيقية (1440 و390)، وp99 ‏0.3–0.4ms. كل الجولات انحسبت مسبقًا (sync = 0) |
| أحمد، شاشة 01 على 1440 (100 جولة) | — | بعيد 76 · أقرب 24 · قعد 0 |
| أحمد، شاشتا 03 و04 (1440 و390) | قعد 100 من 100 | **ما زال يقعد 100 من 100.** البطاقات تغطي الشاشة، والفراغات بينها 16–24px، وأحمد طوله 70px. ما فيه مسار نظيف أصلًا. القرار تحت |
| إعادة بناء الخلفية على شاشة 390 | 90 جولة في 25 ثانية (حلقة) | 4 جولات |
| الهبوط | غير موجود | عام، وLCP تقريبًا 1.99 ثانية على جوال متوسط حسب قياس B (Slow 4G، والمعالج أبطأ ×4) |
| `/` في server.py | نموذج كلمة المرور | الهبوط |

## الشاشات
| الشاشة | الحالة | اللقطة (Figma ↔ الكود) |
|---|---|---|
| الهبوط `/` | تم. الأرقام التسويقية placeholders | `compare-landing-1440.png` · `compare-landing-390.png` |
| الدخول `/login` | تم، بالشفافية. ما لها frame في Figma | `compare-login-1440.png` · `compare-login-390.png` |
| 01 طلب جديد | تم (م4) | `compare-01-1440.png` · `compare-01-390.png` |
| 02 مراجعة البنود | تم (م4) | `compare-02-1440.png` · `compare-02-390.png` |
| التوصيل والإرسال | تم، بدون تصميم في Figma | `app/02b-delivery-*.png` · `app/02c-send-*.png` |
| 03 متابعة الطلب | تم (م2 وم4) مع الشفافية | `compare-03-1440.png` · `compare-03-390.png` |
| 04 المقارنة | تم مع الشفافية، والترسية صارت Sheet | `compare-04-1440.png` · `compare-04-390.png` |
| 05 تأكيد الترسية | تم. لقطة الـharness تعرض الـSheet لحاله بدون الشاشة اللي وراه | `compare-05-1440.png` · `compare-05-390.png` |
| 06 صندوق الوارد | جزئي: للقراءة فقط، و«العرض المستخرج» ينتظر حقول من الـAPI، والاختبار الحي ما انعمل | `compare-06-1440.png` · `compare-06-390.png` |
| الاستهداف 07–10 | مؤجل، رابط فقط | — |
| الوضع الليلي | مؤجل، الـtokens موجودة وغير مفعّلة | — |

كل اللقطات في `docs/qa/final/`.

## المشاكل المفتوحة
1. **أحمد في شاشتي 03 و04: يحتاج قرار منك.** فيه ثلاث خيارات:
   - (أ) يبقى يقعد في الشاشات المزدحمة، ويطلع في الهبوط والدخول وطلب جديد. هذا الوضع الحالي.
   - (ب) نسمح له يمر خلف البطاقات، مثل المرجع الأصلي.
   - (ج) نخفف الهامش حوله. هذا ما يكفي لحاله، لأن الفراغات أقل من 24px.
2. **حقول API ناقصة** (`open-issues.md` §3 و§7):
   - «العرض المستخرج» في 06: البنود والأسعار ودرجة الثقة.
   - قناة كل محادثة في القائمة.
   - عدّاد غير المقروء.
   - الرد من صندوق الوارد، ويحتاج قرار قبل ما ينربط أي إرسال.
3. **quoteCoverage** (§2): منسوخة من نسخة غير محفوظة في فرق بناء، وبصمتها ومصدرها في أول الملف. ما انبنى عليها منطق جديد.
4. **أرقام الهبوط التسويقية** (§5):
   - كل الأرقام placeholders واضحة: شريط الثقة، وأسعار الخطط، وحدودها.
   - 5 أسئلة شائعة بدون إجابة.
   - رقم السجل التجاري والرقم الضريبي ناقصين.
   - الصفحات القانونية ناقصة.
   - صورة `og:image` ناقصة.
   - النطاق النهائي `SITE_URL` لازم يتحدد.
5. **شروط الشعارات:** شعارات واتساب وحراج ومركز اتصال فرق مستخدمة من الحزمة داخل الخلفية. شروط العلامات تحتاج تأكيد قبل الإطلاق.
6. **نص Figma في 05:** النص يقول «نبلّغ الباقين… تقدر تلغي خلال 30 دقيقة»، والـAPI ما يسوي هذا. عشان كذا ما استخدمته (§6).
7. **الاختبار الحي لصندوق الوارد** (R-D6) ما انعمل، لأنه يحتاج جلسة دخول. الخطوات:
   - ترسل «اختبار صندوق الوارد» على ‎+966 51 019 7017.
   - تفتح `/inbox` وأنت داخل.
   - نسجّل هل ظهرت، وبعد كم ثانية (القائمة تتحدث كل 15 ثانية)، وكيف انعرضت.
8. **AwardDialog القديم** باقي كمرجع «قبل» لإثبات الاستدعاءات، ونحذفه بعد ما توافق (R-D4).
9. **الخلفية:** فيه commit تسخين إضافي من وكيل الخلفية ينتظر. ينضاف كـcommit ثاني لما يبلّغ.

## وين موجود
- **الفرع:** `integration/today`، في المجلد `~/farq-pricing-wt/integration`.
- **فروع المسارات:**
  - `design/landing` (B): ac12c9b.
  - `design/screens-b` (D): 3a8215c.
  - `design/live-bg`: 49c8300.
  - `design/request-flow` (C): ملغى وما اندمج.
- **التقارير:**
  - `docs/qa/final/`: هذا الملف، واللقطات، و`curl.txt`، و`shoot.mjs`.
  - `docs/qa/m3b/`: قياسات الخلفية وسكربتاتها.
  - `docs/qa/landing/README.md`.
  - `docs/qa/screens-b/README.md`.
  - `docs/qa/requests.md` و`docs/qa/open-issues.md`.
- **ما انعمل push.** الـpush والـPR بقرارك بعد المراجعة.
