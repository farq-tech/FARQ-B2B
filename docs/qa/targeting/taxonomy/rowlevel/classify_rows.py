"""Row-level taxonomy classification (read-only on the directory). Writes poi_key -> sub_id, source, confidence."""
import duckdb, csv, json, re, sys, collections
from name_rules import RULES, VACANT
from tag_map import TAGS
from surveyor_categories import CONSISTENT, DEFAULT, CONTEXT
import os
P=os.environ.get('CLASSIFY_INPUT','/Users/m4pro/farq-targeting/data/targets.parquet')  # any parquet in the directory schema (new entities too)
T='/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/'
OUT=sys.argv[1]
tax=json.load(open(T+'farq_taxonomy.json')); SUBS={s['sub_id'] for s in tax['subs']}
for s,_,_ in RULES: assert s in SUBS, s
TR=str.maketrans('أإآةىؤئ','اااهيوي')
def norm(s):
    s=(s or '').lower().translate(TR)
    s=re.sub('[ً-ْـ]','',s)
    s=re.sub(r"[_/\-–|(),.&{}\[\]\"'’:;!؟?،+*#0-9]+",' ',s)
    return re.sub(r'\s+',' ',s).strip()
KW={}
for sub,w,kws in RULES:
    for k in kws:
        k=norm(k)
        if k and (k not in KW or KW[k][1]<w): KW[k]=(sub,w)
PFX=('وال','بال','لل','ال','و','ل','ب')
def variants(t):
    out={t}
    if len(t)>4 and t.endswith('ies'): out.add(t[:-3]+'y')
    elif len(t)>4 and t.endswith('es'): out.add(t[:-2])
    if len(t)>3 and t.endswith('s') and not t.endswith('ss'): out.add(t[:-1])
    for p in PFX:
        if t.startswith(p) and len(t)-len(p)>=2: out.add(t[len(p):])
    return out
def strip_pfx(t):
    for p in ('وال','بال','لل','ال'):
        if t.startswith(p) and len(t)-len(p)>=2: return t[len(p):]
    return t
def name_match(text):
    raw=norm(text).split()
    best=None
    for toks in (raw,[strip_pfx(t) for t in raw]):
        for n in (3,2,1):
            for i in range(len(toks)-n+1):
                g=' '.join(toks[i:i+n])
                for c in ({g} if n>1 else variants(g)):
                    if c in KW:
                        sub,w=KW[c]; sc=(w,n)
                        if best is None or sc>best[0]: best=(sc,sub,c)
    if best and best[1]=='personal.laundry' and re.search(r'سيار|\bcar', norm(text)): best=((8,2),'auto.car_wash',best[2]+' +car')
    return best
VAC=re.compile(r'(^| )('+'|'.join(re.escape(norm(v)) for v in VACANT)+r')( |$)')
amap=list(csv.DictReader(open(T+'activity_map.csv',encoding='utf-8-sig')))
ACT={r['raw_activity']:(r['sub_id'],r['confidence']) for r in amap}
LBL={}
for r in amap:
    if r['confidence'] in ('high','medium') and norm(r['raw_activity']): LBL.setdefault(norm(r['raw_activity']),r['sub_id'])
byar=collections.defaultdict(set)
for r in amap:
    if r['confidence'] in ('high','medium') and r['raw_ar']: byar[norm(r['raw_ar'])].add(r['sub_id'])
for k,v in byar.items():
    if len(v)==1: LBL.setdefault(k,next(iter(v)))
TAGN={norm(k):v for k,v in TAGS.items()}
def tag_match(v):
    for part in re.split(r'[,|]',v or ''):
        k=norm(part)
        if k in TAGN: return TAGN[k],part.strip()
    return None
# HudHud subcategory ids (surveyor-assigned) found as codes such as «|191|» or «|639|537|» in secondary_category
HHSUB={}
for _r in csv.DictReader(open(T+'hudhud_sub_map.csv',encoding='utf-8')):
    if _r['confidence'] in ('high','medium') and not _r['sub_id'].startswith('unc.'): HHSUB[_r['hudhud_sub_id'].split('.')[0]]=(_r['sub_id'],_r['confidence'],_r['hudhud_sub_en'])
def hudhud_code_match(v):
    if not v or not re.fullmatch(r'\|?[0-9.|]+\|?', v.strip()): return None
    for code in [c.split('.')[0] for c in v.strip('|').split('|') if c]:
        if code in HHSUB: return HHSUB[code]
    return None
def label_match(*vals):
    for v in vals:
        if not v: continue
        for part in re.split(r'[|,{}\[\]]',v):
            k=norm(part)
            if k and k in LBL: return LBL[k],part.strip()
    return None
db=duckdb.connect()
# surveyor top category per HudHud TRX (after cleaning), from the local entity lake
TRXCAT=dict(db.execute("""select 'hh:'||source_native_id, regexp_extract(category, '''name_en'': ''([^'']*)''',1) from read_parquet('/Users/m4pro/ksa-entity-lake/staging/trx.parquet')
   where regexp_extract(category, '''name_en'': ''([^'']*)''',1)<>''""").fetchall())
cur=db.execute(f"""select poi_key, trim(split_part(category,'|',1)) act, category_ar, secondary_category, google_category, name_ar, name_en
 from read_parquet('{P}') where coalesce(lifecycle_state,'') not in ('closed','permanently_closed') and coalesce(company_status,'') not in ('cancelled','inactive','ملغي','ملغى')""")
stats=collections.Counter(); f=open(OUT,'w',newline='',encoding='utf-8'); w=csv.writer(f); w.writerow(['poi_key','sub_id','source','confidence','evidence'])
while True:
    batch=cur.fetchmany(100000)
    if not batch: break
    for key,act,car,sec,goo,nar,nen in batch:
        a=ACT.get(act) if act else None
        if a and a[1] in ('high','medium'): r=(a[0],'activity',a[1],act)
        else:
            hh=hudhud_code_match(sec)
            lm=label_match(sec,goo,car if not a else None) or (tag_match(car) if not a else None)
            nm=(name_match(nar) if nar else None) or (name_match(nen) if nen else None)  # name_en is sometimes another entity's name
            if hh: r=(hh[0],'hudhud_sub',hh[1],'HudHud sub: '+hh[2])   # a surveyor-assigned subcategory beats labels and name words
            elif lm and nm and nm[0][0]>=7 and nm[1]!=lm[0]: r=(nm[1],'name','medium',nm[2])  # a specific trade word in the name beats a noisy secondary label
            elif lm: r=(lm[0],'secondary',"medium",lm[1])
            else:
                if nm and nm[0][0]>=5: r=(nm[1],'name','medium' if nm[0][0]>=7 else 'low',nm[2])
                elif a and not a[0].startswith('unc.'): r=(a[0],'activity','low',act)
                elif nm: r=(nm[1],'name','low',nm[2])
                elif a: r=(a[0],'activity','low',act)
                else: r=('unc.unknown','none','low','')
        sc=TRXCAT.get(key)
        if sc in CONSISTENT and r[1] in ('name','secondary','none') and not any(r[0].startswith(p) for p in CONSISTENT[sc]):
            r=(CONTEXT.get((sc,r[0]), DEFAULT[sc]),'surveyor_category','high','HudHud TRX: '+sc+(' (was '+r[0]+')' if r[1]!='none' else ''))
        if r[1] in ('none','name','activity') and r[2]!='high' and VAC.search(' '+norm(nar or nen or '')+' '): r=('unc.unknown','vacant','high','vacant or closed unit')
        stats[(r[1],r[2])]+=1; w.writerow([key,*r])
f.close()
print(sorted(stats.items(),key=lambda x:-x[1]))
