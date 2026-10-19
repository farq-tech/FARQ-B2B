"""Authenticated, bounded vector tiles over the existing read-only POI directory."""
import status_policy
import collections
import json
import hashlib
import math
import re
import secrets
import threading
import time
import duckdb
import mapbox_vector_tile
from trial_search import norm, contains

LABELS={'Corporate':'شركات وأعمال','Shopping':'تسوق وتجارة','Restaurants':'مطاعم','Hotels and Accommodations':'فنادق وإقامة','Home Goods':'تجهيزات المنزل','Grocery':'مواد غذائية','Education':'تعليم','Beauty and Spa':'تجميل وعناية','Automotive Services':'خدمات السيارات','Transportation':'نقل','Health':'صحة','Medical':'طب','Mosques':'مساجد','decor_carpentry_furniture':'أثاث ونجارة','غير مصنف':'غير مصنف'}
def main_category(value): return (value or '').split('|')[0].strip() or 'غير مصنف'
def subcategories(*values):
    terms=[]
    for value in values:
        if not value: continue
        for term in re.split(r'[|,]',str(value)):
            term=term.strip(' {}[]\"\'')
            if 2<=len(term)<=100 and term not in terms: terms.append(term)
    return terms[:12]
def entity_kind(legal,name):
    text=norm(legal or name)
    if re.search(r'\b(شركه|شركات|company|corporation|llc)\b',text): return 'company'
    if re.search(r'\b(مؤسسه|establishment|est)\b',text): return 'establishment'
    return 'unknown'
def valid_filters(value):
    if value is None: value = {}
    if not isinstance(value,dict): raise ValueError('invalid filters')
    out={}
    for key in ('category','subcategory','entity_type','contact','sort','keyword'):
        val=value.get(key,'')
        if not isinstance(val,str) or len(val)>100: raise ValueError('invalid filters')
        out[key]=val
    if out['entity_type'] not in ('','company','establishment','unknown'): raise ValueError('invalid entity type')
    if out['contact'] not in ('','all','whatsapp','email'): raise ValueError('invalid contact')
    if out['sort'] not in ('','confidence','name_first'): raise ValueError('invalid sort')
    # area and wholesale (owner 2026-10-16): «محلات السباكة بشارع معين أو حي معين», «جملة مواد سباكة»
    for key in ('district','street'):
        val=value.get(key,'')
        if not isinstance(val,str) or len(val)>100: raise ValueError('invalid filters')
        out[key]=val.strip()
    out['wholesale']=value.get('wholesale') is True
    # badges (owner 2026-10-16): one role badge and/or one specialty name, exact match against the row's badges
    for key in ('role','specialty'):
        val=value.get(key,'')
        if not isinstance(val,str) or len(val)>100: raise ValueError('invalid filters')
        out[key]=val.strip()
    for key, max_len in (('taxonomy_main_id',40),('taxonomy_sub_id',80),('taxonomy_specialty_id',80)):
        val=value.get(key,'')
        if not isinstance(val,str) or len(val)>max_len: raise ValueError('invalid taxonomy filter')
        out[key]=val.strip()
    out['branches_only']=value.get('branches_only') is True
    out['name_only']=value.get('name_only') is True
    bounds=value.get('bounds')
    if bounds is not None:
        if not isinstance(bounds,list) or len(bounds)!=4 or not all(type(x) in (float,int) and math.isfinite(x) for x in bounds) or not (-180<=bounds[0]<=bounds[2]<=180 and -85.1<=bounds[1]<=bounds[3]<=85.1): raise ValueError('invalid bounds')
        out['bounds']=bounds
    # delivery radius (owner rule 2026-10-16): with the buyer's site [lon, lat], keep only suppliers whose service radius reaches it
    site=value.get('site')
    if site is not None:
        if not isinstance(site,list) or len(site)!=2 or not all(type(x) in (float,int) and math.isfinite(x) for x in site) or not (-180<=site[0]<=180 and -85.1<=site[1]<=85.1): raise ValueError('invalid site')
        out['site']=site
    return out
def area_key(v):
    # «حي الفيصلية» = «الفيصلية», «شارع الملك فهد» contains «الملك فهد»
    v=re.sub(r'[أإآ]','ا',(v or '').strip().lower()).replace('ة','ه').replace('ى','ي')
    return re.sub(r'^(حي|شارع|طريق)\s+','',re.sub(r'\s+',' ',v))
def area_facets(rows):
    # the districts and streets of the current result, busiest first, for the area pickers
    import collections
    d=collections.Counter(r.get('district_ar') for r in rows if r.get('district_ar') and r.get('district_reliable') is not False)
    st=collections.Counter((r.get('street_ar'),r.get('district_ar')) for r in rows if r.get('street_ar'))
    return {'districts':[{'name':k,'n':n} for k,n in d.most_common(60)],
            'streets':[{'name':k[0],'district':k[1],'n':n} for k,n in st.most_common(60)],
            'wholesale':sum(1 for r in rows if r.get('is_wholesale')),
            'roles':[{'name':k,'n':n} for k,n in collections.Counter(b for r in rows for b in (r.get('role_badges') or [])).most_common()],
            'specialties':[{'name':k,'n':n} for k,n in collections.Counter(b for r in rows for b in (r.get('specialties') or [])).most_common(40)]}
def km_between(lon1,lat1,lon2,lat2):
    p=math.pi/180;a=math.sin((lat2-lat1)*p/2)**2+math.cos(lat1*p)*math.cos(lat2*p)*math.sin((lon2-lon1)*p/2)**2
    return 12742*math.asin(math.sqrt(a))
DEFAULT_RADIUS_KM=40   # rows without a taxonomy radius (old search path): a shop within the city
def is_precise_point(row):
    lat,lon=row.get('latitude'),row.get('longitude')
    return row.get('location_precision')=='point' and isinstance(lat,(int,float)) and isinstance(lon,(int,float)) and -85.05112878<=lat<=85.05112878 and -180<=lon<=180
def has_usable_whatsapp(row):
    """A source marker needs a deliverable Saudi mobile before it is a WhatsApp contact."""
    return bool(row.get('has_whatsapp')) and bool(status_policy.mobile_of({'phone_norm': row.get('phone_norm') or row.get('phone')}))
def filter_rows(rows,filters):
    f=valid_filters(filters)
    out=[]
    for row in rows:
        if f.get('category') and row.get('category_main')!=f['category']: continue
        if f.get('subcategory') and f['subcategory'] not in row.get('subcategories',[]): continue
        if f.get('entity_type') and row.get('entity_type')!=f['entity_type']: continue
        if f.get('branches_only') and row.get('registered_location_count',0)<2: continue
        if f.get('name_only') and not row.get('keyword_name_match'): continue
        if f.get('contact')=='whatsapp' and not has_usable_whatsapp(row): continue
        if f.get('wholesale') and not row.get('is_wholesale'): continue
        if f.get('district') and (row.get('district_reliable') is False or area_key(row.get('district_ar'))!=area_key(f['district'])): continue
        if f.get('role') and f['role'] not in (row.get('role_badges') or []) and not (f['role']=='جملة' and row.get('is_wholesale')): continue
        if f.get('specialty') and f['specialty'] not in (row.get('specialties') or []): continue
        if f.get('street') and area_key(f['street']) not in area_key(row.get('street_ar')): continue
        if f.get('site'):
            if row.get('latitude') is None or row.get('longitude') is None: continue
            if km_between(f['site'][0],f['site'][1],row['longitude'],row['latitude'])>(row.get('service_radius_km') or DEFAULT_RADIUS_KM): continue
        if f.get('contact')=='email' and not row.get('email'): continue
        if f.get('bounds'):
            w,s,e,n=f['bounds'];lon,lat=row.get('longitude'),row.get('latitude')
            if lon is None or lat is None or not w<=lon<=e or not s<=lat<=n: continue
        out.append(row)
    out.sort(key=lambda row: (-(bool(row.get('keyword_name_match')) if f.get('sort')=='name_first' else 0),-row.get('match_confidence',{}).get('score',0)))
    return out

class DirectoryTiles:
    def __init__(self,path):
        self.path=path;self.lock=threading.RLock();self.contexts=collections.OrderedDict();self.tiles=collections.OrderedDict();self.facets_cache={};self.fingerprints={}
        self.db=duckdb.connect();self.db.execute("SET threads=2; SET memory_limit='512MB'")
        self.db.execute("""create table branches as select lower(trim(brand_name)) brand,
            count(distinct concat(city_en,':',round(latitude,4),':',round(longitude,4))) n
            from read_parquet(?) where length(trim(brand_name))>2 and latitude is not null and longitude is not null
            group by 1""",[path])
        self.branch_counts=dict(self.db.execute('select * from branches').fetchall())
        self.search_sql=status_policy.search_sql(self.db,path)
    def facets(self,city):
        with self.lock:
            if city in self.facets_cache: return self.facets_cache[city]
            where='where '+self.search_sql+(' and city_en=?' if city and city!='*' else '')
            values=self.db.execute('select category,secondary_category,category_l3,count(*) from read_parquet(?) '+where+' group by 1,2,3',[self.path]+([city] if city and city!='*' else [])).fetchall()
            groups={}
            for main,sub,l3,count in values:
                main=main_category(main);g=groups.setdefault(main,{'value':main,'label':LABELS.get(main,main),'count':0,'subcategories':{}});g['count']+=count
                for term in subcategories(sub,l3): g['subcategories'][term]=g['subcategories'].get(term,0)+count
            result={'categories':[dict(g,subcategories=[{'value':k,'label':k,'count':n} for k,n in sorted(g['subcategories'].items(),key=lambda pair:-pair[1])]) for g in sorted(groups.values(),key=lambda g:-g['count'])],'size_available':False,'entity_type_source':'name_inference','branches_source':'distinct_registered_brand_locations'}
            self.facets_cache[city]=result;return result
    def register(self,rows=None,city=None,filters=None):
        f=valid_filters(filters)
        with self.lock:
            fingerprint=hashlib.sha256(json.dumps([city,f,[r['poi_key'] for r in rows] if rows is not None else None],sort_keys=True).encode()).hexdigest()
            old=self.fingerprints.get(fingerprint)
            if old in self.contexts and self.contexts[old][0]>time.monotonic():self.contexts.move_to_end(old);return old
            key=secrets.token_hex(16);self.contexts[key]=(time.monotonic()+1800,rows,city,f);self.fingerprints[fingerprint]=key
            if len(self.fingerprints)>64:self.fingerprints={k:v for k,v in self.fingerprints.items() if v in self.contexts}
            while len(self.contexts)>32:self.contexts.popitem(last=False)
        return key
    def context(self,key):
        item=self.contexts.get(key)
        if not item or item[0]<time.monotonic(): raise KeyError('MAP_QUERY_EXPIRED')
        return item
    def focus(self,key,level,identifier,sub_id=None,specialty_id=None):
        """Create a read-only map tile cohort matching the selected taxonomy focus."""
        if level not in ('main','sub','spec') or not isinstance(identifier,str) or not identifier or len(identifier)>100:
            raise ValueError('invalid map focus')
        with self.lock:
            _,rows,city,filters=self.context(key)
            filters=dict(filters)
        for name in ('taxonomy_main_id','taxonomy_sub_id','taxonomy_specialty_id'):
            filters.pop(name,None)
        if level=='main':
            if rows is not None:
                if identifier=='unc':
                    rows=[r for r in rows if not r.get('taxonomy_sub') or str(r.get('taxonomy_sub'))=='unc' or str(r.get('taxonomy_sub')).startswith('unc.')]
                else:
                    rows=[r for r in rows if str(r.get('taxonomy_sub') or '').split('.',1)[0]==identifier]
            else:
                filters['taxonomy_main_id']=identifier
        elif level=='sub':
            if rows is not None:
                rows=[r for r in rows if r.get('taxonomy_sub')==identifier]
            else:
                filters['taxonomy_sub_id']=identifier
        else:
            if rows is not None:
                rows=[r for r in rows if r.get('taxonomy_sub')==sub_id and identifier in (r.get('specialties') or [])]
            else:
                if not isinstance(sub_id,str) or not sub_id or not isinstance(specialty_id,str) or not specialty_id:
                    raise ValueError('specialty focus needs taxonomy ids')
                filters.update(taxonomy_sub_id=sub_id,taxonomy_specialty_id=specialty_id)
        if rows is not None:
            return self.register(rows=rows)
        return self.register(city=city,filters=filters)
    def sql(self,city,f,bounds=None):
        clauses=[self.search_sql,"coalesce(nullif(name_ar,''),name_en) is not null"]
        params=[self.path]
        if city and city!='*':clauses.append('city_en=?');params.append(city)
        if f.get('category'):clauses.append("coalesce(nullif(trim(split_part(coalesce(category,''),'|',1)),''),'غير مصنف')=?");params.append(f['category'])
        if f.get('subcategory'):clauses.append("(regexp_matches(coalesce(secondary_category,''),?) or regexp_matches(coalesce(category_l3,''),?))");params.extend([r'''(^|[|,\[{])\s*["']?'''+re.escape(f['subcategory'])+r'''["']?\s*($|[|,\]}])''']*2)
        if f.get('taxonomy_main_id')=='unc':clauses.append("(p.sub_id is null or p.sub_id='unc' or starts_with(p.sub_id,'unc.'))")
        elif f.get('taxonomy_main_id'):clauses.append("split_part(coalesce(p.sub_id,''),'.',1)=?");params.append(f['taxonomy_main_id'])
        if f.get('taxonomy_sub_id'):clauses.append('p.sub_id=?');params.append(f['taxonomy_sub_id'])
        if f.get('taxonomy_specialty_id'):
            clauses.append("list_contains(string_split(coalesce(p.specialty_ids,''),'|'),?)")
            params.append(f['taxonomy_specialty_id'])
        identity="translate(lower(coalesce(nullif(legal_name,''),name_ar,name_en,'')),'أإآةىؤئ','اااهيوي')"
        company="regexp_matches("+identity+",'(^|[^[:alnum:]؀-ۿ])(شركه|شركات|company|corporation|llc)($|[^[:alnum:]؀-ۿ])')"
        institution="regexp_matches("+identity+",'(^|[^[:alnum:]؀-ۿ])(مؤسسه|establishment|est)($|[^[:alnum:]؀-ۿ])')"
        if f.get('entity_type')=='company':clauses.append(company)
        elif f.get('entity_type')=='establishment':clauses.extend(['not '+company,institution])
        elif f.get('entity_type')=='unknown':clauses.extend(['not '+company,'not '+institution])
        if f.get('name_only'):
            keyword=norm(f.get('keyword',''))
            if not keyword:raise ValueError('name filter needs keyword')
            clauses.append("contains(regexp_replace(translate(lower(concat_ws(' ',name_ar,name_en)),'أإآةىؤئ','اااهيوي'),'[ً-ْـ]','','g'),?)");params.append(keyword)
        if f.get('branches_only'):clauses.append('coalesce(b.n,0)>=2')
        if f.get('contact')=='whatsapp':
            clauses.append("has_whatsapp=true and regexp_matches(regexp_replace(coalesce(phone_norm,''),'[^0-9]','','g'), '^(9665[0-9]{8}|009665[0-9]{8}|05[0-9]{8}|5[0-9]{8})$')")
        if f.get('contact')=='email':clauses.append("length(trim(coalesce(email,'')))>0")
        for bound in [f.get('bounds'),bounds]:
            if bound:
                clauses.append('longitude>=? and latitude>=? and longitude<? and latitude<?');params.extend(bound)
        base="from read_parquet(?) p left join branches b on lower(trim(p.brand_name))=b.brand where "+' and '.join(clauses)
        return base,params
    def browse(self,city,filters,limit=30,offset=0):
        if type(limit) is not int or not 1<=limit<=200 or type(offset) is not int or offset<0:raise ValueError('invalid pagination')
        f=valid_filters(filters);base,params=self.sql(city,f)
        with self.lock:
            total,located=self.db.execute("select count(*),count(*) filter(where coalesce(location_precision,'point')='point' and longitude between -180 and 180 and latitude between -85.05112878 and 85.05112878) "+base,params).fetchone()
            cursor=self.db.execute("select poi_key,name_ar,name_en,category,category_ar,secondary_category,category_l3,city_en,region_en,region_ar,district_ar,district_en,latitude,longitude,coalesce(location_precision,'point') location_precision,phone_norm as phone,phone_kind,has_whatsapp,email,sources,source_count,legal_name,company_status,lifecycle_state,coalesce(b.n,0) registered_location_count "+base+' order by completeness_pct desc,poi_key limit ? offset ?',params+[limit,offset])
            names=[d[0] for d in cursor.description];rows=[dict(zip(names,row)) for row in cursor.fetchall()]
        for row in rows:
            row['status_class']=status_policy.normalize(row.pop('company_status'),row.pop('lifecycle_state'))['status_normalized']
            row.update(category_main=main_category(row['category']),subcategories=subcategories(row['secondary_category'],row['category_l3']),entity_type=entity_kind(row.get('legal_name'),row.get('name_ar') or row.get('name_en')),reason='نتيجة من التصنيف المسجل؛ ليست توصية شراء أو طلبًا مؤكدًا')
        return {'rows':rows,'total':total,'located_total':located,'offset':offset,'has_more':offset+len(rows)<total,'next_offset':offset+len(rows) if offset+len(rows)<total else None,'map_query':self.register(city=city,filters=f),'parsed':{'city':city},'with_whatsapp':sum(has_usable_whatsapp(r) for r in rows),'with_email':sum(bool(r.get('email')) for r in rows),'by_region':[]}
    def profile(self,key,poi_key):
        with self.lock:
            _,rows,city,f=self.context(key)
            if rows is not None:
                return next((r for r in rows if r['poi_key']==poi_key),None)
            base,params=self.sql(city,f)
            cursor=self.db.execute('select p.* '+base+' and poi_key=? limit 1',params+[poi_key]);names=[d[0] for d in cursor.description];values=cursor.fetchone()
            if not values:return None
            row=dict(zip(names,values));row['phone']=row.pop('phone_norm',None);row['status_class']=status_policy.normalize(row.pop('company_status',None),row.pop('lifecycle_state',None))['status_normalized'];row['registered_location_count']=self.branch_counts.get((row.get('brand_name') or '').strip().lower(),0)
            row.update(category_main=main_category(row['category']),subcategories=subcategories(row['secondary_category'],row['category_l3']),entity_type=entity_kind(row.get('legal_name'),row.get('name_ar') or row.get('name_en')))
            return row
    def tile(self,key,z,x,y):
        if not 0<=z<=20 or not 0<=x<2**z or not 0<=y<2**z:raise ValueError('invalid tile')
        cache_key=(key,z,x,y)
        with self.lock:
            _,rows,city,f=self.context(key)
            if cache_key in self.tiles:self.tiles.move_to_end(cache_key);return self.tiles[cache_key]
            size=2**z;west=x/size*360-180;east=(x+1)/size*360-180
            north=math.degrees(math.atan(math.sinh(math.pi*(1-2*y/size))));south=math.degrees(math.atan(math.sinh(math.pi*(1-2*(y+1)/size))))
            if rows is not None:
                points=[(r['poi_key'],r.get('name_ar') or r.get('name_en') or '',r['longitude'],r['latitude']) for r in rows if is_precise_point(r) and west<=r['longitude']<east and south<=r['latitude']<north]
            else:
                base,params=self.sql(city,f,[west,south,east,north])
                grid=1024 if z<12 else 512 if z<16 else 1
                px=f'((longitude+180)/360*{size}-{x})*4096'
                py=f'((1-asinh(tan(radians(latitude)))/pi())/2*{size}-{y})*4096'
                grouped=self.db.execute(f"select floor(({px})/{grid}),floor(({py})/{grid}),avg({px}),avg({py}),count(*),first(poi_key),first(coalesce(name_ar,name_en)) "+base+" and coalesce(location_precision,'point')='point' and latitude between -85.05112878 and 85.05112878 group by 1,2",params).fetchall()
                points=[]
            cells={};grid=1024 if z<12 else 512 if z<16 else 1
            for poi,name,lon,lat in points:
                if not -85.05112878<=lat<=85.05112878:continue
                px=((lon+180)/360*size-x)*4096;py=((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*size-y)*4096
                cell=(int(px//grid),int(py//grid));entry=cells.setdefault(cell,{'px':0,'py':0,'count':0,'key':poi,'name':name});entry['px']+=px;entry['py']+=py;entry['count']+=1
            if rows is None:
                cells={(cx,cy):{'px':px*n,'py':py*n,'count':n,'key':poi,'name':name} for cx,cy,px,py,n,poi,name in grouped}
            features=[{'geometry':{'type':'Point','coordinates':[r['px']/r['count'],r['py']/r['count']]},'properties':{'key':r['key'] if r['count']==1 else '', 'name':r['name'] if r['count']==1 else str(r['count'])+' مواقع','count':r['count']}} for r in cells.values()]
            data=mapbox_vector_tile.encode({'name':'businesses','features':features},default_options={'y_coord_down':True,'extents':4096})
            self.tiles[cache_key]=data
            while len(self.tiles)>128 or sum(len(v) for v in self.tiles.values())>32*1024*1024:self.tiles.popitem(last=False)
            return data
