"""Only run after owner approval. Local durable files, no database writes or messaging."""
import argparse, json, re, urllib.request, sqlite3
from pathlib import Path
from urllib.parse import urlparse
from legacy_extract import extract, norm, GENERIC, SKIP_SITES
BAD={'966569576338','966172850000','966112345678','966173456789','966123456789'}

def claim_identity(path,identity):
    path=Path(path)
    db=sqlite3.connect(path,timeout=10)
    try:
        db.execute('BEGIN IMMEDIATE')
        tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if tables-{'identity_attempts'}:
            db.rollback()
            raise ValueError('DEDICATED_DERIVATIVE_LEDGER_REQUIRED')
        db.execute('CREATE TABLE IF NOT EXISTS identity_attempts(identity TEXT PRIMARY KEY,status TEXT NOT NULL)')
        db.execute('INSERT INTO identity_attempts VALUES(?,?)',(identity,'ATTEMPT_RESERVED'))
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback();raise ValueError('IDENTITY_ALREADY_ATTEMPTED_NO_AUTOMATIC_RETRY')
    finally:db.close()
    Path(path).chmod(0o600)

def run(root,cap):
    plan=json.loads((root/'approved-batch-plan.json').read_text())
    if plan.get('approved') is not True or type(plan.get('approved_credit_cap')) is not int or type(cap)!=int or cap<1 or cap>plan.get('approved_credit_cap',0) or len(plan['targets'])!=1:
        raise ValueError('EXPLICIT_APPROVED_SINGLE_IDENTITY_CAP_REQUIRED')
    # Key is read only at execution; never logged or placed in command arguments.
    row=plan['targets'][0];identity=row.get('entity_id') or row.get('poi_key')
    if not identity:raise ValueError('STABLE_IDENTITY_REQUIRED')
    if not plan.get('identity_attempt_ledger') or not Path(plan['identity_attempt_ledger']).is_absolute():raise ValueError('SHARED_PERMANENT_IDENTITY_LEDGER_REQUIRED')
    shared_ledger=Path(plan['identity_attempt_ledger'])
    key=next(line.split('=',1)[1].strip().strip('\"').strip("'") for line in Path.home().joinpath('.config/farq/serper.env').read_text().splitlines() if line.startswith('SERPER_API_KEY='))
    ledger=root/'serper-credits-used.json';used=json.loads(ledger.read_text()) if ledger.exists() else 0
    row=plan['targets'][0];names=[row.get('name_ar'),row.get('name_en')]
    distinguishing={t for name in names if name for t in norm(name).split() if len(t)>=3 and t not in GENERIC}
    def call(endpoint,q):
        nonlocal used
        raw=root/f'serper-{endpoint}.json'
        if raw.exists():return json.loads(raw.read_text())
        if used>=min(cap,1):raise RuntimeError('one search per identity cap reached')
        claim_identity(shared_ledger,identity)
        used+=1;ledger.write_text(json.dumps(used)) # count attempts, not just successful replies
        req=urllib.request.Request('https://google.serper.dev/'+endpoint,data=json.dumps({'q':q,'gl':'sa','hl':'en' if not re.search('[؀-ۿ]',q) else 'ar'}).encode(),headers={'X-API-KEY':key,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=20) as response:data=json.loads(response.read(200000))
        raw.write_text(json.dumps(data,ensure_ascii=False,indent=2));return data
    def safe(data):
        def identity(item):
            title_tokens=set(norm(item.get('title','')).split())
            return bool(distinguishing) and len(distinguishing & title_tokens)>=max(1,(7*len(distinguishing)+9)//10)
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
    result=extract(row.get('poi_key',identity),names,responses)
    # No automatic Maps retry: maximum one paid request per stable identity.
    digits=re.sub(r'\D','',result.get('phone') or '')
    if digits in BAD or not re.fullmatch(r'966[15]\d{8}',digits):result['phone']=None
    result['whatsapp']=None;result['whatsapp_status']='unknown';result['product_evidence']=None
    record={'poi_key':row.get('poi_key',identity),'name':name,'city':plan['city'],'credits_attempted':used,'result':result,'applied_to_production':False}
    (root/'review-result.json').write_text(json.dumps(record,ensure_ascii=False,indent=2))
    print(json.dumps(record,ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--approved',action='store_true',required=True);p.add_argument('--root',type=Path,required=True);p.add_argument('--cap',type=int,required=True);a=p.parse_args();run(a.root,a.cap)
