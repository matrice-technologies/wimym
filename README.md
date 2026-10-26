# Wimym

Wimym, short for Where is your mind, is for people who work with agents on ambitious projects. It
reads your Claude Code transcripts, your prompt history and your git history, and shows you, against
your own usual, how your weeks are going for your health and your work: the hours, the nights, the
days in a row, how scattered or deep your attention was, what landed. A weekly retro then brings a
few moments worth looking at, you decide what to try, and the following weeks show whether it held.

Why it exists and where it is going: [VISION.md](VISION.md). How we get there: [STRATEGY.md](STRATEGY.md).

## Try it

```bash
./install.sh
```

On Windows 10 or 11, `.\install.cmd` in PowerShell, with the same options (`install.py` does the work on
every system; [site/setup.md](site/setup.md) has the Windows steps). It checks Python 3.9+ (and Node 18+
when the page needs building), builds the page, starts the
engine on http://127.0.0.1:8990 and opens it. The first build reads every transcript on the computer and
narrates as it goes; a few dozen transcripts take a second or two, months of them about half a minute.
Run it again any time: it only redoes what changed. `./install.sh --help` for the options, `--stop` to
stop the engine.

When a new version is out, the page says so. `./install.sh --update` gets it, says what changed,
rebuilds the page and restarts the engine onto it.

Or let Claude Code do the whole setup, a step at a time and asking before each change. Paste this
into Claude Code:

```
Set up Wimym on this computer for me. Read the guide with curl -fsSL https://wimym.matricetechnologies.com/setup.md and follow it step by step: say what each step does, and ask me before anything that changes my computer.
```

The guide it follows is [site/setup.md](site/setup.md): the checks, then one question, whether Wimym may
change your Claude Code setup (a year of transcripts and the `/wimym` and `/retro` skills, or nothing at
all), with the rest of the plan stated as defaults you can change. Then the steps without stopping, back
to you only for the price of the labels. If you say to leave your Claude Code setup as it is, nothing in
`~/.claude` is written and nothing offers to again; `wimym claude-setup` shows or changes that answer.

## What you see

- **This week**: your days as a planet, every message a light, the night side lit by the hours you
  worked after dark. Then the week as rings, one sentence on what stands out, and the vital signs:
  each one twelve weeks long, with your own range as a band, the ones outside it first.
- **The week**: the retro page. The days told in a few plain sentences, and the moments worth a
  question, each with its messages.
- **Days**, **Messages**: the film library. Every day as a score of its sessions; every message you
  sent, filtered by what it asks for, tone, model, effort, project, and opened whole with Claude's
  reply and the command to resume its session (`/messages/<id>`).
- **Practices**: what you decided to try, how it is going, and the instructions you keep giving the
  agents, as candidate rules.
- **Their view of you**: what agents have saved about you in memory, and which message taught each rule.
- **Labels**: what each model label means, how it was made and how far to trust it.
- **Explore**: the first, descriptive views (Portrait, How you lead, Your voice, Projects).

A share switch hides message text, project names and people's names everywhere, so the page can be
shown or screenshotted safely.

## Ask your own record

`bin/wimym` answers questions from a SQLite copy of everything the engine knows
(`~/.cache/wimym/wimym.db`, described in [docs/schema.md](docs/schema.md)):

```bash
bin/wimym week                    # last week's vital signs, days and moments
bin/wimym moments --about switches
bin/wimym show <message id>
bin/wimym sql "select day, active, night from day_vitals order by day desc limit 7"
bin/wimym rules                   # instructions you keep giving the agents
bin/wimym label --dry-run         # what labelling what's new would send and cost; --yes sends it
bin/wimym practice add …          # and practice list | check, log add | list, limits
bin/wimym claude-setup            # whether Wimym may offer changes to your Claude Code setup
```

Two Claude Code skills use it: `skills/wimym` answers open questions about yourself with the data in
context, and `skills/retro` runs the weekly retro. To use them, link them into `~/.claude/skills`
(see [docs/schema.md](docs/schema.md#the-skills)).

## Limits, at the moment

Set a stopping hour, days off a week or a ceiling on sessions at once, on the front page or with
`wimym limits`. `hooks/limits.py` then adds one line to Claude's context when one is crossed, and
`hooks/statusline.sh` shows today's hours and the days in a row. They aren't installed by default, and
never offered if you chose to leave your Claude Code setup as it is; [docs/hooks.md](docs/hooks.md) has
the settings to add.

## Where things live

- `engine/`: Python 3, standard library only. `wimym/scan.py` reads one transcript, `index.py` keeps
  every transcript's record in `~/.cache/wimym/index.json` (records of transcripts Claude Code deletes
  stay there: they're the only history of those sessions), `history.py` and `codex.py` add prompts
  from `~/.claude/history.jsonl` and Codex, the index also reads Cowork sessions, `gitlog.py` reads the
  repositories behind your working folders, `model.py` builds messages, sessions, days and weeks,
  `vitals.py` the vital signs and the week, `update.py` whether a newer Wimym is out, and `server.py`
  serves the page and `/api/*` on 127.0.0.1 only. Tests: `python3 -m unittest discover -s engine/tests`;
  CI (`.github/workflows/ci.yml`) runs them on Windows and Linux, then the installer for real (`.github/smoke.py`).
- `app/`: Vite, React and TypeScript, d3. `lab/`: the hero (three.js) and its prototypes.
- `labeller/`: model labels through your logged-in `claude` CLI (or TypeSafe's Jev for the message sets):
  what each message asks for and does, an account of each session and each day, and repeated instructions.
  Their wording, versions and measured accuracy are in [docs/labels.md](docs/labels.md); a label feeds a
  measure only once checked. `refresh.py` (`wimym label`) brings every set up to date with what's new, cost first.
- `~/.wimym/`: what you enter (check-ins, limits, practices, the growth log, retros) and the labels.
  Not a cache: keep it.
- `WIMYM_DATA`, `WIMYM_LABELS`, `WIMYM_CACHE` and `WIMYM_PORT` move these (the older `MIRROR_*` names
  still work). The project was first called Mirror; the engine moves `~/.mirror` and
  `~/.cache/mirror` to the new names on its first run and leaves links behind.
- The research notes (what was learned in claude-memory-map, the label audits) and the build sprint's
  notes quote real messages, so they live outside this repository, with the people who wrote them.

## Making changes

This repository, matrice-technologies/wimym, is the one copy: everyone who runs Wimym clones it, and
`main` is what they run. Work on a branch and open a pull request; merging it into `main` is the
release, and the next day every page says a new version is out. Give the pull request a title that
says the change in a sentence: `./install.sh --update` shows people those titles as what's new.

Wimym was first built in a local repository whose history quotes real messages; that history stays on
the Mac it was built on, on the branch `archive/mirror-main`, and never comes here. A branch started on
it moves across with `git rebase --onto origin/main archive/mirror-main <branch>`; a plain merge
refuses, because the two histories share no commit.

## Privacy

Wimym reads everything where it is, and sends nothing of yours anywhere itself. The server listens on
127.0.0.1, answers only requests whose `Host` is this machine, and takes input only as JSON from its
own page. Text leaves the Mac only when you run the labeller or ask Claude through the skills, and then
it goes to Claude, which saw it the first time, or to TypeSafe when you run the labeller with
`--engine jev`. Pull requests and reviews are read from GitHub, through your `gh` login, only if you
turn it on (`{"github": true}` in `~/.wimym/settings.json`, or `WIMYM_GITHUB=1`); it is off by default.

Once a day the engine asks the repository it was cloned from which version is the latest (`git ls-remote`,
with your own git login, and nothing of yours in the question), so the page can say when a newer one is
out. `{"updates": false}` in `~/.wimym/settings.json`, or `WIMYM_UPDATES=0`, turns that off; the demo
never asks, nor does a folder that isn't a clone.

`./install.sh --demo` runs Wimym on a made-up person (Robin Vale, on port 8997), with its own folders
under `~/.cache/wimym-demo`, so the whole page can be shown without anyone's real data. The share switch
does the same for your own page: it hides every piece of text and every name, and changes nothing.

## API

`GET /api/state` (first-run progress: [docs/contract-state.md](docs/contract-state.md)),
`/api/vitals` ([docs/contract-vitals.md](docs/contract-vitals.md)),
`/api/week?start=YYYY-MM-DD` ([docs/contract-week.md](docs/contract-week.md)), `/api/core`,
`/api/messages`, `/api/message/<id>`, `/api/sessions`, `/api/day/YYYY-MM-DD`, `/api/git`,
`/api/labels`, `/api/practices`, `/api/rules`, `/api/limits`. `POST /api/checkin` with
`{"day": "YYYY-MM-DD", "energy"|"mood"|"focus": 1-5 or null, "note": "…"}` and `POST /api/limits`
with `stopHour`, `daysOffPerWeek`, `maxSessions` or `priorities` (null clears one).
