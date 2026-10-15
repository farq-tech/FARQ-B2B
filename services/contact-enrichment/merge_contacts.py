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
lake = '/Users/m4pro/farq-taxonomy-data/lake/lake_match.parquet'
if os.path.exists(lake):   # the local KSA entity lake (atlas, golden, Urbi brand, ThreeCities, registry …) matched by phone/name/id
    parts.append(f"""select m.poi_key, '+966' || right(regexp_replace(coalesce(nullif(e.mobile,''), e.phone),'[^0-9]','','g'),9) phone,
        case when regexp_matches(regexp_replace(coalesce(nullif(e.mobile,''), e.phone),'[^0-9]','','g'), '(966|0)?5[0-9]{{8}}$') then 'mobile' else 'landline' end phone_kind,
        false has_whatsapp, 'entity_lake:' || array_to_string(e.sources, '+') phone_source, 'مصدر بيانات داخلي (بحيرة الجهات)' phone_source_name, null source_page,
        current_date found_on, case when nullif(e.mobile,'') is not null then 1.5 else 3.5 end rank
        from read_parquet('{lake}') m join read_parquet('/Users/m4pro/ksa-entity-lake/master/entities_master.parquet') e using(entity_id)
        where coalesce(nullif(e.mobile,''), nullif(e.phone,'')) is not null
          and length(regexp_replace(coalesce(nullif(e.mobile,''), e.phone),'[^0-9]','','g')) >= 9""")
for attrs in ('cleaned_data', 'western_cleaning'):   # Urbi-schema files matched to the directory (phone or name within 150 m)
    f = f'/Users/m4pro/farq-taxonomy-data/enrich/{attrs}_attrs.parquet'
    if os.path.exists(f):
        parts.append(f"""select poi_key, '+966' || right(regexp_replace(phone,'[^0-9]','','g'),9) phone,
            case when regexp_matches(regexp_replace(phone,'[^0-9]','','g'),'(966|0)?5[0-9]{{8}}$') then 'mobile' else 'landline' end phone_kind, false has_whatsapp,
            '{attrs}' phone_source, 'ملف بيانات Urbi المنقّح' phone_source_name, null source_page, current_date found_on, 1.3 rank
            from read_parquet('{f}') where length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))>=9""")
gb = '/Users/m4pro/farq-taxonomy-data/enrich/google_batches.parquet'
if os.path.exists(gb):   # HudHud Google-scrape batches (2025), matched by TRX id or phone
    parts.append(f"""select poi_key, '+966' || right(regexp_replace(phone_number,'[^0-9]','','g'),9) phone,
        case when regexp_matches(regexp_replace(phone_number,'[^0-9]','','g'),'(966|0)?5[0-9]{{8}}$') then 'mobile' else 'landline' end phone_kind, false has_whatsapp,
        'google_batch:' || batch phone_source, 'دفعات Google المراجعة (هدهد)' phone_source_name, null source_page, current_date found_on, 1.2 rank
        from read_parquet('{gb}') where poi_key is not null and length(regexp_replace(coalesce(phone_number,''),'[^0-9]','','g'))>=9""")
cand = '/Users/m4pro/farq-taxonomy-data/candidates/cand_phone_fill.parquet'
if os.path.exists(cand):   # master_poi_candidates (Drive): ready_pois_enriched / final_poi_predictions phones
    parts.append(f"""select poi_key, phone, case when regexp_matches(phone,'^\\+9665') then 'mobile' else 'landline' end phone_kind, false has_whatsapp,
        'poi_candidates:' || source_name phone_source, 'ملف نقاط الاهتمام المرشحة' phone_source_name, null source_page, current_date found_on, 2.6 rank
        from read_parquet('{cand}')""")
if not parts: sys.exit('no enrichment files yet')
db.execute("create table allp as " + " union all ".join(parts))
db.execute(f"""copy (select * exclude (rank, rn) from (select *, row_number() over (partition by poi_key order by rank, phone) rn from allp) where rn=1)
    to '{OUT}' (format parquet)""")
print(db.execute(f"select phone_source, phone_kind, count(*) from read_parquet('{OUT}') group by all order by 1,2").fetchall())
print('businesses with a new number:', db.execute(f"select count(*) from read_parquet('{OUT}')").fetchone()[0], '| website file included:', bool(web))
