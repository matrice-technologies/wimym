"""Vital signs: the measures of STRATEGY.md §2, day by day and week by week, each against the person's
own range. docs/contract-vitals.md is the shape the app reads.

Structural signals, computed here from your messages (transcripts and history.jsonl alike):

  day        05:00 to 05:00 local time (model.day_of), so 01:30 belongs to the day before
  block      a run of your messages with no gap over 20 minutes; it lasts from its first message to
             its last plus 5 minutes. Active time is the sum of a day's blocks.
  stretch    the longest run inside a block on one project
  switch     two messages in a row in one block, in different sessions
  night      hours from a day's last message to the next day's first (null when either day is off)
  unread     a go-ahead sent sooner than Claude's reply before it could be read at 250 words a minute

A week's range ("band") is the 25th, 50th and 75th percentile of the 8 complete weeks before it,
given once 4 of them have a value. A measure is flagged when the latest complete week and the one
before both sit outside their bands on the same side.
"""
import re
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from .labels import checked
from .model import MINE, day_of, utc, week_of

GAP = 20 * 60          # seconds: a longer gap ends a work block
TAIL = 5 * 60          # seconds added to a block's last message
WPM = 250              # reading speed for unread approvals
BAND_WEEKS, BAND_MIN = 8, 4
WORK = {"build", "fix"}
STRAINED = {"tired", "stressed", "low", "unwell"}
LONG_RUN = 14     # days in a row with work: from here the streak always gets a sentence
GO = re.compile(r"^\s*(?:yes|yep|yeah|yup|y|ok|okay|k|go|go ahead|go on|continue|proceed|do it|sure|lgtm|ship it|sounds good|"
                r"perfect|great|good|nice|fine|approved?|oui|ouais|vas-?y|d'accord|parfait|c'est bon|let'?s go|keep going|next)"
                r"[\s.!,👍]*$", re.I)

GOALS = [
    ("stop", "Stop when you meant to", "health", ["late"]),
    ("rest", "Keep rest intact", "health", ["night", "daysoff", "streak"]),
    ("escalation", "Notice escalation", "health", ["load", "peak"]),
    ("people", "Keep people in the work", "health", ["people"]),
    ("finish", "Finish what you start", "health", ["loops"]),
    ("depth", "Protect depth", "health", ["stretch", "switches"]),
    ("judgement", "Keep your own judgement", "health", ["unread"]),
    ("direction", "Spend effort where you meant to", "health", ["priorities"]),
    ("strain", "See strain early", "health", ["strain"]),
    ("output", "Get things done", "performance", ["landed", "ftr", "survival", "leverage", "ttd"]),
]
GOAL_OF = {k: g for g, _, _, ks in GOALS for k in ks}

# key → (label, question, unit, better)
MEASURES = {
    "late": ("Late minutes", "How long do you work past the hour you meant to stop?", "min", "lower"),
    "night": ("Night", "How long are your nights?", "h", "higher"),
    "daysoff": ("Days off", "How many days a week do you leave the work alone?", "days", "higher"),
    "streak": ("Days in a row", "How many days in a row have you worked without a day off?", "days", "lower"),
    "load": ("Active hours", "How many hours a week are you at it?", "h", "lower"),
    "peak": ("Sessions at once", "How many of your sessions run at the same time, at the most?", "count", "lower"),
    "people": ("Days with people", "On how many days does someone else take part in the work?", "days", "higher"),
    "loops": ("Open loops", "How many projects did you work on lately with nothing landed in two weeks?", "count", "lower"),
    "stretch": ("Longest stretch", "How long is your longest run on one project in a day?", "h", "higher"),
    "switches": ("Switches", "How often do you change session in an hour of work?", "perh", "lower"),
    "unread": ("Unread approvals", "How many of your go-aheads come before you could have read the reply?", "%", "lower"),
    "priorities": ("On priorities", "How much of your time goes to the projects you named as priorities?", "%", "higher"),
    "strain": ("Strain", "How many of your messages, out of 100, are corrections or show strain?", "%", "lower"),
    "landed": ("Landed work", "How many commits reach the default branch each week?", "count", "higher"),
    "ftr": ("First time right", "How many build and fix requests need no correction after?", "%", "higher"),
    "survival": ("Survival", "How much of what landed is still in place a month later?", "%", "higher"),
    "leverage": ("Leverage", "How much lands for each hour you are at it?", "perh", "higher"),
    "ttd": ("Time to done", "How long from a request to the turn that lands it?", "min", "lower"),
}

# What a flagged week sounds like: key → (subject, (word when above, word when below), how to say the amount)
SAY = {
    "late": ("You worked past your stopping hour", ("more", "less"), "min"),
    "night": ("Your nights were", ("longer", "shorter"), "h"),
    "daysoff": ("You took", ("more days off", "fewer days off"), "days"),
    "streak": ("Your run of days without a day off was", ("longer", "shorter"), "days"),
    "load": ("You were at it", ("more", "less"), "h"),
    "peak": ("You ran", ("more sessions at once", "fewer sessions at once"), "count"),
    "people": ("You had", ("more days with other people in the work", "fewer days with other people in the work"), "days"),
    "loops": ("You left", ("more projects without anything landed", "fewer projects without anything landed"), "count"),
    "stretch": ("Your longest stretch on one project was", ("longer", "shorter"), "h"),
    "switches": ("You changed session", ("more often", "less often"), "perh"),
    "unread": ("Your go-aheads came before the reply could be read", ("more often", "less often"), "%"),
    "priorities": ("Your time on priorities was", ("higher", "lower"), "%"),
    "strain": ("Your messages showed strain", ("more often", "less often"), "%"),
    "landed": ("You landed", ("more commits", "fewer commits"), "count"),
    "ftr": ("Your build and fix requests came out right the first time", ("more often", "less often"), "%"),
    "survival": ("What landed stayed in place a month", ("more often", "less often"), "%"),
    "leverage": ("Each hour of work landed", ("more", "less"), "perh"),
    "ttd": ("Requests took", ("longer to land", "less time to land"), "min"),
}


# Which goal each kind of moment is about, and the day accounts' items as moments: (lead, question)
ABOUT = {"latest-night": "stop", "short-night": "rest", "longest-day": "escalation", "switching": "depth", "deep": "depth",
         "unread": "judgement", "stopped": "judgement", "corrections": "strain", "quiet": "finish", "branches": "finish",
         "abandoned": "finish", "high": "output", "low": "strain", "decided": "judgement", "dropped": "finish",
         "postponed": "finish"}
PICK = {"high": 2, "low": 2, "decided": 4, "dropped": 3, "postponed": 3}   # day-account items shown per week
DAY_REFS = {"high": ("A high point", "What made this go well, and can you make room for more of it?"),
            "low": ("A low point", "What would have helped at this moment?"),
            "decided": ("You decided", "Was this a call you meant to make yourself, and did you take the time it needed?"),
            "dropped": ("You dropped", "Is it dropped for good, or only for now?"),
            "postponed": ("You put off", "When will you come back to it, if at all?")}


def pctile(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    i = (len(xs) - 1) * q
    lo = int(i)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


def rnd(x, nd=1):
    return round(x, nd) if isinstance(x, (int, float)) else x


def median(xs):
    xs = [x for x in xs if x is not None]
    return pctile(xs, .5) if xs else None


def go_ahead(m):
    if m.get("_in", m.get("intent")):
        return m.get("_in", m.get("intent")) == "go-ahead"
    return m["kind"] == "prompt" and m["words"] <= 6 and bool(GO.match(m["text"] or ""))


def many(n, one, more=None):
    return f"{n} {one if n == 1 else (more or one + 's')}"


def short(t, n):
    return t if len(t) <= n else t[:n].rsplit(" ", 1)[0] + "…"


def amount(v, unit):
    v = abs(v)
    if unit == "h":
        return f"{v:.1f} hours" if v < 10 else f"{round(v)} hours"
    if unit == "min":
        return f"{round(v)} minutes"
    if unit == "days":
        return f"{v:g} day" if v == 1 else f"{v:.1f} days".replace(".0 ", " ")
    if unit == "%":
        return f"{round(v)} points"
    if unit == "perh":
        return f"{v:.1f} an hour"
    return f"{v:g}"


class Signals:
    """Blocks, stretches, switches, nights and project time for each day, from the person's messages."""

    def __init__(self, model, limits):
        self.model = model
        ms = [m for m in model.messages if m["src"] in MINE and m["ts"]]
        ms.sort(key=lambda m: m["ts"])
        for m in ms:
            m["_t"] = utc(m["ts"]).timestamp()
        self.msgs = ms
        by_day = defaultdict(list)
        for m in ms:
            by_day[m["day"]].append(m)
        self.by_day = by_day
        stop = limits.get("stopHour")
        self.stop = None if stop is None else (stop + 24 if stop < 5 else stop)
        self.day = {}
        for d, v in by_day.items():
            self.day[d] = self._day(v)

    def _day(self, v):
        blocks, cur = [], [v[0]]
        for a, b in zip(v, v[1:]):
            if b["_t"] - a["_t"] > GAP:
                blocks.append(cur)
                cur = [b]
            else:
                cur.append(b)
        blocks.append(cur)
        active = sum(b[-1]["_t"] - b[0]["_t"] + TAIL for b in blocks)
        # time by project: from each message to the next in its block, the last one gets the tail
        proj = Counter()
        stretch, stretch_at, switches, switched = 0.0, None, 0, []
        late, late_ids = 0.0, []
        for b in blocks:
            run_start = b[0]
            for i, m in enumerate(b):
                nxt = b[i + 1] if i + 1 < len(b) else None
                proj[m["project"]] += (nxt["_t"] - m["_t"]) if nxt else TAIL
                if nxt and nxt["sid"] != m["sid"]:
                    switches += 1
                    switched.append(nxt["id"])
                if not nxt or nxt["project"] != m["project"]:
                    dur = m["_t"] - run_start["_t"] + TAIL
                    if dur > stretch:
                        stretch, stretch_at = dur, run_start["id"]
                    run_start = nxt
            if self.stop is not None:
                h0, h1 = b[0]["hour"], b[-1]["hour"] + TAIL / 3600
                over = max(0.0, h1 - max(h0, self.stop))
                if over:
                    late += over * 60
                    late_ids += [m["id"] for m in b if m["hour"] >= self.stop]
        return {"blocks": [(b[0]["id"], b[0]["hour"], b[-1]["hour"] + TAIL / 3600, len(b)) for b in blocks],
                "active": active / 3600, "projects": proj, "stretch": stretch / 3600, "stretchAt": stretch_at,
                "switches": switches, "switched": switched, "late": late if self.stop is not None else None, "lateIds": late_ids,
                "first": v[0], "last": v[-1], "n": len(v)}

    def night(self, d):
        """Hours between the day before's last message and this day's first; None when either has none."""
        prev = (date.fromisoformat(d) - timedelta(days=1)).isoformat()
        a, b = self.day.get(prev), self.day.get(d)
        if not a or not b:
            return None
        return (b["first"]["_t"] - a["last"]["_t"]) / 3600


class Vitals:
    def __init__(self, model, commits, branches, limits, git_read, today=None, reviews=(), survival=()):
        self.model = model
        self.limits = limits
        self.sig = Signals(model, limits)
        ok = {}
        for m in self.sig.msgs:  # measures count an intent only when its label version is checked; views show them all
            v = m.get("intentV")
            if v not in ok:
                ok[v] = checked("categories", "in", v) if v is not None else False
            m["_in"] = m["intent"] if ok[v] else None
        now = datetime.now()
        self.asof = now.isoformat(timespec="seconds")
        self.today = today or day_of(now.astimezone())
        mine = self.sig.msgs
        self.prompts_from = mine[0]["day"] if mine else self.today.isoformat()
        self.full_from = model.full_from
        d0 = date.fromisoformat(self.prompts_from)
        self.days = [(d0 + timedelta(days=i)).isoformat() for i in range((self.today - d0).days + 1)]
        self.weeks = sorted({week_of(date.fromisoformat(d)) for d in self.days})
        self.git_read = git_read
        self.commits = commits
        self.branches = branches
        self.survival = [dict(x, day=day_of(datetime.fromtimestamp(x["at"]).astimezone()).isoformat()) for x in survival]
        self.reviews = [dict(r, day=day_of(datetime.fromtimestamp(r["at"]).astimezone()).isoformat()) for r in reviews]
        for c in commits:
            c["day"] = day_of(datetime.fromtimestamp(c["at"]).astimezone()).isoformat()
        self.landed = [c for c in commits if c["landed"] and not c["merge"] and c["who"] in ("you", "agent")]
        self.full_day = lambda d: bool(self.full_from) and d >= self.full_from
        self.wk_days = defaultdict(list)
        for d in self.days:
            self.wk_days[week_of(date.fromisoformat(d))].append(d)
        self._turns_by_sid()

    def _turns_by_sid(self):
        by = defaultdict(list)
        for t in self.model.turns.values():
            if t["ts"]:
                by[t["sid"]].append(t)
        for v in by.values():
            v.sort(key=lambda t: t["ts"])
        self.turns_by_sid = by
        self.msgs_by_sid = defaultdict(list)
        for m in self.sig.msgs:
            self.msgs_by_sid[m["sid"]].append(m)

    # -- each measure: daily values, weekly values, evidence for a week ---------------------------
    def _weekly(self, daily, how, need_full=False):
        out = []
        for w in self.weeks:
            ds = [d for d in self.wk_days[w] if not need_full or self.full_day(d)]
            vals = [daily.get(d) for d in ds]
            vals = [v for v in vals if v is not None]
            if how == "sum":
                out.append(rnd(sum(vals)) if (vals or (ds and not need_full)) else None)
            elif how == "median":
                out.append(rnd(median(vals)) if vals else None)
            elif how == "max":
                out.append(max(vals) if vals else None)
        return out

    def m_late(self):
        if self.sig.stop is None:
            return None, None, "needs a stopping hour (set it in limits)", {}
        daily = {d: rnd(s["late"], 0) for d, s in self.sig.day.items()}
        for d in self.days:
            daily.setdefault(d, 0)
        ev = {w: [i for d in self.wk_days[w] for i in (self.sig.day.get(d) or {}).get("lateIds", [])] for w in self.weeks}
        return daily, self._weekly(daily, "sum"), None, ev

    def m_night(self):
        daily = {d: rnd(self.sig.night(d)) for d in self.days}
        ev = {}
        for w in self.weeks:
            ns = [(daily[d], d) for d in self.wk_days[w] if daily.get(d) is not None]
            if ns:
                _, d = min(ns)
                prev = (date.fromisoformat(d) - timedelta(days=1)).isoformat()
                ev[w] = [self.sig.day[prev]["last"]["id"], self.sig.day[d]["first"]["id"]]
        return daily, self._weekly(daily, "median"), None, ev

    def m_daysoff(self):
        today = self.today.isoformat()
        daily = {d: 0 if d in self.sig.day else (None if d == today else 1) for d in self.days}  # today: not yet a day off
        return daily, self._weekly(daily, "sum"), None, {}

    def m_streak(self):
        """Days in a row with a message of yours, up to each day (0 on a day off); a week's value is the longest run it reached."""
        daily, run, today = {}, 0, self.today.isoformat()
        for d in self.days:
            if d in self.sig.day:
                run += 1
            elif d != today:  # today breaks the run only once it ends without a message
                run = 0
            daily[d] = run
        return daily, self._weekly(daily, "max"), None, {}

    def m_load(self):
        daily = {d: rnd(self.sig.day[d]["active"], 2) if d in self.sig.day else 0 for d in self.days}
        return daily, self._weekly(daily, "sum"), None, {}

    def m_peak(self):
        rows = {r["day"]: r for r in self.model.days}
        daily = {d: (rows.get(d) or {}).get("peak") if self.full_day(d) else None for d in self.days}
        for d in self.days:
            if self.full_day(d) and daily[d] is None:
                daily[d] = 0
        return daily, self._weekly(daily, "max", need_full=True), None, {}

    def m_people(self):
        if not self.git_read:
            return None, None, "git not read yet", {}
        touched = defaultdict(set)
        for m in self.sig.msgs:
            touched[m["day"]].add(m["project"])
        for c in self.commits:
            if c["who"] == "you":
                touched[c["day"]].add(c["project"])
        withp = defaultdict(set)
        for c in self.commits:
            if (c["who"] == "you" and c["people"]) or (c["who"] == "person" and c["project"] in touched.get(c["day"], ())):
                withp[c["day"]].add(c["project"])
        for r in self.reviews:  # someone else reviewed or commented on a pull request in a repository you worked in
            if r["project"] in touched.get(r["day"], ()):
                withp[r["day"]].add(r["project"])
        ev = defaultdict(list)
        use_acts = checked("acts", "ppl")
        for m in self.sig.msgs if use_acts else ():  # a message written with or for someone (acts labels, once checked)
            if m.get("withPeople") == "with":
                withp[m["day"]].add(m["project"])
                ev[week_of(date.fromisoformat(m["day"]))].append(m["id"])
        daily = {d: 1 if withp.get(d) else 0 for d in self.days}
        acts = use_acts and any(m.get("withPeople") is not None for m in self.sig.msgs)
        note = ("co-authors, other people's commits and their reviews and comments on pull requests, in the repositories you worked in"
                + (", and messages labelled as written with or for someone" if acts else "")
                + "; no calendar yet")
        return daily, self._weekly(daily, "sum"), note, ev

    def m_loops(self):
        if not self.git_read:
            return None, None, "git not read yet", {}
        repos = {c["project"] for c in self.commits}
        msg_days = defaultdict(list)
        for m in self.sig.msgs:
            if m["project"] in repos:
                msg_days[m["project"]].append(m["day"])
        land_days = defaultdict(list)
        for c in self.landed:
            land_days[c["project"]].append(c["day"])
        for v in list(msg_days.values()) + list(land_days.values()):
            v.sort()

        def open_at(end):
            e = date.fromisoformat(end)
            a30, a14 = (e - timedelta(days=29)).isoformat(), (e - timedelta(days=13)).isoformat()
            out = []
            for p, ds in msg_days.items():
                if bisect_right(ds, end) - bisect_left(ds, a30) > 0:
                    ls = land_days.get(p, [])
                    if bisect_right(ls, end) - bisect_left(ls, a14) == 0:
                        out.append(p)
            return out
        weekly, self.loop_projects = [], {}
        for w in self.weeks:
            end = min(self.wk_days[w][-1], self.today.isoformat())
            ps = open_at(end)
            self.loop_projects[w] = ps
            weekly.append(len(ps))
        return None, weekly, "projects with a git repository only; branches are listed in the week view", {}

    def m_stretch(self):
        daily = {d: rnd(s["stretch"], 2) for d, s in self.sig.day.items()}
        ev = {}
        for w in self.weeks:
            ds = [(self.sig.day[d]["stretch"], d) for d in self.wk_days[w] if d in self.sig.day]
            if ds:
                ev[w] = [self.sig.day[max(ds)[1]]["stretchAt"]]
        return {d: daily.get(d) for d in self.days}, self._weekly(daily, "median"), None, ev

    def m_switches(self):
        S = self.sig.day
        daily = {d: rnd(S[d]["switches"] / S[d]["active"], 2) if d in S and S[d]["active"] >= .5 else None for d in self.days}
        weekly = []
        for w in self.weeks:
            sw = sum(S[d]["switches"] for d in self.wk_days[w] if d in S)
            ah = sum(S[d]["active"] for d in self.wk_days[w] if d in S)
            weekly.append(rnd(sw / ah, 2) if ah >= 1 else None)
        ev = {w: [i for d in self.wk_days[w] if d in S for i in S[d]["switched"]] for w in self.weeks}
        return daily, weekly, None, ev

    def unread_rows(self):
        out = []
        for m in self.sig.msgs:
            if m["origin"] == "history" or not go_ahead(m) or m.get("readWords") is None or m.get("gap") is None:
                continue
            need = m["readWords"] / WPM * 60
            out.append((m, m["gap"] < need, need))
        return out

    def m_unread(self):
        by = defaultdict(list)
        for m, unread, _ in self.unread_rows():
            by[m["day"]].append((m, unread))
        daily = {d: rnd(100 * sum(u for _, u in by[d]) / len(by[d])) if len(by.get(d, ())) >= 5 else None for d in self.days}
        weekly, ev = [], {}
        for w in self.weeks:
            rows = [x for d in self.wk_days[w] for x in by.get(d, ())]
            weekly.append(rnd(100 * sum(u for _, u in rows) / len(rows)) if len(rows) >= 5 else None)
            ev[w] = [m["id"] for m, u in rows if u]
        return daily, weekly, None, ev

    def m_priorities(self):
        pr = set(self.limits.get("priorities") or [])
        if not pr:
            return None, None, "needs your list of priority projects (set it in limits)", {}
        S = self.sig.day

        def share(ds):
            tot = sum(sum(S[d]["projects"].values()) for d in ds if d in S)
            on = sum(v for d in ds if d in S for p, v in S[d]["projects"].items() if p in pr)
            return rnd(100 * on / tot) if tot else None
        daily = {d: share([d]) for d in self.days}
        return daily, [share(self.wk_days[w]) for w in self.weeks], None, {}

    def m_strain(self):
        by = defaultdict(list)
        for m in self.sig.msgs:
            if m["_in"] and m["kind"] == "prompt":
                by[m["day"]].append(m)

        tone, state, nd = checked("categories", "to"), checked("acts", "st"), checked("acts", "nd")

        def hit(m):
            return (m["_in"] == "correct" or (tone and m["tone"] == "frustrated") or (state and m.get("selfState") in STRAINED)
                    or (nd and bool(m.get("notDone"))))
        daily = {d: rnd(100 * sum(map(hit, by[d])) / len(by[d])) if len(by.get(d, ())) >= 10 else None for d in self.days}
        weekly, ev = [], {}
        for w in self.weeks:
            ms = [m for d in self.wk_days[w] for m in by.get(d, ())]
            weekly.append(rnd(100 * sum(map(hit, ms)) / len(ms)) if len(ms) >= 30 else None)
            ev[w] = [m["id"] for m in ms if hit(m)]
        lab = sum(1 for m in self.sig.msgs if m["_in"])
        parts = ["corrections"] + (["frustrated messages"] if tone else []) + \
            (["messages saying you are tired, stressed, low or unwell"] if state else []) + \
            (["messages finding that what Claude called done wasn't"] if nd else [])
        left = [x for x, ok in (("tone", tone), ("self-state", state), ("not done after all", nd)) if not ok]
        note = (f"{', '.join(parts)}, from Haiku's labels on {round(100 * lab / max(1, len(self.sig.msgs)))}% of your messages"
                + (f"; {' and '.join(left)} wait until their labels are checked" if left else "")
                + "; reply length late in the day and check-in energy aren't in it yet")
        return daily, weekly, note, ev

    def m_landed(self):
        if not self.git_read:
            return None, None, "git not read yet", {}
        c = Counter(x["day"] for x in self.landed)
        daily = {d: c.get(d, 0) for d in self.days}
        return daily, self._weekly(daily, "sum"), "commits by you or an agent that reached the default branch, at the time they were made (a merged pull request counts through its commits)", {}

    def m_ftr(self):
        daily_n, daily_ok, ev = Counter(), Counter(), defaultdict(list)
        for sid, ms in self.msgs_by_sid.items():
            for i, m in enumerate(ms):
                if m["_in"] not in WORK:
                    continue
                nxt = ms[i + 1] if i + 1 < len(ms) else None
                if nxt and not nxt["_in"]:
                    continue
                ok = not (nxt and nxt["_in"] == "correct")
                daily_n[m["day"]] += 1
                daily_ok[m["day"]] += ok
                if not ok:
                    ev[week_of(date.fromisoformat(m["day"]))].append(nxt["id"])
        daily = {d: rnd(100 * daily_ok[d] / daily_n[d]) if daily_n[d] >= 5 else None for d in self.days}
        weekly = []
        for w in self.weeks:
            n = sum(daily_n[d] for d in self.wk_days[w])
            weekly.append(rnd(100 * sum(daily_ok[d] for d in self.wk_days[w]) / n) if n >= 10 else None)
        return daily, weekly, "build and fix requests, from Haiku's labels; the next labelled message in the session decides", ev

    def m_leverage(self):
        if not self.git_read:
            return None, None, "git not read yet", {}
        c = Counter(x["day"] for x in self.landed)
        S = self.sig.day
        weekly = []
        for w in self.weeks:
            ah = sum(S[d]["active"] for d in self.wk_days[w] if d in S)
            weekly.append(rnd(sum(c.get(d, 0) for d in self.wk_days[w]) / ah, 2) if ah >= 2 else None)
        daily = {d: rnd(c.get(d, 0) / S[d]["active"], 2) if d in S and S[d]["active"] >= 1 else None for d in self.days}
        return daily, weekly, None, {}

    def m_ttd(self):
        by = defaultdict(list)
        for sid, ms in self.msgs_by_sid.items():
            turns = self.turns_by_sid.get(sid) or []
            if not turns:
                continue
            ts = [t["ts"] for t in turns]
            for m in ms:
                if m["_in"] not in WORK or m["origin"] == "history":
                    continue
                i = bisect_left(ts, m["ts"])
                for t in turns[i:i + 40]:
                    if t["commits"] or t["prs"] or t["pushes"]:
                        by[m["day"]].append(((utc(t["end"]) - utc(m["ts"])).total_seconds() / 60, m["id"]))
                        break
        daily = {d: rnd(median([x for x, _ in by[d]]), 0) if by.get(d) else None for d in self.days}
        weekly = []
        for w in self.weeks:
            xs = [x for d in self.wk_days[w] for x, _ in by.get(d, ())]
            weekly.append(rnd(median(xs), 0) if len(xs) >= 3 else None)
        return daily, weekly, "build and fix requests that a commit, push or pull request followed in the same session", {}

    def m_survival(self):
        if not self.survival:
            return None, None, "measured by git blame on a sample of landed commits, not done yet", {}
        by = defaultdict(list)
        for x in self.survival:
            by[x["day"]].append(x)
        weekly = []
        for w in self.weeks:
            xs = [x for d in self.wk_days[w] for x in by.get(d, ())]
            n = sum(x["counted"] for x in xs)
            weekly.append(rnd(100 * sum(x["kept"] for x in xs) / n) if len(xs) >= 3 and n else None)
        return None, weekly, (f"lines still in place {30} days later, by git blame, on a sample of up to 6 landed commits a "
                              f"week ({len(self.survival)} so far), so one large commit rewritten later can swing a week; weeks of the last "
                              "month can't be measured yet"), {}

    # -- bands, flags, sentences -------------------------------------------------------------
    def bands(self, weekly):
        out = []
        for i in range(len(weekly)):
            prev = [v for v in weekly[max(0, i - BAND_WEEKS):i] if v is not None]
            if len(prev) < BAND_MIN:
                out.append(None)
            else:
                out.append({"lo": rnd(pctile(prev, .25), 2), "mid": rnd(pctile(prev, .5), 2), "hi": rnd(pctile(prev, .75), 2)})
        return out

    @staticmethod
    def side(v, b):
        if v is None or not b:
            return None
        return "above" if v > b["hi"] else "below" if v < b["lo"] else None

    def sentence(self, key, flag, weekly, band):
        subject, words, unit = SAY[key]
        v, b = weekly[-2], band[-2]
        word = words[0] if flag == "above" else words[1]
        unit_words = {"min": f"{round(v)} minutes last week, against a usual {round(b['mid'])}",
                      "h": f"{v:.1f} hours last week, against a usual {b['mid']:.1f}",
                      "days": f"{v:g} last week, against a usual {b['mid']:g}",
                      "count": f"{v:g} last week, against a usual {b['mid']:g}",
                      "%": f"{round(v)}% last week, against a usual {round(b['mid'])}%",
                      "perh": f"{v:.1f} an hour last week, against a usual {b['mid']:.1f}"}[unit]
        return f"{subject} {word} than usual for two weeks: {unit_words}."

    def streak_sentence(self, daily):
        run = daily[self.days[-1]] or daily[self.days[-2]] if len(self.days) > 1 else daily[self.days[-1]]
        if run < LONG_RUN:
            return None
        end = self.days[-1] if daily[self.days[-1]] else self.days[-2]
        first = (date.fromisoformat(end) - timedelta(days=run - 1)).isoformat()
        off = (date.fromisoformat(first) - timedelta(days=1))
        since = "since you began here" if first == self.days[0] else f"your last day off was {off.strftime('%A')} {off.day} {off.strftime('%B')}"
        longest = max(daily.values())
        tail = "it is the longest run on record" if run >= longest else f"the longest so far was {longest}"
        return f"You have worked {run} days in a row; {since}, and {tail}."

    def measure(self, key):
        label, question, unit, better = MEASURES[key]
        daily, weekly, note, ev = getattr(self, "m_" + key)()
        self.evidence = getattr(self, "evidence", {})
        self.evidence[key] = ev
        row = {"key": key, "goal": GOAL_OF[key], "label": label, "question": question, "unit": unit, "better": better}
        if weekly is None:
            row.update(weekly=[None] * len(self.weeks), band=[None] * len(self.weeks), now=None, flag=None, sentence=None,
                       status="missing", note=note, since=None, evidence={"messages": []})
            return row
        needs_full = key in ("peak", "unread", "ttd")
        if needs_full:
            weekly = [v if self.full_from and w >= week_of(date.fromisoformat(self.full_from)) else None for w, v in zip(self.weeks, weekly)]
        if daily is not None:
            row["daily"] = [daily.get(d) for d in self.days]
        band = self.bands(weekly)
        flag = None
        if len(weekly) >= 3:
            a, b = self.side(weekly[-2], band[-2]), self.side(weekly[-3], band[-3])
            flag = a if a and a == b else None
        since = next((d for d in self.days if daily and daily.get(d) is not None), None) if daily else \
            next((w for w, v in zip(self.weeks, weekly) if v is not None), None)
        cur = self.weeks[-1]
        evid = (ev.get(cur) or [])[-10:] or (ev.get(self.weeks[-2]) or [])[-10:] if len(self.weeks) > 1 else (ev.get(cur) or [])[-10:]
        status = "partial" if note else "ok"
        if all(v is None for v in weekly):
            status = "missing"
            if key in ("strain", "ftr", "ttd", "unread") and not any(m["_in"] for m in self.sig.msgs):
                labelled = any(m["intent"] for m in self.sig.msgs)
                note = ("waits until the intent labels of this version are checked (docs/labels.md)" if labelled
                        else "needs your messages labelled first (labeller/label.py)") + \
                    (", or more go-aheads to read" if key == "unread" else "")
            elif key in ("strain", "ftr", "ttd", "unread"):
                note = (note + "; " if note else "") + "not enough of them yet"
        sentence = self.sentence(key, flag, weekly, band) if flag else None
        if key == "streak":
            sentence = self.streak_sentence(daily) or sentence
        row.update(weekly=weekly, band=band, now=daily[self.days[-1]] if key == "streak" else weekly[-1], flag=flag,
                   sentence=sentence,
                   status=status, note=note, since=since, evidence={"messages": evid})
        return row

    def points(self):
        """Every message of yours as one compact row, for drawing (docs/contract-points.md), and the ids beside them."""
        S = self.sig
        d0 = date.fromisoformat(self.days[0]) if self.days else self.today
        t0 = int(datetime(d0.year, d0.month, d0.day, 5).timestamp())
        intents, origins, projects = [], [], []

        def code(lst, v):
            if v is None:
                return None
            if v not in lst:
                lst.append(v)
            return lst.index(v)
        rows, ids = [], []
        for m in S.msgs:
            rows.append([int((m["_t"] - t0) // 60), (date.fromisoformat(m["day"]) - d0).days, round(m["hour"], 2),
                         code(intents, m["intent"]), code(origins, m["origin"]), code(projects, m["project"]),
                         None if m["stopped"] is None else int(bool(m["stopped"])), m.get("outAll")])
            ids.append(m["id"])
        return {"generated": self.asof, "t0": t0, "day0": d0.isoformat(),
                "fields": ["minute", "day", "hour", "intent", "origin", "project", "stopped", "outAll"],
                "rows": rows, "intents": intents, "origins": origins, "projects": projects}, \
            {"generated": self.asof, "ids": ids}

    def pulse(self):
        """What the limits hook and the status line read (cache dir, pulse.json), small enough to load in a few
        milliseconds: active hours by day for the last 60 days, and when the last message was."""
        recent = self.days[-60:]
        S = self.sig
        run = self.m_streak()[0]
        return {"asof": self.asof, "today": self.today.isoformat(), "dayStart": 5,
                "active": {d: rnd(S.day[d]["active"], 2) for d in recent if d in S.day},
                "run": {d: run[d] for d in recent[-14:]},  # days in a row up to each of the last two weeks' days
                "last": S.msgs[-1]["ts"] if S.msgs else None}

    def payload(self):
        self.rows = {k: self.measure(k) for k in MEASURES}
        return {
            "asof": self.asof,
            "coverage": {"full_from": self.full_from, "prompts_from": self.prompts_from, "git": bool(self.git_read)},
            "days": self.days, "weeks": self.weeks,
            "limits": {k: self.limits.get(k) for k in ("stopHour", "daysOffPerWeek", "maxSessions", "priorities")},
            "goals": [{"key": g, "label": l, "group": grp, "measures": ks} for g, l, grp, ks in GOALS],
            "measures": list(self.rows.values()),
        }

    # -- one week, for the retro ---------------------------------------------------------------
    def week(self, start):
        """The week from Monday `start`: its vital signs against its band, its days, and candidate moments.
        docs/contract-week.md is the shape. Kept once built: a Vitals is rebuilt whenever the data changes."""
        if start not in self.weeks:
            return None
        memo = self.__dict__.setdefault("_weeks", {})
        if start not in memo:
            memo[start] = self._week(start)
        return memo[start]

    def _week(self, start):
        if not getattr(self, "rows", None):
            self.payload()
        i = self.weeks.index(start)
        ds = self.wk_days[start]
        complete = i < len(self.weeks) - 1
        vit = []
        j0 = self.days.index(ds[0])
        for r in self.rows.values():
            v, b = r["weekly"][i], r["band"][i]
            side = self.side(v, b)
            prev_side = self.side(r["weekly"][i - 1], r["band"][i - 1]) if i else None
            flag = side if side and side == prev_side else None
            row = {k: r[k] for k in ("key", "goal", "label", "question", "unit", "better", "status", "note", "since")}
            row.update(value=v, band=b, side=side, flag=flag, now=v,
                       sentence=self.sentence_at(r["key"], side, v, b) if side and complete else None,
                       evidence={"messages": [x for x in (self.evidence.get(r["key"]) or {}).get(start, [])][-10:]})
            if "daily" in r:
                row["daily"] = r["daily"][j0:j0 + len(ds)]
            vit.append(row)
        S = self.sig
        landed = Counter(c["day"] for c in self.landed)
        unread = {m["id"] for m, u, _ in self.unread_rows() if u and m["day"] in ds}
        days = []
        for d in ds:
            x = S.day.get(d)
            v = S.by_day.get(d) or []
            full = self.full_day(d)
            row = {"day": d, "dow": date.fromisoformat(d).weekday(), "messages": len(v), "off": x is None,
                   "night": rnd(S.night(d)), "landed": landed.get(d, 0) if self.git_read else None}
            if x:
                row.update({
                    "first": rnd(x["first"]["hour"], 2), "last": rnd(x["last"]["hour"], 2), "active": rnd(x["active"], 2),
                    "blocks": [{"from": rnd(a, 2), "to": rnd(b, 2), "messages": n, "id": mid} for mid, a, b, n in x["blocks"]],
                    "stretch": rnd(x["stretch"], 2), "switches": x["switches"], "late": rnd(x["late"], 0),
                    "projects": {p: rnd(t / 60, 0) for p, t in x["projects"].most_common()},
                    "sessions": len({m["sid"] for m in v}),
                    "unread": sum(m["id"] in unread for m in v) if full else None,
                    "stopped": sum(bool(m["stopped"]) for m in v) if full else None,
                    "corrections": sum(m["intent"] == "correct" for m in v),
                    "history": sum(m["origin"] == "history" for m in v),
                })
            acc = (self.model.labels.get("days") or {}).get(d)
            row["account"] = acc.get("account") if isinstance(acc, dict) else None   # the days set's account, a reading
            days.append(row)
        moments = self.moments(start, days, unread)
        figures = self.summary(days, vit, complete)
        acc = self.week_account(start)
        account = {k: acc.get(k) for k in ("account", "decided", "dropped", "postponed", "open", "strain", "cites")} if acc else None
        if account:  # the [a7176289] citations in its texts, resolved to message ids
            from .model import cites
            account["citeIds"] = cites([account.get("account"), account.get("strain")], self.model.by_short)
        return {"week": start, "complete": complete, "summary": (acc or {}).get("account") or figures, "figures": figures,
                "account": account, "days": days, "vitals": vit, "moments": moments, "more": getattr(self, "more", {})}

    def summary(self, days, vit, complete):
        """One plain sentence on the week: how much, how rested, and what sat outside the usual."""
        on = [d for d in days if not d["off"]]
        if not on:
            return "No messages of yours this week."
        hours = sum(d["active"] for d in on)
        nights = [d["night"] for d in on if d["night"] is not None and d["night"] <= 20]  # longer isn't a night
        h = f"{hours:.1f}".rstrip("0").rstrip(".") if hours < 10 else f"{round(hours)}"
        part = (f"{'So far, ' if not complete else ''}{h} hour{'' if h == '1' else 's'} of work over {len(on)} "
                f"day{'s' if len(on) > 1 else ''}")
        if nights:
            part += f", nights of {median(nights):.1f} hours"
        out = [v for v in vit if v["side"] and v["status"] != "missing"] if complete else []
        if out:
            words = [f"{v['label'].lower()} {'higher' if v['side'] == 'above' else 'lower'}" for v in out[:3]]
            part += "; outside your usual: " + ", ".join(words)
        return part + "."

    def sentence_at(self, key, side, v, b):
        """The sentence for one week outside its band (the two-week sentence is for /api/vitals)."""
        return self.sentence(key, side, [v, None], [b, None]).replace(" for two weeks", "").replace(" last week", "")

    def moments(self, start, days, unread):
        """Candidates for the retro's three moments, most unusual first. Each has a key, a short title, the
        longer reason, the goal it is about, one open question for the retro, and its messages."""
        S, out = self.sig, []
        ds = [d["day"] for d in days]
        on = [d for d in days if not d["off"]]
        fmt = lambda h: f"{int(h) % 24:02d}:{int(round((h % 1) * 60)) % 60:02d}"
        name = lambda d: date.fromisoformat(d).strftime("%A")

        def add(kind, day, title, reason, question, ids, value=None, unusual=None, **extra):
            if ids or extra:
                out.append({"key": kind, "kind": kind, "day": day, "title": title, "reason": reason, "about": ABOUT[kind],
                            "question": question, "messages": ids[:12], "value": value, "unusual": unusual, **extra})

        # how unusual, for ranking: the share of the days of the 8 weeks before that this one beats
        i = self.weeks.index(start)
        prev_days = [d for w in self.weeks[max(0, i - BAND_WEEKS):i] for d in self.wk_days[w] if d in S.day]

        def rank(vals, v, high=True):
            vals = [x for x in vals if x is not None]
            if not vals or v is None:
                return None
            return rnd(sum((v > x) if high else (v < x) for x in vals) / len(vals), 2)
        def worth(u, value, floor):
            """A moment is worth a question when it is unusual for you, or past a plain floor (a new user has no usual)."""
            return (u is not None and u >= .75) or value >= floor
        if on:
            d = max(on, key=lambda d: d["last"])
            x = S.day[d["day"]]
            u = rank([S.day[p]["last"]["hour"] for p in prev_days], d["last"])
            if worth(u, d["last"], self.sig.stop or 22) and d["last"] >= 20:
                add("latest-night", d["day"], f"{name(d['day'])} ended at {fmt(d['last'])}",
                    f"Your latest stop: {name(d['day'])}, last message at {fmt(d['last'])}.",
                    f"What kept you at it until {fmt(d['last'])} on {name(d['day'])}?",
                    [x["last"]["id"]], d["last"], u)
            nights = [d for d in on if d["night"] is not None]
            d = min(nights, key=lambda d: d["night"]) if nights else None
            u = rank([S.night(p) for p in prev_days], d["night"], high=False) if d else None
            if d and ((u is not None and u >= .75 and d["night"] < 10) or d["night"] < 8):
                prev = (date.fromisoformat(d["day"]) - timedelta(days=1)).isoformat()
                add("short-night", d["day"], f"{d['night']:.1f} hours off before {name(d['day'])}",
                    f"Your shortest night: {d['night']:.1f} hours between your last message and the first one on {name(d['day'])}.",
                    f"What made the night before {name(d['day'])} short?",
                    [S.day[prev]["last"]["id"], S.day[d["day"]]["first"]["id"]], d["night"], u)
            d = max(on, key=lambda d: d["active"])
            x = S.day[d["day"]]
            u = rank([S.day[p]["active"] for p in prev_days], d["active"])
            if worth(u, d["active"], 8) and d["active"] >= 4:
                add("longest-day", d["day"], f"{name(d['day'])}: {d['active']:.1f} hours, {fmt(d['first'])} to {fmt(d['last'])}",
                    f"Your longest day: {name(d['day'])}, {d['active']:.1f} hours of work from {fmt(d['first'])} to {fmt(d['last'])}.",
                    f"What made {name(d['day'])} such a long day, and was it worth it?",
                    [x["first"]["id"], x["last"]["id"]], d["active"], u)
            hours, ids = Counter(), defaultdict(list)
            for dd in ds:
                for mid in (S.day.get(dd) or {}).get("switched", []):
                    m = self.model.msg_by_id.get(mid)
                    if m:
                        hours[(dd, int(m["hour"]))] += 1
                        ids[(dd, int(m["hour"]))].append(mid)
            (dd, h), n = hours.most_common(1)[0] if hours else ((None, 0), 0)
            if n >= 10:
                add("switching", dd, f"{name(dd)} {fmt(h)}: {n} changes of session in an hour",
                    f"Your most scattered hour: {name(dd)} {fmt(h)} to {fmt(h + 1)}, {n} changes of session.",
                    "What pulled you from one session to the next in that hour?", ids[(dd, h)], n)
            d = max(on, key=lambda d: d["stretch"])
            m = self.model.msg_by_id.get(S.day[d["day"]]["stretchAt"]) or {}
            u = rank([S.day[p]["stretch"] for p in prev_days], d["stretch"])
            if worth(u, d["stretch"], 2) and d["stretch"] >= 1:
                add("deep", d["day"], f"{name(d['day'])}: {d['stretch']:.1f} hours on {m.get('project') or 'one project'}",
                    f"Your longest stretch on one project: {d['stretch']:.1f} hours on {m.get('project') or 'one project'}, {name(d['day'])}.",
                    "What let you stay with one thing that long?",
                    [S.day[d["day"]]["stretchAt"]], d["stretch"], u)
        week_msgs = [m for dd in ds for m in S.by_day.get(dd) or []]
        if unread:
            ms = [m for m in week_msgs if m["id"] in unread]
            add("unread", ms[0]["day"], f"{many(len(ms), 'go-ahead')} before the reply could be read",
                f"{many(len(ms), 'go-ahead')} sent sooner than Claude's reply could be read at {WPM} words a minute.",
                "Which of these would you have answered differently after reading the reply?", [m["id"] for m in ms], len(ms))
        st = [m for m in week_msgs if m["stopped"]]
        if st:
            add("stopped", st[0]["day"], f"{many(len(st), 'turn')} stopped mid-way",
                f"You stopped Claude mid-turn {'once' if len(st) == 1 else f'{len(st)} times'}.",
                "What made you stop Claude, and could you have said it before it started?", [m["id"] for m in st], len(st))
        co = [m for m in week_msgs if m["intent"] == "correct"]
        if co:
            dd, n = Counter(m["day"] for m in co).most_common(1)[0]
            add("corrections", dd, f"{many(len(co), 'correction')}, {n} on {name(dd)}",
                f"{many(len(co), 'correction')} this week, {n} of them on {name(dd)}.",
                f"What kept going wrong on {name(dd)}?", [m["id"] for m in co if m["day"] == dd], len(co))
        # projects gone quiet: busy in the four weeks before, nothing this week and nothing landed
        lo = (date.fromisoformat(start) - timedelta(days=28)).isoformat()
        busy = Counter(m["project"] for m in S.msgs if lo <= m["day"] < start)
        now = Counter(m["project"] for m in week_msgs)
        landed_now = {c["project"] for c in self.landed if c["day"] in ds}
        for p, n in busy.most_common():
            if n < 30 or now.get(p) or p in landed_now or p in ("?", "~", "scratchpads"):
                continue
            last = max((m for m in S.msgs if m["project"] == p and m["day"] < start), key=lambda m: m["ts"])
            add("quiet", last["day"], f"{p} went quiet", f"{p} went quiet: {n} messages in the four weeks before, none this week.",
                f"Is {p} parked, dropped, or waiting for you?", [last["id"]], n)
        # the day accounts (days label set): each ref is {"t": what, in a few words, "m": the message behind it}.
        # Picked across the week, one day at a time (busiest days first, then those with signs of strain), up to
        # PICK per kind; the rest go under "more" so the page can open them.
        dl = self.model.labels.get("days") or {}
        busy = {d["day"]: (d["messages"], bool((dl.get(d["day"]) or {}).get("strain"))) for d in days}
        order = sorted((dd for dd in ds if isinstance(dl.get(dd), dict)), key=lambda dd: busy.get(dd, (0, False)), reverse=True)
        self.more = {}
        for kind, (lead, question) in DAY_REFS.items():
            queues = [[(dd, r) for r in dl[dd].get(kind) or [] if isinstance(r, dict) and r.get("m")] for dd in order]
            picked = []
            while any(queues):  # round robin: one from each day before a second from any
                for q in queues:
                    if q:
                        picked.append(q.pop(0))
            for n, (dd, r) in enumerate(picked):
                t = (r.get("t") or "").rstrip(".")
                if n < PICK[kind]:
                    add(kind, dd, f"{name(dd)}: {t}", f"{lead} on {name(dd)}: {t}.", question, [r["m"]])
                else:
                    self.more.setdefault(kind, []).append({"key": kind, "kind": kind, "day": dd, "title": f"{name(dd)}: {t}",
                                                           "reason": f"{lead} on {name(dd)}: {t}.", "about": ABOUT[kind],
                                                           "question": question, "messages": [r["m"]], "value": None, "unusual": None})
        # sessions that ended abandoned (sessions label set)
        ab = [x for x in self.model.sessions.values() if x.get("outcome") == "abandoned" and x.get("first")
              and (self.model.msg_by_id.get(x["first"]) or {}).get("day") in ds]
        if ab:
            add("abandoned", self.model.msg_by_id[ab[0]["first"]]["day"],
                "1 session abandoned" if len(ab) == 1 else f"{len(ab)} sessions abandoned",
                ("1 session this week ended abandoned: " if len(ab) == 1 else f"{len(ab)} sessions this week ended abandoned: ")
                + "; ".join(short((x.get("goal") or x.get("ex") or "").rstrip("."), 80) for x in ab[:3]) + ".",
                "What made you leave these, and do any still matter?", [x["first"] for x in ab], len(ab))
        # branches of yours with work on them, not merged, untouched for two to four weeks
        end = datetime.fromisoformat(ds[-1]).timestamp() + 86400
        stale = [b for b in self.branches if b.get("who") in ("you", "agent") and end - 30 * 86400 <= b["at"] <= end - 14 * 86400]
        if stale:
            add("branches", None, f"{many(len(stale), 'branch', 'branches')} left unmerged",
                f"{many(len(stale), 'branch', 'branches')} of yours, unmerged and untouched for two to four weeks.",
                "Which of these do you keep, park or drop?", [], len(stale),
                branches=[{"project": b["project"], "name": b["name"], "ahead": b["ahead"],
                           "last": datetime.fromtimestamp(b["at"]).date().isoformat()} for b in sorted(stale, key=lambda b: -b["at"])[:12]])
        out.sort(key=lambda m: -(m["unusual"] if m["unusual"] is not None else .5))
        # the week's own account (weeks label set) picks up to three moments: they come first
        for r in reversed((self.week_account(start) or {}).get("moments") or []):
            if isinstance(r, dict) and r.get("m"):
                m = self.model.msg_by_id.get(r["m"]) or {}
                t = (r.get("t") or "").rstrip(".")
                out.insert(0, {"key": "week", "kind": "week", "day": m.get("day"), "title": short(t, 90), "reason": t + ".",
                               "about": None, "question": "Looking back at this, what would you keep, and what would you change?",
                               "messages": [r["m"]], "value": None, "unusual": None})
        return out

    def week_account(self, start):
        """The weeks label set's account of the week from Monday start, keyed there by ISO week ("2026-W42")."""
        y, w, _ = date.fromisoformat(start).isocalendar()
        a = (self.model.labels.get("weeks") or {}).get(f"{y}-W{w:02d}")
        return a if isinstance(a, dict) else None


def build(model, limits=None, git=None, today=None):
    """A Vitals for a model, with no server: limits from the data dir and git from the cache unless given."""
    from . import store
    from .gitlog import Git
    g = git or Git(readonly=True)
    return Vitals(model, g.commits(Counter(m["project"] for m in model.messages)), g.open_branches(),
                  store.limits() if limits is None else limits, bool(g.repos), today=today, reviews=g.reviews(),
                  survival=g.survival())


def vitals(model, limits=None, git=None, today=None):
    """The /api/vitals payload (docs/contract-vitals.md) for a model."""
    return build(model, limits, git, today).payload()


def week(model, start, limits=None, git=None, today=None):
    """The /api/week payload (docs/contract-week.md) for the week from Monday start, or None."""
    return build(model, limits, git, today).week(start)
