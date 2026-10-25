"""Haiku's labels for your messages (labeller/label.py writes them).

categories.json: intent ("in"), tone ("to"), says what done looks like ("sp"), not typed by you ("ag");
categories-history.json the same for prompts from history.jsonl.
signals.json: own idea ("own"), who makes the call ("who"), scope ("sc"), pressure ("pr"),
annoyed at ("irk"), playful ("pl"). Only labels of each file's current version count.
What each field and value means: labeller/definitions.json, served by definitions().
"""
import json
import os

from .paths import LABELS_DIR

DEFINITIONS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "labeller", "definitions.json")


def definitions():
    """Every label set as plain data, the words Haiku is given: {"sets": {"categories": {"version", "name",
    "fields": [{"key", "name", "type": "enum"|"bool", "lead", "values": [{"key", "name", "meaning"}],
    "rules", "notes"}], "notes", "changes": {version: what changed}}, "signals": {…}}}."""
    with open(DEFINITIONS, encoding="utf-8") as f:
        d = json.load(f)
    return {"about": d.get("about"), "sets": {name: {k: v for k, v in s.items() if k not in ("intro", "outro", "file")}
                                             for name, s in d["sets"].items()}}

INTENT_NAMES = {
    "question": "Question", "go-ahead": "Go-ahead", "answer": "Answer", "build": "Build", "fix": "Fix",
    "design": "Design feedback", "plan": "Plan", "review": "Review", "correct": "Correction", "ship": "Ship",
    "ops": "Ops", "setup": "Claude setup",
}
# Seven families, each one color everywhere. Order = palette slot order (validated for stacks).
FAMILIES = [
    ("ask", "Ask", ["question"]),
    ("steer", "Steer", ["correct"]),
    ("make", "Make", ["build", "fix", "design"]),
    ("approve", "Approve", ["go-ahead", "answer"]),
    ("run", "Run", ["ops", "setup"]),
    ("ship", "Ship", ["ship"]),
    ("think", "Think", ["plan", "review"]),
]
FAMILY_OF = {i: f for f, _, ins in FAMILIES for i in ins}


def _load(name):
    try:
        with open(os.path.join(LABELS_DIR, name + ".json"), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}, None
    v = d.get("version")
    return {k: l for k, l in (d.get("labels") or {}).items() if l.get("v") == v}, v


def load():
    """Every label set, each at its own file's current version. Prompts from history.jsonl are labelled into
    categories-history.json and acts-history.json (ids "h-…") and read as part of categories and acts. acts: decides, defers, people,
    self-state, hands over, life domain, per message. sessions: goal and outcome per session. days: an account
    per day, with the messages behind its high and low points. weeks: the same per ISO week ("2026-W42"), with
    up to three moments for the retro."""
    cats, cv = _load("categories")
    hist, hv = _load("categories-history")
    sigs, sv = _load("signals")
    acts, av = _load("acts")
    acts_h, ahv = _load("acts-history")
    sess, ssv = _load("sessions")
    days, dv = _load("days")
    weeks, wv = _load("weeks")
    return {"categories": {**hist, **cats}, "signals": sigs, "acts": {**acts_h, **acts}, "sessions": sess, "days": days, "weeks": weeks,
            "versions": {"categories": cv, "categoriesHistory": hv, "signals": sv, "acts": av, "actsHistory": ahv,
                         "sessions": ssv, "days": dv, "weeks": wv}}


def rules():
    """rules.json: rules you gave more than once, grouped across sessions, as candidates for the agents:
    {"version", "groups": [{"rule", "kind", "n", "sessions", "ids", "known", "first", "last", "projects"}]}."""
    try:
        with open(os.path.join(LABELS_DIR, "rules.json"), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {"version": None, "groups": []}
    return {"version": d.get("version"), "groups": d.get("groups") or []}


# Which label fields may feed a measure (STRATEGY.md §3: only once their accuracy is known). Intent was
# checked by the Opus audit. A set or field becomes checked when labeller/definitions.json says so on the
# set ("checked": true, or a list of field keys), or the label file itself carries "checked" the same way.
# Everything else is shown as a reading, never counted.
# The judged versions before the wording was made neutral for anyone (categories v4, acts v4, sessions v6, days v6)
# keep their marks here, so labels made before that change still count until a relabel replaces them.
# Jev's labels ("<n>-jev") had their own Opus judge on 25 Oct (labels/judge/jev-*, docs/labels.md).
CHECKED = {("categories", 2): {"in"}, ("categories", 3): {"in"},   # (set, version) → fields known to be good enough to count
           ("acts", 3): {"dfr", "dom", "off", "ppl"},
           ("categories", "4-jev"): {"in", "to"}, ("acts", "4-jev"): {"dfr", "dom", "off", "ppl"},
           ("sessions", 5): {"goal", "outcome", "decisions", "rework", "people", "account"},
           ("days", 5): {"decided", "dropped", "postponed"}}
_heads = {}


def _head(path):
    """A label file's version and "checked" mark, read once per change of the file."""
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return None, None
    if _heads.get(path, (None,))[0] != mt:
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            _heads[path] = (mt, d.get("version"), d.get("checked"))
        except (OSError, ValueError):
            _heads[path] = (mt, None, None)
    return _heads[path][1:]


def checked(name, field, version=None):
    """Whether a label field may feed a measure, for labels of that version (default: the file's current one).
    A mark counts only for the version it was given on, so promoting a new version switches nothing on by itself."""
    fv, fmark = _head(os.path.join(LABELS_DIR, name + ".json"))
    version = fv if version is None else version
    if field in CHECKED.get((name, version), ()):
        return True
    marks = []
    if fv == version:
        marks.append(fmark)
    try:
        with open(DEFINITIONS, encoding="utf-8") as f:
            s = (json.load(f).get("sets") or {}).get(name) or {}
        if s.get("version") == version:
            marks.append(s.get("checked"))
    except (OSError, ValueError):
        pass
    return any(m is True or (isinstance(m, list) and field in m) for m in marks)

