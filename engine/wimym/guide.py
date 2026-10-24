"""What the labels mean, how they were made and how far to trust them: the "What the labels mean" page.

Haiku's exact rules come from labels.definitions() when it exists. The plain words, the pages each
label feeds and the known biases (the research note opus-audit.md, kept outside the repository) are kept here. The accuracy comes
from Opus's second-judge marks in ~/.wimym/labels/audit-opus.json.
"""
import json
import os
from collections import Counter, defaultdict

from . import labels as labelsets
from .paths import LABELS_DIR

YN = [("yes", "Yes"), ("no", "No")]

# set → (name, what it is); field → plain words. Values: (key, name, meaning).
SETS = {
    "categories": ("What you ask for and how it sounds",
                   "The first set: what each message mainly asks for, its tone, and whether it says what done looks like."),
    "signals": ("How you steer",
                "The second set: whether the idea is yours, who makes the call, how big the ask is, and pressure, annoyance and play."),
}

FIELDS = [
    {"set": "categories", "key": "in", "msg": "intent", "name": "What it asks for",
     "plain": "The one thing the message mainly asks Claude for. Twelve kinds, grouped in seven families, each family with its own color across Wimym.",
     "values": [
         ("question", "Question", "Asks to explain, find out, look up or compare, without asking for a change."),
         ("correct", "Correction", "Claude's last turn was wrong, went the wrong way, or what it just made doesn't work."),
         ("build", "Build", "Make something new or extend it: a feature, a page, a script, a document."),
         ("fix", "Fix", "A bug or problem you found that isn't about Claude's last turn."),
         ("design", "Design feedback", "How something looks, reads or feels: layout, wording, colors."),
         ("go-ahead", "Go-ahead", "Only approves or picks from what Claude proposed: yes, ok, continue, option 2."),
         ("answer", "Answer", "Gives Claude a fact it asked for or needs: a date, a number, what you saw or did."),
         ("ops", "Ops", "Run or operate things: start a server, install, move files, accounts, email."),
         ("setup", "Claude setup", "About Claude itself: CLAUDE.md, memory, skills, settings, sessions."),
         ("ship", "Ship", "Commit, push, merge, open a PR, publish, deploy."),
         ("plan", "Plan", "Plan, brainstorm or think an approach through before building."),
         ("review", "Review", "Check, test, verify or audit work that exists."),
     ],
     "used": ["Portrait", "Days", "Messages", "How you lead", "Projects"]},
    {"set": "categories", "key": "to", "msg": "tone", "name": "Tone",
     "plain": "How the message sounds. Neutral unless the words show otherwise.",
     "values": [
         ("neutral", "Neutral", "Plain instructions, questions, agreement. Most messages."),
         ("pleased", "Pleased", "Explicit praise, thanks or satisfaction: great, perfect, thanks, works now."),
         ("frustrated", "Frustrated", "Annoyance or impatience: still broken, again, horrible."),
     ],
     "used": ["Portrait", "Days", "Messages", "Your voice"]},
    {"set": "categories", "key": "sp", "msg": "specific", "name": "Says what done looks like",
     "plain": "Could someone tell the request is done without guessing what you want? Yes when it names the result, the exact change or the check. The Portrait counts it on requests for work only, since questions, go-aheads and answers almost never say it.",
     "values": [("yes", "Yes", "Names the concrete result: \"rename greybox to graybox\", \"commit and push\"."),
                ("no", "No", "Leaves the what or the how to Claude (\"make it great\", \"can you check?\"), and bare yeses.")],
     "used": ["Portrait", "Messages"]},
    {"set": "signals", "key": "own", "msg": "own", "name": "Your own idea",
     "plain": "Does the message bring an idea, opinion or alternative of yours, beyond what you ask for or what Claude proposed?",
     "values": [("yes", "Yes", "\"Why not create a small markup…\", \"the heading is too long, it should say…\"."),
                ("no", "No", "Bare instructions, plain questions, approvals, facts Claude asked for.")],
     "used": ["Portrait", "Messages", "How you lead"]},
    {"set": "signals", "key": "who", "msg": "who", "name": "Who makes the call",
     "plain": "Who decides what the message is about.",
     "values": [
         ("alex", "You", "You decide or instruct, even when you leave the how to Claude; a pick, a firm no."),
         ("claude", "Claude", "You hand the decision itself to Claude: \"what do you think is best?\", \"you decide\"."),
         ("open", "Still open", "You think aloud or weigh options without settling: \"maybe we could…?\"."),
         ("none", "Nothing to decide", "A plain question, thanks, a fact, a status."),
     ],
     "used": ["Portrait", "Messages", "How you lead", "Day score"]},
    {"set": "signals", "key": "sc", "msg": "scope", "name": "Scope",
     "plain": "How big the ask is.",
     "values": [
         ("tweak", "A tweak", "A small change to something that exists: a rename, a color, one fix."),
         ("task", "A task", "A contained piece of work: a feature, a page, a review, a deploy."),
         ("project", "A project", "A multi-part effort or a new system, over several sessions."),
         ("strategy", "Strategy", "What the business or product should do: markets, pricing, priorities, people."),
         ("none", "No work asked", "An approval, an answer, thanks, a question about how something works."),
     ],
     "used": ["Messages", "How you lead", "Day score"]},
    {"set": "signals", "key": "pr", "msg": "pressure", "name": "Under pressure",
     "plain": "Do the words show time or stakes pressure: a deadline, a meeting, a client waiting, production down?",
     "values": [("yes", "Yes", "\"asap\", \"before tonight\", \"they're waiting\", live users hit."),
                ("no", "No", "Everything else, including a plain bug report or a \"wait\".")],
     "used": ["Messages", "Your voice"]},
    {"set": "signals", "key": "irk", "msg": "irk", "name": "Annoyed at",
     "plain": "Is there annoyance in the words, and where does it point? A problem described plainly isn't annoyance.",
     "values": [
         ("none", "Nobody", "No annoyance in the words."),
         ("claude", "Claude", "At Claude's work or behaviour: a wrong result, ignoring an instruction, \"again\"."),
         ("other", "Something else", "At something Claude didn't make: a tool, a vendor, a website, the situation."),
     ],
     "used": ["Portrait", "Messages", "Your voice", "Day score"]},
    {"set": "signals", "key": "pl", "msg": "play", "name": "Playful",
     "plain": "Does the message joke, tease, banter or use irony?",
     "values": [("yes", "Yes", "A joke, a tease, irony, fun chatter."),
                ("no", "No", "Plain politeness, thanks, a friendly smiley on an ordinary message.")],
     "used": ["Messages", "Your voice"]},
]

# What Opus found on the v2 labels (the research note opus-audit.md, kept outside the repository), in plain words, and where each stands
# after the v3 wording (the research note relabel.md): "better" measured better, "rule" the wording changed
# but no change measured yet, "still" still there.
BIASES = {
    "in": [("Fix and correction blur: when Claude said something works and it doesn't, Haiku still says fix, since it sees only the end of Claude's message.", "still"),
           ("Visual feedback on what Claude made was sometimes called a correction instead of design.", "better")],
    "to": [("Agreement, a go-ahead or a smiley was read as pleased: only 2 of 6 \"pleased\" checked were right. Two of those still read as pleased.", "better"),
           ("A problem reported plainly was read as frustrated: 4 of 7 \"frustrated\" checked were right. The new wording halves the frustrated share.", "better")],
    "sp": [("Open questions (\"what's next?\", \"what happened?\") were marked as saying what done looks like. Now 20 of 21 checked agree.", "better")],
    "own": [("Rarely wrong on random messages, but it flips from run to run: on the checked messages the current labels agree less than the old ones did (19 of 24, from 22).", "still")],
    "who": [("Plain instructions that leave the how to Claude were read as handing Claude the call: 3 of 6 right.", "rule")],
    "sc": [("Choosing a tool or an architecture was called strategy: 0 of 5 right.", "rule"),
           ("Bare approvals got the scope of what they approved, against the rule.", "rule")],
    "pr": [("A \"wait\" or a failed deploy was read as pressure: 1 of 3 right. Pressure is rare, so the share is tiny either way.", "better")],
    "irk": [("Haiku named who caused a problem, not who annoyed you: \"at Claude\" 2 of 5 right, \"at something else\" 0 of 4.", "better")],
    "pl": [("A friendly smiley reads as play: 1 of 4 right, and the current wording didn't change that.", "still")],
}

# Same messages, same wording, labelled twice (the research notes relabel.md and signals.md): how often the two runs agree.
RERUN = {"in": 79, "to": 93, "sp": 75, "own": 80, "who": 80, "sc": 80, "pr": 80, "irk": 80, "pl": 80}
RERUN_NOTE = {"categories": "two runs of the same wording on 252 messages", "signals": "about 4 labels in 20 flip between runs"}


def _read(name):
    try:
        with open(os.path.join(LABELS_DIR, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * (p * (1 - p) / n + z * z / (4 * n * n)) ** .5 / d
    return [round(100 * max(0, c - h)), round(100 * min(1, c + h))]


def _vkey(v):
    return "yes" if v is True else "no" if v is False else v


def _rules():
    """Haiku's exact words for each field and value (labeller/definitions.json, through labels.definitions())."""
    try:
        return labelsets.definitions() or {}
    except Exception:  # a half-written definitions file shouldn't take the page down
        return {}


def _set_of(rules, s):
    return ((rules.get("sets") or rules).get(s)) or {}


def _text(x):
    if isinstance(x, str):
        return x
    if isinstance(x, dict):
        return x.get("text") or x.get("rule") or ""
    if isinstance(x, list):
        return "\n".join(f"• {_text(i)}" for i in x if _text(i))
    return ""


def _rule_of(rules, s, f):
    """The field's rule in definitions.json's words: its lead, its rules and notes; and each value's meaning."""
    fields = _set_of(rules, s).get("fields") or []
    r = next((x for x in fields if isinstance(x, dict) and x.get("key") == f), None) if isinstance(fields, list) else fields.get(f)
    if not r:
        return {"rule": None, "values": {}}
    parts = [_text(r.get(k)) for k in (("after", "rules", "notes") if r.get("list") else ("lead", "after", "rules", "notes"))]
    vals = {_vkey(x.get("key")): x.get("meaning") for x in r.get("values") or [] if isinstance(x, dict)}
    return {"rule": "\n".join(p for p in parts if p.strip()) or None, "values": vals}


def _made(meta, version):
    calls = meta.get("calls") or []
    mine = [c for c in calls if c.get("v") == version] or calls
    if not mine:
        return None
    ats = sorted(c["at"] for c in mine if c.get("at"))
    return {"model": Counter(c.get("model") for c in mine).most_common(1)[0][0], "calls": len(mine),
            "messages": sum(c.get("ok", 0) for c in mine), "usd": round(sum(c.get("usd") or 0 for c in mine), 2),
            "from": ats[0] if ats else None, "to": ats[-1] if ats else None,
            "hours": round(sum(c.get("secs") or 0 for c in mine) / 3600, 1),
            "allUsd": round(sum(c.get("usd") or 0 for c in calls), 2), "thisVersionOnly": any(c.get("v") == version for c in calls)}


def _audit(model_labels, versions):
    """Opus's marks, per field: random-message accuracy, accuracy of each value, and what v-now says on the same messages."""
    a = _read("audit-opus.json")
    marks = a.get("marks") or {}
    per_card = Counter()
    for k, m in marks.items():
        per_card[(k.split(":", 1)[0], m.get("card"))] += 1
    out = defaultdict(lambda: {"random": [0, 0], "values": defaultdict(lambda: [0, 0]), "unclear": 0, "wrong": [], "now": [0, 0], "v": None})
    for k, m in marks.items():
        s, f, mid = k.split(":", 2)
        o = out[f]
        o["v"] = m.get("v")
        if m.get("ok") is None:
            o["unclear"] += 1
            continue
        was = _vkey(m.get("was"))
        if per_card[(s, m.get("card"))] in (3, 6):      # a random card asks every label of its set
            o["random"][0] += m["ok"]
            o["random"][1] += 1
        o["values"][was][0] += m["ok"]
        o["values"][was][1] += 1
        truth = was if m["ok"] else _vkey(m.get("fix"))
        cur = (model_labels.get(s) or {}).get(mid)
        if truth is not None and cur and f in cur and cur.get("v") != m.get("v"):
            o["now"][0] += _vkey(cur[f]) == truth
            o["now"][1] += 1
        if not m["ok"]:
            o["wrong"].append({"id": mid, "was": was, "fix": _vkey(m.get("fix")), "why": m.get("why")})
    res = {}
    for f, o in out.items():
        k, n = o["random"]
        res[f] = {"v": o["v"], "unclear": o["unclear"],
                  "random": {"k": k, "n": n, "ci": wilson(k, n)},
                  "values": {v: {"k": kv, "n": nv, "ci": wilson(kv, nv)} for v, (kv, nv) in o["values"].items()},
                  "now": {"k": o["now"][0], "n": o["now"][1], "ci": wilson(*o["now"])} if o["now"][1] else None,
                  "wrong": o["wrong"]}
    return {"by": a.get("by"), "model": a.get("model"), "at": a.get("at"), "marks": len(marks),
            "cards": len({m.get("card") for m in marks.values()}), "fields": res}


def page(model):
    """Everything the labels page shows, from the model's messages and the label files."""
    P = [m for m in model.messages if m["kind"] == "prompt"]
    raw = model.labels
    versions = raw.get("versions") or {}
    rules = _rules()
    audit = _audit({"categories": raw.get("categories") or {}, "signals": raw.get("signals") or {}}, versions)
    sets = []
    for s, (name, about) in SETS.items():
        meta = _read(f"{s}.json")
        ver = versions.get(s)
        cov = sum(1 for m in P if m["intent" if s == "categories" else "who"] is not None)
        sets.append({"key": s, "name": name, "about": about, "version": ver, "labelled": cov, "of": len(P),
                     "made": _made(meta, ver), "runs": meta.get("runs"),
                     "changes": [{"v": int(k), "text": t} for k, t in sorted((_set_of(rules, s).get("changes") or {}).items(), key=lambda kv: int(kv[0]))],
                     "notes": _set_of(rules, s).get("notes") or []})
    fields = []
    for F in FIELDS:
        key, mk = F["key"], F["msg"]
        lab = [m for m in P if m[mk] is not None]
        counts = Counter(_vkey(m[mk]) for m in lab)
        r = _rule_of(rules, F["set"], key)
        vals = []
        for v, vname, meaning in F["values"]:
            ex = [m for m in lab if _vkey(m[mk]) == v and 3 <= m["words"] <= 40]
            step = max(1, len(ex) // 5)
            pick = ex[step // 2::step][:5]
            vals.append({"key": v, "name": vname, "meaning": meaning, "rule": r["values"].get(v), "n": counts.get(v, 0),
                         "share": round(100 * counts.get(v, 0) / len(lab), 1) if lab else None,
                         "examples": [{"id": m["id"], "text": m["text"][:200], "day": m["day"]} for m in pick]})
        au = audit["fields"].get(key)
        if au:
            for w in au["wrong"]:
                m = model.msg_by_id.get(w["id"])
                w["text"] = m["text"][:200] if m else None
            au["wrong"] = [w for w in au["wrong"] if w["text"]]
        biases = [{"text": t, "status": st} for t, st in BIASES.get(key, [])]
        fields.append({"set": F["set"], "key": key, "msg": mk, "name": F["name"], "plain": F["plain"], "rule": r["rule"],
                       "labelled": len(lab), "of": len(P), "values": vals, "used": F["used"], "audit": au, "biases": biases,
                       "rerun": {"agree": RERUN.get(key), "note": RERUN_NOTE[F["set"]]} if RERUN.get(key) else None})
    skipped = sum(1 for l in (raw.get("categories") or {}).values() if l.get("ag"))
    return {"generated": model.generated, "sets": sets, "fields": fields, "notTyped": skipped,
            "audit": {k: audit[k] for k in ("by", "model", "at", "marks", "cards")}, "covered": 80}
