import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


UPSTREAM = os.environ.get("VALHALLA_UPSTREAM", "").rstrip("/")
TOKEN = os.environ.get("VALHALLA_GATEWAY_TOKEN", "")
PORT = int(os.environ.get("PORT", "8080"))
ALLOWED_ACTIONS = {"route", "optimized_route", "isochrone", "sources_to_targets"}
MAX_REQUEST_BYTES = 65536
MAX_RESPONSE_BYTES = 8 * 1024 * 1024

if not UPSTREAM or not TOKEN:
    raise SystemExit("VALHALLA_UPSTREAM and VALHALLA_GATEWAY_TOKEN are required")


class GatewayHandler(BaseHTTPRequestHandler):
    server_version = "FarqValhallaGateway"

    def log_message(self, _format, *_args):
        # Do not log auth headers, request bodies, or precise routing coordinates.
        return

    def respond(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self.respond(200, b'{"ok":true}')
            return
        self.respond(405, b'{"error":"method not allowed"}')

    def do_POST(self):
        action = self.path.removeprefix("/")
        if action not in ALLOWED_ACTIONS or "/" in action or "?" in action:
            self.respond(404, b'{"error":"not found"}')
            return

        expected = f"Bearer {TOKEN}"
        supplied = self.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, expected):
            self.respond(401, b'{"error":"unauthorized"}')
            return

        if self.headers.get_content_type() != "application/json":
            self.respond(415, b'{"error":"application/json required"}')
            return

        try:
            length = int(self.headers.get("content-length", "-1"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_REQUEST_BYTES:
            self.respond(413, b'{"error":"request body too large or missing"}')
            return

        body = self.rfile.read(length)
        try:
            json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.respond(400, b'{"error":"invalid JSON"}')
            return

        request = Request(
            f"{UPSTREAM}/{action}",
            data=body,
            headers={"accept": "application/json", "content-type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=25) as upstream_response:
                response_body = upstream_response.read(MAX_RESPONSE_BYTES + 1)
                if len(response_body) > MAX_RESPONSE_BYTES:
                    self.respond(502, b'{"error":"upstream response too large"}')
                    return
                self.respond(upstream_response.status, response_body)
        except HTTPError as error:
            response_body = error.read(MAX_RESPONSE_BYTES + 1)
            if len(response_body) > MAX_RESPONSE_BYTES:
                self.respond(502, b'{"error":"upstream response too large"}')
            else:
                self.respond(error.code, response_body)
        except (TimeoutError, URLError, OSError):
            self.respond(502, b'{"error":"routing service unavailable"}')


class GatewayServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    GatewayServer(("0.0.0.0", PORT), GatewayHandler).serve_forever()
