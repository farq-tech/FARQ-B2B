"""Only run after owner approval. Local durable files, no database writes or messaging."""
import argparse, json, re, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from legacy_extract import extract, norm, GENERIC, SKIP_SITES
BAD={'966569576338','966172850000','966112345678','966173456789','966123456789'}

def run(root,cap):
    plan=json.loads((root/'approved-batch-plan.json').read_text())
    assert cap==2 and len(plan['targets'])==1
    # Key is read only at execution; never logged or placed in command arguments.
    key=next(line.split('=',1)[1].strip().strip('\"').strip("'") for line in Path.home().joinpath('.config/farq/serper.env').read_text().splitlines() if line.startswith('SERPER_API_KEY='))
    ledger=root/'serper-credits-used.json';used=json.loads(ledger.read_text()) if ledger.exists() else 0
    row=plan['targets'][0];names=[row.get('name_ar'),row.get('name_en')]
    distinguishing={t for name in names if name for t in norm(name).split() if len(t)>=3 and t not in GENERIC}
    def call(endpoint,q):
        nonlocal used
        raw=root/f'serper-{endpoint}.json'
        if raw.exists():return json.loads(raw.read_text())
        if used>=cap:raise RuntimeError('credit cap reached')
        used+=1;ledger.write_text(json.dumps(used)) # count attempts, not just successful replies
        req=urllib.request.Request('https://google.serper.dev/'+endpoint,data=json.dumps({'q':q,'gl':'sa','hl':'en' if not re.search('[؀-ۿ]',q) else 'ar'}).encode(),headers={'X-API-KEY':key,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=20) as response:data=json.loads(response.read(200000))
        raw.write_text(json.dumps(data,ensure_ascii=False,indent=2));return data
    def safe(data):
        def identity(item):return bool(distinguishing & set(norm(item.get('title','')).split()))
        def website(url):return bool(url) and urlparse(url).scheme=='https' and not any(x in urlparse(url).netloc.lower() for x in SKIP_SITES)
        data=dict(data)
        data['organic']=[x for x in data.get('organic',[]) if identity(x) and website(x.get('link'))]
        data['places']=[x for x in data.get('places',[]) if identity(x)]
        if not identity(data.get('knowledgeGraph') or {}):data.pop('knowledgeGraph',None)
        for x in data['places']+([data['knowledgeGraph']] if data.get('knowledgeGraph') else []):
            if not website(x.get('website')):x.pop('website',None)
        return data
    name=row.get('name_ar') or row.get('name_en')
    responses=[('search',safe(call('search',name+' السعودية')))]
    result=extract(row['poi_key'],names,responses)
    if not result.get('phone') or not result.get('website'):
        q=(row.get('name_en')+' Saudi Arabia') if row.get('name_en') else name+' رقم'
        responses.append(('places',safe(call('places',q))));result=extract(row['poi_key'],names,responses)
    digits=re.sub(r'\D','',result.get('phone') or '')
    if digits in BAD or not re.fullmatch(r'966[15]\d{8}',digits):result['phone']=None
    result['whatsapp']=None;result['whatsapp_status']='unknown';result['product_evidence']=None
    record={'poi_key':row['poi_key'],'name':name,'city':plan['city'],'credits_attempted':used,'result':result,'applied_to_production':False}
    (root/'review-result.json').write_text(json.dumps(record,ensure_ascii=False,indent=2))
    print(json.dumps(record,ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--approved',action='store_true',required=True);p.add_argument('--root',type=Path,required=True);p.add_argument('--cap',type=int,required=True);a=p.parse_args();run(a.root,a.cap)
