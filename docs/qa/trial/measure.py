import json, pathlib, sys, time, urllib.request, urllib.error
origin=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5232'
queries=['كرسي انتظار للعيادة','حبوب قهوة للمكتب','مياه شرب للموظفين','مستلزمات طبية للعيادة','مواد غذائية للمطعم','معدات صناعية للمصنع','أسلاك كهربائية','كمبيوتر للموظفين']
proof=[]
for q in queries:
    request=urllib.request.Request(origin+'/_trial/search',data=json.dumps({'q':q,'city':'Riyadh'}).encode(),headers={'Content-Type':'application/json'})
    start=time.perf_counter()
    with urllib.request.urlopen(request,timeout=20) as r:
        data=json.loads(r.read());status=r.status
    elapsed=round(time.perf_counter()-start,3)
    rows=data.get('suppliers',[])
    assert status==200 and len(rows)==10,(q,status,len(rows))
    assert all(set(s)<= {'name','category','district','match','fit','reason'} for s in rows),'private fields leaked'
    assert len({(s['name'],s['district']) for s in rows})==len(rows),'duplicates'
    assert not any('كرسي أريكة' in s['name'] for s in rows),'known lookalike'
    proof.append({'query':q,'status':status,'seconds':elapsed,'visible':len(rows),'additional':data['additional'],'intent':data.get('intent'),'names':[s['name'] for s in rows]})
    print(json.dumps({'query':q,'seconds':elapsed,'visible':len(rows),'additional':data['additional']},ensure_ascii=False),flush=True)
for path,method,expect in [('/_api/requests','GET',401),('/_trial/send','POST',404)]:
    try:
        urllib.request.urlopen(urllib.request.Request(origin+path,data=b'{}' if method=='POST' else None,method=method),timeout=10)
        raise AssertionError('unexpected allowed route')
    except urllib.error.HTTPError as e:assert e.code==expect,(path,e.code)
name='production-benchmark.json' if origin.startswith('https:') else 'local-http-benchmark.json'
pathlib.Path(__file__).with_name(name).write_text(json.dumps({'origin':origin,'time':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'queries':proof,'protectedAPI':401,'sendUnavailable':404},ensure_ascii=False,indent=2))
