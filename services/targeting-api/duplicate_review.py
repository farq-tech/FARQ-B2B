"""Duplicate-candidate review for class C (owner rules, 2026-11-02): same distinctive name, close by, no shared evidence.

Class C is a pair of directory records with the same name and no phone, licence or Google place id in common. This
step rebuilds the class on the published release (docs/production-first.md), applies the owner's corrective rules,
and grades what remains. It never merges, deletes or edits a record; every pair and the reason for its grade go to an
audit file, so any rule can be re-read and reversed.

Rules, each counted on its own and in sequence:
- distance ≤ 25 m (was 50 m);
- the name is rare: at most 50 records carry it;
- the name is distinctive: not only activity or generic words («مطعم», «صيدلية», «الاتصالات», «المركز», «Barbershop»);
- branch, unit or warehouse numbers in the two names are the same;
- the match is on the Arabic names when both have one (English alone does not match two different Arabic names);
- no conflicting evidence: a different phone, licence or Google place id on both sides blocks the pair;
- the brands (when the release carries them) are the same.

Grades of the pairs that pass: C1 ≤ 10 m, C2 10-25 m, C3 the names match only after normalization (ة/ه, alef forms,
diacritics); C4 is every excluded pair. Even C1 is a candidate, not a merge.

Names are compared after normalization (alef forms, ى/ي, ة/ه, diacritics, tatweel, symbols and spaces) and without
their numbers, which are compared on their own (a branch, unit or warehouse number); the original names are kept.
"""
import json
import os

import duckdb

import name_translation

VERSION = 'duplicate_review_c_v1'
BASE_DISTANCE_M, DISTANCE_M, STRONG_M = 50, 25, 10
RARE_MAX = 50
GENERIC_EXTRA = {'الاتصالات', 'اتصالات', 'المركز', 'المؤسسه', 'الشركه', 'المكتب', 'المحل', 'المعرض', 'مؤسسه', 'شركه',
                 'مكتب', 'مركز', 'محل', 'معرض', 'استراحه', 'استراحات', 'ورشه', 'بقاله', 'تموينات', 'مطعم', 'صيدليه',
                 'مسجد', 'جامع', 'مغسله', 'صالون', 'حلاق', 'بوفيه', 'كافيه', 'مقهي', 'مخبز', 'فرع', 'الفرع', 'الرئيسي',
                 'barbershop', 'barber', 'restaurant', 'pharmacy', 'cafe', 'coffee', 'salon', 'grocery', 'mosque', 'shop',
                 'store', 'office', 'center', 'centre', 'company', 'est', 'establishment', 'branch', 'laundry', 'bakery',
                 'supermarket', 'market', 'workshop', 'stc', 'mobily', 'zain'}


def _sql_norm(col):
    """The comparison key of a name in SQL: one alef, ى as ي, ة as ه, no diacritics/tatweel, symbols as spaces."""
    x = f"lower(coalesce({col}, ''))"
    x = f"regexp_replace({x}, '[ً-ٰٟـ]', '', 'g')"
    x = f"translate({x}, 'أإآٱىة', 'ااااي' || 'ه')"
    x = f"regexp_replace({x}, '[^0-9a-zء-ي]+', ' ', 'g')"
    return f"trim(regexp_replace({x}, '\\s+', ' ', 'g'))"


def generic_words():
    words = {name_translation.key(w) for w in name_translation.CORE} | {name_translation.key(w) for w in GENERIC_EXTRA}
    return sorted(words | {w.lower() for w in GENERIC_EXTRA})


def build(targets, out_dir, base_distance_m=BASE_DISTANCE_M):
    """Rebuild class C on the release, apply the rules, grade, and write the audit and samples. Returns counts only."""
    os.makedirs(out_dir, exist_ok=True)
    db = duckdb.connect()
    have = {r[0] for r in db.execute('describe select * from read_parquet(?)', [str(targets)]).fetchall()}
    col = lambda c: f'p.{c}' if c in have else 'null::varchar'
    phone = f"nullif(right(regexp_replace(coalesce(cast({col('phone_norm')} as varchar), ''), '[^0-9]', '', 'g'), 9), '')"
    lic = f"nullif(regexp_replace(coalesce(cast({col('commercial_license')} as varchar), ''), '[^0-9]', '', 'g'), '')"
    gpid = f"nullif(trim(cast({col('google_place_id')} as varchar)), '')"
    brand = f"nullif(trim(cast({col('hh_brand_id') if 'hh_brand_id' in have else col('brand')} as varchar)), '')"
    db.execute('create table generic(w varchar)')
    db.executemany('insert into generic values (?)', [(w,) for w in generic_words()])
    db.execute(f"""create table r as
        select p.poi_key, {col('city_en')} city_en, {col('name_ar')} name_ar, {col('name_en')} name_en,
               p.latitude lat, p.longitude lon, {phone} phone, {lic} lic, {gpid} gpid, {brand} brand,
               {_sql_norm(col('name_ar'))} ar_key, {_sql_norm(col('name_en'))} en_key,
               lower(trim(coalesce({col('name_ar')}, ''))) ar_raw
        from read_parquet(?) p
        where p.latitude between 16 and 33 and p.longitude between 34 and 56
        qualify row_number() over (partition by p.poi_key) = 1""", [str(targets)])
    # the comparison name: Arabic when there is one, else English
    db.execute("""create table k as select *, case when ar_key <> '' then 'ar' else 'en' end lang,
                  trim(regexp_replace(regexp_replace(case when ar_key <> '' then ar_key else en_key end, '[0-9]+', ' ', 'g'), '\s+', ' ', 'g')) nk,
                  floor(lat / 0.0005)::bigint gy, floor(lon / 0.0005)::bigint gx from r where coalesce(ar_key, en_key, '') <> ''""")
    db.execute("delete from k where nk = ''")
    db.execute("create table freq as select nk, count(*) n from k group by nk")
    # class C as first built: same comparison name, within the base distance, no shared phone/licence/place id
    db.execute(f"""create table pairs as
        with c as (select a.poi_key ka, b.poi_key kb, a.nk, a.lang la, b.lang lb, a.city_en,
                          a.name_ar ar_a, b.name_ar ar_b, a.name_en en_a, b.name_en en_b, a.ar_key ark_a, b.ar_key ark_b,
                          a.ar_raw raw_a, b.ar_raw raw_b, a.phone pa, b.phone pb, a.lic la_, b.lic lb_, a.gpid ga, b.gpid gb,
                          a.brand ba, b.brand bb,
                          2 * 6371000 * asin(sqrt(pow(sin(radians(b.lat - a.lat) / 2), 2) +
                              cos(radians(a.lat)) * cos(radians(b.lat)) * pow(sin(radians(b.lon - a.lon) / 2), 2))) d
                   from k a join k b on a.nk = b.nk and a.poi_key < b.poi_key
                        and b.gy between a.gy - 1 and a.gy + 1 and b.gx between a.gx - 1 and a.gx + 1)
        select c.*, f.n name_rows from c join freq f using (nk)
        where d <= {base_distance_m}
          and not (pa is not null and pa = pb) and not (la_ is not null and la_ = lb_) and not (ga is not null and ga = gb)""")
    db.execute("""create table graded as select *,
        d <= 25 r_distance,
        name_rows <= 50 r_rare,
        exists (select 1 from unnest(string_split(nk, ' ')) t(w) where w not in (select w from generic) and length(w) > 1) r_distinctive,
        coalesce(regexp_extract_all(coalesce(ar_a, '') || ' ' || coalesce(en_a, ''), '[0-9]+')::varchar, '[]')
          = coalesce(regexp_extract_all(coalesce(ar_b, '') || ' ' || coalesce(en_b, ''), '[0-9]+')::varchar, '[]') r_numbers,
        la = lb and not (coalesce(ark_a, '') <> '' and coalesce(ark_b, '') <> '' and ark_a <> ark_b) r_arabic,
        not ((pa is not null and pb is not null and pa <> pb) or (la_ is not null and lb_ is not null and la_ <> lb_)
             or (ga is not null and gb is not null and ga <> gb)) r_no_conflict,
        not (ba is not null and bb is not null and ba <> bb) r_brand,
        raw_a <> raw_b r_spelling
        from pairs""")
    rules = ['r_distance', 'r_rare', 'r_distinctive', 'r_numbers', 'r_arabic', 'r_no_conflict', 'r_brand']
    passes = ' and '.join(rules)
    db.execute(f"""create table audit as select *,
        case when not ({passes}) then 'C4' when r_spelling then 'C3' when d <= {STRONG_M} then 'C1' else 'C2' end grade,
        concat_ws('|', {', '.join(f"case when not {r} then '{r[2:]}' end" for r in rules)}) excluded_by
        from graded""")
    one = lambda q: db.execute(q).fetchone()[0]
    sequential, where = {}, []
    for r in rules:
        where.append(r)
        sequential[r[2:]] = one(f"select count(*) from audit where {' and '.join(where)}")
    report = {
        'version': VERSION, 'base_pairs': one('select count(*) from audit'),
        'excluded_by_each_rule': {r[2:]: one(f'select count(*) from audit where not {r}') for r in rules},
        'remaining_after_each_rule_in_order': sequential,
        'grades': dict(db.execute('select grade, count(*) from audit group by 1 order by 1').fetchall()),
        'grades_by_city': {c: dict(zip(g, n)) for c, g, n in db.execute(
            "select coalesce(city_en, 'unknown'), list(grade order by grade), list(n order by grade) from "
            "(select city_en, grade, count(*) n from audit group by 1, 2) group by 1 order by sum(n) desc limit 15").fetchall()},
        'note': 'precision and recall need the owner\'s labels on the samples; the samples carry an empty label column',
    }
    audit = os.path.join(out_dir, 'duplicate_review_c_audit.parquet')
    db.execute(f"""copy (select ka, kb, city_en, round(d, 1) distance_m, name_rows, grade, excluded_by, r_spelling spelling_only
                         from audit) to '{audit}' (format parquet)""")
    fields = "grade, excluded_by, city_en, round(d, 1) distance_m, ar_a, ar_b, en_a, en_b, '' as label"
    db.execute(f"""copy (select * from (select 'remaining' as sample_kind, {fields} from audit where grade <> 'C4') using sample 100 rows (reservoir, 7))
                   to '{os.path.join(out_dir, 'sample_remaining.csv')}' (header)""")
    db.execute(f"""copy (select * from (select 'excluded' as sample_kind, {fields} from audit where grade = 'C4') using sample 50 rows (reservoir, 7))
                   to '{os.path.join(out_dir, 'sample_excluded.csv')}' (header)""")
    db.close()
    with open(os.path.join(out_dir, 'duplicate_review_c.report.json'), 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=1)
    return report
