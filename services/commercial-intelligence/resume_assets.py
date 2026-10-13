"""Resume metadata inventory with per-directory process isolation and timeouts."""
import argparse,ast,json,os,subprocess,sys,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

def scan_one(directory,original):
 tree=ast.parse(Path(original).read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='scan')
 scope={'os':os,'Path':Path,'skip':{'node_modules','.venv','venv','__pycache__','Library','npm-cache','cache'},'extensions':{'.parquet','.csv','.jsonl','.sqlite','.sqlite3','.db','.gpkg','.geojson','.shp','.zip','.7z','.tar','.gz','.xlsx','.qgs','.kml','.kmz','.json'}}
 exec(compile(ast.Module(body=[fn],type_ignores=[]),str(original),'exec'),scope)
 children,files,error=scope['scan'](directory);return {'children':children,'files':files,'error':error}
def resume(root,original,seconds):
 root=Path(root);sp=root/'inventory-state.json';state=json.loads(sp.read_text());seen=set(state['visited']);deadline=time.monotonic()+seconds;timed=[]
 def isolated(directory):
  process=subprocess.Popen([sys.executable,__file__,'--directory',directory,'--original',original],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
  try:return json.loads(process.communicate(timeout=8)[0])
  except subprocess.TimeoutExpired:
   process.kill() # Never wait on uninterruptible source I/O.
   return {'children':[],'files':[],'error':'READ_TIMEOUT_CHECKPOINT_RETAINED'}
  except (ValueError,OSError):return {'children':[],'files':[],'error':'CHILD_SCAN_FAILED'}
 with ThreadPoolExecutor(max_workers=8) as pool:
  while state['queue'] and time.monotonic()<deadline:
   batch=[]
   while state['queue'] and len(batch)<8:
    name=state['queue'].pop(0)
    if name not in seen:batch.append(name)
   for name,result in zip(batch,pool.map(isolated,batch)):
    if result['error']=='READ_TIMEOUT_CHECKPOINT_RETAINED':timed.append(name);state.setdefault('deferred_timeouts',[]).append(name);state['errors'].append({'path':name,'error':result['error']});continue
    state['visited'].append(name);seen.add(name);state['queue'].extend(result['children'])
    if result['error']:state['errors'].append({'path':name,'error':result['error']})
    with (root/'business-asset-metadata.jsonl').open('a') as f:
     for row in result['files']:f.write(json.dumps(row,ensure_ascii=True)+'\n')
   tmp=sp.with_suffix('.resume.tmp');tmp.write_text(json.dumps(state,ensure_ascii=True,indent=2));tmp.replace(sp)
 state['queue'].extend(timed);state['deferred_timeouts']=[];sp.write_text(json.dumps(state,ensure_ascii=True,indent=2));print({'visited':len(state['visited']),'pending':len(state['queue']),'timed_out_paths':len(timed),'content_read':False})
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--directory');p.add_argument('--root');p.add_argument('--original',required=True);p.add_argument('--seconds',type=int,default=45);a=p.parse_args()
 if a.directory:print(json.dumps(scan_one(a.directory,a.original),ensure_ascii=True))
 else:resume(a.root,a.original,a.seconds)
