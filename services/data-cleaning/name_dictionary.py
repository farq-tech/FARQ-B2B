"""Arabic <-> English name pairs from HudHud («ALL_translated_poi_names_20250816_233419.csv», 118,890 rows; copy on /Volumes/Archive/Names).
Only `arabic_name` + `original_english` are used (the `translated_english` column is a word-by-word machine output and is ignored).
A missing Arabic name is filled from a row's exact English name, and vice versa, only when the name maps to ONE counterpart in the
file and is not a common name (used by > 5 golden rows). Read-only.
Usage: python3 name_dictionary.py FILE
Output: /Users/m4pro/farq-taxonomy-data/golden/name_dictionary.parquet (poi_key, dict_name_ar, dict_name_en)"""
import sys, duckdb
F = sys.argv[1]
D = '/Users/m4pro/farq-taxonomy-data/golden/'
db = duckdb.connect()
n = lambda c: f"lower(trim(regexp_replace({c}, '[\\s‎‏‪-‮]+', ' ', 'g')))"
db.execute(f"create table t as select trim(arabic_name) ar, trim(original_english) en from read_csv('{F}', all_varchar=true) where nullif(trim(arabic_name),'') is not null and nullif(trim(original_english),'') is not null")
db.execute(f"create table e2a as select {n('en')} k, any_value(ar) ar from t group by 1 having count(distinct ar)=1")
db.execute(f"create table a2e as select {n('ar')} k, any_value(en) en from t group by 1 having count(distinct en)=1")
db.execute(f"create table g as select poi_key, name_ar, name_en, {n('name_ar')} ka, {n('name_en')} ke from read_parquet('{D}golden_set.parquet') where coalesce(name_ar, name_en) is not null")
db.execute("create table fe as select ke k from g where ke<>'' group by 1 having count(*)>5 union select ka from g where ka<>'' group by 1 having count(*)>5")
db.execute(f"""copy (select g.poi_key, case when g.name_ar is null then e2a.ar end dict_name_ar, case when g.name_en is null then a2e.en end dict_name_en
   from (select g.*, g.ke in (select k from fe) common_en, g.ka in (select k from fe) common_ar from g) g
   left join e2a on e2a.k=g.ke and not g.common_en left join a2e on a2e.k=g.ka and not g.common_ar
   where (g.name_ar is null and e2a.ar is not null) or (g.name_en is null and a2e.en is not null)) to '{D}name_dictionary.parquet' (format parquet)""")
print(db.execute(f"select count(dict_name_ar), count(dict_name_en) from read_parquet('{D}name_dictionary.parquet')").fetchone())
