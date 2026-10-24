#!/usr/bin/env bash
# Wimym in one command: check what it needs, build the page, start the engine, open the browser.
#
#   ./install.sh                 # the first time, and any time after: it only redoes what changed
#   ./install.sh --update        # the latest Wimym: pull it, say what's new, rebuild and restart onto it
#   ./install.sh --port 8990     # another port (default 8990, or $WIMYM_PORT)
#   ./install.sh --link          # also put the `wimym` command in ~/.local/bin (it asks otherwise)
#   ./install.sh --no-link       # don't ask
#   ./install.sh --no-open       # don't open the browser
#   ./install.sh --stop          # stop the engine this script started
#   ./install.sh --demo          # show Robin, a made-up person, on port 8997 (or --port): none of your data is read
#
# It writes only inside this folder (app/node_modules, app/dist), in ~/.wimym (what you enter) and
# ~/.cache/wimym (the index; WIMYM_DATA and WIMYM_CACHE move them), and in ~/.local/bin if you say yes.
# No sudo. Wimym reads your Claude Code transcripts where they are and sends nothing of yours anywhere. Once a
# day it asks GitHub whether a newer Wimym is out; {"updates": false} in ~/.wimym/settings.json turns that off.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
port="${WIMYM_PORT:-8990}"
port_given=0
update=0
args=("$@")
link="ask"
open_it=1
stop=0
demo=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="$2"; port_given=1; shift ;;
    --port=*) port="${1#*=}"; port_given=1 ;;
    --update) update=1 ;;
    --link) link="yes" ;;
    --no-link) link="no" ;;
    --no-open) open_it=0 ;;
    --stop) stop=1 ;;
    --demo) demo=1 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see ./install.sh --help)"; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
fail() { printf 'Stopped: %s\n' "$*" >&2; exit 1; }

cache="${WIMYM_CACHE:-${MIRROR_CACHE:-$HOME/.cache/wimym}}"
if [ "$demo" = 1 ]; then  # the demo keeps its own made-up home, data and cache, and its own port
  cache="${WIMYM_DEMO:-$HOME/.cache/wimym-demo}"
  [ "$port_given" = 1 ] || [ -n "${WIMYM_PORT:-}" ] || port=8997
  link="no"
fi
pidfile="$cache/engine.pid"
url="http://127.0.0.1:$port/"

# the engine this script started, while it still is that engine: a pid can be reused by something else after a restart
ours() {
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -q "engine/server.py"
}
stop_engine() {
  ours && kill "$pid" 2>/dev/null || return 1
  for _ in $(seq 1 50); do ps -p "$pid" >/dev/null 2>&1 || break; sleep 0.1; done
  rm -f "$pidfile"
}

if [ "$stop" = 1 ]; then
  if stop_engine; then say "Wimym stopped."; else say "No engine started by this script is running."; fi
  exit 0
fi

# --- --update: the latest code, then the rest of this script as the new code has it
if [ "$update" = 1 ]; then
  git -C "$here" rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1 \
    || fail "This folder isn't a clone of Wimym's repository, so there is nothing to update it from."
  [ -z "$(git -C "$here" status --porcelain --untracked-files=no)" ] \
    || fail "This folder has changes of its own (git -C \"$here\" status lists them): put them aside, then run this again."
  before="$(git -C "$here" rev-parse HEAD)"
  say "Fetching the latest Wimym…"
  git -C "$here" pull --ff-only --quiet || fail "The update didn't come through; what git said is above."
  if [ "$(git -C "$here" rev-parse HEAD)" = "$before" ]; then
    say "This is already the latest Wimym."
  else
    # what landed on main, a line each: a pull request by its title, a merge by its sentence without the branch,
    # an old "Wimym as of …" copy by the lines it listed; merges of main into a branch are nothing to tell
    news="$(git -C "$here" log --first-parent --format='%x1e%s%x1f%b' "$before..HEAD" | awk '
      BEGIN { RS = "\036"; FS = "\037" }
      NF == 0 { next }
      { s = $1; n = split($2, body, "\n") }
      s ~ /^Wimym as of / { for (i = 1; i <= n; i++) if (body[i] ~ /^- /) print "  " body[i]; next }
      s ~ /^Merge pull request / { for (i = 1; i <= n; i++) if (body[i] != "") { s = body[i]; break } }
      s ~ /^Merge (branch|remote-tracking branch) / { next }
      { sub(/^Merge /, "", s); sub(/ \([^() ]*\/[^() ]*\)$/, "", s); sub(/ \(#[0-9]+\)$/, "", s)
        print "  - " toupper(substr(s, 1, 1)) substr(s, 2) }' | head -30)"
    say "What's new:"
    say "${news:-  - Small fixes.}"
  fi
  rest=()
  for a in ${args[@]+"${args[@]}"}; do [ "$a" = "--update" ] || rest+=("$a"); done
  exec "$here/install.sh" ${rest[@]+"${rest[@]}"}  # the pull may have changed this script: the new one goes on
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
        npm ci --no-audit --no-fund --no-update-notifier --loglevel=error  # as the lock file says, and never rewrites it
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
# an engine started before this folder's code changed (an update, a pull) is restarted onto the new code
if answers && ours && [ -n "$(find "$here/engine" -name '*.py' -newer "$pidfile" 2>/dev/null | head -1)" ]; then
  say "Restarting Wimym on the new code…"
  stop_engine || true
fi
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
