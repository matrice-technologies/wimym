# The database: `wimym.db`

Everything the engine knows, in one SQLite file in the cache dir (`~/.cache/wimym/wimym.db`;
`~/.cache/wimym-dev/wimym.db` during the build sprint). It is derived: deleting it loses nothing, the
next `wimym` command rebuilds it in a few seconds. What the person decides (practices, limits, the
growth log, check-ins) lives in the data dir (`~/.wimym`), and the database only copies it.

The way in is the `wimym` CLI (`bin/wimym`, code in `engine/wimym/cli.py`):

```bash
wimym schema [table]          # this page's meanings, next to the columns the file actually has
wimym sql "select …"          # reads only: writes, ATTACH, VACUUM and setting pragmas are refused
wimym week [2026-10-12]       # vital signs outside your range, the days, the moments behind them
wimym moments --about corrections --week 2026-10-12
wimym show 3e5bf6dd           # one message whole, with Claude's reply and what it set off
wimym practice add|list|check|verdict · wimym log add|list · wimym limits [set|clear]
wimym rules [draft 3]         instructions you keep giving the agents; a draft memory note to approve (writes nothing)
wimym build                   # rebuild now
```

`wimym schema` reads the tables below from this file, so a column documented here shows its meaning
there, and a column the engine adds later shows as "not documented yet" until it is written here.

## Before trusting a number

- **Two periods of history.** Full detail (Claude's reply, tools, files, model, effort, time taken,
  stops) starts on **29 Jun 2026**. From **23 Mar** there are only the prompts typed in the terminal
  (`history.jsonl`, `origin = 'history'`). On those rows every field only a transcript gives is
  **null, never zero**: `reply`, `tools`, `files`, `commits`, `dur`, `model`, `effort`, `stopped`,
  `gap`, `unread` and the rest. Count with `where origin = 'transcript'` when a measure needs them.
  After June, prompts moved to the desktop app, so March to June and July onward don't measure the
  same way of working either.
- **Labels are a model's reading.** Haiku wrote them; Opus checked a sample (docs/research/opus-audit.md,
  250 marks). Accuracy on the values that matter, with a 95% interval:
  - intent: good (18/19 on random cards). `correct` 5/6, `design` 7/7, `go-ahead` 6/7, `fix` 3/5
    (the line between fix and correct is soft: Claude said it worked and it doesn't is a correction).
  - tone: `frustrated` 4/7 (25–84%) and `pleased` 2/6 (10–70%). **Both inflated**: plain problem
    reports read as frustrated, agreement or a smiley as pleased. Read them, don't count them.
  - specific ("says what done looks like"): 13/17; says true for open questions. Use only on requests
    for work (build, fix, design, plan, review, ops, setup, ship, correct).
  - own idea: good (19/20). who decides: `claude` 3/6, over-used for plain instructions.
  - scope `strategy` 0/5, pressure `true` 1/3, annoyed at `claude` 2/5 and `other` 0/4, playful
    `true` 1/4: **not usable** until reworded. And signals (own, who, scope, pressure, irk, play)
    cover a 199-message sample only: null on almost every message.
  - The newer sets (acts on messages; sessions; days) were judged by Opus on samples while their
    wording was fixed (docs/labels.md), but none is marked checked yet. The `label_status` table says,
    field by field, what may be counted: today only intent. Everything else is a reading: use it to
    find messages to read, quote it as "a model's reading", never count it as a measure.
  The `labels` table keeps every version, so a count can name the version it used.
- **Model and effort move with the calendar.** Effort `xhigh` is close to 90% of August and September;
  `high` is 85% of October, which is also when Opus 5.5 replaced Opus 5 (23 Sep) and the projects
  changed. Any split by model or effort is a split by month and by kind of work too. A difference
  there is a lead for a practice to test, never a finding.
- **Hours of the day.** `hour` runs from 5 to 29: a day starts at 05:00, so 01:30 is hour 25.5 of
  the day before. Times in `ts` are UTC; `local` is the Mac's time.
- **Replies are cut at 2,500 characters** and your messages at 20,000. Reading time and "unread"
  are computed on what is kept, so long replies count as shorter than they were.
- **Commits** come from the engine's reading of git (`git.json`), only for the repositories behind
  folders you worked in. The CLI never runs git itself: if the engine hasn't read git yet, the table
  is empty. `messages.commits` counts `git commit` commands Claude ran in a turn, a different thing.
- **Keyword columns are not labels.** `defer_words` matches words like later, for now, tomorrow,
  plus tard. Many hits are not putting anything off: read them.
- **One person, one Mac.** Comparisons are with the person's own earlier weeks, never with a norm.

## Joins

`messages.id` = `turns.id` = `labels.id` (for message label sets) = `vitals_evidence.id`.
`messages.sid` = `turns.sid` = `sessions.sid` = `labels.id` for the `sessions` label set.
`messages.block` = `blocks.block`. `messages.day` = `days.day` = `checkins.day`;
`messages.week` = `weeks.week` = `vitals.period` when `vitals.grain = 'week'`.
A message's page in the app: `http://127.0.0.1:8990/messages/<id>` (the `link` column).

## Tables

### messages
Every message you typed: from transcripts since 29 Jun, and from history.jsonl since 23 Mar. One row per message, text in full.

| column | meaning |
|---|---|
| id | the turn's uuid (transcripts) or h-<ms>-<session> (history.jsonl) |
| sid | session id |
| project | the folder's project name (worktrees fold into their repository) |
| ts | when it was sent, UTC |
| local | when it was sent, the Mac's time |
| day | the day it belongs to, 05:00 to 05:00 |
| week | the Monday of its week |
| hour | hours since midnight of its day, 5 to 29 (01:30 is 25.5) |
| dow | weekday of its day, 0 is Monday |
| src | desk (typed in Claude Code) or massistant (sent through the Massistant bridge, often voice) |
| kind | prompt, shell (!command), command (/slash) |
| text | your words in full (pasted blocks and system wrappers taken out) |
| reply | Claude's last text in that turn, up to 2,500 characters; null for history prompts |
| link | the message in the app |
| origin | transcript (Claude Code), history (history.jsonl: no reply, tools, model or effort), or another source the engine reads (cowork, codex) |
| words | words in your message |
| chars | characters in your message |
| images | images attached |
| pasted | characters pasted with it |
| lang | en, fr, or other |
| typos | words the spell check didn't know, in English messages typed at the desk |
| checked | words spell-checked |
| intent | what it asks for (Haiku, categories v2): build, fix, question, review, ship, design, plan, go-ahead, answer, correct, ops, setup. Good accuracy |
| family | intent grouped: ask, steer, make, approve, run, ship, think |
| tone | neutral, pleased, frustrated (Haiku). pleased and frustrated are inflated: read, don't count |
| specific | 1 when the message says what done looks like (Haiku). Only meaningful on requests for work |
| own | 1 when it brings an idea of your own (Haiku, signals v3, 199-message sample) |
| who | who makes the call: alex, claude, open, none (signals v3 sample; claude over-used) |
| scope | tweak, task, project, strategy, none (signals v3 sample; strategy unusable) |
| pressure | 1 when it says it's urgent (signals v3 sample; unusable) |
| irk | annoyance aimed at none, claude, other (signals v3 sample; unusable) |
| play | 1 when playful (signals v3 sample; unusable) |
| dur | seconds from your message to the end of Claude's turn |
| wait1 | seconds to Claude's first output |
| tools | tool calls Claude made in the turn |
| cat | tool calls by kind, JSON (shell, edit, read, search, web, agent, other) |
| files | files changed in the turn |
| add | lines added |
| del | lines deleted |
| commits | git commit commands run in the turn |
| pushes | git push commands run in the turn |
| prs | gh pr create commands run in the turn |
| out | output tokens |
| ctx | context tokens at the end of the turn |
| stopped | 1 when you interrupted Claude in that turn |
| model | the model that answered |
| effort | the effort setting (low, medium, high, xhigh, max); empty before it was recorded |
| thinkMs | milliseconds of thinking |
| mode | permission mode: default, acceptEdits, auto, plan, bypassPermissions |
| asked | permission prompts you were shown |
| auto | tool calls allowed by a rule or the mode, without asking |
| denied | permission prompts you refused |
| blocked | tool calls refused by a hook or rule |
| fail | tool calls that failed |
| agents | subagents launched |
| spawn | other sessions started |
| questions | questions Claude asked you with its question tool |
| first | 1 for the first message of its session |
| gap | seconds from the end of Claude's previous turn to this message (your time to answer) |
| queued | 1 when typed while Claude was still working, and held in the queue |
| after | what Claude's previous turn did: answered, changed, shipped, stopped |
| claudeAsked | 1 when Claude's previous reply ended on a question |
| readWords | the engine's word count for reading the reply before |
| next | intent of your next message in the same session |
| next_id | id of your next message in the same session (join it to messages to read the reply to Claude's work) |
| nextGap | seconds to your next message in the same session |
| block | the work block it belongs to (blocks.block) |
| switch | 1 when the message before it in the same block was in another session |
| pswitch | 1 when the message before it in the same block was in another project |
| truncated | 1 when your message was longer than the 20,000 characters kept |
| reply_words | words in Claude's kept reply to this message |
| prev_reply_words | words in Claude's reply just before this message |
| read_secs | seconds that reply takes to read at 250 words a minute |
| unread | 1 when you answered sooner than read_secs (replies of about 40 words or more); the vital sign counts go-aheads only |
| defer_words | 1 when words of putting off appear (later, for now, tomorrow, plus tard…). A keyword match, not a label: most hits put nothing off |
| decides | 1 when the message makes a decision (Haiku, acts set). A reading, not checked |
| decision | what it decided, in a few words (acts). A reading, not checked |
| defers | 1 when it puts something off (acts). A reading, not checked |
| putOff | what it put off (acts). A reading, not checked |
| withPeople | none, mention, with: other people in the message (acts). A reading, not checked |
| people | the people named, JSON list (acts). A reading, not checked |
| selfState | none, tired, stressed, low, energised, unwell: how the person says they are (acts). A reading of words, never a judgement about how someone is; tests of a voice assistant read the same as real days |
| handsOver | do, think, decide, ask, none: what the message hands to Claude (acts). A reading, not checked |
| rule | a standing instruction the message gives the agents, in a few words (acts). A reading, not checked; grouped in the rules table |
| domain | work, personal, health, family, admin (acts). A reading, not checked |
| notDone | 1 when it says something Claude claimed done isn't (acts). A reading, not checked |

### turns
Every prompt Claude worked on, yours and automated ones (scheduled tasks, other sessions, the bridge), with what it set off.

| column | meaning |
|---|---|
| id | as messages.id |
| mine | 1 when it is one of your messages (in messages) |
| src | desk, massistant, or what started it when not you (auto, side session, task) |
| text | the prompt, first 2,000 characters |
| interrupted | 1 when it was stopped |
| files | the files changed, JSON list |
| perm | permission decisions, JSON |
| skills | skills used, JSON list |
| msgs | Claude's messages in the turn |
| plan | 1 when in plan mode |
| sent | when it left the queue, if it was typed while Claude worked |
| cwd | the folder |

### sessions
One row per Claude Code session.

| column | meaning |
|---|---|
| sid | session id |
| kind | you (you typed in it), side (started by another session), auto (scheduled or automated) |
| title | the session's title |
| day | the day it started |
| spans | minutes it was active, JSON list of [from, to] in minutes since 1970 (UTC) |
| turns | prompts in it |
| mine | of which yours |
| cost | dollars, list price, when Claude Code recorded it |
| subs | subagent transcripts |
| entry | where it was started (cli, desktop, sdk…) |
| first | id of its first message |
| ex | its first words |
| goal | what the session set out to do (sessions set, by a model). A reading, not checked |
| outcome | landed, partial, abandoned, answered, unknown (sessions set). A reading, not checked |
| decisions | decisions taken in it, JSON list of {t, m}; one row each in session_items |
| open | loops left open at its end, JSON list; one row each in session_items |
| rework | 1 when it redid earlier work (sessions set) |
| redone | what was redone, in a few words |
| people | people involved, JSON list |
| account | a short account of the session, citing message ids in brackets. A reading, not checked |

### blocks
Work blocks: runs of your messages with no gap over 20 minutes, from the first message to the last plus 5 minutes.

| column | meaning |
|---|---|
| block | number, in time order |
| minutes | its length |
| messages | your messages in it |
| sessions | sessions you wrote in |
| projects | projects you wrote in |
| top | the project with most messages |
| switches | changes of session inside it |
| longest_min | the longest run on one project inside it, minutes |
| longest_project | that run's project |

### days
One row per calendar day from 23 Mar, with or without messages (n = 0 is a day off). Measures from the first engine; days before 29 Jun carry only what prompts can give.

| column | meaning |
|---|---|
| n | your messages |
| streak | days in a row with messages, up to this one |
| start | hour of the first message (5 to 29) |
| end | hour of the last message |
| span | end minus start, hours |
| active | span minus breaks of 30 minutes or more (the first engine's definition; vitals use blocks) |
| rest | hours since the last message of the day before |
| stretch | longest run without a 30-minute break, hours |
| late | 1 when the last message was after 23:00 |
| switchH | changes of project per active hour |
| peak | most of your sessions running in the same minute |
| avgAt | average sessions running at once while you worked |
| claudeH | hours Claude worked across all sessions |
| autoTurns | automated turns |
| goahead | share of labelled messages that are go-aheads, when 10 or more are labelled |
| correct | share that are corrections |
| frustrated | share labelled frustrated (inflated) |
| fam | messages by intent family, JSON |
| check | the day's check-in, JSON |
| history | messages that came from history.jsonl |
| cost | dollars spread over the day |

### weeks
The first engine's weekly summary, by Monday. Shares need 30 labelled messages.

| column | meaning |
|---|---|
| days | days with messages |
| off | days without |
| n | your prompts |
| intents | messages by intent, JSON |
| who | signals counts, JSON (sample) |

### projects
One row per project, all time.

| column | meaning |
|---|---|
| n | your messages |
| weekly | messages per week, JSON list aligned with weeks |
| claudeH | hours Claude worked on your messages |

### vitals
The vital signs of STRATEGY.md §2, in long format: one row per measure and period. Most come from the engine (source engine, the same numbers as /api/vitals); start, end, messages, projects, corrections, stopped, defer_words, commits, words and daily active hours come from the CLI (source ask). Corrections count only intent labels whose version was checked (labels.checked, messages.intentV); tone was never checked, so it is not a measure.

| column | meaning |
|---|---|
| measure | late, night, daysoff, load, peak, people, loops, stretch, switches, unread, priorities, strain, landed, ftr, survival, leverage, ttd; and the CLI's start, end, messages, projects, corrections, stopped, defer_words, commits, words, active |
| grain | week or day |
| period | the Monday, or the day |
| value | the measure; null when there is no data (before 29 Jun for transcript-only measures, or a limit not set) |
| lo | your range: 25th percentile of the 8 complete weeks (or 56 days with messages) before |
| mid | the median of the same |
| hi | the 75th percentile of the same |
| outside | above or below when the value is outside lo–hi |
| partial | 1 for the current week, not complete |
| source | engine or ask |

### day_vitals
The vitals table wide: one row per day, one column per measure (night, start, switches, stretch, active, late…). The easiest way to compare measures across days.

| column | meaning |
|---|---|
| period | the day |

### week_vitals
The vitals table wide: one row per week (the Monday), one column per measure.

| column | meaning |
|---|---|
| period | the Monday |

### week_summary
The engine's one-sentence account of each week (vitals.week()).

| column | meaning |
|---|---|
| week | the Monday |
| complete | 1 when the week is over |
| summary | hours, days, nights, and what was outside the person's usual |

### week_moments
The engine's candidate moments for each week's retro, most unusual first (vitals.week()). `wimym week` shows them.

| column | meaning |
|---|---|
| week | the Monday |
| rank | 1 is the most unusual |
| key | what kind of moment: deep, longest-day, short-night, latest-night, switching, unread, stopped, corrections, quiet, branches; day accounts add high, low, decided, dropped, postponed |
| kind | same as key |
| day | the day it happened, when it is one day |
| title | a short title |
| reason | why it was picked, in a sentence |
| about | the goal it bears on: rest, depth, judgement, strain, finish, escalation… |
| question | one open question for the retro |
| messages | the message ids behind it, JSON list |
| value | its number (hours, count…) |
| unusual | the share of the person's days before that this one beats, 0 to 1 |
| extra | anything else the engine attached (branches, projects), JSON |

### vitals_evidence
Up to 10 messages the engine gives as evidence for each measure, for the current week (or the last complete one).

| column | meaning |
|---|---|
| measure | the vital sign |
| id | a message id |

### commits
Every commit in the repositories behind the folders you worked in, from the engine's git.json.

| column | meaning |
|---|---|
| sha | commit hash |
| project | the repository's project |
| local | when, the Mac's time |
| day | the day it belongs to |
| at | unix time |
| who | you, agent (Claude, bots) or person (someone else) |
| claude | 1 when co-authored by Claude |
| people | co-authors who are people, JSON |
| files | files changed |
| merge | 1 for a merge commit |
| landed | 1 when the default branch contains it |

### branches
Branch tips the default branch doesn't contain: candidates for open or abandoned work.

| column | meaning |
|---|---|
| name | the branch |
| at | unix time of its tip |
| ahead | commits not on the default branch |
| who | who wrote the tip |

### labels
Every label in every label file, every version, long format.

| column | meaning |
|---|---|
| id | message id, or session id for the sessions set, or day for a days set |
| set | categories, signals, acts, sessions, … (the file's name) |
| field | the label's key (in, to, sp, ag; own, who, sc, pr, irk, pl; dec, dfr, ppl, st, off…) |
| value | its value, true/false for yes-no labels, JSON for lists |
| version | the definitions' version it was made with |
| current | 1 when it is the file's current version and not in next/ (a relabel in progress) |
| file | the file, relative to the labels folder |

### label_status
For each label set and field: whether it may be counted (checked by a second judge, labels.checked()) or is only a reading. Anything with checked = 0 is shown as a model's reading and never counted as a measure.

| column | meaning |
|---|---|
| set | the label set (file name) |
| field | the label's key |
| checked | 1 when its accuracy was checked and found good enough (so far only categories.in, intent) |
| labelled | messages, sessions or days with a current label |
| versions | versions present, JSON |

### day_accounts
The story of each day, written by a model from the day's messages (days set). A reading, not checked: it cites message ids in brackets, so every claim can be opened.

| column | meaning |
|---|---|
| day | the day |
| account | a short account of the day |
| strain | signs of strain it noticed, with the messages; a reading of words, never a judgement |
| version | the days set's version |
| cites | message ids it leans on, JSON |
| checked | 1 when the days set was checked |

### day_items
What each day account says was decided, dropped, postponed, and its high and low points, one row each with the message behind it.

| column | meaning |
|---|---|
| day | the day |
| kind | decided, dropped, postponed, high, low |
| text | what, in a sentence |
| id | the message it comes from |

### session_items
Decisions taken and loops left open in each session (sessions set), one row each. A reading, not checked.

| column | meaning |
|---|---|
| sid | the session |
| project | its project |
| day | the day it started |
| kind | decision or open |
| text | what, in a sentence |
| id | the message it comes from, when given |
| outcome | the session's outcome: landed, partial, abandoned, answered, unknown |

### rules
Standing instructions the person gave more than once, grouped across sessions (rules.json, from the labeller): candidates for a practice given to the agents. `wimym rules` lists them; `wimym rules draft <n>` writes a proposal to approve.

| column | meaning |
|---|---|
| n_ | its number in `wimym rules` |
| rule | the instruction, in a sentence |
| kind | what it is about |
| n | how many times it was given |
| sessions | in how many sessions |
| ids | the messages, JSON |
| known | whether a memory note or CLAUDE.md already says it |
| first | first time given |
| last | last time given |
| projects | where, JSON |

### label_values
What each label and value means: the words the labeller was given (labeller/definitions.json).

| column | meaning |
|---|---|
| set | the label set |
| set_version | its version in definitions.json |
| field | the label's key |
| field_name | its name |
| value | a value |
| meaning | what the value means, in the labeller's words |

### label_audit
Opus's second-judge marks on the Haiku labels (250 marks, 22 Oct).

| column | meaning |
|---|---|
| ok | 1 right, 0 wrong, null unclear |
| was | the label Haiku gave |
| why | Opus's reason |

### checkins
How the day went, in the person's words (the Days page).

| column | meaning |
|---|---|
| energy | 1 to 5 |
| mood | 1 to 5 |
| focus | 1 to 5 |
| note | free text |

### practices
What the person decided to do differently (practices.json in the data dir).

| column | meaning |
|---|---|
| id | short name |
| text | the practice, in the person's words |
| owner | person or agents |
| where | for agents: memory, CLAUDE.md, a skill, a permission |
| measure | the vital sign that checks it |
| sql | or a query returning one number for :start to :end |
| target | how to tell it held: <= 0, >= 7 |
| start | first day of the trial |
| trial | length of the trial, days |
| status | trying, kept, changed, dropped |
| why | the moment or finding it answers |
| verdicts | how many verdicts so far |

### verdicts
The person's calls on each practice, over time.

| column | meaning |
|---|---|
| practice | practices.id |
| verdict | keep, change, drop |
| note | why |

### log
The growth log (log.jsonl in the data dir): what was looked at and concluded.

| column | meaning |
|---|---|
| kind | finding, retro, practice, limit, note |
| week | the week it is about |
| refs | message ids, JSON |
| practice | practices.id |

### limits
Limits the person set (limits.json): stopHour, daysOffPerWeek, maxSessions. Null when not set.

| column | meaning |
|---|---|
| key | the limit |
| value | its value; stopHour is an hour of the day, 21.5 is 21:30 |

### memory
What agents saved about the person in Claude Code memory (user and feedback notes).

| column | meaning |
|---|---|
| reads | times Claude opened it |
| written | the day it was first written |
| taught | id of the message of yours that led to it |

### meta
When the file was built, from what, and the coverage: key and JSON value.

| column | meaning |
|---|---|
| key | built, inputs, coverage, label_versions, vitals_source, vitals_about, git, limits, app |

## The skills

`skills/wimym/SKILL.md` answers open questions about oneself with this CLI; `skills/retro/SKILL.md`
runs the weekly retro. To use them in every Claude Code session, put `bin/` on your PATH and link the
skills into your skills folder:

```bash
ln -s ~/mirror/bin/wimym /usr/local/bin/wimym
ln -s ~/mirror/skills/wimym ~/.claude/skills/wimym
ln -s ~/mirror/skills/retro ~/.claude/skills/retro
```

Then `/wimym Am I more scattered on days I start before 7?` or `/retro`.
