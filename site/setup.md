# Setting up Wimym: the guide for Claude Code

You are Claude Code, and the person you are working with pasted a prompt asking you to set up Wimym on
their Mac. This page is that setup, written for you. Read all of it before you start.

Wimym, short for Where is your mind, reads the person's Claude Code transcripts, prompt history and git
history on their Mac, and shows them, against their own usual, how their weeks are going for their
health and their work. It runs a small local engine on 127.0.0.1 and sends nothing of theirs anywhere
itself. Once a day it asks GitHub whether a newer Wimym is out, with nothing of theirs in the question;
`{"updates": false}` in `~/.wimym/settings.json` turns that off.
What it shows: https://wimym.matricetechnologies.com

## How to work

- **One step at a time, in order.** Before each step, say in one or two sentences what it does and why,
  then do it. Steps marked *optional* are offers: ask, and skip them on anything but a yes.
- **Ask before anything that changes the Mac outside the Wimym folder**: the backup, installing
  software, linking commands or skills, editing `~/.claude/settings.json`. Running `./install.sh`
  inside the Wimym folder is what they asked for; the steps say where to ask anyway.
- **Never** use sudo, delete or move anything in `~/.claude`, print or quote the person's transcripts,
  enter a password or token for them, or change a setting they did not agree to. Wimym only reads
  `~/.claude`; this setup only reads it too, except for the settings edits the person approves.
- **When something fails, stop.** Show the error's last lines, say what you think it means, and ask
  before trying something else. Don't work around a check the installer makes.
- **Keep a list as you go** of everything you created or changed, with how to undo it. You give it to
  the person at the end.
- The person may not be a developer. Plain words; commands only when they help.

Shell commands below assume zsh or bash on macOS. `WIMYM` stands for the Wimym folder (step 3).

## 1. Check the Mac

Run these and report the results in one short paragraph:

```bash
uname -s; sw_vers -productVersion
python3 -V; node -v; npm -v; git --version; gh --version | head -1
ls -d ~/.claude/projects && find ~/.claude/projects -name '*.jsonl' | wc -l
df -h ~ | tail -1; du -sh ~/.claude
```

- **macOS** is required. On another system, stop and say so: Wimym is built and tested on macOS only.
- **Python 3.9 or later** runs the engine. **Node 18 or later** builds the page once. If either is
  missing or too old, say so and offer `brew install python` or `brew install node` (if `brew` is
  there; otherwise point to python.org and nodejs.org). Install only on a yes.
- **Transcripts**: if `~/.claude/projects` is missing or empty, Wimym will start and show nothing yet.
  Say so; the person can still go on, and try the demo in step 4.

## 2. Back up ~/.claude

`~/.claude` is the person's whole history with Claude Code: every transcript and every memory note
their agents keep about them. Wimym only reads it, but it is young software, and that folder is worth
more than any tool. Recommend a copy before anything else, and ask.

On a yes, check there is room (the size from step 1 against the free space), then:

```bash
mkdir -p ~/Backups
ditto ~/.claude ~/Backups/claude-$(date +%Y-%m-%d)
du -sh ~/.claude ~/Backups/claude-$(date +%Y-%m-%d)
```

Show the two sizes; they should be close. If the person says no, go on.

Then the retention setting. Claude Code deletes transcripts older than 30 days on its own unless
`cleanupPeriodDays` in `~/.claude/settings.json` says otherwise, and Wimym can only show what is
kept. Read the file and tell the person the current value (or that it is not set, which means 30).
Offer to set it to 365, or a number they choose. On a yes: copy the file first to
`~/.claude/settings.json.before-wimym` (if that copy doesn't exist yet), change only that one key,
keep everything else as it was, and check the file still parses with
`python3 -m json.tool ~/.claude/settings.json > /dev/null`.

## 3. Get the code

Wimym is shared by invitation, in the private GitHub repository `matrice-technologies/wimym`.

First look for a copy already on the Mac: a folder holding `install.sh`, `bin/wimym` and
`engine/server.py`, such as `~/wimym`. If there is one, that is `WIMYM`: update it with
`git -C WIMYM pull --ff-only` (if the pull fails because of local changes, say so and leave it).

Otherwise ask where to put it (`~/wimym` unless they want somewhere else) and clone it:

```bash
git clone https://github.com/matrice-technologies/wimym.git ~/wimym
```

If the clone fails with "Repository not found", "Authentication failed" or a prompt for a password:

- Run `gh auth status`. If the person is logged in, tell them the GitHub account name and that it
  needs to be invited to the repository by whoever shared Wimym with them. Once they accept the
  invitation (from the e-mail, or github.com/notifications), try again; with `gh` logged in,
  `gh repo clone matrice-technologies/wimym ~/wimym` uses that login.
- If `gh` is missing or logged out, the person can sign in with `gh auth login` in their own
  terminal (installed with `brew install gh`). Don't run the login for them and don't handle tokens:
  it is theirs to type.
- Then stop and wait. Nothing else in this guide works without the code.

## 4. Try the demo first (optional)

Offer it: the whole page on Robin, a made-up person, before Wimym reads anything of the person's.
It runs on port 8997 with its own folders under `~/.cache/wimym-demo`, and none of their data is read.

```bash
cd WIMYM && ./install.sh --demo
```

The first run installs the page's packages and builds it, about a minute or two; use a long timeout
(10 minutes) for the command. It opens http://127.0.0.1:8997 in the browser. Wait for the person to
say they have seen enough, then stop it with `./install.sh --demo --stop`.

## 5. Run Wimym on their own record

This is the step that reads the person's transcripts, so say that plainly before you run it: it reads
`~/.claude/projects`, `~/.claude/history.jsonl` and the git history of the folders they work in, all on
this Mac, and writes only inside `WIMYM` (the built page), `~/.wimym` (what they enter later: keep it)
and `~/.cache/wimym` (an index it can rebuild).

```bash
cd WIMYM && ./install.sh --no-link
```

Long timeout again. It starts the engine on http://127.0.0.1:8990 and opens it; the first read
narrates on the page as it goes, from a few seconds to about half a minute for months of transcripts.
If port 8990 is taken it says so: rerun with `--port 8991`, and use that port from then on.

Check it answered: `curl -s http://127.0.0.1:8990/api/state | head -c 300`. Point the person to the page:
the planet is their days, every message a light; **This week** comes first, **The week** is the retro.

## 6. The wimym command (optional)

Offer to link the `wimym` command, which answers questions from a local copy of everything Wimym
knows (`wimym week`, `wimym moments --about switches`, `wimym rules`). The skills in step 7 need it.

```bash
cd WIMYM && ./install.sh --link --no-open
command -v wimym || echo "not on PATH"
```

If `~/.local/bin` is not on the PATH, offer to add `export PATH="$HOME/.local/bin:$PATH"` to
`~/.zshrc` (or the profile of their shell), on a yes. Then try `~/.local/bin/wimym week` and show the
first lines.

## 7. The two skills (optional)

Offer them: `/wimym` answers open questions about the person with their own data in context, and
`/retro` runs the weekly retro. They need the `wimym` command from step 6.

```bash
mkdir -p ~/.claude/skills
ls -la ~/.claude/skills/wimym ~/.claude/skills/retro 2>/dev/null
```

If either name is already taken by something that isn't a link into `WIMYM`, stop and ask; don't
replace it. Otherwise:

```bash
ln -sfn WIMYM/skills/wimym ~/.claude/skills/wimym
ln -sfn WIMYM/skills/retro ~/.claude/skills/retro
```

They load in new Claude Code sessions: `/wimym Am I more scattered on days I start before 7?`, or
`/retro` once a week.

## 8. Limits that speak in Claude Code (optional)

Wimym can add one plain line to Claude's context when the person crosses a limit they set (a stopping
hour, days off a week, sessions at once), and show today's hours in the status line. It stays silent
otherwise, says the same thing at most once every 30 minutes in a session, and never blocks a prompt.

Offer it. On a yes, ask which limits they want; set them with the command, for example
`wimym limits set stopHour 21.5` (21:30; under 5 means after midnight), `wimym limits set daysOffPerWeek 1`,
`wimym limits set maxSessions 4`. Then show what the hook would say now:

```bash
python3 WIMYM/hooks/limits.py --check
python3 WIMYM/hooks/limits.py --status
```

To turn it on, these entries go into `~/.claude/settings.json`, with `WIMYM` written out as the full
path:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "python3 WIMYM/hooks/limits.py", "timeout": 5 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "python3 WIMYM/hooks/limits.py", "timeout": 5 }] }
    ]
  },
  "statusLine": { "type": "command", "command": "WIMYM/hooks/statusline.sh" }
}
```

Merge, never replace: keep every hook already there and add these two entries to their lists (skip
one that is already present). If a `statusLine` already exists, show it and ask whether to swap in
Wimym's (`9h35 today · 85 days in a row`); keep theirs unless they say so. Back up the file to
`~/.claude/settings.json.before-wimym` first if that copy doesn't exist, show the person the change
before writing it, write it on their yes, and check it parses with `python3 -m json.tool`.

## 9. Labels (optional, uses their Claude plan)

Some of what Wimym shows (tone, strain, what each message asks for) comes from a model reading the
person's words. The labeller sends their messages to Claude Haiku through their own logged-in `claude`
command, which counts against their plan. Say so, then show how much it would read, without sending
anything:

```bash
cd WIMYM && python3 labeller/label.py --dry-run
```

Only on a clear yes, and then in the background since it can take a while:

```bash
cd WIMYM && python3 labeller/label.py --all
```

The **Labels** page shows what each label means and how far it has been checked.

## 10. Wrap up

Give the person a short summary:

- Where Wimym is: http://127.0.0.1:8990 (or the port used), and `WIMYM` for the code.
- The list you kept: everything created or changed, each with how to undo it (remove the links,
  restore `~/.claude/settings.json.before-wimym`, delete `~/.cache/wimym`; `~/.wimym` holds what
  they enter, so only on purpose).
- Day to day: `cd WIMYM && ./install.sh` starts it again after a restart and only redoes what changed;
  `./install.sh --stop` stops it. To update: `cd WIMYM && ./install.sh --update`, which says what is new
  and restarts Wimym onto it. The page says when a new version is out; `WIMYM/CHANGES.md` lists them all.
- The retro is the heart of it: once a week, `/retro` (with the skills) or **The week** on the page.

Wimym shows signs and diagnoses nothing; it is not a clinical tool.
