"""Build the demo for the public page: the app on Robin's record at wimym.matricetechnologies.com/demo, from the demo
engine only.

    ./install.sh --demo --no-open
    python3 lab/site/export-demo.py             # reads 127.0.0.1:8997, writes site/demo/

Builds the app in its demo mode (npm --prefix app run build:demo, app/src/lib/demo.ts) into site/demo, then saves what
every page asks the engine for under site/demo/api/, where the demo build reads it: /api/core as api/core.json,
/api/week?start=X as api/week/start=X.json, and the messages one by one in 64 files by a hash of their id.

Refuses any engine that isn't the demo (every project must be one of Robin's, engine/wimym/demo.py), and writes
nothing it finds a path of this computer in. Checks that the days the public page frames are in the record.
"""
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "engine"))
from wimym.demo import PROJECTS  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8997"
OUT = os.path.join(ROOT, "site", "demo")
SHARDS = 64  # app/src/lib/demo.ts


def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.load(r)


def shard(mid):
    """FNV-1a, as app/src/lib/demo.ts shard()."""
    h = 0x811C9DC5
    for ch in mid:
        h = ((h ^ ord(ch)) * 0x01000193) & 0xFFFFFFFF
    return h % SHARDS


msgs = get("/api/messages")["messages"]
strangers = {m["project"] for m in msgs if m.get("project")} - set(PROJECTS)
if strangers or not msgs:
    sys.exit(f"Not the demo engine at {BASE}: {len(strangers)} projects that aren't Robin's. Nothing written.")

npm = shutil.which("npm") or sys.exit("npm isn't on the PATH: the demo build needs it.")
subprocess.run([npm, "--prefix", os.path.join(ROOT, "app"), "run", "build:demo"], check=True)

files = {}  # path under api/ -> what to write
core, vitals = get("/api/core"), get("/api/vitals")
state = get("/api/state")
state.pop("update", None)  # how this computer would update: a command with its paths
files["state"] = state
files["core"], files["vitals"], files["messages"] = core, vitals, {"messages": msgs}
for path in ["points", "points?ids=1", "week", "sessions", "labels", "practices", "rules", "git"]:
    files[path] = get("/api/" + path)
weeks = sorted(set(vitals.get("weeks") or []) | {w["week"] for w in core.get("weeks", []) if isinstance(w, dict) and w.get("week")})
for w in weeks:
    try:
        files[f"week?start={w}"] = get(f"/api/week?start={w}")
    except urllib.error.HTTPError:
        pass  # a week the engine has no page for
days = [d["day"] for d in core["days"]]
for d in days:
    files[f"day/{d}"] = get(f"/api/day/{d}")
by_shard = {}
for mid in files["points?ids=1"]["ids"]:
    by_shard.setdefault(shard(mid), {})[mid] = get("/api/message/" + urllib.parse.quote(mid, safe=""))
for n, ms in by_shard.items():
    files[f"message/{n}"] = ms

# Robin's home is a folder of this computer's (the demo's home/, under WIMYM_DEMO or ~/.cache/wimym-demo): it shows
# as /Users/robin, as is and as Claude Code names its project folders (every other character a dash)
home, me = os.path.expanduser("~"), getpass.getuser()
robin = os.path.join(os.environ.get("WIMYM_DEMO") or os.path.join(home, ".cache", "wimym-demo"), "home")
dashed = lambda p: re.sub(r"[^A-Za-z0-9-]", "-", p)  # noqa: E731
texts = {}
for k, v in files.items():
    t = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    texts[k] = t.replace(robin.replace("\\", "\\\\"), "/Users/robin").replace(dashed(robin), "-Users-robin")
# nothing else of this computer's in it: the home folder, the account's name
leaks = [k for k, t in texts.items() if home in t or home.replace("\\", "\\\\") in t or re.search(rf"\b{re.escape(me)}\b", t)]
if leaks:
    shutil.rmtree(os.path.join(OUT, "api"), ignore_errors=True)
    sys.exit(f"A path or name of this computer in {', '.join(leaks[:5])}: no data written.")

# the days the public page frames must be in the record
page = open(os.path.join(ROOT, "site", "index.html"), encoding="utf-8").read()
missing = sorted(set(re.findall(r"/demo/days/(\d{4}-\d{2}-\d{2})", page)) - set(days))
if missing:
    print(f"Warning: site/index.html frames {', '.join(missing)}, not in this record ({days[0]} to {days[-1]}).")

for k, t in texts.items():
    p = os.path.join(OUT, "api", *(k.replace("?", "/") + ".json").split("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(t)
size = sum(len(t.encode()) for t in texts.values())
print(f"{len(texts)} files, {size / 1e6:.1f} MB: {len(msgs)} messages, {len(days)} days, {len(weeks)} weeks, in {os.path.relpath(OUT)}/api")
