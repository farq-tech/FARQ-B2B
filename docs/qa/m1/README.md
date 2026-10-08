# M1 — Tokens: visual check

Screens 03 (tracking) and 04 (comparison), rendered by the dev-only harness
(`npm run dev` → `/?harness=tracking|comparison`, fixture data, 1176×1500, headless Chrome).

| Screen | Changed pixels before → after | What changed |
|---|---|---|
| 04 comparison | 0 | nothing |
| 03 tracking | 72 (bbox 703,772 → 708,862) | the warning and danger status dots: `#f97316` → `icon/warning #ff652f`, `#d9456a` → `icon/danger #c94f66` (off-palette values corrected to Figma) |
