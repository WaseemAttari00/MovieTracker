"""Start MovieTracker and open it in your browser.

    python run.py               # http://127.0.0.1:8765
    python run.py --port 9000
    python run.py --no-browser
"""
import argparse
import json
import logging
import os
import sys
import threading
import time
import urllib.request
import webbrowser

HOST = "127.0.0.1"  # only reachable from this computer


def is_running(url):
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=1) as resp:
            return json.load(resp).get("app") == "MovieTracker"
    except Exception:
        return False


def open_when_ready(url):
    for _ in range(60):
        if is_running(url):
            webbrowser.open(url)
            return
        time.sleep(0.25)


def main():
    parser = argparse.ArgumentParser(description="Run MovieTracker on this computer.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("MOVIETRACKER_PORT", 8765)))
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()
    url = f"http://{HOST}:{args.port}"

    if is_running(url):
        print(f"MovieTracker is already running at {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return

    try:
        import uvicorn
        from backend.main import app
    except ImportError as exc:
        sys.exit(f"Missing dependency ({exc.name}). Run:  python -m pip install -r requirements.txt")

    if not args.no_browser:
        threading.Thread(target=open_when_ready, args=(url,), daemon=True).start()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    print(f"MovieTracker is running at {url}  (press Ctrl+C to stop)")
    uvicorn.run(app, host=HOST, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
