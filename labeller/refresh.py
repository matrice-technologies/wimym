#!/usr/bin/env python3
"""Every label set brought up to date with what you did since the last run, in the order the sets build on each
other, with today left out: a day still going would only be written again tomorrow. It says first what it would send
and about what that costs, and sends nothing without a yes.

    python3 labeller/refresh.py              # what it would send and the cost, then asks (in a terminal; otherwise stops there)
    python3 labeller/refresh.py --dry-run    # only what it would send and the cost
    python3 labeller/refresh.py --yes        # send it without asking
    wimym label [--dry-run | --yes]          # the same, from the wimym command

The chain: categories, then signals and acts (which leave out what categories found you didn't type), sessions, days
(which read the session accounts and the message labels), weeks (which read the day accounts; a week waits until it
has ended), and rules (one call over every rule acts found, made again only when that input changed).

A set whose file is at another version than definitions.json is left as it is: one label at the new version makes the
file that version, and every older label in it stops counting. That set needs a full relabel (labeller/relabel.sh,
docs/labels.md); this says so, with what it would cost, and goes on with the others.

The costs are estimates, the list-price equivalent `claude -p` reports, which counts against your Claude plan's usage:
from what each set's own calls cost per item at its version, or the first full runs' figures until it has enough of
its own. Standard library only, as label.py and accounts.py, whose calls these are.
"""
import argparse
import hashlib
import os
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import accounts as A  # noqa: E402
import label as L  # noqa: E402
from label import DEFS, Store, now  # noqa: E402
from wimym.index import Index  # noqa: E402
from wimym.paths import LABELS_DIR  # noqa: E402

CHAIN = ("categories", "signals", "acts", "sessions", "days", "weeks", "rules")
NOUN = {"sessions": ("session", "sessions"), "days": ("day", "days"), "weeks": ("week", "weeks"), "rules": ("run", "runs")}
# list price per item of the first full runs (docs/labels.md, "Runs and cost"), until a set has costs of its own
FIRST_RUNS = {"categories": 14.19 / 8064, "signals": 13.92 / 7901, "acts": 28.12 / 7863, "sessions": 48.77 / 1325,
              "days": 10.61 / 101, "weeks": 2.86 / 31, "rules": 0.40}
OWN_FROM = 20  # items a set has written at its version before its own cost per item is used


def today():
    """The day as Wimym counts it, 5:00 to 5:00."""
    return A.day_of(datetime.now(timezone.utc).isoformat())


def week_ended(wid, day):
    y, w = wid.split("-W")
    return (date.fromisocalendar(int(y), int(w), 1) + timedelta(days=7)).isoformat() <= day


def noun(name, n):
    one, many = NOUN.get(name, ("message", "messages"))
    return f"{n:,} {one if n == 1 else many}"


def per_item(store):
    calls = [c for c in store.d["calls"] if c.get("v") == store.v]
    if store.name == "rules":
        runs = [r for r in store.d["runs"] if r.get("v") == store.v]
        return sum(r.get("usd", 0) for r in runs) / len(runs) if runs else FIRST_RUNS["rules"]
    ok = sum(c.get("ok", 0) for c in calls)
    return sum(c.get("usd", 0) for c in calls) / ok if ok >= OWN_FROM else FIRST_RUNS[store.name]


class Stage:
    """One set as things stand now: what it would send (todo), what is new but not settled yet (waiting), and whether
    its file is behind this Wimym's version of it."""

    def __init__(self, name, folder, data, day):
        self.name, self.folder, self.data, self.day = name, folder, data, day
        self.items, self.waits_for = [], None
        if name == "rules":
            # rules are read from acts: while acts is left at an older version, grouping them again finds nothing new
            acts = Store(os.path.join(folder, DEFS["acts"]["file"]), "acts")
            if acts.old_version not in (None, acts.v) and acts.d["labels"]:
                self.store, self.todo, self.waiting, self.behind = acts, [], [], False
                self.waits_for = f"acts at v{acts.v}"
                return
            self.prompt, _, _, n_rules, _ = A.rules_input(folder, data["sessions"])
            self.store = Store(os.path.join(folder, DEFS["rules"]["file"]), "rules")
            h = hashlib.sha1(self.prompt.encode()).hexdigest()[:12]
            same = self.store.d.get("h") == h and self.store.old_version in (None, self.store.v)
            self.todo, self.waiting, self.behind = ([] if same or not n_rules else [{"id": "rules"}]), [], False
            return
        if name in L.MESSAGE_SETS:
            self.store, self.items = L.open_set(name, folder, data["prompts"], data["skipped"])
        else:
            self.store = Store(os.path.join(folder, DEFS[name]["file"]), name)
            self.items = A.items_of(name, folder, data["sessions"])
        st = self.store
        # a file at another version: a new label would make it this version, and its labels would stop counting
        self.behind = st.old_version not in (None, st.v) and bool(st.d["labels"])
        fresh = [p for p in self.items if not st.done(p)]
        self.todo = [p for p in fresh if self.settled(p)]
        self.waiting = [p for p in fresh if not self.settled(p)]

    def settled(self, p):
        if A.day_of(p.get("last") or p["ts"]) >= self.day:
            return False
        return self.name != "weeks" or week_ended(p["id"], self.day)

    def cost(self, n=None):
        return per_item(self.store) * (len(self.todo) if n is None else n)

    def model(self):
        return DEFS[self.name].get("model") or ("haiku" if self.name in L.MESSAGE_SETS else "sonnet")

    def run(self, jobs, timeout):
        st, todo = self.store, self.todo
        if self.name == "rules":
            return A.rules(self.folder, self.model(), timeout, sessions=self.data["sessions"])
        print(f"\n{self.name} v{st.v}: {noun(self.name, len(todo))}, {self.model()}", flush=True)
        start = now()
        if self.name in L.MESSAGE_SETS:
            st.save()  # the skipped list and the start of your words, as label.py does before its calls
            r = L.label(st, todo, self.model(), DEFS[self.name].get("per_call") or 50, jobs, timeout, True)
        else:
            per_call, max_chars = (5, 3 * A.SESSION_CHARS) if self.name == "sessions" else (1, A.DAY_CHARS)
            r = A.run_items(st, todo, None, self.model(), per_call, jobs, timeout, True, max_chars)
        st.d["runs"].append({"start": start, "end": now(), "mode": "refresh", "v": st.v, "model": self.model(), "think": True,
                             "todo": len(todo), "labelled": len(todo) - r["gave_up"], **r})
        st.save()
        print(f"{self.name}: done in {r['secs'] / 60:.1f} min, {r['calls']} calls, ${r['usd']:.2f}"
              + (f", {r['gave_up']} given up on (the next run tries them again)" if r["gave_up"] else ""), flush=True)


def unread_transcripts(day):
    """Transcripts written to before today that Wimym's index hasn't read yet: what's in them can't be labelled."""
    n = 0
    for _, st in Index().stale():
        if (datetime.fromtimestamp(st.st_mtime) - timedelta(hours=A.DAY_START)).date().isoformat() < day:
            n += 1
    return n


def ahead(stages):
    """What the sets run before it will add to a later set's count: the weeks of the days about to be written (a week
    is read from its day accounts), and the rules once acts has found more."""
    by = {s.name: s for s in stages}
    days, weeks, rules = by["days"], by["weeks"], by["rules"]
    if not days.behind and not weeks.behind:
        have = {p["id"] for p in weeks.todo} | {p["id"] for p in weeks.waiting}
        for d in days.todo:
            y, w, _ = date.fromisoformat(d["id"]).isocalendar()
            wid = f"{y}-W{w:02d}"
            if wid not in have:
                have.add(wid)
                (weeks.todo if week_ended(wid, weeks.day) else weeks.waiting).append({"id": wid, "ts": wid})
    if not rules.todo and by["acts"].todo and not by["acts"].behind:
        rules.todo = [{"id": "rules"}]


def plan(stages, day, claude_ok, unread):
    """What would be sent, set by set, then what waits and what is left alone. → the estimated total."""
    print(f"Labels to bring up to date, leaving out today ({datetime.fromisoformat(day):%a %d %b}, from {A.DAY_START}:00):\n")
    total, behind = 0, [s for s in stages if s.behind]
    for s in stages:
        if s.behind:
            print(f"  {s.name:<11} v{s.store.old_version}  left as it is: this Wimym labels at v{s.store.v} "
                  f"(a full relabel, about ${s.cost(len(s.items)):,.0f})")
            continue
        if s.name == "rules" and s.waits_for:
            print(f"  {s.name:<11} waits for {s.waits_for}")
            continue
        if not s.todo:
            print(f"  {s.name:<11} up to date")
            continue
        what = "grouped again" if s.name == "rules" else f"{noun(s.name, len(s.todo))} new"
        c = s.cost()
        total += c
        print(f"  {s.name:<11} v{s.store.v}  {what:<28} about ${c:,.2f}  {s.model().capitalize()}")
    print(f"\n  About ${total:,.2f} in all, list price: it counts against your Claude plan's usage." if total else
          "\n  Nothing to send.")
    by = {s.name: s for s in stages if not s.behind}
    waits = [noun(n, len(by[n].waiting)) for n in ("categories", "sessions", "days") if n in by and by[n].waiting]
    if waits:
        print(f"  Left for a later run: {', '.join(waits)} from today or still going"
              + (", and the week in progress." if "weeks" in by and by["weeks"].waiting else "."))
    if behind:
        print(f"\nLeft as {'they are' if len(behind) > 1 else 'it is'}: {', '.join(s.name for s in behind)}. One label at this "
              "Wimym's version would make the whole file that version, and every older label in it would stop counting. "
              f"Bringing {'them' if len(behind) > 1 else 'it'} up means a full relabel, about "
              f"${sum(s.cost(len(s.items)) for s in behind):,.0f} in all, built in a separate folder (docs/labels.md); "
              "until then the page keeps showing the labels there as they are.")
    if unread:
        print(f"\n{unread:,} transcript{'s' if unread != 1 else ''} written before today "
              f"{'are' if unread != 1 else 'is'} not in Wimym's index yet, so what's in them can't be labelled: start Wimym "
              "(./install.sh) and run this again once its page says Up to date.")
    if total and not claude_ok:
        print(f"\nThe calls go through the claude command, which isn't at {L.CLAUDE_BIN}: install Claude Code, or set "
              "CLAUDE_BIN to where it is.")
    return total


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="say what it would send and what it would cost, and stop")
    g.add_argument("--yes", action="store_true", help="send it without asking")
    ap.add_argument("--dir", default=LABELS_DIR, help=f"labels folder to read and write (default {LABELS_DIR})")
    ap.add_argument("--jobs", type=int, default=6, help=f"calls at once (at most {L.MAX_JOBS})")
    ap.add_argument("--timeout", type=int, default=900)
    a = ap.parse_args(argv)
    folder, day = os.path.expanduser(a.dir), today()
    prompts, skipped = L.load_prompts()
    data = {"prompts": prompts, "skipped": skipped, "sessions": A.load_sessions()}
    claude_ok = os.path.exists(L.CLAUDE_BIN)
    # each set's plan as the files are now: the later sets' counts are what's new now, their inputs once the
    # earlier sets have run (a day reads its sessions' accounts) are made again just before each one runs
    stages = [Stage(n, folder, data, day) for n in CHAIN]
    ahead(stages)
    total = plan(stages, day, claude_ok, unread_transcripts(day))
    if not total or a.dry_run:
        return
    if not claude_ok:
        sys.exit(1)
    if not a.yes:
        if not sys.stdin.isatty():
            return print("\nNothing sent. Run it again with --yes to send it.")
        try:
            answer = input("\nSend these to Claude now? [y/N] ")
        except EOFError:
            answer = ""
        if not answer.strip().lower().startswith("y"):
            return print("Nothing sent.")
    jobs = max(1, min(L.MAX_JOBS, a.jobs))
    for name in CHAIN:
        s = Stage(name, folder, data, day)  # again: what the sets before it wrote changes its input
        if s.todo and not s.behind:
            s.run(jobs, a.timeout)
    print("\nLabels up to date. Wimym's page and the wimym command read them within a few minutes.")


if __name__ == "__main__":
    main()
