# Setting up Wimym: the guide for Claude Code

You are Claude Code, and the person you are working with pasted a prompt asking you to set up Wimym on
their computer: a Mac, or a Windows 10 or 11 PC. This page is that setup, written for you. Read all of it
before you start.

Wimym, short for Where is your mind, reads the person's Claude Code transcripts, prompt history and git
history on their computer, and shows them, against their own usual, how their weeks are going for their
health and their work. It runs a small local engine on 127.0.0.1 and sends nothing of theirs anywhere
itself. Once a day it asks GitHub whether a newer Wimym is out, with nothing of theirs in the question;
`{"updates": false}` in `~/.wimym/settings.json` turns that off.
What it shows: https://wimym.matricetechnologies.com

## How to work

- **One step at a time, in order.** Before each step, say in one or two sentences what it does and why,
  then do it. Steps marked *optional* are offers: ask, and skip them on anything but a yes.
- **Ask before anything that changes the computer outside the Wimym folder**: the backup, installing
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
- **Claude Code asks too.** Besides the questions this guide has you ask, Claude Code shows its own
  permission prompts before some commands and edits. Tell the person at the start, so a second
  question for the same step doesn't surprise them.

Shell commands below assume zsh or bash on macOS. On Windows, follow the same steps with the commands in
**On Windows** at the end of this page. `WIMYM` stands for the Wimym folder (step 3).

## 1. Check the computer

Run these and report the results in one short paragraph:

```bash
uname -s; sw_vers -productVersion
python3 -V; node -v; npm -v; git --version; gh --version | head -1
ls -l ~/.local/bin/claude; command -v claude
ls -d ~/.claude/projects && find ~/.claude/projects -name '*.jsonl' | wc -l
df -h ~ | tail -1; du -sh ~/.claude
```

- **macOS**, or **Windows 10 or 11** (then use **On Windows** below for every step). Linux, and Claude
  Code inside WSL on Windows, run the commands here as they are, with the distribution's own packages for
  Python and Node in place of `brew`; Wimym there reads the transcripts of the Claude Code inside Linux.
  On anything else, stop and say so.
- **Python 3.9 or later** runs the engine. **Node 18 or later** builds the page once. If either is
  missing or too old, say so and offer `brew install python` or `brew install node` (if `brew` is
  there; otherwise point to python.org and nodejs.org). Install only on a yes.
- **Transcripts**: if `~/.claude/projects` is missing or empty, Wimym will start and show nothing yet.
  Say so; the person can still go on, and try the demo in step 4.
- **The `claude` command**: the labels in step 9 run it, from `~/.local/bin/claude` (where Claude Code's
  installer puts it) or else from the PATH (`command -v claude`). If there is none at all, everything else
  still works; only the labels need it.

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

First look for a copy already on the computer: a folder holding `install.sh`, `bin/wimym` and
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
this computer, and writes only inside `WIMYM` (the built page), `~/.wimym` (what they enter later: keep it)
and `~/.cache/wimym` (an index it can rebuild).

```bash
cd WIMYM && ./install.sh --no-link
```

Long timeout again. It starts the engine on http://127.0.0.1:8990 and opens it; the first read
narrates on the page as it goes, from a few seconds to about half a minute for months of transcripts.
If port 8990 is taken it says so: rerun with `--port 8991`, and use that port from then on.

Check it answered: `curl -s http://127.0.0.1:8990/api/state | head -c 300`. Point the person to the page:
the planet is their days, every message a light; **This week** comes first, **The week** is the retro.

Tell them, too, that the first month will look thin. Claude Code keeps about 30 days of transcripts unless
step 2 changed that, so Wimym starts with about four weeks. A week is compared with the weeks before it:
the usual range appears only once there are four earlier weeks, and a row is flagged only when two weeks
in a row fall outside it. So for the first weeks most rows show numbers with no range and no flags, and
"against your own usual" fills in over the next month or two. A longer `cleanupPeriodDays` only keeps
transcripts from now on; it can't bring back ones already deleted.

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

Tell them what happens after a restart. Wimym doesn't start at login: until `./install.sh` runs again,
the engine is off, and the status line and the hook read what it last wrote. They go quiet without
saying why: the status line shows no hours for today, and its count of days in a row stops keeping
up. The stopping hour and the sessions at once still speak, since they don't need the engine.

## 9. Labels (optional)

Some of what Wimym shows (tone, strain, what each message asks for) comes from a model reading the
person's words. Before asking whether they want it, tell them what this step gives:

- **Labels on each message**: what it asks for, and with Jev also its tone and what it does. The vital
  signs count a label only once a second judge has checked its version. Today that is what each message
  asks for, with either way below, and tone and what it does with Jev. That fills strain, corrections and
  the other rows that say they wait for labels.
- **The accounts**: a few written sentences for each session, each day and each week, and the
  instructions they keep repeating, grouped. Claude Opus writes those on their plan, whichever way they
  pick below. **The week** page tells the days from them, and `/retro` reads them.

Ask whether they want the labels at all; skip the step on anything but a yes. Then there are two ways
to label the messages, and the person picks:

- **Jev, with their own TypeSafe key.** TypeSafe's Jev reads each message and picks the labels. It takes
  minutes and costs cents to a few dollars on their TypeSafe account, and their messages go to TypeSafe.
  Jev picks but doesn't write, so a few written details stay empty (what was decided, who was named, the
  rules they repeat). Its main labels were checked by a second judge, so the vital signs count them, tone
  included.
- **Haiku, on their Claude plan.** The labeller sends their messages to Claude Haiku through their own
  logged-in `claude` command, which counts against their plan and can take an hour or more the first time.
  It writes the details Jev leaves empty, and its main labels are checked too (not tone).

**If they choose Jev**, they need a key from https://console.typesafe.ai. The key is theirs to type: never
ask them to paste it into this conversation, and never type it for them. Ask them to run this in a terminal
of their own (it needs one to ask for the key), and tell you when it says the key is kept:

```bash
cd WIMYM && python3 labeller/label.py --key
```

It asks for the key without showing it, checks it with TypeSafe, and keeps it in `~/.wimym/typesafe.key`,
readable by them only; from then on the labeller uses Jev. Check it is there with
`test -f ~/.wimym/typesafe.key && echo kept`, never by reading it, and add it to your list (undo: delete the
file, and the labeller goes back to Haiku). If they change their mind, go on with Haiku.

**Either way**, one command does the whole chain: the message labels, then the accounts, each set in the
order it builds on the others, and only on what is new since the last run. Today is left out, and so is
the week in progress: they would only be written again later. First show what it would send and what it
would cost, without sending anything:

```bash
cd WIMYM && python3 labeller/refresh.py --dry-run
```

(With the `wimym` command from step 6, `wimym label --dry-run` is the same.) Tell the person, in a line or
two, what it lists and the total it gives: a list price, which on Claude counts against their plan's usage
and on Jev is billed to their key. If it says the `claude` command can't be found, the accounts (and Haiku)
can't run: say so, and stop the step there.

Only on a clear yes, run it in the background with a long timeout:

```bash
cd WIMYM && python3 labeller/refresh.py --yes
```

Run without `--yes`, it only shows the plan again, since it asks before sending and there is no terminal to
ask in. A rerun only does what is still missing, so if it stops part way, running it again picks up from
there. The **Labels** page shows what each label means and how far it has been checked.

## 10. Wrap up

Give the person a short summary:

- Where Wimym is: http://127.0.0.1:8990 (or the port used), and `WIMYM` for the code.
- The list you kept: everything created or changed, each with how to undo it (remove the links,
  restore `~/.claude/settings.json.before-wimym`, delete `~/.cache/wimym`; `~/.wimym` holds what
  they enter, so only on purpose).
- Day to day: Wimym doesn't start at login. After a restart the page doesn't open, and the status
  line and the hook quietly fall behind, until `cd WIMYM && ./install.sh` starts it again (it only
  redoes what changed); `./install.sh --stop` stops it. To update: `cd WIMYM && ./install.sh --update`,
  which says what is new and restarts Wimym onto it. The page says when a new version is out.
- The retro is the heart of it: once a week, `/retro` (with the skills) or **The week** on the page.
  With the labels from step 9, `/retro` first offers to label the week's new work, with its cost; any
  other time, `wimym label` (or `python3 labeller/refresh.py`) does the same.
- The first month is thin: the usual range needs four earlier weeks, and a flag two weeks running
  outside it, so it fills in over the next month or two.

Wimym shows signs and diagnoses nothing; it is not a clinical tool.

## On Windows

Wimym runs natively on Windows 10 and 11, where Claude Code keeps its transcripts in
`%USERPROFILE%\.claude\projects`. The steps are the same; these are their commands, for PowerShell. If your
shell is Git Bash, run each one with `powershell -NoProfile -Command "…"`. `install.cmd` takes every
option `./install.sh` does. After installing anything with `winget`, open a new terminal (or start a new
Claude Code session) so the PATH has it.

1. **Check the computer.**

   ```powershell
   [Environment]::OSVersion.VersionString
   py -3 -V; node -v; npm -v; git --version; gh --version
   Test-Path $HOME\.local\bin\claude.exe; (Get-Command claude -ErrorAction SilentlyContinue).Source
   (Get-ChildItem $HOME\.claude\projects -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue).Count
   Get-PSDrive ($HOME.Substring(0, 1)) | Select-Object Used, Free
   "{0:N0} MB" -f ((Get-ChildItem $HOME\.claude -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
   ```

   Offer what is missing, on a yes: `winget install Python.Python.3.12`, `winget install OpenJS.NodeJS.LTS`,
   `winget install Git.Git`, and `winget install GitHub.cli` for step 3. `python3` on Windows is often a
   shortcut to the Microsoft Store, not Python: use `py -3`. The labels in step 9 run `claude`, from
   `$HOME\.local\bin\claude.exe` or else the PATH.
2. **Back up.** `Copy-Item -Recurse $HOME\.claude "$HOME\Backups\claude-$(Get-Date -Format yyyy-MM-dd)"`,
   then compare the sizes as in step 1. The settings file is `$HOME\.claude\settings.json`; check it with
   `py -3 -m json.tool $HOME\.claude\settings.json > $null`.
3. **Get the code.** `git clone https://github.com/matrice-technologies/wimym.git $HOME\wimym`. Git for
   Windows may open a browser window to sign in to GitHub: that sign-in is the person's to do.
4. **The demo.** `cd $HOME\wimym; .\install.cmd --demo`, and `.\install.cmd --demo --stop` after.
5. **Their own record.** `cd $HOME\wimym; .\install.cmd --no-link`. Check it with
   `curl.exe -s http://127.0.0.1:8990/api/state` (`curl.exe`: plain `curl` is something else in PowerShell).
6. **The wimym command.** `.\install.cmd --link --no-open` puts `wimym.cmd` in `$HOME\.local\bin`. If that
   folder is not on the PATH, the installer prints the one PowerShell line that adds it; run it on a yes,
   then `wimym week` works in a new terminal.
7. **The skills.** Links to folders need administrator rights on Windows, so use junctions, which don't:

   ```powershell
   New-Item -ItemType Directory -Force $HOME\.claude\skills | Out-Null
   New-Item -ItemType Junction -Path $HOME\.claude\skills\wimym -Target $HOME\wimym\skills\wimym
   New-Item -ItemType Junction -Path $HOME\.claude\skills\retro -Target $HOME\wimym\skills\retro
   ```

8. **Limits.** `py -3 $HOME\wimym\hooks\limits.py --check` and `--status`. In `settings.json`, the commands
   are `py -3` and the full path with forward slashes, which every shell Claude Code uses on Windows reads
   the same: `"command": "py -3 C:/Users/NAME/wimym/hooks/limits.py"` for the two hooks, and
   `"statusLine": { "type": "command", "command": "py -3 C:/Users/NAME/wimym/hooks/limits.py --status" }`.
9. **Labels.** `py -3 labeller\label.py --key` for Jev (the person runs it), then
   `py -3 labeller\refresh.py --dry-run`, then `--yes`. If `claude.exe` is neither in `$HOME\.local\bin` nor
   on the PATH, set `$env:CLAUDE_BIN = "<the path>"` first. The labeller has not been tried on Windows yet: if
   it fails, stop and say so.
10. **Day to day.** Wimym doesn't start at login: `cd $HOME\wimym; .\install.cmd` starts it again after a
    restart, `.\install.cmd --stop` stops it, `.\install.cmd --update` updates it. Undo a junction with
    `cmd /c rmdir "$HOME\.claude\skills\wimym"`, which removes only the junction. Never `Remove-Item` on it:
    in Windows PowerShell 5 that can delete what is inside the folder it points to.
