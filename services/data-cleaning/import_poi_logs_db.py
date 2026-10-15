"""HudHud poi_logs from the «Data Collection» shared drive (logs/hudhud.db, SQLite, 371,426 logs, 2024-10-09 → 2025-09-04),
read with sqlite3 in immutable (read-only) mode. The POI id is `cr_id` (= transaction_id). For every POI keep the LATEST approved log:
operation, date, editor, duplicate_of_id. A latest approved delete marks the POI deleted in the golden set; it is never removed.
Usage: python3 import_poi_logs_db.py /path/to/hudhud_logs.db
Output: /Users/m4pro/farq-taxonomy-data/enrich/hudhud_poi_logs_db.parquet"""
import duckdb, subprocess, sys, tempfile, os
F = sys.argv[1]
O = '/Users/m4pro/farq-taxonomy-data/enrich/'
tmp = os.path.join(tempfile.mkdtemp(), 'logs.csv')
with open(tmp, 'w') as fh:
    subprocess.run(['sqlite3', '-csv', '-header', f'file:{F}?immutable=1',
        "select cr_id trx_id, operation, created_at, created_by, id, json_extract(raw_json,'$.duplicate_of_id') dup_of "
        "from poi_logs where status='approved' and entity_type='poi'"], stdout=fh, check=True)
db = duckdb.connect()
db.execute(f"""copy (select 'hh:' || trx_id poi_key, operation last_operation, operation='delete' deleted, created_at last_log_at, created_by editor,
   nullif(dup_of,'') duplicate_of_id from read_csv('{tmp}', all_varchar=true)
   qualify row_number() over (partition by trx_id order by created_at desc, id::bigint desc)=1) to '{O}hudhud_poi_logs_db.parquet' (format parquet)""")
print(db.execute(f"select count(*), count(*) filter (where deleted), max(last_log_at) from read_parquet('{O}hudhud_poi_logs_db.parquet')").fetchone())
