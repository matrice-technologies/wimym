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

- **Check, ask once, then do.** Step 1 only reads the computer. Step 2 asks the person one question,
  whether Wimym may change their Claude Code setup, and says what the rest of the setup will do unless
  they say otherwise. From step 3 on, do what they agreed to, in order, without stopping to ask again:
  before each step, say in a sentence what it does, then do it. Only the labels come back to them later
  (step 10), because their price exists only once Wimym has read their record.
- **Their answer in step 2 is the asking.** Do only what it covers. Nothing outside the Wimym folder
  changes without it: the backup, installing software, linking the command, and above all anything in
  `~/.claude`. If they chose to leave their Claude Code setup as it is, nothing in `~/.claude` is written,
  and none of the things that would write there is mentioned again, in this setup or later. If something
  turns up that their answer doesn't cover (a skill name taken since step 1, a file not as step 1 found
  it), leave that one thing as it is, say so, go on, and bring it up in the wrap-up.
- **Never** use sudo, delete or move anything in `~/.claude`, print or quote the person's transcripts,
  enter a password or token for them, or change a setting they did not agree to. Wimym only reads
  `~/.claude`; this setup only reads it too, except for what the person lets it change in step 2.
- **When something fails, stop.** Show the error's last lines, say what you think it means, and ask
  before trying something else. Don't work around a check the installer makes.
- **Keep a list as you go** of everything you created or changed, with how to undo it. You give it to
  the person at the end.
- The person may not be a developer. Plain words; commands only when they help.
- **Claude Code asks too.** Besides the question in step 2, Claude Code shows its own permission
  prompts before some commands and edits, and their answer in step 2 doesn't skip those. Tell them so in
  step 2, so a prompt while the steps run doesn't surprise them.

Shell commands below assume zsh or bash on macOS. On Windows, follow the same steps with the commands in
**On Windows** at the end of this page. `WIMYM` stands for the Wimym folder (step 4).

## 1. Check the computer

This step changes nothing. Run these:

```bash
uname -s; sw_vers -productVersion
python3 -V; node -v; npm -v; git --version; gh --version | head -1
ls -l ~/.local/bin/claude; command -v claude
ls -d ~/.claude/projects && find ~/.claude/projects -name '*.jsonl' | wc -l
df -h ~ | tail -1; du -sh ~/.claude
ls -d ~/wimym/install.sh ~/wimym/bin/wimym ~/wimym/engine/server.py
ls -la ~/.claude/skills/wimym ~/.claude/skills/retro
echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin" && echo "~/.local/bin is on the PATH"
cat ~/.wimym/settings.json
```

and read `~/.claude/settings.json`, if there is one, for `cleanupPeriodDays`.

- **macOS**, or **Windows 10 or 11** (then use **On Windows** below for every step). Linux, and Claude
  Code inside WSL on Windows, run the commands here as they are, with the distribution's own packages for
  Python and Node in place of `brew`; Wimym there reads the transcripts of the Claude Code inside Linux.
  On anything else, stop and say so.
- **Python 3.9 or later** runs the engine. **Node 18 or later** builds the page once. Note what is
  missing or too old, for step 2.
- **Transcripts**: if `~/.claude/projects` is missing or empty, Wimym will start and show nothing yet.
  The person can still go on, and see the demo.
- **The `claude` command**: the labels in step 10 run it, from `~/.local/bin/claude` (where Claude Code's
  installer puts it) or else from the PATH (`command -v claude`). If there is none at all, everything else
  still works; only the labels need it.
- **A copy of Wimym already there**: a folder holding `install.sh`, `bin/wimym` and `engine/server.py`,
  such as `~/wimym`. If there is one, that is `WIMYM`.
- **An earlier answer**: `claudeSetup` in `~/.wimym/settings.json` is what the person said about their
  Claude Code setup the last time Wimym was set up here (`none`, `recommended` or `custom`).
- **The skill names**: whether `~/.claude/skills/wimym` or `~/.claude/skills/retro` already exist, and if
  so, whether each is a link into a Wimym folder.
- **How long transcripts are kept**: `cleanupPeriodDays` (not set means 30).

Report the results in one short paragraph, then go straight on to step 2.

## 2. One question, and the plan

In one message, in this order.

**How this goes.** One question now, and the plan below. Then the setup runs on its own, and comes back
to them once, for the labels and their price. Claude Code may still show its own prompts as it goes.

**The question: may Wimym change your Claude Code setup?** Say plainly that Wimym only reads `~/.claude`
and works without changing anything there. A few extras do change it; name each in a line with where it
writes:

- **Keep transcripts for a year.** Claude Code deletes transcripts older than 30 days on its own unless
  `cleanupPeriodDays` in `~/.claude/settings.json` says otherwise, and Wimym can only show what is kept.
  Give the current value; leave this line out if it is already 365 or more.
- **The `/wimym` and `/retro` skills**, two links in `~/.claude/skills`. `/wimym` answers open questions
  about them with their own data in context; `/retro` runs the weekly retro. Without them, the retro is
  on the page (**The week**) and the questions go to the `wimym` command in a terminal. If a name is
  already taken by something that isn't a link into a Wimym folder, say so: that one stays as it is.
- **Later, only if they ask for it:** limits that speak in Claude Code (two hooks and a status line in
  `~/.claude/settings.json`), and in a retro, a memory note or CLAUDE.md line for an instruction they
  keep repeating. Each is offered at that moment, and written only after a yes.

Then the three answers:

1. **Leave it as it is.** Nothing in `~/.claude` is written, now or later, and none of these is offered
   again. Say what it costs: transcripts older than 30 days (or the current value) keep disappearing,
   so Wimym's history stops there.
2. **The recommended set** (the one to recommend): a year of transcripts and the two skills now; the
   later ones offered when they come up, each after a yes.
3. **Let me pick**: which of the two to do now, and the number of days if not 365; the later ones
   offered as in 2.

If step 1 found an earlier answer, don't ask the question: say what they chose then, that it still holds,
and that they can say otherwise now.

**The plan, unless they say otherwise.** One line each, only those that apply:

- **Install what's missing**, if Python or Node is missing or too old: `brew install python` or
  `brew install node`. Without `brew`, this is the one thing they do themselves: install it from
  python.org or nodejs.org and say once it is done. Check with `python3 -V` or `node -v` before going on.
- **Back up `~/.claude`** to `~/Backups/claude-<today>`: their whole history with Claude Code, every
  transcript and every memory note, worth more than any tool. Wimym only reads it, but it is young
  software. Give its size and the free space from step 1; if there isn't room for a copy, say so and
  leave this out.
- **The code in `~/wimym`**, if step 1 found no copy.
- **The `wimym` command** in `~/.local/bin`: it answers questions from what Wimym knows (`wimym week`,
  `wimym moments --about switches`), and the skills need it. If `~/.local/bin` is not on the PATH, it
  also means adding `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` (or the profile of their shell).
- **Read their record and open the page.**
- **No demo**, unless they want one: the whole page on Robin, a made-up person, before Wimym reads
  anything of theirs.

Their reply is the go-ahead. "The recommended one", or a plain go-ahead to the recommendation, is answer
2 and the plan as written. A change to the plan ("no backup", "put it in ~/code/wimym", "show me the
demo") changes only that line. If their answer to the question itself is unclear, ask that again: never
take a vague reply as a yes to changing `~/.claude`. Otherwise sum up in a line what you are about to do,
and start step 3 without waiting.

## 3. Back up ~/.claude

Unless they said no to it:

```bash
mkdir -p ~/Backups
ditto ~/.claude ~/Backups/claude-$(date +%Y-%m-%d)
du -sh ~/.claude ~/Backups/claude-$(date +%Y-%m-%d)
```

Show the two sizes; they should be close.

## 4. Get the code

Wimym is shared by invitation, in the private GitHub repository `matrice-technologies/wimym`.

If step 1 found a copy (or they told you where theirs is), update it with `git -C WIMYM pull --ff-only`;
if the pull fails because of local changes, say so and leave it. Otherwise clone it where they said
(`~/wimym` unless they said otherwise):

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

## 5. Keep their answer

Write down their answer to the question in step 2, so Wimym keeps to it after this setup: `/retro`,
`/wimym` and `wimym rules draft` read it, and a later setup finds it in step 1. One of `none` (leave it as
it is), `recommended` or `custom` (let me pick):

```bash
WIMYM/bin/wimym claude-setup none
```

It writes only `claudeSetup` in `~/.wimym/settings.json` and keeps the file's other settings. If step 1
found an earlier answer and they didn't change it, skip this.

## 6. The demo

If they asked for it:

```bash
cd WIMYM && ./install.sh --demo
```

The first run installs the page's packages and builds it, about a minute or two; use a long timeout
(10 minutes) for the command. It opens http://127.0.0.1:8997 in the browser. Tell them it is there, and
go on: it keeps running on its own port, with its own folders, beside their own Wimym, until the wrap-up
stops it.

## 7. Run Wimym on their own record

This is the step that reads the person's transcripts, so say that plainly as you start it: it reads
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
step 9 changes that, so Wimym starts with about four weeks. A week is compared with the weeks before it:
the usual range appears only once there are four earlier weeks, and a row is flagged only when two weeks
in a row fall outside it. So for the first weeks most rows show numbers with no range and no flags, and
"against your own usual" fills in over the next month or two. A longer `cleanupPeriodDays` only keeps
transcripts from now on; it can't bring back ones already deleted.

## 8. The wimym command

Unless they said no to it:

```bash
cd WIMYM && ./install.sh --link --no-open
command -v wimym || echo "not on PATH"
```

If `~/.local/bin` is not on the PATH, add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` (or the
profile of their shell). Then try `~/.local/bin/wimym week` and show the first lines.

## 9. Their Claude Code setup

**If they chose to leave it as it is, skip this whole step**, and say nothing more about it.

Otherwise, do what they chose: both parts for the recommended set, the ones they picked otherwise.

**A year of transcripts.** Copy the settings file first to `~/.claude/settings.json.before-wimym` (if
that copy doesn't exist yet), change only `cleanupPeriodDays` to 365 or the number they chose, keep
everything else as it was, and check the file still parses with
`python3 -m json.tool ~/.claude/settings.json > /dev/null`.

**The two skills.** They need the command from step 8; without it, skip them and say why. Look again at
what is there:

```bash
mkdir -p ~/.claude/skills
ls -la ~/.claude/skills/wimym ~/.claude/skills/retro 2>/dev/null
```

A name taken by something that isn't a link into `WIMYM` stays as it is: skip that skill and say so.
Otherwise:

```bash
ln -sfn WIMYM/skills/wimym ~/.claude/skills/wimym
ln -sfn WIMYM/skills/retro ~/.claude/skills/retro
```

They load in new Claude Code sessions: `/wimym Am I more scattered on days I start before 7?`, or
`/retro` once a week.

## 10. Labels

This is the one place the setup comes back to the person. If step 1 found no `claude` command, say in a
line that the labels need it, and go on to the wrap-up.

Some of what Wimym shows (tone, strain, what each message asks for) comes from a model reading their
words, and so do a few written sentences for each session, day and week, which **The week** page and
`/retro` tell the days from. One command does the whole chain, only on what is new since the last run,
with today and the week in progress left out. First show what it would send and what it would cost,
without sending anything:

```bash
cd WIMYM && python3 labeller/refresh.py --dry-run
```

(With the `wimym` command, `wimym label --dry-run` is the same.) If it says the `claude` command can't be
found, the labels can't run: say so, and go on to the wrap-up.

Then ask, in a few lines, with the total it gave:

- **Label now, on their Claude plan** (the one to recommend). Their messages go to Claude Haiku through
  their own logged-in `claude`, which counts against their plan's usage and can take an hour or more the
  first time. Claude Opus writes the session, day and week accounts.
- **With Jev instead**, if they have, or want, a TypeSafe account. TypeSafe's Jev labels the messages in
  minutes for cents to a few dollars billed to their key, and their messages go to TypeSafe. Its labels
  were checked by a second judge, tone included; a few written details stay empty (what was decided, who
  was named, the rules they repeat). The accounts still go through Claude Opus on their plan.
- **Not now.** `wimym label` (or `/retro`, which offers it each week) does it any time.

On Jev: the key is theirs to type. Never ask them to paste it into this conversation, and never type it
for them. Ask them to run this in a terminal of their own and to say when it says the key is kept:

```bash
cd WIMYM && python3 labeller/label.py --key
```

It asks for the key without showing it, checks it with TypeSafe, and keeps it in `~/.wimym/typesafe.key`,
readable by them only. Check it is there, never by reading it (`test -f ~/.wimym/typesafe.key && echo kept`),
add it to your list (undo: delete the file, and the labeller goes back to Haiku), then run the dry run
again and give them Jev's total: that is the price they say yes to.

Only on a clear yes to a price, run it in the background with a long timeout:

```bash
cd WIMYM && python3 labeller/refresh.py --yes
```

Run without `--yes`, it only shows the plan again, since it asks before sending and there is no terminal to
ask in. A rerun only does what is still missing, so if it stops part way, running it again picks up from
there. The **Labels** page shows what each label means and how far it has been checked.

## 11. Wrap up

If the demo is running, stop it with `cd WIMYM && ./install.sh --demo --stop` (`./install.sh --demo` brings
it back). Then give the person a short summary:

- Where Wimym is: http://127.0.0.1:8990 (or the port used), and `WIMYM` for the code.
- The list you kept: everything created or changed, each with how to undo it (remove the links,
  restore `~/.claude/settings.json.before-wimym`, delete `~/.cache/wimym`; `~/.wimym` holds what
  they enter, so only on purpose).
- Anything you left as it was along the way, and why (a skill name already taken, a settings file not
  as step 1 found it).
- Their answer about their Claude Code setup, and that `wimym claude-setup` shows it and changes it.
- Day to day: Wimym doesn't start at login. After a restart the page doesn't open until
  `cd WIMYM && ./install.sh` starts it again (it only redoes what changed); `./install.sh --stop` stops it.
  To update: `cd WIMYM && ./install.sh --update`, which says what is new and restarts Wimym onto it. The
  page says when a new version is out.
- The retro is the heart of it: once a week, `/retro` (with the skills) or **The week** on the page.
  Limits (a stopping hour, days off a week, sessions at once) are set there or on the front page.
  Unless they chose to leave their Claude Code setup as it is, say in one line that a limit can also
  speak in Claude Code, and that `/retro` offers it once they set one (`docs/hooks.md` has how).
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
   Test-Path $HOME\wimym\install.cmd, $HOME\wimym\bin\wimym.cmd, $HOME\wimym\engine\server.py
   Get-Item $HOME\.claude\skills\wimym, $HOME\.claude\skills\retro -ErrorAction SilentlyContinue | Select-Object FullName, LinkType, Target
   Get-Content $HOME\.wimym\settings.json -ErrorAction SilentlyContinue
   ```

   The settings file is `$HOME\.claude\settings.json`. `python3` on Windows is often a shortcut to the
   Microsoft Store, not Python: use `py -3`. The labels in step 10 run `claude`, from
   `$HOME\.local\bin\claude.exe` or else the PATH.
2. **The question and the plan.** The same, with `winget` for what is missing: `winget install Python.Python.3.12`,
   `winget install OpenJS.NodeJS.LTS`, `winget install Git.Git`, and `winget install GitHub.cli` for step 4.
3. **Back up.** `Copy-Item -Recurse $HOME\.claude "$HOME\Backups\claude-$(Get-Date -Format yyyy-MM-dd)"`,
   then compare the sizes as in step 1.
4. **Get the code.** `git clone https://github.com/matrice-technologies/wimym.git $HOME\wimym`. Git for
   Windows may open a browser window to sign in to GitHub: that sign-in is the person's to do.
5. **Their answer.** `$HOME\wimym\bin\wimym.cmd claude-setup none` (or `recommended`, `custom`).
6. **The demo.** `cd $HOME\wimym; .\install.cmd --demo`, and `.\install.cmd --demo --stop` at the wrap-up.
7. **Their own record.** `cd $HOME\wimym; .\install.cmd --no-link`. Check it with
   `curl.exe -s http://127.0.0.1:8990/api/state` (`curl.exe`: plain `curl` is something else in PowerShell).
8. **The wimym command.** `.\install.cmd --link --no-open` puts `wimym.cmd` in `$HOME\.local\bin`. If that
   folder is not on the PATH, the installer prints the one PowerShell line that adds it; run it unless they
   said no, then `wimym week` works in a new terminal.
9. **Their Claude Code setup**, unless they chose to leave it as it is. Check the settings file with
   `py -3 -m json.tool $HOME\.claude\settings.json > $null`. Links to folders need administrator rights on
   Windows, so the skills use junctions, which don't:

   ```powershell
   New-Item -ItemType Directory -Force $HOME\.claude\skills | Out-Null
   New-Item -ItemType Junction -Path $HOME\.claude\skills\wimym -Target $HOME\wimym\skills\wimym
   New-Item -ItemType Junction -Path $HOME\.claude\skills\retro -Target $HOME\wimym\skills\retro
   ```

10. **Labels.** `py -3 labeller\refresh.py --dry-run`, then `--yes`; for Jev, the person runs
    `py -3 labeller\label.py --key` in a terminal of their own, and `Test-Path $HOME\.wimym\typesafe.key`
    checks it. If `claude.exe` is neither in `$HOME\.local\bin` nor on the PATH, set
    `$env:CLAUDE_BIN = "<the path>"` first. The labeller has not been tried on Windows yet: if it fails, stop
    and say so.
11. **Day to day.** Wimym doesn't start at login: `cd $HOME\wimym; .\install.cmd` starts it again after a
    restart, `.\install.cmd --stop` stops it, `.\install.cmd --update` updates it. Undo a junction with
    `cmd /c rmdir "$HOME\.claude\skills\wimym"`, which removes only the junction. Never `Remove-Item` on it:
    in Windows PowerShell 5 that can delete what is inside the folder it points to.
