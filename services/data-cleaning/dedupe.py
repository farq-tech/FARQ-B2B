"""Duplicate groups across sources. Read-only on the directory; writes poi_key -> group_id, is_primary, reason, plus a merged
best-of-group contact view. Nothing is deleted: every row keeps its key and points to its group.
Two rows join a group when either:
  - same normalised name (>= 4 chars) within 150 m, or
  - same phone number and names sharing a word, within 1 km.
The primary row of a group is the one with the most data (phone, WhatsApp, website, e-mail, category, more sources)."""
import duckdb, sys
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
D = '/Users/m4pro/farq-taxonomy-data/'
db = duckdb.connect(); db.execute("SET threads=6"); db.execute("SET memory_limit='8GB'")
nm = "regexp_replace(translate(lower(coalesce(nullif(name_ar,''),name_en,'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
db.execute(f"""create table t as select row_number() over () rid, poi_key, {nm} k, latitude lat, longitude lon, nullif(trim(phone_norm),'') phone,
  has_whatsapp, nullif(trim(website),'') web, nullif(trim(email),'') email, nullif(trim(category),'') cat, len(sources) nsrc,
  (case when nullif(trim(phone_norm),'') is not null then 4 else 0 end + case when has_whatsapp then 3 else 0 end + case when nullif(trim(website),'') is not null then 2 else 0 end
   + case when nullif(trim(email),'') is not null then 2 else 0 end + case when nullif(trim(category),'') is not null then 2 else 0 end + coalesce(len(sources),0)) score
  from read_parquet('{P}') where latitude is not null and longitude is not null""")
db.execute("create table freq as select k, count(*) n from t group by k")
db.execute("""create table edges as
  select a.rid a, b.rid b, 'same_name_150m' reason from t a join t b on a.k=b.k and a.rid<b.rid and length(a.k)>=4
    and abs(a.lat-b.lat)<0.00135 and abs(a.lon-b.lon)<0.0015 and a.k in (select k from freq where n<=20)
  union all
  select a.rid, b.rid, 'same_phone_1km' from t a join t b on a.phone=b.phone and a.rid<b.rid and a.phone is not null
    and abs(a.lat-b.lat)<0.009 and abs(a.lon-b.lon)<0.01 and a.k<>b.k
    and (strpos(a.k, left(b.k, 4))>0 or strpos(b.k, left(a.k, 4))>0)""")
print('edges:', db.execute("select reason, count(*) from edges group by 1").fetchall())
# connected components (union-find)
edges = db.execute("select a, b from edges").fetchall()
parent = {}
def find(x):
    root = x
    while parent.get(root, root) != root: root = parent[root]
    while parent.get(x, x) != root: parent[x], x = root, parent[x]
    return root
for a, b in edges:
    ra, rb = find(a), find(b)
    if ra != rb: parent[max(ra, rb)] = min(ra, rb)
db.execute("create table lab (rid bigint, g bigint)")
db.executemany("insert into lab values (?, ?)", [(r, find(r)) for r in parent])
db.execute("insert into lab select rid, rid from t where rid not in (select rid from lab)")
db.execute("""create table grp as select t.poi_key, l.g, t.score, t.rid,
   row_number() over (partition by l.g order by t.score desc, t.rid) = 1 is_primary, count(*) over (partition by l.g) size from t join lab l using(rid)""")
db.execute(f"""copy (select poi_key, 'g' || g group_id, is_primary, size from grp) to '{D}poi_groups.parquet' (format parquet)""")
# best-of-group contacts: fill a member's missing phone/web/email from its group (each filled value keeps its source row)
db.execute("""create table best as select g2.g,
   arg_max(t2.phone, t2.score + case when t2.has_whatsapp then 100 else 0 end) filter (where t2.phone is not null) phone,
   bool_or(t2.has_whatsapp) filter (where t2.phone is not null) any_wa,
   arg_max(t2.web, t2.score) filter (where t2.web is not null) web, arg_max(t2.email, t2.score) filter (where t2.email is not null) email
   from grp g2 join t t2 using(rid) where g2.size>1 group by g2.g""")
db.execute(f"""copy (select g.poi_key, 'g'||g.g group_id, coalesce(t.phone, b.phone) phone, coalesce(t.web, b.web) website, coalesce(t.email, b.email) email,
   (t.phone is null and b.phone is not null) phone_from_group from grp g join t using(rid) join best b on b.g=g.g where g.size>1) to '{D}group_contacts.parquet' (format parquet)""")
print(db.execute("select count(*) as n_rows, count(distinct g) as n_groups, count(*) filter (where size>1) as in_dup, count(distinct g) filter (where size>1) as dup_groups, max(size) as biggest from grp").fetchone())
print('phones gained from group:', db.execute(f"select count(*) from read_parquet('{D}group_contacts.parquet') where phone_from_group").fetchone()[0])
print('size dist:', db.execute("select least(size,10) s, count(distinct g) from grp where size>1 group by 1 order by 1").fetchall())
