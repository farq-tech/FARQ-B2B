"""One best extra number per business, from the free enrichment outputs. Read-only on the directory.
Priority: a WhatsApp mobile from a duplicate row > a mobile from the business's website (WhatsApp link first) > a website landline or unified number.
A website number that appears on more than 3 different businesses is treated as shared (an agency or a group switchboard) and dropped.
Usage: python3 merge_contacts.py [OUT]"""
import os, sys
import duckdb

D = '/Users/m4pro/farq-taxonomy-data/contacts/'
OUT = sys.argv[1] if len(sys.argv) > 1 else D + 'contacts_overlay.parquet'
db = duckdb.connect()
parts = []
if os.path.exists(D + 'twin_phones.parquet'):
    parts.append(f"""select poi_key, phone, case when regexp_matches(phone,'^\\+?9665') then 'mobile' else 'landline' end phone_kind, has_whatsapp,
        'directory_twin' phone_source, 'نسخة أخرى للجهة نفسها في الدليل' phone_source_name, null source_page, found_on,
        case when has_whatsapp then 1 else 3 end rank from read_parquet('{D}twin_phones.parquet')""")
web = D + 'website_phones_full.parquet' if os.path.exists(D + 'website_phones_full.parquet') else None
if web:
    parts.append(f"""select poi_key, phone, phone_kind, found_by='whatsapp_link' has_whatsapp, 'business_website' phone_source, 'موقع الجهة الإلكتروني' phone_source_name,
        source_page, found_on, case when phone_kind='mobile' and found_by='whatsapp_link' then 2 when phone_kind='mobile' then 2.5 else 4 end rank
        from read_parquet('{web}') where phone is not null
          and phone not in (select phone from read_parquet('{web}') where phone is not null group by phone having count(distinct poi_key) > 3)""")
if not parts: sys.exit('no enrichment files yet')
db.execute("create table allp as " + " union all ".join(parts))
db.execute(f"""copy (select * exclude (rank, rn) from (select *, row_number() over (partition by poi_key order by rank, phone) rn from allp) where rn=1)
    to '{OUT}' (format parquet)""")
print(db.execute(f"select phone_source, phone_kind, count(*) from read_parquet('{OUT}') group by all order by 1,2").fetchall())
print('businesses with a new number:', db.execute(f"select count(*) from read_parquet('{OUT}')").fetchone()[0], '| website file included:', bool(web))
