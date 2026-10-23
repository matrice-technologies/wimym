"""Practices, limits and the growth log: what the person decides, kept in the data dir (never a cache).

practices.json  {"practices": [practice, …]}. A practice:
    id        short slug, e.g. "stop-at-21"
    text      what the person (or the agents) will do differently, in their words
    owner     "person" or "agents"; for agents, where says where the rule lives (memory, CLAUDE.md, a skill)
    measure   a measure key ("late", "switches", …) read week by week from the database's vitals table,
    sql       or a read-only query returning one number for the days from :start to :end (end excluded)
    target    optional, how to tell it held: "<= 0", ">= 7", "< 2.5"
    start     first day of the trial (YYYY-MM-DD); trial: its length in days (default 14)
    status    trying | kept | changed | dropped
    verdicts  [{"at", "verdict": keep|change|drop, "note"}], the person's calls, oldest first
    why       what it answers (a moment, a finding), optional
limits.json     {"stopHour": 21, "daysOffPerWeek": 1, "maxSessions": 4, "at": iso}; absent keys mean not set.
log.jsonl       one line per entry: {"at", "kind": finding|retro|practice|limit|note, "text", "week", "refs": [message ids],
                "practice"}. Appended, never rewritten.

Nothing here is written without the person asking for it: the CLI and the skills call these
functions only after the person's yes.
"""
import fcntl
import json
import os
import re
import threading
from datetime import date, datetime

from . import paths
from .paths import DATA_DIR

class _Lock:
    """One writer at a time across threads and processes (the engine's server and the CLI): a reentrant thread
    lock plus an flock on <data dir>/.practices.lock, held from the first acquire to the last release. store.py
    takes it too (`with practices._lock:`) when it writes priorities into limits.json."""

    def __init__(self):
        self._t = threading.RLock()
        self._depth = 0
        self._f = None

    def __enter__(self):
        self._t.acquire()
        if self._depth == 0:
            os.makedirs(DATA_DIR, exist_ok=True)
            self._f = open(os.path.join(DATA_DIR, ".practices.lock"), "a")
            fcntl.flock(self._f, fcntl.LOCK_EX)
        self._depth += 1
        return self

    def __exit__(self, *exc):
        self._depth -= 1
        if self._depth == 0:
            fcntl.flock(self._f, fcntl.LOCK_UN)
            self._f.close()
            self._f = None
        self._t.release()
        return False


_lock = _Lock()
OWNERS = ("person", "agents")
STATUSES = ("trying", "kept", "changed", "dropped")
VERDICTS = {"keep": "kept", "change": "changed", "drop": "dropped"}
KINDS = ("finding", "retro", "practice", "limit", "note")
LIMITS = {"stopHour": (0, 30), "daysOffPerWeek": (0, 7), "maxSessions": (1, 50)}
TARGET = re.compile(r"^\s*(<=|>=|<|>|==)\s*(-?\d+(?:\.\d+)?)\s*$")


def path(name):
    return os.path.join(DATA_DIR, name)


def mtime():
    """Latest change to any of the three files, so the database knows when to reload them."""
    out = 0
    for n in ("practices.json", "limits.json", "log.jsonl"):
        try:
            out = max(out, os.path.getmtime(path(n)))
        except OSError:
            pass
    return out


def _now():
    return datetime.now().isoformat(timespec="seconds")


class BadFile(ValueError):
    pass


def _read(name, default, writing=False):
    """The file's content; default when it doesn't exist. A file that exists but won't parse is never treated as
    empty, since the next write would wipe it: reading warns and returns default; writing sets it aside as
    <name>.bad-<time>, says so, and refuses (raises BadFile), so nothing is overwritten."""
    p = path(name)
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        if not isinstance(d, dict):
            raise ValueError("not a JSON object")
        return d
    except FileNotFoundError:
        return default
    except (OSError, ValueError) as e:
        import sys
        if not writing:
            print(f"wimym: {paths.tilde(p)} can't be read ({e}); showing nothing from it until it is fixed", file=sys.stderr)
            return default
        bad = f"{p}.bad-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        try:
            os.replace(p, bad)
        except OSError:
            bad = None
        raise BadFile(f"{paths.tilde(p)} couldn't be read ({e})" + (f"; it was set aside as {paths.tilde(bad)}" if bad else "")
                      + ". Nothing was written: fix it or move it back, then try again.")


def _write(name, obj):
    paths.write_json(path(name), obj, indent=1, ensure_ascii=False)


# -- practices ---------------------------------------------------------------------------------

def practices():
    return _read("practices.json", {}).get("practices") or []


def _practices_for_write():
    return _read("practices.json", {}, writing=True).get("practices") or []


def get(pid):
    return next((p for p in practices() if p["id"] == pid), None)


def held(target, value):
    """True or False when a target and a value are given, else None."""
    m = TARGET.match(target or "")
    if not m or value is None:
        return None
    op, x = m.group(1), float(m.group(2))
    return {"<=": value <= x, ">=": value >= x, "<": value < x, ">": value > x, "==": value == x}[op]


def _slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return "-".join(s.split("-")[:5]) or "practice"


def add(text, owner="person", measure=None, sql=None, target=None, start=None, trial=14, why=None, where=None, pid=None):
    text = (text or "").strip()
    if not text:
        raise ValueError("a practice needs its text")
    if owner not in OWNERS:
        raise ValueError(f"owner is one of {', '.join(OWNERS)}")
    if target and not TARGET.match(target):
        raise ValueError('target looks like "<= 0" or ">= 7"')
    start = start or date.today().isoformat()
    date.fromisoformat(start)
    with _lock:
        ps = _practices_for_write()
        pid = pid or _slug(text)
        base, n = pid, 2
        while any(p["id"] == pid for p in ps):
            pid, n = f"{base}-{n}", n + 1
        p = {"id": pid, "text": text, "owner": owner, "where": where, "measure": measure, "sql": sql, "target": target,
             "start": start, "trial": int(trial), "status": "trying", "verdicts": [], "why": why, "at": _now()}
        ps.append({k: v for k, v in p.items() if v is not None})
        _write("practices.json", {"practices": ps})
    log_add(f"Started: {text}", kind="practice", practice=pid)
    return get(pid)


def verdict(pid, v, note=None):
    if v not in VERDICTS:
        raise ValueError(f"a verdict is one of {', '.join(VERDICTS)}")
    with _lock:
        ps = _practices_for_write()
        p = next((p for p in ps if p["id"] == pid), None)
        if not p:
            raise ValueError(f"no practice {pid}")
        p.setdefault("verdicts", []).append({"at": _now(), "verdict": v, **({"note": note} if note else {})})
        p["status"] = VERDICTS[v]
        _write("practices.json", {"practices": ps})
    log_add(f"{v.capitalize()}: {p['text']}" + (f" ({note})" if note else ""), kind="practice", practice=pid)
    return p


# -- limits ------------------------------------------------------------------------------------

def limits():
    d = _read("limits.json", {})
    return {k: d.get(k) for k in LIMITS} | {"at": d.get("at")}


def set_limit(key, value):
    if key not in LIMITS:
        raise ValueError(f"a limit is one of {', '.join(LIMITS)}")
    with _lock:
        d = _read("limits.json", {}, writing=True)
        if value is None:
            d.pop(key, None)
        else:
            lo, hi = LIMITS[key]
            v = float(value) if key == "stopHour" else int(value)
            if not lo <= v <= hi:
                raise ValueError(f"{key} is between {lo} and {hi}")
            d[key] = int(v) if v == int(v) else v
        d["at"] = _now()
        _write("limits.json", d)
    log_add(f"Limit {key}: {'cleared' if value is None else value}", kind="limit")
    return limits()


# -- the growth log ----------------------------------------------------------------------------

def log():
    out = []
    try:
        with open(path("log.jsonl"), encoding="utf-8") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out


def log_add(text, kind="note", week=None, refs=None, practice=None):
    text = (text or "").strip()
    if not text:
        raise ValueError("a log entry needs text")
    if kind not in KINDS:
        raise ValueError(f"kind is one of {', '.join(KINDS)}")
    e = {"at": _now(), "kind": kind, "text": text}
    if week:
        e["week"] = week
    if refs:
        e["refs"] = list(refs)
    if practice:
        e["practice"] = practice
    os.makedirs(DATA_DIR, exist_ok=True)
    with _lock, open(path("log.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(e, ensure_ascii=False) + "\n")
    return e
