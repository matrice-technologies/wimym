"""The index: every transcript scanned once, then only the ones that changed.

Records of transcripts Claude Code has deleted stay: they're the only history of those
sessions. The first build reads every transcript in parallel worker processes.
"""
import glob
import os
import threading
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime

from . import scan
from . import paths
from .paths import COWORK, INDEX, PROJECTS


def transcript_files():
    """Claude Code's transcripts, and those of Cowork (the desktop app's agent mode), which keeps a Claude Code
    config folder of its own inside each session's folder."""
    out = []
    for root in [PROJECTS] + glob.glob(os.path.join(COWORK, "*", "*", "*", ".claude", "projects")):
        out += glob.glob(os.path.join(root, "*", "*.jsonl")) + glob.glob(os.path.join(root, "*", "*", "subagents", "*.jsonl"))
    return [paths.slashed(p) for p in out]  # on Windows C:/Users/…/subagents/…, which the model splits on /


def _scan(path):
    try:
        return path, scan.scan(path)
    except (OSError, UnicodeError):
        return path, None


def turn_key(t):
    return t.get("id") or t.get("ts")


def keep_turns(old, new):
    """new, unless old has turns new lacks: then new with them (merge)."""
    if old and old.get("turns"):
        have = {turn_key(t) for t in new.get("turns") or []}
        if any(turn_key(t) not in have for t in old["turns"]):
            return merge(old, new)
    return new


def merge(old, new):
    """new, with the turns, activity and span of old that new doesn't have: for a transcript that shrank."""
    out = dict(new)
    have = {turn_key(t) for t in new.get("turns") or []}
    turns = list(new.get("turns") or []) + [t for t in old.get("turns") or [] if turn_key(t) not in have]
    out["turns"] = sorted(turns, key=lambda t: t.get("ts") or "")
    act = {sid: list(sp) for sid, sp in (old.get("act") or {}).items()}
    for sid, sp in (new.get("act") or {}).items():
        act.setdefault(sid, []).extend(sp)
    out["act"] = {sid: scan.spans(m for a, b in sp for m in range(a, b + 1)) for sid, sp in act.items()}
    out["start"] = min(x for x in (old.get("start"), new.get("start")) if x) if (old.get("start") or new.get("start")) else None
    out["end"] = max(x for x in (old.get("end"), new.get("end")) if x) if (old.get("end") or new.get("end")) else None
    out["title"] = new.get("title") or old.get("title")
    out["merged"] = True  # part of it comes from an earlier, longer version of the file
    return out


class Index:
    def __init__(self):
        self.lock = threading.Lock()
        self.files = {}  # path → {"m": mtime_ns, "s": size, "r": record}
        self.state = {"phase": "starting", "done": 0, "total": 0, "updated": None,
                      "found": {"conversations": 0, "messages": 0, "first": None}}
        d = paths.read_json(INDEX, {})
        self.files = d.get("files") or {} if isinstance(d, dict) else {}

    def stale(self):
        todo = []
        for p in transcript_files():
            try:
                st = os.stat(p)
            except OSError:
                continue
            old = self.files.get(p)
            if not old or old["m"] != st.st_mtime_ns or old["s"] != st.st_size or (old.get("r") or {}).get("v") != scan.VERSION:
                todo.append((p, st))
        return todo

    def _count(self, rec):
        """Add a record's prompts of yours to the running counts the loading screen shows."""
        if not rec or rec.get("sub"):
            return
        f = self.state["found"]
        f["conversations"] += 1
        for t in rec.get("turns") or []:
            if t.get("src") in ("desk", "massistant") and t.get("ts"):
                f["messages"] += 1
                if not f["first"] or t["ts"] < f["first"]:
                    f["first"] = t["ts"]

    def refresh(self):
        """Scan what changed; True when anything did."""
        todo = self.stale()
        self.state.update(phase="indexing" if todo else "ready", done=0, total=len(todo),
                          found={"conversations": 0, "messages": 0, "first": None})
        fresh = {p for p, _ in todo}
        for p, v in self.files.items():
            if p not in fresh:
                self._count(v.get("r"))
        if not todo:
            return False
        stats = dict(todo)
        if len(todo) > 40:
            with ProcessPoolExecutor(max_workers=max(2, (os.cpu_count() or 4) - 2)) as ex:
                for i, (p, rec) in enumerate(ex.map(_scan, [p for p, _ in todo], chunksize=8)):
                    if rec is not None:
                        self._keep(p, stats[p], rec)
                        self._count(rec)
                    self.state["done"] = i + 1
        else:
            for i, (p, st) in enumerate(todo):
                _, rec = _scan(p)
                if rec is not None:
                    self._keep(p, st, rec)
                    self._count(rec)
                self.state["done"] = i + 1
        self.save()
        self.state.update(phase="ready", updated=datetime.now().isoformat(timespec="seconds"))
        return True

    def _keep(self, p, st, rec):
        """Store a fresh scan of p. A record never loses a turn: any turn the earlier record has and the new scan
        doesn't (the file was deleted and written again, cut, or rewritten) stays, whatever the file's size now."""
        self.files[p] = {"m": st.st_mtime_ns, "s": st.st_size, "r": keep_turns((self.files.get(p) or {}).get("r"), rec)}

    def save(self):
        paths.write_json(INDEX, {"v": scan.VERSION, "files": self.files}, separators=(",", ":"))

    def records(self):
        return [(p, v["r"]) for p, v in self.files.items() if v.get("r")]
