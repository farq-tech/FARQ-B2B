# Brief: glossy 3D glass icons for Farq Atlas

Hand this file to the agent or designer who makes the icons. It is self-contained.

## The look

- Realistic 3D, glass and frosted-glass materials with soft refraction, subtle inner glow and clean specular highlights.
- Floating: the object hovers slightly above the ground, with **only a soft contact shadow** under it (grey, 20-30% opacity, blurred). No floor, no plate, no frame.
- **Transparent background** (PNG with alpha). Nothing else in the image: no text, letters, numbers, logos or brand marks.
- One consistent family: same camera (three-quarter view from slightly above, about 30°), same key light from the top-left, same scale (the object fills about 70% of the canvas, centred), same level of detail.
- Colour: clear glass tinted with the Farq palette.
  - Main tint: olive `#3E573B` and leaf green `#6B923A`.
  - Accents where the object needs them: warm sand `#E2CFA8`, terracotta `#B5643C`, slate blue `#6F8796`.
  - Avoid neon and pure black.
- Legible at 32 px: one clear silhouette per icon, no tiny parts.

## Files

- PNG, 512 × 512, transparent background, sRGB.
- Optimise each file under 120 KB.
- Name each file exactly as in the tables below (lower case, no spaces). The site loads `apps/atlas/public/icons/3d/<file>`.
- Also send one contact sheet of all icons on a white background and on a dark background, to check the shadow and edges.

## 1. Property types (real-estate page)

| File | Arabic | Object |
|---|---|---|
| `room.png` | غرفة | a single bed with a pillow |
| `apartment.png` | شقة | a mid-rise apartment tower with balconies |
| `floor.png` | دور | one storey cut from a building, shown as a slab with walls and windows |
| `villa.png` | فيلا | a two-storey villa with a flat roof and a garden wall |
| `store.png` | محل | a shopfront with an awning |
| `office.png` | مكتب | a glass office building, or a desk with a monitor |
| `warehouse.png` | مستودع | a warehouse with a roll-up door |
| `land.png` | أرض | a square plot of ground with corner stakes |

## 2. Everyday activities (chips on the map)

| File | Arabic | Object |
|---|---|---|
| `pharmacy.png` | صيدلية | a capsule pill with a small plus |
| `laundry.png` | مغسلة ملابس | a folded shirt on a hanger |
| `grocery.png` | بقالة | a shopping basket with produce |
| `restaurant.png` | مطعم | a plate with a fork and knife |
| `barber.png` | صالون حلاقة | scissors and a comb |
| `bakery.png` | مخبز | a loaf of bread |
| `cafe.png` | مقهى | a coffee cup with a saucer |

## 3. Main activities (the 23 commercial groups of the Farq taxonomy)

| File | Arabic | Object |
|---|---|---|
| `main-food.png` | أغذية ومشروبات | a cup and a plate together |
| `main-agri.png` | زراعة وثروة حيوانية وصيد | a sprout with a wheat ear |
| `main-build.png` | مواد بناء وتشطيب | stacked bricks with a paint roller |
| `main-contract.png` | مقاولات وخدمات إنشائية | a hard hat |
| `main-ind.png` | صناعة ومصانع | a factory with a chimney |
| `main-equip.png` | معدات وآلات | a gear with a wrench |
| `main-elec.png` | إلكترونيات وتقنية واتصالات | a smartphone with a chip |
| `main-auto.png` | سيارات ومركبات | a compact car |
| `main-home.png` | أثاث ومستلزمات منزلية | an armchair |
| `main-fashion.png` | ملابس وأزياء ومجوهرات | a dress on a hanger with a ring |
| `main-beauty.png` | تجميل وعناية شخصية | a lipstick and a cream jar |
| `main-health.png` | صحة وطب | a medical cross with a heart |
| `main-edu.png` | تعليم وتدريب | a book with a graduation cap |
| `main-hosp.png` | ضيافة وفعاليات وسياحة | a hotel bell |
| `main-log.png` | نقل ولوجستيات | a delivery truck with a box |
| `main-biz.png` | خدمات أعمال ومهنية | a briefcase |
| `main-re.png` | عقار | a house with a key |
| `main-fin.png` | مال وتأمين | a coin stack with a shield |
| `main-retail.png` | تجارة تجزئة وجملة عامة | a shopping bag |
| `main-energy.png` | طاقة ومياه وبيئة ونفط وتعدين | a water drop and a lightning bolt |
| `main-sports.png` | رياضة وترفيه | a football with a trophy |
| `main-media.png` | إعلام وثقافة وفنون | a camera with a music note |
| `main-personal.png` | خدمات شخصية | a pair of hands holding a heart |

## Prompt per icon

Use this shape for every icon. Only the object changes; keep the rest word for word so the set stays consistent:

> A single [OBJECT], realistic 3D icon made of clear and frosted glass tinted olive green (#3E573B) with [ACCENT] accents, soft refraction, subtle inner glow, crisp specular highlights, floating slightly above the ground, soft blurred contact shadow beneath only, three-quarter view from slightly above, key light from top left, centred, object fills about 70% of the frame, transparent background, no floor, no frame, no text, no logo, premium app icon style, consistent icon set.

Negative prompt: `text, letters, numbers, logo, watermark, background, floor, frame, border, pedestal, cartoon outline, neon, harsh black shadow, multiple objects`.

## Acceptance

- [ ] All files present and named as above.
- [ ] Every PNG has a real alpha channel (the corners are fully transparent).
- [ ] Only a soft shadow under the object; no ground plane.
- [ ] Same camera, light and scale across the set (check on the contact sheet).
- [ ] Each icon reads clearly at 32 px.
- [ ] Licence: the files are delivered free to use commercially by Farq, with no third-party marks.
