# Bolt brief: Farq Atlas front end

Paste everything below the line into Bolt. Bolt builds the **front end only**. The server, data, and every API
route already exist and are owned by Farq engineering. Bolt consumes them through one typed client and never
invents numbers.

---

## 1. What you are building

**Farq Atlas (فرق أطلس)** is a Saudi market map. A user picks who they are, and the map walks them through one
decision with real figures for every district of the city. At the end of the journey, they act: send a quote
request, prepare a WhatsApp campaign, save a list, or open a property ad to contact its advertiser. Nothing is sent
automatically. Every outbound action becomes a draft that the user reviews first.

Build a production-quality, **Arabic-first, RTL** web app as **source code**: Next.js App Router, TypeScript (strict),
Tailwind CSS, shadcn/ui, lucide-react, and mapbox-gl. The output is merged into an existing Next.js app
(`apps/atlas`). It is **not** a zipped or prebuilt bundle.

## 2. Non-negotiable product rules

1. **Every number comes from the API, or shows «غير متاح».** Never show 0 in place of missing data. Never estimate,
   round up, or fill gaps. Use no placeholder or demo figures in the shipped UI.
2. **Numbers use English digits (0-9) and English thousands separators**, through one formatter:
   `new Intl.NumberFormat('en-US')`. The percent sign is «%» written after the number: «45%». Never use Arabic-Indic
   digits or «٪».
3. **Every figure can be tapped.** It opens a small popover titled with the figure's name and 1–3 short lines that
   explain how it was worked out. All explanation text lives in one file, `lib/explanations.ts`. Do not put notes or
   footnotes under results.
4. **No export, download, print, or copy-all.** Value stays inside the product.
5. **No automatic sending.** Quote requests, campaigns, and lists are drafts that open in «الطلبات» for review.
6. **Name no outside data source in the UI**, with one exception: a property listing's button opens the ad on Aqar
   (عقار) so the user can call or chat from their own account.
7. **A missing permission or login** shows a clear inline message with a login link. It is never an empty list.
8. **Rents always show their period as the ad states it:** «سنوياً», «شهرياً», or «المدة غير مذكورة». Never convert one
   period into another.
9. **Mobile first, and fast.** At 360px wide, the map takes the top half and the panel scrolls below it. At 1024px
   and wider, the map sits on the left and a 400px panel on the right (in RTL, the panel is on the visual right).

## 3. Information architecture

| Route | Purpose |
| --- | --- |
| `/` | Landing page: one headline, then 6 goal cards that deep-link into the map. |
| `/map` | The product: city picker, 5 lenses, business search, map, and a journey panel. |
| `/requests` | Drafts and sent requests (quote requests, campaigns, lists), with status. |
| `/requests/[id]` | One request: edit the recipients and message, see quotes side by side, then send manually after review. |
| `/inbox` | Replies to quote requests and campaign responses. Each item links to its request. |
| `/login` | Email and password login. Returns to `?next=`. |

**Top navigation, three items only:** «الخريطة والرؤى» (`/map`), «الطلبات» (badge: drafts needing a decision),
«الوارد» (badge: unread). It is a bottom tab bar on mobile.

**Landing goal cards.** Each card opens `/map?goal=…`:

| Goal id | Title | Opens |
| --- | --- | --- |
| `explore` | أفهم السوق | lens `analysts` |
| `expand` | أختار موقعاً للتوسع | lens `shops` |
| `target` | أصل إلى عملاء جدد | lens `marketers` |
| `find-supplier` | أجد مورداً وأطلب عرض سعر | focuses the search box |
| `network` | أخطط للتوزيع والتغطية | lens `distributors` |
| `property` | أبحث عن عقار | lens `property` |

## 4. The map screen (`/map`)

### 4.1 Layout, top to bottom

1. **Bar:**
   - City select: options from `GET /api/market/cities`; default الرياض.
   - Lens segmented control with 5 tabs.
   - Search form: placeholder «ابحث عن مورد أو نشاط، مثل: مورد قهوة», button «ابحث».
2. **Figures row:** up to 3 chips (all chips for the analysts lens), one per figure the map can be shaded by.
   - The active chip is outlined.
   - While a step is painting the map itself, replace the chips with one line: «ألوان الخريطة الآن من خطوة «…».»
3. **Map:**
   - Mapbox dark style, with Arabic place names (`name_ar` falling back to `name`).
   - District polygons shaded in **5 quantile steps** of Farq green: `#0f2e25 #134a3b #186b53 #1f9a76 #25c99a`. A
     district without the figure is not shaded.
   - Tapping a district selects or deselects it: a white 3px outline.
   - Legend at the bottom start: «أقل ▢▢▢▢▢ أعلى · {figure}», tappable for its explanation.
4. **Panel:** the lens's **numbered steps** as stacked buttons (①, ②, ③). The active step is highlighted. The step's
   tool renders below. If a search is open, it replaces the steps and has a «إغلاق البحث والعودة للخطوات» link.

### 4.2 The five lenses (the core of the product)

Each lens is one journey. Show **only its own steps and figures**.

| Lens id | Label | Steps, in order | Figures on the map |
| --- | --- | --- | --- |
| `shops` | أصحاب المتاجر | ① أين ينقص نشاطي؟ ② قارن المواقع ③ محلات للإيجار | ساكن لكل منشأة · إيجار متر المحل (المدة غير مذكورة) · السكان |
| `marketers` | المسوّقون | ① أين جمهوري؟ ② منشآت الأحياء والحملة | السكان · متوسط الدخل · حصة الفلل من المساكن |
| `distributors` | الموزّعون | ① المناطق والمسار ② أين يُبنى الآن؟ | المنشآت · مبانٍ جديدة وتحت الإنشاء · إيجار متر المستودع سنوياً |
| `analysts` | المحلّلون | ① الأحياء والترتيب ② قارن حيين | all 12 figures |
| `property` | الباحثون عن عقار | ① اختر عقاراً ② تعرّف على الحي | إيجار متر السكن سنوياً · إيجار متر السكن شهرياً · سعر متر السكن للبيع |

### 4.3 Tools: one component each, in `components/lens/tools/`

**«أين ينقص نشاطي؟» (gaps)**
- **Input:** an activity select, filled from the market summary.
- **Data:** `POST /api/market/market-gaps` returns, per district, its businesses and the number expected at the city
  rate.
- **Map:** districts painted by gap size.
- **Panel:** a ranked list «أكبر فجوة»; tapping a row selects the district.

**«قارن المواقع» (around)**
- **Input:** tap the map to drop up to 3 numbered pins. Then choose a reach: 500 م / 1 كم / 2 كم, or 5 / 10 / 15 دقائق
  بالسيارة.
- **Data:**
  - A drive-time area comes from `POST /api/routing/isochrone` with
    `{locations:[{lat,lon}], costing:'auto', contours_minutes:[n]}`.
  - The figures come from `POST /api/market/population-within` with `{geometry}`, which returns
    `{population, dwellings, businesses, top_activities[]}`.
- **Panel:** a comparison table. Rows: السكان، الوحدات السكنية، المنشآت، ساكن لكل منشأة. Columns: the pins. The best
  value in each row is highlighted.

**«محلات للإيجار» / «اختر عقاراً» (homes)**
- **Filters:**
  - إيجار / شراء.
  - Type chips: غرفة، شقة، دور، فيلا، محل، مكتب، مستودع، أرض. أرض is for sale only.
  - Rent period chips: سنوي / شهري / المدة غير مذكورة / الكل.
  - Budget select. It is hidden for «الكل», because periods would mix.
- **Data:** `POST /api/market/real-estate-listings` with
  `{city, kind, deal?, types:[type], max_price?, district_ids?, limit:1500}`.
  It returns `{available, total, listings: Listing[]}` (type in §6).
- **Map:**
  - Listings appear as clustered dots that open into single dots on zoom.
  - Dot colour: green below its district median, grey near it, amber above it, blue without a median, dark grey when
    `check` is true.
- **Popup card** (one at a time, docked at the bottom of the map, never crowded):
  - A swipeable gallery of **all** `photos`, with a counter «14 صور».
  - Type and district; the price line with its period; the area, bedrooms, and bathrooms.
  - The price per m² with its period, and «أقل من وسيط {حي} بـ 12%».
  - When `check` is true, the warning «أرقام هذا الإعلان تحتاج تحققاً».
  - Two buttons: «اتصل أو راسل المعلن» opens `url` in a new tab; «أضف للمقارنة».
- **Panel:**
  - «{total} عرضاً في المدينة».
  - «أنسب العروض»: the top 8, already ordered by the server.
  - A comparison tray of up to 2 listings, with the button «قارن العرضين مع المساعد».
- **Presets:** in the shops lens, the tool opens on rent + محل + period «الكل».

**«أين جمهوري؟» (audience)**
- **Two modes:** «أستهدف أفراداً» and «أستهدف منشآت».
  - **People:** sex, nationality, and minimum income chips.
  - **Businesses:** an activity select.
- **Data:** `district-audience`, `district-counts`, and `market-summary`.
- **Score:** each district gets a 0–100 score within the city: its audience ÷ the top district's audience × 100.
- **Panel:** «حجم الجمهور» total, then the top 10 districts with their score.

**«منشآت الأحياء والحملة» (businesses)**
- With no district selected, show the hint «اختر حياً أو أكثر من الخريطة…».
- Otherwise list the businesses of the selected districts from `POST /api/market/entities` with
  `{city, district, limit:200}`.
- Controls: a checkbox per row and «اختر الكل».
- Three actions: «طلب تسعير», «حملة واتساب», «حفظ قائمة». Each creates a draft and navigates to `/requests/{id}`.
- **Login:** a 401 shows «لعرض المنشآت… سجّل الدخول».

**«المناطق والمسار» (territories)**
- **Inputs:** the number of reps and a weighting: السكان or منشآت النشاط.
- **Data:** `POST /api/market/territories` returns contiguous groups of districts, which paint the map in distinct
  colours.
- **Route:** for one rep, pick a start point, then `POST /api/routing/optimized_route`. The route is drawn as a line,
  part by part.

**«أين يُبنى الآن؟» (growth) and «الأحياء والترتيب» (district)**
- Shading by the active figure.
- The district summary card, and a ranked table «الأعلى في {figure}» (full list for analysts).

**«قارن حيين» (compare)**
- Hint until exactly 2 districts are selected, then the comparison assistant opens.

**«تعرّف على الحي»**
- The district summary card for the selected district(s).

### 4.4 District summary card

- **With nothing selected:** the city totals.
- **With districts selected:** the same figures for the selection: السكان، المنشآت، ساكن لكل منشأة،
  حصة الفلل، متوسط الدخل، أكبر شريحة عمرية.
- **Property prices** under the heading «أسعار العقار المعروضة (للمتر)»:
  - One line per group key from `real-estate`, labelled «بيع سكن», «إيجار سكن سنوي», «إيجار سكن شهري»,
    «إيجار محل (المدة غير مذكورة)», and so on.
  - Order: sale first, then yearly, monthly, and unstated rents.
- Every figure is tappable, and a missing one shows «غير متاح».

### 4.5 Comparison assistant (shared by properties and districts)

1. **Chips:**
   - «لمن تبحث؟»: عائلة بأطفال / زوجان / أعزب / شخص يعيش وحده / لنشاط تجاري.
   - «ما الأهم لك؟» (multi-select): السعر الأقل / مساحة أكبر / حي هادئ قليل المحلات / خدمات ومحلات قريبة / حي عائلي.
   - A free-text field for anything else.
2. The button «قارن» calls `POST /api/advisor` with `{facts, profile, turns}` and gets back `{reply}`.
   - `facts` is plain text that the client builds **only** from figures already on screen.
3. The reply appears as a chat bubble, and the user can answer follow-up questions.
   - The conversation alternates: the assistant first, then the user.
   - If a request fails, put the user's text back in the input box.
4. Footer: «يقارن من أرقام أطلس فقط، ولا يقرر عنك.»
5. Errors:
   - 401 shows the login message.
   - 503 shows «المساعد غير مفعّل بعد».

### 4.6 Business search (all lenses)

- Submitting the search opens the businesses panel on the **whole city**, or on the selected districts if any, with
  `{city, q, objective:'purchase', limit:200}`.
- It has the same three actions: quote request, campaign, and list.

## 5. Requests and inbox

- **`/requests`:**
  - Tabs: الكل / مسودات / مُرسلة / بها ردود.
  - Each row shows the type icon (طلب تسعير، حملة، قائمة), title, recipient count, status badge, and updated time.
- **`/requests/[id]`:**
  - The recipients list, removable.
  - Editors: the message editor for campaigns; quantities, specs, and deadline for quote requests.
  - «جاهز للمشاركة اليدوية»: copy the text or open it on WhatsApp, one recipient at a time.
  - Quotes side by side.
  - Sending always asks for a confirmation that names the exact number of recipients.
- **`/inbox`:**
  - Filters: الكل / غير مقروء / ردود التسعير / تفاعلات تسويقية.
  - The message detail always links «افتح الطلب» to its request.

## 6. API contracts (already implemented; do not change them)

All routes are same-origin under `/api`. Errors return `{error: string}` in Arabic: show it as-is. Treat 401 as
"login needed".

```ts
// GET /api/market/cities → { cities: { en: string; ar: string }[] }
// GET /api/market/districts?city=Riyadh → GeoJSON FeatureCollection; properties: { id, ar, city_en }
// GET /api/market/population-districts?city= → { districts: { district_id; district_ar; population: number|null; source }[] }
// POST /api/market/{district-counts|district-income|growth|housing-level|real-estate|district-audience|district-profile|market-summary|market-gaps|territories|population-within} — body { city, ... }
// POST /api/market/real-estate → { available, districts: { district_id; district_ar; groups: Record<string, { listings: number; median_sar_per_sqm: number }> }[] }
//   group key = `${deal}_${group}`, deal ∈ sale | rent_year | rent_month | rent_unstated; group ∈ residential | commercial | office | warehouse | land
// POST /api/market/real-estate-listings → { available: boolean; total: number; listings: Listing[] }
type Listing = {
  id: string; url: string | null; lon: number; lat: number
  district_id: string | null; district_ar: string | null; city: string
  kind: 'rent' | 'sale' | null; deal: 'sale' | 'rent_year' | 'rent_month' | 'rent_unstated' | null
  type: string; group: string
  price_sar: number | null; area_sqm: number | null; sar_per_sqm: number | null   // in the ad's own period
  vs_district_pct: number | null; check: boolean
  photo: string | null; photos: string[]; address: string | null
  beds?: number; livings?: number; wc?: number; street_width?: number
}
// POST /api/market/entities { city, q?, district?, objective?, limit, offset } → { rows: { id; name; category; district; street; whatsapp: boolean; reason? }[]; total }
// POST /api/routing/{route|optimized_route|isochrone|sources_to_targets} (Valhalla shapes)
// POST /api/advisor { facts: string; profile: string; turns: {role:'assistant'|'user'; content}[] } → { reply }
// GET /api/mapbox-token → { token }
// GET|POST /api/requests, PATCH /api/requests/[id]; GET /api/session/me, POST /api/session/login|logout
```

Put every call in **one typed client**, `lib/atlas-api.ts`. Components never call `fetch` directly. Mocks may exist
only under `mocks/`, enabled by `NEXT_PUBLIC_ATLAS_MOCKS=1` for design work. They must never be a silent fallback in
production.

## 7. Visual design

- **Theme:** dark by default, with a light theme too.
  - Background `#0d1217`; card `#141b22`.
  - Primary (Farq green) `#25c99a`, text on primary `#0d1217`.
  - Amber `#f59e0b` for «above median» and warnings; destructive red for errors.
- **Typography:** IBM Plex Sans Arabic or Tajawal. Base 16px, panel headings 20px bold, figures 20px bold.
- **Shape:** cards with radius 16px, 1px borders, no heavy shadows. One accent colour; restraint over decoration.
- **Spacing:** 12–16px. Touch targets at least 40px.
- **Required states for every tool:** loading (spinner), empty (one helpful sentence), error (red, from the API),
  login needed, and «غير متاح».
- **Accessibility:** `role="tablist"` for lenses and steps; `aria-pressed` for chips; focus rings; labels on every
  input.

## 8. Quality bar and delivery

- TypeScript strict with zero `any` and zero ESLint errors. The production build passes (`next build`).
- One component per file. Server-safe imports; mapbox-gl is loaded on the client only.
- Each explanation string lives in `lib/explanations.ts`. Each formatter lives in `lib/format.ts`.
- Do not add analytics, trackers, or third-party scripts.
- **Deliver as a Git-ready source tree:** `app/`, `components/`, `lib/`, `mocks/`. No minified bundle and no zip.
- Before finishing, check each lens journey end to end with the mocks, at 360px and 1440px widths.
