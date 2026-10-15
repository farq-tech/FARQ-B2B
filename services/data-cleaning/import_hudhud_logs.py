"""HudHud surveyor activity (CRs = change requests, TRX = transactions = POIs, logs = each edit), export of 2025-08-28.
Read-only on the directory. For every directory row whose HudHud id appears in the logs, keep the LATEST log:
  operation (create / update / delete), review status, editor, date, and duplicate_of_id when set.
A directory row whose latest approved log is a delete is flagged «deleted in HudHud»; it is never removed.
CR contact fields (phone, website, e-mail, Instagram, licence no., national address) are kept as an extra layer.
Usage: python3 import_hudhud_logs.py CSV_DIR"""
import duckdb, sys
D = sys.argv[1]
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
O = '/Users/m4pro/farq-taxonomy-data/enrich/'
db = duckdb.connect()
db.execute(f"create table l as select * from read_csv('{D}/crs_and_logs_linked_20250828_172259__All_POI_Logs.csv', all_varchar=true, header=true, ignore_errors=true)")
db.execute(f"create table t as select poi_key, split_part(poi_key,':',2) native from read_parquet('{P}') where poi_key like 'hh:%'")
db.execute(f"""copy (select t.poi_key, x.* from (
    select split_part(transaction_id,'.',1) native, arg_max(operation, created_at) last_operation, arg_max(review_status, created_at) last_review_status,
      max(created_at) last_log_at, arg_max(created_by, created_at) last_editor, count(*) n_logs,
      max(split_part(duplicate_of_id,'.',1)) filter (where nullif(trim(duplicate_of_id),'') is not null) duplicate_of,
      bool_or(operation='delete' and review_status='approved') ever_deleted
    from l group by 1) x join t using(native)) to '{O}hudhud_logs_status.parquet' (format parquet)""")
s = db.execute(f"""select count(*), count(*) filter (where last_operation='delete' and last_review_status='approved'),
   count(*) filter (where last_operation='delete' and last_review_status in ('under_review','draft')), count(duplicate_of)
   from read_parquet('{O}hudhud_logs_status.parquet')""").fetchone()
print('directory rows with HudHud logs:', s[0], '| latest = approved delete:', s[1], '| delete pending:', s[2], '| duplicate_of:', s[3])
db.execute(f"create table c as select * from read_csv('{D}/all_crs_20250828_164725.csv', all_varchar=true, header=true, ignore_errors=true)")
db.execute(f"""copy (select t.poi_key, c.status cr_status, c.operation cr_operation, c.updated_at cr_updated_at,
   nullif(c.last_log_phone_number,'') phone, nullif(c.last_log_website,'') website, nullif(c.last_log_email,'') email, nullif(c.last_log_instagram,'') instagram,
   nullif(c.last_log_licenseno,'') license_no, nullif(c.last_log_national_address,'') national_address
   from c join t on t.native=split_part(c.entity_id,'.',1)) to '{O}hudhud_cr_contacts.parquet' (format parquet)""")
print('CR rows matched:', db.execute(f"select count(*), count(phone), count(license_no) from read_parquet('{O}hudhud_cr_contacts.parquet')").fetchone())
