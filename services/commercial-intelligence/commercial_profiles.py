"""Reconstruct source-owned commercial profiles and a no-paid-call enrichment queue."""
import argparse,json,re,sqlite3
from pathlib import Path
from identity import domain,stable_id
BLOCKED_HOSTS=['facebook.com','instagram.com','linkedin.com','twitter.com','yellowpages','directory','amazon.sa','noon.com','haraj.com','haraj.sa']
def run(dbpath,pages):
 p=Path(dbpath).resolve();db=sqlite3.connect(p.as_uri()+'?mode=rw',uri=True)
 if db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0]!='1':raise ValueError('DERIVED_DATABASE_REQUIRED')
 db.executescript('''CREATE TABLE IF NOT EXISTS commercial_profiles(id TEXT PRIMARY KEY,host TEXT UNIQUE,display_name TEXT,name_basis TEXT,source_url TEXT,source_date TEXT,contact_json TEXT,legal_identity_status TEXT);
 CREATE TABLE IF NOT EXISTS enrichment_ledger(entity_id TEXT PRIMARY KEY,query TEXT NOT NULL,status TEXT NOT NULL,paid_calls INTEGER NOT NULL DEFAULT 0 CHECK(paid_calls BETWEEN 0 AND 1),approved_cap INTEGER NOT NULL DEFAULT 0);''')
 for line in Path(pages).open():
  r=json.loads(line)
  if r.get('fetch_status')!='FETCHED':continue
  url=r.get('canonical_url') or r.get('url');host=domain(url)
  if not host or any(h in host for h in BLOCKED_HOSTS):continue
  text=str(r.get('text') or '');title=str(r.get('title') or host)
  # Only contacts in the very same saved public source, never SG contact inheritance.
  phones=[]
  for m in re.finditer(r'(?:هاتف|جوال|اتصل|واتساب|phone|telephone|whatsapp|call)[^\n]{0,55}?((?:\+?966|0)(?:[ -]*\d){8,10})',text,re.I):
   number=re.sub(r'[^0-9]','',m[1]);number='966'+number[1:] if number.startswith('0') else number
   if re.fullmatch(r'966(?:5\d{8}|1\d{8})',number):phones.append('+'+number)
  emails=sorted(set(re.findall(r'[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}',text)))
  emails=[e for e in emails if domain('https://'+e.split('@')[1])==host or e.split('@')[1] in ['gmail.com','hotmail.com','outlook.com']]
  pid=stable_id('COMMERCIAL_PROFILE',host);existing=db.execute('SELECT contact_json FROM commercial_profiles WHERE id=?',(pid,)).fetchone();contacts=json.loads(existing[0]) if existing else {'phone':[],'email':[]}
  contacts={'phone':sorted(set(contacts['phone']+phones)),'email':sorted(set(contacts['email']+emails))}
  db.execute('INSERT INTO commercial_profiles VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET contact_json=excluded.contact_json',(pid,host,host,'SOURCE_DOMAIN_NAME_NO_LEGAL_LINK',url,r.get('fetched_at'),json.dumps(contacts),'UNLINKED_NO_LEGAL_MERGE'))
  if not any(contacts.values()):db.execute('INSERT OR IGNORE INTO enrichment_ledger(entity_id,query,status) VALUES(?,?,?)',(pid,host+' السعودية','PLANNED_NO_APPROVED_PAID_BUDGET'))
 db.commit();receipt={'searchable_source_profiles':db.execute('SELECT count(*) FROM commercial_profiles').fetchone()[0],'profiles_with_source_phone':db.execute("SELECT count(*) FROM commercial_profiles WHERE json_array_length(contact_json,'$.phone')>0").fetchone()[0],'profiles_with_source_email':db.execute("SELECT count(*) FROM commercial_profiles WHERE json_array_length(contact_json,'$.email')>0").fetchone()[0],'queued_unique_entities':db.execute('SELECT count(*) FROM enrichment_ledger').fetchone()[0],'serper_calls':0,'paid_budget_approved':0,'contacts_scope':'SAME_PUBLIC_SAVED_SOURCE_ONLY_NOT_LIVE_VERIFIED','legal_merges':0};db.close();p.with_name('commercial-profiles-receipt.json').write_text(json.dumps(receipt,indent=2));print(receipt)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--pages',required=True);a=p.parse_args();run(a.db,a.pages)
