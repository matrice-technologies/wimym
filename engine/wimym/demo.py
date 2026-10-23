"""A made-up person, so Wimym can be shown with no real data at all.

    python3 engine/wimym/demo.py <folder>      # write the demo into folder (home/, data/, cache/)
    python3 engine/server.py --demo            # write it once into ~/.cache/wimym-demo, then serve it on 8997

Robin, a fictional founder, works with coding agents for about three months on four projects: loom (the
product), loom-web (its site and app), field-notes (a side project) and ledger-tools (a small tool that goes
quiet). Before the transcripts begin there are three weeks of prompts only (history.jsonl), as when Claude Code
had already deleted the older transcripts. There is a week off in the middle, a run of days without one since,
and a crunch in the last two weeks with late nights and more sessions at once.

Written under folder:
  home/.claude/projects/<folder>/<session>.jsonl   Claude Code transcripts (the lines scan.py reads)
  home/.claude/projects/<folder>/memory/*.md       a few memory notes
  home/.claude/history.jsonl                       the prompts-only weeks
  home/<project>/                                  small git repositories, with Claude as co-author and a teammate
  home/.gitconfig                                  who Robin is in git
  data/                                            labels (categories, signals, acts, sessions, days, weeks),
                                                   a practice, limits, check-ins
Everything is invented and kind; nothing comes from anyone's real record. The dates end today, so the demo
always looks current. Same seed, same person.
"""
import json
import os
import random
import subprocess
import sys
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

PERSON, EMAIL = "Robin Vale", "robin@loom.example"
TEAMMATE = ("Jordan Pike", "jordan@loom.example")
PROJECTS = ["loom", "loom-web", "field-notes", "ledger-tools"]
DAYS = 91           # days shown, ending today
PROMPTS_ONLY = 21   # the first days: history.jsonl only
OFF = (44, 50)      # days ago: the week off
CRUNCH = 14         # the last days: later, busier

THINGS = ["export to CSV", "search box", "invite flow", "rate limiter", "settings page", "weekly digest email",
          "offline mode", "onboarding checklist", "audit log", "dark theme", "billing webhook", "sync worker",
          "share link", "keyboard shortcuts", "import from files", "usage chart", "empty states", "retry queue"]
AREAS = ["importer", "sign-up page", "API", "dashboard", "sync job", "CLI", "editor", "billing page", "search",
         "notifications", "settings", "mobile layout"]
FILES = {"loom": ["src/sync/worker.ts", "src/api/routes.ts", "src/core/notes.ts", "src/core/search.ts", "test/sync.test.ts"],
         "loom-web": ["app/page.tsx", "app/pricing/page.tsx", "components/Hero.tsx", "components/Nav.tsx", "styles/site.css"],
         "field-notes": ["notes/cli.py", "notes/store.py", "notes/render.py", "tests/test_store.py", "README.md"],
         "ledger-tools": ["ledger/parse.py", "ledger/report.py", "ledger/cli.py", "tests/test_parse.py"]}

ASK = {
    "build": ["Add a {thing} to the {area}, with tests.", "Let's build the {thing}. Done means it works on a phone and has tests.",
              "Can you add a {thing}? Keep it small; we can grow it later.", "Next: the {thing} for the {area}. Follow the pattern in the {area2}."],
    "fix": ["The {area} breaks when the list is empty. Can you find out why and fix it?", "The {thing} shows the wrong date after midnight. Fix it, with a test.",
            "Something in the {area} got slow this week. Find it and make it fast again.", "Fix the flaky test in the {area}."],
    "question": ["How does the {area} decide what to show first?", "What would it take to support the {thing} offline?",
                 "Is there a simpler way to do the {thing}?", "Why did we keep two versions of the {area}?",
                 "What are the risks if we ship the {thing} this week?"],
    "go-ahead": ["yes", "ok, go ahead", "sounds good, go", "continue", "yes please", "do it", "great, keep going", "option 2"],
    "correct": ["No, that's not it: the {thing} should keep what people typed.", "That broke the {area}. Undo the last change and try again more carefully.",
                "Not quite. Keep the old {thing} and only change the wording.", "Wait, you changed the API too. Leave the API alone.",
                "This is the third try at the {thing}; slow down and read how the {area} works first."],
    "review": ["Review the diff before we merge, especially the {area}.", "Run the tests and tell me what fails.",
               "Check the {thing} on a small screen and tell me what looks off."],
    "plan": ["Before writing code, let's plan the {thing}. What are the options?", "Write a short plan for the {thing}, then wait for me.",
             "Think through how the {area} should work for teams. No code yet."],
    "design": ["Make the {area} calmer: more space, fewer borders.", "The {thing} looks crowded on a phone. Give it room.",
               "The headings on the {area} are too loud. Tone them down."],
    "ship": ["Commit and push.", "Open a PR for this.", "Merge it and deploy to staging.", "Ship it."],
    "answer": ["It's the staging database.", "Use the second option.", "The deadline is Friday.", "Teams of up to ten people.",
               "Keep both for now; we'll decide next week."],
    "setup": ["Remember that I want tests with every change.", "Add a note to CLAUDE.md: run the linter before committing."],
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
    def weights(self, ago):
        if ago < CRUNCH:
            return [5, 6, 1, 0]
        if ago < 30:
            return [6, 3, 2, 0.3]
        if ago < 60:
            return [6, 2, 3, 2]
        return [7, 1, 2, 3]

    def day_shape(self, d, ago):
        """None for a day off, else (start hour, end hour, blocks, sessions at once)."""
        r = self.r
        if OFF[0] <= ago <= OFF[1]:
            return None
        if ago > OFF[1] and d.weekday() == 6 and r.random() < .7:
            return None
        weekend = d.weekday() >= 5
        start = r.uniform(7.5, 9.5) + (1.5 if weekend else 0)
        end = r.uniform(19, 22) - (3 if weekend else 0)
        if ago < CRUNCH:
            end += r.uniform(1, 3.5)
        elif r.random() < .1:
            end += r.uniform(2, 4)
        at_once = 4 if ago < CRUNCH else 3
        return start, min(end, 25.5), r.randint(3, 6) - (2 if weekend else 0), at_once

    # -- one day ----------------------------------------------------------------------------------
    def day(self, d, ago, prompts_only):
        shape = self.day_shape(d, ago)
        if not shape:
            return
        start, end, blocks, at_once = shape
        r = self.r
        t = start
        span = (end - start) / max(1, blocks)
        for b in range(max(1, blocks)):
            b_start = start + b * span + r.uniform(0, .3)
            b_len = min(span * r.uniform(.5, .9), 2.5)
            projects = r.choices(PROJECTS, weights=self.weights(ago), k=r.choices(range(1, at_once + 1), weights=[2, 4, 3, 2][:at_once])[0] + 1)
            projects = list(dict.fromkeys(projects))
            sids = {p: str(uuid.UUID(int=r.getrandbits(128))) for p in projects}
            t = b_start
            convo = {p: [] for p in projects}
            while t < b_start + b_len:
                p = r.choice(projects)
                convo[p].append(t)
                t += r.uniform(1.5, 9) / 60
            for p in projects:
                if convo[p]:
                    self.session(d, p, sids[p], convo[p], prompts_only, ago)

    def stamp(self, d, hour, secs=0):
        local = datetime(d.year, d.month, d.day) + timedelta(hours=hour, seconds=secs)
        return local.astimezone(timezone.utc)

    def session(self, d, project, sid, hours, prompts_only, ago):
        r = self.r
        cwd = os.path.join(self.home, project)
        lines, last_reply_words, prev_end = [], 0, None
        intents = ["build", "fix", "question", "go-ahead", "correct", "review", "plan", "design", "ship", "answer", "setup"]
        base = [14, 8, 9, 16, 6, 5, 5, 4, 5, 4, 1]
        if ago < CRUNCH:
            base = [12, 12, 6, 20, 10, 4, 3, 4, 7, 3, 1]
        n = 0
        for h in hours:
            intent = "build" if n == 0 and r.random() < .6 else r.choices(intents, weights=base)[0]
            if n == 0 and intent in ("go-ahead", "correct", "answer"):
                intent = "plan"
            text = r.choice(ASK[intent]).format(thing=r.choice(THINGS), area=r.choice(AREAS), area2=r.choice(AREAS))
            if intent == "go-ahead" and r.random() < .15:
                text = r.choice(THANKS)
            at = self.stamp(d, h)
            if prev_end:  # after Claude's reply: sometimes a quick yes before it could be read
                quick = intent == "go-ahead" and last_reply_words > 60 and r.random() < (.45 if ago < CRUNCH else .25)
                at = max(at, prev_end + timedelta(seconds=r.randint(4, 25) if quick else r.randint(40, 300)))
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
                n += 1
                continue
            lines.append(self.user(mid, sid, cwd, at, text))
            reply, end, k = self.turn(lines, sid, cwd, at, intent, project, text, ago)
            last_reply_words, prev_end = len(reply.split()), end
            self.label(mid, intent, text, project, d, hour)
            n += 1
        if prompts_only or not lines:
            return
        folder = os.path.join(self.claude, "projects", cwd.replace("/", "-"))
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, sid + ".jsonl"), "a", encoding="utf-8") as f:
            f.writelines(lines)
        goal = self.r.choice(["Add the {thing}", "Fix the {area}", "Plan the {thing}", "Tidy the {area}"]).format(
            thing=self.r.choice(THINGS), area=self.r.choice(AREAS))
        outcome = self.r.choices(["landed", "partial", "answered", "abandoned"], weights=[6, 3, 2, 1])[0]
        self.sessions[sid] = {"h": "demo", "v": 2, "goal": goal + ".", "outcome": outcome, "decisions": [], "open": [],
                              "rework": outcome == "partial" and self.r.random() < .4, "rw": "", "people": [],
                              "account": f"{goal} in {project}; it ended {outcome}."}

    def user(self, mid, sid, cwd, at, text):
        return json.dumps({"type": "user", "uuid": mid, "sessionId": sid, "cwd": cwd, "entrypoint": "claude-desktop",
                           "timestamp": at.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "origin": {"kind": "human"},
                           "permissionMode": "default", "message": {"role": "user", "content": text}},
                          separators=(",", ":")) + "\n"

    def turn(self, lines, sid, cwd, at, intent, project, text, ago):
        """Claude's side of one turn: tools for work, a commit for shipping, a reply. Returns (reply, end, tools)."""
        r = self.r
        model = "claude-opus-5-5" if r.random() < .7 else "claude-sonnet-5-5"
        effort = r.choice(["high", "high", "xhigh", "medium"])
        t = at + timedelta(seconds=r.randint(3, 15))
        k = 0

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
        work = intent in ("build", "fix", "design", "correct")
        steps = r.randint(3, 14) if work else (r.randint(1, 4) if intent in ("question", "review", "plan") else r.randint(0, 3))
        if intent == "go-ahead":
            steps = r.randint(2, 10)
        edited = []
        for i in range(steps):
            tid = "toolu_" + uuid.UUID(int=r.getrandbits(128)).hex[:20]
            f = os.path.join(cwd, r.choice(FILES[project]))
            if work and i % 2 == 1:
                new = "\n".join(f"  line {j}" for j in range(r.randint(2, 30)))
                tool = {"type": "tool_use", "id": tid, "name": "Edit",
                        "input": {"file_path": f, "old_string": "  old\n  old", "new_string": new}}
                edited.append(f)
            elif i % 3 == 2:
                tool = {"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": "npm test" if project.startswith("loom") else "pytest -q"}}
            else:
                tool = {"type": "tool_use", "id": tid, "name": "Read", "input": {"file_path": f}}
            lines.append(a([tool], t))
            t += timedelta(seconds=r.randint(10, 90))
            lines.append(result(tid, t))
            k += 1
        committed = intent == "ship" or (work and edited and r.random() < .35) or (intent == "go-ahead" and edited and r.random() < .3)
        if intent == "ship" and not edited:
            edited = [os.path.join(cwd, r.choice(FILES[project]))]
        if committed:
            tid = "toolu_" + uuid.UUID(int=r.getrandbits(128)).hex[:20]
            msg = r.choice(["Add", "Fix", "Tidy", "Speed up", "Test"]) + " " + r.choice(THINGS + AREAS)
            lines.append(a([{"type": "tool_use", "id": tid, "name": "Bash",
                             "input": {"command": f'git add -A && git commit -m "{msg}"'}}], t))
            t += timedelta(seconds=r.randint(2, 8))
            lines.append(result(tid, t, "[main 1a2b3c4] " + msg))
            self.commits[project].append((t.timestamp(), msg, [os.path.relpath(f, cwd) for f in edited] or [FILES[project][0]],
                                          r.random() < .85))
        if r.random() < (.08 if ago < CRUNCH else .04) and steps > 2:
            lines.append(json.dumps({"type": "user", "uuid": str(uuid.UUID(int=r.getrandbits(128))), "sessionId": sid, "cwd": cwd,
                                     "timestamp": t.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                                     "message": {"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user]"}]}},
                                    separators=(",", ":")) + "\n")
            return "", t, k
        n = r.choice([1, 2, 3, 5, 8, 12, 18]) if intent != "question" else r.choice([6, 10, 16, 24])
        thing, area = r.choice(THINGS), r.choice(AREAS)
        reply = " ".join(r.choice(SAYS).format(thing=thing, area=area) for _ in range(n))
        if intent == "plan":
            reply = "Here is a plan in three steps. " + reply + " Shall I start with the first step?"
        t += timedelta(seconds=r.randint(5, 40))
        lines.append(a([{"type": "text", "text": reply}], t))
        return reply, t, k

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
        env = {"HOME": self.home, "PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1"}
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
        for i in range(DAYS):
            d = start + timedelta(days=i)
            self.day(d, (self.today - d).days, prompts_only=i < PROMPTS_ONLY)
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
        folder = os.path.join(self.claude, "projects", os.path.join(self.home, "loom").replace("/", "-"), "memory")
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
            json.dump({"stopHour": 22, "daysOffPerWeek": 1, "maxSessions": 3, "at": start + "T09:00:00"}, f, indent=1)
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


def ensure(root, seed=7):
    """Write the demo into root unless it is already there for today; returns root."""
    stamp = os.path.join(root, "demo.json")
    today = (datetime.now() - timedelta(hours=5)).date().isoformat()
    try:
        with open(stamp) as f:
            if json.load(f).get("today") == today:
                return root
    except (OSError, ValueError):
        pass
    import shutil
    for sub in ("home", "data", "cache"):
        shutil.rmtree(os.path.join(root, sub), ignore_errors=True)
    Writer(root, seed).write()
    with open(stamp, "w") as f:
        json.dump({"today": today, "seed": seed, "person": PERSON}, f)
    return root


if __name__ == "__main__":
    out = ensure(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.cache/wimym-demo")))
    print(out)
