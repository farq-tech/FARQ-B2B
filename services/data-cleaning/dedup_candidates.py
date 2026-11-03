# -*- coding: utf-8 -*-
"""Additive duplicate-merge *candidates* on top of the current Farq Atlas identity output.

The production identity layer (``build_farq_atlas_identity.py``, policy ``FARQ_ATLAS_IDENTITY.md``)
is deliberately conservative: it only merges on a repeated Google Place ID or a rare exact name at
the *exact* same coordinate. It therefore misses two kinds of genuine duplicate that it is safe to
recover with high precision:

* **Rule A — phone-anchored.** Two directory entities that share the *same real* (non toll-free)
  Saudi phone number, sit within ~75 m of each other, carry non-conflicting names (a shared word of
  at least four characters, or one name empty) and a compatible confident subcategory. A shared
  dialable number plus near-identical location is strong evidence of one business recorded twice.
* **Rule B — rare distinctive name, a few metres apart.** Two entities with the *same* normalised
  comparison name, where that name is nationally rare (``<=50`` records), is not merely a category or
  activity word, sit in the same city with the same branch/unit number and no conflicting evidence.
  This recovers the true duplicates the production "exact coordinate" rule drops because the two points
  differ by a handful of metres. Measured on the live release, a plain name+proximity match is *not*
  safe on its own — at 40 m it reproduces the 165k generic/branch cluster the owner already rejected,
  and the category blocklist barely dents it, because the mass is genuine-looking rare names that
  recur within metres (adjacent chain units, near neighbours). So Rule B fires only on one of two
  precision-gated tiers, each still under the shared guard below:

  - **B1 — identity-corroborated (``<=40 m``):** the pair also shares a hard identifier beyond the
    name — the same ``commercial_license``, ``source_trade_license``, building number, or
    ``google_place_id``. A shared commercial registration plus the same rare name a few metres apart
    is one registered business recorded twice, not two branches (two branches are never 40 m apart).
  - **B2 — essentially the same point (``<=6 m``):** the two points are within coordinate jitter of
    each other and the shared name carries a distinctive word of at least four characters. This is the
    production exact-coordinate rule widened by a few metres, which is what it was always meant to be.

  A plain rare-name match beyond 6 m with no shared identifier is held out, not merged — that is where
  the false-merge risk lives.

This module **never rewrites** the identity output. It reads the published release read-only and
emits a *candidate-merge delta*: clusters built by connected components over the surviving pairs,
every merge carrying its evidence, and a reversible crosswalk (``candidate_merged_source_poi_keys``
unions the members' existing ``merged_source_poi_keys``, so any candidate merge resolves back to the
original source rows). Whether the parent applies any of it is a separate, human decision.

Shared guard (applies to both rules, blocks the pair before any union):

* a different ``commercial_license`` on both sides;
* a different building number or floor on both sides (when present);
* a different *confident* subcategory on both sides (``unc.*`` / ``noncom.*`` are not confident);
* a different ``google_place_id`` on both sides.

Compatibility — not equality — is required: a value missing on either side never blocks, and never
proves identity. Requiring the subcategories to be *equal* collapses recall; requiring them only to
be *non-conflicting* keeps it. A cluster larger than :data:`CLUSTER_CAP` members is held for review
rather than auto-merged, because a large near-co-located cluster is more likely a building of
tenants than one business.

The module is import-safe (pure helpers, no I/O at import) and runnable::

    python3 dedup_candidates.py TARGETS.parquet POI_TAXONOMY.parquet OUT_DIR/
"""
import csv
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict

import duckdb

VERSION = 'dedup_candidates_v1'

# Tunable thresholds. Defaults chosen in the self-iteration trail (see the improvement log entry);
# every one is measured against false-merge risk, not pushed for raw recall.
RADIUS_A_M = 75.0     # phone-anchored: a shared real number plus this radius is one business.
RADIUS_B_M = 40.0     # rare-name tier B1 (identity-corroborated): still a dup when a hard id is shared.
TIGHT_B_M = 6.0       # rare-name tier B2 (same point): coordinate jitter of one physical POI.
RARE_MAX = 50         # a name carried by more than this many entities is not rare enough to anchor a merge.
PHONE_MAX = 50        # a number on more than this many entities is a shared/switchboard line, not identifying.
WORD_MIN = 4          # a shared name word must be at least this long to count as a non-conflicting name.
MAXTOK_MIN = 4        # tier B2 needs a distinctive word at least this long (drops short ambiguous names).
CLUSTER_CAP = 8       # a candidate cluster larger than this is held for human review, not auto-merged.
GRID_DEG = 0.001      # ~111 m blocking cell; neighbours are searched +/-1 cell, covering both radii.
KSA_BBOX = (16, 33, 34, 56)  # lat_min, lat_max, lon_min, lon_max — drops obviously invalid coordinates.

# Category / activity / generic words. A name made only of these is not distinctive enough for Rule B.
# Kept in sync in spirit with services/targeting-api/duplicate_review.py GENERIC_EXTRA; this module is
# standalone (different service) so the list is inlined rather than imported across service boundaries.
GENERIC_WORDS = {
    'الاتصالات', 'اتصالات', 'المركز', 'المؤسسه', 'الشركه', 'المكتب', 'المحل', 'المعرض', 'مؤسسه', 'شركه',
    'مكتب', 'مركز', 'محل', 'معرض', 'استراحه', 'استراحات', 'ورشه', 'بقاله', 'تموينات', 'مطعم', 'مطاعم',
    'صيدليه', 'صيدلية', 'مسجد', 'جامع', 'مغسله', 'صالون', 'حلاق', 'بوفيه', 'كافيه', 'مقهي', 'مخبز',
    'فرع', 'الفرع', 'الرئيسي', 'سوبرماركت', 'ماركت', 'بقالة', 'مستوصف', 'عياده', 'عيادة', 'مستشفي',
    'barbershop', 'barber', 'restaurant', 'pharmacy', 'cafe', 'coffee', 'salon', 'grocery', 'mosque',
    'shop', 'store', 'office', 'center', 'centre', 'company', 'est', 'establishment', 'branch', 'laundry',
    'bakery', 'supermarket', 'market', 'workshop', 'clinic', 'hospital', 'stc', 'mobily', 'zain',
}


def _sql_norm(col):
    """SQL comparison key of a name: one alef, ى→ي, ة→ه, no diacritics/tatweel, symbols→space, collapsed."""
    x = f"lower(coalesce(cast({col} as varchar), ''))"
    x = f"regexp_replace({x}, '[ً-ٰٟـ]', '', 'g')"
    x = f"translate({x}, 'أإآٱىة', 'ااااي' || 'ه')"
    x = f"regexp_replace({x}, '[^0-9a-zء-ي]+', ' ', 'g')"
    return f"trim(regexp_replace({x}, '\\s+', ' ', 'g'))"


def _phone_nsn_sql(col):
    """SQL national-significant-number (9 digits) for a Saudi phone, else ''.

    Strips an international ``00966`` / ``966`` country code and a national trunk ``0``. A valid NSN
    never itself starts with ``966`` (mobiles start ``5``, landlines ``1X``), so the strip is safe.
    """
    d = f"regexp_replace(coalesce(cast({col} as varchar), ''), '[^0-9]', '', 'g')"
    d = f"regexp_replace({d}, '^00966', '')"
    d = f"regexp_replace({d}, '^966', '')"
    d = f"regexp_replace({d}, '^0', '')"
    return d


def _phone_key_sql(nsn='nsn'):
    """A phone is an *anchor* only if it is a real Saudi mobile or geographic landline.

    Toll-free / unified business numbers (``9200xxxxx``, ``800xxxxxxx``) are shared by many unrelated
    outlets of a chain's call centre, so they are excluded; so is anything not well-formed.
    """
    mobile = f"regexp_matches({nsn}, '^5[0-9]{{8}}$')"
    landline = f"regexp_matches({nsn}, '^(11|12|13|14|16|17)[0-9]{{7}}$')"
    return f"case when length({nsn}) = 9 and ({mobile} or {landline}) then '966' || {nsn} end"


def _norm_token_sql(col):
    """Normalised digits-only comparison of an id-like field (licence, building, floor): '' when empty."""
    return f"nullif(regexp_replace(lower(coalesce(cast({col} as varchar), '')), '[^0-9a-z]', '', 'g'), '')"


def _haversine_sql(a='a', b='b'):
    return (f"2 * 6371000 * asin(sqrt(pow(sin(radians({b}.lat - {a}.lat) / 2), 2) + "
            f"cos(radians({a}.lat)) * cos(radians({b}.lat)) * pow(sin(radians({b}.lon - {a}.lon) / 2), 2)))")


def _union_find(edges):
    """Connected components over ``edges`` (iterable of (a, b)). Returns {root: sorted members}."""
    parent = {}

    def find(x):
        root = x
        while parent.get(root, root) != root:
            root = parent[root]
        while parent.get(x, x) != root:
            parent[x], x = root, parent[x]
        return root

    nodes = set()
    for a, b in edges:
        nodes.add(a)
        nodes.add(b)
        parent.setdefault(a, a)
        parent.setdefault(b, b)
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    comps = defaultdict(set)
    for node in nodes:
        comps[find(node)].add(node)
    return {root: sorted(members) for root, members in comps.items()}


def build(targets, taxonomy, out_dir, radius_a_m=RADIUS_A_M, radius_b_m=RADIUS_B_M,
          rare_max=RARE_MAX, word_min=WORD_MIN, cluster_cap=CLUSTER_CAP, phone_max=PHONE_MAX,
          tight_b_m=TIGHT_B_M, maxtok_min=MAXTOK_MIN):
    """Build the candidate-merge delta over ``targets`` (the current identity output).

    ``taxonomy`` is the release ``poi_taxonomy.parquet`` (``poi_key``, ``sub_id``, optional
    ``confidence``) used only to read a confident subcategory per entity for the guard. Nothing is
    merged, deleted or edited; outputs and counts are written to ``out_dir``. Returns the report dict.
    """
    os.makedirs(out_dir, exist_ok=True)
    verbose = bool(os.environ.get('FARQ_DEDUP_VERBOSE'))
    _t0 = [__import__('time').time()]

    def log(msg):
        if verbose:
            print(f'[dedup +{__import__("time").time() - _t0[0]:6.1f}s] {msg}', file=sys.stderr, flush=True)

    db = duckdb.connect()
    db.execute('SET threads=1')
    db.execute('SET preserve_insertion_order=false')
    tmp = os.path.join(out_dir, 'duckdb_tmp')
    os.makedirs(tmp, exist_ok=True)
    db.execute('SET temp_directory=?', [tmp])

    have = {r[0] for r in db.execute('describe select * from read_parquet(?)', [str(targets)]).fetchall()}
    col = lambda c: f'p.{c}' if c in have else 'null::varchar'
    lat_min, lat_max, lon_min, lon_max = KSA_BBOX

    phone_col = 'phone_norm' if 'phone_norm' in have else ('phone' if 'phone' in have else None)
    msk = 'merged_source_poi_keys' if 'merged_source_poi_keys' in have else None

    # One row per existing entity, with every field the rules and the guard need, pre-normalised.
    db.execute('create table generic(w varchar)')
    db.executemany('insert into generic values (?)', [(w.lower(),) for w in GENERIC_WORDS])

    db.execute(f"""create table ent as
        select p.poi_key,
               {col('farq_atlas_id')} farq_atlas_id,
               {col('city_en')} city_en,
               {col('name_ar')} name_ar, {col('name_en')} name_en,
               p.latitude lat, p.longitude lon,
               {('list_distinct(' + col(msk) + ')') if msk else 'null'} merged_source_poi_keys,
               {_phone_nsn_sql(col(phone_col)) if phone_col else "''"} nsn,
               {_norm_token_sql(col('commercial_license'))} lic,
               {_norm_token_sql(col('source_trade_license')) if 'source_trade_license' in have else 'null'} trade_lic,
               {_norm_token_sql(col('building_no'))} building_no,
               {_norm_token_sql(col('urbi_floor') if 'urbi_floor' in have else col('floor'))} floor_no,
               {('nullif(trim(cast(' + col('google_place_id') + " as varchar)), '')") if 'google_place_id' in have else 'null'} gpid,
               {_sql_norm(col('name_ar'))} ar_key, {_sql_norm(col('name_en'))} en_key
        from read_parquet(?) p
        where p.latitude between {lat_min} and {lat_max} and p.longitude between {lon_min} and {lon_max}
        qualify row_number() over (partition by p.poi_key) = 1""", [str(targets)])
    log('entities loaded')

    # Confident subcategory per entity, from the taxonomy (unc.* / noncom.* are never confident).
    tax_have = {r[0] for r in db.execute('describe select * from read_parquet(?)', [str(taxonomy)]).fetchall()}
    if {'poi_key', 'sub_id'}.issubset(tax_have):
        conf = ("case lower(coalesce(confidence, '')) when 'high' then 3 when 'medium' then 2 "
                "when 'low' then 1 else 0 end") if 'confidence' in tax_have else '2'
        db.execute(f"""create table sub as
            select poi_key, first(sub_id order by {conf} desc, sub_id) confident_sub
            from read_parquet(?)
            where sub_id is not null and trim(sub_id) <> ''
              and sub_id not like 'unc.%' and sub_id not like 'noncom.%'
              and ({conf}) >= 2
            group by poi_key""", [str(taxonomy)])
    else:
        db.execute('create table sub(poi_key varchar, confident_sub varchar)')
    log('confident subs ready')

    # Comparison name (Arabic when present, else English), numbers stripped out, plus the long words
    # used by Rule A's "share a word" test, the branch numbers used by Rule B, and the blocking cell.
    db.execute(f"""create table k as
        select e.*, s.confident_sub,
               case when e.ar_key <> '' then e.ar_key else e.en_key end cmp,
               {_phone_key_sql('e.nsn')} phone_key,
               trim(regexp_replace(regexp_replace(
                   case when e.ar_key <> '' then e.ar_key else e.en_key end, '[0-9]+', ' ', 'g'),
                   '\\s+', ' ', 'g')) nk,
               coalesce(regexp_extract_all(
                   coalesce(e.name_ar, '') || ' ' || coalesce(e.name_en, ''), '[0-9]+')::varchar, '[]') nums,
               floor(e.lat / {GRID_DEG})::bigint gy, floor(e.lon / {GRID_DEG})::bigint gx
        from ent e left join sub s using (poi_key)""")
    db.execute(f"""alter table k add column words4 varchar[]""")
    db.execute(f"""update k set words4 =
        list_filter(string_split(nk, ' '), w -> length(w) >= {word_min})""")
    log('comparison keys + words ready')

    # National name frequency (over the comparison name with numbers stripped), for Rule B's rareness.
    db.execute("create table freq as select nk, count(*) n from k where nk <> '' group by nk")
    # National phone frequency: a number on too many entities is a shared/switchboard line, not an
    # identity anchor, so it is dropped before Rule A exactly as a toll-free number is.
    db.execute(f"""update k set phone_key = null where phone_key in
        (select phone_key from k where phone_key is not null group by phone_key having count(*) > {phone_max})""")

    entities = db.execute('select count(*) from k').fetchone()[0]
    with_phone = db.execute('select count(*) from k where phone_key is not null').fetchone()[0]
    with_sub = db.execute('select count(*) from k where confident_sub is not null').fetchone()[0]
    log(f'freq + phone cap done; entities={entities} phones={with_phone}')

    hav = _haversine_sql()
    # The shared guard, written once and reused by both rules. True => the pair is BLOCKED.
    guard = (
        "(a.lic is not null and b.lic is not null and a.lic <> b.lic) or "
        "(a.trade_lic is not null and b.trade_lic is not null and a.trade_lic <> b.trade_lic) or "
        "(a.building_no is not null and b.building_no is not null and a.building_no <> b.building_no) or "
        "(a.floor_no is not null and b.floor_no is not null and a.floor_no <> b.floor_no) or "
        "(a.confident_sub is not null and b.confident_sub is not null and a.confident_sub <> b.confident_sub) or "
        "(a.gpid is not null and b.gpid is not null and a.gpid <> b.gpid)"
    )

    # ---- Rule A: phone-anchored --------------------------------------------------------------------
    db.execute(f"""create table pairs_a as
        select a.poi_key ka, b.poi_key kb, a.city_en, round({hav}, 1) d,
               a.phone_key, a.nk nk_a, b.nk nk_b,
               (a.nk = '' or b.nk = '' or len(list_intersect(a.words4, b.words4)) > 0) name_ok,
               not ({guard}) guard_ok,
               a.name_ar ar_a, b.name_ar ar_b, a.name_en en_a, b.name_en en_b
        from k a join k b
          on a.phone_key = b.phone_key and a.poi_key < b.poi_key
        where {hav} <= {radius_a_m}""")
    raw_a = db.execute('select count(*) from pairs_a').fetchone()[0]
    name_a = db.execute('select count(*) from pairs_a where name_ok').fetchone()[0]
    edges_a = db.execute('select ka, kb from pairs_a where name_ok and guard_ok').fetchall()
    log(f'rule A pairs={raw_a} edges={len(edges_a)}')

    # ---- Rule B: rare, distinctive name, a few metres apart ----------------------------------------
    # Restrict to rare names BEFORE the self-join: a common name would explode the join, and it is
    # excluded by the rareness rule anyway. This keeps the join small and the semantics identical.
    db.execute(f"""create table kb as select k.* from k
        join freq fr on fr.nk = k.nk where k.nk <> '' and fr.n <= {rare_max}""")
    # corroboration and the longest distinctive token are needed for the two precision tiers.
    corrob = ("(a.lic is not null and a.lic = b.lic) or "
              "(a.trade_lic is not null and a.trade_lic = b.trade_lic) or "
              "(a.building_no is not null and a.building_no = b.building_no) or "
              "(a.gpid is not null and a.gpid = b.gpid)")
    maxtok = ("(select max(length(w)) from unnest(string_split(a.nk, ' ')) t(w) "
              "where w not in (select w from generic))")
    db.execute(f"""create table pairs_b as
        select a.poi_key ka, b.poi_key kb, a.city_en, round({hav}, 1) d, a.nk,
               (a.nums = b.nums) numbers_ok,
               exists (select 1 from unnest(string_split(a.nk, ' ')) t(w)
                       where length(w) > 1 and w not in (select w from generic)) distinctive,
               ({corrob}) corroborated, coalesce({maxtok}, 0) maxtok,
               not ({guard}) guard_ok,
               a.name_ar ar_a, b.name_ar ar_b, a.name_en en_a, b.name_en en_b
        from kb a join kb b
          on a.nk = b.nk and a.poi_key < b.poi_key
         and b.gy between a.gy - 1 and a.gy + 1 and b.gx between a.gx - 1 and a.gx + 1
        where a.city_en is not null and a.city_en = b.city_en and {hav} <= {radius_b_m}""")
    # a pair is a Rule B candidate when it clears the base gate AND one of the two precision tiers.
    base_b = 'distinctive and numbers_ok'
    tier_b1 = f'corroborated and d <= {radius_b_m}'                 # identity-corroborated
    tier_b2 = f'd <= {tight_b_m} and maxtok >= {maxtok_min}'        # essentially same point
    tier = f'(({tier_b1}) or ({tier_b2}))'
    raw_b = db.execute(f'select count(*) from pairs_b where {base_b} and {tier}').fetchone()[0]
    b1_pairs = db.execute(f'select count(*) from pairs_b where {base_b} and guard_ok and {tier_b1}').fetchone()[0]
    b2_pairs = db.execute(f'select count(*) from pairs_b where {base_b} and guard_ok and {tier_b2}').fetchone()[0]
    edges_b = db.execute(f'select ka, kb from pairs_b where {base_b} and guard_ok and {tier}').fetchall()
    log(f'rule B pairs={raw_b} edges={len(edges_b)} b1={b1_pairs} b2={b2_pairs}')

    # Guard-blocked counts (pairs that passed every rule condition and a tier but one guard clause fired).
    blocked_a = db.execute('select count(*) from pairs_a where name_ok and not guard_ok').fetchone()[0]
    blocked_b = db.execute(
        f'select count(*) from pairs_b where {base_b} and {tier} and not guard_ok').fetchone()[0]

    # ---- Union by connected components over the surviving edges of BOTH rules ----------------------
    edge_rule = defaultdict(set)
    for ka, kb in edges_a:
        edge_rule[tuple(sorted((ka, kb)))].add('phone_anchored')
    for ka, kb in edges_b:
        edge_rule[tuple(sorted((ka, kb)))].add('rare_name')
    comps = _union_find(edge_rule.keys())
    log(f'components={len(comps)}')

    # Per-component rule set and auto/held split (held = larger than the cap).
    comp_rules = {}
    for root, members in comps.items():
        rules = set()
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                rules |= edge_rule.get(tuple(sorted((members[i], members[j]))), set())
        comp_rules[root] = rules
    auto = {r: m for r, m in comps.items() if len(m) <= cluster_cap}
    held = {r: m for r, m in comps.items() if len(m) > cluster_cap}

    # Field lookups for choosing a master and expanding the reversible crosswalk.
    meta = {r[0]: r for r in db.execute(
        'select poi_key, farq_atlas_id, name_ar, phone_key, lic, merged_source_poi_keys from k').fetchall()}

    def _score(key):
        _, fa, ar, ph, lic, _msk = meta.get(key, (key, None, None, None, None, None))
        return (-(10 if not str(key).startswith('new:') else 0)
                - (5 if ph else 0) - (4 if ar else 0) - (2 if lic else 0), str(key))

    delta_rows, cluster_rows = [], []
    size_counts = Counter()
    for root, members in sorted(auto.items()):
        master = sorted(members, key=_score)[0]
        cid = 'FA-CAND-' + hashlib.sha256(master.encode()).hexdigest()[:16].upper()
        rules = ';'.join(sorted(comp_rules[root]))
        src = set()
        for m in members:
            existing = meta.get(m, (m, None, None, None, None, None))[5]
            if existing:
                src.update(existing)
            else:
                src.add(m)
        master_fa = meta.get(master, (master, None))[1]
        size_counts[len(members)] += 1
        for m in members:
            delta_rows.append((m, master, cid, meta.get(m, (m, None))[1], master_fa, rules, len(members)))
        cluster_rows.append((cid, master, master_fa, len(members), rules,
                             json.dumps(members, ensure_ascii=False),
                             json.dumps(sorted(src), ensure_ascii=False)))

    held_rows = []
    for root, members in sorted(held.items()):
        cid = 'FA-HOLD-' + hashlib.sha256(members[0].encode()).hexdigest()[:16].upper()
        held_rows.append((cid, len(members), ';'.join(sorted(comp_rules[root])),
                          json.dumps(members, ensure_ascii=False)))

    # ---- Write the delta, clusters, held set, edge evidence and samples ----------------------------
    def _csv(path, header, rows):
        with open(path, 'w', encoding='utf-8', newline='') as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(rows)

    _csv(os.path.join(out_dir, 'candidate_merge_delta.csv'),
         ['source_poi_key', 'canonical_poi_key', 'candidate_cluster_id', 'existing_farq_atlas_id',
          'master_farq_atlas_id', 'rules', 'cluster_size'], delta_rows)
    _csv(os.path.join(out_dir, 'candidate_clusters.csv'),
         ['candidate_cluster_id', 'canonical_poi_key', 'master_farq_atlas_id', 'cluster_size', 'rules',
          'member_poi_keys', 'candidate_merged_source_poi_keys'], cluster_rows)
    _csv(os.path.join(out_dir, 'held_for_review.csv'),
         ['candidate_cluster_id', 'cluster_size', 'rules', 'member_poi_keys'], held_rows)

    if delta_rows:
        db.execute("create table delta(source_poi_key varchar, canonical_poi_key varchar, "
                   "candidate_cluster_id varchar, existing_farq_atlas_id varchar, "
                   "master_farq_atlas_id varchar, rules varchar, cluster_size integer)")
        db.executemany('insert into delta values (?,?,?,?,?,?,?)', delta_rows)
        db.execute(f"copy delta to '{os.path.join(out_dir, 'candidate_merge_delta.parquet')}' (format parquet)")

    # Evidence samples: 100 clusters per rule for a human check, member names + distances + evidence.
    auto_keys = {k for m in auto.values() for k in m}
    db.execute("create table amap(poi_key varchar, cid varchar, master varchar)")
    amap = []
    for root, members in auto.items():
        master = sorted(members, key=_score)[0]
        cid = 'FA-CAND-' + hashlib.sha256(master.encode()).hexdigest()[:16].upper()
        for m in members:
            amap.append((m, cid, master))
    if amap:
        db.executemany('insert into amap values (?,?,?)', amap)

    def _sample(rule, pairs_table, cond):
        # clusters that carry at least one surviving edge of this rule
        cids = sorted({'FA-CAND-' + hashlib.sha256(sorted(m, key=_score)[0].encode()).hexdigest()[:16].upper()
                       for root, m in auto.items() if rule in comp_rules[root]})
        path = os.path.join(out_dir, f'sample_{rule}.csv')
        if not cids:
            _csv(path, ['candidate_cluster_id', 'city_en', 'distance_m', 'name_ar_a', 'name_ar_b',
                        'name_en_a', 'name_en_b', 'label'], [])
            return 0
        db.execute("create or replace temp table _cids(cid varchar)")
        db.executemany('insert into _cids values (?)', [(c,) for c in cids])
        db.execute(f"""copy (
            with sampled as (select cid from _cids using sample 100 rows (reservoir, 7))
            select am.cid candidate_cluster_id, pr.city_en, pr.d distance_m,
                   pr.ar_a name_ar_a, pr.ar_b name_ar_b, pr.en_a name_en_a, pr.en_b name_en_b, '' as "label"
            from {pairs_table} pr join amap am on am.poi_key = pr.ka
            where am.cid in (select cid from sampled) and ({cond})
            order by am.cid, pr.d
        ) to '{path}' (header)""")
        return len(cids)

    clusters_a = _sample('phone_anchored', 'pairs_a', 'pr.name_ok and pr.guard_ok')
    clusters_b = _sample('rare_name', 'pairs_b',
                         f'pr.{base_b.replace(" and ", " and pr.")} and pr.guard_ok and '
                         f'((pr.corroborated and pr.d <= {radius_b_m}) or (pr.d <= {tight_b_m} and pr.maxtok >= {maxtok_min}))')

    excess = sum(len(m) - 1 for m in auto.values())
    report = {
        'version': VERSION,
        'inputs': {'targets': str(targets), 'taxonomy': str(taxonomy),
                   'phone_column': phone_col, 'merged_source_keys_column': msk},
        'params': {'radius_a_m': radius_a_m, 'radius_b_m': radius_b_m, 'tight_b_m': tight_b_m,
                   'maxtok_min': maxtok_min, 'rare_max': rare_max, 'word_min': word_min,
                   'cluster_cap': cluster_cap, 'phone_max': phone_max, 'grid_deg': GRID_DEG},
        'entities': entities, 'entities_with_anchor_phone': with_phone,
        'entities_with_confident_sub': with_sub,
        'rule_a_phone_anchored': {
            'raw_pairs_same_phone_within_radius': raw_a,
            'pairs_after_name_compat': name_a,
            'surviving_edges': len(edges_a),
            'guard_blocked_pairs': blocked_a,
            'clusters_with_this_rule': clusters_a},
        'rule_b_rare_name': {
            'candidate_pairs_after_tiers': raw_b,
            'b1_identity_corroborated_pairs': b1_pairs,
            'b2_same_point_pairs': b2_pairs,
            'surviving_edges': len(edges_b),
            'guard_blocked_pairs': blocked_b,
            'clusters_with_this_rule': clusters_b},
        'combined_auto_merge': {
            'clusters': len(auto),
            'entities_merged': sum(len(m) for m in auto.values()),
            'safe_additional_merges_excess_rows': excess,
            'cluster_size_distribution': {str(k): v for k, v in sorted(size_counts.items())}},
        'held_for_review_over_cap': {
            'clusters': len(held),
            'entities': sum(len(m) for m in held.values())},
        'guard_blocked_total': blocked_a + blocked_b,
        'note': ('Precision needs human labels on sample_phone_anchored.csv and sample_rare_name.csv '
                 '(empty label column). Nothing here is applied: the parent decides.'),
    }
    db.close()
    with open(os.path.join(out_dir, 'dedup_candidates.report.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    return report


def _main(argv):
    if len(argv) < 4:
        print('usage: python3 dedup_candidates.py TARGETS.parquet POI_TAXONOMY.parquet OUT_DIR', file=sys.stderr)
        return 2
    report = build(argv[1], argv[2], argv[3])
    print(json.dumps(report, ensure_ascii=False, indent=1), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(_main(sys.argv))
