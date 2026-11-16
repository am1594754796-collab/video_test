"""Read-only public scoreboard for a temporary Cloudflare tunnel."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SCORES = Path(__file__).resolve().parent / "data" / "classroom_scores.json"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/scoreboard.html")
            self.end_headers()
            return
        if path == "/api/classroom-scores":
            try:
                body = SCORES.read_bytes()
            except FileNotFoundError:
                body = json.dumps({"scores": {str(i): 0 for i in range(1, 7)}, "names": {}, "flashing": None}).encode()
            self.respond(body, "application/json; charset=utf-8")
            return
        if path == "/scoreboard.html":
            file = DIST / "scoreboard.html"
            content_type = "text/html; charset=utf-8"
        elif (path.startswith("/assets/")
              and Path(path).name.startswith(("scoreboard-", "classroomBus-"))
              and not Path(path).name.startswith("scoreboard-admin-")):
            file = DIST / path.lstrip("/")
            content_type = "text/css" if file.suffix == ".css" else "text/javascript; charset=utf-8"
        else:
            self.send_error(404)
            return
        if not file.is_file():
            self.send_error(404)
            return
        self.respond(file.read_bytes(), content_type)

    def respond(self, body: bytes, content_type: str):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8002), Handler).serve_forever()
