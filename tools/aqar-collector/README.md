# Farq Aqar collector

A Chrome extension that runs in the user's own browser on sa.aqar.fm (the site blocks server requests). It feeds
`services/targeting-api/parse_aqar_list.py` and `build_real_estate_reference.py`; only district aggregates and a
link to each listing reach Atlas.

- **List walk (`collect.js`).** «ابدأ من هذه الصفحة» on a city page starts a run that moves by itself: a slice
  that lists sub-areas with counts (city → region → district) is replaced by them, a district that ends below 90% of
  its count is split by property type, anything else is paged to its end. Each listing is kept once by its Aqar id,
  as its card shows it: text lines, link, photo. A block or check page pauses the run.
- **Map answers (`inject.js`, `relay.js`).** Aqar's map receives listings from its GraphQL `Web.find` with location,
  district id, link, price, rent period and photos; each is kept once, with the latest request as a template.
- **Fast run (`relay.js`).** «سحب سريع من الخريطة» replays that template: the area the map last showed is cut into
  quarters until a tile holds at most 1,000 listings, and each tile is read 50 at a time with a short pause. Its state
  lives in storage, so a reloaded tab resumes; a 403/429 pauses it.

Records are kept as received, contact details included; they are hidden when Farq processes the export.

Install: `chrome://extensions` → Developer mode → Load unpacked → this folder. Exports are raw data: keep them out
of Git.
