"""Duplicates across the whole golden set (directory + new businesses + every later layer), on top of the per-source dedupe.
Two in-golden rows are the same business when (name links also need non-conflicting other-language names and compatible main
categories):
  - same normalised Arabic or English name (>= 4 chars) within ~150 m; for names common nationally (> 50 rows: chains, generic words,
    district names used as names) only within ~30 m, or
  - same phone within ~200 m.
Groups larger than 10 are chains of weak links or one wrong name stamped on a building: they are kept (all primary) for review.
Placeholder names are already null in the golden set, so they never link rows. Groups via union-find; the primary is the row with the
most filled fields (phone, subcategory, district, both names), then directory over new. Nothing is removed: copies get
exclude_reason = duplicate_copy in the next golden build.
Output: /Users/m4pro/farq-taxonomy-data/golden/golden_dups.parquet (poi_key, gdup_group, gdup_primary, gdup_size)"""
import duckdb
D = '/Users/m4pro/farq-taxonomy-data/golden/'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='16GB'")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
db.execute(f"""create table g as select row_number() over () rid, poi_key, origin, {nm('name_ar')} ka, {nm('name_en')} ke, phone, latitude y, longitude x,
   case when sub_id like 'unc.%' then null else main_id end mn, cast(floor(latitude/0.002) as int) cy, cast(floor(longitude/0.002) as int) cx,
   (phone is not null)::int*4 + (sub_id not like 'unc.%')::int*3 + (district is not null)::int*2 + (name_ar is not null)::int + (name_en is not null)::int
     + (origin='directory')::int sc
   from read_parquet('{D}golden_set.parquet')
   where in_golden or (exclude_reason='duplicate_copy' and dup_primary)""")   # rows excluded only by this step stay candidates on re-runs
db.execute("create table fq as select k, count(*) n from (select ka k from g union all select ke from g) where length(k)>=4 group by 1")
# place names used as business names (address-only rows: «Al Sulaimaniyah», «King Fahd») never link rows
db.execute(f"""create table placenames as select distinct k from (
   select {nm('district_ar')} k from read_parquet('{D}golden_set.parquet') union all select {nm('district_en')} from read_parquet('{D}golden_set.parquet')
   union all select {nm('district')} from read_parquet('{D}golden_set.parquet') union all select {nm('city_ar')} from read_parquet('{D}golden_set.parquet')
   union all select {nm('city_en')} from read_parquet('{D}golden_set.parquet')) where length(k)>=3""")
db.execute("update fq set n = 1000000 where k in (select k from placenames)")
near = "a.cy between b.cy-1 and b.cy+1 and a.cx between b.cx-1 and b.cx+1 and a.rid<b.rid"
edges = []
# strong: both names equal; weak: one name equal and the other missing on one side (rare names only, compatible main category).
# Source rows often carry one wrong Arabic name for a whole building, and shops in a mall are often named after the mall, so a single
# matching name with a conflicting other name never links.
compat = "(a.mn is null or b.mn is null or a.mn=b.mn)"
close = "abs(a.y-b.y)<0.00135 and abs(a.x-b.x)<0.0015"
edges += db.execute(f"""select a.rid, b.rid from g a join g b on {near} and length(a.ka)>=4 and a.ka=b.ka and length(a.ke)>=4 and a.ke=b.ke
   join fq on fq.k=a.ka where {close} and fq.n<1000000 and (fq.n<=50 or (abs(a.y-b.y)<0.00027 and abs(a.x-b.x)<0.0003)) and {compat}""").fetchall()
for col, other in (('ka', 'ke'), ('ke', 'ka')):
    edges += db.execute(f"""select a.rid, b.rid from g a join g b on {near} and length(a.{col})>=4 and a.{col}=b.{col}
       join fq on fq.k=a.{col} where {close} and fq.n<=50 and (length(a.{other})<2 or length(b.{other})<2) and {compat}""").fetchall()
# a shared phone links only same-category neighbours, never unified/toll-free numbers (9200…, 800…) that whole groups share
edges += db.execute(f"""select a.rid, b.rid from g a join g b on a.phone=b.phone and a.rid<b.rid and abs(a.y-b.y)<0.00045 and abs(a.x-b.x)<0.0005
   and a.mn = b.mn and not regexp_matches(a.phone, '^\\+?966?(92|80)')""").fetchall()
parent = {}
def find(x):
    r = x
    while parent.get(r, r) != r: r = parent[r]
    while parent.get(x, x) != r: parent[x], x = r, parent[x]
    return r
for a, b in edges:
    ra, rb = find(a), find(b)
    if ra != rb: parent[max(ra, rb)] = min(ra, rb)
db.execute("create table grp (rid bigint, grp bigint)")
nodes = {x for e in edges for x in e}
db.executemany("insert into grp values (?,?)", [(r, find(r)) for r in nodes])
db.execute(f"""copy (select g.poi_key, grp.grp gdup_group, (row_number() over (partition by grp.grp order by g.sc desc, g.poi_key)=1 or count(*) over (partition by grp.grp) > 10) gdup_primary,
   count(*) over (partition by grp.grp) gdup_size from g join grp using(rid)) to '{D}golden_dups.parquet' (format parquet)""")
print('edges:', len(edges), '| rows in groups / groups / copies:', db.execute(f"""select count(*), count(distinct gdup_group), count(*) filter (where not gdup_primary)
   from read_parquet('{D}golden_dups.parquet')""").fetchone())
print('group sizes:', db.execute(f"""select case when gdup_size=2 then '2' when gdup_size<=5 then '3-5' when gdup_size<=20 then '6-20' else '>20' end, count(distinct gdup_group)
   from read_parquet('{D}golden_dups.parquet') group by 1 order by 1""").fetchall())
