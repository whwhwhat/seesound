from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def serve_web_preview(host: str = "127.0.0.1", port: int = 8765) -> None:
    web_root = Path(__file__).resolve().parents[2] / "web"
    if not web_root.exists():
        raise FileNotFoundError(f"Web preview directory not found: {web_root}")

    handler = partial(SimpleHTTPRequestHandler, directory=str(web_root))
    server = ThreadingHTTPServer((host, port), handler)
    url = f"http://{host}:{port}"
    print(f"Serving Web preview at {url}")
    print(f"Static root: {web_root}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping preview server.")
    finally:
        server.server_close()
