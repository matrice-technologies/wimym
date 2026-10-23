"""Repair an index from other copies of it, adding only: no record and no turn is ever dropped.

    python3 engine/wimym/repair.py <index.json> <copy.json> [<copy.json> …] [--dry-run]

For each transcript in the index, the record with the most turns is kept and every turn the other copies
have that it lacks is added (index.merge). A copy's record of a transcript the index doesn't have is added
too when that transcript is no longer on disk: it may be the only record left. Records of transcripts still
on disk that the index lacks are left for the engine to read. The index is backed up next to itself first
(<index>.bak-repair-<time>), then written whole (paths.write_json). Stop every engine on that index before.
Written after ~/.claude/projects was deleted on 23 Oct 2026.
"""
import json
import os
import shutil
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wimym import paths  # noqa: E402
from wimym.index import keep_turns, turn_key  # noqa: E402


def records(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    files = d.get("files") if isinstance(d, dict) else None
    if not isinstance(files, dict):
        return None
    return {p: v for p, v in files.items() if isinstance(v, dict) and isinstance(v.get("r"), dict) and "turns" in v["r"]}


def count(files):
    return len(files), sum(len(v["r"].get("turns") or []) for v in files.values() if v.get("r"))


def repair(target, copies, dry=False):
    with open(target, encoding="utf-8") as f:
        doc = json.load(f)
    T = doc["files"]
    before = {p: {turn_key(t) for t in (v.get("r") or {}).get("turns") or []} for p, v in T.items()}
    n0 = count(T)
    grown = added = 0
    for c in copies:
        S = records(c)
        if S is None:
            print(f"  skipped (not an index): {c}")
            continue
        g = a = 0
        for p, sv in S.items():
            tv = T.get(p)
            if tv and tv.get("r"):
                tr, sr = tv["r"], sv["r"]
                # the fuller record is the base; the other's missing turns are added to it
                new = keep_turns(tr, sr) if len(sr.get("turns") or []) > len(tr.get("turns") or []) else keep_turns(sr, tr)
                if len(new.get("turns") or []) > len(tr.get("turns") or []):
                    tv["r"] = new
                    g += 1
            elif not os.path.exists(p) and "/.claude/projects/" in p:
                T[p] = sv
                a += 1
        grown += g
        added += a
        print(f"  {c}: {g} records grown, {a} added")
    n1 = count(T)
    for p, ids in before.items():  # nothing dropped, ever
        now = {turn_key(t) for t in (T[p].get("r") or {}).get("turns") or []}
        assert ids <= now, f"a turn would be lost in {p}"
    print(f"before: {n0[0]} records, {n0[1]} turns; after: {n1[0]} records, {n1[1]} turns "
          f"({grown} record updates, {added} records added)")
    if dry:
        return n0, n1
    backup = f"{target}.bak-repair-{datetime.now().strftime('%H%M%S')}"
    shutil.copy2(target, backup)
    paths.write_json(target, doc, separators=(",", ":"))
    print(f"written; the index as it was is kept as {backup}")
    return n0, n1


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    if len(args) < 2:
        sys.exit(__doc__)
    repair(args[0], args[1:], dry="--dry-run" in sys.argv)
