# Brief: everything drawn on the Farq Atlas map

Hand this file to the designer. It is self-contained, and it goes with `icon-3d-glass-brief.md` (the glass icons, already delivered and installed in `apps/atlas/public/icons/3d`).

The glass icons say **what a place is** (a café, a villa). This brief covers everything else: the shapes that carry those icons, the badges that say **what state a place is in**, the areas and lines, the cards that open on a click, and the controls on top of the map. A visual catalog of each element as it looks today is on the page «مكونات خريطة أطلس».

## Ground rules for every item

- **Palette:** only the Atlas palette in `apps/atlas/lib/palette.ts`. Main: olive `#3E573B`, leaf `#6B923A`, ink `#172A1E`, white. Accents: ochre `#C48A0A`, slate `#6F8796`, clay `#B5643C`, plum `#8A6F9E`, stone `#9C8F7B`. The basemap is warm stone land `#EFEBE4` with white streets, so every marker needs a white edge to stand off it.
- **Type:** Arabic, right to left. Numbers are always English digits (0-9) with English commas and `%` (`3,800`, `42%`), never `٣٬٨٠٠` or `٪`.
- **Missing data** is shown as the words «غير متاح», never as 0, a blank or a pale colour that reads as "low".
- **No brand marks:** no WhatsApp, Google, Mapbox or data-source logos. No source names inside the design.
- **No export, download or print** buttons on any card.
- **Two kinds of icon, never mixed:**
  - Glass icons are for things in the world (a shop, a warehouse).
  - Flat line icons (1.75 px stroke, 24 px grid, round caps) are for controls and status.
- **Touch:** anything clickable on the map has a hit area of at least 32 × 32 px, and 44 × 44 px on phones.

## A. Markers (the shapes that sit on a point)

Deliver each as an SVG and as a PNG at 1x and 2x, named as in the table. The colour of a marker changes in code, so draw the colour parts as one flat fill we can recolour, or deliver one file per colour where the table lists colours.

| File | What it marks | Size (1x) | States to design | Notes |
|---|---|---|---|---|
| `pin-site` | A candidate site the user placed (store owners, compare sites) | 34 × 44 | default, dragging (lifted, larger shadow), selected, busy (while numbers load) | Teardrop with a number 1, 2 or 3 in white. Colours: 1 olive, 2 ochre, 3 slate. |
| `poi-disc` | A business on the map | 24 (zoom 14-16) and 36 (zoom 16+) | default, competitor, my business, selected, dimmed | White disc with a glass icon inside and a 2.5 px ring. The ring carries the meaning: ochre for a competitor, olive for mine. |
| `poi-dot` | A business when zoomed out (zoom 12-14) | 8 | default, selected | A plain dot in the sector colour with a 1 px white edge. No icon. |
| `price-pill` | A property listing | auto width × 30, with a 7 px tail | below, close to, above the district median, «غير متاح», needs checking; plus active (hovered in the list) and seen | Rounded capsule: the price in bold white, and a property-type glass icon at one end. Colours: below leaf, close stone, above ochre, unavailable slate, needs checking bark. Active is white with an ink outline. |
| `cluster` | Many points grouped | 28, 36, 46 | default, hover (soft halo) | Olive circle, white count (`8`, `42`, `1.2k`). Three sizes: under 25, up to 100, over 100. The same look for listings and businesses. |
| `depot` | The start of a delivery route | 34 | default, selected | Rounded square, white, olive edge, with the `warehouse` glass icon. Must not look like any business marker. |
| `stop` | A stop on a route | 20 | next, done (faded), default | Ochre circle with the visit number in white. Hundreds may show at once, so the number is the only content. |
| `pin-search` | The place the user searched for | 34 × 44 | default | One dark (ink) teardrop with a white dot. It is the only ink pin, so the user always finds "what I searched for". A name label sits under it. |
| `my-point` | The user's own place (work, school) when choosing a home | 32 | default, selected | White disc with a plum ring and a glass icon (`main-biz`, `main-edu`, `main-health`). |
| `site-building` | A building under construction | 40 | default; and a plain ochre dot when zoomed out | Rounded square with a dashed ochre edge ("not finished yet") and the `main-contract` or `main-build` glass icon. |

### Badges (small marks on top of a marker)

Flat SVG, 12 px, placed at the top corner of a disc with a 1.5 px white edge.

| File | Meaning |
|---|---|
| `badge-reach` | Can be reached by WhatsApp. A chat bubble, **not** the WhatsApp logo. |
| `badge-new` | Opened recently |
| `badge-closed` | Closed or not confirmed |
| `badge-verified` | Checked by Farq |
| `badge-competitor` | A competitor of the chosen activity, for when colour alone is not enough (colour-blind users) |

### Zoom ladder for businesses

Design the four steps as one sequence so they read as the same thing growing:

1. Zoom under 12: `cluster` with a count.
2. Zoom 12 to 14: `poi-dot` in the sector colour.
3. Zoom 14 to 16: `poi-disc` at 24 px with the sector's glass icon (`main-*`).
4. Zoom 16 and closer: `poi-disc` at 36 px with the everyday-activity icon when there is one (pharmacy, café…), otherwise the sector icon, and the business name under it.

Also deliver **one colour per sector** (23 colours) that stays quiet on the stone basemap and lets neighbouring sectors be told apart. Start from the `CATEGORICAL` list in `palette.ts`.

## B. Areas

| Item | What to design |
|---|---|
| **District shading** | Confirm or adjust the three scales: five olive steps (most lenses), five ochre steps (competition), and one diverging scale for saturation (below 1 = opportunity, above 1 = saturated, 1 = neutral). Plus the **«غير متاح» hatch**: a repeating diagonal pattern, delivered as a 16 × 16 PNG tile at 1x and 2x (`pattern-unavailable`). |
| **District outline** | Three weights: normal (thin olive, 35% opacity), hover, selected (3 px ink). Two selected districts side by side for comparison need two outline colours. |
| **District name** | Two sizes by zoom, with a halo that stays readable over any of the shading steps. Names come from the official Atlas spelling. Do not change them in the design. |
| **Radius area** | Fill and edge in the site's colour, a drag handle on the edge, and a label on the handle (`2 كم`). |
| **Drive-time areas** | Three nested rings for 5, 10 and 15 minutes in the site's colour, with stepped opacity, and a small label on each ring (`10 د`). |
| **Rep territories** | Each territory in its own colour, the selected one strong and the rest dimmed. One outer edge around the whole territory, not one per district. A badge at the centre with the rep's name or letter. |

## C. Lines

| Item | What to design |
|---|---|
| **Route** | The olive line with its white casing exists today. Add soft direction arrows along it (a sprite, `route-arrow`), the part already driven faded, and a label for each leg (`8 د · 3.1 كم`). |
| **My point to a listing** | A dashed plum line, with time and distance in a small label. |
| **Drawing an area** | While drawing: a dashed edge, white vertex dots, and a closing state. |

## D. Cards that open from the map

Design each card at two widths: desktop (360 px, beside the map or anchored to the point with a tail) and phone (a bottom sheet). Every number on a card can be tapped to open a small explanation, so show that tap state once. Every card needs these states: loading, an «غير متاح» figure, and failed to load (with "try again").

| Card | Opens from | Content today (keep the fields, design the layout) |
|---|---|---|
| **District** | A click on a district | Name; residents; businesses; residents per business; searches with no result («X من Y»); delivery-app restaurants; men · women; Saudis %; typical menu price; villa share %; average income; new and under-construction buildings; top activities; registered deal price per m²; rents by type. The lens decides which figures show first. |
| **Business** | A click on a business | Name, glass icon of its activity, sector, district, has-WhatsApp badge, verified badge. No phone numbers on the card for the analysts lens. Contact stays manual and after review. |
| **Listing** | A click on a price pill | All photos (gallery), price, price per m², against the district median (coloured), type icon, area, district, and a link that opens the ad in the real-estate app. No advertiser numbers. |
| **Site comparison** | Placing 2 or 3 sites | One column per site in its pin colour (1, 2, 3): residents, homes, businesses, residents per business, the site score out of 100. The better value in each row is marked. |
| **Territory** | A click on a territory | Rep name, number of businesses, districts, the route summary (stops, km, minutes). |
| **Cluster peek** | A long press or hover on a cluster | A short list of what is inside, with a link to zoom in. |
| **Search result row** | The search box | Glass icon of the activity, name, district, distance. |

## E. Controls on top of the map

| Item | What to design |
|---|---|
| **Lens switcher** | Five lenses: أصحاب المتاجر، المسوّقون، الموزّعون، المحلّلون، الباحثون عن عقار. Selected, default and hover. Each lens shows its numbered steps, for example «أين ينقص نشاطي؟ ← المنافسون ← قارن المواقع ← محلات للإيجار». |
| **Activity chips** | A chip with a 24 px glass icon and a name. Selected, default, disabled. The seven everyday activities, then the sectors. |
| **Colour key** | One per lens: the scale between two words, plus the «غير متاح» hatch square. Folds away on phones. |
| **Map buttons** | Flat line icons: `zoom-in`, `zoom-out`, `compass`, `my-location`, `layers`, `fullscreen`, `draw-area`, `place-pin`, `ruler`. And a distance scale in km. |
| **Pick mode** | A crosshair cursor and a small hint that follows it: «انقر لوضع الدبوس». |
| **Map states** | Loading, the map failed to load (with reload), no results in this area, and a city without this data («غير متاح في هذه المدينة»). Use the `land` or `main-re` glass icon for the empty states. |

## F. More glass icons (same brief, same look)

Make these to `icon-3d-glass-brief.md`, word for word, so they match the set:

| File | Arabic | Object |
|---|---|---|
| `unknown.png` | نشاط غير مصنّف | an empty frosted glass cube |
| `fuel.png` | محطة وقود | a fuel pump |
| `atm.png` | صراف آلي | a card going into a slot (no bank logo) |
| `carwash.png` | مغسلة سيارات | a car with water drops |
| `workshop.png` | ورشة | a car lift with a wrench |
| `bank.png` | بنك | a classical building front with columns |
| `mosque.png` | مسجد | a dome with a minaret |

## Files

- Markers, badges, patterns and line sprites: SVG plus PNG at 1x and 2x, sRGB, transparent background. Name the files exactly as in the tables, lower case with dashes. They will live in `apps/atlas/public/map/`.
- Cards and controls: one Figma (or similar) file with every state named as above, at 360 px and at phone width (390 px), right to left.
- A contact sheet of all markers over the real basemap colour `#EFEBE4` and over the darkest shading step `#3E573B`, to check the white edges.

## Acceptance

- [ ] Every item in sections A to E is there with all of its states.
- [ ] Only colours from `palette.ts`. No neon, no pure black.
- [ ] All numbers in the designs use English digits and `%`. Missing figures say «غير متاح».
- [ ] No logos or source names anywhere.
- [ ] Each marker can be told apart from the others in greyscale, by its shape and not only by its colour.
- [ ] The business markers read at every step of the zoom ladder, and 300 of them on one screen stay readable.
- [ ] Every clickable item has a 32 px hit area (44 px on phones).
- [ ] Licence: delivered free for Farq to use commercially, with no third-party marks.
