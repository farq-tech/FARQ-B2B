"""Idempotent local derivative. Source databases attached/read mode=ro only."""
import argparse,csv,hashlib,json,re,sqlite3,sys
from collections import defaultdict,Counter
from pathlib import Path
from identity import stable_id,normalize,domain,observation_id,reconcile

def build(registry,output,pages,catalog,prior):
    if Path(output).resolve() in {Path(p).resolve() for p in [registry,pages,catalog,prior]}:raise ValueError('OUTPUT_MUST_NOT_REPLACE_SOURCE')
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    temp=output.with_suffix('.building.db')
    if temp.exists():temp.unlink() # Own incomplete derivative only.
    db=sqlite3.connect(temp);db.executescript(Path(__file__).with_name('schema.sql').read_text())
    db.execute('PRAGMA journal_mode=MEMORY');db.execute('PRAGMA synchronous=OFF')
    src=sqlite3.connect(Path(registry).as_uri()+'?mode=ro',uri=True);src.row_factory=sqlite3.Row;src.execute('PRAGMA query_only=ON');src.execute('BEGIN')
    before=Path(registry).stat();namehost=defaultdict(list);counts=Counter()
    # All original source IDs preserved. No legal coalescing by telephone/domain/name.
    q='SELECT source_id,record_uid,name_ar,name_en,tradename,legal_name,city,district,category_raw,website_raw FROM source_records'
    for raw in src.execute(q):
        r=dict(raw);oid=observation_id(r['source_id'],r['record_uid']);host=domain(r['website_raw']);name=r['legal_name'] or r['tradename'] or r['name_ar'] or r['name_en'] or ''
        db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?,?)',(oid,r['source_id'],r['record_uid'],name,r['city'],r['district'],r['category_raw'],host,'SOURCE_RECORD_LINEAGE_ONLY'))
        for field in ['name_ar','name_en','tradename','legal_name']:
            if r[field] and host:namehost[(normalize(r[field]),host)].append(r)
        counts['source_observations']+=1
    snapshot=src.execute('SELECT min(built_at) FROM supplier_groups').fetchone()[0]
    for r in src.execute('SELECT source_id,record_uid,supplier_group_id FROM supplier_branches'):
        oid=observation_id(r['source_id'],r['record_uid'])
        if db.execute('SELECT 1 FROM observations WHERE id=?',(oid,)).fetchone():db.execute('INSERT OR IGNORE INTO legacy_aliases VALUES(?,?,?)',(snapshot,r['supplier_group_id'],oid));counts['legacy_alias_rows']+=1
    def subject(key,name,text,family,cf,ci,specs,url,kind,date,datekind,file):
        sid=stable_id('SUB',key);db.execute('INSERT OR IGNORE INTO subjects VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(sid,key,name,normalize(text),family,cf,ci,json.dumps(specs,ensure_ascii=False),url,kind,date,datekind,file));return sid
    for r in src.execute('SELECT * FROM farq_products_staging'):
        subject('registry:'+r['product_id'],r['product_name_ar'] or r['product_name_en'] or r['product_name'],' '.join(str(r[k] or '') for k in ['product_name','product_name_ar','product_name_en','brand']),r['product_family_id'],None,None,{},r['source_url'],'CATALOG_PRODUCT_RECORD',r['loaded_at'],'BUILD_TIME_NOT_OBSERVATION',registry);counts['staged_product_records']+=1
    # Retain source catalog specs, with unverified specs separated; source updated != stock today.
    for r in csv.DictReader(Path(catalog).open(encoding='utf-8-sig')):
        subject('masdar:'+r['product_id'],r['product_name_ar'] or r['product_name_en'],' '.join(r[k] for k in ['product_name_ar','product_name_en','brand_or_manufacturer']),r['family_id'],None,None,{'source_specs':r['specs_json'],'unverified_specs':r['specs_unverified_json']},r['source_url'],'STRUCTURED_CATALOG_PRODUCT',r['source_updated_at'],'SOURCE_DATE_NOT_CURRENT_STOCK',catalog);counts['masdar_records']+=1
    # Existing CPO mappings reused as proposals; consistency disagreement remains quarantined.
    for line in Path(prior).open():
        r=json.loads(line);name=r.get('product_name') or ''
        sid=subject('existing:'+stable_id('LINK',r.get('source_url'),name),name,name,None,r.get('resolved_family'),r.get('resolved_intent'),r.get('resolved_facets') or {},r.get('source_url'),'EXISTING_PRODUCT_RELATION',r.get('observed_at'),'SOURCE_OBSERVATION_UNCONFIRMED',prior)
        eid=stable_id('EV',r.get('source_url'),name,r.get('input_dataset'));db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)',(eid,prior,None,r.get('source_url'),None,r.get('observed_at'),'SOURCE_OBSERVATION_UNCONFIRMED','PRODUCT_REFERENCE',name,None,'AUTOMATED_CONTRACT_ONLY'))
        rid=stable_id('REL',r.get('supplier_id'),r.get('supplier_external_key'),sid,eid)
        blockers=['SELLER_SOURCE_LINEAGE_UNRESOLVED','BRANCH_AND_STOCK_UNCONFIRMED']
        if r.get('consistency_status')!='CURRENT_RESOLVER_AGREEMENT':blockers.append('CPO_MAPPING_DISAGREEMENT')
        db.execute('INSERT OR IGNORE INTO relations VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,None,sid,r.get('resolved_family'),r.get('resolved_intent'),'SELLS',eid,'REVIEW_CANDIDATE','PRODUCT_REFERENCE',json.dumps(blockers),None));counts['existing_link_records']+=1
    h=hashlib.sha256()
    for n,line in enumerate(Path(pages).open('rb'),1):
        h.update(line);r=json.loads(line)
        if r.get('fetch_status')!='FETCHED':continue
        url=r.get('canonical_url') or r.get('url');text=re.sub(r'\s+',' ',' '.join(str(r.get(k) or '') for k in ['title','headings','text']))
        eid=stable_id('EV',str(pages),n,r.get('content_hash'))
        # Contact values remain in originals. Never persist direct contact text in reports.
        safe=re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}','[CONTACT_REDACTED]',text)
        safe=re.sub(r'(?<!\w)\+?\d[\d -]{7,}\d(?!\w)','[CONTACT_REDACTED]',safe)
        db.execute('INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)',(eid,pages,n,url,r.get('content_hash'),r.get('fetched_at'),'SAVED_FETCH','SAVED_COMMERCIAL_PAGE',safe,None,'AUTOMATED_CONTENT_CAPTURE'))
        candidates=namehost.get((normalize(r.get('supplier_name')),domain(url)),[]);decision=reconcile(r,candidates)
        db.execute('INSERT INTO page_identity VALUES(?,?,?,?)',(eid,r.get('supplier_external_key'),decision['decision'],json.dumps(decision['candidate_observation_ids'])))
        db.execute('INSERT INTO unresolved VALUES(?,?,?,?)',(stable_id('ISSUE',eid),'IDENTITY',eid,decision['decision']));counts[decision['decision']]+=1
        # Page text is searchable but never turns a family mention into exact-SKU proof.
        sid=subject('page:'+eid,str(r.get('title') or r.get('supplier_name') or ''),safe,None,None,None,{},url,'SAVED_PAGE',r.get('fetched_at'),'SAVED_FETCH',pages)
        for oid in decision['candidate_observation_ids']:
            rid=stable_id('REL',oid,sid,eid);db.execute('INSERT OR IGNORE INTO relations VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,oid,sid,None,None,'SELLS',eid,'IDENTITY_REVIEW_REQUIRED','PAGE_TEXT',json.dumps(['LEGAL_BRAND_RELATION_UNPROVEN','PRODUCT_AND_BRANCH_REVIEW_REQUIRED']),None))
    db.execute('INSERT INTO subject_search SELECT id,normalized_text FROM subjects')
    db.execute('INSERT INTO metadata VALUES(?,?)',('pages_sha256',h.hexdigest()))
    db.execute('INSERT INTO metadata VALUES(?,?)',('registry_source',str(registry)))
    db.execute('INSERT INTO metadata VALUES(?,?)',('schema_version','1'))
    src.rollback();src.close();after=Path(registry).stat()
    assert (before.st_size,before.st_mtime_ns)==(after.st_size,after.st_mtime_ns)
    db.commit();assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    counts['subjects']=db.execute('SELECT count(*) FROM subjects').fetchone()[0];counts['relations']=db.execute('SELECT count(*) FROM relations').fetchone()[0]
    db.close();temp.replace(output)
    (output.parent/'build-receipt.json').write_text(json.dumps({'counts':dict(counts),'source_unchanged_stat':True,'legal_merges':0,'verified_seller_promotions':0,'source_pages_sha256':h.hexdigest(),'identity_cause':'merge.py lines 333-334 assigns sorted cluster ordinal SG identifiers','output_bytes':output.stat().st_size},indent=2));print(dict(counts),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--registry',required=True);p.add_argument('--output',required=True);p.add_argument('--pages',required=True);p.add_argument('--catalog',required=True);p.add_argument('--prior',required=True);a=p.parse_args();build(a.registry,a.output,a.pages,a.catalog,a.prior)
