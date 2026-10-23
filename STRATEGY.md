# Wimym: strategy

How Wimym gets from [the vision](VISION.md) to something that works. It answers five
questions: which data we read, what we measure, which signals and labels sit in between, how
the results are shown, and how the person asks their own questions with Claude. The last
section gives the order of work. Figures are from this Mac on 22 Oct 2026.

## 1. Data sources

| Source | What it gives | On this Mac | Read today |
|---|---|---|---|
| Claude Code transcripts, `~/.claude/projects` | Every turn: the person's message, its time, what the agent read, ran and changed, permissions, errors, stops, model, effort, thinking time, cost, where it was typed | On disk from 7 Aug; Wimym's index holds 4,534 sessions from 29 Jun | Yes |
| Wimym's index, `~/.cache/wimym` | The record of every transcript read, kept after Claude Code deletes the file | From 29 Jun | Yes |
| Claude Code prompt history, `~/.claude/history.jsonl` | Each prompt typed in the terminal: text, time, folder, session id. No replies, tools or model | 7,529 prompts, 23 Mar to June (719 in March, 4,296 in April, 1,836 in May, 653 in June); almost nothing after, once work moved to the desktop app | No |
| Cowork sessions, `~/Library/Application Support/Claude/local-agent-mode-sessions` | Agent-mode sessions from the desktop app (`audit.jsonl`, format to check) | 41 sessions, 8 Apr to 9 Jul | No |
| Codex sessions, `~/.codex/sessions` | Sessions run with Codex | 408 sessions, Sep and Oct | No |
| Agents' memory, `~/.claude/projects/*/memory` | What agents saved about the person, how often they read it, the message each rule came from | 788 notes, 198 of them feedback | Yes |
| Git | What landed, when, by whom, co-authors, branches merged or abandoned, code still in place a month later | 38 repositories behind 210 working folders, 27,302 commits | No |
| GitHub, through `gh` | Pull requests, reviews by other people, time to merge | Repositories with a GitHub remote | No |
| The person | Check-ins, stated goals, limits, practices, answers in the retro | 1 check-in so far | Check-ins only |
| Connectors, later and opt-in | Calendar (meetings as time with people, days off), sent mail or Slack (work with people), sleep from an Apple Health export | Calendar and Gmail connectors exist in Claude | No |

What this means for history:

- **Full detail** (replies, tools, effort) starts on 29 Jun. Older Claude Code transcripts were
  deleted by Claude Code before Wimym's first index, and there is no Time Machine backup.
- **Prompts only** go back to 23 Mar through `history.jsonl`, which covers April and May well.
  Day length, nights, days off, projects, switching between them, message length, language and
  intent labels can all be computed for that period. What each prompt set off can't.
- **Git** covers the whole period, so output can be compared before and after June.
- A claude.ai data export (the person asks for it in claude.ai's settings) may add chats from
  before March.

**Stop the loss.** Claude Code deletes old transcripts according to `cleanupPeriodDays`, which
isn't set here, so the default applies; the oldest transcript left is from 7 Aug. Wimym's index
keeps a record of each transcript, but not everything in it. Raising `cleanupPeriodDays` in
`~/.claude/settings.json` keeps the full transcripts from now on.

## 2. What we measure

Two outcomes, health and performance, measured through the goals in VISION.md §6. Each measure
is compared with the person's own range: the median and spread of their previous eight weeks.
A measure is flagged only when it stays outside that range for two weeks or more.

A **work block** is a run of the person's messages with no gap over 20 minutes. **Active time**
is the sum of a day's blocks. Most health measures rest on these two definitions.

### Vital signs, read every week

| Goal | Measure | Definition | Sources |
|---|---|---|---|
| Stop when you meant to | Late minutes | Active time after the stopping hour the person set | Transcripts, history |
| Keep rest intact | Night | Hours from the last message of a day to the first of the next | Transcripts, history |
| | Days off | Days in the week with no message of the person's | Transcripts, history |
| Notice escalation | Load | Active hours per week and peak sessions at once, against the eight-week range | Transcripts |
| Keep people in the work | Days with people | Days with a meeting, a review by someone else, a co-authored commit or a message drafted for a person | Calendar, GitHub, git, messages |
| Finish what you start | Open loops | Projects and branches worked on in the last 30 days with nothing landed in the last 14 | Transcripts, git |
| Protect depth | Longest stretch | Longest block on a single project each day | Transcripts, history |
| | Switches | Changes of session per active hour | Transcripts, history |
| Keep your own judgement | Unread approvals | Go-aheads sent sooner than Claude's reply could be read at 250 words a minute | Transcripts |
| Spend effort where you meant to | On priorities | Share of active time on the projects the person named as priorities | Transcripts, the person |
| See strain early | Strain | Corrections and frustrated messages per 100, reply length after 8 hours of work, and check-in energy | Transcripts, labels, check-ins |

### Performance

| Measure | Definition | Sources |
|---|---|---|
| Landed work | Pull requests merged and commits reaching the default branch, per week | Git, GitHub |
| First time right | Build and fix requests not followed by a correction in the same session | Transcripts, labels |
| Survival | Share of lines landed that are still in place 30 days later | Git |
| Leverage | Landed work per active hour | Git, transcripts |
| Time to done | From a request to the turn that lands it | Transcripts, git |

### Context

Every measure can be split by the things that may explain it: model, effort, where the message
was typed (desktop, terminal, phone), permission mode, hour, weekday, project and sessions at
once. These move with the calendar and with the kind of work, so a split is a lead, never a
conclusion. Section 5 says how a lead becomes a test.

## 3. Signals and labels in between

Three layers turn the raw record into the measures above.

### Structural signals: computed, free, exact

Work blocks, sessions at once, switches between sessions, turns the person stopped, messages
queued while Claude worked, permission prompts and refusals, tool failures and API errors,
commits and pushes made in a turn, the agent saying something is done or deployed, the time to
read a reply against the time taken to answer it, model and effort, and where the message was
typed. Most of these exist in the engine already. Blocks, switches and reading time are new.

### Labels from a model

| Level | Labels | Status |
|---|---|---|
| Message | Intent, says what done looks like, own idea, who decides | Intent on every message since 29 Jun; v3 wording ready, relabel pending |
| Message | Tone, scope, pressure, annoyed at, playful | Unreliable on rare values (Opus audit): kept out of measures until fixed |
| Message, new | Decides (makes a decision), defers (puts something off), people (works with or for someone), self-state (mentions tiredness, stress or mood) | To define and test on a sample |
| Session, new | Goal, outcome (landed, partial, abandoned, answered), decisions taken, loops left open, rework | To define; a summary per session first, then labels |
| Day and week, new | A short account: what was decided, dropped and postponed, high and low points | Feeds the retro and the growth log |

Repeated instructions are found by grouping corrections and rules that recur across sessions.
Each group is a candidate rule for the agents.

### Rules for every label

A label has a written definition in `labeller/definitions.json` and a version. It is checked by a
second judge (Opus) and by the person's own marks, and its accuracy on rare values is known. A
label feeds a measure only when that accuracy is good enough. Until then it is shown as a
reading that hasn't been checked. A new label is tried on a sample of about 200 messages, with
its cost, before a full run.

## 4. Showing it

Each view answers one question. It opens with a sentence saying what was found, shows the
person's own range, lets every number open onto its messages, and ends with something to do:
start a practice, set a limit, write a rule for the agents, or decide about an open loop.

| View | What it shows | Ends in |
|---|---|---|
| Vital signs | One small tile per measure: twelve weeks as a line, the person's range as a shaded band, this week as a dot, and a sentence when it is outside. Tiles outside the range come first | A practice or a limit |
| The week | The retro's page: three moments, each with the messages, one small chart and a question | Practices chosen |
| Days | The existing day score and rings, with the stopping hour drawn as a line and the nights as gaps | A limit |
| Focus ribbon | Each day as a horizontal band coloured by project, switches as ticks, the longest stretch outlined | A practice |
| Open loops | Projects and branches by days since last touched, with what landed | Keep, park or drop, recorded |
| Judgement | Each approval as a point: time taken against length of the reply, with the reading-speed line; points below it were approved before they could be read | A practice |
| Effort and output | Active hours and landed work per week, as two small charts on the same weeks | A question for the retro |
| Practices | Each practice with its measure before and during the trial, and a verdict | Keep, change or drop |

Limits act at the moment. A Claude Code hook adds one line at the start of a session or prompt
when the stopping hour has passed or the days without a break exceed the limit. The status line
can show the day's active time. The person sets both, and can turn them off.

The existing app (React, d3, light and dark) stays the base. The rings, the day score and the
message reader carry over.

## 5. Asking Claude

The person should be able to ask an open question in any Claude Code session ("Am I more
scattered on days I start before 7?", "What did I put off this month?", "Does xhigh effort mean
fewer corrections?") and get an answer built on the data, with the messages behind it.

### Pieces

- **A database.** The engine writes everything it knows to `~/.wimym/wimym.db` (SQLite):
  messages, turns, sessions, blocks, days, weeks, projects, commits, pull requests, labels with
  their versions, check-ins, practices, limits and findings. `docs/schema.md` says what each
  column means and what it can't be trusted for.
- **A CLI, `wimym`.** It is the way in for Claude and for scripts:
  - `wimym sql "…"` runs a read-only query;
  - `wimym week [2026-W43]` prints the vital signs and the week's account;
  - `wimym moments --about switching --week 2026-W43` lists the messages behind a pattern;
  - `wimym show <message-id>` prints a message with Claude's reply and what it set off;
  - `wimym practice add|list|check` and `wimym log` manage practices and the growth log.

  Output is short by default, so it fits in context, with `--json` for more.
- **A skill, `/wimym`.** It loads the schema, the definitions and the caveats, and it sets the
  method for answers: moments before totals, the person's own range as the yardstick, known
  confounders named (the calendar, the kind of work, labels not yet checked), and a plain "the
  data can't answer this" when it can't. When a question asks about cause, the answer proposes a
  practice that would test it. Every message cited links to the app
  (`http://127.0.0.1:8990/messages/<id>`).
- **A skill, `/retro`.** It runs the weekly loop with the same CLI. It reads the practices in
  flight and the week's vital signs and account, brings three moments, talks them through, and
  writes the practices and findings back with `wimym practice add` and `wimym log`.

### Why a CLI and a skill

They work in any Claude Code session with no server to run. Claude already writes SQL and
reads command output well. A skill can be shared with someone else together with the method.
An MCP server can wrap the same CLI later if another client needs it.

### Privacy

Queries run on the Mac. What Claude reads through the CLI goes to Anthropic like the rest of
the session. The person can list projects that are never exported or quoted, such as a personal
assistant project.

## 6. Order of work

Each step ends with the retro usable at its level.

1. **Keep and widen the record.** Raise `cleanupPeriodDays`. Read `history.jsonl` to cover
   March to June, git and GitHub. Compute work blocks, switches and reading time. Write the
   SQLite database and its schema.
2. **Ask.** Build the `wimym` CLI and the `/wimym` skill. Run the first retro by hand with them,
   over last week, and keep what it shows about what is missing.
3. **Measure.** Compute the vital signs and their ranges. Write session and day accounts.
   Relabel with categories v3 and fix the unreliable labels, or retire them.
4. **Show.** Build the vital signs, the week, the focus ribbon, open loops, judgement and
   practices views. Turn the `/retro` skill into the weekly ritual.
5. **Limits and connectors.** Add the hooks and the status line for limits. Then, with the
   person's yes, the calendar, and sleep from Apple Health.
