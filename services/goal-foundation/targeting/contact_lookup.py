"""Bounded Google Places lookup for existing directory rows. No writes or messaging."""
import json
import math
import os
import re
import urllib.request
from trial_search import norm

def distance_km(a,b,c,d):
    a,b,c,d=map(math.radians,[a,b,c,d])
    h=math.sin((c-a)/2)**2+math.cos(a)*math.cos(c)*math.sin((d-b)/2)**2
    return 6371*2*math.asin(min(1,math.sqrt(h)))

def verified_phone(row, place):
    names=[norm(row.get('name_ar')),norm(row.get('name_en'))]
    name=norm(place.get('displayName',{}).get('text'))
    # Require the full business name, not just its activity or a similar name.
    if not name or name not in [n for n in names if n]: return None
    location=place.get('location',{})
    coords=[row.get('latitude'),row.get('longitude'),location.get('latitude'),location.get('longitude')]
    if not all(isinstance(x,(int,float)) for x in coords) or distance_km(*coords)>2: return None
    if place.get('businessStatus')=='CLOSED_PERMANENTLY': return None
    digits=re.sub(r'\D','',place.get('internationalPhoneNumber') or '')
    if not re.fullmatch(r'966[12589]\d{8}',digits): return None
    source=place.get('googleMapsUri','')
    if not source.startswith(('https://maps.google.com/','https://www.google.com/maps/','https://maps.google.com?')): return None
    return {'phone':digits,'phone_source':source,'phone_source_name':'Google Maps','whatsapp_verified':False}

def enrich(rows):
    key=os.environ.get('GOOGLE_PLACES_API_KEY')
    if not key: return rows, 'not_configured'
    out=[]; calls=0
    for row in rows:
        row=dict(row)
        if row.get('phone') or calls>=3:
            out.append(row); continue
        calls+=1
        query=' '.join(str(row.get(k) or '') for k in ['name_ar','city_en','district_ar'])
        request=urllib.request.Request('https://places.googleapis.com/v1/places:searchText',data=json.dumps({'textQuery':query,'languageCode':'ar','regionCode':'SA','pageSize':3}).encode(),headers={'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.displayName,places.location,places.internationalPhoneNumber,places.googleMapsUri,places.businessStatus'})
        try:
            with urllib.request.urlopen(request,timeout=4) as response: places=json.loads(response.read(32000)).get('places',[])
            matches=[value for place in places if (value:=verified_phone(row,place))]
            if len(matches)==1:
                row.update(matches[0]); row['has_whatsapp']=False
                row['phone_kind']='mobile' if row['phone'].startswith('9665') else 'landline'
                row['phone_lookup']='found'
            else: row['phone_lookup']='unverified'
        except Exception: row['phone_lookup']='unavailable'
        out.append(row)
    return out,'enabled'
