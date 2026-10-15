"""Fill a missing Arabic or English name from another source of the SAME business (no translation, no guessing).
Evidence, in order: the entity lake's own source rows for the matched entity (atlas, golden, Urbi brand, firms, TRX …), the
directory row's duplicate-group members, and the Google-batch reviewed names. A name counts as Arabic only if it has Arabic letters,
as English only if it has Latin letters and no Arabic letters.
Output: /Users/m4pro/farq-taxonomy-data/golden/name_fill.parquet (poi_key, name_ar, name_ar_source, name_en, name_en_source). Read-only."""
import duckdb
D = '/Users/m4pro/farq-taxonomy-data/'
LS = '/Users/m4pro/ksa-entity-lake/master/entity_sources.parquet'
LM = '/Users/m4pro/ksa-entity-lake/master/entities_master.parquet'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='14GB'")
AR = "regexp_matches(coalesce({c},''),'[؀-ۿ]')"
EN = "(regexp_matches(coalesce({c},''),'[A-Za-z]{{3}}') and not regexp_matches(coalesce({c},''),'[؀-ۿ]'))"
db.execute(f"create table g as select poi_key, origin, name_ar, name_en, dup_group from read_parquet('{D}golden/golden_set.parquet')")
# poi_key -> lake entity: directory rows via lake_match, new rows via their 'lake:' source keys
db.execute(f"""create table k2e as select poi_key, entity_id from read_parquet('{D}lake/lake_match.parquet')
  union all select poi_key, replace(k, 'lake:', '') from (select poi_key, unnest(source_keys) k from read_parquet('{D}golden/new_entities.parquet')) where k like 'lake:%'""")
# every name the lake saw for an entity, from every source row, plus the master's ar/en fields
db.execute(f"""create table en_names as select entity_id, name from read_parquet('{LS}') where name is not null
  union all select entity_id, name_ar from read_parquet('{LM}') where nullif(name_ar,'') is not null
  union all select entity_id, name_en from read_parquet('{LM}') where nullif(name_en,'') is not null""")
db.execute(f"""create table lake_ar as select k.poi_key, mode(n.name) as nm from k2e k join en_names n using(entity_id) where {AR.format(c='n.name')} group by 1""")
db.execute(f"""create table lake_en as select k.poi_key, mode(n.name) as nm from k2e k join en_names n using(entity_id) where {EN.format(c='n.name')} group by 1""")
# duplicate-group members (same business, other source rows of the directory)
db.execute(f"""create table grp_ar as select a.poi_key, mode(b.name_ar) as nm from g a join g b on a.dup_group=b.dup_group and a.poi_key<>b.poi_key
   where a.dup_group is not null and {AR.format(c='b.name_ar')} group by 1""")
db.execute(f"""create table grp_en as select a.poi_key, mode(b.name_en) as nm from g a join g b on a.dup_group=b.dup_group and a.poi_key<>b.poi_key
   where a.dup_group is not null and {EN.format(c='b.name_en')} group by 1""")
db.execute(f"""create table gb as select poi_key, any_value(name_ar_reviewed) filter (where {AR.format(c='name_ar_reviewed')}) ar,
   any_value(name_en_reviewed) filter (where {EN.format(c='name_en_reviewed')}) en from read_parquet('{D}enrich/google_batches.parquet')
   where poi_key is not null and verdict like 'good%' group by 1""")
db.execute(f"""copy (select g.poi_key,
   case when {AR.format(c='g.name_ar')} then g.name_ar when {AR.format(c='g.name_en')} then g.name_en else coalesce(la.nm, ga.nm, gb.ar) end name_ar,
   case when {AR.format(c='g.name_ar')} or {AR.format(c='g.name_en')} then 'source' when la.nm is not null then 'lake_other_source'
        when ga.nm is not null then 'duplicate_group' when gb.ar is not null then 'google_batch_reviewed' end name_ar_source,
   case when {EN.format(c='g.name_en')} then g.name_en when {EN.format(c='g.name_ar')} then g.name_ar else coalesce(le.nm, ge.nm, gb.en) end name_en,
   case when {EN.format(c='g.name_en')} or {EN.format(c='g.name_ar')} then 'source' when le.nm is not null then 'lake_other_source'
        when ge.nm is not null then 'duplicate_group' when gb.en is not null then 'google_batch_reviewed' end name_en_source
   from g left join lake_ar la using(poi_key) left join lake_en le using(poi_key) left join grp_ar ga using(poi_key) left join grp_en ge using(poi_key)
   left join gb using(poi_key)) to '{D}golden/name_fill.parquet' (format parquet)""")
print(db.execute(f"""select count(*) filter (where name_ar is null), count(*) filter (where name_ar_source not in ('source')),
   count(*) filter (where name_en is null), count(*) filter (where name_en_source not in ('source')) from read_parquet('{D}golden/name_fill.parquet')
   where poi_key in (select poi_key from read_parquet('{D}golden/golden_set.parquet') where in_golden)""").fetchone())
print(db.execute(f"select name_ar_source, count(*) from read_parquet('{D}golden/name_fill.parquet') group by 1").fetchall())
