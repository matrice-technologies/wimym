"""One transcript → what Wimym keeps of it.

A transcript is ~/.claude/projects/<folder>/<session>.jsonl (or .../subagents/*.jsonl). Each
line is a JSON object. Most bytes are tool results, so the cheap checks on the raw line come
first and only lines that matter are parsed.

Kept per transcript:
  turns   every prompt (yours, the bridge's, automated ones) with what it set off until the next
  act     minutes each session id was active, as spans (forks carry their parent's id)
  xact    minutes of inline subagent work (sidechain lines)
  queue   messages you typed while Claude was busy, and what became of them
  docs    instruction and memory files loaded, read and written
  meta    title, models, cost, permission mode, entrypoint, version
"""
import calendar
import json
import os
import re
import zlib
from datetime import datetime

from .text import AUTO_START, EDIT_TOOLS, QUESTIONS, SR, prompt_of, source_of, tool_kind

VERSION = 5

TS = re.compile(r'"timestamp":\s*"([^"]{19})')
GIT_COMMIT = re.compile(r"\bgit\s+(?:-C\s+\S+\s+)?commit\b")
GIT_PUSH = re.compile(r"\bgit\s+(?:-C\s+\S+\s+)?push\b")
PR_CREATE = re.compile(r"\bgh\s+pr\s+create\b")
PERM = re.compile(r'"permissionDecision":\{"decision":"(\w+)","source":"(\w+)"(?:,"reasonType":"(\w+)")?')
TOOL_ID = re.compile(r'"tool_use_id":"([^"]+)"')
DOC_EXT = (".md", ".mdx", ".markdown")
GAP = 5  # minutes: a pause shorter than this doesn't end an activity span


def _minute(ts):
    try:
        return calendar.timegm((int(ts[0:4]), int(ts[5:7]), int(ts[8:10]), int(ts[11:13]), int(ts[14:16]), 0)) // 60
    except (ValueError, IndexError):
        return None


def spans(minutes):
    out = []
    for m in sorted(minutes):
        if out and m - out[-1][1] <= GAP:
            out[-1][1] = m
        else:
            out.append([m, m])
    return out


def _lines(s):
    return s.count("\n") + 1 if isinstance(s, str) and s else 0


def _typed(c):
    c = c.lstrip()
    if not c:
        return False
    if c.startswith(("<bash-input>", "<pasted_content")):
        return True
    return not c.startswith(AUTO_START) and not c.startswith(("<", "[", "Background (from"))


def _new_turn(o, ts, text, images, kind, src, cwd):
    return {"id": o.get("uuid"), "ts": ts, "end": ts, "cwd": cwd, "src": src, "kind": kind,
            "text": text[:20000], "chars": len(text), "words": len(text.split()), "images": images,
            "mode": o.get("permissionMode"), "tools": 0, "cat": {}, "files": set(), "add": 0, "del": 0,
            "commits": 0, "pushes": 0, "prs": 0, "out": 0, "ctx": 0, "inpFresh": 0, "inpWrite": 0, "inpRead": 0,
            "think": 0, "thinkMs": 0, "reply": "", "interrupted": False, "model": None, "msgs": 0, "first": None,
            "perm": {}, "fail": 0, "agents": 0, "spawn": 0, "asked": 0, "plan": 0, "skills": [], "effort": None,
            "outSub": 0, "pid": o.get("promptId"), "spawnKeys": []}


def spawn_key(s):
    """The first words of a brief one session sent another: found again in the first message of the session it started."""
    s = " ".join(str(s or "").split())
    return s[:100] if len(s) >= 40 else None


def scan(path):
    r = {"v": VERSION, "sid": None, "cwd": None, "start": None, "end": None, "sub": "/subagents/" in path,
         "title": None, "entry": None, "ver": None, "models": {}, "cost": None, "turns": [], "act": {}, "xact": set(),
         "queue": [], "docs": {"loads": [], "reads": [], "writes": []}, "api": [], "pid": None, "out": 0}
    turn, seen, names = None, set(), {}
    act, pend = {}, []
    last_key = None

    def close():
        if turn:
            turn["files"] = sorted(turn["files"])[:80]
            r["turns"].append(turn)

    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            # --- activity minutes, from the raw line (every line, cheaply)
            i = line.rfind('"timestamp":"')
            if i >= 0:
                ts16 = line[i + 13:i + 29]
                head = line[:400]
                if '"isSidechain":true' in head:
                    sid = None
                else:
                    j = head.find('"sessionId":"')
                    if j < 0:
                        j = line.find('"sessionId":"')
                    sid = line[j + 13:j + 49] if j >= 0 else ""
                key = (ts16, sid)
                if key != last_key:
                    last_key = key
                    m = _minute(ts16)
                    if m is not None:
                        (r["xact"] if sid is None else act.setdefault(sid, set())).add(m)

            # --- queue: messages typed while Claude was busy
            if '"queue-operation"' in line:
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                op, t, c = o.get("operation"), (o.get("timestamp") or "")[:19], o.get("content")
                c = c if isinstance(c, str) else ""
                if op == "enqueue" and t:
                    e = [t, "p", None, None, zlib.crc32(c.encode()) & 0xFFFFFF, _typed(c)]
                    r["queue"].append(e)
                    pend.append(e)
                elif op in ("dequeue", "remove") and pend:
                    h = zlib.crc32(c.encode()) & 0xFFFFFF if c else None
                    e = next((x for x in pend if x[4] == h), pend[0]) if h is not None else pend[0]
                    pend.remove(e)
                    try:
                        wait = (datetime.fromisoformat(t) - datetime.fromisoformat(e[0])).total_seconds()
                    except ValueError:
                        wait = 0
                    e[2], e[3] = round(wait, 1), t
                    e[1] = ("w" if wait >= 2 else "i") if op == "dequeue" else ("a" if o.get("reason") in (None, "absorbed_mid_turn") else "o")
                continue

            # --- session metadata lines
            if line.startswith('{"type":"custom-title"') or '"type":"custom-title"' in line[:60]:
                try:
                    r["title"] = json.loads(line).get("customTitle") or r["title"]
                except ValueError:
                    pass
                continue
            if '"type":"cost-state"' in line[:60]:
                try:
                    o = json.loads(line)
                    r["cost"] = {"usd": o.get("totalCostUSD"), "api": o.get("totalAPIDuration"), "dur": o.get("totalDuration"),
                                 "add": o.get("totalLinesAdded"), "del": o.get("totalLinesRemoved")}
                except ValueError:
                    pass
                continue
            if '"subtype":"api_error"' in line:
                try:
                    o = json.loads(line)
                    err = o.get("error") or {}
                    r["api"].append([(o.get("timestamp") or "")[:19], err.get("status") if isinstance(err.get("status"), int) else None,
                                     o.get("retryAttempt") or 1, "" if o.get("isSidechain") else (turn or {}).get("id")])
                except ValueError:
                    pass
                continue

            # --- tool results: time, interruptions, errors and permission decisions only
            if '"tool_result"' in line and '"tool_use"' not in line and '"attachment"' not in line:
                if turn:
                    m = TS.search(line)
                    if m:
                        turn["end"] = max(turn["end"], m.group(1))
                    if "[Request interrupted by user" in line:
                        turn["interrupted"] = True
                if turn and '"isSidechain":true' not in line[:400]:
                    if '"is_error":true' in line:
                        turn["fail"] += 1
                    if '"permissionDecision"' in line:
                        pm = PERM.search(line)
                        tid = TOOL_ID.search(line)
                        if pm and not (tid and names.get(tid.group(1)) in QUESTIONS):
                            dec, src, reason = pm.groups()
                            k = ("always" if src == "user_permanent" else "asked") if src.startswith("user") else \
                                "hook" if src == "hook" else "auto" if reason == "classifier" else "mode" if reason == "mode" else "safety" if reason == "safetyCheck" else "rule"
                            k += "" if dec in ("accept", "allow") else "-no"
                            turn["perm"][k] = turn["perm"].get(k, 0) + 1
                    if "The user doesn't want to proceed" in line:
                        turn["perm"]["you-no"] = turn["perm"].get("you-no", 0) + 1
                continue
            if '"type":"user"' not in line and '"type":"assistant"' not in line and '"attachment"' not in line and '"tool_use"' not in line:
                if r["sid"] is None and '"sessionId"' in line:
                    try:
                        r["sid"] = json.loads(line).get("sessionId")
                    except ValueError:
                        pass
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            ts = (o.get("timestamp") or "")[:19]
            if ts:
                r["start"] = r["start"] or ts
                r["end"] = ts
            r["sid"] = r["sid"] or o.get("sessionId")
            if r["sub"]:  # a subagent's file: the prompt that launched it, and its output
                r["pid"] = r["pid"] or o.get("promptId")
            cwd = o.get("cwd") or r["cwd"]
            r["cwd"] = r["cwd"] or o.get("cwd")
            r["entry"] = r["entry"] or o.get("entrypoint")
            r["ver"] = o.get("version") or r["ver"]
            a = o.get("attachment")
            if isinstance(a, dict):
                if a.get("type") == "instructions":
                    for fl in a.get("files") or []:
                        if fl.get("path"):
                            r["docs"]["loads"].append([fl["path"], fl.get("type") or "", ts])
                elif a.get("type") == "nested_memory" and a.get("path"):
                    r["docs"]["loads"].append([a["path"], "Nested", ts])
            typ = o.get("type")
            if typ == "user":
                pr = prompt_of(o)
                if pr is None:
                    continue
                text, images, kind = pr
                if text.startswith("[Request interrupted"):
                    if turn:
                        turn["interrupted"] = True
                    continue
                close()
                seen = set()
                home = r["cwd"] or cwd
                turn = _new_turn(o, ts, text, images, kind, source_of(o, text, home), home)
                continue
            msg = o.get("message")
            if not isinstance(msg, dict) or not isinstance(msg.get("content"), list):
                continue
            side = bool(o.get("isSidechain"))
            if typ == "assistant":
                mdl = msg.get("model")
                mid = msg.get("id")
                if mdl and mid not in seen and mdl != "<synthetic>":
                    r["models"][mdl] = r["models"].get(mdl, 0) + 1
                if turn and not side:
                    if ts:
                        turn["end"] = max(turn["end"], ts)
                        turn["first"] = turn["first"] or ts
                    if mid not in seen:
                        seen.add(mid)
                        u = msg.get("usage") or {}
                        turn["out"] += u.get("output_tokens") or 0
                        i, w, rd = u.get("input_tokens") or 0, u.get("cache_creation_input_tokens") or 0, u.get("cache_read_input_tokens") or 0
                        turn["inpFresh"] += i
                        turn["inpWrite"] += w
                        turn["inpRead"] += rd
                        if i + w + rd:  # the context at the end of the turn: the last call's prompt and what it wrote
                            turn["ctx"] = i + w + rd + (u.get("output_tokens") or 0)
                        turn["msgs"] += 1
                        turn["model"] = mdl or turn["model"]
                        turn["effort"] = o.get("effort") or turn["effort"]
                    if o.get("thinkingDurationMs"):
                        turn["thinkMs"] += o["thinkingDurationMs"]
                elif side and mid not in seen:  # a subagent's call: inline (older Claude Code) or in its own file
                    seen.add(mid)
                    n = (msg.get("usage") or {}).get("output_tokens") or 0
                    if turn:
                        turn["outSub"] += n
                    else:
                        r["out"] += n
            for c in msg["content"]:
                if not isinstance(c, dict):
                    continue
                ct = c.get("type")
                if typ == "assistant" and turn and not side:
                    if ct == "text" and (c.get("text") or "").strip():
                        turn["reply"] = c["text"].strip()[:2500]
                    elif ct == "thinking":
                        turn["think"] += 1
                if ct != "tool_use":
                    continue
                name, inp = c.get("name") or "", c.get("input") or {}
                if not isinstance(inp, dict):
                    continue
                names[c.get("id")] = name
                if turn and typ == "assistant" and not side:
                    turn["tools"] += 1
                    k = tool_kind(name)
                    turn["cat"][k] = turn["cat"].get(k, 0) + 1
                    if name in EDIT_TOOLS and inp.get("file_path"):
                        turn["files"].add(inp["file_path"])
                        if name == "Write":
                            turn["add"] += _lines(inp.get("content"))
                        elif name == "MultiEdit":
                            for e in inp.get("edits") or []:
                                if isinstance(e, dict):
                                    turn["del"] += _lines(e.get("old_string"))
                                    turn["add"] += _lines(e.get("new_string"))
                        else:
                            turn["del"] += _lines(inp.get("old_string"))
                            turn["add"] += _lines(inp.get("new_string"))
                    if name == "Bash" and isinstance(inp.get("command"), str):
                        cmd = inp["command"]
                        turn["commits"] += bool(GIT_COMMIT.search(cmd))
                        turn["pushes"] += bool(GIT_PUSH.search(cmd))
                        turn["prs"] += bool(PR_CREATE.search(cmd))
                    if name in ("Agent", "Task"):
                        turn["agents"] += 1
                    elif name.startswith("mcp__ccd_session__start_session"):
                        turn["spawn"] += 1
                        keys = [k for k in (spawn_key(inp.get("background")), spawn_key(inp.get("prompt"))) if k]
                        if keys:
                            turn["spawnKeys"].append(keys)
                    elif name == "AskUserQuestion":
                        turn["asked"] += 1
                    elif name in ("ExitPlanMode", "EnterPlanMode"):
                        turn["plan"] += 1
                    elif name == "Skill" and inp.get("skill") and len(turn["skills"]) < 12:
                        turn["skills"].append(str(inp["skill"])[:60])
                p = inp.get("file_path") or ""
                if name == "Read" and p.endswith(DOC_EXT):
                    r["docs"]["reads"].append([os.path.normpath(p), ts])
                elif name in ("Write", "Edit", "MultiEdit") and p.endswith(DOC_EXT):
                    r["docs"]["writes"].append([os.path.normpath(p), ts])
    close()
    if r["sid"] is None:
        r["sid"] = os.path.splitext(os.path.basename(path))[0]
    r["act"] = {sid: spans(ms) for sid, ms in act.items() if sid}
    r["xact"] = spans(r["xact"])
    r["queue"] = [e[:5] for e in r["queue"] if e[5] and e[1] != "i"]
    # keep docs that say something about you and your instructions: memory notes, CLAUDE.md and friends
    keep = lambda p: "/memory/" in p or os.path.basename(p) in ("CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "MEMORY.md")
    r["docs"] = {k: [x for x in v if keep(x[0])][:400] for k, v in r["docs"].items()}
    return r
