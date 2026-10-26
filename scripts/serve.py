#!/usr/bin/env python3
"""Serves the site for local development with caching turned off, so the
browser always loads the latest code after a refresh. (python3 -m http.server
lets browsers reuse old copies of the JS modules.)

Usage: python3 scripts/serve.py [port]   (default 8000)
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
	def end_headers(self):
		self.send_header("Cache-Control", "no-store")
		super().end_headers()


def main():
	port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
	handler = functools.partial(NoCacheHandler, directory=str(ROOT))
	with http.server.ThreadingHTTPServer(("", port), handler) as server:
		print(f"Serving {ROOT} at http://localhost:{port} (no caching). Ctrl+C to stop.")
		try:
			server.serve_forever()
		except KeyboardInterrupt:
			pass


if __name__ == "__main__":
	main()
