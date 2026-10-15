# Contact enrichment (free sources only)

Every output goes to `/Users/m4pro/farq-taxonomy-data/contacts/`, outside the repo and the deploy folders. The directory itself is never modified. Each number keeps its source and the date it was found.

1. `twin_phones.py`: phones we already hold on a duplicate row of the same business. The match requires the same normalised name (at least 6 characters), a distance within about 200 m, a name that is not generic (20 occurrences or fewer nationwide), and every twin agreeing on one number.
   Result (2026-10-15): **23,150** rows gained a phone, of which 18,632 are WhatsApp mobiles. 1,226 rows were skipped because their twins disagree.
2. `website_phones.py`: numbers published on the business's own website.
   - When there is no website, the domain of a company e-mail is used instead (free providers such as Gmail are skipped).
   - The script reads the home page and at most one same-site contact page, respects robots.txt, identifies itself, and drops placeholder numbers.
   - Candidates: 18,628 websites plus 3,599 company e-mail domains. 19,999 free-mail addresses were skipped.
   - Sample of 300 (2026-10-15): 55 had a number (18 %) and 37 had a mobile. E-mail domains hit 21 of 52 (40 %); websites hit 34 of 248 (14 %). Of the 300, 81 "websites" were really social-network links and 86 sites were unreachable.

Before any number is used for outreach: WhatsApp marketing needs the recipient's opt-in, and a sole trader's mobile is personal data under the Saudi PDPL.
