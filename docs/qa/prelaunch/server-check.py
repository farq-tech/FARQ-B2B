import importlib.util, pathlib, http.client, threading, urllib.parse, hashlib
spec=importlib.util.spec_from_file_location('audit_server', 'server.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.PASSWORD='audit';m.TOKEN=hashlib.sha256(b'audit').hexdigest()[:32]
s=m.ThreadingHTTPServer(('127.0.0.1',0),m.H);threading.Thread(target=s.serve_forever,daemon=True).start()
def get(path,cookie=''):
 c=http.client.HTTPConnection('127.0.0.1',s.server_port);c.request('GET',path,headers={'Cookie':cookie});r=c.getresponse();data=r.read();return r.status,dict(r.getheaders()),data
assert get('/_api/private')[0]==401
assert get('/_api/private','wrong_fp_gate='+m.TOKEN)[0]==401
assert get('/_api/private','fp_gate='+m.TOKEN+'bad')[0]==401
assert get('/')[0]==200
_,_,gate=get('/__gate');assert b'label for="gate-password"' in gate and b'name="viewport"' in gate
c=http.client.HTTPConnection('127.0.0.1',s.server_port);c.request('POST','/__gate?next=https://evil.test',urllib.parse.urlencode({'p':'audit'}),{'Content-Type':'application/x-www-form-urlencoded'});r=c.getresponse();r.read();assert r.getheader('Location')=='/requests';assert 'Secure' in r.getheader('Set-Cookie')
print('PASS: public landing, unauthenticated API, exact cookie parsing (2 bypass cases), gate label/viewport, external redirect blocked, Secure cookie');s.shutdown()
