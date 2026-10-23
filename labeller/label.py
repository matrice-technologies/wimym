#!/usr/bin/env python3
"""Label every message you typed with Haiku, through the logged-in `claude` CLI (your
subscription, no API key). Two label sets, each with its own file and version, both defined
in definitions.json next to this file (what each field and value means, and the rules):

    categories: intent, tone, says what done looks like, not typed by you
    signals:    own idea, who makes the call, scope, pressure, annoyed at, playful

    python3 labeller/label.py --dry-run                 # how many messages are left to label, nothing sent
    python3 labeller/label.py --all                     # label everything not labelled at this version
    python3 labeller/label.py --set signals --all       # the second set (after the first: it skips what isn't yours)
    python3 labeller/label.py --check                   # the stored sample + every message Opus marked, then
                                                        # how the labels compare with the Opus marks
    python3 labeller/label.py --report                  # what the labels say so far, and what they cost
    python3 labeller/label.py --promote --dir D         # move complete label files from D into the labels folder
    python3 labeller/label.py --prompt                  # print the instruction Haiku gets

Reads your messages from Wimym's index (~/.cache/wimym/index.json; run the engine once to
build it, this never writes it) and writes ~/.wimym/labels/<set>.json (or --dir), keyed by
the message's turn uuid with a hash of the words sent, so a rerun only labels new or changed
messages. Every call is logged in the file ("calls"), and every run ("runs"): calls, tokens,
list-price cost, wall time.

Ported from claude-memory-map's categorize.py (as of 1223a32): same calls, same batching.
Standard library only. Each call is a `claude -p` that can only answer: no tools, no MCP
servers, no customizations, no slash commands, no session saved, run in an empty folder.
"""
import argparse
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "engine"))
from wimym.index import Index  # noqa: E402
from wimym.paths import HOME, LABELS_DIR, SCRATCH, tmp_name  # noqa: E402
from wimym.text import not_typed, own_words, project_of  # noqa: E402

CLAUDE_BIN = os.environ.get("CLAUDE_BIN") or os.path.join(HOME, ".local", "bin", "claude")
MINE = ("desk", "massistant")
MAX_JOBS = 16  # calls at once; failed calls back off for a minute when the error says rate limit or overload
AUDIT = "audit-opus.json"

with open(os.path.join(HERE, "definitions.json"), encoding="utf-8") as _f:
    DEFS = json.load(_f)["sets"]
MESSAGE_SETS = {n: d for n, d in DEFS.items() if d.get("level", "message") == "message"}  # the rest: accounts.py


# ---------------------------------------------------------------------------
# The instruction, built from definitions.json

def system_prompt(name):
    d = DEFS[name]
    out = [d["intro"]]
    for f in d["fields"]:
        head = f'- "{f["key"]}"' + (f' ({f["label"]})' if f.get("label") else "") + ":"
        if f["type"] == "bool":
            out.append(" ".join([head] + [v["meaning"] for v in f["values"]]))
        elif f["type"] in ("text", "list", "refs"):
            out.append(head + " " + f["lead"])
        else:
            out.append(head + (" " + f["lead"] if f.get("lead") else ""))
            for v in f["values"]:
                out.append(f'  - {v["key"]}: {v["meaning"]}' if f.get("list") else f'  {v["key"]}: {v["meaning"]}')
        if f.get("after"):
            out.append("  " + f["after"])
        for r in f.get("rules") or []:
            out.append(("  * " if f.get("after") else "  ") + r)
    return "\n".join(out) + "\n\n" + d["outro"]


def check(name, a, p):
    """One answer object → a label, or None when a field is missing or off the list."""
    lab = {"h": p["h"], "v": DEFS[name]["version"]}
    for f in DEFS[name]["fields"]:
        x = a.get(f["key"])
        if f["type"] == "text":
            x = "" if x is None else x
            ok = isinstance(x, str)
            x = x.strip()[:f.get("max", 200)] if ok else x
        elif f["type"] == "list":
            x = [] if x is None else x
            ok = isinstance(x, list) and all(isinstance(i, str) for i in x)
            x = [i.strip()[:f.get("max", 60)] for i in x if i.strip()][:8] if ok else x
        elif f["type"] == "refs":  # [{"t": what, "m": the message it comes from}]
            x = [] if x is None else x
            ok = isinstance(x, list) and all(isinstance(i, dict) and isinstance(i.get("t"), str) for i in x)
            x = [{"t": i["t"].strip()[:240], "m": str(i.get("m") or "").strip()} for i in x if i["t"].strip()][:12] if ok else x
        else:
            ok = isinstance(x, bool) if f["type"] == "bool" else x in [v["key"] for v in f["values"]]
        if not ok:
            return None
        lab[f["key"]] = x
    for flag, words in (("dec", "dw"), ("dfr", "fw")):  # what was decided or put off only goes with its flag
        if flag in lab and not lab[flag]:
            lab[words] = ""
    if name == "categories":
        lab["ag"] = lab["ag"] or p["agh"]
        lab["w"] = p["text"][:160]
    return lab


# ---------------------------------------------------------------------------
# Your messages, from Wimym's index

def cap(s, n, tail):
    s = re.sub(r"[ \t]+", " ", (s or "").strip())
    return s if len(s) <= n else s[:n - tail] + " […] " + s[-tail:]


def load_prompts():
    """Every prompt you typed, once (a fork copies its parent's turns: the copy that saw the most
    work wins, as in model.py), with the words to send and Claude's message before it."""
    best, files = {}, []
    for path, r in Index().records():
        if r.get("sub"):
            continue
        stem = os.path.splitext(os.path.basename(path))[0]
        files.append((path, r))
        for i, t in enumerate(r.get("turns") or []):
            k = t.get("id") or f"{r['sid']}:{t['ts']}"
            score = (t["tools"] + t["msgs"], r.get("sid") == stem)
            if k not in best or score > best[k][0]:
                best[k] = (score, path, i)
    chosen = {(path, i): k for k, (_, path, i) in best.items()}
    out, skipped = [], []
    for path, r in files:
        ts = r.get("turns") or []
        for i, t in enumerate(ts):
            k = chosen.get((path, i))
            if k is None or t["src"] not in MINE or t["kind"] != "prompt" or not t["ts"]:
                continue
            prev = ts[i - 1] if i else None
            words = own_words(t["text"] or "")
            if not words.strip():  # only what the app wraps around a message (a bridge report, a call header)
                skipped.append(k)
                continue
            text = cap(words, 2000, 400)
            before = cap((prev or {}).get("reply") or "", 300, 100)  # head and tail: Claude's question is usually last
            out.append({"id": k, "ts": t["ts"], "project": project_of(t.get("cwd") or r.get("cwd")), "text": text,
                        "before": before, "prev": (prev or {}).get("reply") or "", "stopped": bool((prev or {}).get("interrupted")), "agh": not_typed(words),
                        "h": hashlib.sha1(text.encode()).hexdigest()[:12]})
    out.sort(key=lambda p: p["ts"] or "")
    return out, sorted(set(skipped))


def load_history(transcript_prompts):
    """Prompts typed in the terminal from March to June (history.jsonl, kept by the engine in history.json), the ones
    no transcript holds, with the engine's rules (model._history_rows): nothing typed in a scratch folder or by a
    bridge, no notices, no shell or slash commands. No reply was recorded, so there is no message before."""
    from wimym.history import History, text_of
    from wimym.text import AUTO_START
    seen = defaultdict(list)
    for p in transcript_prompts:
        seen[p["text"][:200].strip()].append(datetime.fromisoformat(p["ts"][:19]))
    by_sid = defaultdict(list)
    for path, r in Index().records():
        for t in r.get("turns") or []:
            if t.get("ts"):
                by_sid[r.get("sid")].append(datetime.fromisoformat(t["ts"][:19]))
    out = []
    for e in History().list():
        words, kind = text_of(e)
        cwd = e.get("cwd") or ""
        if kind != "prompt" or not words.strip() or words.startswith(AUTO_START):
            continue
        if cwd.startswith(SCRATCH) or "/.matrice-bridge/" in cwd + "/" or "/.massistant-probe" in cwd or "/Library/Logs/" in cwd:
            continue
        at = datetime.fromisoformat(e["ts"][:19])
        if any(abs((at - x).total_seconds()) <= 10 for x in by_sid.get(e["sid"]) or ()):
            continue
        text = cap(words, 2000, 400)
        if any(abs((at - x).total_seconds()) <= 300 for x in seen.get(text[:200].strip()) or ()):
            continue
        out.append({"id": e["id"], "ts": e["ts"], "project": project_of(cwd), "text": text, "before": "", "prev": "",
                    "stopped": False, "history": True, "agh": not_typed(words), "h": hashlib.sha1(text.encode()).hexdigest()[:12]})
    out.sort(key=lambda p: p["ts"])
    return out


def file_of(name, history):
    f = DEFS[name]["file"]
    return f.replace(".json", "-history.json") if history else f


# ---------------------------------------------------------------------------
# Labels on disk

class Store:
    """A label file: read whole, written whole through a temporary name and os.replace. A file that exists but
    won't parse is set aside as <file>.bad-<time> and nothing is written, so hours of labels are never replaced
    by an empty file. Labels of an older version stay in the file; only the current version counts (done())."""

    def __init__(self, path, name):
        self.path, self.name, self.lock = path, name, threading.Lock()
        self.v = DEFS[name]["version"]
        self.d = {}
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    self.d = json.load(f)
            except (OSError, ValueError) as e:
                bad = f"{path}.bad-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
                os.replace(path, bad)
                sys.exit(f"{path} can't be read ({e}); set aside as {bad}, nothing written")
        self.d.setdefault("labels", {})
        self.d.setdefault("calls", [])
        self.d.setdefault("runs", [])
        self.old_version = self.d.get("version")
        if self.old_version not in (None, self.v):
            self.d.pop("checked", None)  # a mark in the file was given on the old version
        self.d["version"] = self.v
        for f in DEFS[name]["fields"]:  # the values, as categorize.py wrote them ("intents", "tones", "who", …)
            if f["type"] == "enum":
                self.d[{"in": "intents", "to": "tones", "sc": "scopes"}.get(f["key"], f["key"])] = [v["key"] for v in f["values"]]

    def done(self, p):
        lab = self.d["labels"].get(p["id"])
        return bool(lab) and lab.get("h") == p["h"] and lab.get("v") == self.v

    def put(self, labels, call):
        with self.lock:
            self.d["labels"].update(labels)
            self.d["calls"].append(call)
            self.save()

    def save(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = tmp_name(self.path)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.d, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, self.path)


# ---------------------------------------------------------------------------
# One call: a batch of messages → labels

EMPTY = tempfile.mkdtemp(prefix="wimym-labeller-")


def ask(prompt, system, model, timeout, think):
    cmd = [CLAUDE_BIN, "-p", "--output-format", "json", "--tools", "",
           "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
           "--safe-mode", "--disable-slash-commands", "--permission-prompts", "none",
           "--no-session-persistence", "--model", model, "--system-prompt", system]
    env = os.environ if think else {**os.environ, "MAX_THINKING_TOKENS": "0"}
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout, cwd=EMPTY, env=env)
    if r.returncode != 0 and not r.stdout.strip():
        raise RuntimeError((r.stderr or f"claude exited with {r.returncode}").strip()[:300])
    o = json.loads(r.stdout)
    if o.get("is_error"):
        raise RuntimeError(str(o.get("result") or o.get("api_error_status"))[:300])
    return o


def before_of(name, p):
    """Claude's message before, head and tail: 300 characters, or the set's own "before"."""
    n = DEFS[name].get("before")
    return cap(p["prev"], n, n // 2) if n and "prev" in p else p["before"]


def batch_text(items, name="categories"):
    parts, where = [], bool(DEFS[name].get("before"))
    for n, p in enumerate(items, 1):
        before = before_of(name, p) or ("(not recorded)" if p.get("history") else "(nothing)" if p["stopped"] else "(start of session)")
        stop = "\n(The person stopped Claude's previous turn before it finished.)" if p["stopped"] else ""
        proj = f"Project: {p['project']}\n" if where else ""
        parts.append(f"### Message {n}\n{proj}Claude before: {before}{stop}\nPerson: {p['text']}")
    return "\n\n".join(parts) + f"\n\nLabel all {len(items)} messages. JSON array only."


def parse(name, result, items):
    """The answer → {prompt id: label} for each item that came back valid."""
    s = (result or "").strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s)
    i, j = s.find("["), s.rfind("]")
    try:
        arr = json.loads(s[i:j + 1]) if i >= 0 else []
    except ValueError:
        arr = []
    got = {}
    arr = arr if isinstance(arr, list) else []
    # Haiku sometimes drops "i": one object per message, in order, is still unambiguous
    by_pos = len(arr) == len(items) and not any(isinstance(a, dict) and "i" in a for a in arr)
    for pos, a in enumerate(arr, 1):
        if not isinstance(a, dict):
            continue
        n = pos if by_pos else a.get("i")
        if isinstance(n, int) and 1 <= n <= len(items):
            lab = check(name, a, items[n - 1])
            if lab:
                got[items[n - 1]["id"]] = lab
    return got


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def label(store, todo, model, per_call, workers, timeout, think, max_chars=60000):
    """Labels todo, at most `workers` calls at once; items that don't come back are retried
    in later batches, then alone, up to three tries each."""
    system = system_prompt(store.name)
    tries = Counter()
    queue = list(todo)
    t0, ncalls, first_call = time.time(), 0, len(store.d["calls"])
    pr = threading.Lock()

    def batches(q):
        out, cur, size = [], [], 0
        for p in q:
            n = len(p["text"]) + len(before_of(store.name, p)) + 60
            if cur and (len(cur) >= per_call or size + n > max_chars):
                out.append(cur)
                cur, size = [], 0
            cur.append(p)
            size += n
        if cur:
            out.append(cur)
        return out

    def run(items):
        nonlocal ncalls
        start = time.time()
        try:
            o = ask(batch_text(items, store.name), system, model, timeout, think)
            got = parse(store.name, o.get("result"), items)
            u = o.get("usage") or {}
            call = {"at": now(), "n": len(items), "ok": len(got), "secs": round(time.time() - start, 1),
                    "api_ms": o.get("duration_api_ms"),
                    "in": (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0),
                    "out": u.get("output_tokens") or 0, "usd": o.get("total_cost_usd") or 0,
                    "model": next(iter(o.get("modelUsage") or {}), model), "v": store.v, "think": think}
            if len(got) < len(items):
                call["raw"] = (o.get("result") or "")[:400] + " … " + (o.get("result") or "")[-200:]
        except Exception as e:  # noqa: BLE001  a failed call: its items go back in the queue
            got, call = {}, {"at": now(), "n": len(items), "ok": 0, "secs": round(time.time() - start, 1),
                             "error": str(e)[:300], "v": store.v, "think": think}
            if re.search(r"rate|limit|429|overload|529", str(e), re.I):  # back off before the retry
                time.sleep(60)
        store.put(got, call)
        with pr:
            ncalls += 1
            done = sum(store.done(p) for p in todo)
            print(f"  call {ncalls}: {call['ok']}/{call['n']} in {call['secs']}s, {done}/{len(todo)} done"
                  + (f" ({call['error']})" if call.get("error") else ""), flush=True)
        return [p for p in items if p["id"] not in got]

    gave_up = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        while queue:
            for p in queue:
                tries[p["id"]] += 1
            rounds = batches(queue) if all(tries[p["id"]] < 3 for p in queue) else [[p] for p in queue]
            left = [p for r in ex.map(run, rounds) for p in r]
            queue = [p for p in left if tries[p["id"]] < 3]
            if left and not queue:
                gave_up = left
                print(f"gave up on {len(left)} message(s) after 3 tries", flush=True)
    calls = store.d["calls"][first_call:]
    return {"calls": ncalls, "secs": round(time.time() - t0, 1), "gave_up": len(gave_up),
            "in": sum(c.get("in", 0) for c in calls), "out": sum(c.get("out", 0) for c in calls),
            "usd": round(sum(c.get("usd", 0) for c in calls), 4)}


# ---------------------------------------------------------------------------

def sample(prompts, n, seed=7):
    """n messages spread across projects and months: one from each (project, month) in turn."""
    rnd = random.Random(seed)
    groups = defaultdict(list)
    for p in prompts:
        groups[(p["project"], p["ts"][:7])].append(p)
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


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def audit_marks(name):
    """Opus's marks for this set → {(field, id): (the label it judged, the value it says is right)};
    unclear ones left out."""
    out = {}
    for k, m in (load_json(os.path.join(LABELS_DIR, AUDIT)).get("marks") or {}).items():
        s, field, mid = k.split(":", 2)
        if s == name and m.get("ok") is not None and not m.get("unclear"):
            out[(field, mid)] = (m["was"], m["was"] if m["ok"] else m.get("fix"))
    return out


def pct(a, n):
    return f"{100 * a / n:.0f}%" if n else "–"


def compare(store, prompts, old_path, ids):
    """The new labels against the Opus marks and against the labels in old_path, on ids."""
    name, new = store.name, store.d["labels"]
    old = load_json(old_path).get("labels") or {}
    text = {p["id"]: p["text"] for p in prompts}
    marks = audit_marks(name)
    print(f"\n== {name} v{store.v} against the Opus marks (made on v2 labels; unclear marks left out)")
    print(f"{'field':<6} {'marks':>5} {'v2 right':>9} {'new right':>10}   Opus says rare class: v2 / new;  v2 gave a rare class wrongly: now right")
    for f in DEFS[name]["fields"]:
        k = f["key"]
        ms = [(mid, was, t) for (fk, mid), (was, t) in marks.items() if fk == k and mid in new and new[mid].get("v") == store.v]
        if not ms:
            continue
        oldr = sum(was == t for _, was, t in ms)
        newr = sum(new[mid].get(k) == t for mid, _, t in ms)
        default = Counter(t for _, _, t in ms).most_common(1)[0][0]
        rare = [(mid, was, t) for mid, was, t in ms if t != default]
        fp = [(mid, was, t) for mid, was, t in ms if was not in (default, t)]  # the inflated rates the audit found
        print(f"{k:<6} {len(ms):>5} {oldr:>3} {pct(oldr, len(ms)):>5} {newr:>4} {pct(newr, len(ms)):>5}   "
              f"{sum(was == t for _, was, t in rare)}/{len(rare)} / {sum(new[mid].get(k) == t for mid, _, t in rare)}/{len(rare)};  "
              f"{sum(new[mid].get(k) == t for mid, _, t in fp)}/{len(fp)}")
        for mid, o, t in ms:
            n = new[mid].get(k)
            if o != n or n != t:
                tag = "fixed" if n == t and o != t else "broke" if o == t else "still wrong" if o == n else "other wrong"
                print(f"    {tag:<11} {mid[:8]} old {o!s:<10} new {n!s:<10} opus {t!s:<10} {text.get(mid, '')[:90]!r}")
    rows = [i for i in ids if i in new and new[i].get("v") == store.v and (old.get(i) or {}).get("v") not in (None, store.v)]
    if not rows:
        return
    print(f"\n== {name}: old v{Counter(old[i].get('v') for i in rows).most_common(1)[0][0] if rows else '?'} vs new v{store.v} on {len(rows)} messages")
    for f in DEFS[name]["fields"]:
        k = f["key"]
        co, cn = Counter(old[i].get(k) for i in rows), Counter(new[i].get(k) for i in rows)
        agree = sum(old[i].get(k) == new[i].get(k) for i in rows)
        vals = [v["key"] for v in f["values"]]
        print(f"  {k:<4} agree {pct(agree, len(rows)):>4}   " + "  ".join(f"{v}: {co[v]}→{cn[v]}" for v in vals))


def report(store, prompts, ids=None, examples=15):
    labs = store.d["labels"]
    rows = [(p, labs[p["id"]]) for p in prompts if store.done(p) and (ids is None or p["id"] in ids)]
    n = len(rows)
    print(f"\n{n} messages with {store.name} v{store.v} (of {len(prompts)})")
    for f in DEFS[store.name]["fields"]:
        if f["type"] in ("text", "list", "refs"):  # free text: how often it's filled, not each value
            c = Counter("filled" if l.get(f["key"]) else "empty" for _, l in rows)
        else:
            c = Counter(l.get(f["key"]) for _, l in rows)
        print(f"\n{f['name']} ({f['key']}):")
        for k, v in c.most_common():
            print(f"  {str(k):<11} {v:>5}  {100 * v / max(1, n):5.1f}%")
    calls = store.d["calls"]
    if calls:
        print(f"\ncalls so far: {len(calls)}, {sum(c.get('in', 0) for c in calls):,} tokens in, "
              f"{sum(c.get('out', 0) for c in calls):,} out, list-price equivalent ${sum(c.get('usd', 0) for c in calls):.2f}")
    for r in store.d.get("runs") or []:
        print(f"  run {r['start']} {r['mode']}: {r['labelled']} labelled, {r['calls']} calls, {r['secs'] / 60:.0f} min, "
              f"{r['in']:,} in / {r['out']:,} out, ${r['usd']:.2f}")
    rnd = random.Random(3)
    print(f"\n{examples} examples:")
    for p, l in rnd.sample(rows, min(examples, n)):
        tags = "/".join(str(l[f["key"]]) for f in DEFS[store.name]["fields"] if l[f["key"]] not in ("", []))
        print(f"  [{tags}] {p['project']}: {p['text'][:140]!r}")


def promote(src, prompts):
    """Move src/<set>.json into the labels folder once a full run has labelled every message at the set's version;
    the file it replaces is kept as <set>.v<old version>.json when its version differs."""
    for name, d in MESSAGE_SETS.items():
        path = os.path.join(src, d["file"])
        if not os.path.exists(path):
            continue
        st = Store(path, name)
        mine = prompts if name == "categories" else signal_prompts(prompts, src)
        # messages sent after the last run started are labelled by the next run, as always
        since = max((r["start"] for r in st.d["runs"] if r["mode"] == "all" and r["v"] == st.v), default=None)
        left = [p for p in mine if not st.done(p) and (since is None or p["ts"] < since)]
        if since is None or left:
            sys.exit(f"{name}: {len(left)} of {len(mine)} messages have no v{st.v} label yet; nothing moved")
    for name, d in MESSAGE_SETS.items():
        path, dest = os.path.join(src, d["file"]), os.path.join(LABELS_DIR, d["file"])
        if not os.path.exists(path):
            continue
        ov = load_json(dest).get("version")
        if ov is not None and ov != d["version"]:
            keep = os.path.join(LABELS_DIR, f"{os.path.splitext(d['file'])[0]}.v{ov}.json")
            shutil.copy2(dest, keep)
            print(f"kept the old {name} as {keep}")
        tmp = tmp_name(dest)
        shutil.copy2(path, tmp)
        os.replace(tmp, dest)
        print(f"{name} v{d['version']} → {dest}")


def signal_prompts(prompts, folder, history=False):
    """The second set builds on the first: nothing the first found you didn't type."""
    cats = load_json(os.path.join(folder, file_of("categories", history))).get("labels") or {}
    return [p for p in prompts if not (p["agh"] or (cats.get(p["id"]) or {}).get("ag"))]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true", help="label every message not labelled at this version")
    g.add_argument("--sample", type=int, metavar="N", help="label N messages spread across projects and months (the stored sample when it has N)")
    g.add_argument("--check", action="store_true", help="label the stored sample and every message Opus marked, then compare")
    g.add_argument("--dry-run", action="store_true", help="count what's left; send nothing")
    g.add_argument("--ids", metavar="FILE", help="label the messages whose ids are in FILE (a JSON list), e.g. a sample for a second judge")
    g.add_argument("--report", action="store_true", help="what the labels say so far")
    g.add_argument("--promote", action="store_true", help="move complete label files from --dir into the labels folder")
    g.add_argument("--prompt", action="store_true", help="print the instruction Haiku gets")
    ap.add_argument("--history", action="store_true",
                    help="the March to June prompts from history.jsonl instead, into <set>-history.json")
    ap.add_argument("--set", choices=list(MESSAGE_SETS), default="categories")
    ap.add_argument("--dir", default=LABELS_DIR, help=f"labels folder to read and write (default {LABELS_DIR})")
    ap.add_argument("--model", help="default: the set's model, else haiku")
    ap.add_argument("--per-call", type=int, help="messages per call (default: the set's per_call, else 50)")
    ap.add_argument("--jobs", "--workers", dest="jobs", type=int, default=3, help=f"calls at once (at most {MAX_JOBS})")
    ap.add_argument("--timeout", type=int, default=600)
    ap.add_argument("--no-think", action="store_true", help="no extended thinking: about 5x fewer tokens out")
    args = ap.parse_args()
    name = args.set
    if args.prompt:
        return print(system_prompt(name))
    folder = os.path.expanduser(args.dir)
    prompts, skipped = load_prompts()
    if args.history:
        prompts, skipped = load_history(prompts), []
    if args.promote:
        return promote(folder, prompts)
    store = Store(os.path.join(folder, file_of(name, args.history)), name)
    store.d["skipped"] = skipped  # so the app doesn't count them as waiting for a label
    if name == "categories":
        for p in prompts:  # the start of your own words, for examples (no call needed)
            lab = store.d["labels"].get(p["id"])
            if lab and lab.get("h") == p["h"]:
                lab["w"] = p["text"][:160]
    else:
        prompts = signal_prompts(prompts, folder, args.history)
    if not (args.report or args.dry_run):
        store.save()
    todo = [p for p in prompts if not store.done(p)]
    if args.report:
        return report(store, prompts)
    if args.dry_run:
        chars = sum(len(p["text"]) + len(p["before"]) for p in todo)
        print(f"{name} v{store.v}: {len(prompts)} messages, {len(prompts) - len(todo)} labelled, {len(todo)} to go "
              f"(~{chars // 4:,} tokens of text)")
        return
    ids = None
    if args.sample or args.check:
        # the same sample again after the taxonomy changes, so labels can be compared
        have = set(store.d.get("sample") or [])
        n = args.sample or len(have)
        pick = [p for p in prompts if p["id"] in have] if have and len(have) == n else sample(prompts, n)
        store.d["sample"] = sorted(p["id"] for p in pick)
        ids = set(store.d["sample"])
        if args.check:
            ids |= {mid for _, mid in audit_marks(name)}
        todo = [p for p in prompts if p["id"] in ids and not store.done(p)]
    if args.ids:
        ids = set(load_json(args.ids))
        todo = [p for p in prompts if p["id"] in ids and not store.done(p)]
    mode = f"ids {os.path.basename(args.ids)}" if args.ids else "all" if args.all else "check" if args.check else f"sample {args.sample}"
    workers = max(1, min(MAX_JOBS, args.jobs))
    args.model = args.model or DEFS[name].get("model") or "haiku"
    args.per_call = args.per_call or DEFS[name].get("per_call") or 50
    print(f"{name} v{store.v}: labelling {len(todo)} messages, {args.per_call} per call, {workers} at once, "
          f"thinking {'off' if args.no_think else 'on'}", flush=True)
    start = now()
    r = label(store, todo, args.model, args.per_call, workers, args.timeout, not args.no_think)
    store.d["runs"].append({"start": start, "end": now(), "mode": mode, "v": store.v, "model": args.model,
                            "think": not args.no_think, "todo": len(todo), "labelled": len(todo) - r["gave_up"], **r})
    store.save()
    print(f"done in {r['secs'] / 60:.1f} min, {r['calls']} calls, {r['in']:,} tokens in, {r['out']:,} out, ${r['usd']:.2f}", flush=True)
    if args.check:
        compare(store, prompts, os.path.join(LABELS_DIR, DEFS[name]["file"]), ids)
    else:
        report(store, prompts, ids=ids)


if __name__ == "__main__":
    main()
