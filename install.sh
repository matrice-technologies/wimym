#!/bin/sh
# Wimym in one command: install.py does the work, on macOS, Linux and Windows alike (./install.sh --help).
# This finds Python 3 for it; install.cmd does the same on Windows.
here="$(cd "$(dirname "$0")" && pwd)"
for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1 && "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    exec "$py" "$here/install.py" "$@"
  fi
done
if command -v py >/dev/null 2>&1; then exec py -3 "$here/install.py" "$@"; fi  # Git Bash on Windows
echo "Stopped: Wimym needs Python 3.9 or later. Install it from python.org, then run this again." >&2
exit 1
