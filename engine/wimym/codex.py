"""Sessions run in Codex (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl), as records shaped like scan.scan's,
so the model reads them as it reads Claude Code's transcripts.

Only sessions you drove are kept: the first line's session_meta says where a session came from, and
"vscode" is the Codex desktop app. Subagents (a dict source) and `codex exec` runs (started by scripts or by
Claude) are left out. Each line is {"timestamp", "type", "payload"}:

  turn_context                       model, effort, cwd for the turns that follow
  event_msg / item_completed         item: UserMessage (what you typed, with started_at_ms), AgentMessage
                                     (Codex's text), CommandExecution, FileChange, McpToolCall, ImageView…
  event_msg / turn_aborted           you stopped the turn
  event_msg / token_count            info.last_token_usage: input, cached input, output tokens

Kept in the cache dir (codex.json), read again only when a file changed. Codex keeps its own sessions,
so nothing here is the only copy.
"""
import glob
import json
import os
import re
import threading
from datetime import datetime, timezone

from . import paths
from .paths import CACHE_DIR, HOME
from .scan import GIT_COMMIT, GIT_PUSH, PR_CREATE, spans

ROOT = os.path.join(HOME, ".codex", "sessions")
KEPT = os.path.join(CACHE_DIR, "codex.json")
VERSION = 2
WRAP = re.compile(r"^\s*<([\w-]+)\b[^>]*>.*?</\1>\s*", re.S)
TOOLS = {"CommandExecution": "shell", "FileChange": "edit", "McpToolCall": "other", "ImageView": "read",
         "CollabAgentToolCall": "agents", "SubAgentActivity": "agents"}


def _iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _text(item):
    return "\n".join(c["text"] for c in item.get("content") or [] if isinstance(c, dict) and isinstance(c.get("text"), str))


def _lines(diff):
    add = dele = 0
    for l in (diff or "").splitlines():
        if l.startswith("+") and not l.startswith("+++"):
            add += 1
        elif l.startswith("-") and not l.startswith("---"):
            dele += 1
    return add, dele


def scan(path):
    """A Codex session file → a record like scan.scan's, or {"skip": why} when you didn't drive it."""
    stem = os.path.splitext(os.path.basename(path))[0]
    r = {"v": VERSION, "sid": stem, "cwd": None, "start": None, "end": None, "sub": False, "title": None, "entry": "codex",
         "ver": None, "models": {}, "cost": None, "turns": [], "act": {}, "xact": [], "queue": [],
         "docs": {"loads": [], "reads": [], "writes": []}, "api": [], "origin": "codex"}
    turn, ctx, minutes = None, {}, set()

    def close():
        if turn:
            turn["files"] = sorted(turn["files"])[:80]
            r["turns"].append(turn)
    with open(path, encoding="utf-8", errors="replace") as f:
        for n, line in enumerate(f):
            try:
                o = json.loads(line)
            except ValueError:
                continue
            p = o.get("payload") or {}
            typ = o.get("type")
            ts = (o.get("timestamp") or "")[:19]
            if n == 0:
                if typ != "session_meta" or p.get("source") != "vscode":
                    return {"skip": "not a session you drove"}
                r["cwd"], r["ver"] = p.get("cwd"), p.get("cli_version")
                continue
            if ts:
                try:
                    minutes.add(int(datetime.fromisoformat(ts).replace(tzinfo=timezone.utc).timestamp() // 60))
                except ValueError:
                    pass
            if typ == "turn_context":
                ctx = {"model": p.get("model"), "effort": p.get("effort"), "cwd": p.get("cwd")}
                continue
            if typ != "event_msg":
                continue
            et = p.get("type")
            if et == "turn_aborted" and turn:
                turn["interrupted"] = True
                continue
            if et == "token_count" and turn:
                u = (p.get("info") or {}).get("last_token_usage") or {}
                turn["out"] += u.get("output_tokens") or 0
                turn["ctx"] += u.get("input_tokens") or 0
                turn["msgs"] += 1
                continue
            if et != "item_completed":
                continue
            item = p.get("item") or {}
            it = item.get("type")
            t0, t1 = p.get("started_at_ms"), p.get("completed_at_ms")
            if it == "UserMessage":
                text = WRAP.sub("", _text(item)).strip()
                images = sum(1 for c in item.get("content") or [] if isinstance(c, dict) and c.get("type") == "local_image")
                if not text and not images:
                    continue
                close()
                at = _iso(t0) if t0 else ts
                r["start"] = r["start"] or at
                model = ctx.get("model")
                turn = {"id": f"codex-{item.get('id') or at}", "ts": at, "end": at, "cwd": r["cwd"], "src": "desk", "kind": "prompt",
                        "text": text[:20000], "chars": len(text), "words": len(text.split()), "images": images, "mode": None,
                        "tools": 0, "cat": {}, "files": set(), "add": 0, "del": 0, "commits": 0, "pushes": 0, "prs": 0, "out": 0,
                        "ctx": 0, "think": 0, "thinkMs": 0, "reply": "", "interrupted": False, "model": model, "msgs": 0,
                        "first": None, "perm": {}, "fail": 0, "agents": 0, "spawn": 0, "asked": 0, "plan": 0, "skills": [],
                        "effort": ctx.get("effort")}
                if model:
                    r["models"][model] = r["models"].get(model, 0) + 1
                continue
            if not turn:
                continue
            if t1:
                turn["end"] = max(turn["end"], _iso(t1))
                r["end"] = turn["end"]
            if t0 and it != "Reasoning":
                turn["first"] = turn["first"] or _iso(t0)
            if it == "AgentMessage":
                t = _text(item).strip()
                if t:
                    turn["reply"] = t[:2500]
            elif it == "Reasoning":
                turn["think"] += 1
            elif it in TOOLS:
                turn["tools"] += 1
                k = TOOLS[it]
                turn["cat"][k] = turn["cat"].get(k, 0) + 1
                if it == "CommandExecution":
                    cmd = item.get("command")
                    cmd = " ".join(cmd) if isinstance(cmd, list) else str(cmd or "")
                    turn["commits"] += bool(GIT_COMMIT.search(cmd))
                    turn["pushes"] += bool(GIT_PUSH.search(cmd))
                    turn["prs"] += bool(PR_CREATE.search(cmd))
                    if item.get("exit_code") not in (0, None):
                        turn["fail"] += 1
                elif it == "FileChange":
                    for fp, ch in (item.get("changes") or {}).items():
                        turn["files"].add(fp)
                        a, d = _lines((ch or {}).get("unified_diff"))
                        turn["add"] += a
                        turn["del"] += d
                elif it in ("CollabAgentToolCall", "SubAgentActivity"):
                    turn["agents"] += 1
    close()
    r["end"] = r["end"] or r["start"]
    r["act"] = {stem: spans(minutes)}
    return r


class Codex:
    def __init__(self):
        self.lock = threading.Lock()
        self.files = {}  # path → {"m", "s", "r"}
        d = paths.read_json(KEPT, {})
        if isinstance(d, dict) and d.get("v") == VERSION:  # another version: read again from ~/.codex, which keeps them
            self.files = d.get("files") or {}

    def refresh(self):
        changed = False
        for p in glob.glob(os.path.join(ROOT, "*", "*", "*", "*.jsonl")):
            try:
                st = os.stat(p)
            except OSError:
                continue
            old = self.files.get(p)
            if old and old["m"] == st.st_mtime_ns and old["s"] == st.st_size:
                continue
            try:
                rec = scan(p)
            except (OSError, UnicodeError):
                continue
            self.files[p] = {"m": st.st_mtime_ns, "s": st.st_size, "r": rec}
            changed = True
        if changed:
            paths.write_json(KEPT, {"v": VERSION, "files": self.files}, separators=(",", ":"))
        return changed

    def records(self):
        return [(p, v["r"]) for p, v in self.files.items() if v.get("r") and "skip" not in v["r"]]
