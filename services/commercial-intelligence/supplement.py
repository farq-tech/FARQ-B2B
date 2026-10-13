"""Local historical grocery and procurement evidence, never current demand/stock."""
import csv,json,sqlite3
from pathlib import Path
from identity import stable_id,normalize
def supplement(dbpath,grocery,tender):
    db=sqlite3.connect(dbpath);db.execute('PRAGMA foreign_keys=ON');count=0
    for n,r in enumerate(csv.DictReader(Path(grocery).open()),2):
        sid=stable_id('SUB','fustog',r['FID']);name=r['TitleAr'] or r['TitleEn']
        text=' '.join(r.get(k,'') for k in ['TitleAr','TitleEn','BrandAR','BrandEN','AttrUnit','AttrVal'])
        data=(sid,'fustog:'+r['FID'],name,normalize(text),r['CateguryEN'],None,None,json.dumps({'unit':r['AttrUnit'],'value':r['AttrVal'],'brand_ar':r['BrandAR'],'brand_en':r['BrandEN']},ensure_ascii=False),None,'HISTORICAL_RETAIL_PRODUCT','2026-05-09','FILENAME_SNAPSHOT_DATE',grocery)
        db.execute('INSERT OR IGNORE INTO subjects VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',data)
        eid=stable_id('EV','fustog',r['FID'],r['StoreKey'],r['sid'])
        db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)',(eid,grocery,n,None,None,'2026-05-09','FILENAME_SNAPSHOT_DATE','HISTORICAL_RETAIL_PRICE',name+' — '+r['retailer_brand_ar']+' — '+r['store_name_ar'],None,'AUTOMATED_RECORD_EXTRACTION_ONLY'))
        rid=stable_id('REL',eid,sid)
        db.execute('INSERT OR IGNORE INTO relations VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,None,sid,None,None,'SELLS',eid,'HISTORICAL_RETAIL_ONLY','PRODUCT_REFERENCE',json.dumps(['NOT_WHOLESALE_PROOF','LEGAL_ENTITY_AND_BRANCH_UNVERIFIED','NO_CURRENT_STOCK']),None));count+=1
    historical=[]
    for r in json.loads(Path(tender).read_text()):
        historical.append({'id':stable_id('DEMAND',r['item_id']),'source_document':r['source_document'],'source_evidence':r.get('source_evidence'),'product_description':r.get('raw_item_name'),'quantity':r.get('quantity'),'unit':r.get('unit'),'location':r.get('project_location'),'status':'HISTORICAL_DOCUMENT_ONLY','date':'2020/48_TENDER_NUMBER_NOT_CURRENT','entity_identity':'AUTHORITY_MASKED_UNRESOLVED','owner_scope':'local-review:owner','current_demand_proven':False})
    db.execute('DELETE FROM subject_search');db.execute('INSERT INTO subject_search SELECT id,normalized_text FROM subjects');db.commit();db.close()
    Path(dbpath).with_name('historical-demand.json').write_text(json.dumps(historical,ensure_ascii=False,indent=2));print({'historical_price_records':count,'historical_boq_rows':len(historical)})
if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--grocery',required=True);p.add_argument('--tender',required=True);a=p.parse_args();supplement(a.db,a.grocery,a.tender)
