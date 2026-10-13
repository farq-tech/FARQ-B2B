"""Local-only shared endpoint for Pricing/Construction; disabled unless explicit flag."""
import argparse,json,os
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from core import Knowledge,CpoPort

def handler(knowledge,enabled=False):
    class H(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def reply(self,status,data):
            body=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_POST(self):
            if not enabled:return self.reply(404,{'error':'FEATURE_DISABLED'})
            if self.path not in ['/commercial/discover','/construction/discover','/commercial/coverage']:return self.reply(404,{'error':'NOT_FOUND'})
            # This service is loopback only; untrusted production auth headers are not accepted.
            actor=self.headers.get('X-Local-Review-Actor')
            if not actor or not actor.startswith('local-review:'):return self.reply(401,{'error':'LOCAL_REVIEW_ACTOR_REQUIRED'})
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 1<=size<=16384:raise ValueError('INVALID_BODY_SIZE')
                body=json.loads(self.rfile.read(size))
                if self.path=='/commercial/coverage':
                    from coverage import coverage
                    return self.reply(200,coverage(knowledge))
                result=knowledge.search(body.get('text'),body.get('direction','purchase'),body.get('city',''),actor,body.get('limit',10),body.get('proven_only',False),body.get('offset',0));self.reply(200,result)
            except (ValueError,TypeError,json.JSONDecodeError) as e:self.reply(400,{'error':str(e)})
            except Exception:self.reply(500,{'error':'LOCAL_RETRIEVAL_FAILED'})
        def do_GET(self):self.reply(200,{'enabled':enabled,'execution_enabled':False})
    return H

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--node',required=True);p.add_argument('--construction-source',required=True);p.add_argument('--port',type=int,default=8767);a=p.parse_args()
    port=CpoPort(a.node,a.construction_source);k=Knowledge(a.db,port)
    server=ThreadingHTTPServer(('127.0.0.1',a.port),handler(k,os.environ.get('FARQ_COMMERCIAL_INTELLIGENCE')=='1' and os.environ.get('NODE_ENV')!='production'))
    try:server.serve_forever()
    finally:port.close()
