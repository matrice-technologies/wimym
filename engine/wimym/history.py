"""Prompts typed in the terminal, from Claude Code's prompt history (~/.claude/history.jsonl).

Each line: {"display": text as typed, with "[Pasted text #1 +12 lines]" and "[Image #1]" in place
of what was pasted, "pastedContents": {n: {"content"|"contentHash", "type"}}, "timestamp": ms,
"project": the folder, "sessionId"}. No replies, tools, model or effort.

It reaches back to 23 Mar, months before the oldest transcript Wimym has read. Every prompt read is
kept in the cache dir (history.json, next to the index) and never dropped, so the record survives
Claude Code trimming history.jsonl. Prompts a transcript already holds are left out by the model.
"""
import json
import os
import re
import threading
from datetime import datetime, timezone

from . import paths
from .paths import CACHE_DIR, CLAUDE

SOURCE = os.path.join(CLAUDE, "history.jsonl")
KEPT = os.path.join(CACHE_DIR, "history.json")
VERSION = 1
PASTE = re.compile(r"\[Pasted text #\d+(?: \+\d+ lines)?\]")
IMAGE = re.compile(r"\[Image #\d+\]")


def _entry(o):
    ts, sid, text = o.get("timestamp"), o.get("sessionId"), o.get("display")
    if not isinstance(ts, (int, float)) or not isinstance(text, str) or not text.strip():
        return None
    when = datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    pasted = 0
    for p in (o.get("pastedContents") or {}).values():
        if isinstance(p, dict) and isinstance(p.get("content"), str):
            pasted += len(p["content"])
    return {"id": f"h-{int(ts)}-{(sid or 'none')[:8]}", "ts": when, "sid": sid or None, "cwd": o.get("project") or None,
            "text": text[:20000], "pasted": pasted, "images": len(IMAGE.findall(text))}


class History:
    def __init__(self):
        self.lock = threading.Lock()
        self.entries = {}  # id → entry
        self.seen = None   # (mtime_ns, size) of history.jsonl last read
        d = paths.read_json(KEPT, {})
        if isinstance(d, dict) and d.get("entries"):
            # prompts are never dropped: another version keeps its entries, and history.jsonl is read again over them
            self.entries = d["entries"]
            self.seen = tuple(d["seen"]) if d.get("v") == VERSION and d.get("seen") else None

    def refresh(self):
        """Read history.jsonl again when it changed; True when a prompt was added."""
        try:
            st = os.stat(SOURCE)
        except OSError:
            return False
        if self.seen == (st.st_mtime_ns, st.st_size):
            return False
        added = 0
        with open(SOURCE, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    e = _entry(json.loads(line))
                except ValueError:
                    continue
                if e and e["id"] not in self.entries:
                    self.entries[e["id"]] = e
                    added += 1
        self.seen = (st.st_mtime_ns, st.st_size)
        self.save()
        return bool(added)

    def save(self):
        paths.write_json(KEPT, {"v": VERSION, "seen": list(self.seen) if self.seen else None, "entries": self.entries},
                         ensure_ascii=False, separators=(",", ":"))

    def list(self):
        return sorted(self.entries.values(), key=lambda e: e["ts"])


def text_of(e):
    """The words typed, without the placeholders for what was pasted, and what kind of prompt it is."""
    t = e["text"].strip()
    if t.startswith("!"):
        return t, "shell"
    if t.startswith("/") and re.match(r"/[\w:.-]+(\s|$)", t):
        return t, "command"
    return IMAGE.sub("", PASTE.sub("", t)).strip(), "prompt"
