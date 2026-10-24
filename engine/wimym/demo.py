"""A made-up person, so Wimym can be shown with no real data at all.

    python3 engine/wimym/demo.py <folder>      # write the demo into folder (home/, data/, cache/)
    python3 engine/server.py --demo            # write it once into ~/.cache/wimym-demo, then serve it on 8997

Robin, a fictional founder, works with coding agents for a month, every day, on nine projects, four to seven
of them on a given day with three to six sessions running at once: loom (the product), loom-web (its site and
app), loom-ios, loom-infra and loom-docs, then field-notes (a side project, busier at weekends), ledger-tools
(a small tool that goes quiet), talk-slides (a talk in the second half) and recipe-box (weekends). Before the
transcripts begin there is a week of prompts only (history.jsonl), as when Claude Code had already deleted the
older transcripts. Days run from about 08:40 to 22:40, with a dip at dinner and an evening stretch; one Sunday
mid-month is quiet, and the last five days are a crunch with later nights and more sessions at once. The
volumes, hours, pauses, message types and lengths follow the aggregate shape of a real month of agent work.

Written under folder:
  home/.claude/projects/<folder>/<session>.jsonl   Claude Code transcripts (the lines scan.py reads)
  home/.claude/projects/<folder>/memory/*.md       a few memory notes
  home/.claude/history.jsonl                       the prompts-only week
  home/<project>/                                  small git repositories, with Claude as co-author and a teammate
  home/.gitconfig                                  who Robin is in git
  data/                                            labels (categories, signals, acts, sessions, days, weeks),
                                                   a practice, limits, check-ins
Everything is invented and kind; nothing comes from anyone's real record. The dates end today, so the demo
always looks current. Same seed, same person.
"""
import json
import math
import os
import random
import re
import subprocess
import sys
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

PERSON, EMAIL = "Robin Vale", "robin@loom.example"
TEAMMATE = ("Jordan Pike", "jordan@loom.example")
DAYS = 37           # days shown, ending today
PROMPTS_ONLY = 7    # the first days: history.jsonl only
QUIET = 15          # days ago, about: the quiet Sunday (the nearest one before)
CRUNCH = 5          # the last days: later, busier
VERSION = 2         # how the demo is written: a new one is written once when this changes (2: Claude Code's folder names)

THINGS = ["export to CSV", "search box", "invite flow", "rate limiter", "settings page", "weekly digest email",
          "offline mode", "onboarding checklist", "audit log", "dark theme", "billing webhook", "sync worker",
          "share link", "keyboard shortcuts", "import from files", "usage chart", "empty states", "retry queue"]
AREAS = ["importer", "sign-up page", "API", "dashboard", "sync job", "CLI", "editor", "billing page", "search",
         "notifications", "settings", "mobile layout"]
# per project: files, its own areas and things (with the shared ones), and how its tests run
PROJ = {
    "loom": (["src/sync/worker.ts", "src/api/routes.ts", "src/core/notes.ts", "src/core/search.ts", "test/sync.test.ts"],
             ["sync job", "API", "search", "editor", "importer"], [], "npm test"),
    "loom-web": (["app/page.tsx", "app/pricing/page.tsx", "components/Hero.tsx", "components/Nav.tsx", "styles/site.css"],
                 ["pricing page", "landing page", "sign-up page", "dashboard", "mobile layout"], ["changelog page", "launch banner"], "npm test"),
    "loom-ios": (["Loom/NotesView.swift", "Loom/SyncClient.swift", "Loom/ShareSheet.swift", "LoomTests/SyncTests.swift"],
                 ["share sheet", "notes list", "offline cache", "widget", "settings screen"], ["push notifications", "home screen widget"],
                 "xcodebuild test -scheme Loom"),
    "loom-infra": (["deploy/staging.tf", "deploy/prod.tf", "scripts/deploy.sh", "scripts/backup.sh", ".github/workflows/ci.yml"],
                   ["deploy script", "staging cluster", "backups", "CI pipeline", "alerts"], ["nightly backup", "preview deploys"], "make check"),
    "loom-docs": (["docs/getting-started.md", "docs/sync.md", "docs/api.md", "docs/teams.md", "mkdocs.yml"],
                  ["getting-started guide", "API reference", "sync guide", "teams page"], ["migration guide", "FAQ"], "mkdocs build --strict"),
    "field-notes": (["notes/cli.py", "notes/store.py", "notes/render.py", "tests/test_store.py", "README.md"],
                    ["CLI", "store", "renderer"], ["tag filter", "markdown export"], "pytest -q"),
    "ledger-tools": (["ledger/parse.py", "ledger/report.py", "ledger/cli.py", "tests/test_parse.py"],
                     ["parser", "monthly report", "CLI"], ["CSV import", "currency totals"], "pytest -q"),
    "talk-slides": (["slides/talk.md", "slides/demo.md", "slides/theme.css", "notes/speaker.md"],
                    ["intro slides", "demo section", "speaker notes", "closing slide"], ["live demo script", "timing table"], "npm run build"),
    "recipe-box": (["box/app.py", "box/recipes.py", "box/templates/recipe.html", "tests/test_recipes.py"],
                   ["recipe page", "shopping list", "search"], ["scaling servings", "weekly menu"], "pytest -q"),
}
PROJECTS = list(PROJ)
FILES = {p: v[0] for p, v in PROJ.items()}
# how strongly each project pulls, before weights() shifts it with the week and the month
PULL = {"loom": 8.5, "loom-web": 4, "loom-ios": 3.5, "loom-infra": 2.2, "loom-docs": 2, "field-notes": 2,
        "ledger-tools": 1.5, "talk-slides": 2, "recipe-box": .4}
# hours of the day: how much of the work falls in each (a dip at dinner, an evening stretch)
HOURLY = {7: .7, 8: .85, 9: .95, 10: 1, 11: 1.15, 12: 1.05, 13: 1.05, 14: 1.2, 15: 1.4, 16: 1.25, 17: 1.1, 18: .7,
          19: .5, 20: .8, 21: 1.25, 22: 1.3, 23: 1, 24: .7, 25: .6}
# what Robin asks for, as a share of messages; a session's first message is drawn from FIRST
INTENTS = {"question": 28, "go-ahead": 15.5, "answer": 8, "build": 8, "design": 3.5, "fix": 1.5, "plan": 6, "review": 2,
           "ship": 11, "ops": 5.5, "setup": 1, "correct": 6.5}
CRUNCH_INTENTS = {**INTENTS, "question": 23, "go-ahead": 18, "correct": 8.5, "ship": 12, "fix": 4}
FIRST = {"question": 5, "build": 4, "plan": 2.5, "fix": 1.5, "design": 1, "ops": 1.5, "review": .5}
# how many words, per intent: (median, spread) of a log-normal
WORDS = {"build": (20, .85), "fix": (19, .8), "go-ahead": (2.6, .9), "correct": (17, .8), "question": (13, .6),
         "plan": (30, .85), "answer": (10, 1.05), "review": (21, .85), "ship": (5, .9), "design": (22, .85),
         "setup": (16, .55), "ops": (11, .7)}

ASK = {
    "build": ["Add a {thing} to the {area}, with tests.", "Let's build the {thing}. Done means it works on a phone and has tests.",
              "Can you add a {thing}? Keep it small; we can grow it later.", "Next: the {thing} for the {area}. Follow the pattern in the {area2}.",
              "Add the {thing}.", "Build a first version of the {thing} in the {area}.", "Wire the {thing} into the {area}.",
              "Let's do the {thing} now.", "Start on the {thing} for the {area}; a rough version is fine for today."],
    "fix": ["The {area} breaks when the list is empty. Can you find out why and fix it?", "The {thing} shows the wrong date after midnight. Fix it, with a test.",
            "Something in the {area} got slow this week. Find it and make it fast again.", "Fix the flaky test in the {area}.",
            "The {area} crashes on a fresh install. Find out why.", "The {thing} sends twice when you click fast. Fix it."],
    "question": ["How does the {area} decide what to show first?", "What would it take to support the {thing} offline?",
                 "Is there a simpler way to do the {thing}?", "Why did we keep two versions of the {area}?",
                 "What are the risks if we ship the {thing} this week?", "Where does the {area} get its data from?",
                 "Which tests cover the {area}?", "What changed in the {area} since last week?", "Why is this one so slow?",
                 "Can the {thing} and the {area} share code?", "What happens to the {thing} when the network drops?",
                 "Does anything else call this?", "How big is the change for the {thing}, roughly?", "What do you think?"],
    "go-ahead": ["yes", "ok", "go", "do it", "yes please", "ok, go ahead", "sounds good, go", "continue", "great, keep going",
                 "option 2", "yes, both", "go for it", "perfect, ship it", "yes, and add a test for the empty case too",
                 "ok, go with the simpler one", "looks right, carry on with the next step", "yes, but keep the old one behind a flag",
                 "yes, go ahead, and tell me when the tests are green", "ok, do the first two and leave the third for tomorrow"],
    "correct": ["No, that's not it: the {thing} should keep what people typed.", "That broke the {area}. Undo the last change and try again more carefully.",
                "Not quite. Keep the old {thing} and only change the wording.", "Wait, you changed the API too. Leave the API alone.",
                "This is the third try at the {thing}; slow down and read how the {area} works first.",
                "No. The {area} should not know about the {thing} at all.", "That's the wrong file: the {thing} lives in the {area2}."],
    "review": ["Review the diff before we merge, especially the {area}.", "Run the tests and tell me what fails.",
               "Check the {thing} on a small screen and tell me what looks off.", "Read through the {area} and list what you'd clean up."],
    "plan": ["Before writing code, let's plan the {thing}. What are the options?", "Write a short plan for the {thing}, then wait for me.",
             "Think through how the {area} should work for teams. No code yet.", "Plan the next two days of work on the {area}.",
             "Let's think about the {thing} before touching the {area}."],
    "design": ["Make the {area} calmer: more space, fewer borders.", "The {thing} looks crowded on a phone. Give it room.",
               "The headings on the {area} are too loud. Tone them down.", "Try a quieter colour for the {thing}.",
               "The {area} needs a clearer empty state."],
    "ship": ["Ship it.", "Commit and push.", "Open a PR for this.", "Merge it and deploy to staging.", "commit", "push",
             "Commit and push, then deploy it to staging so I can try it on my phone tonight.",
             "Open a PR, and in the description say what we left out on purpose and why.",
             "Merge it.", "Commit this and open a PR against main.", "Deploy to staging and tell me when it's up.",
             "Commit with a clear message, push, and open a PR for Jordan to review in the morning."],
    "answer": ["It's the staging database.", "Use the second option.", "The deadline is Friday.", "Teams of up to ten people.",
               "Keep both for now; we'll decide next week.", "staging", "the second one", "Friday", "no", "both",
               "The first one, it's simpler to explain to people.", "Ten people at most, and most teams are three or four.",
               "Yes, the old one can go once the new one has been on staging for a day."],
    "setup": ["Remember that I want tests with every change.", "Add a note to CLAUDE.md: run the linter before committing.",
              "Add to CLAUDE.md that the {area} has its own test helpers and should use them."],
    "ops": ["Restart the staging server and check the logs.", "Why is CI failing on main? Check the logs.", "Bump the node version in CI.",
            "Run the backup by hand and check it restores.", "Clean up the old preview deploys.", "Check the error rate on staging since the deploy."],
}
# what Robin adds to an ask to say more: for work, and for asking or planning
MORE = {
    "make": ["Keep it small; we can grow it later.", "Follow the pattern in the {area2}.", "Don't touch the API.", "It has to work on a phone too.",
             "Add tests for the empty case and a long list.", "Run the linter before you commit.", "Jordan will review it tomorrow, so keep the diff readable.",
             "If something is unclear, ask before guessing.", "We ship on Friday, so nothing risky.", "Use the existing helpers rather than new ones.",
             "Keep the old behaviour behind a flag.", "Write any decision you make in the PR description.", "Check how the {area2} handles the same case first.",
             "Keep the copy short and plain.", "No new dependencies.", "When you're done, tell me what you'd do next.", "Make sure it still works offline.",
             "Measure before and after, so we know it helped.", "Leave the database schema as it is.", "I'd rather have two small commits than one big one.",
             "People mentioned this twice this week.", "Start with the simplest version that works.", "Keep the naming in line with the {area2}.",
             "The error only happens after a fresh install.", "It started after yesterday's deploy.", "The screenshots are in the issue.",
             "Think about teams of up to ten people.", "Keyboard and screen readers matter here."],
    "ask": ["I want to understand it before we change anything.", "A short answer is fine.", "Point me to the files.", "Compare it with how the {area2} does it.",
            "Is that written down anywhere?", "What would you change first?", "No code yet.", "Be honest about the risks.",
            "Think about what happens with ten people on one team.", "I'm asking because the {thing} is next on the list.",
            "Explain the trade-offs in a few lines.", "Assume we ship on Friday.", "Keep it to the {area} for now."],
}
THANKS = ["Thanks, that's exactly it.", "Nice, this is much better.", "Perfect, thank you."]
SAYS = ["I read the {area} first to see how it fits together.", "The change is small and stays inside the {area}.",
        "I added tests for the empty case and for a long list.", "All tests pass locally.", "Nothing else depends on this code path.",
        "I kept the old behaviour behind a flag, so we can switch back.", "There is one open question about naming, below.",
        "The slow part was a query running once per item; it now runs once.", "I didn't touch the API.",
        "The page now has more space between sections, and the headings are one size smaller.",
        "I'd suggest shipping this on its own before the next change.", "If you prefer, I can split this into two commits.",
        "The {thing} now handles the case you described.", "I checked it on a narrow screen as well."]


class Writer:
    def __init__(self, root, seed=7, today=None):
        self.root = os.path.abspath(root)
        self.home = os.path.join(self.root, "home")
        self.claude = os.path.join(self.home, ".claude")
        self.data = os.path.join(self.root, "data")
        self.r = random.Random(seed)
        self.today = today or (datetime.now() - timedelta(hours=5)).date()
        self.now = datetime.now(timezone.utc) - timedelta(minutes=10)  # nothing written after this
        self.labels = {k: {} for k in ("categories", "signals", "acts")}
        self.sessions = {}
        self.day_msgs = defaultdict(list)    # day → [(id, intent, text, project, hour)]
        self.commits = defaultdict(list)     # project → [(epoch, message, files, coauthor)]
        self.history = []

    # -- shapes -------------------------------------------------------------------------------
    def weights(self, d, ago):
        """Each project's pull on day d: the side projects at weekends, ledger-tools fading, the talk in the second
        half, and the crunch on the launch (loom, its site, its app and its docs)."""
        w = dict(PULL)
        if d.weekday() >= 5:
            w["field-notes"] *= 2.5
            w["recipe-box"] = 3
            w["loom-infra"] *= .5
        if ago <= 22:
            w["ledger-tools"] *= .25
        w["talk-slides"] *= 0 if ago > 18 else .4 if ago < CRUNCH else 1
        if ago < CRUNCH:
            for p, x in {"loom": 1.2, "loom-web": 1.5, "loom-ios": 1.3, "loom-docs": 1.6, "field-notes": .4}.items():
                w[p] *= x
        return w

    def day_shape(self, d, ago, quiet):
        """(start hour, end hour, messages, sessions at once, the day's projects)."""
        r = self.r
        if quiet:
            return r.uniform(10, 11), r.uniform(16, 17.5), r.randint(26, 36), 2, ["field-notes", "recipe-box"]
        start = min(max(r.gauss(8.6, .45), 7.5), 10.2) + (.4 if d.weekday() >= 5 else 0)
        end = min(max(r.gauss(22.95, .45), 21.6), 23.8)
        n = r.lognormvariate(math.log(118), .28) * [.95, .95, 1, 1.05, 1.15, .95, .8][d.weekday()]
        at_once = r.choices([3, 4, 5, 6], weights=[3, 5, 3, 1])[0]
        if ago < CRUNCH:
            end, n, at_once = end + r.uniform(.4, 1.6), n * 1.2, at_once + 1
        w = self.weights(d, ago)
        names, chosen = [p for p in PROJECTS if w[p] > 0], []
        for _ in range(r.choices([4, 5, 6, 7], weights=[2, 3, 3, 2])[0]):  # weighted, without replacement
            p = r.choices(names, weights=[w[x] for x in names])[0]
            chosen.append(p)
            names.remove(p)
        return start, end, int(min(max(n, 55), 215)), at_once, chosen

    # -- one day ----------------------------------------------------------------------------------
    def day(self, d, ago, prompts_only, quiet=False):
        """Stretches of work with breaks between them; in each, a few sessions at once, Robin mostly staying with the one
        at hand, else going to whichever has waited longest; a session runs its course of messages and another opens,
        on one of the day's projects."""
        r = self.r
        start, end, n, at_once, chosen = self.day_shape(d, ago, quiet)
        w = self.weights(d, ago)
        stretches, t = [], start
        while t < end - .15:
            ln = min(r.lognormvariate(math.log(1.1), .45), end - t)
            stretches.append((t, t + ln))
            t += ln + r.lognormvariate(math.log(.55), .6)
        stretches[-1] = (stretches[-1][0], end)
        mass = [(b - a) * HOURLY.get(int((a + b) / 2), .6) for a, b in stretches]
        counts = Counter(r.choices(range(len(stretches)), weights=mass, k=n))
        counts[0] = max(counts[0], 1)                        # the day starts and ends where it should
        counts[len(stretches) - 1] = max(counts[len(stretches) - 1], 1)
        sessions, got, live = [], Counter(), []

        def open_one():
            p = r.choices(chosen, weights=[w[x] * (3 if got[x] < 5 else 1) for x in chosen])[0]
            s = {"p": p, "sid": str(uuid.UUID(int=r.getrandbits(128))), "hours": [],
                 "left": max(1, min(60, round(r.lognormvariate(math.log(7), .95))))}
            sessions.append(s)
            return s
        for i, (a, b) in enumerate(stretches):
            if not counts[i]:
                continue
            hours = sorted(r.uniform(a, b) for _ in range(counts[i]))
            if i == 0:
                hours[0] = a
            if i == len(stretches) - 1:
                hours[-1] = b
            live = [s for s in live if r.random() < .7]      # most sessions carry on after the break
            while len(live) < max(1, min(at_once + r.choice([-1, 0, 0, 1]), counts[i])):
                live.append(open_one())
            last = None
            for h in hours:
                ready = [s for s in live if not s["hours"] or h - s["hours"][-1] >= 1 / 60]
                x = r.random()
                s = (last if last in ready and x < .55 else r.choice(ready) if ready and x > .85
                     else min(ready or live, key=lambda s: s["hours"][-1] if s["hours"] else 0))
                last = s
                s["hours"].append(h)
                got[s["p"]] += 1
                s["left"] -= 1
                if s["left"] <= 0:
                    live.remove(s)
                    live.append(open_one())
        others = [p for p in PROJECTS if p not in chosen and w[p] > 0]
        if others and not quiet and r.random() < .5:         # a quick look at one more project
            a, b = r.choice(stretches)
            sessions.append({"p": r.choices(others, weights=[w[x] for x in others])[0], "sid": str(uuid.UUID(int=r.getrandbits(128))),
                             "hours": sorted(r.uniform(a, b) for _ in range(r.randint(1, 3)))})
        for s in sessions:
            if s["hours"]:
                self.session(d, s["p"], s["sid"], s["hours"], prompts_only, ago)

    def stamp(self, d, hour, secs=0):
        local = datetime(d.year, d.month, d.day) + timedelta(hours=hour, seconds=secs)
        return local.astimezone(timezone.utc)

    def text(self, intent, project):
        """What Robin types: one of the intent's asks, nearest the length drawn for it, with more said when it runs long."""
        r = self.r
        _, areas, things, _ = PROJ[project]
        loomish = project in ("loom", "loom-web")
        area_pool = sorted(set(areas + (AREAS if loomish else [])))
        thing_pool = things * 2 + (THINGS if loomish else ["empty states", "keyboard shortcuts", "dark theme", "search box", "settings page"])
        def fill(s):
            area, area2 = r.sample(area_pool, 2)
            return s.format(thing=r.choice(thing_pool), area=area, area2=area2)
        med, spread = WORDS[intent]
        target = max(1, round(r.lognormvariate(math.log(med), spread)))
        text = min(r.sample(ASK[intent], min(4, len(ASK[intent]))), key=lambda s: abs(len(s.split()) - target))
        if intent == "go-ahead" and r.random() < .1:
            return r.choice(THANKS)
        text = fill(text)
        more = (MORE["make"] + MORE["ask"] if intent == "plan" else MORE["ask"] if intent in ("question", "review")
                else MORE["make"] if intent not in ("go-ahead", "ship") else [])
        for extra in r.sample(more, len(more)):
            if len(text.split()) >= target - 2:
                break
            text += " " + fill(extra)
        return text

    def session(self, d, project, sid, hours, prompts_only, ago):
        r = self.r
        cwd = os.path.join(self.home, project)
        mix = CRUNCH_INTENTS if ago < CRUNCH else INTENTS
        intents = [r.choices(list(FIRST), weights=list(FIRST.values()))[0]] + r.choices(list(mix), weights=list(mix.values()), k=len(hours) - 1)
        quick_p = .45 if ago < CRUNCH else .25
        lines = []
        for i, h in enumerate(hours):
            intent = intents[i]
            text = self.text(intent, project)
            at = self.stamp(d, h)
            if at > self.now:
                break
            hour = at.astimezone().hour + at.astimezone().minute / 60
            hour = hour + 24 if hour < 5 else hour
            mid = str(uuid.UUID(int=r.getrandbits(128)))
            if prompts_only:
                self.history.append({"display": text, "pastedContents": {}, "timestamp": int(at.timestamp() * 1000),
                                     "project": cwd, "sessionId": sid})
                hid = f"h-{int(at.timestamp() * 1000)}-{sid[:8]}"
                self.label(hid, intent, text, project, d, hour)
                continue
            # how long Claude works: drawn, and over before Robin's next message here; sometimes a quick yes follows
            # a long reply, sent before it could be read
            dur = min(r.lognormvariate(math.log(75), 1.6), 2700)
            quick = False
            if i + 1 < len(hours):
                gap = (hours[i + 1] - h) * 3600
                quick = intents[i + 1] == "go-ahead" and gap < 1800 and r.random() < quick_p
                read = r.randint(4, 25) if quick else r.randint(15, 120)
                dur = max(3, gap - read) if quick else max(3, min(dur, gap - read))
            lines.append(self.user(mid, sid, cwd, at, text))
            self.turn(lines, sid, cwd, at, intent, project, ago, dur, quick)
            self.label(mid, intent, text, project, d, hour)
        if prompts_only or not lines:
            return
        folder = os.path.join(self.claude, "projects", folder_name(cwd))
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, sid + ".jsonl"), "a", encoding="utf-8") as f:
            f.writelines(lines)
        _, areas, things, _ = PROJ[project]
        goal = self.r.choice(["Add the {thing}", "Fix the {area}", "Plan the {thing}", "Tidy the {area}"]).format(
            thing=self.r.choice(things + THINGS), area=self.r.choice(areas))
        outcome = self.r.choices(["landed", "partial", "answered", "abandoned"], weights=[6, 3, 2, 1])[0]
        self.sessions[sid] = {"h": "demo", "v": 2, "goal": goal + ".", "outcome": outcome, "decisions": [], "open": [],
                              "rework": outcome == "partial" and self.r.random() < .4, "rw": "", "people": [],
                              "account": f"{goal} in {project}; it ended {outcome}."}

    def user(self, mid, sid, cwd, at, text):
        return json.dumps({"type": "user", "uuid": mid, "sessionId": sid, "cwd": cwd, "entrypoint": "claude-desktop",
                           "timestamp": at.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "origin": {"kind": "human"},
                           "permissionMode": "default", "message": {"role": "user", "content": text}},
                          separators=(",", ":")) + "\n"

    def turn(self, lines, sid, cwd, at, intent, project, ago, dur, long_reply=False):
        """Claude's side of one turn, over dur seconds: tools for work, a commit for shipping, a reply."""
        r = self.r
        model = "claude-opus-5-5" if r.random() < .7 else "claude-sonnet-5-5"
        effort = r.choice(["high", "high", "xhigh", "medium"])

        def a(content, when):
            return json.dumps({"type": "assistant", "uuid": str(uuid.UUID(int=r.getrandbits(128))), "sessionId": sid, "cwd": cwd,
                               "timestamp": when.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "effort": effort,
                               "message": {"id": "msg_" + uuid.UUID(int=r.getrandbits(128)).hex[:20], "role": "assistant",
                                           "model": model, "content": content,
                                           "usage": {"input_tokens": r.randint(200, 3000), "output_tokens": r.randint(150, 4000),
                                                     "cache_read_input_tokens": r.randint(10000, 90000)}}},
                              separators=(",", ":")) + "\n"

        def result(tid, when, out="ok"):
            return json.dumps({"type": "user", "uuid": str(uuid.UUID(int=r.getrandbits(128))), "sessionId": sid, "cwd": cwd,
                               "timestamp": when.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                               "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": out}]}},
                              separators=(",", ":")) + "\n"
        work = intent in ("build", "fix", "design", "correct", "ops")
        steps = r.randint(3, 14) if work else (r.randint(1, 4) if intent in ("question", "review", "plan") else r.randint(0, 3))
        if intent == "go-ahead":
            steps = r.randint(2, 10)
        steps = 0 if dur < 20 else min(steps, 2) if dur < 60 else steps + r.randint(5, 25) if dur > 600 else steps
        committed = intent == "ship" or (work and steps > 1 and r.random() < .35) or (intent == "go-ahead" and steps > 1 and r.random() < .3)
        # the turn's moments, spread over its length: the first call, each result and the next call, a commit, the reply
        slots = [r.uniform(.5, 1.5) for _ in range(2 * steps + 2 + committed)]
        unit, clock = timedelta(seconds=dur / sum(slots)), iter(slots)
        t = at + unit * next(clock)
        edited = []
        for i in range(steps):
            tid = "toolu_" + uuid.UUID(int=r.getrandbits(128)).hex[:20]
            f = os.path.join(cwd, *r.choice(FILES[project]).split("/"))
            if work and i % 2 == 1:
                new = "\n".join(f"  line {j}" for j in range(r.randint(2, 30)))
                tool = {"type": "tool_use", "id": tid, "name": "Edit",
                        "input": {"file_path": f, "old_string": "  old\n  old", "new_string": new}}
                edited.append(f)
            elif i % 3 == 2:
                tool = {"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": PROJ[project][3]}}
            else:
                tool = {"type": "tool_use", "id": tid, "name": "Read", "input": {"file_path": f}}
            lines.append(a([tool], t))
            t += unit * next(clock)
            lines.append(result(tid, t))
            t += unit * next(clock)
        if committed:
            edited = edited or [os.path.join(cwd, *r.choice(FILES[project]).split("/"))]
            tid = "toolu_" + uuid.UUID(int=r.getrandbits(128)).hex[:20]
            msg = r.choice(["Add", "Fix", "Tidy", "Speed up", "Test"]) + " " + r.choice(PROJ[project][2] + PROJ[project][1] + THINGS[:6])
            lines.append(a([{"type": "tool_use", "id": tid, "name": "Bash",
                             "input": {"command": f'git add -A && git commit -m "{msg}"'}}], t))
            t += unit * next(clock)
            lines.append(result(tid, t, "[main 1a2b3c4] " + msg))
            self.commits[project].append((t.timestamp(), msg, [os.path.relpath(f, cwd).replace(os.sep, "/") for f in edited], r.random() < .85))  # git wants /, on Windows too
        if r.random() < (.08 if ago < CRUNCH else .04) and steps > 2:
            lines.append(json.dumps({"type": "user", "uuid": str(uuid.UUID(int=r.getrandbits(128))), "sessionId": sid, "cwd": cwd,
                                     "timestamp": t.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                                     "message": {"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user]"}]}},
                                    separators=(",", ":")) + "\n")
            return
        n = r.choice([1, 2, 3, 5, 8, 12, 18]) if intent != "question" else r.choice([6, 10, 16, 24])
        n = max(n, 8) if long_reply else n
        thing, area = r.choice(PROJ[project][2] + THINGS), r.choice(PROJ[project][1])
        reply = " ".join(r.choice(SAYS).format(thing=thing, area=area) for _ in range(n))
        if intent == "plan":
            reply = "Here is a plan in three steps. " + reply + " Shall I start with the first step?"
        lines.append(a([{"type": "text", "text": reply}], at + timedelta(seconds=dur)))

    # -- labels -------------------------------------------------------------------------------
    def label(self, mid, intent, text, project, d, hour):
        r = self.r
        tone = "frustrated" if intent == "correct" and r.random() < .5 else "pleased" if text in THANKS else "neutral"
        self.labels["categories"][mid] = {"h": "demo", "v": 3, "in": intent, "to": tone, "sp": intent in ("build", "fix") and "Done means" in text or r.random() < .3,
                                          "ag": False}
        self.labels["signals"][mid] = {"h": "demo", "v": 3, "own": intent in ("plan", "build", "design") and r.random() < .5,
                                       "who": "alex" if intent in ("answer", "plan", "correct") else ("claude" if intent == "go-ahead" and r.random() < .3 else "open"),
                                       "sc": r.choice(["tweak", "task", "task", "project"]), "pr": hour > 22 and r.random() < .3,
                                       "irk": "claude" if tone == "frustrated" else "none", "pl": r.random() < .05}
        self.labels["acts"][mid] = {"h": "demo", "v": 2, "dec": intent in ("answer", "plan") and r.random() < .4, "dw": "",
                                    "dfr": "next week" in text, "fw": "", "ppl": "mention" if r.random() < .04 else "none", "names": [],
                                    "st": "tired" if hour > 23 and r.random() < .3 else "none", "off": "do" if intent in ("build", "fix") else "none",
                                    "rule": "tests with every change" if "Remember" in text else "", "dom": "work", "nd": False}
        self.day_msgs[d.isoformat()].append((mid, intent, text, project, hour))

    # -- the rest --------------------------------------------------------------------------------
    def repos(self):
        """One small repository per project, written in one `git fast-import` stream each (a second or two in all)."""
        env = {"HOME": self.home, "PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1",
               **{k: os.environ[k] for k in ("SYSTEMROOT", "TEMP", "TMP") if k in os.environ}}  # Windows needs these
        r = self.r
        for project in PROJECTS:
            cs = sorted(self.commits[project])
            if not cs:
                continue
            if project == "loom":  # a teammate's work on the product, every other day
                t0 = cs[0][0]
                for i in range(int((cs[-1][0] - t0) / 86400 / 2)):
                    cs.append((t0 + i * 2 * 86400 + r.randint(36000, 60000), "Teammate: " + r.choice(THINGS), [FILES[project][r.randint(0, 3)]], None))
                cs.sort()
            repo = os.path.join(self.home, project)
            os.makedirs(repo, exist_ok=True)
            subprocess.run(["git", "init", "-q", "-b", "main", repo], env=env, check=True)
            files, out, mark, main = {}, [], 0, None
            branch_at = len(cs) - r.randint(8, 15)

            def commit(ref, parent, when, msg, changed, coauthor):
                nonlocal mark
                mark += 1
                name, email = TEAMMATE if coauthor is None else (PERSON, EMAIL)
                off = datetime.fromtimestamp(when).astimezone().strftime("%z")
                body = (msg + ("\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" if coauthor else "") + "\n").encode()
                out.append(f"commit {ref}\nmark :{mark}\nauthor {name} <{email}> {int(when)} {off}\n"
                           f"committer {name} <{email}> {int(when)} {off}\ndata {len(body)}\n".encode() + body)
                if parent:
                    out.append(f"from :{parent}\n".encode())
                for f in changed:
                    old = files.get(f, [])
                    # now and then a rewrite: a few lines anywhere in the file go
                    kept = old if r.random() < .85 else [x for x in old if r.random() > r.uniform(.03, .1)]
                    files[f] = kept + [f"// {msg} {r.getrandbits(32):x}" for _ in range(r.randint(3, 30))]
                    blob = ("\n".join(files[f]) + "\n").encode()
                    out.append(f"M 100644 inline {f}\ndata {len(blob)}\n".encode() + blob + b"\n")
                out.append(b"\n")
                return mark
            for i, (when, msg, changed, coauthor) in enumerate(cs):
                if i == branch_at and main:  # a branch tried and left: two commits, never merged
                    tip = main
                    for k in range(2):
                        tip = commit("refs/heads/try/new-sync", tip, when - 3600 * (2 - k), "Try a new sync approach", [FILES[project][0]], True)
                main = commit("refs/heads/main", main, when, msg, changed, coauthor)
            subprocess.run(["git", "-C", repo, "fast-import", "--quiet"], input=b"".join(out), env=env, check=True)
            subprocess.run(["git", "-C", repo, "reset", "-q", "--hard", "main"], env=env, check=True)

    def accounts(self):
        """Day and week accounts, as the days and weeks label sets would write them."""
        days, weeks = {}, defaultdict(list)
        for d, ms in sorted(self.day_msgs.items()):
            if len(ms) < 6:
                continue
            by = defaultdict(list)
            for m in ms:
                by[m[1]].append(m)
            top = Counter(m[3] for m in ms).most_common(1)[0][0]
            last = max(m[4] for m in ms)
            ref = lambda m, t: {"t": t, "m": m[0]}
            a = {"h": "demo", "v": 3,
                 "decided": [ref(m, "Chose the simpler option for the " + self.r.choice(THINGS)) for m in by["answer"][:1] + by["plan"][:1]],
                 "dropped": [ref(m, "Dropped the first attempt at the " + self.r.choice(THINGS)) for m in by["correct"][:1]],
                 "postponed": [ref(m, "Left the " + self.r.choice(THINGS) + " for next week") for m in by["plan"][1:2]],
                 "high": [ref(m, "The " + self.r.choice(THINGS) + " landed") for m in by["ship"][:1]] +
                         [ref(m, "A clean fix, tests green") for m in by["go-ahead"][:1] if m[2] in THANKS],
                 "low": [ref(m, "A change had to be undone") for m in by["correct"][:2]],
                 "strain": f"The day ended late, at {int(last) % 24:02d}:{int(last % 1 * 60):02d}." if last >= 22.5 else "",
                 "account": f"Most of the day went to {top}, across {len(ms)} messages.", "cites": [m[0] for m in ms[:3]]}
            days[d] = a
            y, w, _ = date.fromisoformat(d).isocalendar()
            weeks[f"{y}-W{w:02d}"].append((d, ms, a))
        wk = {}
        for k, ds in weeks.items():
            ms = [m for _, x, _ in ds for m in x]
            top = Counter(m[3] for m in ms).most_common(2)
            lows = [r for _, _, a in ds for r in a["low"]]
            highs = [r for _, _, a in ds for r in a["high"]]
            late = sum(1 for _, _, a in ds if a["strain"])
            wk[k] = {"h": "demo", "v": 1,
                     "account": (f"Robin sent {len(ms)} messages over {len(ds)} days, mostly on {top[0][0]}"
                                 + (f" and {top[1][0]}" if len(top) > 1 else "") + "."
                                 + (f" {late} days ended late." if late else " The days ended at a steady hour.")),
                     "decided": [r for _, _, a in ds for r in a["decided"]][:4], "dropped": [r for _, _, a in ds for r in a["dropped"]][:2],
                     "postponed": [r for _, _, a in ds for r in a["postponed"]][:2], "open": ["The " + self.r.choice(THINGS) + " is half done."],
                     "strain": f"{late} late evenings." if late else "",
                     "moments": (lows[:1] + highs[:1] + [r for _, _, a in ds for r in a["decided"]][:1])[:3], "cites": []}
        return days, wk

    def write(self):
        start = self.today - timedelta(days=DAYS - 1)
        quiet = self.today - timedelta(days=QUIET)
        quiet -= timedelta(days=(quiet.weekday() + 1) % 7)   # the Sunday before
        for i in range(DAYS):
            d = start + timedelta(days=i)
            self.day(d, (self.today - d).days, prompts_only=i < PROMPTS_ONLY, quiet=d == quiet)
        os.makedirs(self.claude, exist_ok=True)
        with open(os.path.join(self.claude, "history.jsonl"), "w", encoding="utf-8") as f:
            for e in sorted(self.history, key=lambda e: e["timestamp"]):
                f.write(json.dumps(e) + "\n")
        with open(os.path.join(self.home, ".gitconfig"), "w") as f:
            f.write(f"[user]\n\tname = {PERSON}\n\temail = {EMAIL}\n[init]\n\tdefaultBranch = main\n")
        self.repos()
        self.memory()
        labels = os.path.join(self.data, "labels")
        os.makedirs(labels, exist_ok=True)
        days, weeks = self.accounts()
        sets = {"categories": (3, self.labels["categories"]), "signals": (3, self.labels["signals"]), "acts": (2, self.labels["acts"]),
                "sessions": (2, self.sessions), "days": (3, days), "weeks": (1, weeks)}
        for name, (v, labs) in sets.items():
            with open(os.path.join(labels, name + ".json"), "w", encoding="utf-8") as f:
                # made-up labels for a made-up person: marked checked, so the measures that need them show
                json.dump({"version": v, "labels": labs, "calls": [], "runs": [], "demo": True, "checked": True}, f)
        self.person_data()

    def memory(self):
        folder = os.path.join(self.claude, "projects", folder_name(os.path.join(self.home, "loom")), "memory")
        os.makedirs(folder, exist_ok=True)
        notes = {"tests-with-every-change": ("feedback", "Robin wants tests with every change", "Add or update tests in the same commit as the change."),
                 "robin-role": ("user", "Robin is the founder and main engineer of Loom", "Works alone with agents most days; one teammate, Jordan."),
                 "calm-design": ("feedback", "Robin prefers calm layouts", "More space, fewer borders, quieter headings.")}
        for name, (typ, desc, body) in notes.items():
            with open(os.path.join(folder, name + ".md"), "w") as f:
                f.write(f"---\nname: {name}\ndescription: {desc}\ntype: {typ}\n---\n\n{body}\n")

    def person_data(self):
        os.makedirs(self.data, exist_ok=True)
        start = (self.today - timedelta(days=10)).isoformat()
        with open(os.path.join(self.data, "limits.json"), "w") as f:
            json.dump({"stopHour": 22, "daysOffPerWeek": 1, "maxSessions": 5, "at": start + "T09:00:00"}, f, indent=1)
        with open(os.path.join(self.data, "practices.json"), "w") as f:
            json.dump({"practices": [{"id": "stop-at-22", "text": "Stop by 22:00 on weekdays, and write tomorrow's first step before stopping.",
                                      "owner": "person", "measure": "late", "target": "<= 30", "start": start, "trial": 14,
                                      "status": "trying", "verdicts": [], "why": "Late evenings in the crunch weeks."}]}, f, indent=1)
        with open(os.path.join(self.data, "log.jsonl"), "w") as f:
            f.write(json.dumps({"at": start + "T09:05:00", "kind": "practice", "text": "Started: stop by 22:00 on weekdays.", "practice": "stop-at-22"}) + "\n")
            f.write(json.dumps({"at": start + "T09:00:00", "kind": "limit", "text": "Limit stopHour: 22"}) + "\n")
        checks = {}
        for i in range(1, 15, 2):
            d = (self.today - timedelta(days=i)).isoformat()
            checks[d] = {"energy": self.r.randint(2, 4), "mood": self.r.randint(2, 5), "focus": self.r.randint(2, 4),
                         "at": d + "T21:00:00"}
        with open(os.path.join(self.data, "checkins.json"), "w") as f:
            json.dump({"days": checks}, f, indent=1)


def folder_name(path):
    """Claude Code's name for a working folder's transcripts folder, on a Mac or Windows (memory.folder_name)."""
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def ensure(root, seed=7):
    """Write the demo into root unless it is already there for today; returns root."""
    stamp = os.path.join(root, "demo.json")
    today = (datetime.now() - timedelta(hours=5)).date().isoformat()
    try:
        with open(stamp) as f:
            kept = json.load(f)
            if kept.get("today") == today and kept.get("v") == VERSION:
                return root
    except (OSError, ValueError):
        pass
    import shutil
    for sub in ("home", "data", "cache"):
        shutil.rmtree(os.path.join(root, sub), ignore_errors=True)
    Writer(root, seed).write()
    with open(stamp, "w") as f:
        json.dump({"today": today, "v": VERSION, "seed": seed, "person": PERSON}, f)
    return root


if __name__ == "__main__":
    out = ensure(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.cache/wimym-demo")))
    print(out)
