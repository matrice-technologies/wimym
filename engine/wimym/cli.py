"""wimym: ask your own record questions, from a terminal or from Claude.

    wimym sql "select day, n from days order by n desc limit 5"
    wimym schema [table]
    wimym week [YYYY-MM-DD | this]            vital signs outside your range, the week's days, moments
    wimym moments --about corrections [--week 2026-10-12]
    wimym show <message id or its first 8 characters>
    wimym practice add|list|check|verdict
    wimym log add|list
    wimym limits [set <key> <value> | clear <key>]
    wimym rules [draft <n>]                   instructions you keep giving the agents, and a draft to approve
    wimym build                               rebuild the database now
    wimym label [--dry-run | --yes]           label what's new since the last run, today left out; says the cost first

Output is short by default so it fits in Claude's context; --json gives more. The database is
<cache dir>/wimym.db, rebuilt when stale (see db.py). What each column means: docs/schema.md.
"""
import os
import sys

HOME = os.path.expanduser("~")


def _defaults():
    """Point at existing folders without ever triggering paths.py's move of the old Mirror folders."""
    def first(*ps):
        return next((p for p in ps if os.path.isdir(p) and not os.path.islink(p)), None)
    if not (os.environ.get("WIMYM_DATA") or os.environ.get("MIRROR_DATA")):
        d = first(os.path.join(HOME, ".wimym"), os.path.join(HOME, ".mirror"))
        if d:
            os.environ["WIMYM_DATA"] = d
    if not (os.environ.get("WIMYM_CACHE") or os.environ.get("MIRROR_CACHE")):
        # ~/.cache/wimym-dev is the build sprint's copy of the index (Oct 2026); ~/.cache/mirror is left to the old engines
        d = first(os.path.join(HOME, ".cache", "wimym"), os.path.join(HOME, ".cache", "wimym-dev"))
        os.environ["WIMYM_CACHE"] = d or os.path.join(HOME, ".cache", "wimym")


_defaults()
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import sqlite3  # noqa: E402
from datetime import date, datetime, timedelta  # noqa: E402

from wimym import db, practices  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA_DOC = os.path.join(ROOT, "docs", "schema.md")
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# The vital signs, as the CLI names them. unit: h hours, hh an hour of the day, min, n count, % share, perh per active hour.
MEASURES = {
    "load": ("Active hours", "h", None, "sum of the week's work blocks"),
    "night": ("Night", "h", "higher", "hours from the last message of a day to the first of the next (median)"),
    "daysoff": ("Days off", "n", "higher", "days with no message of yours"),
    "start": ("First message", "hh", None, "median time of the day's first message"),
    "end": ("Last message", "hh", None, "median time of the day's last message"),
    "late": ("Late minutes", "min", "lower", "active minutes after your stopping hour"),
    "stretch": ("Longest stretch", "h", "higher", "longest run on one project in a block (median day)"),
    "switches": ("Switches", "perh", "lower", "changes of session per active hour"),
    "peak": ("Sessions at once", "n", None, "most of your sessions running at the same minute"),
    "projects": ("Projects", "n", None, "projects you sent a message in"),
    "messages": ("Messages", "n", None, "messages you typed"),
    "unread": ("Unread go-aheads", "%", "lower", "go-aheads sent sooner than the reply could be read at 250 words a minute"),
    "corrections": ("Corrections", "%", "lower", "messages labelled correct, counting only checked label versions"),
    "strain": ("Strain", "%", "lower", "corrections or frustrated, per 100 labelled messages"),
    "stopped": ("Turns stopped", "%", None, "messages after which you stopped Claude mid-turn"),
    "defer_words": ("Words of putting off", "n", None, "messages with later, for now, tomorrow, plus tard… (keywords, not a label)"),
    "commits": ("Commits in sessions", "n", None, "commits Claude made in your sessions' turns (git's own count is landed)"),
    "words": ("Words a message", "n", None, "median words in your messages"),
    "active": ("Active hours", "h", None, "sum of the work blocks"),
}
UNRELIABLE = {("tone", "frustrated"), ("tone", "pleased"), ("irk", None), ("pressure", None), ("play", None),
              ("scope", "strategy"), ("who", "claude"), ("specific", None)}
LABEL_COLS = {"in": "intent", "intent": "intent", "to": "tone", "tone": "tone", "sp": "specific", "specific": "specific",
              "own": "own", "who": "who", "sc": "scope", "scope": "scope", "pr": "pressure", "pressure": "pressure",
              "irk": "irk", "pl": "play", "play": "play", "family": "family"}


# ---------------------------------------------------------------------------------------------
# small helpers

def out(s=""):
    print(s)


def jout(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=1, default=str))


def hh(h):
    if h is None:
        return "?"
    h = float(h) % 24
    return f"{int(h):02d}:{int(round((h % 1) * 60)) % 60:02d}"


def fmt(v, unit):
    if v is None:
        return "–"
    if unit == "hh":
        return hh(v)
    if unit == "h":
        return f"{v:.1f}h"
    if unit == "%":
        return f"{v:.0f}%"
    if unit == "perh":
        return f"{v:.1f}/h"
    if unit == "min":
        return f"{v:.0f}min"
    return f"{round(v, 1):g}" if isinstance(v, (int, float)) else str(v)


def clip(s, n):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[:n - 1] + "…"


def monday(s=None):
    """The Monday of a week given as YYYY-MM-DD, 2026-W42, 'this' or 'last' (default: the last complete week)."""
    today = (datetime.now() - timedelta(hours=db.DAY_START)).date()
    if not s or s == "last":
        d = today - timedelta(days=7)
    elif s in ("this", "now"):
        d = today
    elif re.fullmatch(r"\d{4}-W\d{1,2}", s):
        y, w = s.split("-W")
        d = date.fromisocalendar(int(y), int(w), 1)
    else:
        d = date.fromisoformat(s)
    return d - timedelta(days=d.weekday())


def conn(args):
    global _CONN
    db.ensure(max_age=0 if getattr(args, "fresh", False) else db.MAX_AGE)
    _CONN = db.connect()
    return _CONN


def meta(c):
    return {r["key"]: json.loads(r["value"]) for r in c.execute("select key, value from meta")}


def caveat(col, val):
    if (col, val) in UNRELIABLE or (col, None) in UNRELIABLE:
        return f"Note: {col}={val} is a Haiku reading the Opus audit found unreliable on this value; read the messages, don't count them."
    return None


_IDS = None
_CONN = None


def short(mid):
    """The shortest prefix of an id no other message or turn shares (at least 8 characters), so that
    `wimym show <it>` finds exactly this one: history ids (h-…) and codex ids share long prefixes."""
    global _IDS
    if _IDS is None:
        try:
            _IDS = sorted(r[0] for r in _CONN.execute("select id from messages union select id from turns"))
        except Exception:
            _IDS = []
    from bisect import bisect_left
    i = bisect_left(_IDS, mid)

    def lcp(a, b):
        n = 0
        for x, y in zip(a, b):
            if x != y:
                break
            n += 1
        return n
    need = 8
    for j in (i - 1, i + 1) if i < len(_IDS) and _IDS[i] == mid else (i - 1, i):
        if 0 <= j < len(_IDS) and _IDS[j] != mid:
            need = max(need, lcp(mid, _IDS[j]) + 1)
    return mid[:need]


def msg_line(r, width=150):
    lab = r["intent"] or ""
    if r["tone"] and r["tone"] != "neutral":
        lab += f"/{r['tone']}"
    d = date.fromisoformat(r["day"])
    return f"{short(r['id'])}  {DOW[d.weekday()]} {d.day:>2} {d.strftime('%b')} {hh(r['hour'])}  {clip(r['project'], 18):<18} {('[' + lab + ']') if lab else '':<16} {clip(r['text'], width)}"


def table_text(rows, cols, limit, width=60):
    if not rows:
        return "(no rows)"
    shown = rows[:limit]
    cells = [[clip("" if r[k] is None else str(r[k]), width) for k in cols] for r in shown]
    w = [max(len(k), *(len(row[i]) for row in cells)) for i, k in enumerate(cols)]
    lines = ["  ".join(k.ljust(w[i]) for i, k in enumerate(cols))]
    lines += ["  ".join(row[i].ljust(w[i]) for i in range(len(cols))).rstrip() for row in cells]
    if len(rows) > limit:
        lines.append(f"… {len(rows) - limit} more rows (add LIMIT, or --all)")
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------------
# sql, schema, build

def statements(sql):
    """Split on the semicolons that end a statement (not those inside strings)."""
    out, cur = [], ""
    for part in sql.split(";"):
        cur += part + ";"
        if sqlite3.complete_statement(cur):
            if cur.strip(" ;\n\t"):
                out.append(cur.strip())
            cur = ""
    if cur.strip(" ;\n\t"):
        out.append(cur.strip())
    return out


def cmd_sql(a):
    c = conn(a)
    results = []
    for st in statements(a.query):
        try:
            cur = db.query(c, st)
        except (sqlite3.Error, sqlite3.Warning) as e:
            sys.exit(f"wimym sql: {e}\n  in: {clip(st, 200)}")
        cols = [d[0] for d in cur.description or []]
        results.append([dict(zip(cols, r)) for r in cur.fetchall()])
        if not a.json:
            if len(results) > 1:
                out()
            out(table_text(results[-1], cols, 10 ** 9 if a.all else a.limit, 10 ** 6 if a.wide else 80))
    if a.json:
        jout(results[0] if len(results) == 1 else results)


def schema_doc():
    """Column meanings from docs/schema.md: its '| column | meaning |' rows under '### table'."""
    docs, cur = {}, None
    try:
        text = open(SCHEMA_DOC, encoding="utf-8").read()
    except OSError:
        return docs
    for line in text.splitlines():
        m = re.match(r"^###\s+`?(\w+)`?", line)
        if m:
            cur = m.group(1)
            docs.setdefault(cur, {"": ""})
            continue
        m = re.match(r"^\|\s*`?([\w]+)`?\s*\|\s*(.+?)\s*\|\s*$", line)
        if cur and m and m.group(1) not in ("column", "Column") and not set(m.group(1)) <= {"-"}:
            docs[cur][m.group(1)] = m.group(2)
        elif cur and line.strip() and not line.startswith("|") and not docs[cur][""]:
            docs[cur][""] = line.strip()
    return docs


def cmd_schema(a):
    c = conn(a)
    docs = schema_doc()
    tables = [r[0] for r in c.execute("select name from sqlite_master where type='table' order by rowid")]
    if a.table:
        tables = [t for t in tables if t == a.table] or sys.exit(f"no table {a.table}; tables: {', '.join(tables)}")
    res = {}
    for t in tables:
        n = c.execute(f'select count(*) from "{t}"').fetchone()[0]
        cols = [(r[1], r[2]) for r in c.execute(f'pragma table_info("{t}")')]
        d = docs.get(t, {})
        res[t] = {"rows": n, "about": d.get(""), "columns": {k: {"type": ty, "meaning": d.get(k)} for k, ty in cols}}
    if a.json:
        return jout(res)
    m = meta(c)
    cov = m.get("coverage") or {}
    if not a.table:
        out(f"wimym.db, built {m.get('built')}: {cov.get('first_day')} to {cov.get('last_day')}, full detail from {cov.get('full_from')}. "
            f"Vital signs from: {m.get('vitals_source')}. Caveats and joins: docs/schema.md")
    for t, v in res.items():
        out(f"\n{t} ({v['rows']} rows){': ' + v['about'] if v['about'] else ''}")
        for k, cv in v["columns"].items():
            if a.table or cv["meaning"]:
                out(f"  {k:<16} {clip(cv['meaning'] or '(not documented yet)', 150)}")
        if not a.table:
            undocumented = [k for k, cv in v["columns"].items() if not cv["meaning"]]
            if undocumented:
                out(f"  also: {', '.join(undocumented)}")


def cmd_build(a):
    t = datetime.now()
    n = db.build()
    out(f"wimym.db rebuilt: {n} messages in {(datetime.now() - t).total_seconds():.1f}s ({db.DB})")


def cmd_label(a):
    """labeller/refresh.py, in its own process: it calls Claude, which nothing else here does."""
    import subprocess
    cmd = [sys.executable, os.path.join(ROOT, "labeller", "refresh.py"), "--jobs", str(a.jobs)] + \
        (["--dry-run"] if a.dry_run else ["--yes"] if a.yes else [])
    sys.exit(subprocess.call(cmd))


# ---------------------------------------------------------------------------------------------
# moments

def about_sql(c, about):
    """(where clause on messages m, params, ordering, what it means, caveat) for --about."""
    lim = practices.limits()
    a = about.lower()
    if "=" in a or ":" in a:
        f, v = re.split(r"[=:]", about, 1)
        col = LABEL_COLS.get(f.lower())
        if v.lower() in ("true", "false"):
            val = 1 if v.lower() == "true" else 0
        else:
            val = v
        if col:
            return f"m.{col} = ?", [val], None, f"messages labelled {col} = {v}", caveat(col, v)
        # another label set (acts, next/…): from the labels table, any version
        return ("m.id in (select id from labels where field = ? and value = ?)", [f, v], None,
                f"messages with label {f} = {v} (from the labels table, any version)", "Note: a label set not yet audited; read before counting.")
    if a in ("correct", "corrections", "correction"):
        return "m.intent = 'correct'", [], None, "messages that correct or redirect Claude", None
    if a in ("frustrated", "frustration"):
        return "m.tone = 'frustrated'", [], None, "messages that sound frustrated", caveat("tone", "frustrated")
    if a == "strain":
        return "(m.intent = 'correct' or m.tone = 'frustrated')", [], None, "corrections and frustrated messages", caveat("tone", "frustrated")
    if a in ("unread", "rubber-stamp", "approvals"):
        return ("m.intent = 'go-ahead' and m.unread = 1", [], "m.prev_reply_words desc",
                "go-aheads sent sooner than Claude's reply could be read (250 words a minute)",
                "Note: replies are kept up to 2,500 characters, so long replies count as shorter than they were.")
    if a in ("goahead", "go-ahead"):
        return "m.intent = 'go-ahead'", [], None, "bare go-aheads", None
    if a in ("stopped", "stops"):
        return "m.stopped = 1", [], None, "messages after which you stopped Claude mid-turn", None
    if a in ("defers", "defer", "putoff", "put-off", "postponed"):
        return ("m.defers = 1", [], None, "messages that put something off (Haiku, acts label, not audited yet)",
                "Note: the acts labels cover a sample so far; `--about defer_words` finds the keyword matches.")
    if a in ("defer_words", "later"):
        return ("m.defer_words = 1", [], None, "messages with words of putting off (later, for now, tomorrow, plus tard…)",
                "Note: a keyword match, not a label: read each one; most 'later' are not putting anything off.")
    if a in ("decides", "decisions"):
        return "m.decides = 1", [], None, "messages that make a decision (Haiku, acts label, not audited yet)", None
    if a in ("people", "withpeople"):
        return ("m.withPeople in ('mention', 'with')", [], None, "messages that mention or work with other people (acts label, not audited yet)", None)
    if a in ("selfstate", "self", "mood"):
        return ("m.selfState is not null and m.selfState != 'none'", [], None, "messages where you say how you are (acts label, not audited yet)",
                "Note: a model's reading of your words, never a judgement about how you are; tests of an assistant read the same.")
    if a in ("late", "night"):
        stop = lim.get("stopHour") or 23
        return (f"m.hour >= {float(stop)}", [], "m.hour desc", f"messages after {hh(stop)}" +
                ("" if lim.get("stopHour") else " (no stopping hour set; 23:00 used)"), None)
    if a in ("early", "start"):
        q1 = c.execute("select value from vitals where grain = 'day' and measure = 'start' and value is not null order by value").fetchall()
        cut = q1[len(q1) // 4][0] if q1 else 7
        return ("m.id in (select id from (select id, min(ts) from messages group by day)) and m.hour < ?", [cut], "m.hour",
                f"the day's first message on your earliest days (before {hh(cut)}, your earliest quarter)", None)
    if a in ("switches", "switching", "switch"):
        return ("m.switch = 1 and m.block in (select block from blocks where minutes >= 30 order by switches * 60.0 / minutes desc limit 40)",
                [], "m.ts", "messages that changed session, in your most scattered blocks", None)
    if a in ("own", "ideas"):
        return "m.own = 1", [], None, "messages bringing an idea of your own", None
    if a in ("long", "longest", "depth", "stretch"):
        return ("m.block in (select block from blocks order by longest_min desc limit 20) and m.first = 1", [], None,
                "session openers in your longest single-project stretches", None)
    if a in ("handed", "delegate", "offload"):
        return "m.who = 'claude'", [], None, "messages leaving the decision itself to Claude", caveat("who", "claude")
    if a in ("questions", "question"):
        return "m.intent = 'question'", [], None, "questions", None
    return None


def moments(c, about, start, end, limit=8):
    spec = about_sql(c, about)
    if not spec:
        sys.exit(f"wimym moments: don't know '{about}'. Try corrections, frustrated, strain, unread, stopped, defers, defer_words, decides, "
                 "people, selfstate, late, early, switches, stretch, own, handed, questions, or a label like intent=fix, tone=pleased, dfr=true.")
    where, params, order, what, note = spec
    rows = c.execute(f"select m.* from messages m where {where} and m.day >= ? and m.day < ? order by m.ts", params + [start, end]).fetchall()
    # spread over the days, the fullest messages first within a day
    by_day = {}
    for r in rows:
        by_day.setdefault(r["day"], []).append(r)
    for v in by_day.values():
        v.sort(key=lambda r: -(r["words"] or 0))
    if order:
        ordered = c.execute(f"select m.* from messages m where {where} and m.day >= ? and m.day < ? order by {order}", params + [start, end]).fetchall()
        picked = ordered[:limit]
    else:
        picked, days = [], sorted(by_day, key=lambda d: -len(by_day[d]))
        i = 0
        while len(picked) < min(limit, len(rows)):
            for d in days:
                if i < len(by_day[d]) and len(picked) < limit:
                    picked.append(by_day[d][i])
            i += 1
        picked.sort(key=lambda r: r["ts"])
    # how many in a usual week: the 8 weeks before
    s0 = date.fromisoformat(start)
    counts = []
    for k in range(1, 9):
        a0 = (s0 - timedelta(days=7 * k)).isoformat()
        a1 = (s0 - timedelta(days=7 * (k - 1))).isoformat()
        n = c.execute(f"select count(*) from messages m where {where} and m.day >= ? and m.day < ?", params + [a0, a1]).fetchone()[0]
        tot = c.execute("select count(*) from messages where day >= ? and day < ?", [a0, a1]).fetchone()[0]
        if tot:
            counts.append(n)
    band = db._quart(counts)
    tot_now = c.execute("select count(*) from messages where day >= ? and day < ?", [start, end]).fetchone()[0]
    return {"about": about, "what": what, "note": note, "from": start, "to": end, "count": len(rows), "of": tot_now,
            "usual_week": {"lo": band[0], "mid": band[1], "hi": band[2]} if band else None,
            "days": {d: len(v) for d, v in sorted(by_day.items())}, "moments": picked}


def print_moments(res, json_=False):
    if json_:
        res = dict(res, moments=[dict(r) | {"text": r["text"][:1500], "reply": (r["reply"] or "")[:600]} for r in res["moments"]])
        return jout(res)
    u = res["usual_week"]
    usual = f"; a usual week has {u['lo']:g}–{u['hi']:g} (median {u['mid']:g})" if u else ""
    out(f"{res['count']} {res['what']} from {res['from']} to {res['to']} (of {res['of']} messages){usual}.")
    if res["days"] and len(res["days"]) > 1:
        out("By day: " + ", ".join(f"{DOW[date.fromisoformat(d).weekday()]} {date.fromisoformat(d).day} {n}" for d, n in res["days"].items()))
    if res["note"]:
        out(res["note"])
    for r in res["moments"]:
        out(msg_line(r))
    if res["moments"]:
        out(f"Read one whole: wimym show <id>  ·  in the app: {db.APP}/messages/<full id>")


def cmd_moments(a):
    c = conn(a)
    if a.since:
        start, end = a.since, a.until or (date.today() + timedelta(days=1)).isoformat()
    else:
        mon = monday(a.week)
        start, end = mon.isoformat(), (mon + timedelta(days=7)).isoformat()
    print_moments(moments(c, a.about, start, end, a.limit), a.json)


# ---------------------------------------------------------------------------------------------
# show

def find_message(c, mid):
    rows = c.execute("select * from messages where id like ? limit 2", [mid + "%"]).fetchall()
    if len(rows) > 1:
        sys.exit(f"wimym show: {mid} matches more than one message; give more of the id")
    if rows:
        return rows[0], c.execute("select * from turns where id = ?", [rows[0]["id"]]).fetchone()
    t = c.execute("select * from turns where id like ? limit 1", [mid + "%"]).fetchone()
    if not t:
        sys.exit(f"wimym show: no message {mid}")
    return None, t


def cmd_show(a):
    c = conn(a)
    m, t = find_message(c, a.id)
    mid = (m or t)["id"]
    s = c.execute("select * from sessions where sid = ?", [(m or t)["sid"]]).fetchone()
    labs = c.execute('select "set" as s, field, value, version, file from labels where id = ? order by current desc', [mid]).fetchall()
    nxt = None
    if m:
        nxt = c.execute("select * from messages where sid = ? and ts > ? order by ts limit 1", [m["sid"], m["ts"]]).fetchone()
    before = c.execute("select reply from turns where sid = ? and ts < ? and ts is not null order by ts desc limit 1",
                       [(m or t)["sid"], (m or t)["ts"]]).fetchone()
    if a.json:
        return jout({"message": dict(m) if m else None, "turn": dict(t) if t else None, "session": dict(s) if s else None,
                     "labels": [dict(x) for x in labs], "before": before["reply"] if before else None,
                     "next": dict(nxt) if nxt else None, "link": db.link(mid)})
    r = m or t
    when = db.local(r["ts"]).strftime("%a %d %b %Y %H:%M")
    out(f"{mid}  {when}  {r['project']}  ·  {(s['title'] if s and s['title'] else '') or ''}")
    bits = [f"model {t['model']}" if t and t["model"] else None, f"effort {t['effort']}" if t and t["effort"] else None,
            f"from {r['src']}", f"mode {t['mode']}" if t and t["mode"] else None]
    out(" · ".join(b for b in bits if b))
    if m:
        cols = ("intent", "tone", "specific", "own", "who", "scope", "pressure", "irk", "play",
                "decides", "defers", "withPeople", "selfState", "handsOver", "domain")
        lab = [f"{k} {m[k]}" for k in cols if k in m.keys() and m[k] is not None]
        shown = {"in", "to", "sp", "ag", "own", "who", "sc", "pr", "irk", "pl", "dec", "dfr", "ppl", "st", "off", "dom", "h", "v", "w"}
        extra, seen = [], set()
        for x in labs:  # other labels on this message, current version first, each field once
            if x["field"] not in shown and x["field"] not in seen and x["value"] not in ("", "[]", None):
                extra.append(f"{x['field']} {clip(x['value'], 60)}")
                seen.add(x["field"])
        if lab or extra:
            by = "Jev" if any(str(x["version"]).endswith("-jev") for x in labs) else "Haiku"
            out(f"labels ({by}): " + ", ".join(lab + extra))
    if before and before["reply"] and a.context:
        out(f"\n--- Claude, just before\n{clip(before['reply'], 600)}")
    text = r["text"] or ""
    out(f"\n--- you ({len(text.split())} words{', cut at 20,000 characters' if m and m['truncated'] else ''})")
    out(text if a.full or len(text) <= 3000 else text[:3000] + f"\n… ({len(text) - 3000} more characters: --full)")
    reply = (t["reply"] if t else "") or ""
    if reply:
        out("\n--- Claude's last words in that turn (kept up to 2,500 characters)")
        out(reply if a.full or len(reply) <= 1500 else reply[:1500] + "\n… (--full)")
    if t:
        out("\n--- what it set off")
        dur = (m["dur"] if m else None)
        cat = json.loads(t["cat"]) if t["cat"] else {}
        files = json.loads(t["files"]) if t["files"] else []
        parts = [f"{dur // 60}m{dur % 60:02d}s" if dur else None,
                 f"{t['tools']} tool calls" + (f" ({', '.join(f'{k} {v}' for k, v in sorted(cat.items(), key=lambda kv: -kv[1]))})" if cat else ""),
                 f"{len(files)} files changed" if files else None, f"+{t['add']} −{t['del']} lines" if (t["add"] or t["del"]) else None,
                 f"{t['commits']} commits" if t["commits"] else None, f"{t['pushes']} pushes" if t["pushes"] else None,
                 f"{t['prs']} PRs" if t["prs"] else None, "you stopped it" if t["interrupted"] else None,
                 f"{t['spawn']} sessions started" if t["spawn"] else None, f"{t['fail']} tool failures" if t["fail"] else None]
        out(" · ".join(p for p in parts if p))
        if files:
            out("files: " + ", ".join(f.replace(HOME, "~") for f in files[:8]) + (f" … {len(files) - 8} more" if len(files) > 8 else ""))
    if nxt:
        out(f"\n--- next, {fmt_gap(m['nextGap'])} later: [{nxt['intent'] or '?'}] {clip(nxt['text'], 300)}  ({short(nxt['id'])})")
    out(f"\n{db.link(mid)}")


def fmt_gap(s):
    if s is None:
        return "?"
    return f"{s}s" if s < 90 else f"{round(s / 60)} min" if s < 5400 else f"{s / 3600:.1f} h"


# ---------------------------------------------------------------------------------------------
# week

def vitals_for(c, start):
    rows = c.execute("select * from vitals where grain = 'week' and period = ?", [start]).fetchall()
    return {r["measure"]: r for r in rows}


def measure_info(c, key):
    m = meta(c)
    about = {x["key"]: x for x in ((m.get("vitals_about") or {}).get("measures") or [])}
    if key in about:
        x = about[key]
        return x.get("label") or key, {"h": "h", "min": "min", "days": "n", "%": "%", "count": "n", "perh": "perh"}.get(x.get("unit"), "n"), x.get("better"), x.get("question")
    return MEASURES.get(key, (key, "n", None, ""))


def cmd_week(a):
    c = conn(a)
    mon = monday(a.week)
    start, end = mon.isoformat(), (mon + timedelta(days=7)).isoformat()
    vit = vitals_for(c, start)
    days = c.execute("select * from days where day >= ? and day < ? order by day", [start, end]).fetchall()
    if not days and not vit:
        sys.exit(f"wimym week: nothing for the week of {start}")
    partial = any(v["partial"] for v in vit.values())
    outside, inside = [], []
    for k, v in vit.items():
        label, unit, better, desc = measure_info(c, k)
        row = {"measure": k, "label": label, "value": v["value"], "lo": v["lo"], "mid": v["mid"], "hi": v["hi"], "outside": v["outside"],
               "unit": unit, "better": better, "meaning": desc}
        (outside if v["outside"] else inside).append(row)
    # two weeks running outside, the rule for a flag
    prev = vitals_for(c, (mon - timedelta(days=7)).isoformat())
    for r in outside:
        p = prev.get(r["measure"])
        r["twice"] = bool(p and p["outside"] == r["outside"])
    proj_rows = c.execute("select day, project, count(*) n from messages where day >= ? and day < ? group by day, project", [start, end]).fetchall()
    projs = {}
    for r in proj_rows:
        projs.setdefault(r["day"], []).append((r["project"], r["n"]))
    blocks = {r["day"]: r for r in c.execute("select day, round(sum(minutes)/60.0, 1) active, max(longest_min) longest, sum(switches) sw "
                                               "from blocks where day >= ? and day < ? group by day", [start, end])}
    checks = {r["day"]: r for r in c.execute("select * from checkins where day >= ? and day < ?", [start, end])}
    inflight = [p for p in practices.practices() if p.get("status") == "trying"]
    if a.json:
        wmj = [dict(r) | {"messages": json.loads(r["messages"] or "[]"), "extra": json.loads(r["extra"]) if r["extra"] else None}
               for r in c.execute("select * from week_moments where week = ? order by rank", [start])] \
            if c.execute("select 1 from sqlite_master where name = 'week_moments'").fetchone() else []
        return jout({"week": start, "partial": partial, "outside": outside, "inside": inside, "moments": wmj, "days": [dict(d) for d in days],
                     "projects": projs, "blocks": {k: dict(v) for k, v in blocks.items()}, "checkins": {k: dict(v) for k, v in checks.items()},
                     "practices": inflight})
    m = meta(c)
    out(f"Week of {mon.strftime('%a %d %b %Y')}{' (so far)' if partial else ''}. Yardstick: your own 8 weeks before "
        f"(25th–75th percentile). Vital signs from: {m.get('vitals_source')}.")
    summ = c.execute("select summary from week_summary where week = ?", [start]).fetchone() \
        if c.execute("select 1 from sqlite_master where name = 'week_summary'").fetchone() else None
    if summ and summ["summary"]:
        out(summ["summary"])
    if outside:
        out("\nOutside your range:")
        for r in sorted(outside, key=lambda r: not r["twice"]):
            way = {"higher": "above", "lower": "below"}.get(r["better"])
            tone = "" if not way else (", the better way" if r["outside"] == way else ", the worse way")
            out(f"  {r['label']:<20} {fmt(r['value'], r['unit']):>8}   usual {fmt(r['lo'], r['unit'])}–{fmt(r['hi'], r['unit'])}   "
                f"{r['outside']}{tone}{', 2nd week' if r['twice'] else ''}   ({r['measure']}: {r['meaning']})")
    out("\nWithin: " + ", ".join(f"{r['label'].lower()} {fmt(r['value'], r['unit'])}" for r in inside if r["value"] is not None))
    out("\nDays:")
    for d in days:
        dd = date.fromisoformat(d["day"])
        if not d["n"]:
            out(f"  {DOW[dd.weekday()]} {dd.day:>2}  off")
            continue
        b = blocks.get(d["day"])
        ps = sorted(projs.get(d["day"], []), key=lambda x: -x[1])
        tot = sum(n for _, n in ps) or 1
        top = ", ".join(f"{p} {round(100 * n / tot)}%" for p, n in ps[:3]) + (f" +{len(ps) - 3}" if len(ps) > 3 else "")
        ck = checks.get(d["day"])
        ckt = ""
        if ck:
            ckt = "  check-in: " + " ".join(f"{k} {ck[k]}" for k in ("energy", "mood", "focus") if ck[k] is not None) + (f" \"{clip(ck['note'], 60)}\"" if ck["note"] else "")
        out(f"  {DOW[dd.weekday()]} {dd.day:>2}  {hh(d['start'])}–{hh(d['end'])}  active {b['active'] if b else '?'}h  "
            f"{d['n']} msgs  night before {d['rest'] if d['rest'] is not None else '?'}h  peak {d['peak']} at once  "
            f"{d['commits']} commits  {top}{ckt}")
    if not checks:
        out("  No check-ins this week: how the days felt is yours to say.")
    if inflight:
        out("\nPractices in flight (wimym practice check):")
        for p in inflight:
            out(f"  {p['id']}: {p['text']} (since {p['start']})")
    tables = {r[0] for r in c.execute("select name from sqlite_master where type = 'table'")}
    wm = c.execute("select * from week_moments where week = ? order by rank", [start]).fetchall() if "week_moments" in tables else []
    if wm:
        out(f"\nCandidate moments, most unusual first (the engine's; {len(wm)}). Read them whole before choosing three:")
        for r in wm[:a.limit]:
            ids = json.loads(r["messages"]) if r["messages"] else []
            unusual = f", beats {round(100 * r['unusual'])}% of your days before" if r["unusual"] is not None else ""
            about = ", ".join(x for x in (r["about"], unusual.lstrip(", ")) if x)
            out(f"  [{r['key']}] {r['title']}" + (f" ({about})" if about else ""))
            out(f"    {r['question']}")
            for mid in ids[:a.per]:
                m = c.execute("select * from messages where id = ?", [mid]).fetchone()
                if m:
                    out("    " + msg_line(m, 100))
            if len(ids) > a.per:
                out(f"    … {len(ids) - a.per} more: wimym sql \"select messages from week_moments where week = '{start}' and key = '{r['key']}'\"")
            extra = json.loads(r["extra"]) if r["extra"] else {}
            for k, v in extra.items():
                if isinstance(v, list) and v and isinstance(v[0], dict):
                    out(f"    {k}: " + "; ".join(", ".join(f"{x}" for x in d.values()) for d in v[:5]) + (f" … {len(v) - 5} more" if len(v) > 5 else ""))
        return
    out("\nMoments behind what's outside (wimym moments --about <key> --week " + start + "):")
    keys = [r["measure"] for r in outside if r["measure"] in ABOUT_OF] or ["corrections"]
    shown = 0
    for k in keys[:4]:
        res = moments(c, ABOUT_OF[k], start, end, 3)
        if res["moments"]:
            out(f"  {k}: {res['count']} {res['what']}")
            for r in res["moments"]:
                out("    " + msg_line(r, 110))
            shown += 1
    if not shown:
        out("  none")


ABOUT_OF = {"switches": "switches", "corrections": "corrections", "frustrated": "frustrated", "strain": "strain", "unread": "unread",
            "stopped": "stopped", "defer_words": "defer_words", "late": "late", "end": "late", "night": "late", "start": "early",
            "stretch": "stretch", "load": "late"}


# ---------------------------------------------------------------------------------------------
# rules: instructions the person keeps giving, as candidates for a practice given to the agents

STOP = set("""a an the and or of to in on for with by is are be it this that these those not no don't do dont never always
use using should must only any all from as at into than then so we you i our your its their when if but more less de la le les
des et un une du en pas ne que qui pour sur avec""".split())


def _words(t):
    return {w for w in re.findall(r"[a-zà-ÿ0-9]+", (t or "").lower()) if w not in STOP and len(w) > 2}


def _overlap(a, b):
    return len(a & b) / len(a) if a else 0


def instructions():
    """The person's standing instructions to agents, as Claude Code loads them: memory notes and CLAUDE.md files.
    Read only."""
    import glob
    out = []
    for p in glob.glob(os.path.join(HOME, ".claude", "projects", "*", "memory", "*.md")):
        if os.path.basename(p) != "MEMORY.md":
            try:
                out.append((p, open(p, encoding="utf-8", errors="replace").read()[:3000]))
            except OSError:
                pass
    for p in [os.path.join(HOME, ".claude", "CLAUDE.md")] + glob.glob(os.path.join(HOME, "*", "CLAUDE.md")):
        try:
            for para in open(p, encoding="utf-8", errors="replace").read().split("\n\n"):
                out.append((p, para[:1500]))
        except OSError:
            pass
    return [(p, t, _words(t)) for p, t in out]


def covered(rule, docs):
    """The instruction that already says this, when most of the rule's weight is in it: rare words (impeccable,
    numbering) weigh more than common ones (file, avoid)."""
    import math
    w = _words(rule)
    if len(w) < 2 or not docs:
        return None
    n = len(docs)
    idf = {x: math.log((n + 1) / (1 + sum(1 for _, _, dw in docs if x in dw))) for x in w}
    total = sum(idf.values()) or 1
    score, p = max(((sum(idf[x] for x in w & dw) / total, p) for p, _, dw in docs), key=lambda x: x[0])
    return {"file": p.replace(HOME, "~"), "score": round(score, 2)} if score >= .6 else None


def rule_groups(c):
    """Groups of repeated instructions: the labeller's rules.json when it exists, else the acts readings grouped here."""
    rows = c.execute("select * from rules order by n_").fetchall() if c.execute(
        "select 1 from sqlite_master where name = 'rules'").fetchone() else []
    if rows:
        out = []
        for r in rows:
            g = dict(r)
            for k in ("ids", "projects"):
                g[k] = json.loads(g[k]) if isinstance(g.get(k), str) and g[k].startswith("[") else g.get(k)
            out.append(g)
        return out, "rules.json"
    ms = c.execute("select id, day, project, rule, text from messages where rule is not null order by ts").fetchall()
    groups = []
    for m in ms:
        w = _words(m["rule"])
        g = next((g for g in groups if len(w & g["words"]) / max(1, min(len(w), len(g["words"]))) >= .5), None)
        if g:
            g["ids"].append(m["id"])
            g["words"] |= w
            g["projects"].add(m["project"])
            g["last"] = m["day"]
            g["texts"].append(m["rule"])
        else:
            groups.append({"rule": m["rule"], "words": set(w), "ids": [m["id"]], "projects": {m["project"]}, "first": m["day"],
                           "last": m["day"], "texts": [m["rule"]]})
    out = []
    for g in sorted(groups, key=lambda g: (-len(g["ids"]), g["first"])):
        out.append({"rule": g["rule"], "n": len(g["ids"]), "ids": g["ids"], "projects": sorted(g["projects"]), "first": g["first"],
                    "last": g["last"], "variants": sorted(set(g["texts"]))[:4]})
    for i, g in enumerate(out, 1):
        g["n_"] = i
    return out, "acts readings grouped by the CLI (rules.json not made yet)"


def cmd_rules(a):
    c = conn(a)
    groups, source = rule_groups(c)
    docs = instructions()
    for g in groups:
        if not g.get("known"):
            g["covered"] = covered(g["rule"], docs)
    if a.action == "draft":
        g = next((g for g in groups if g["n_"] == a.n), None)
        if not g:
            sys.exit(f"wimym rules draft: no rule {a.n} (wimym rules lists them)")
        return draft(c, g, a.json)
    shown = [g for g in groups if a.all or g["n"] >= 2]
    if a.json:
        return jout({"source": source, "groups": shown})
    out(f"Instructions you gave more than once ({source}). A model's reading of your messages: open them before trusting it.")
    if not shown:
        out(f"None given twice yet ({len(groups)} given once; --all lists them).")
    for g in shown:
        cov = g.get("known") or (f"maybe already in {g['covered']['file']}" if g.get("covered") else "not in any memory note or CLAUDE.md")
        out(f"{g['n_']:>3}. {clip(g['rule'], 100)}  ×{g['n']}  {', '.join(g.get('projects') or [])[:60]}  {g.get('first')}..{g.get('last')}")
        out(f"     {cov}" + (f"; also said as: {'; '.join(clip(v, 50) for v in g['variants'][1:3])}" if len(g.get("variants") or []) > 1 else ""))
        for mid in (g.get("ids") or [])[:a.per]:
            m = c.execute("select * from messages where id = ?", [mid]).fetchone()
            if m:
                out("       " + msg_line(m, 90))
    out("A draft for the agents, to approve before anything is written: wimym rules draft <n>")


def _slug(cwd):
    return re.sub(r"[^A-Za-z0-9]", "-", cwd)


def draft(c, g, json_=False):
    msgs = [c.execute("select * from messages where id = ?", [mid]).fetchone() for mid in g.get("ids") or []]
    msgs = [m for m in msgs if m]
    cwds = {(c.execute("select cwd from turns where id = ?", [m["id"]]).fetchone() or {"cwd": None})["cwd"] for m in msgs}
    cwds = {x for x in cwds if x}
    one = len({m["project"] for m in msgs}) == 1 and len(cwds) >= 1
    name = "-".join(sorted(_words(g["rule"]), key=lambda w: g["rule"].lower().find(w))[:5]) or "rule"
    if one:
        cwd = sorted(cwds)[0]
        where = os.path.join(HOME, ".claude", "projects", _slug(re.sub(r"/\.claude/worktrees/[^/]+$", "", cwd)), "memory", name + ".md")
    else:
        where = os.path.join(HOME, ".claude", "CLAUDE.md")
    quotes = [f"- {m['day']}, {m['project']}: \"{clip(m['text'], 140)}\" ({db.link(m['id'])})" for m in msgs[:4]]
    note = (f"---\nname: {name}\ndescription: {clip(g['rule'], 120)}\nmetadata:\n  type: feedback\n---\n\n"
            f"{g['rule'][0].upper() + g['rule'][1:]}.\n\n"
            f"**Why:** The person has asked for this {g['n']} times ({g.get('first')} to {g.get('last')}), so it keeps being forgotten.\n\n"
            f"**How to apply:** <say when it applies, in the person's words, after reading the messages below>\n")
    line = f"- {g['rule'][0].upper() + g['rule'][1:]}."
    res = {"rule": g["rule"], "times": g["n"], "where": where.replace(HOME, "~"), "memory_note": note, "claude_md_line": line,
           "messages": [m["id"] for m in msgs], "covered": g.get("covered") or g.get("known")}
    if json_:
        return jout(res)
    out(f"Draft for rule {g['n_']}: \"{g['rule']}\", given {g['n']} times. Nothing is written: the person decides.")
    if res["covered"]:
        cv = res["covered"]
        out(f"First check: {cv['file'] if isinstance(cv, dict) else cv} may already say this. If it does, it isn't working: "
            "find out why before adding more.")
    out("\nWhere: " + res["where"] + ("  (one project: its memory folder)" if one else "  (several projects: the global CLAUDE.md)"))
    out("\nAs a memory note:\n" + note)
    out("Or as one line in a CLAUDE.md:\n" + line)
    out("\nThe messages it comes from (read them to write the Why and How in the person's words):\n" + "\n".join(quotes))
    out("\nIf the person says yes, write it with them, then record it: wimym practice add \"<the rule>\" --owner agents --where \""
        + res["where"] + "\"")


# ---------------------------------------------------------------------------------------------
# practices, log, limits

def weekly_series(c, p, weeks_before=8):
    """[(week, value)] for 8 weeks before the start and every week since, by measure or by the practice's query."""
    s = date.fromisoformat(p["start"])
    mon = s - timedelta(days=s.weekday())
    today = (datetime.now() - timedelta(hours=db.DAY_START)).date()
    weeks, w = [], mon - timedelta(days=7 * weeks_before)
    while w <= today:
        weeks.append(w)
        w += timedelta(days=7)
    out_ = []
    for w in weeks:
        if p.get("sql"):
            try:
                v = c.execute(p["sql"], {"start": w.isoformat(), "end": (w + timedelta(days=7)).isoformat()}).fetchone()
                v = v[0] if v else None
            except sqlite3.Error as e:
                return None, f"the practice's query failed: {e}"
        else:
            r = c.execute("select value from vitals where measure = ? and grain = 'week' and period = ?", [p["measure"], w.isoformat()]).fetchone()
            v = r["value"] if r else None
        out_.append((w.isoformat(), v, w >= mon))
    return out_, None


def daily_series(c, p):
    if not p.get("measure"):
        return []
    rows = c.execute("select period, value from vitals where measure = ? and grain = 'day' and period >= ? order by period",
                     [p["measure"], p["start"]]).fetchall()
    return [(r["period"], r["value"]) for r in rows]


def check(c, p):
    series, err = weekly_series(c, p)
    if err:
        return {"id": p["id"], "error": err}
    before = [v for w, v, during in series if not during and v is not None]
    during = [(w, v) for w, v, d in series if d]
    band = db._quart(before)
    daily = daily_series(c, p)
    held_days = [practices.held(p.get("target"), v) for _, v in daily]
    held_days = [h for h in held_days if h is not None]
    end = (date.fromisoformat(p["start"]) + timedelta(days=p.get("trial", 14))).isoformat()
    return {"id": p["id"], "text": p["text"], "status": p.get("status"), "start": p["start"], "trial_ends": end,
            "measure": p.get("measure"), "target": p.get("target"),
            "before": {"lo": band[0], "mid": band[1], "hi": band[2]} if band else None, "before_weeks": len(before),
            "during": [{"week": w, "value": v, "held": practices.held(p.get("target"), v)} for w, v in during],
            "days_held": [sum(held_days), len(held_days)] if held_days else None,
            "verdicts": p.get("verdicts") or [], "due": date.today().isoformat() >= end}


def cmd_practice(a):
    if a.action == "add":
        p = practices.add(a.text, owner=a.owner, measure=a.measure, sql=a.sql, target=a.target, start=a.start,
                          trial=a.trial, why=a.why, where=a.where)
        return jout(p) if a.json else out(f"Practice {p['id']} started {p['start']}, trial {p['trial']} days: {p['text']}")
    if a.action == "verdict":
        p = practices.verdict(a.id, a.verdict, a.note)
        return jout(p) if a.json else out(f"{p['id']}: {p['status']}")
    ps = practices.practices()
    if a.action == "list":
        if a.json:
            return jout(ps)
        if not ps:
            return out("No practices yet. The retro proposes them; `wimym practice add` records one with the person's yes.")
        for p in ps:
            how = p.get("measure") or ("query" if p.get("sql") else "no check")
            out(f"{p['id']:<24} {p['status']:<8} since {p['start']}  {p['owner']:<6} [{how} {p.get('target') or ''}]  {clip(p['text'], 90)}")
        return
    if a.action == "check":
        c = conn(a)
        sel = [p for p in ps if (p["id"] == a.id if a.id else p.get("status") == "trying")]
        if not sel:
            return out("No practice in flight." if not a.id else f"No practice {a.id}.")
        res = [check(c, p) for p in sel]
        if a.json:
            return jout(res)
        for r in res:
            if r.get("error"):
                out(f"{r['id']}: {r['error']}")
                continue
            b = r["before"]
            unit = MEASURES.get(r["measure"] or "", ("", "n"))[1]
            out(f"{r['id']}: {r['text']}")
            out(f"  since {r['start']}, trial to {r['trial_ends']}{' (due for a verdict)' if r['due'] else ''}; "
                f"check: {r['measure'] or 'query'} {r['target'] or ''}")
            out(f"  before: {fmt(b['lo'], unit)}–{fmt(b['hi'], unit)} (median {fmt(b['mid'], unit)}, {r['before_weeks']} weeks)" if b
                else "  before: not enough weeks to draw a range")
            out("  during: " + ", ".join(f"{w[5:]} {fmt(v, unit)}" + ("" if h is None else " ✓" if h else " ✗") for w, v, h in
                                          ((d["week"], d["value"], d["held"]) for d in r["during"])))
            if r["days_held"]:
                out(f"  held on {r['days_held'][0]} of {r['days_held'][1]} days")
            for v in r["verdicts"]:
                out(f"  {v['at'][:10]} {v['verdict']}{': ' + v['note'] if v.get('note') else ''}")


def cmd_log(a):
    if a.action == "add":
        refs = [x.strip() for x in (a.ref or "").split(",") if x.strip()]
        e = practices.log_add(a.text, kind=a.kind, week=a.week, refs=refs, practice=a.practice)
        return jout(e) if a.json else out(f"Logged ({e['kind']}): {e['text']}")
    es = practices.log()
    if a.kind:
        es = [e for e in es if e.get("kind") == a.kind]
    es = es[-a.limit:]
    if a.json:
        return jout(es)
    if not es:
        return out("The growth log is empty.")
    for e in es:
        out(f"{e['at'][:10]}  {e['kind']:<8} {(e.get('week') or ''):<10} {e['text']}" + (f"  refs {', '.join(short(x) for x in e['refs'])}" if e.get("refs") else ""))


def cmd_limits(a):
    if a.action == "set":
        lim = practices.set_limit(a.key, a.value)
    elif a.action == "clear":
        lim = practices.set_limit(a.key, None)
    else:
        lim = practices.limits()
    if a.json:
        return jout(lim)
    names = {"stopHour": "Stopping hour", "daysOffPerWeek": "Days off a week", "maxSessions": "Most sessions at once"}
    for k, n in names.items():
        v = lim.get(k)
        out(f"{n:<22} {(hh(v) if k == 'stopHour' and v is not None else v) if v is not None else 'not set'}")


# ---------------------------------------------------------------------------------------------

def main(argv=None):
    p = argparse.ArgumentParser(prog="wimym", description="Ask your own record questions. Short output by default; --json for more.")
    p.add_argument("--json", action="store_true", help="JSON instead of short text")
    p.add_argument("--fresh", action="store_true", help="rebuild the database first if any transcript changed")
    sub = p.add_subparsers(dest="cmd", required=True)

    def sp(name, **kw):
        s = sub.add_parser(name, **kw)
        s.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
        s.add_argument("--fresh", action="store_true", default=argparse.SUPPRESS)
        return s

    s = sp("sql", help="run a read-only query")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=40)
    s.add_argument("--all", action="store_true")
    s.add_argument("--wide", action="store_true", help="don't cut long cells")
    s.set_defaults(f=cmd_sql)
    s = sp("schema", help="tables and columns, with what they mean")
    s.add_argument("table", nargs="?")
    s.set_defaults(f=cmd_schema)
    s = sp("build", help="rebuild the database now")
    s.set_defaults(f=cmd_build)
    s = sp("label", help="label what's new since the last run, every set in order, today left out; says what it costs first")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="what it would send and the cost, and stop")
    g.add_argument("--yes", action="store_true", help="send it without asking")
    s.add_argument("--jobs", type=int, default=6, help="calls at once")
    s.set_defaults(f=cmd_label)
    s = sp("week", help="a week's vital signs, days and moments (default: last complete week)")
    s.add_argument("week", nargs="?", help="YYYY-MM-DD (any day of it), 2026-W42, this, last")
    s.add_argument("--limit", type=int, default=8, help="candidate moments shown (default 8)")
    s.add_argument("--per", type=int, default=2, help="messages shown per moment (default 2)")
    s.set_defaults(f=cmd_week)
    s = sp("moments", help="the messages behind a pattern")
    s.add_argument("--about", required=True, help="corrections, frustrated, strain, unread, stopped, late, early, switches, "
                                                  "stretch, own, handed, questions, defers, defer_words, decides, people, selfstate, or field=value (intent=fix, dfr=true)")
    s.add_argument("--week", help="YYYY-MM-DD, 2026-W42, this, last (default)")
    s.add_argument("--since", help="YYYY-MM-DD, instead of a week")
    s.add_argument("--until", help="YYYY-MM-DD, excluded")
    s.add_argument("--limit", type=int, default=8)
    s.set_defaults(f=cmd_moments)
    s = sp("show", help="one message whole: your words, Claude's reply, what it set off")
    s.add_argument("id")
    s.add_argument("--full", action="store_true")
    s.add_argument("--context", action="store_true", help="also Claude's message just before")
    s.set_defaults(f=cmd_show)
    s = sp("rules", help="instructions you keep giving the agents; draft <n> proposes the text, writes nothing")
    s.add_argument("action", nargs="?", choices=["list", "draft"], default="list")
    s.add_argument("n", nargs="?", type=int)
    s.add_argument("--all", action="store_true", help="also instructions given once")
    s.add_argument("--per", type=int, default=2, help="messages shown per rule")
    s.set_defaults(f=cmd_rules)
    s = sp("practice", help="practices: add, list, check, verdict")
    s.add_argument("action", choices=["add", "list", "check", "verdict"])
    s.add_argument("arg", nargs="?", help="add: the practice's text; check/verdict: its id")
    s.add_argument("verdict", nargs="?", choices=["keep", "change", "drop"])
    s.add_argument("--owner", default="person", choices=practices.OWNERS)
    s.add_argument("--where", help="for agents: memory, CLAUDE.md, a skill, a permission")
    s.add_argument("--measure", help="a vital sign key: " + ", ".join(MEASURES))
    s.add_argument("--sql", help="or a query returning one number for :start to :end (end excluded)")
    s.add_argument("--target", help='how to tell it held: "<= 0", ">= 7"')
    s.add_argument("--start", help="YYYY-MM-DD, default today")
    s.add_argument("--trial", type=int, default=14, help="days, default 14")
    s.add_argument("--why", help="what it answers: a moment or a finding")
    s.add_argument("--note")
    s.set_defaults(f=cmd_practice)
    s = sp("log", help="the growth log: add, list")
    s.add_argument("action", choices=["add", "list"])
    s.add_argument("text", nargs="?")
    s.add_argument("--kind", choices=practices.KINDS)
    s.add_argument("--week")
    s.add_argument("--ref", help="message ids, comma separated")
    s.add_argument("--practice")
    s.add_argument("--limit", type=int, default=30)
    s.set_defaults(f=cmd_log)
    s = sp("limits", help="the limits you set: stopping hour, days off, sessions at once")
    s.add_argument("action", nargs="?", choices=["show", "set", "clear"], default="show")
    s.add_argument("key", nargs="?", choices=list(practices.LIMITS))
    s.add_argument("value", nargs="?")
    s.set_defaults(f=cmd_limits)

    a = p.parse_args(argv)
    if a.cmd == "practice":
        if a.action == "add":
            a.text = a.arg
            if not a.text:
                p.error("practice add needs the practice's text")
        elif a.action in ("check", "verdict"):
            a.id = a.arg
            if a.action == "verdict" and not (a.id and a.verdict):
                p.error("practice verdict <id> keep|change|drop [--note …]")
        else:
            a.id = None
    if a.cmd == "rules" and a.action == "draft" and not a.n:
        p.error("rules draft <n>: the number from wimym rules")
    if a.cmd == "log" and a.action == "add":
        if not a.text:
            p.error("log add needs text")
        a.kind = a.kind or "note"
    if a.cmd == "limits" and a.action in ("set", "clear") and not a.key:
        p.error("limits set <key> <value> | limits clear <key>")
    try:
        a.f(a)
    except ValueError as e:
        sys.exit(f"wimym: {e}")
    except BrokenPipeError:
        pass


if __name__ == "__main__":
    main()
