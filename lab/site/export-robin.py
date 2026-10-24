"""Export Robin's record for the public page: site/media/robin.json, from the demo engine only.

    ./install.sh --demo --no-open
    python3 lab/site/export-robin.py            # reads 127.0.0.1:8997, writes site/media/robin.json

Refuses any engine that isn't the demo: every project must be one of Robin's (engine/wimym/demo.py).
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "engine"))
from wimym.demo import PROJECTS  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8997"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "site", "media", "robin.json")
# in the lab's order (lab/src/shared/data.ts FAMILIES): the day score reads a message's colour by this index
FAMILIES = ["ask", "steer", "make", "approve", "run", "ship", "think"]
DAY_FIELDS = ["day", "n", "start", "end", "active", "rest", "projects", "switchH", "frustrated"]


def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.load(r)


core, msgs = get("/api/core"), get("/api/messages")["messages"]
msgs = sorted((m for m in msgs if m["kind"] == "prompt"), key=lambda m: m["ts"])
strangers = {m["project"] for m in msgs} - set(PROJECTS)
if strangers or not msgs:
    sys.exit(f"Not the demo engine at {BASE}: {len(strangers)} projects that aren't Robin's. Nothing written.")
projects = []


def code(xs, x):
    if x is None:
        return -1
    if x not in xs:
        xs.append(x)
    return xs.index(x)


rows = [[m["day"], round(m["hour"], 3), code(projects, m["project"]), FAMILIES.index(m["family"]) if m["family"] else -1, m["words"], m["text"],
         m.get("outAll")] for m in msgs]
days = [[d.get(k) for k in DAY_FIELDS] for d in core["days"]]
out = {"note": "Robin Vale, a made-up person (engine/wimym/demo.py). Not anyone real.", "dayFields": DAY_FIELDS, "days": days,
       "projects": projects, "families": FAMILIES, "fields": ["day", "hour", "project", "family", "words", "text", "outAll"], "rows": rows}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(rows)} messages over {len(days)} days, {len(projects)} projects: {os.path.relpath(OUT)}")
