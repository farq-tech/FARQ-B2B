"""Specialty layer (owner-approved list docs/qa/targeting/taxonomy/specialties.csv, 4,073 specialties under the 431 subcategories).
A row gets every specialty of ITS OWN subcategory for which there is evidence, never a guess:
  1. supplier items (Farq construction DB items of the row or of suppliers merged into it)  -> confidence high
  2. a source label that the specialty list maps explicitly (`source_labels`: HudHud subcategory, Google/Foursquare/2GIS/Overture/OSM
     categories, directory categories)                                                         -> high
  3. a match term in the business name (whole words; Arabic article/prefixes allowed)        -> medium
Output: /Users/m4pro/farq-taxonomy-data/enrich/specialty_assign.parquet (poi_key, specialty_ids, specialties_ar, specialty_sources, specialty_confidence)"""
import csv, re, collections
import duckdb
T = '/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/specialties.csv'
D = '/Users/m4pro/farq-taxonomy-data/'
TR = str.maketrans('أإآةىؤئ', 'اااهيوي')
def norm(s):
    s = (s or '').lower().translate(TR)
    s = re.sub('[ً-ْـ]', '', s)
    return ' ' + re.sub(r'\s+', ' ', re.sub(r'[^\w\s]+|_', ' ', s)).strip() + ' '
spec = list(csv.DictReader(open(T, encoding='utf-8')))
import json as _json
_tax = {x['sub_id']: x for x in _json.load(open('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/farq_taxonomy.json'))['subs']}
# a term is evidence for ONE specialty only if it is not the subcategory's own wording («مقاولات», «زجاج», «عزل») and no sibling shares it
def _bare(w):
    # «وسياحه», «والسفر», «للسفر» are the subcategory's own words too (owner 2026-10-16: «سياحة» made 4,700 travel agencies «باقات سياحية خارجية»)
    for p in ('وال', 'بال', 'لل', 'ال', 'و'):
        if w.startswith(p) and len(w) - len(p) >= 3: return w[len(p):]
    return w
_sub_words = {sid: {v for w in norm(x['sub_ar'] + ' ' + (x.get('sub_en') or '')).split() for v in (w, _bare(w))} for sid, x in _tax.items()}
_term_owners = collections.defaultdict(set)
for r in spec:
    for t in (r['match_terms'] or '').split('|'):
        _term_owners[(r['sub_id'], norm(t).strip())].add(r['specialty_id'])
def _specific(sub, t):
    words = t.split()
    if len(_term_owners[(sub, t)]) > 1: return False
    if len(words) == 1 and (t in _sub_words.get(sub, set()) or (t.startswith('ال') and t[2:] in _sub_words.get(sub, set()))): return False
    return True
AR = {r['specialty_id']: r['specialty_ar'] for r in spec}
SUB = {r['specialty_id']: r['sub_id'] for r in spec}
by_sub = collections.defaultdict(list)          # sub -> [(compiled regex, specialty_id)]
label_map = collections.defaultdict(dict)       # sub -> {normalised label: specialty_id}
for r in spec:
    if r['specialty_ar'] in ('—', '') : continue
    terms = sorted({norm(t).strip() for t in (r['match_terms'] or '').split('|') if len(norm(t).strip()) >= 3 and _specific(r['sub_id'], norm(t).strip())}, key=len, reverse=True)
    if terms:
        alt = '|'.join(re.escape(t) for t in terms)
        # whole words; an Arabic term may carry ال / و / ب / ل / لل / وال in front
        by_sub[r['sub_id']].append((re.compile(r'(?:^|\s)(?:وال|بال|لل|ال|و|ب|ل)?(?:' + alt + r')(?=\s|$)'), r['specialty_id']))
    for lab in (r['source_labels'] or '').split('|'):
        k = norm(lab).strip()
        if len(k) >= 3: label_map[r['sub_id']][k] = r['specialty_id']
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='14GB'")
db.execute(f"""create table g as select g.poi_key, g.sub_id, coalesce(g.name_ar,'') || ' ' || coalesce(g.name_en,'') || ' ' || coalesce(g.tradename,'') nm,
   coalesce(g.farq_items,'') || ' | ' || coalesce(g.farq_items_merged,'') || ' | ' || coalesce(g.farq_activities,'') items,
   concat_ws('|', g.google_categories, replace(g.fsq_categories, ' | ', '|'), cr.hudhud_sub, ov.ov_cat, om.osm_kind, sm.gm_type, fl.categories, ec.categories,
             t.category, t.secondary_category, t.category_l3) labels
   from read_parquet('{D}golden/golden_set.parquet') g
   left join (select poi_key, any_value(hudhud_sub) hudhud_sub from read_parquet('{D}enrich/crs_latest.parquet') group by 1) cr using(poi_key)
   left join (select poi_key, any_value(ov_cat) ov_cat from read_parquet('{D}enrich/overture_match.parquet') group by 1) ov using(poi_key)
   left join (select poi_key, any_value(osm_kind) osm_kind from read_parquet('{D}enrich/osm_poi_match.parquet') group by 1) om using(poi_key)
   left join (select poi_key, any_value(gm_type) gm_type from read_parquet('{D}enrich/serper_maps.parquet') group by 1) sm using(poi_key)
   left join (select poi_key, any_value(categories) categories from read_parquet('{D}enrich/firms_license.parquet') group by 1) fl using(poi_key)
   left join (select poi_key, any_value(categories) categories from read_parquet('{D}enrich/eastern_cards.parquet') group by 1) ec using(poi_key)
   left join (select poi_key, category, secondary_category, category_l3 from read_parquet('/Users/m4pro/farq-targeting/data/targets.parquet')) t using(poi_key)
   where g.sub_id in (select unnest(?))""", [sorted(set(by_sub) | set(label_map))])
out = []
cur = db.execute("select poi_key, sub_id, nm, items, labels from g")
while True:
    batch = cur.fetchmany(50000)
    if not batch: break
    for key, sub, nm, items, labels in batch:
        found = {}
        it = norm(items)
        if it.strip():
            for rx, sid in by_sub.get(sub, []):
                if rx.search(it): found.setdefault(sid, ('farq_items', 'high'))
        lm = label_map.get(sub, {})
        if lm and labels:
            for lab in re.split(r'[|,;\n]', labels):
                sid = lm.get(norm(lab).strip())
                if sid: found.setdefault(sid, ('source_label', 'high'))
        n = norm(nm)
        if n.strip():
            for rx, sid in by_sub.get(sub, []):
                if sid not in found and rx.search(n): found[sid] = ('name', 'medium')
        if found:
            ids = sorted(found)
            out.append((key, ids, [AR[i] for i in ids], [found[i][0] for i in ids], 'high' if any(v[1] == 'high' for v in found.values()) else 'medium'))
sub_rows = dict(db.execute("select sub_id, count(*) from g group by 1").fetchall())
name_hits = collections.Counter((SUB[i], i) for x in out for i, src in zip(x[1], x[3]) if src == 'name')
generic = {i for (sub, i), n in name_hits.items() if sub_rows.get(sub, 0) >= 30 and n / sub_rows[sub] > 0.33}
print('generic-by-name specialties dropped from name evidence:', sorted(AR[i] for i in generic)[:30])
# the same test for source labels: a label carried by a third of a subcategory («travel agency») names the trade, not one specialty
label_hits = collections.Counter((SUB[i], i) for x in out for i, src in zip(x[1], x[3]) if src == 'source_label')
generic_label = {i for (sub, i), n in label_hits.items() if sub_rows.get(sub, 0) >= 30 and n / sub_rows[sub] > 0.33}
print('generic-by-label specialties dropped from label evidence:', sorted(AR[i] for i in generic_label)[:30])
clean = []
for key, ids, ars, srcs, conf in out:
    keep = [(i, src) for i, src in zip(ids, srcs) if not ((src == 'name' and i in generic) or (src == 'source_label' and i in generic_label))]
    if keep:
        clean.append((key, [i for i, _ in keep], [AR[i] for i, _ in keep], [src for _, src in keep], 'high' if any(src != 'name' for _, src in keep) else 'medium'))
out = clean
# last pass (owner 2026-10-16 «تأكد بان المشكلة ليست موجودة بامثله وتخصصات اخرى»): a specialty that still covers more than a third of
# a subcategory («معدات مطابخ ومطاعم», «مكافحة حشرات عامة», «مقهى شيشة») is the subcategory itself, not a specialty — kept only where the
# supplier declared it (farq_items)
hits = collections.Counter(SUB[i] + '|' + i for x in out for i in x[1])
too_common = {k.split('|', 1)[1] for k, n in hits.items() if sub_rows.get(k.split('|', 1)[0], 0) >= 30 and n / sub_rows[k.split('|', 1)[0]] > 0.33}
print('specialties covering >1/3 of their subcategory (kept only when supplier-declared):', sorted(AR[i] for i in too_common)[:40])
final = []
for key, ids, ars, srcs, conf in out:
    keep = [(i, src) for i, src in zip(ids, srcs) if i not in too_common or src == 'farq_items']
    if keep:
        final.append((key, [i for i, _ in keep], [AR[i] for i, _ in keep], [src for _, src in keep], 'high' if any(src != 'name' for _, src in keep) else 'medium'))
out = final
db.execute("create table o (poi_key varchar, specialty_ids varchar[], specialties_ar varchar[], specialty_sources varchar[], specialty_confidence varchar)")
db.executemany("insert into o values (?,?,?,?,?)", out)
db.execute(f"copy o to '{D}enrich/specialty_assign.parquet' (format parquet)")
tot = db.execute("select count(*) from g").fetchone()[0]
print('rows in subcategories with specialties:', tot, '| with a specialty:', len(out), f'({100*len(out)/tot:.0f}%)',
      '| multi:', sum(1 for x in out if len(x[1]) > 1), '| by source:', collections.Counter(s for x in out for s in x[3]).most_common())
