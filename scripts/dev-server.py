#!/usr/bin/env python3
"""Frontend dev server for nac-web, no Rust toolchain required.

Serves `crates/nac-server/assets` from disk with caching disabled and proxies
every other request to a running `nac-web`, so the API stays real while frontend
edits land on reload. Speaks the same `/__dev/*` protocol as `nac-web --dev`, so
the browser dev client (live reload + locator overlay) behaves identically.

    nac-web --bind 127.0.0.1:3210            # the real API, in another terminal
    python3 scripts/dev-server.py            # http://127.0.0.1:3211

Requests are same-origin, so no CORS setup and no changes to services/api.js.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEV_CLIENT_TAG = '<script type="module" src="/assets/app/dev/dev-client.js"></script>'
POLL_SECONDS = 0.25
KEEP_ALIVE_SECONDS = 15.0
PROXY_CHUNK = 16 * 1024
# Vendored runtime and binary assets never change while iterating on the UI.
SKIP_DIRS = {"vendor", "fonts", "node_modules"}
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".png": "image/png",
    ".txt": "text/plain; charset=utf-8",
}
# Mirrors the Rust scanner: only top-level capitalised declarations.
DECLARATION = re.compile(
    r"^(?:export default function |export function |export const |function |const )"
    r"([A-Z][A-Za-z0-9_$]*)"
)


def content_type(path):
    return CONTENT_TYPES.get(Path(path).suffix, "application/octet-stream")


def workspace_relative_prefix(root):
    for ancestor in root.parents:
        if (ancestor / ".git").exists():
            return root.relative_to(ancestor).as_posix()
    return root.as_posix()


def walk_files(directory, root):
    for entry in sorted(os.scandir(directory), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            if entry.name in SKIP_DIRS:
                continue
            yield from walk_files(Path(entry.path), root)
        else:
            yield Path(entry.path).relative_to(root).as_posix()


def fingerprints(root):
    stamps = {}
    for relative in walk_files(root, root):
        try:
            stat = (root / relative).stat()
        except OSError:
            continue
        stamps[relative] = (stat.st_mtime_ns, stat.st_size)
    return stamps


def changed_paths(previous, current):
    changed = {path for path, stamp in current.items() if previous.get(path) != stamp}
    changed.update(path for path in previous if path not in current)
    return sorted(changed)


def scan_components(root):
    components = {}
    app = root / "app"
    if not app.is_dir():
        return components
    for relative in walk_files(app, root):
        if not relative.endswith(".js"):
            continue
        try:
            source = (root / relative).read_text(encoding="utf-8")
        except OSError:
            continue
        for offset, line in enumerate(source.splitlines()):
            match = DECLARATION.match(line)
            if match:
                components.setdefault(match.group(1), []).append(
                    {"file": relative, "line": offset + 1}
                )
    return components


def inject_dev_client(page):
    index = page.rfind("</body>")
    if index < 0:
        return page + "\n" + DEV_CLIENT_TAG + "\n"
    return page[:index] + "  " + DEV_CLIENT_TAG + "\n  " + page[index:]


class DevHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    root = Path(".")
    upstream = "http://127.0.0.1:3210"
    source_prefix = ""

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/app"):
            self.send_page("next.html")
        elif path == "/legacy":
            self.send_page("index.html")
        elif path == "/assets/app.css":
            self.send_asset("redesign.css")
        elif path.startswith("/assets/"):
            self.send_asset(path[len("/assets/") :])
        elif path == "/__dev/status":
            self.send_json(
                {
                    "server": "dev-server.py",
                    "root": str(self.root),
                    "source_prefix": self.source_prefix,
                }
            )
        elif path == "/__dev/components":
            self.send_json({"components": scan_components(self.root)})
        elif path == "/__dev/events":
            self.stream_changes()
        else:
            self.proxy()

    def do_POST(self):
        self.proxy()

    def do_PUT(self):
        self.proxy()

    def do_PATCH(self):
        self.proxy()

    def do_DELETE(self):
        self.proxy()

    # ---- static assets ----

    def resolve(self, relative):
        candidate = (self.root / relative).resolve()
        if not candidate.is_relative_to(self.root) or not candidate.is_file():
            return None
        return candidate

    def send_page(self, name):
        target = self.resolve(name)
        if target is None:
            self.send_error(404, "asset not found")
            return
        body = inject_dev_client(target.read_text(encoding="utf-8")).encode("utf-8")
        self.send_body(body, "text/html; charset=utf-8")

    def send_asset(self, relative):
        target = self.resolve(relative)
        if target is None:
            self.send_error(404, "asset not found")
            return
        self.send_body(target.read_bytes(), content_type(relative))

    def send_json(self, payload):
        self.send_body(json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

    def send_body(self, body, mime, status=200):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.write(body)

    # ---- live reload ----

    def stream_changes(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        previous = fingerprints(self.root)
        if not self.write(b"event: ready\ndata: {}\n\n"):
            return
        last_message = time.monotonic()
        while True:
            time.sleep(POLL_SECONDS)
            current = fingerprints(self.root)
            changed = changed_paths(previous, current)
            if changed:
                previous = current
                payload = json.dumps({"paths": changed})
                frame = "event: change\ndata: {}\n\n".format(payload).encode("utf-8")
            elif time.monotonic() - last_message > KEEP_ALIVE_SECONDS:
                frame = b": keep-alive\n\n"
            else:
                continue
            if not self.write(frame):
                return
            last_message = time.monotonic()

    # ---- API proxy ----

    def proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in HOP_BY_HOP and key.lower() != "host"
        }
        # urllib cannot transparently decode a gzip body, so ask for identity.
        headers["Accept-Encoding"] = "identity"
        request = urllib.request.Request(
            self.upstream + self.path, data=body, headers=headers, method=self.command
        )
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            response = error
        except OSError as error:
            # JSON, because the app surfaces the body verbatim in its error toast.
            self.send_body(
                json.dumps(
                    {"error": "dev proxy: {} unreachable: {}".format(self.upstream, error)}
                ).encode("utf-8"),
                "application/json; charset=utf-8",
                status=502,
            )
            return
        with response:
            self.send_response(getattr(response, "status", None) or response.code)
            # No Content-Length means a stream (SSE); frame it by closing the
            # connection once upstream is done.
            streaming = response.headers.get("Content-Length") is None
            for key, value in response.headers.items():
                if key.lower() in HOP_BY_HOP or key.lower() == "content-encoding":
                    continue
                self.send_header(key, value)
            if streaming:
                self.send_header("Connection", "close")
                self.close_connection = True
            self.end_headers()
            # read1 returns as soon as bytes are available, which is what keeps
            # proxied SSE streams flowing instead of buffering.
            read = getattr(response, "read1", None) or response.read
            while True:
                chunk = read(PROXY_CHUNK)
                if not chunk:
                    return
                if not self.write(chunk):
                    return

    # ---- plumbing ----

    def write(self, payload):
        try:
            self.wfile.write(payload)
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, ValueError):
            self.close_connection = True
            return False

    def log_message(self, fmt, *args):
        if self.path.startswith("/assets/") or self.path.startswith("/__dev/events"):
            return
        sys.stderr.write("dev-server: {}\n".format(fmt % args))


def main():
    default_root = Path(__file__).resolve().parent.parent / "crates" / "nac-server" / "assets"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3211)
    parser.add_argument(
        "--upstream",
        default="http://127.0.0.1:3210",
        help="running nac-web that serves the API",
    )
    parser.add_argument("--assets", type=Path, default=default_root)
    args = parser.parse_args()

    root = args.assets.resolve()
    if not (root / "next.html").is_file():
        parser.error("{} is not the nac-web asset root (next.html is missing)".format(root))

    DevHandler.root = root
    DevHandler.upstream = args.upstream.rstrip("/")
    DevHandler.source_prefix = workspace_relative_prefix(root)

    # Every SSE and proxied stream holds a thread for its whole lifetime.
    class Server(ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    server = Server((args.host, args.port), DevHandler)
    print("dev UI:  http://{}:{}".format(args.host, args.port))
    print("assets:  {}".format(root))
    print("API:     {} (proxied)".format(DevHandler.upstream))
    print("locator: hold Alt and hover, click copies file:line")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
