#!/usr/bin/env bash
# Wimym in one command: check what it needs, build the page, start the engine, open the browser.
#
#   ./install.sh                 # the first time, and any time after: it only redoes what changed
#   ./install.sh --port 8990     # another port (default 8990, or $WIMYM_PORT)
#   ./install.sh --link          # also put the `wimym` command in ~/.local/bin (it asks otherwise)
#   ./install.sh --no-link       # don't ask
#   ./install.sh --no-open       # don't open the browser
#   ./install.sh --stop          # stop the engine this script started
#   ./install.sh --demo          # show Robin, a made-up person, on port 8997: none of your data is read
#
# It writes only inside this folder (app/node_modules, app/dist), in ~/.wimym (what you enter) and
# ~/.cache/wimym (the index; WIMYM_DATA and WIMYM_CACHE move them), and in ~/.local/bin if you say yes.
# No sudo. Wimym reads your Claude Code transcripts where they are and sends nothing anywhere.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
port="${WIMYM_PORT:-8990}"
link="ask"
open_it=1
stop=0
demo=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="$2"; shift ;;
    --port=*) port="${1#*=}" ;;
    --link) link="yes" ;;
    --no-link) link="no" ;;
    --no-open) open_it=0 ;;
    --stop) stop=1 ;;
    --demo) demo=1 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see ./install.sh --help)"; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
fail() { printf 'Stopped: %s\n' "$*" >&2; exit 1; }

cache="${WIMYM_CACHE:-${MIRROR_CACHE:-$HOME/.cache/wimym}}"
if [ "$demo" = 1 ]; then  # the demo keeps its own made-up home, data and cache, and its own port
  cache="${WIMYM_DEMO:-$HOME/.cache/wimym-demo}"
  [ -n "${WIMYM_PORT:-}" ] || port=8997
  link="no"
fi
pidfile="$cache/engine.pid"
url="http://127.0.0.1:$port/"

if [ "$stop" = 1 ]; then
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  # only if that process is still our engine: a pid can be reused by something else after a restart
  if [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -q "engine/server.py" && kill "$pid" 2>/dev/null; then
    rm -f "$pidfile"; say "Wimym stopped."
  else
    say "No engine started by this script is running."
  fi
  exit 0
fi

# --- Python, 3.9 or later: the engine (standard library only)
command -v python3 >/dev/null 2>&1 || fail "Wimym needs Python 3.9 or later. Install it from python.org, then run this again."
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
  || fail "Wimym needs Python 3.9 or later; this one is $(python3 -V 2>&1). Install a newer one from python.org."

# --- Claude Code's transcripts: what Wimym reads
projects="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
if [ "$demo" = 0 ] && [ ! -d "$projects" ]; then
  say "No Claude Code transcripts found in $projects yet. Wimym will start, and fill in once you've used Claude Code."
fi

# --- the page: build it when it's missing or older than its sources (needs Node.js 18 or later)
dist="$here/app/dist/index.html"
stale=0
if [ ! -f "$dist" ]; then
  stale=1
elif [ -n "$(find "$here/app/src" "$here/app/public" "$here/app/index.html" "$here/app/package.json" "$here/app/vite.config.ts" \
              "$here/lab/hero" "$here/lab/src" -newer "$dist" -type f 2>/dev/null | head -1)" ]; then
  stale=1
fi
if [ "$stale" = 1 ]; then
  if ! command -v npm >/dev/null 2>&1; then
    [ -f "$dist" ] && say "The page is older than its code, and npm isn't here to rebuild it: using the old one." \
      || fail "Building the page needs Node.js 18 or later (nodejs.org, or 'brew install node'). Then run this again."
  else
    node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' \
      || fail "Building the page needs Node.js 18 or later; this one is $(node -v)."
    # the page takes its planet from lab/, whose own packages its type check reads
    for dir in "$here/lab" "$here/app"; do
      [ -f "$dir/package.json" ] || continue
      cd "$dir"
      if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
        say "Installing the page's packages in ${dir#$here/} (once, about a minute)…"
        npm install --no-audit --no-fund --no-update-notifier --loglevel=error
      fi
    done
    cd "$here/app"
    say "Building the page…"
    mkdir -p "$cache"
    npm run build --silent > "$cache/build.log" 2>&1 || fail "The page didn't build; what went wrong is in $cache/build.log"
    cd "$here"
  fi
else
  say "The page is up to date."
fi

# --- the wimym command, for asking your own record questions in any terminal (optional)
bin="$HOME/.local/bin"
if [ "$link" = "ask" ] && [ -t 0 ] && [ ! -e "$bin/wimym" ]; then
  printf 'Put the wimym command in %s, so you can ask your record questions from any terminal? [y/N] ' "$bin"
  read -r answer || answer=""
  case "$answer" in [yY]*) link="yes" ;; *) link="no" ;; esac
fi
if [ "$link" = "yes" ]; then
  mkdir -p "$bin"
  ln -sf "$here/bin/wimym" "$bin/wimym"
  say "Linked $bin/wimym."
  case ":$PATH:" in *":$bin:"*) ;; *) say "Add $bin to your PATH to use it: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc" ;; esac
fi

# --- the engine: start it unless it's already running on this port
answers() {
  python3 - "$port" <<'PY'
import json, sys, urllib.request
try:
    with urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/api/state", timeout=2) as r:
        sys.exit(0 if "state" in json.load(r) else 1)
except Exception:
    sys.exit(1)
PY
}
if answers; then
  say "Wimym is already running."
else
  python3 - "$port" <<'PY' || fail "Port $port is taken by something else. Try ./install.sh --port 8991"
import socket, sys
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # as the server does: a just-closed port is free
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(1)
PY
  mkdir -p "$cache"
  if [ "$demo" = 1 ]; then
    say "Writing the demo person (a few seconds, once a day)…"
    nohup python3 "$here/engine/server.py" --demo --no-open --port "$port" >> "$cache/engine.log" 2>&1 &
  else
    nohup python3 "$here/engine/server.py" --no-open --port "$port" >> "$cache/engine.log" 2>&1 &
  fi
  echo $! > "$pidfile"
  for _ in $(seq 1 150); do answers && break; sleep 0.2; done
  answers || fail "The engine didn't start. Its log: $cache/engine.log"
  if [ "$demo" = 1 ]; then
    say "The demo is running (stop it with ./install.sh --demo --stop): Robin is made up, and none of your data is read."
  else
    say "Wimym is running (stop it with ./install.sh --stop). It reads your transcripts now; the page shows how far it is."
  fi
fi

say "$url"
if [ "$open_it" = 1 ]; then
  if command -v open >/dev/null 2>&1; then open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 &
  fi
fi
