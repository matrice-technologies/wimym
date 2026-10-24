"""From the index to what the app shows: your messages, sessions, days, weeks, projects
and the profile drawn from them.

Times in transcripts are UTC. Everything here is in this Mac's time zone, and a day runs
from 05:00 to 05:00, so a message at 00:30 belongs to the evening before.
"""
import os
import re
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import median

from . import memory
from .history import text_of as history_text
from .labels import FAMILIES, FAMILY_OF, INTENT_NAMES
from .paths import scratch, slashed, tilde
from .text import AUTO_START, BY_SESSION, Speller, lang, not_typed, own_words, pasted, project_of

DAY_START = 5
BREAK = 1800      # 30 min without a message of yours is a break
MINE = ("desk", "massistant")
# Requests for work: what "says what done looks like" is measured on (questions, go-aheads and answers
# almost never say it, so counting them would only echo how many of those you send).
WORK = {"build", "fix", "design", "ops", "setup", "ship", "plan", "review", "correct"}
COVERED = .8      # a label set speaks for you once it covers this share of your messages
SAME = 10         # seconds: a history prompt this close to a transcript's turn of the same session is that turn
# Message fields only a transcript gives: null on prompts from history.jsonl, never zero.
FULL_ONLY = ("dur", "wait1", "tools", "cat", "files", "add", "del", "commits", "pushes", "prs", "out", "outSub", "outAuto",
             "outAll", "ctx", "inp", "inpFresh", "inpWrite", "inpRead", "stopped", "model", "effort", "thinkMs", "mode",
             "asked", "auto", "denied", "blocked", "fail", "agents", "spawn", "questions", "gap", "queued", "after",
             "claudeAsked", "readWords")


# ---------------------------------------------------------------------------
# time helpers

def utc(ts):
    return datetime.fromisoformat(ts[:19]).replace(tzinfo=timezone.utc)


def local(ts):
    return utc(ts).astimezone()


def day_of(dt):
    return (dt - timedelta(hours=DAY_START)).date()


def hour_of(dt):
    """Hours since midnight of the day it belongs to: 00:30 is 24.5."""
    h = dt.hour + dt.minute / 60 + dt.second / 3600
    return h + 24 if h < DAY_START else h


def secs(a, b):
    return (utc(b) - utc(a)).total_seconds()


def week_of(d):
    return (d - timedelta(days=d.weekday())).isoformat()


def pct(a, b, nd=1):
    return round(100 * a / b, nd) if b else None


def med(xs, nd=1):
    xs = [x for x in xs if x is not None]
    return round(median(xs), nd) if xs else None


def tot(rows, key):
    """Sum of a field over rows, None when no row has it (days before the transcripts begin)."""
    xs = [r.get(key) for r in rows if r.get(key) is not None]
    return sum(xs) if xs else None


def short_id(k):
    """The 8-character id accounts cite a message by, as labeller/accounts.py ref() makes it."""
    import hashlib
    return k[:8] if re.match(r"[0-9a-f]{8}", k) else hashlib.sha1(k.encode()).hexdigest()[:8]


CITE = re.compile(r"\[([0-9a-f]{8})\]")


def cites(texts, by_short):
    """{short id: message id} for the [a7176289] citations in an account's texts."""
    out = {}
    for t in texts:
        for c in CITE.findall(t or ""):
            if c in by_short:
                out[c] = by_short[c]
    return out


def acts_of(a):
    """The acts set on a message (labeller/definitions.json), null when it isn't labelled."""
    a = a or {}
    return {"decides": a.get("dec"), "decision": a.get("dw") or None, "defers": a.get("dfr"), "putOff": a.get("fw") or None,
            "withPeople": a.get("ppl"), "people": a.get("names") or None, "selfState": a.get("st"), "handsOver": a.get("off"),
            "rule": a.get("rule") or None, "domain": a.get("dom"), "notDone": a.get("nd")}


def effect_of(t):
    if t.get("interrupted"):
        return "stopped"
    if t.get("commits") or t.get("pushes") or t.get("prs"):
        return "shipped"
    if t.get("files"):
        return "changed"
    return "answered"


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * (p * (1 - p) / n + z * z / (4 * n * n)) ** .5 / d
    return [round(100 * max(0, c - h), 1), round(100 * min(1, c + h), 1)]


# ---------------------------------------------------------------------------

class Model:
    """Built from scratch whenever the index changes (a second or two)."""

    def __init__(self, records, labels, checkins, history=()):
        self.labels = labels
        self.checkins = checkins
        self.generated = datetime.now().isoformat(timespec="seconds")
        self._turns(records)
        self._leverage(records)
        self._sessions(records)
        self._messages(history)
        self._parallel()
        self._days()
        self._weeks()
        self._projects()
        self._profile()
        self._memory(records)

    # -- every turn once (a forked session copies the turns it was forked from) -----------------
    def _turns(self, records):
        best = {}
        files = []
        for path, r in records:
            if r.get("sub"):
                continue
            stem = os.path.splitext(os.path.basename(path))[0]
            own = r.get("sid") == stem
            files.append((path, r, stem))
            for i, t in enumerate(r.get("turns") or []):
                k = t.get("id") or f"{r['sid']}:{t['ts']}"
                score = (t["tools"] + t["msgs"], own)
                if k not in best or score > best[k][0]:
                    best[k] = (score, path, i)
        chosen = {(path, i): k for k, (_, path, i) in best.items()}
        self.turns = {}  # id → turn with its session, project and place in the session
        for path, r, stem in files:
            prev = None
            queue = [e for e in r.get("queue") or [] if e[1] == "w" and e[3]]
            for i, t in enumerate(r.get("turns") or []):
                k = chosen.get((path, i))
                if k is not None:
                    t = dict(t)
                    t["key"], t["sid"], t["path"] = k, stem, path
                    t["origin"] = r.get("origin") or ("cowork" if r.get("entry") == "local-agent" else "transcript")
                    t["project"] = project_of(t.get("cwd") or r.get("cwd"))
                    t["prev"] = prev
                    # held in the queue while Claude worked: its prompt time is when it left the queue
                    q = next((e for e in queue if abs(secs(e[3], t["ts"])) <= 10), None) if queue and t["ts"] else None
                    t["sent"] = q[0] if q else None
                    self.turns[k] = t
                prev = t
        # absorbed into a running turn: typed while Claude worked, never its own prompt
        self.absorbed = []
        for path, r, stem in files:
            for e in r.get("queue") or []:
                if e[1] == "a":
                    self.absorbed.append((e[0], stem))

    # -- what a turn of yours set off beyond its own output ------------------------------------
    def _leverage(self, records):
        """levSub: output of the subagents a turn launched (found by its prompt id, else the turn of their session
        running when they started). levAuto, on your turns: output of the turns Claude ran without you that
        followed from it, in its session or in sessions it started (found by the brief it sent, else by a session
        starting while it was starting one), and so on down. Each turn's output lands on one turn of yours, at most."""
        by_sid, by_pid = defaultdict(list), {}
        for t in self.turns.values():
            t["levSub"], t["levAuto"] = t.get("outSub", 0), 0
            if t["ts"]:
                by_sid[t["sid"]].append(t)
            if t.get("pid"):
                by_pid[t["pid"]] = t
        for ts in by_sid.values():
            ts.sort(key=lambda t: t["ts"])
        stamps = {sid: [t["ts"] for t in ts] for sid, ts in by_sid.items()}

        def running(sid, when):
            i = bisect_right(stamps.get(sid) or [], when) - 1
            return by_sid[sid][i] if i >= 0 else None
        for path, r in records:
            if r.get("sub") and r.get("out"):
                t = by_pid.get(r.get("pid")) or (r.get("start") and running(path.split("/subagents/")[0].rsplit("/", 1)[-1], r["start"]))
                if t:
                    t["levSub"] += r["out"]
        # the session that started each session
        keys = {k: t for t in self.turns.values() for ks in t.get("spawnKeys") or [] for k in ks}
        spawners = sorted((t for t in self.turns.values() if t.get("spawn") and t["ts"]), key=lambda t: t["ts"])
        parent = {}
        by_session = lambda x, pre=BY_SESSION: x.startswith(pre) or own_words(x).startswith(pre)
        for sid, ts in by_sid.items():
            for t in [t for t in ts if t["src"] not in MINE and by_session(t["text"][:300])][:5]:
                text = " ".join(t["text"][:4000].split())
                p = next((p for k, p in keys.items() if k in text), None)
                if not p and by_session(text[:300], ("Background (from the session", "Task (from the session")):
                    # a brief not kept (scanned before briefs were): a turn that started a session in the 15 minutes
                    # before this one began, still its session's latest turn
                    p = next((p for p in reversed(spawners) if p["ts"] <= t["ts"] and p["sid"] != sid and
                              secs(p["ts"], t["ts"]) <= 900 and running(p["sid"], t["ts"]) is p), None)
                if p and p["sid"] != sid:
                    parent[sid] = p["sid"]
                    break
        owner = {}

        def own(t):
            k = t["key"]
            if k not in owner:
                if t["src"] in MINE:
                    owner[k] = t
                    return t
                owner[k] = None  # no loops
                ts = by_sid[t["sid"]]
                i = bisect_right(stamps[t["sid"]], t["ts"]) - 1
                mine = next((x for x in reversed(ts[:i + 1]) if x["src"] in MINE), None)
                p = parent.get(t["sid"])
                via = own(running(p, t["ts"])) if p and running(p, t["ts"]) else None
                owner[k] = max((x for x in (mine, via) if x), key=lambda x: x["ts"], default=None)
            return owner[k]
        for t in self.turns.values():
            if t["ts"] and t["src"] not in MINE:
                o = own(t)
                if o:
                    o["levAuto"] += t["out"] + t["levSub"]

    # -- sessions ------------------------------------------------------------------------------
    def _sessions(self, records):
        S = {}
        self.sub_spans = []
        by_file = {}
        for path, r in records:
            proj = project_of(r.get("cwd"))
            stem = os.path.splitext(os.path.basename(path))[0]
            self.sub_spans.extend(r.get("xact") or [])
            if r.get("sub"):
                for sp in (r.get("act") or {}).values():
                    self.sub_spans.extend(sp)
                parent = path.split("/subagents/")[0].rsplit("/", 1)[-1]
                by_file.setdefault(parent, {"subs": 0})["subs"] += 1
                continue
            for sid, sp in (r.get("act") or {}).items():
                s = S.setdefault(sid, {"sid": sid, "project": None, "spans": []})
                s["spans"].extend(sp)
                if s["project"] is None or sid == stem:
                    s["project"] = proj
            info = by_file.setdefault(stem, {"subs": 0})
            info.update(title=r.get("title"), cost=(r.get("cost") or {}).get("usd"), entry=r.get("entry"),
                        models=r.get("models") or {}, start=r.get("start"), end=r.get("end"), project=proj)
        # turns by session
        tby = defaultdict(list)
        for t in self.turns.values():
            tby[t["sid"]].append(t)
        self.sessions = {}
        sl = self.labels.get("sessions") or {}
        for sid in set(S) | {k for k, v in by_file.items() if "start" in v}:
            s = S.get(sid) or {"sid": sid, "project": None, "spans": []}
            info = by_file.get(sid) or {}
            ts = sorted(tby.get(sid, []), key=lambda t: t["ts"] or "")
            mine = [t for t in ts if t["src"] in MINE]
            first = (mine or ts or [None])[0]
            if mine:
                kind = "you"
            elif ts and own_words(ts[0]["text"]).startswith(BY_SESSION) or ts and ts[0]["text"].startswith(BY_SESSION):
                kind = "side"
            else:
                kind = "auto"
            spans = []
            for a, b in sorted(s["spans"]):
                if spans and a - spans[-1][1] <= 5:
                    spans[-1][1] = max(spans[-1][1], b)
                else:
                    spans.append([a, b])
            if not spans and not ts:
                continue
            self.sessions[sid] = {
                "sid": sid, "project": s["project"] or info.get("project") or (ts[0]["project"] if ts else "?"),
                "title": info.get("title"), "kind": kind, "spans": spans,
                "start": (ts[0]["ts"] if ts else info.get("start")), "end": max((t["end"] for t in ts), default=info.get("end")),
                "turns": len(ts), "mine": len(mine), "tools": sum(t["tools"] for t in ts), "out": sum(t["out"] for t in ts),
                "cost": info.get("cost"), "subs": info.get("subs", 0), "entry": info.get("entry"),
                "model": max((info.get("models") or {"": 0}).items(), key=lambda kv: kv[1])[0] or None,
                "first": first["key"] if first else None, "ex": own_words(first["text"])[:160] if first else "",
                "goal": sl.get(sid, {}).get("goal"), "outcome": sl.get(sid, {}).get("outcome"),
                "rework": sl.get(sid, {}).get("rework"), "open": sl.get(sid, {}).get("open"),
                "decisions": sl.get(sid, {}).get("decisions"), "redone": sl.get(sid, {}).get("rw") or None,
                "people": sl.get(sid, {}).get("people"), "account": sl.get(sid, {}).get("account"),
            }

    # -- your messages ---------------------------------------------------------------------------
    def _messages(self, history=()):
        cats, sigs = self.labels["categories"], self.labels["signals"]
        acts = self.labels.get("acts") or {}
        # full detail from Claude Code's own transcripts on: Cowork's and Codex's few sessions before don't make a day full
        stamps = [t["ts"] for t in self.turns.values() if t["ts"] and t["origin"] == "transcript"]
        self.full_from = day_of(local(min(stamps))).isoformat() if stamps else None
        rows = []
        for k, t in self.turns.items():
            if t["src"] not in MINE or not t["ts"]:
                continue
            c = cats.get(k) or {}
            if c.get("ag") or (t["kind"] == "prompt" and not_typed(t["text"])):
                continue
            words = own_words(t["text"]) if t["kind"] == "prompt" else t["text"]
            if not words.strip() and not t["images"]:
                continue
            rows.append((t, c, sigs.get(k) or {}, words))
        rows.sort(key=lambda x: x[0]["ts"])
        sp = Speller(t.get("reply") or "" for t in self.turns.values())
        self.typo_words = Counter()
        msgs = []
        for t, c, s, words in rows:
            L = local(t["ts"])
            prev = t["prev"]
            lg = lang(words) if t["kind"] == "prompt" else None
            typos, checked = sp.check(words) if (t["src"] == "desk" and lg == "en" and t["kind"] == "prompt") else ([], 0)
            self.typo_words.update(typos)
            perm = t.get("perm") or {}
            m = {
                "id": t["key"], "sid": t["sid"], "project": t["project"], "ts": t["ts"],
                "day": day_of(L).isoformat(), "hour": round(hour_of(L), 3), "dow": day_of(L).weekday(),
                "src": t["src"], "kind": t["kind"], "words": len(words.split()), "chars": len(words), "images": t["images"],
                "pasted": pasted(t["text"]), "text": words[:280], "lang": lg, "typos": len(typos), "checked": checked,
                "intent": c.get("in"), "intentV": c.get("v"), "family": FAMILY_OF.get(c.get("in")), "tone": c.get("to"), "specific": c.get("sp"),
                "own": s.get("own"), "who": s.get("who"), "scope": s.get("sc"), "pressure": s.get("pr"), "irk": s.get("irk"), "play": s.get("pl"),
                **acts_of(acts.get(t["key"])),
                "dur": max(0, round(secs(t["ts"], t["end"]))) if t["end"] else 0,
                "wait1": max(0, round(secs(t["ts"], t["first"]))) if t.get("first") else None,
                "tools": t["tools"], "cat": t["cat"], "files": len(t["files"]), "add": t["add"], "del": t["del"],
                "commits": t["commits"], "pushes": t["pushes"], "prs": t["prs"], "out": t["out"],
                # subagents: unknown on turns scanned before they were counted
                "outSub": t["levSub"] if "outSub" in t else None, "outAuto": t["levAuto"],
                "outAll": t["out"] + t["levSub"] + t["levAuto"],
                # a turn scanned before the split (kept in the index after its transcript went) summed its input in ctx
                "ctx": t["ctx"] if "inpFresh" in t else None,
                "inp": t["inpFresh"] + t["inpRead"] + (t["inpWrite"] or 0) if "inpFresh" in t else t["ctx"],
                "inpFresh": t.get("inpFresh"), "inpWrite": t.get("inpWrite"), "inpRead": t.get("inpRead"),
                "stopped": t["interrupted"], "model": t["model"], "effort": t.get("effort"), "thinkMs": t.get("thinkMs", 0),
                "mode": t.get("mode"), "asked": perm.get("asked", 0) + perm.get("always", 0), "auto": perm.get("auto", 0),
                "denied": perm.get("you-no", 0), "blocked": sum(v for k2, v in perm.items() if k2.endswith("-no") and k2 != "you-no"),
                "fail": t.get("fail", 0), "agents": t.get("agents", 0), "spawn": t.get("spawn", 0), "questions": t.get("asked", 0),
                "first": prev is None, "gap": round(secs(prev["end"], t["sent"] or t["ts"])) if prev and prev.get("end") else None,
                "queued": bool(t["sent"]), "after": effect_of(prev) if prev else None,
                "claudeAsked": bool(prev and "?" in (prev.get("reply") or "")[-300:]),
                # words of Claude's last text before this message (kept up to 2,500 characters, so long replies count short)
                "readWords": len((prev.get("reply") or "").split()) if prev else None,
                "next": None, "nextGap": None, "origin": t.get("origin") or "transcript",
            }
            msgs.append(m)
        self.history = {}
        for e, words, kind in self._history_rows(history, cats):
            L = local(e["ts"])
            lg = lang(words) if kind == "prompt" else None
            typos, checked = sp.check(words) if (lg == "en" and kind == "prompt") else ([], 0)
            self.typo_words.update(typos)
            c, s = cats.get(e["id"]) or {}, sigs.get(e["id"]) or {}
            m = {
                "id": e["id"], "sid": e["sid"] or e["id"], "project": project_of(e["cwd"]), "ts": e["ts"],
                "day": day_of(L).isoformat(), "hour": round(hour_of(L), 3), "dow": day_of(L).weekday(),
                "src": "desk", "kind": kind, "words": len(words.split()), "chars": len(words), "images": e["images"],
                "pasted": e["pasted"], "text": words[:280], "lang": lg, "typos": len(typos), "checked": checked,
                "intent": c.get("in"), "intentV": c.get("v"), "family": FAMILY_OF.get(c.get("in")), "tone": c.get("to"), "specific": c.get("sp"),
                "own": s.get("own"), "who": s.get("who"), "scope": s.get("sc"), "pressure": s.get("pr"), "irk": s.get("irk"), "play": s.get("pl"),
                **acts_of(acts.get(e["id"])),
                **{k: None for k in FULL_ONLY},
                "first": False, "next": None, "nextGap": None, "origin": "history",
            }
            msgs.append(m)
            self.history[e["id"]] = e
        msgs.sort(key=lambda m: m["ts"])
        seen_sid = set()
        for m in msgs:
            if m["origin"] == "history":
                m["first"] = m["sid"] not in seen_sid
                seen_sid.add(m["sid"])
        # what you said next in the same session
        by_sid = defaultdict(list)
        for m in msgs:
            by_sid[m["sid"]].append(m)
        for v in by_sid.values():
            for a, b in zip(v, v[1:]):
                a["next"] = b["intent"]
                a["nextGap"] = round(secs(a["ts"], b["ts"]))
        self.messages = msgs
        self.msg_by_id = {m["id"]: m for m in msgs}
        self.by_short = {short_id(m["id"]): m["id"] for m in msgs}

    def _history_rows(self, history, cats):
        """Prompts from history.jsonl no transcript holds, as (entry, own words, kind), with the same rules as
        transcripts: nothing typed in a scratch folder or by a bridge, no notices, nothing not typed by you."""
        if not history:
            return []
        by_sid, by_text = defaultdict(list), defaultdict(list)
        for t in self.turns.values():
            if t["ts"]:
                by_sid[t["sid"]].append(utc(t["ts"]))
                by_text[own_words(t["text"])[:200].strip()].append(utc(t["ts"]))
        out = []
        for e in history:
            if not e.get("ts"):
                continue
            at = utc(e["ts"])
            words, kind = history_text(e)
            if any(abs((at - x).total_seconds()) <= SAME for x in by_sid.get(e["sid"]) or ()):
                continue
            if any(abs((at - x).total_seconds()) <= 300 for x in by_text.get(words[:200].strip()) or ()):
                continue
            cwd = slashed(e.get("cwd") or "")
            if scratch(cwd) or "/.matrice-bridge/" in cwd + "/" or "/.massistant-probe" in cwd or "/Library/Logs/" in cwd:
                continue
            if words.startswith(AUTO_START) or (cats.get(e["id"]) or {}).get("ag") or (kind == "prompt" and not_typed(words)):
                continue
            if not words.strip() and not e.get("images"):
                continue
            out.append((e, words, kind))
        return out

    # -- sessions at once ---------------------------------------------------------------------
    def _parallel(self):
        you = [s for s in self.sessions.values() if s["kind"] == "you" and s["spans"]]
        allx = [s for s in self.sessions.values() if s["spans"]]
        if not allx:
            self.minute = None
            return
        lo = min(s["spans"][0][0] for s in allx)
        hi = max(s["spans"][-1][1] for s in allx)
        N = hi - lo + 2

        def count(ss, extra=()):
            d = [0] * (N + 1)
            for s in ss:
                for a, b in s["spans"]:
                    d[a - lo] += 1
                    d[b - lo + 1] -= 1
            for a, b in extra:
                if lo <= a and b <= hi:
                    d[a - lo] += 1
                    d[b - lo + 1] -= 1
            run, out = 0, [0] * N
            for i in range(N):
                run += d[i]
                out[i] = run
            return out
        self.minute = {"lo": lo, "you": count(you), "all": count(allx), "sub": count([], self.sub_spans)}

    # -- days ----------------------------------------------------------------------------------
    def _days(self):
        msgs = [m for m in self.messages if m["kind"] == "prompt"]
        if not msgs:
            self.days = []
            return
        by_day = defaultdict(list)
        for m in self.messages:
            by_day[m["day"]].append(m)
        # Claude's work on every turn (yours and automated), by day
        work = defaultdict(lambda: {"turns": 0, "tools": 0, "out": 0, "secs": 0, "auto": 0})
        for t in self.turns.values():
            if not t["ts"]:
                continue
            w = work[day_of(local(t["ts"])).isoformat()]
            w["turns"] += 1
            w["tools"] += t["tools"]
            w["out"] += t["out"]
            w["secs"] += max(0, secs(t["ts"], t["end"])) if t["end"] else 0
            w["auto"] += t["src"] not in MINE
        # cost: each session's cost spread over its days by output tokens
        cost = defaultdict(float)
        per_sid = defaultdict(list)
        for t in self.turns.values():
            per_sid[t["sid"]].append(t)
        for sid, s in self.sessions.items():
            if not s.get("cost"):
                continue
            ts = per_sid.get(sid) or []
            tot = sum(t["out"] for t in ts) or 0
            for t in ts:
                if t["ts"]:
                    cost[day_of(local(t["ts"])).isoformat()] += s["cost"] * (t["out"] / tot if tot else 1 / len(ts))
        # sessions at once, by day (minutes of yours)
        par = defaultdict(lambda: {"peak": 0, "sum": 0, "work": 0, "peakAll": 0, "sub": 0})
        if self.minute:
            lo, Y, A, Sb = self.minute["lo"], self.minute["you"], self.minute["all"], self.minute["sub"]
            off_cache = {}
            for i in range(len(Y)):
                a = A[i]
                if not a and not Sb[i]:
                    continue
                m = lo + i
                hh = m // 60
                off = off_cache.get(hh)
                if off is None:
                    off = off_cache[hh] = datetime.fromtimestamp(hh * 3600).astimezone().utcoffset().total_seconds() // 60
                lm = m + off - DAY_START * 60
                d = date(1970, 1, 1) + timedelta(days=int(lm // 1440))
                p = par[d.isoformat()]
                y = Y[i]
                if y:
                    p["work"] += 1
                    p["sum"] += y
                p["peak"] = max(p["peak"], y)
                p["peakAll"] = max(p["peakAll"], a)
                p["sub"] = max(p["sub"], Sb[i])
        first, last = date.fromisoformat(msgs[0]["day"]), date.fromisoformat(msgs[-1]["day"])
        days, streak, prev_end = [], 0, None
        d = first
        while d <= last:
            k = d.isoformat()
            v = sorted(by_day.get(k) or [], key=lambda m: m["ts"])
            vp = [m for m in v if m["kind"] == "prompt"]
            streak = streak + 1 if v else 0
            row = {"day": k, "dow": d.weekday(), "n": len(v), "streak": streak}
            if v:
                hs = [m["hour"] for m in v]
                gaps = [(b - a) * 3600 for a, b in zip(hs, hs[1:])]
                breaks = [g for g in gaps if g >= BREAK]
                longest = run = 0.0
                for g in gaps:
                    if g >= BREAK:
                        longest, run = max(longest, run), 0.0
                    else:
                        run += g
                longest = max(longest, run)
                span = hs[-1] - hs[0]
                active = span - sum(breaks) / 3600
                switches = sum(a["project"] != b["project"] for a, b in zip(v, v[1:]))
                lab = [m for m in vp if m["intent"]]
                nl = len(lab)
                sig = [m for m in vp if m["who"] is not None]
                ns = len(sig)
                fam = Counter(m["family"] for m in lab)
                ty = sum(m["typos"] for m in vp)
                tw = sum(m["checked"] for m in vp)
                projects = Counter(m["project"] for m in v)
                p = par.get(k) or {}
                w = work.get(k) or {}
                vt = [m for m in v if m["origin"] != "history"]
                full = bool(self.full_from) and k >= self.full_from
                row.update({
                    "start": round(hs[0], 2), "end": round(hs[-1], 2), "span": round(span, 2), "active": round(active, 2),
                    "breaks": len(breaks), "stretch": round(longest / 3600, 2), "late": hs[-1] >= 23,
                    "rest": round((date.fromisoformat(k) - date.fromisoformat(prev_end[0])).days * 24 + hs[0] - prev_end[1], 1) if prev_end else None,
                    "projects": len(projects), "top": projects.most_common(1)[0][0], "sessions": len({m["sid"] for m in v}),
                    "switchH": round(switches / active, 2) if active >= .5 else None,
                    "labelled": nl, "fam": dict(fam),
                    "goahead": pct(sum(m["intent"] == "go-ahead" for m in lab), nl) if nl >= 10 else None,
                    "correct": pct(sum(m["intent"] == "correct" for m in lab), nl) if nl >= 10 else None,
                    "specific": share_work(lab, 10),
                    "frustrated": pct(sum(m["tone"] == "frustrated" for m in lab), nl) if nl >= 10 else None,
                    "pleased": pct(sum(m["tone"] == "pleased" for m in lab), nl) if nl >= 10 else None,
                    "sig": ns, "own": pct(sum(bool(m["own"]) for m in sig), ns) if ns >= 10 else None,
                    "handed": pct(sum(m["who"] == "claude" for m in sig), ns) if ns >= 10 else None,
                    "irkClaude": pct(sum(m["irk"] == "claude" for m in sig), ns) if ns >= 10 else None,
                    "words": med([m["words"] for m in vp]), "typos": round(100 * ty / tw, 2) if tw >= 100 else None,
                    "french": pct(sum(m["lang"] == "fr" for m in vp), len(vp)), "voice": sum(m["src"] == "massistant" for m in v),
                    "stopped": sum(m["stopped"] for m in vt), "queued": sum(m["queued"] for m in vt),
                    "commits": sum(m["commits"] for m in vt), "prs": sum(m["prs"] for m in vt),
                    "lines": sum(m["add"] + m["del"] for m in vt), "files": sum(m["files"] for m in vt), "tools": sum(m["tools"] for m in vt),
                    "peak": p.get("peak", 0), "avgAt": round(p["sum"] / p["work"], 2) if p.get("work") else None,
                    "sessionH": round(p.get("work", 0) / 60, 1), "peakAll": p.get("peakAll", 0), "subPeak": p.get("sub", 0),
                    "claudeH": round(w.get("secs", 0) / 3600, 1), "autoTurns": w.get("auto", 0), "out": w.get("out", 0),
                    "cost": round(cost.get(k, 0), 2) if cost.get(k) else None,
                    "history": len(v) - len(vt),
                })
                if not full:  # prompts only: what each one set off isn't known
                    for x in ("stopped", "queued", "commits", "prs", "lines", "files", "tools", "peak", "avgAt", "sessionH",
                              "peakAll", "subPeak", "claudeH", "autoTurns", "out"):
                        row[x] = None
                prev_end = (k, hs[-1])
            c = self.checkins.get(k)
            if c:
                row["check"] = {x: c[x] for x in ("energy", "mood", "focus", "note", "late") if x in c}
            days.append(row)
            d += timedelta(days=1)
        self.days = days

    # -- weeks ---------------------------------------------------------------------------------
    def _weeks(self):
        wk = defaultdict(list)
        for r in self.days:
            wk[week_of(date.fromisoformat(r["day"]))].append(r)
        mw = defaultdict(list)
        for m in self.messages:
            if m["kind"] == "prompt":
                mw[week_of(date.fromisoformat(m["day"]))].append(m)
        weeks = []

        def cl(x, nd=1):
            return round(x, nd) if x is not None else None
        for w, rs in sorted(wk.items()):
            on = [r for r in rs if r["n"]]
            ms = mw.get(w, [])
            lab = [m for m in ms if m["intent"]]
            nl = len(lab)
            fam = Counter(m["family"] for m in lab)
            sig = [m for m in ms if m["who"] is not None]
            row = {
                "week": w, "days": len(on), "off": sum(1 for r in rs if not r["n"]), "n": len(ms), "labelled": nl,
                "fam": {f: fam.get(f, 0) for f, _, _ in FAMILIES},
                "intents": dict(Counter(m["intent"] for m in lab)),
                "span": med([r["span"] for r in on]), "start": med([r["start"] for r in on], 2), "end": med([r["end"] for r in on], 2),
                "projects": med([r["projects"] for r in on]), "switchH": med([r.get("switchH") for r in on]),
                "rest": med([r.get("rest") for r in on]), "avgAt": med([r["avgAt"] for r in on], 2), "peak": max((r["peak"] for r in on if r["peak"] is not None), default=None),
                "words": med([m["words"] for m in ms]), "tools": med([m["tools"] for m in ms]),
                "specific": share_work(lab, 30),
                "frustrated": pct(sum(m["tone"] == "frustrated" for m in lab), nl) if nl >= 30 else None,
                "pleased": pct(sum(m["tone"] == "pleased" for m in lab), nl) if nl >= 30 else None,
                "correct": pct(sum(m["intent"] == "correct" for m in lab), nl) if nl >= 30 else None,
                "goahead": pct(sum(m["intent"] == "go-ahead" for m in lab), nl) if nl >= 30 else None,
                "french": pct(sum(m["lang"] == "fr" for m in ms), len(ms)) if ms else None,
                "stopped": pct(sum(m["stopped"] for m in mt), len(mt)) if (mt := [m for m in ms if m["origin"] != "history"]) else None,
                "commits": tot(on, "commits"), "lines": tot(on, "lines"),
                "prs": tot(on, "prs"), "claudeH": cl(tot(on, "claudeH")),
                "cost": cl(tot(on, "cost"), 2) if any(r.get("claudeH") is not None for r in on) else None,
                "late": sum(r.get("late", False) for r in on), "history": sum(r.get("history", 0) for r in on),
                "reply": med([m["gap"] for m in ms if m["gap"] is not None and 0 <= m["gap"] <= BREAK], 0),
                # the second label set, as counts: the app shows shares only where enough are labelled
                "sig": len(sig), "own": sum(bool(m["own"]) for m in sig), "who": dict(Counter(m["who"] for m in sig)),
                "scope": dict(Counter(m["scope"] for m in sig)), "irk": dict(Counter(m["irk"] for m in sig if m["irk"] != "none")),
                "play": sum(bool(m["play"]) for m in sig), "pressure": sum(bool(m["pressure"]) for m in sig),
            }
            weeks.append(row)
        self.weeks = weeks

    # -- projects ------------------------------------------------------------------------------
    def _projects(self):
        by = defaultdict(list)
        for m in self.messages:
            by[m["project"]].append(m)
        weeks = [w["week"] for w in self.weeks]
        out = []
        for p, v in by.items():
            lab = [m for m in v if m["intent"]]
            wc = Counter(week_of(date.fromisoformat(m["day"])) for m in v)
            days = sorted({m["day"] for m in v})
            out.append({
                "project": p, "n": len(v), "first": v[0]["ts"], "last": v[-1]["ts"], "days": len(days),
                "sessions": len({m["sid"] for m in v}), "fam": dict(Counter(m["family"] for m in lab)),
                "tools": tot(v, "tools"), "commits": tot(v, "commits"), "prs": tot(v, "prs"),
                "lines": tot([{"x": m["add"] + m["del"]} for m in v if m["add"] is not None], "x"),
                "claudeH": round(tot(v, "dur") / 3600, 1) if tot(v, "dur") is not None else None,
                "words": med([m["words"] for m in v]), "frustrated": pct(sum(m["tone"] == "frustrated" for m in lab), len(lab)),
                "weekly": [wc.get(w, 0) for w in weeks],
                "cost": round(sum((s.get("cost") or 0) for s in self.sessions.values() if s["project"] == p), 2),
            })
        out.sort(key=lambda r: -r["n"])
        self.projects = out

    # -- the profile ------------------------------------------------------------------------------
    def _profile(self):
        P = [m for m in self.messages if m["kind"] == "prompt"]
        lab = [m for m in P if m["intent"]]
        on = [r for r in self.days if r["n"]]
        if not P or not on:
            self.profile = {"empty": True}
            return
        last = date.fromisoformat(on[-1]["day"])
        cut = (last - timedelta(days=27)).isoformat()
        recent = [m for m in P if m["day"] >= cut]
        before = [m for m in P if m["day"] < cut]
        rl, bl = [m for m in recent if m["intent"]], [m for m in before if m["intent"]]
        sig = [m for m in P if m["who"] is not None]
        sr, sb = [m for m in sig if m["day"] >= cut], [m for m in sig if m["day"] < cut]
        coverage = {"categories": {"labelled": len(lab), "of": len(P), "version": self.labels["versions"].get("categories")},
                    "signals": {"labelled": len(sig), "of": len(P), "version": self.labels["versions"].get("signals")}}
        for c in coverage.values():
            c["covered"] = c["labelled"] >= COVERED * c["of"]
        on_r, on_b = [r for r in on if r["day"] >= cut], [r for r in on if r["day"] < cut]

        def share(ms, f):
            return pct(sum(1 for m in ms if f(m)), len(ms))

        def weekly(key):
            return [[w["week"], w.get(key)] for w in self.weeks]

        def weekly_share(f, need=30, base=None):
            out = []
            mw = defaultdict(list)
            for m in (lab if base is None else base):
                mw[week_of(date.fromisoformat(m["day"]))].append(m)
            for w in self.weeks:
                ms = mw.get(w["week"], [])
                out.append([w["week"], pct(sum(1 for m in ms if f(m)), len(ms)) if len(ms) >= need else None])
            return out

        fams = {f: share(lab, lambda m, f=f: m["family"] == f) for f, _, _ in FAMILIES}
        T = []

        def trait(key, group, name, value, unit, now, then, series, sentence, lower_is="", detail=None):
            if value is None:  # a new user, or labels not there yet: say so rather than print "None"
                sentence = "Not enough data yet."
            T.append({"key": key, "group": group, "name": name, "value": value, "unit": unit, "recent": now, "before": then,
                      "series": series, "sentence": sentence, "detail": detail or {}})

        tools_all, tools_r, tools_b = med([m["tools"] for m in P], 0), med([m["tools"] for m in recent], 0), med([m["tools"] for m in before], 0)
        trait("reach", "lead", "Reach of a message", tools_all, "tool calls",
              tools_r, tools_b, weekly("tools"),
              f"A message of yours sets off a median of {g(tools_all)} tool calls before you speak again.")
        wk = [m for m in lab if m["intent"] in WORK]

        def spec(m):
            return bool(m["specific"])
        sp = share(wk, spec)
        trait("precision", "lead", "Says what done looks like", sp, "%", share([m for m in rl if m["intent"] in WORK], spec),
              share([m for m in bl if m["intent"] in WORK], spec), weekly_share(spec, base=wk),
              f"Of your requests for work, {rd(sp)}% say what done looks like.")
        ga = share(lab, lambda m: m["intent"] == "go-ahead")
        trait("approve", "lead", "Bare go-aheads", ga, "%", share(rl, lambda m: m["intent"] == "go-ahead"), share(bl, lambda m: m["intent"] == "go-ahead"),
              weekly_share(lambda m: m["intent"] == "go-ahead"), f"{rd(ga)}% of what you send is a bare yes or continue.")
        co = share(lab, lambda m: m["intent"] == "correct")
        trait("steer", "lead", "Corrections", co, "%", share(rl, lambda m: m["intent"] == "correct"), share(bl, lambda m: m["intent"] == "correct"),
              weekly_share(lambda m: m["intent"] == "correct"), f"{g(co)}% of your messages correct or redirect Claude.")
        if coverage["signals"]["covered"]:
            def own(m):
                return bool(m["own"])

            def handed(m):
                return m["who"] == "claude"
            # who decides is counted among messages that decide something (plain questions, thanks and facts left out)
            def dec(ms):
                return [m for m in ms if m["who"] != "none"]
            ow, hd, yo = share(sig, own), share(dec(sig), handed), share(dec(sig), lambda m: m["who"] == "alex")
            trait("own", "lead", "Ideas of your own", ow, "%", share(sr, own), share(sb, own), weekly_share(own, base=sig),
                  f"{rd(ow)}% of your messages bring an idea of your own, beyond what you ask for.")
            trait("handed", "lead", "Hands Claude the call", hd, "%", share(dec(sr), handed), share(dec(sb), handed), weekly_share(handed, base=dec(sig)),
                  f"Of your messages that decide something, you leave {g(hd)}% of the calls to Claude and make {rd(yo)}% yourself.", detail={"you": yo})
        full = [m for m in P if m["origin"] != "history"]
        st = share(full, lambda m: m["stopped"])
        trait("stop", "lead", "Turns you stop", st, "%", share([m for m in full if m["day"] >= cut], lambda m: m["stopped"]),
              share([m for m in full if m["day"] < cut], lambda m: m["stopped"]),
              weekly("stopped"), f"You stop Claude mid-turn on {g(st)}% of your messages.")
        avg = med([r["avgAt"] for r in on], 2)
        pk = max((r["peak"] for r in on if r["peak"] is not None), default=0)
        trait("parallel", "attention", "Sessions at once", avg, "sessions", med([r["avgAt"] for r in on_r], 2), med([r["avgAt"] for r in on_b], 2),
              weekly("avgAt"), f"While you work, a typical day averages {g(avg)} of your sessions running at once; the most was {pk}.",
              detail={"peak": pk})
        pj = med([r["projects"] for r in on])
        trait("breadth", "attention", "Projects a day", pj, "projects", med([r["projects"] for r in on_r]), med([r["projects"] for r in on_b]),
              weekly("projects"), f"On a typical day you touch {g(pj)} projects.")
        sw = med([r["switchH"] for r in on])
        trait("switch", "attention", "Switches an hour", sw, "switches", med([r["switchH"] for r in on_r]), med([r["switchH"] for r in on_b]),
              weekly("switchH"), f"You jump between projects {g(sw)} times an hour.")
        span = med([r["span"] for r in on])
        st_, en_ = med([r["start"] for r in on], 2), med([r["end"] for r in on], 2)
        trait("day", "rhythm", "Length of a day", span, "hours", med([r["span"] for r in on_r]), med([r["span"] for r in on_b]),
              weekly("span"), f"Your day runs {g(span)} hours, from about {fmt_h(st_)} to {fmt_h(en_)}.", detail={"start": st_, "end": en_})
        rest = med([r["rest"] for r in on if r.get("rest") is not None])
        trait("rest", "rhythm", "Night off the keyboard", rest, "hours", med([r["rest"] for r in on_r if r.get("rest") is not None]),
              med([r["rest"] for r in on_b if r.get("rest") is not None]), weekly("rest"),
              f"Between your last message and the next morning's first: {g(rest)} hours.")
        streak = on[-1]["streak"] if on[-1]["day"] == self.days[-1]["day"] else 0
        trait("streak", "rhythm", "Days in a row", streak, "days", None, None, [[w["week"], w["days"]] for w in self.weeks],
              f"{streak} days in a row with Claude; {len(on)} of the last {len(self.days)} days.", detail={"longest": max(r["streak"] for r in self.days)})
        words = med([m["words"] for m in P], 0)
        trait("brevity", "voice", "Words a message", words, "words", med([m["words"] for m in recent], 0), med([m["words"] for m in before], 0),
              weekly("words"), f"Half your messages are {g(words)} words or fewer.")
        fr = share(P, lambda m: m["lang"] == "fr")
        trait("french", "voice", "In French", fr, "%", share(recent, lambda m: m["lang"] == "fr"), share(before, lambda m: m["lang"] == "fr"),
              weekly("french"), f"{g(fr)}% of your messages are in French.")
        fz = share(lab, lambda m: m["tone"] == "frustrated")
        pl = share(lab, lambda m: m["tone"] == "pleased")
        trait("temper", "voice", "Sounds frustrated", fz, "%", share(rl, lambda m: m["tone"] == "frustrated"), share(bl, lambda m: m["tone"] == "frustrated"),
              weekly_share(lambda m: m["tone"] == "frustrated"), f"{g(fz)}% of your messages sound frustrated, {g(pl)}% pleased.", detail={"pleased": pl})
        if coverage["signals"]["covered"]:
            def irk(m):
                return m["irk"] == "claude"
            ic, io = share(sig, irk), share(sig, lambda m: m["irk"] == "other")
            trait("irk", "voice", "Annoyed at Claude", ic, "%", share(sr, irk), share(sb, irk), weekly_share(irk, base=sig),
                  f"{g(ic)}% of your messages show annoyance at Claude's work, {g(io)}% at something else.", detail={"other": io})
        rep = med([m["gap"] for m in P if m["gap"] is not None and 0 <= m["gap"] <= BREAK], 0)
        trait("reply", "voice", "Time to answer", rep, "seconds", med([m["gap"] for m in recent if m["gap"] is not None and 0 <= m["gap"] <= BREAK], 0),
              med([m["gap"] for m in before if m["gap"] is not None and 0 <= m["gap"] <= BREAK], 0), weekly("reply"),
              f"When Claude finishes, you answer in a median {fmt_s(rep)}.")
        cpd = med([r["commits"] for r in on])
        trait("ship", "output", "Commits a day", cpd, "commits", med([r["commits"] for r in on_r]), med([r["commits"] for r in on_b]),
              [[w["week"], round(w["commits"] / w["days"], 1) if w["days"] and w["commits"] is not None else None] for w in self.weeks],
              f"A typical day ends with {g(cpd)} commits.")
        ch = med([r["claudeH"] for r in on])
        trait("work", "output", "Claude's hours a day", ch, "hours", med([r["claudeH"] for r in on_r]), med([r["claudeH"] for r in on_b]),
              [[w["week"], round(w["claudeH"] / w["days"], 1) if w["days"] and w["claudeH"] is not None else None] for w in self.weeks],
              f"Claude works {g(ch)} hours on a typical day of yours, across sessions.")

        # what defines you: how you split your messages, now and before
        mix_now = {f: share(rl, lambda m, f=f: m["family"] == f) for f, _, _ in FAMILIES}
        mix_before = {f: share(bl, lambda m, f=f: m["family"] == f) for f, _, _ in FAMILIES}

        # eras: runs of weeks led by the same project
        eras = []
        for w in self.weeks:
            ms = [m for m in self.messages if week_of(date.fromisoformat(m["day"])) == w["week"]]
            if not ms:
                continue
            c = Counter(m["project"] for m in ms)
            top, n = c.most_common(1)[0]
            if eras and eras[-1]["project"] == top:
                eras[-1]["to"] = w["week"]
                eras[-1]["n"] += n
                eras[-1]["weeks"] += 1
            else:
                eras.append({"project": top, "from": w["week"], "to": w["week"], "n": n, "weeks": 1, "share": round(100 * n / len(ms))})

        firsts = self._firsts(on)
        self.profile = {
            "since": on[0]["day"], "until": on[-1]["day"], "recentFrom": cut, "fullFrom": self.full_from,
            "coverage": coverage,
            "totals": {"messages": len(P), "labelled": len(lab), "days": len(on), "of": len(self.days),
                       "sessions": sum(1 for s in self.sessions.values() if s["kind"] == "you"),
                       "sideSessions": sum(1 for s in self.sessions.values() if s["kind"] == "side"),
                       "autoSessions": sum(1 for s in self.sessions.values() if s["kind"] == "auto"),
                       "projects": len({m["project"] for m in P}), "commits": tot(self.messages, "commits") or 0,
                       "prs": tot(self.messages, "prs") or 0, "lines": sum(m["add"] + m["del"] for m in self.messages if m["add"] is not None),
                       "tools": tot(self.messages, "tools") or 0, "words": sum(m["words"] for m in P),
                       "history": sum(m["origin"] == "history" for m in self.messages),
                       "claudeH": round(tot(on, "claudeH") or 0), "out": tot(on, "out") or 0,
                       "cost": round(sum(r.get("cost") or 0 for r in on)),
                       "costSessions": sum(1 for s in self.sessions.values() if s.get("cost")), "allSessions": len(self.sessions)},
            "families": [{"key": f, "name": n, "intents": ins, "share": fams[f], "recent": mix_now[f], "before": mix_before[f]} for f, n, ins in FAMILIES],
            "intents": [{"key": k, "name": INTENT_NAMES[k], "family": FAMILY_OF[k],
                         "n": sum(1 for m in lab if m["intent"] == k)} for k in INTENT_NAMES],
            "traits": T, "eras": eras, "firsts": firsts,
            "typos": self.typo_words.most_common(40),
        }

    def _memory(self, records):
        """Your agents' notes about you, each with how often Claude opened it and the message of yours that led to it."""
        ns = memory.notes()
        reads, first_write = {}, {}
        by_sid = defaultdict(list)
        for m in self.messages:
            by_sid[m["sid"]].append(m)
        for path, r in records:
            stem = os.path.splitext(os.path.basename(path))[0]
            sid = path.split("/subagents/")[0].rsplit("/", 1)[-1] if r.get("sub") else stem
            for p, ts in (r.get("docs") or {}).get("reads") or []:
                if "/memory/" in p:
                    reads[p] = reads.get(p, 0) + 1
            for p, ts in (r.get("docs") or {}).get("writes") or []:
                if "/memory/" in p and ts and (p not in first_write or ts < first_write[p][0]):
                    first_write[p] = (ts, sid)
        out = []
        for n in ns:
            fw = first_write.get(n["path"])
            taught = None
            if fw:
                cands = [m for m in by_sid.get(fw[1], []) if m["ts"] <= fw[0] and m["kind"] == "prompt"]
                if cands:
                    c = cands[-1]
                    taught = {"id": c["id"], "text": c["text"][:220], "day": c["day"], "intent": c["intent"], "family": c["family"]}
            n = dict(n)
            n.update(reads=reads.get(n.pop("path"), 0), written=day_of(local(fw[0])).isoformat() if fw else None, taught=taught)
            out.append(n)
        counts = Counter(n["type"] for n in out)
        self.memory = {"counts": dict(counts), "notes": sorted([n for n in out if n["type"] in ("user", "feedback")], key=lambda n: -n["mtime"]),
                       "projects": len({n["project"] for n in out}), "total": len(out),
                       "reads": sum(n["reads"] for n in out)}

    def _firsts(self, on):
        out = []

        def add(key, label, day, value=None, mid=None):
            if day:
                out.append({"key": key, "label": label, "day": day, "value": value, "id": mid})
        P = [m for m in self.messages if m["kind"] == "prompt"]
        add("first", "Your first message here", P[0]["day"], None, P[0]["id"])
        r = max(on, key=lambda r: r["n"])
        add("busiest", "Your busiest day", r["day"], f"{r['n']} messages")
        r = max(on, key=lambda r: r["span"])
        add("longest", "Your longest day", r["day"], f"{r['span']:.1f} hours")
        full = [r for r in on if r["peak"] is not None]
        if full:
            r = max(full, key=lambda r: r["peak"])
            add("parallel", "Most sessions at once", r["day"], f"{r['peak']} sessions")
            r = max(full, key=lambda r: r["commits"])
            add("commits", "Most commits in a day", r["day"], f"{r['commits']} commits")
        r = max(on, key=lambda r: r["projects"])
        add("projects", "Most projects in a day", r["day"], f"{r['projects']} projects")
        m = next((m for m in self.messages if m["spawn"]), None)
        if m:
            add("spawn", "First time Claude started another session for you", m["day"], None, m["id"])
        m = next((m for m in self.messages if m["mode"] == "auto"), None)
        if m:
            add("auto", "First message in auto mode", m["day"], None, m["id"])
        m = next((m for m in self.messages if m["src"] == "massistant"), None)
        if m:
            add("bridge", "First message through Massistant", m["day"], None, m["id"])
        m = max((m for m in P if m["tools"] is not None), key=lambda m: m["tools"], default=None)
        if m:
            add("reach", "The message that set off the most work", m["day"], f"{m['tools']} tool calls", m["id"])
        out.sort(key=lambda x: x["day"])
        return out

    # ---------------------------------------------------------------------------------------
    def day_detail(self, day):
        """One day as a score: each session a lane, Claude's turns as bars, your messages as marks."""
        turns = []
        for t in self.turns.values():
            if not t["ts"]:
                continue
            L = local(t["ts"])
            if day_of(L).isoformat() != day:
                continue
            m = self.msg_by_id.get(t["key"])
            E = local(t["end"]) if t["end"] else L
            turns.append({"id": t["key"], "sid": t["sid"], "project": t["project"], "src": t["src"], "kind": t["kind"],
                          "at": round(hour_of(L), 4), "to": round(hour_of(L) + max(0, (E - L).total_seconds()) / 3600, 4),
                          "tools": t["tools"], "commits": t["commits"], "prs": t["prs"], "stopped": t["interrupted"],
                          "files": len(t["files"]), "lines": t["add"] + t["del"], "mine": bool(m),
                          "family": m["family"] if m else None, "intent": m["intent"] if m else None, "tone": m["tone"] if m else None,
                          **({k: m[k] for k in ("own", "who", "scope", "pressure", "irk", "play")} if m else {}),
                          "text": (m["text"] if m else own_words(t["text"]))[:200]})
        for m in self.messages:  # prompts from history.jsonl: marks with nothing set off
            if m["day"] == day and m["origin"] == "history":
                turns.append({"id": m["id"], "sid": m["sid"], "project": m["project"], "src": m["src"], "kind": m["kind"],
                              "at": m["hour"], "to": m["hour"], "tools": None, "commits": None, "prs": None, "stopped": None,
                              "files": None, "lines": None, "mine": True, "origin": "history",
                              "family": m["family"], "intent": m["intent"], "tone": m["tone"],
                              **{k: m[k] for k in ("own", "who", "scope", "pressure", "irk", "play")}, "text": m["text"][:200]})
        turns.sort(key=lambda t: t["at"])
        sids = []
        for t in turns:
            if t["sid"] not in sids:
                sids.append(t["sid"])
        sessions = []
        for sid in sids:
            s = self.sessions.get(sid) or {}
            sessions.append({"sid": sid, "project": s.get("project"), "title": s.get("title"), "kind": s.get("kind"),
                             "ex": s.get("ex"), "model": s.get("model"), "subs": s.get("subs", 0)})
        row = next((r for r in self.days if r["day"] == day), None)
        # sessions at once through the day, in 10-minute steps
        curve = []
        if self.minute:
            d0 = datetime.fromisoformat(day).replace(hour=DAY_START).astimezone()
            m0 = int(d0.timestamp() // 60)
            lo, Y, A = self.minute["lo"], self.minute["you"], self.minute["all"]
            for i in range(0, 24 * 60, 10):
                j = m0 + i - lo
                if 0 <= j < len(Y):
                    seg_y, seg_a = Y[j:j + 10], A[j:j + 10]
                    curve.append([round(DAY_START + i / 60, 3), max(seg_y), max(seg_a)])
        # the day's account (days label set), a model's reading: decided, dropped, postponed, high and low points
        # as {"t": what, "m": message id}, signs of strain and a short account
        acc = (self.labels.get("days") or {}).get(day)
        account = {k: v for k, v in acc.items() if k not in ("h", "v")} if isinstance(acc, dict) else None
        if account:  # the [a7176289] citations in its texts, resolved to message ids
            account["citeIds"] = cites([account.get("account"), account.get("strain")], self.by_short)
        return {"day": day, "row": row, "sessions": sessions, "turns": turns, "curve": curve, "account": account}

    def message_detail(self, mid):
        t = self.turns.get(mid)
        if not t and mid in self.history:
            e = self.history[mid]
            return {"id": mid, "text": e["text"], "own": history_text(e)[0], "reply": None, "files": None, "sid": e["sid"],
                    "cwd": tilde(e.get("cwd") or ""), "title": None, "truncated": False,
                    "skills": None, "perm": None, "origin": "history"}
        if not t:
            return None
        s = self.sessions.get(t["sid"]) or {}
        return {"id": mid, "text": t["text"], "own": own_words(t["text"]) if t["kind"] == "prompt" else t["text"], "reply": t.get("reply") or "", "files": [tilde(f) for f in t["files"]],
                "sid": t["sid"], "cwd": tilde(t.get("cwd") or ""), "title": s.get("title"),
                "truncated": t["chars"] > len(t["text"]), "skills": t.get("skills") or [], "perm": t.get("perm") or {},
                "origin": t.get("origin") or "transcript"}


def share_work(ms, need):
    """Share of requests for work that say what done looks like, when there are enough of them."""
    w = [m for m in ms if m["intent"] in WORK]
    return pct(sum(bool(m["specific"]) for m in w), len(w)) if len(w) >= need else None


def rd(x):
    return "?" if x is None else round(x)


def g(x):
    return "?" if x is None else f"{x:g}"


def fmt_h(h):
    if h is None:
        return "?"
    h = h % 24
    return f"{int(h):02d}:{int(round((h % 1) * 60)) % 60:02d}"


def fmt_s(s):
    if s is None:
        return "?"
    return f"{round(s)} seconds" if s < 90 else f"{round(s / 60)} minutes"
