"""Everything the engine knows, as one SQLite file: <cache dir>/wimym.db.

Derived and rebuildable: deleting it loses nothing. It is rebuilt whole (a few seconds) into a
temporary file and swapped in, so a reader never sees half of it:

- when it is missing or its schema is older than this code;
- when the labels or the person's own data (check-ins, practices, limits, the log) change;
- when transcripts changed and the file is older than max_age seconds (10 minutes by default),
  so a question asked mid-session doesn't wait on a rebuild for every new message.

It reads the index the engine keeps, and scans in memory any transcript newer than the index
without writing the index back (the engine owns that file); only when there is no index at all
does it build and save one, as the engine would on its first run.

What every table and column means, and what it can't be trusted for: docs/schema.md.
"""
import glob
import json
import os
import re
import sqlite3
import time
from bisect import bisect_left
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median, quantiles

from . import labels, practices, scan, store
from .index import Index
from .model import DAY_START, Model, day_of, local, secs, week_of
from . import paths
from .paths import CACHE_DIR, INDEX, LABELS_DIR
from .text import own_words

DB = os.path.join(CACHE_DIR, "wimym.db")
SCHEMA = 1          # raise when tables or columns change in a way old files can't serve
MAX_AGE = 600
BLOCK_GAP = 20 * 60  # a work block ends after 20 minutes without a message of yours
BLOCK_TAIL = 5 * 60  # and counts 5 minutes after its last message
READ_WPM = 250       # reading speed for "approved before it could be read"
APP = "http://127.0.0.1:8990"
DEFER = re.compile(
    r"\b(later|for now|not now|next week|tomorrow|someday|postpone\w*|defer\w*|put (?:it |this |that )?off|park(?:ed|ing)?|"
    r"backlog|come back to|revisit|parking lot|"
    r"plus tard|pour l'instant|pour le moment|demain|on verra|la semaine prochaine|report(?:er|ons|é)|en attendant)\b", re.I)


def link(mid):
    return f"{APP}/messages/{mid}"


# ---------------------------------------------------------------------------------------------
# freshness

def _mtime(p):
    try:
        return os.path.getmtime(p)
    except OSError:
        return 0


def _label_files():
    return sorted(glob.glob(os.path.join(LABELS_DIR, "*.json")) + glob.glob(os.path.join(LABELS_DIR, "next", "*.json")))


def inputs():
    """What the database was built from, cheap to read: compared with the copy kept in meta."""
    return {"schema": SCHEMA, "labels": {os.path.relpath(p, LABELS_DIR): _mtime(p) for p in _label_files()},
            "person": max(store.mtime(), practices.mtime()), "index": _mtime(INDEX)}


def _meta(path=DB):
    try:
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            return {k: json.loads(v) for k, v in c.execute("select key, value from meta")}
        finally:
            c.close()
    except sqlite3.Error:
        return None


def why_stale(max_age=MAX_AGE):
    """Why the database should be rebuilt, or None when it is fresh enough."""
    meta = _meta()
    if not meta or not os.path.exists(DB):
        return "no database yet"
    was, now = meta.get("inputs") or {}, inputs()
    if was.get("schema") != SCHEMA:
        return "schema changed"
    # the sets the messages' own columns come from; others (a relabel in next/, new sets being tried) wait for max_age
    settled = lambda d: {k: v for k, v in (d or {}).items() if k in ("categories.json", "signals.json", "audit-opus.json")}  # noqa: E731
    if settled(was.get("labels")) != settled(now["labels"]):
        return "labels changed"
    if was.get("person") != now["person"]:
        return "your check-ins, practices, limits or log changed"
    if time.time() - _mtime(DB) < max_age:
        return None
    if was.get("labels") != now["labels"]:
        return "new labels in a set being tried or relabelled"
    if was.get("index") != now["index"] or Index().stale():
        return "new transcripts"
    return None


def ensure(max_age=MAX_AGE, force=False, quiet=False):
    """Rebuild when stale; returns the path. Prints one line to stderr when it rebuilds."""
    why = "asked" if force else why_stale(max_age)
    if why:
        t = time.time()
        n = build()
        if not quiet:
            import sys
            print(f"wimym: database rebuilt ({why}): {n} messages in {time.time() - t:.1f}s", file=sys.stderr)
    return DB


# What a query may do: read tables and call functions, and the pragmas that only describe the schema.
# Everything else (writes, ATTACH, DETACH, transactions, other pragmas, VACUUM INTO) is refused, because
# the /wimym skill hands `wimym sql` to agents.
READ_PRAGMAS = {"table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo", "foreign_key_list",
                "function_list", "pragma_list", "collation_list", "compile_options"}
READ_STARTS = ("select", "with", "values", "explain", "pragma")
_ALLOWED = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, getattr(sqlite3, "SQLITE_RECURSIVE", 33)}
_DENY_FUNCS = {"load_extension", "fts3_tokenizer", "writefile", "readfile", "edit"}


def _authorize(action, a1, a2, dbname, source):
    if action == sqlite3.SQLITE_FUNCTION:
        return sqlite3.SQLITE_DENY if (a2 or "").lower() in _DENY_FUNCS else sqlite3.SQLITE_OK
    if action in _ALLOWED:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_PRAGMA and (a1 or "").lower() in READ_PRAGMAS:  # their argument is a table name
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def first_word(sql):
    """The statement's first keyword, after comments."""
    t = sql
    while True:
        t = t.lstrip()
        if t.startswith("--"):
            t = t.split("\n", 1)[1] if "\n" in t else ""
        elif t.startswith("/*"):
            t = t.split("*/", 1)[1] if "*/" in t else ""
        else:
            break
    m = re.match(r"[A-Za-z]+", t)
    return m.group(0).lower() if m else ""


def query(c, sql):
    """Run one statement on a connection from connect(), refusing anything but a read."""
    if first_word(sql) not in READ_STARTS:
        raise sqlite3.DatabaseError(f"only reads are allowed (select, with, values, explain, a schema pragma), not {first_word(sql) or 'that'}")
    return c.execute(sql)


def connect(path=DB):
    """A read-only connection: opened read only, query_only on, untrusted schema, and an authorizer that
    refuses anything but reading, so nothing a query does can change this file or create another."""
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    c.execute("pragma query_only = on")
    c.execute("pragma trusted_schema = off")
    c.set_authorizer(_authorize)
    c.row_factory = sqlite3.Row
    return c


# ---------------------------------------------------------------------------------------------
# reading the record

def records():
    """The index as the engine keeps it, with transcripts newer than it scanned in memory. The CLI never writes
    the index: with no index at all (the engine never ran), every transcript is scanned here, slowly."""
    ix = Index()
    for p, st in ix.stale():
        try:
            rec = scan.scan(p)
        except (OSError, UnicodeError):
            continue
        ix._keep(p, st, rec)  # never loses a turn the earlier record had (a transcript rewritten shorter)
    return ix.records()


def history():
    """Prompts from history.jsonl as the engine keeps them; read and saved here only when the engine never has."""
    try:
        from .history import KEPT, History
    except ImportError:
        return []
    h = History()
    h.save = lambda *a, **k: None  # read history.jsonl in memory; the engine owns history.json
    if not os.path.exists(KEPT):
        h.refresh()
    return h.list()


def codex():
    """Codex sessions as the engine keeps them (codex.json); read and saved here only when the engine never has."""
    try:
        from .codex import KEPT, Codex
    except ImportError:
        return []
    c = Codex()
    if not os.path.exists(KEPT):  # read ~/.codex in memory; the engine owns codex.json
        from .codex import ROOT, scan as codex_scan
        for p in glob.glob(os.path.join(ROOT, "*", "*", "*", "*.jsonl")):
            try:
                st = os.stat(p)
                c.files[p] = {"m": st.st_mtime_ns, "s": st.st_size, "r": codex_scan(p)}
            except (OSError, UnicodeError):
                continue
    return c.records()


def model():
    return Model(records() + codex(), labels.load(), store.checkins(), history())


# ---------------------------------------------------------------------------------------------
# writing tables

def _val(v):
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (dict, list, tuple)):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    return v


def _type(vs):
    for v in vs:
        if v is None:
            continue
        if isinstance(v, bool) or isinstance(v, int):
            return "INTEGER"
        if isinstance(v, float):
            return "REAL"
        return "TEXT"
    return ""


def table(c, name, rows, first=(), skip=()):
    """Create name from a list of dicts: the columns are every key seen, the first ones in order.
    Nested values are kept as JSON text. New fields the engine adds show up without a code change."""
    cols = list(first)
    seen = set(cols)
    for r in rows:
        for k in r:
            if k not in seen and k not in skip:
                cols.append(k)
                seen.add(k)
    if not cols:
        cols = list(first) or ["empty"]
    types = {k: _type(r.get(k) for r in rows) for k in cols}
    c.execute(f'create table "{name}" ({", ".join(f"{q(k)} {types[k]}" for k in cols)})')
    c.executemany(f'insert into "{name}" values ({",".join("?" * len(cols))})',
                  [[_val(r.get(k)) for k in cols] for r in rows])


def q(k):
    return '"' + k.replace('"', '') + '"'


def _quart(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 4:
        return None
    a, b, cc = quantiles(xs, n=4, method="inclusive")
    return round(a, 2), round(b, 2), round(cc, 2)


# ---------------------------------------------------------------------------------------------
# what the engine doesn't compute yet: blocks, switches, reading time, deferrals, weekly vital signs.
# Each one gives way to the engine's own as soon as the model carries it.

def _enrich(m, msgs):
    """Columns added to each message: its full text, Claude's reply, the week, the work block,
    whether it switched session, how long the reply before it took to read, and words of putting off
    (defer_words: a keyword match; the engine's defers is the label)."""
    by_day = defaultdict(list)
    for r in msgs:
        by_day[r["day"]].append(r)
    blocks = []
    for day, v in sorted(by_day.items()):
        v.sort(key=lambda r: r["ts"])
        cur = None
        for r in v:
            gap = secs(cur["last"], r["ts"]) if cur else None
            if cur is None or gap > BLOCK_GAP:
                cur = {"block": len(blocks) + 1, "day": day, "start": r["ts"], "last": r["ts"], "messages": 0,
                       "sids": set(), "projects": defaultdict(int), "switches": 0, "prev": None, "run": None, "longest": (0, None)}
                blocks.append(cur)
            r["block"] = cur["block"]
            r["switch"] = int(cur["prev"] is not None and cur["prev"]["sid"] != r["sid"])
            r["pswitch"] = int(cur["prev"] is not None and cur["prev"]["project"] != r["project"])
            cur["switches"] += r["switch"]
            # the longest stretch on one project inside the block
            if cur["run"] and cur["run"][0] == r["project"]:
                cur["run"][2] = r["ts"]
            else:
                cur["run"] = [r["project"], r["ts"], r["ts"]]
            run_s = secs(cur["run"][1], cur["run"][2]) + BLOCK_TAIL
            if run_s > cur["longest"][0]:
                cur["longest"] = (run_s, cur["run"][0])
            cur["last"] = r["ts"]
            cur["messages"] += 1
            cur["sids"].add(r["sid"])
            cur["projects"][r["project"]] += 1
            cur["prev"] = r
    out = []
    for b in blocks:
        top = max(b["projects"].items(), key=lambda kv: kv[1])[0]
        out.append({"block": b["block"], "day": b["day"], "start": b["start"], "end": b["last"],
                    "start_local": local(b["start"]).strftime("%Y-%m-%d %H:%M"),
                    "minutes": round((secs(b["start"], b["last"]) + BLOCK_TAIL) / 60, 1), "messages": b["messages"],
                    "sessions": len(b["sids"]), "projects": len(b["projects"]), "top": top, "switches": b["switches"],
                    "longest_min": round(b["longest"][0] / 60, 1), "longest_project": b["longest"][1]})
    for r in msgs:
        t = m.turns.get(r["id"]) or {}
        h = (getattr(m, "history", None) or {}).get(r["id"])
        if h:
            from .history import text_of
            t = {"text": text_of(h)[0], "kind": "history", "chars": len(h.get("text") or "")}
        prev = t.get("prev")
        r["text"] = own_words(t["text"]) if t.get("kind") == "prompt" and t.get("text") else (t.get("text") or r["text"])
        r.setdefault("origin", "transcript")
        r["truncated"] = int(bool(t.get("chars") and t["chars"] > len(t.get("text") or "")))
        r["reply"] = t.get("reply") or ""
        r["reply_words"] = len(r["reply"].split())
        r["local"] = local(r["ts"]).strftime("%Y-%m-%d %H:%M")
        r["week"] = week_of(date.fromisoformat(r["day"]))
        pw = len((prev or {}).get("reply", "").split()) if prev else None
        r["prev_reply_words"] = pw
        r["read_secs"] = round(pw / READ_WPM * 60) if pw is not None else None
        r["unread"] = int(r.get("gap") is not None and r["read_secs"] is not None and r["read_secs"] >= 10
                          and r["gap"] < r["read_secs"]) if r.get("gap") is not None and pw is not None else None
        r["defer_words"] = int(bool(DEFER.search(r["text"] or "")))
        r["link"] = link(r["id"])
    by_sid = defaultdict(list)
    for r in msgs:
        by_sid[r["sid"]].append(r)
    for v in by_sid.values():
        v.sort(key=lambda r: r["ts"])
        for a, b in zip(v, v[1:]):
            a["next_id"] = b["id"]
    return out


_CHECKED = {}


def intent_checked(r):
    """Whether this message's intent label may be counted: its version was checked (labels.checked)."""
    v = r.get("intentV")
    if v not in _CHECKED:
        try:
            _CHECKED[v] = bool(labels.checked("categories", "in", v))
        except TypeError:  # an engine whose checked() takes no version
            _CHECKED[v] = bool(labels.checked("categories", "in"))
    return _CHECKED[v]


def _weekly_vitals(m, msgs, blocks, lim):
    """Vital signs per week and per day, long format, with the person's range: the 25th, 50th and 75th
    percentile of the 8 complete weeks (or 56 days) before. Used until the engine serves its own."""
    days = [d for d in m.days]
    on = {d["day"]: d for d in days if d["n"]}
    bday = defaultdict(list)
    for b in blocks:
        bday[b["day"]].append(b)
    mday = defaultdict(list)
    for r in msgs:
        mday[r["day"]].append(r)
    stop = lim.get("stopHour")
    daily = defaultdict(dict)   # measure → day → value
    for d in days:
        k = d["day"]
        if not d["n"]:
            daily["active"][k] = 0
            continue
        bs, ms = bday.get(k, []), mday.get(k, [])
        act = sum(b["minutes"] for b in bs) / 60
        daily["active"][k] = round(act, 2)
        daily["night"][k] = d.get("rest")
        daily["start"][k] = d.get("start")
        daily["end"][k] = d.get("end")
        daily["stretch"][k] = round(max((b["longest_min"] for b in bs), default=0) / 60, 2)
        daily["switches"][k] = round(sum(b["switches"] for b in bs) / act, 2) if act >= .5 else None
        daily["peak"][k] = d.get("peak")
        daily["projects"][k] = d.get("projects")
        daily["messages"][k] = d["n"]
        if stop is not None:
            late = 0.0
            for b in bs:
                a, z = local(b["start"]), local(b["end"]) + timedelta(seconds=BLOCK_TAIL)
                cut = datetime.combine(date.fromisoformat(k), datetime.min.time()).replace(tzinfo=a.tzinfo) + timedelta(hours=stop)
                late += max(0, (z - max(a, cut)).total_seconds()) / 60
            daily["late"][k] = round(late)
    # weeks
    wk = defaultdict(list)
    for d in days:
        wk[week_of(date.fromisoformat(d["day"]))].append(d["day"])
    weeks = sorted(wk)
    today_week = week_of(day_of(datetime.now().astimezone()))
    mwk = defaultdict(list)
    for r in msgs:
        if r["kind"] == "prompt":
            mwk[r["week"]].append(r)

    def share(ms, f, need=30):
        ms = [x for x in ms if x is not None]
        return round(100 * sum(1 for x in ms if f(x)) / len(ms), 1) if len(ms) >= need else None

    weekly = defaultdict(dict)
    for w in weeks:
        ds = wk[w]
        val = lambda key: [daily[key].get(x) for x in ds if x in on and daily[key].get(x) is not None]  # noqa: E731
        act = sum(daily["active"].get(x, 0) for x in ds)
        weekly["load"][w] = round(act, 1)
        weekly["daysoff"][w] = sum(1 for x in ds if x not in on)
        weekly["night"][w] = round(median(val("night")), 1) if val("night") else None
        weekly["start"][w] = round(median(val("start")), 2) if val("start") else None
        weekly["end"][w] = round(median(val("end")), 2) if val("end") else None
        weekly["stretch"][w] = round(median(val("stretch")), 2) if val("stretch") else None
        sw = sum(b["switches"] for x in ds for b in bday.get(x, []))
        weekly["switches"][w] = round(sw / act, 2) if act >= 1 else None
        weekly["peak"][w] = max(val("peak"), default=None)
        ms = mwk.get(w, [])
        weekly["messages"][w] = len(ms)
        weekly["projects"][w] = len({r["project"] for r in ms}) if ms else None
        # a label counts only for a version a second judge checked (labels.checked); tone never was, so
        # "frustrated" is not a measure, only a reading to find messages by (wimym moments --about frustrated)
        lab = [r for r in ms if r["intent"] and intent_checked(r)]
        weekly["corrections"][w] = share(lab, lambda r: r["intent"] == "correct")
        ga = [r for r in lab if r["intent"] == "go-ahead" and r["unread"] is not None]
        weekly["unread"][w] = share(ga, lambda r: r["unread"], need=10)
        weekly["stopped"][w] = share([r for r in ms if r.get("origin") != "history"], lambda r: r["stopped"])
        weekly["defer_words"][w] = sum(r["defer_words"] for r in ms) if ms else None
        weekly["commits"][w] = sum(r["commits"] or 0 for r in msgs if r["week"] == w)
        weekly["words"][w] = round(median([r["words"] for r in ms]), 1) if ms else None
        if stop is not None:
            weekly["late"][w] = sum(daily["late"].get(x, 0) for x in ds)
    rows = []
    for key, series in weekly.items():
        complete = [w for w in weeks if w != today_week]
        for w in weeks:
            prev = [series.get(x) for x in complete if x < w][-8:]
            band = _quart(prev)
            rows.append({"measure": key, "grain": "week", "period": w, "value": series.get(w),
                         "lo": band[0] if band else None, "mid": band[1] if band else None, "hi": band[2] if band else None,
                         "partial": int(w == today_week), "source": "ask"})
    for key, series in daily.items():
        ks = sorted(series)
        for i, k in enumerate(ks):
            lo = (date.fromisoformat(k) - timedelta(days=56)).isoformat()
            prev = [series[x] for x in ks[bisect_left(ks, lo):i] if x in on]
            band = _quart(prev)
            rows.append({"measure": key, "grain": "day", "period": k, "value": series[k],
                         "lo": band[0] if band else None, "mid": band[1] if band else None, "hi": band[2] if band else None,
                         "partial": 0, "source": "ask"})
    for r in rows:
        v, lo, hi = r["value"], r["lo"], r["hi"]
        r["outside"] = None if v is None or lo is None else ("above" if v > hi else "below" if v < lo else None)
    return rows


def _engine_vitals(m, git):
    """The engine's vital signs (vitals.py, the /api/vitals payload) in long format, with a daily range added:
    the 25th to 75th percentile of the 56 days before; and its week() for every week: summary and candidate moments."""
    from . import vitals as V
    if not git["git"]:
        raise RuntimeError("no read-only git to build the vital signs with")  # V.build would make one that writes
    v = V.build(m, git=git["git"])
    payload = v.payload()
    rows, evidence = [], []
    days, weeks = payload.get("days") or [], payload.get("weeks") or []
    on = {d["day"] for d in m.days if d.get("n")}
    for ms in payload["measures"]:
        for grain, periods, vals in (("day", days, ms.get("daily")), ("week", weeks, ms.get("weekly"))):
            if not vals:
                continue
            bands = ms.get("band") or []
            for i, (p, x) in enumerate(zip(periods, vals)):
                if grain == "week":
                    b = (bands[i] if i < len(bands) else None) or {}
                    lo, mid, hi = b.get("lo"), b.get("mid"), b.get("hi")
                else:
                    prev = [vals[j] for j in range(max(0, i - 56), i) if periods[j] in on and vals[j] is not None]
                    lo, mid, hi = _quart(prev) or (None, None, None)
                rows.append({"measure": ms["key"], "grain": grain, "period": p, "value": x, "lo": lo, "mid": mid, "hi": hi,
                             "partial": int(grain == "week" and i == len(weeks) - 1), "source": "engine"})
        for mid in (ms.get("evidence") or {}).get("messages") or []:
            evidence.append({"measure": ms["key"], "id": mid})
    for r in rows:
        x, lo, hi = r["value"], r["lo"], r["hi"]
        r["outside"] = None if x is None or lo is None else ("above" if x > hi else "below" if x < lo else None)
    about = [{k: x for k, x in ms.items() if k not in ("daily", "weekly", "band", "evidence")} for ms in payload["measures"]]
    summaries, moments = [], []
    for w in weeks:
        wk = v.week(w)
        if not wk:
            continue
        summaries.append({"week": w, "complete": wk.get("complete"), "summary": wk.get("summary")})
        for rank, mo in enumerate(wk.get("moments") or [], 1):
            known = ("key", "kind", "day", "title", "reason", "about", "question", "messages", "value", "unusual")
            moments.append({"week": w, "rank": rank, **{k: mo.get(k) for k in known},
                            "extra": {k: x for k, x in mo.items() if k not in known} or None})
    return rows, {"payload": {k: x for k, x in payload.items() if k not in ("measures", "days", "weeks")}, "measures": about}, \
        evidence, summaries, moments


def _git(m):
    """What the engine has read of git (git.json in the cache dir). Read only: the CLI never runs git."""
    try:
        from collections import Counter
        from .gitlog import Git
        g = Git(readonly=True)  # reads git.json and the repositories; never writes git.json, never calls gh
        if not g.repos:
            return {"read": False, "git": g, "commits": [], "branches": []}
        return {"read": True, "git": g, "commits": g.commits(Counter(r["project"] for r in m.messages)),
                "branches": g.open_branches()}
    except Exception as e:  # an engine mid-change shouldn't stop the database, but says so
        import sys
        print(f"wimym: couldn't read the engine's git.json ({type(e).__name__}: {e}); commits left empty", file=sys.stderr)
        return {"read": False, "git": None, "commits": [], "branches": [], "error": f"{type(e).__name__}: {e}"}


# ---------------------------------------------------------------------------------------------

def _labels_rows():
    rows, audit = [], []
    for p in _label_files():
        rel = os.path.relpath(p, LABELS_DIR).replace(os.sep, "/")
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        if "marks" in d:
            for k, mk in (d.get("marks") or {}).items():
                parts = k.split(":", 2)
                if len(parts) == 3:
                    audit.append({"file": rel, "set": parts[0], "field": parts[1], "id": parts[2], "ok": mk.get("ok"),
                                  "was": mk.get("was"), "version": mk.get("v"), "unclear": mk.get("unclear"),
                                  "why": mk.get("why"), "by": d.get("by") or mk.get("by"), "card": mk.get("card")})
            continue
        lab = d.get("labels")
        if not isinstance(lab, dict):
            continue
        cur = d.get("version")
        sset = os.path.splitext(os.path.basename(p))[0]
        for mid, l in lab.items():
            if not isinstance(l, dict):
                continue
            for f, v in l.items():
                if f in ("h", "v", "w"):
                    continue
                rows.append({"id": mid, "set": sset, "field": f,
                             "value": json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else
                             ("true" if v is True else "false" if v is False else v),
                             "version": l.get("v"), "current": int(l.get("v") == cur and "/" not in rel), "file": rel})
    return rows, audit


def _definitions():
    out = []
    try:
        sets = labels.definitions()["sets"]
    except (OSError, ValueError, KeyError):
        return out
    for sname, s in sets.items():
        for f in s.get("fields") or []:
            vals = f.get("values") or [{"key": None, "name": None, "meaning": None}]
            for v in vals:
                out.append({"set": sname, "set_version": s.get("version"), "field": f["key"], "field_name": f.get("name"),
                            "type": f.get("type"), "value": "true" if v.get("key") is True else "false" if v.get("key") is False else v.get("key"),
                            "value_name": v.get("name"), "meaning": v.get("meaning")})
    return out


def build(path=DB):
    """Rebuild the whole file; returns the number of messages."""
    now = inputs()  # before reading anything, so a change made during the build makes the file stale
    m = model()
    msgs = [dict(r) for r in m.messages]
    blocks = _enrich(m, msgs)
    lim = store.limits() if hasattr(store, "limits") else practices.limits()
    git = _git(m)
    mine = _weekly_vitals(m, msgs, blocks, lim)
    try:
        vit, vit_about, evidence, summaries, wmoments = _engine_vitals(m, git)
    except Exception as e:  # the engine's vitals mid-change: fall back to ours, and say so
        import sys
        print(f"wimym: the engine's vital signs failed ({type(e).__name__}: {e}); using the CLI's own", file=sys.stderr)
        vit, vit_about, evidence, summaries, wmoments = None, None, [], [], []
    if vit is None:
        vit, vit_source = mine, "ask"
    else:
        have = {r["measure"] for r in vit}
        vit = vit + [r for r in mine if r["measure"] not in have]
        vit_source = "engine, with start, end, messages, projects, corrections, stopped, defer_words, commits and words from the CLI"

    tmp = paths.tmp_name(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c = sqlite3.connect(tmp)
    try:
        c.execute("pragma journal_mode = off")
        c.execute("pragma synchronous = off")
        first = ["id", "sid", "project", "ts", "local", "day", "week", "hour", "dow", "src", "kind", "text", "reply", "link"]
        table(c, "messages", msgs, first=first)
        mine = {r["id"] for r in msgs}
        turns = []
        for k, t in m.turns.items():
            r = {kk: v for kk, v in t.items() if kk not in ("prev", "key", "path", "think")}
            r["id"] = k
            r["mine"] = int(k in mine)
            r["text"] = (r.get("text") or "")[:2000]
            if t.get("ts"):
                r["day"] = day_of(local(t["ts"])).isoformat()
            turns.append(r)
        table(c, "turns", turns, first=["id", "sid", "project", "ts", "end", "day", "src", "kind", "mine"])
        sess = []
        for s in m.sessions.values():
            r = dict(s)
            if r.get("start"):
                r["day"] = day_of(local(r["start"])).isoformat()
            sess.append(r)
        table(c, "sessions", sess, first=["sid", "project", "title", "kind", "day", "start", "end"])
        table(c, "blocks", getattr(m, "blocks", None) or blocks, first=["block", "day", "start", "end"])
        table(c, "days", m.days, first=["day"])
        table(c, "weeks", m.weeks, first=["week"])
        table(c, "projects", m.projects, first=["project"])
        commits = []
        for x in git["commits"]:
            r = dict(x)
            r["local"] = datetime.fromtimestamp(r["at"]).strftime("%Y-%m-%d %H:%M")
            r["day"] = day_of(datetime.fromtimestamp(r["at"]).astimezone()).isoformat()
            commits.append(r)
        table(c, "commits", commits, first=["sha", "project", "local", "day", "at", "who", "claude", "people", "files", "add", "del", "merge", "landed"])
        table(c, "branches", git["branches"], first=["project", "name", "sha", "at", "ahead", "who"])
        table(c, "vitals_evidence", evidence, first=["measure", "id"])
        table(c, "week_summary", summaries, first=["week", "complete", "summary"])
        table(c, "week_moments", wmoments, first=["week", "rank", "key", "kind", "day", "title", "reason", "about", "question",
                                                  "messages", "value", "unusual", "extra"])
        table(c, "vitals", vit, first=["measure", "grain", "period", "value", "lo", "mid", "hi", "outside", "partial", "source"])
        # the same values wide, one row per day or week, for comparing measures without joins
        for grain, name in (("day", "day_vitals"), ("week", "week_vitals")):
            wide = defaultdict(dict)
            for r in vit:
                if r["grain"] == grain:
                    wide[r["period"]][r["measure"]] = r["value"]
            keys = sorted({k for v in wide.values() for k in v})
            table(c, name, [{"period": p, **{k: v.get(k) for k in keys}} for p, v in sorted(wide.items())], first=["period"] + keys)
        lrows, audit = _labels_rows()
        table(c, "labels", lrows, first=["id", "set", "field", "value", "version", "current", "file"])
        table(c, "label_audit", audit, first=["file", "set", "field", "id", "ok", "was", "version", "unclear", "why", "by", "card"])
        # which label fields may be counted: checked by a second judge (labels.checked), the rest are readings
        status = {}
        for r in lrows:
            k = (r["set"], r["field"])
            st = status.setdefault(k, {"set": r["set"], "field": r["field"], "labelled": 0, "versions": set()})
            if r["current"]:
                st["labelled"] += 1
            st["versions"].add(r["version"])
        chk = getattr(labels, "checked", lambda n, f: n == "categories" and f == "in")
        table(c, "label_status", [dict(v, versions=sorted(str(x) for x in v["versions"]), checked=int(bool(chk(v["set"], v["field"]))))
                                  for v in status.values()], first=["set", "field", "checked", "labelled", "versions"])
        # the day accounts (days label set): the story of each day, and what was decided, dropped, postponed, high, low
        acc, items = [], []
        for day, a in sorted((m.labels.get("days") or {}).items()):
            if not isinstance(a, dict):
                continue
            acc.append({"day": day, "account": a.get("account"), "strain": a.get("strain"), "version": a.get("v"),
                        "cites": a.get("cites"), "checked": int(bool(chk("days", "account")))})
            for kind in ("decided", "dropped", "postponed", "high", "low"):
                for it in a.get(kind) or []:
                    if isinstance(it, dict):
                        items.append({"day": day, "kind": kind, "text": it.get("t"), "id": it.get("m")})
                    elif it:
                        items.append({"day": day, "kind": kind, "text": str(it), "id": None})
        table(c, "day_accounts", acc, first=["day", "account", "strain", "version", "cites", "checked"])
        table(c, "day_items", items, first=["day", "kind", "text", "id"])
        sitems = []
        for s_ in m.sessions.values():
            for kind, key in (("decision", "decisions"), ("open", "open")):
                for it in s_.get(key) or []:
                    t_, mid = (it.get("t"), it.get("m")) if isinstance(it, dict) else (str(it), None)
                    sitems.append({"sid": s_["sid"], "project": s_.get("project"), "day": day_of(local(s_["start"])).isoformat() if s_.get("start") else None,
                                   "kind": kind, "text": t_, "id": mid, "outcome": s_.get("outcome")})
        table(c, "session_items", sitems, first=["sid", "project", "day", "kind", "text", "id", "outcome"])
        rl = labels.rules() if hasattr(labels, "rules") else {"groups": []}
        table(c, "rules", [{"n_": i + 1, **g} for i, g in enumerate(rl.get("groups") or [])],
              first=["n_", "rule", "kind", "n", "sessions", "ids", "known", "first", "last", "projects"])
        table(c, "label_values", _definitions(), first=["set", "set_version", "field", "field_name", "type", "value", "value_name", "meaning"])
        table(c, "checkins", [{"day": k, **v} for k, v in sorted(store.checkins().items())],
              first=["day", "energy", "mood", "focus", "note", "at"])
        ps = practices.practices()
        table(c, "practices", [{k: v for k, v in p.items() if k != "verdicts"} | {"verdicts": len(p.get("verdicts") or [])} for p in ps],
              first=["id", "text", "owner", "where", "measure", "sql", "target", "start", "trial", "status", "why", "at"])
        table(c, "verdicts", [{"practice": p["id"], **v} for p in ps for v in p.get("verdicts") or []],
              first=["practice", "at", "verdict", "note"])
        table(c, "log", practices.log(), first=["at", "kind", "text", "week", "refs", "practice"])
        table(c, "limits", [{"key": k, "value": v, "at": lim.get("at")} for k, v in lim.items() if k != "at"],
              first=["key", "value", "at"])
        table(c, "memory", [{k: v for k, v in n.items() if k != "taught"} | {"taught": (n.get("taught") or {}).get("id")}
                            for n in m.memory["notes"]], first=["name", "type", "project", "desc", "body", "reads", "written", "taught"])
        full_from = getattr(m, "full_from", None) or min((r["day"] for r in msgs if r.get("reply")), default=None)
        meta = {"built": datetime.now().isoformat(timespec="seconds"), "inputs": now, "schema": SCHEMA,
                "label_versions": m.labels.get("versions"), "vitals_source": vit_source, "vitals_about": vit_about,
                "git": {"read": git["read"], "commits": len(git["commits"]), "error": git.get("error")},
                "coverage": {"first_day": m.days[0]["day"] if m.days else None, "last_day": m.days[-1]["day"] if m.days else None,
                             "full_from": full_from, "messages": len(msgs), "sessions": len(m.sessions)},
                "limits": lim, "app": APP, "day_starts_at": DAY_START}
        c.execute("create table meta (key TEXT primary key, value TEXT)")
        c.executemany("insert into meta values (?, ?)", [(k, json.dumps(v, ensure_ascii=False)) for k, v in meta.items()])
        for t, cols in (("messages", "id"), ("messages", "day"), ("messages", "week"), ("messages", "sid"), ("turns", "id"),
                        ("turns", "sid"), ("labels", "id"), ("vitals", "measure, grain, period"), ("sessions", "sid"), ("days", "day")):
            c.execute(f"create index ix_{t}_{cols.split(',')[0].strip()} on {t} ({cols})")
        c.commit()
        c.close()
        paths.replace(tmp, path)  # on Windows, waits a moment for a `wimym` reading the old file
    except BaseException:
        c.close()
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return len(msgs)
