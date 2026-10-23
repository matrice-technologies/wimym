#!/usr/bin/env python3
"""Accounts written by Sonnet, through the logged-in `claude` CLI like label.py. Three sets, defined in
definitions.json next to the message sets:

    sessions: per main session you typed in: goal, outcome, decisions, loops left open, rework, people, an account
    days:     per day (5:00 to 5:00): decided, dropped, postponed, high and low points, strain, an account
    rules:    the standing rules you gave more than once, grouped, from acts' "rule" field

    python3 labeller/accounts.py sessions --sample 40       # a sample spread across projects and months
    python3 labeller/accounts.py sessions --all --jobs 12   # every session not written at this version
    python3 labeller/accounts.py days --all                 # needs sessions (and reads acts and categories when there)
    python3 labeller/accounts.py rules                      # needs acts on every message
    python3 labeller/accounts.py sessions --show ID         # the input Sonnet gets for one session (or day)

Writes ~/.wimym/labels/<set>.json (or --dir) keyed by session file id or day, with a hash of the input, so a rerun
only writes what is new or changed. Calls, tokens, cost and wall time are logged as in label.py.
"""
import argparse
import glob
import hashlib
import json
import os
import random
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import label as L  # noqa: E402
from label import DEFS, Store, ask, cap, load_json, now, system_prompt  # noqa: E402
from wimym.index import Index  # noqa: E402
from wimym.paths import CLAUDE, LABELS_DIR  # noqa: E402
from wimym.text import not_typed, own_words, project_of  # noqa: E402

DAY_START = 5  # as the engine's model.py: a day runs from 5:00 to 5:00
FULL_FROM = "2026-06-29"  # the first day of Wimym's index: from here on, days.json; before, days-history.json
SESSION_CHARS = 36000
DAY_CHARS = 70000


def local(ts):
    return datetime.fromisoformat(ts[:19]).replace(tzinfo=timezone.utc).astimezone()


def day_of(ts):
    return (local(ts) - timedelta(hours=DAY_START)).date().isoformat()


def ref(k):
    """The short id Sonnet sees: the first 8 characters of the message id."""
    return k[:8] if re.match(r"[0-9a-f]{8}", k) else hashlib.sha1(k.encode()).hexdigest()[:8]


# ---------------------------------------------------------------------------
# Sessions from the index

def load_sessions():
    """Main sessions with at least one message you typed. A fork copies its parent's turns: each turn belongs to the
    copy that saw the most work, as in label.load_prompts, so a fork is only what was new in it."""
    best, recs = {}, []
    for path, r in Index().records():
        if r.get("sub"):
            continue
        stem = os.path.splitext(os.path.basename(path))[0]
        recs.append((stem, path, r))
        for i, t in enumerate(r.get("turns") or []):
            k = t.get("id") or f"{r['sid']}:{t['ts']}"
            score = (t["tools"] + t["msgs"], r.get("sid") == stem)
            if k not in best or score > best[k][0]:
                best[k] = (score, path, i)
    chosen = {(path, i): k for k, (_, path, i) in best.items()}
    out = []
    for stem, path, r in recs:
        turns = []
        for i, t in enumerate(r.get("turns") or []):
            k = chosen.get((path, i))
            if k is None or not t.get("ts"):
                continue
            mine = t["src"] in L.MINE and t["kind"] == "prompt"
            words = own_words(t["text"] or "") if mine else (t["text"] or "")
            turns.append({**t, "key": k, "mine": mine and bool(words.strip()), "words": words,
                          "brief": mine and not_typed(words)})
        if not any(t["mine"] for t in turns):
            continue
        out.append({"id": stem, "path": path, "r": r, "turns": turns,
                    "project": project_of(r.get("cwd")), "start": turns[0]["ts"], "end": turns[-1].get("end") or turns[-1]["ts"]})
    out.sort(key=lambda s: s["start"])
    return out


def did(t):
    bits = []
    for k, one, many in (("tools", "tool", "tools"), ("commits", "commit", "commits"), ("pushes", "push", "pushes"), ("prs", "PR", "PRs")):
        n = int(t.get(k) or 0)
        if n:
            bits.append(f"{n} {one if n == 1 else many}")
    if t.get("interrupted"):
        bits.append("stopped by Alex")
    return f" ({', '.join(bits)})" if bits else ""


def session_text(s, budget=SESSION_CHARS):
    """The session as Sonnet reads it: Alex's messages and Claude's replies, cut to fit the budget."""
    r, turns = s["r"], s["turns"]
    head = (f"Project: {s['project']}. Title: {r.get('title') or '(none)'}. "
            f"From {local(s['start']):%a %d %b %H:%M} to {local(s['end']):%a %d %b %H:%M}. "
            f"{sum(t['mine'] for t in turns)} messages from Alex.")

    def render(a, b, keep=None):
        out = [head]
        for i, t in enumerate(turns):
            at = f"{local(t['ts']):%H:%M}"
            middle = keep is not None and keep[0] <= i < len(turns) - keep[1]
            if t["mine"]:
                who = "Alex (a brief written by an agent, passed on)" if t["brief"] else "Alex"
                out.append(f"[{ref(t['key'])} {at}] {who}: {cap(t['words'], 150 if middle else a, 50 if middle else a // 4)}")
            else:
                out.append(f"[{at}] (automatic: {cap(t['words'], 120, 30)})")
            if middle:
                continue
            if t.get("reply") or did(t):
                out.append(f"Claude{did(t)}: {cap(t.get('reply') or '', b, b // 2)}")
        return "\n".join(out)

    for a, b, keep in ((1500, 900, None), (800, 450, None), (400, 250, None), (300, 200, (15, 25)), (200, 150, (8, 15))):
        text = render(a, b, keep)
        if len(text) <= budget:
            return text
    return text[:budget // 3] + "\n[…]\n" + text[-2 * budget // 3:]


# ---------------------------------------------------------------------------
# Days

def load_label(name, folder, history=False):
    """A message set's labels at its current version: the labels folder, then next/ where a relabel is building it."""
    out, f = {}, L.file_of(name, history)
    for f in (os.path.join(folder, f), os.path.join(folder, "next", f)):
        d = load_json(f)
        out.update({k: l for k, l in (d.get("labels") or {}).items() if l.get("v") == d.get("version")})
    return out


def tags(k, acts, cats):
    a, c, out = acts.get(k) or {}, cats.get(k) or {}, []
    if a.get("dec") and a.get("dw"):
        out.append(f"{{decides: {a['dw']}}}")
    if a.get("dfr") and a.get("fw"):
        out.append(f"{{puts off: {a['fw']}}}")
    if a.get("st") not in (None, "none"):
        out.append(f"{{state: {a['st']}}}")
    if a.get("nd"):
        out.append("{Claude said done, it wasn't}")
    if c.get("to") in ("frustrated", "pleased"):
        out.append(f"{{{c['to']}}}")
    if c.get("in") == "correct":
        out.append("{correction}")
    return (" " + " ".join(out)) if out else ""


def history_sessions():
    """March to June: the prompts from history.jsonl, grouped by session id, shaped like load_sessions()
    (no replies, no titles, no accounts)."""
    by = defaultdict(list)
    for p in L.load_history(L.load_prompts()[0]):
        by[p["id"].rsplit("-", 1)[-1]].append(p)
    return [{"id": f"h:{sid}", "project": ps[0]["project"], "r": {"title": ""}, "history": True,
             "turns": [{"key": p["id"], "ts": p["ts"], "mine": True, "words": p["text"], "brief": p["agh"]} for p in ps]}
            for sid, ps in by.items()]


def load_days(sessions, folder, history=False):
    f = load_json(os.path.join(folder, DEFS["sessions"]["file"]))
    accounts = {k: l for k, l in (f.get("labels") or {}).items() if l.get("v") == f.get("version")}
    acts = load_label("acts", folder, history)
    cats = load_label("categories", folder, history)
    msgs = defaultdict(list)
    for s in sessions:
        for t in s["turns"]:
            if t["mine"]:
                msgs[day_of(t["ts"])].append((t, s))
    days = sorted(msgs)
    out = []
    for i, day in enumerate(days):
        ms = sorted(msgs[day], key=lambda x: x[0]["ts"])
        ids = {ref(t["key"]): t["key"] for t, _ in ms}
        out.append({"id": day, "msgs": ms, "ids": ids, "prev_last": msgs[days[i - 1]][-1][0]["ts"] if i else None,
                    "accounts": accounts, "acts": acts, "cats": cats})
    return out


def day_text(d, budget=DAY_CHARS):
    ms = d["msgs"]
    first, last = local(ms[0][0]["ts"]), local(max(t["ts"] for t, _ in ms))
    sess = {}
    for t, s in ms:
        sess.setdefault(s["id"], s)
    projects = Counter(s["project"] for _, s in ms)
    gap = ""
    if d["prev_last"]:
        h = (datetime.fromisoformat(ms[0][0]["ts"][:19]) - datetime.fromisoformat(d["prev_last"][:19])).total_seconds() / 3600
        gap = f" The gap since his last message the day before: {h:.1f} hours."
    head = [f"Day: {datetime.fromisoformat(d['id']):%A %d %B %Y}. First message {first:%H:%M}, last {last:%H:%M}"
            f"{' (after midnight)' if last.date() > first.date() else ''}.{gap} {len(ms)} messages from Alex in "
            f"{len(sess)} sessions, on " + ", ".join(f"{p} ({n})" for p, n in projects.most_common()) + "."]
    acc = ["", "Sessions he worked in that day:"]
    if all(s.get("history") for s in sess.values()):  # March to June: only his prompts were kept
        acc = ["", "For this period only his own messages were kept: not Claude's replies, nor what each session did."]
    for sid, s in sess.items():
        if s.get("history"):
            continue
        a = d["accounts"].get(sid)
        if a:
            line = f"- {s['project']}, \"{s['r'].get('title') or ''}\": {a.get('account')} Outcome: {a.get('outcome')}."
            if a.get("open"):
                line += " Left open: " + "; ".join(a["open"][:4]) + "."
            if a.get("rework"):
                line += f" Rework: {a.get('rw')}."
        else:
            line = f"- {s['project']}, \"{s['r'].get('title') or ''}\" (no account)."
        acc.append(line)

    def render(n):
        out = ["", "His messages:"]
        for t, s in ms:
            out.append(f"[{ref(t['key'])} {local(t['ts']):%H:%M}] {s['project']}: "
                       f"{'(a brief written by an agent) ' if t['brief'] else ''}{cap(t['words'], n, n // 4)}"
                       f"{tags(t['key'], d['acts'], d['cats'])}")
        return out

    for n in (400, 250, 150, 90, 60):
        text = "\n".join(head + acc + render(n))
        if len(text) <= budget:
            return text
    return text[:budget]


# ---------------------------------------------------------------------------
# Weeks, from the day accounts

def load_weeks(folder):
    """ISO weeks of the days with a day account (days.json, and days-history.json for March to June)."""
    sessions = load_sessions()
    hist = history_sessions() + [s for s in sessions if day_of(s["start"]) < FULL_FROM]
    days = {}
    for history, ss in ((True, hist), (False, sessions)):
        f = load_json(os.path.join(folder, L.file_of("days", history)))
        labs = {k: l for k, l in (f.get("labels") or {}).items() if l.get("v") == f.get("version")}
        for d in load_days(ss, folder, history):
            if d["id"] in labs and (d["id"] < FULL_FROM) == history:
                days[d["id"]] = (d, labs[d["id"]])
    weeks = defaultdict(list)
    for day in sorted(days):
        y, w, _ = datetime.fromisoformat(day).isocalendar()
        weeks[f"{y}-W{w:02d}"].append(days[day])
    return [{"id": k, "days": v, "ids": {r: m for d, _ in v for r, m in d["ids"].items()}} for k, v in sorted(weeks.items())]


def week_text(w):
    y, n = w["id"].split("-W")
    mon = datetime.fromisocalendar(int(y), int(n), 1)
    out = [f"Week {w['id']}, Monday {mon:%d %B} to Sunday {mon + timedelta(days=6):%d %B %Y}. "
           f"Days with messages from Alex: {len(w['days'])} of 7."]
    for d, lab in w["days"]:
        ms = d["msgs"]
        first, last = local(ms[0][0]["ts"]), local(max(t["ts"] for t, _ in ms))
        projects = Counter(s["project"] for _, s in ms)

        def refs(k):
            return "; ".join(x["t"] + (f" [{ref(x['m'])}]" if x.get("m") else "") for x in lab.get(k) or []) or "none"
        out += ["", f"## {datetime.fromisoformat(d['id']):%A %d %B}: first message {first:%H:%M}, last {last:%H:%M}, "
                f"{len(ms)} messages, on " + ", ".join(f"{p} ({c})" for p, c in projects.most_common(6)) + ".",
                lab.get("account") or "", f"Decided: {refs('decided')}", f"Dropped: {refs('dropped')}",
                f"Postponed: {refs('postponed')}", f"High: {refs('high')}", f"Low: {refs('low')}",
                f"Strain: {lab.get('strain') or 'none'}"]
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Rules

def memory_notes():
    out = []
    for f in sorted(glob.glob(os.path.join(CLAUDE, "projects", "*", "memory", "*.md"))):
        try:
            head = open(f, encoding="utf-8").read(1200)
        except OSError:
            continue
        if re.search(r"type:\s*feedback", head):
            name = re.search(r"name:\s*(.+)", head)
            desc = re.search(r"description:\s*(.+)", head)
            out.append(f"- {name.group(1).strip() if name else os.path.basename(f)}: {desc.group(1).strip() if desc else ''}")
    return sorted(set(out))


# ---------------------------------------------------------------------------
# Calls

def parse_any(result):
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", (result or "").strip())
    for a, b in (("[", "]"), ("{", "}")):
        i, j = s.find(a), s.rfind(b)
        if i >= 0 and j > i:
            try:
                return json.loads(s[i:j + 1])
            except ValueError:
                pass
    return None


def resolve(lab, ids):
    """Short message ids back to full ones; a cited id that isn't in the input is dropped (and counted)."""
    bad = 0
    for f in DEFS[lab["set"]]["fields"]:
        if f["type"] == "refs":
            for x in lab[f["key"]]:
                m = re.sub(r"[^0-9a-f]", "", x["m"].lower())[:8]
                x["m"] = ids.get(m, "")
                bad += bool(m) and not x["m"]
        if f["type"] == "text" and f["key"] == "account":
            lab["cites"] = [ids[m] for m in re.findall(r"\[([0-9a-f]{8})\]", lab[f["key"]]) if m in ids]
    lab.pop("set")
    if bad:
        lab["bad_refs"] = bad
    return lab


def run_items(store, todo, render, model, per_call, jobs, timeout, think, max_chars):
    """Like label.label: batches of items, `jobs` calls at once, retries up to three times."""
    from concurrent.futures import ThreadPoolExecutor
    name, system = store.name, system_prompt(store.name)
    t0, first = time.time(), len(store.d["calls"])
    tries, queue, gave_up = Counter(), list(todo), []

    def batches(q):
        out, cur, size = [], [], 0
        for p in q:
            if cur and (len(cur) >= per_call or size + len(p["text"]) > max_chars):
                out.append(cur)
                cur, size = [], 0
            cur.append(p)
            size += len(p["text"])
        return out + ([cur] if cur else [])

    def one(items):
        start = time.time()
        if name in ("days", "weeks"):
            prompt = items[0]["text"] + f"\n\nWrite the account of this {name[:-1]}. JSON object only."
        else:
            prompt = "\n\n".join(f"## Session {n}\n{p['text']}" for n, p in enumerate(items, 1)) + \
                     f"\n\nWrite the account of all {len(items)} sessions. JSON array only."
        got = {}
        try:
            o = ask(prompt, system, model, timeout, think)
            a = parse_any(o.get("result"))
            arr = [a] if isinstance(a, dict) else a if isinstance(a, list) else []
            by_pos = len(arr) == len(items)
            for pos, x in enumerate(arr, 1):
                n = pos if by_pos or not isinstance(x, dict) else x.get("i", pos)
                if isinstance(x, dict) and isinstance(n, int) and 1 <= n <= len(items):
                    p = items[n - 1]
                    lab = L.check(name, x, p)
                    if lab:
                        lab["set"] = name
                        got[p["id"]] = resolve(lab, p["ids"])
            u = o.get("usage") or {}
            call = {"at": now(), "n": len(items), "ok": len(got), "secs": round(time.time() - start, 1),
                    "in": (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0),
                    "out": u.get("output_tokens") or 0, "usd": o.get("total_cost_usd") or 0,
                    "model": next(iter(o.get("modelUsage") or {}), model), "v": store.v, "think": think}
            if len(got) < len(items):
                call["raw"] = (o.get("result") or "")[:400]
        except Exception as e:  # noqa: BLE001
            call = {"at": now(), "n": len(items), "ok": 0, "secs": round(time.time() - start, 1), "error": str(e)[:300],
                    "v": store.v, "think": think}
            if re.search(r"rate|limit|429|overload|529", str(e), re.I):
                time.sleep(60)
        store.put(got, call)
        done = sum(store.done(p) for p in todo)
        print(f"  call: {call['ok']}/{call['n']} in {call['secs']}s, {done}/{len(todo)} done"
              + (f" ({call['error']})" if call.get("error") else ""), flush=True)
        return [p for p in items if p["id"] not in got]

    with ThreadPoolExecutor(max_workers=jobs) as ex:
        while queue:
            for p in queue:
                tries[p["id"]] += 1
            rounds = batches(queue) if all(tries[p["id"]] < 3 for p in queue) else [[p] for p in queue]
            left = [p for r in ex.map(one, rounds) for p in r]
            queue = [p for p in left if tries[p["id"]] < 3]
            if left and not queue:
                gave_up = left
    calls = store.d["calls"][first:]
    return {"calls": len(calls), "secs": round(time.time() - t0, 1), "gave_up": len(gave_up),
            "in": sum(c.get("in", 0) for c in calls), "out": sum(c.get("out", 0) for c in calls),
            "usd": round(sum(c.get("usd", 0) for c in calls), 4)}


def spread(items, n, key, seed=7):
    """n items spread across groups (as label.sample)."""
    rnd, groups = random.Random(seed), defaultdict(list)
    for p in items:
        groups[key(p)].append(p)
    for g in groups.values():
        rnd.shuffle(g)
    keys = sorted(groups)
    rnd.shuffle(keys)
    out = []
    while len(out) < n and any(groups[k] for k in keys):
        for k in keys:
            if groups[k] and len(out) < n:
                out.append(groups[k].pop())
    return out


def rules(folder, model, timeout):
    """One call: every stated rule from acts, grouped; groups across at least two sessions are kept."""
    acts = load_label("acts", folder)
    store = Store(os.path.join(folder, DEFS["rules"]["file"]), "rules")
    sessions = load_sessions()
    # every message with a stated rule: (ts, project, session) from the transcripts, and from history.jsonl
    # (March to June) when acts-history.json is there
    where = {t["key"]: (t["ts"], s["project"], s["id"]) for s in sessions for t in s["turns"] if t["mine"]}
    words = {t["key"]: t["words"] for s in sessions for t in s["turns"] if t["mine"]}
    hist = load_json(os.path.join(folder, L.file_of("acts", True)))
    if hist.get("labels"):
        acts = {**{k: l for k, l in hist["labels"].items() if l.get("v") == hist.get("version")}, **acts}
        for p in L.load_history(L.load_prompts()[0]):
            where[p["id"]] = (p["ts"], p["project"], f"h:{p['id'].rsplit('-', 1)[-1]}")
            words[p["id"]] = p["text"]
    lines, ids = [], {}
    for k, a in acts.items():
        if a.get("rule") and k in where:
            ts, project, _ = where[k]
            r = ref(k)
            ids[r] = k
            lines.append((ts, f"[{r}] {ts[:10]} {project}: {a['rule']}  «{cap(words.get(k, ''), 220, 60)}»"))
    lines = [x for _, x in sorted(lines)]
    notes = memory_notes() or [f"- {n}" for n in load_json(os.path.join(folder, "memory-notes-seen.json")).get("names") or []]
    prompt = ("Rules, one per message:\n" + "\n".join(lines) + "\n\nFeedback notes already in memory:\n" + "\n".join(notes)
              + "\n\nGroup them. Leave out rules said only once. JSON array only.")
    print(f"rules v{store.v}: {len(lines)} stated rules, {len(notes)} feedback notes, {len(prompt):,} characters", flush=True)
    start, t0 = now(), time.time()
    o = ask(prompt, system_prompt("rules"), model, timeout, True)
    arr = parse_any(o.get("result")) or []
    sess_of = {k: where[k][2] for k in ids.values()}
    groups = []
    for g in arr if isinstance(arr, list) else []:
        if not isinstance(g, dict) or not isinstance(g.get("rule"), str):
            continue
        full = [ids[m] for m in dict.fromkeys(re.sub(r"[^0-9a-f]", "", str(m).lower())[:8] for m in g.get("ids") or []) if m in ids]
        ss = {sess_of[k] for k in full}
        if len(ss) < 2:
            continue
        groups.append({"rule": g["rule"].strip()[:240], "kind": g.get("kind") if g.get("kind") in ("writing", "process", "code", "design") else "other",
                       "n": len(full), "sessions": len(ss), "ids": full, "known": str(g.get("known") or "")[:120],
                       "first": min(where[k][0] for k in full)[:10], "last": max(where[k][0] for k in full)[:10],
                       "projects": sorted({where[k][1] for k in full})})
    groups.sort(key=lambda g: (-g["sessions"], -g["n"]))
    u = o.get("usage") or {}
    call = {"at": now(), "n": len(lines), "ok": len(groups), "secs": round(time.time() - t0, 1),
            "in": (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0),
            "out": u.get("output_tokens") or 0, "usd": o.get("total_cost_usd") or 0, "v": store.v,
            "model": next(iter(o.get("modelUsage") or {}), model)}
    if store.old_version not in (None, store.v) and store.d.get("groups"):  # keep the groups of the version before
        store.d[f"groups_v{store.old_version}"] = store.d["groups"]
    store.d["labels"] = {}
    store.d["groups"] = groups
    store.d["calls"].append(call)
    store.d["runs"].append({"start": start, "end": now(), "mode": "all", "v": store.v, "model": model, "think": True,
                            "todo": len(lines), "labelled": len(groups), "calls": 1, "secs": call["secs"], "gave_up": 0,
                            "in": call["in"], "out": call["out"], "usd": call["usd"]})
    store.save()
    print(f"{len(groups)} groups across two sessions or more, ${call['usd']:.2f}, {call['secs'] / 60:.1f} min")
    for g in groups[:40]:
        print(f"  {g['sessions']:>3} sessions {g['n']:>3} msgs  [{g['kind']}] {g['rule']}" + (f"  (memory: {g['known']})" if g["known"] else ""))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("set", choices=["sessions", "days", "weeks", "rules"])
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--all", action="store_true")
    g.add_argument("--sample", type=int, metavar="N")
    g.add_argument("--show", metavar="ID")
    g.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dir", default=LABELS_DIR)
    ap.add_argument("--model")
    ap.add_argument("--per-call", type=int, default=5, help="sessions per call (days: always one)")
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--no-think", action="store_true")
    ap.add_argument("--history", action="store_true", help="days: March to June from history.jsonl, into days-history.json")
    args = ap.parse_args()
    name, folder = args.set, os.path.expanduser(args.dir)
    model = args.model or DEFS[name].get("model") or "sonnet"
    if name == "rules":
        return rules(folder, model, args.timeout)
    sessions = load_sessions()
    if name == "weeks":
        items = [{"id": w["id"], "ts": w["id"], "project": "", "text": week_text(w), "ids": w["ids"]} for w in load_weeks(folder)]
        per_call, max_chars = 1, DAY_CHARS
    elif name == "sessions":
        items = [{"id": s["id"], "ts": s["start"], "project": s["project"], "text": session_text(s),
                  "ids": {ref(t["key"]): t["key"] for t in s["turns"] if t["mine"]}} for s in sessions]
        per_call, max_chars = args.per_call, 3 * SESSION_CHARS
    else:
        if args.history:  # history.jsonl's prompts, and the few older transcripts (agent-mode sessions) the index holds
            sessions = history_sessions() + [s for s in sessions if day_of(s["start"]) < FULL_FROM]
        items = [{"id": d["id"], "ts": d["id"], "project": "", "text": day_text(d), "ids": d["ids"]}
                 for d in load_days(sessions, folder, args.history) if (d["id"] < FULL_FROM) == args.history]
        per_call, max_chars = 1, DAY_CHARS
    for p in items:
        p["h"] = hashlib.sha1(p["text"].encode()).hexdigest()[:12]
    if args.show:
        return print(next((p["text"] for p in items if p["id"].startswith(args.show)), "not found"))
    store = Store(os.path.join(folder, L.file_of(name, args.history)), name)
    todo = [p for p in items if not store.done(p)]
    if args.dry_run or not (args.all or args.sample):
        chars = sum(len(p["text"]) for p in todo)
        return print(f"{name} v{store.v}: {len(items)} items, {len(items) - len(todo)} written, {len(todo)} to go (~{chars // 4:,} tokens in)")
    if args.sample:
        have = set(store.d.get("sample") or [])
        pick = [p for p in items if p["id"] in have] if len(have) == args.sample else \
            spread(items, args.sample, lambda p: (p["project"], p["ts"][:7]) if name == "sessions" else p["ts"][:7])
        store.d["sample"] = sorted(p["id"] for p in pick)
        todo = [p for p in pick if not store.done(p)]
    print(f"{name} v{store.v}: writing {len(todo)}, {per_call} per call, {args.jobs} at once, {model}, "
          f"thinking {'off' if args.no_think else 'on'}", flush=True)
    start = now()
    r = run_items(store, todo, None, model, per_call, args.jobs, args.timeout, not args.no_think, max_chars)
    store.d["runs"].append({"start": start, "end": now(), "mode": "all" if args.all else f"sample {args.sample}", "v": store.v,
                            "model": model, "think": not args.no_think, "todo": len(todo), "labelled": len(todo) - r["gave_up"], **r})
    store.save()
    print(f"done in {r['secs'] / 60:.1f} min, {r['calls']} calls, {r['in']:,} tokens in, {r['out']:,} out, ${r['usd']:.2f}", flush=True)


if __name__ == "__main__":
    main()
