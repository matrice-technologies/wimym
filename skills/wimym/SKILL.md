---
name: wimym
description: Answer the person's open questions about how they work with agents ("Am I more scattered on days I start before 7?", "What did I put off this month?", "Does xhigh effort mean fewer corrections?") from their own record with the wimym CLI, with the messages behind every claim. Use when the person runs /wimym, or asks about their own hours, focus, habits, moods, decisions, corrections, projects or progress as recorded in their Claude Code history.
---

# Ask your own record

Wimym keeps the person's working record: every message they typed to Claude Code (in full since
29 Jun 2026, prompts only from 23 Mar), what each one set off, git commits, labels a model gave the
messages, and what the person wrote down (check-ins, practices, the growth log). The `wimym` CLI is
the way in. You answer the question from it, the way a good coach would: with the moments first, the
person's own past as the yardstick, and plain words about what the data can't say.

Why this exists and what it must never become: `VISION.md` in the Wimym repository
(below).
The short version: it is for the person it shows, it proposes and the person decides, it shows signs
and never diagnoses, and how it felt counts as much as what was done.

## Getting in

The Wimym repository is wherever the person keeps the code, `~/wimym` by default: this skill is
linked from it, so `readlink -f ~/.claude/skills/wimym` ends in `<repository>/skills/wimym`. Paths
below are in that folder. `wimym` is on the PATH once linked (`./install.sh --link`); otherwise run
`<repository>/bin/wimym`. Start every answer by loading what you need, not everything:

```bash
wimym schema                 # tables and columns with meanings, and the coverage dates
wimym schema messages        # one table in full
```

Read the "Before trusting a number" section of `docs/schema.md` once per conversation. It is
short and it is the difference between an answer and a wrong one.

The commands:

| Command | For |
|---|---|
| `wimym sql "…"` | any read-only query; several statements are fine; `--json` for full rows |
| `wimym week [YYYY-MM-DD]` | a week's vital signs against the person's range, its days, and moments |
| `wimym moments --about <key> [--week …] [--since … --until …]` | the messages behind a pattern, spread over days, with the usual weekly count. Keys: corrections, frustrated, strain, unread, stopped, defers, defer_words, decides, people, selfstate, late, early, switches, stretch, own, handed, questions, or a label `field=value` (intent=fix, dfr=true) |
| `wimym show <id>` | one message whole: the words, Claude's reply, what it set off, what came next. 8-character id prefixes work; `--context` adds Claude's message before |
| `wimym practice list\|check` | practices in flight and whether they held |
| `wimym log list` | the growth log: what was concluded before |
| `wimym limits` | the stopping hour and other limits the person set |
| `wimym rules [draft <n>]` | instructions the person keeps giving the agents, whether a memory note already says it, and a draft note to approve. It never writes to ~/.claude |

Output is short on purpose. Ask for `--json` or `--limit` only when you need more.

## The method

1. **Turn the question into something the record can show.** "Scattered" might be switches between
   sessions per active hour, projects touched, or the longest stretch on one thing. Say which you
   chose and why, in one line. If the question is about something the record can't see (sleep, how a
   day felt, life outside the work), say so plainly and ask the person, or look at check-ins.
2. **Moments before totals.** Before any count, find two to four messages that show the pattern and
   read them whole with `wimym show`. Quote a few words of each, with the time, and a link
   (`http://127.0.0.1:8990/messages/<full id>`). If the moments don't look like the pattern, the
   count is measuring something else: say so.
3. **The person's own range is the yardstick.** Compare with their own earlier weeks or days
   (`vitals.lo/mid/hi`, or a query over the 8 weeks before), never with a norm or with other people.
   Give the number, their usual range, and how many days or weeks it rests on.
4. **Name the confounders.** The calendar moves everything at once: effort xhigh was August and
   September, high is October, Opus 5.5 arrived on 23 Sep, the projects changed, prompts moved from
   the terminal to the desktop app in June. Weekdays, the kind of work and how many sessions run at
   once also move together. A split by any of these is a lead, never a finding. When groups are
   small, say how small.
5. **Trust labels only as far as they were checked.** intent is good; correct and design are good;
   tone (frustrated, pleased) is inflated; scope, pressure, irk and play are unusable; signals cover a
   199-message sample; new sets (acts: decides, defers, withPeople, selfState, handsOver, domain; sessions: goal, outcome, rework, open) are unaudited. A label you can't lean on can still
   point you to messages to read.
6. **Say plainly when the data can't answer.** "The record can't tell" is a good answer when it is
   true, followed by what would let it tell: a check-in, a label to make, a practice to try.
7. **A question about cause ends in a practice to test it.** One person's record can't separate
   cause from coincidence. A deliberate change can: propose one, with the measure that would show
   whether it held and for how long to try it, and offer to record it (`wimym practice add`) if the
   person says yes. Never record a practice, limit or log entry without their yes.

## What the model readings add

Besides numbers, the database holds a model's readings of the record. They are not checked
(`label_status` says what is), so they find things to read; they don't count.

- **Day accounts** (`day_accounts`, `day_items`): the story of a day, and what was decided,
  dropped, postponed, its high and low points, each with its message. Start a question about a
  period by reading its accounts: they say what the days were about before any number does.
- **Session outcomes** (`sessions.goal`, `outcome`, `session_items` with kind open): what each
  session set out to do, whether it landed, and the loops it left open. For "what did I put off" or
  "what did I leave unfinished", read the open items and the sessions marked partial or abandoned,
  then check git (`commits`, `branches`) for whether the work landed anyway.
- **Acts on messages** (`decides`/`decision`, `defers`/`putOff`, `withPeople`/`people`, `selfState`,
  `handsOver`, `rule`, `notDone`): who decided what, what was put off, who else was in the work.
- **Rules** (`wimym rules`): instructions given again and again, a sign the agents keep forgetting
  something. When a question touches repeated friction, look there: a rule given five times is a
  practice to give the agents (`wimym rules draft <n>` proposes the text; only the person adds it).

## Shape of an answer

- First sentence: the answer, as plainly as the data allows, with its confidence.
- Then the moments: 2 to 4 messages, each one line (when, project, a few of their words, the link).
- Then the numbers: the measure, this period against the person's range, n.
- Then what could explain it besides the obvious, and what the data can't say.
- End with a question for the person, or a practice to test, or both. Keep it short; the person can
  ask for more.

Write in plain words, kindly. The person is looking at themselves: name what is going well as
readily as what isn't, and don't moralise. Signs, never diagnoses.

## Queries that come up

```sql
-- the days, with when they started and how scattered they were
select v.period day, s.value start_h, v.value switches_per_h
from vitals v join vitals s on s.period = v.period and s.grain = 'day' and s.measure = 'start'
where v.grain = 'day' and v.measure = 'switches' and v.value is not null;

-- corrections by effort, on comparable work only (requests for work, transcripts only)
select effort, count(*) n, round(100.0 * avg(next = 'correct'), 1) corrected_next
from messages where origin = 'transcript' and intent in ('build', 'fix', 'design') group by effort;

-- the same, month by month, to see the calendar in it
select substr(day, 1, 7) month, effort, count(*) n, round(100.0 * avg(next = 'correct'), 1) pct
from messages where origin = 'transcript' and intent in ('build', 'fix', 'design') group by 1, 2;

-- sessions left open: what the sessions labels say was left to do (unaudited)
select s.day, s.project, l.value from labels l join sessions s on s.sid = l.id
where l."set" = 'sessions' and l.field = 'open' and l.value != '[]' order by s.day desc;

-- branches nobody came back to
select project, name, date(at, 'unixepoch') tip, ahead from branches order by at desc;
```

`messages.next` is the intent of the person's next message in the same session, so
`next = 'correct'` reads "the request was followed by a correction". `vitals` rows with
`grain = 'day'` carry each day's value and the range of the 56 days before.
