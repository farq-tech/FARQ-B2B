# Farq Aqar collector

A Chrome extension that runs in the user's own browser on sa.aqar.fm (the site blocks server requests) and records
the data the page itself receives. It feeds `services/targeting-api/parse_aqar_list.py` and
`build_real_estate_reference.py`; only district aggregates and a link to each listing reach Atlas.

**v0.1 — discovery.** Records every JSON answer, the page's embedded state and the card links as received, contact
details included; they are hidden when Farq processes the export, never in Atlas. Its export shows where the listing id, link, coordinates, price
and rent period live, so the collecting version reads those fields only.

Install: `chrome://extensions` → Developer mode → Load unpacked → this folder.

Exports are raw data: keep them out of Git.
