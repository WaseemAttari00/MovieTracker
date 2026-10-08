#!/usr/bin/env sh
# Start MovieTracker on macOS / Linux. The first run sets everything up.
set -e
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "Setting up MovieTracker for the first time..."
  python3 -m venv .venv
fi
if ! cmp -s requirements.txt .venv/installed-requirements.txt; then
  echo "Installing dependencies..."
  .venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.txt
  cp requirements.txt .venv/installed-requirements.txt
fi
exec .venv/bin/python run.py "$@"
