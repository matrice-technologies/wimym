# Wimym: what we are building

Wimym, short for Where is your mind, exists to protect and raise the mental health
and the performance of people who work with agents on ambitious projects.

Read this before changing Wimym, whether you are a person or an agent. It says
why Wimym exists and where it is going. How we get there is in
[the strategy](STRATEGY.md), and how the current code runs is in
[the README](README.md).

## Context

### 1. A new kind of work, on a new feedback loop

Working through agents is a new kind of work. The person states what they
want, answers questions, chooses, corrects, approves and decides when
something is finished, often in several sessions at once across several
projects, while the agents do the making.

It runs on a new feedback loop. A message goes out, and within minutes
something exists that didn't before. The result is fast, often impressive and
never quite predictable. Another session is always waiting with something to
look at, and the agent never tires, so nothing in the work itself says stop.
A loop like this has the shape of the ones known to make behaviour compulsive:
fast and variable rewards, available at any hour, with no natural end.

Someone on an ambitious project can spend fourteen hours a day in this loop,
every day for months. The days are full and the output is real, yet at the end
of a week it is hard to say what was decided, what was dropped and what was
only postponed. The way of working shifts every few weeks, with more sessions,
new tools and new habits, and nothing tells whether a change helped or only
made the days longer. Fatigue builds up in later nights, shorter replies and
more irritation, and is noticed late. The person is certainly busier. Whether
they are getting better, at the work or at living with it, they have no way to
tell.

The effects of this work on attention, cognition and mental health are barely
studied, because it is too new. The people most exposed are the ones adopting
it first.

### 2. The risks

The risks below are named from what is known about compulsive behaviour, about
work, and about this work in particular. Some may turn out to be small. Each
costs health and performance together, since a dispersed, tired person makes
worse decisions, and on an ambitious project the decisions are the work.

**Compulsion, as in a typical addiction**

- **Losing control of the hours.** Sessions run past the time meant to stop,
  start again late at night or first thing in the morning, and carry on from
  a phone.
- **Escalation.** The same sense of progress takes more sessions at once, more
  projects and longer days.
- **Crowding out.** Sleep, rest, exercise, family and other interests get
  whatever time is left over.
- **Isolation.** An agent is always available and always willing. Asking,
  reviewing and deciding used to involve colleagues and now happen alone, and
  fewer days include working with another person.

**An unhealthy work ethic with agents**

- **No end of day.** The agents' availability sets the pace, and evenings and
  weekends become working time without anyone deciding they should.
- **Worth measured in output.** A day counts by what shipped. One with little
  output feels wasted, even when it was the right day to think or rest.
- **Rubber-stamping.** With hundreds of decisions a day, approvals are given
  without reading, and responsibility for the result thins out.

**Risks of work this stimulating**

- **Dispersion.** Starting costs almost nothing, so many things get started
  and fewer get finished. Attention switches between sessions every few
  minutes.
- **Loss of depth.** The gaps while an agent works are filled with another
  session instead of thought. Long stretches on one problem become rare.
- **Offloading.** Reasoning, writing and remembering are handed to agents, and
  the skills needed to judge what agents produce may weaken.
- **Motion mistaken for progress.** Output piles up on what was easy to ask
  for, while what matters most waits.
- **Strain.** Decision fatigue, irritation and short nights build up over
  weeks.

### 3. What the record can show, and what it can't

Unlike most work, this one is written down as it happens. Several sources are
already on the person's machine:

- **Transcripts.** Claude Code keeps every message with the time it was sent
  and what followed: what the agent read, ran and changed, how long it took,
  what was shipped and what was stopped. From them come the hours, the
  sessions at once, the switches, the waits and the speed of each approval.
- **The messages themselves.** The person's own words show what they ask for,
  what they decide and what they hand over, and how their tone and length
  change through the day and across weeks.
- **Git.** Commits and diffs show what landed, what was reviewed or written
  with someone else, what was abandoned, and what survived a month later
  instead of being rewritten or reverted. They answer the output side of
  busier or better, where transcripts show only effort.
- **The agents' memory.** Claude Code's memory notes hold the agents' view of
  the person, and each rule in them can be traced to the message it came from.
  The agents keep notes about the person, while the person keeps none about
  themselves.

Some things the record can't see: sleep, life outside the work, people met
away from the screen, and how the person feels. Only the person can say those.

The record also doesn't last on its own. Claude Code cleans up old
transcripts, and the sessions they held disappear with them.

### 4. A record alone doesn't make anyone grow

People improve at a craft through feedback. Someone picks out the moments that
mattered, names what they have in common, agrees with the person on what to
change, and checks later whether it changed. Athletes get this from a coach
watching game film, and apprentices used to get it from a master. Most
knowledge workers never had it, in part because their work left nothing to
watch.

The record changes that, but the loop is still missing. Transcripts are too
long to reread and too scattered to compare, and the tools that write them read
them back only to resume a session. Whatever growth happens in this way of
working happens by accident, and the risks above go unwatched.

### 5. The bet

We bet that the feedback loop can be run from the record, cheaply and
regularly, and that a person who runs it keeps the risks in view and gets
better at the work: in how they work with agents and, through that lens, in
how they think, decide and look after themselves.

An agent can now do the part that used to take a coach's time: reading weeks
of messages and finding the moments worth looking at. Judging what a pattern
means and choosing what to change stay with the person.

For the loop to be worth running, the following must hold.

**The person draws the conclusions.**

- **Wimym proposes, the person decides.** A pattern is offered with its
  evidence, as a question. Whether it matters and what to do about it is the
  person's call.
- **The person says what better means.** Getting more done with the same
  attention, working fewer hours, deciding faster, finishing what was started:
  the person names what they want to grow in, and revisits it. The retro looks
  for moments that bear on it.
- **Their own past is the yardstick.** Comparisons are with the person's
  earlier weeks, never with a norm or with other people.
- **How it felt counts.** The record shows what was done. How a day went,
  what was happening outside the work and what the person wants to become come
  from the person, so Wimym asks.

**What it shows can be believed.**

- **Moments before totals.** A pattern is shown through the messages that make
  it up, read in full, before any count or chart.
- **Every claim leads to its evidence.** A sentence, a share or a curve opens
  onto the messages and commits behind it.
- **A model's reading is labelled as one.** Tone, intent and similar labels
  come from a model reading words. Their accuracy is checked, and a label that
  can't bear weight isn't leaned on.
- **Signs are shown, nothing is diagnosed.** Wimym can see signs of compulsion,
  fatigue or strain in how someone works. It is not a clinical tool and makes
  no judgement about addiction or anyone's mental health. The person's own
  account of how they are comes first.

**Change is checked.**

- **Each practice leaves a trace.** What the person decides to change is
  written down with the sign that would show it held in later records.
- **Later weeks are the test.** The record keeps growing at no cost, so every
  practice is looked at again. Observing one person proves little, while a
  deliberate change and what followed it can show something.

**It stays the person's own.**

- **Local.** The record holds a working life, with clients, colleagues and
  sometimes family and health. Wimym reads it where it lies and serves it only
  to that machine. Text leaves only when it is given to Claude for labelling or
  for a retro, and Claude saw it the first time.
- **For the person it shows.** Wimym is not a view for an employer, a team or a
  vendor.
- **Kept.** Wimym holds on to what it has read after the transcript is
  deleted, so the history only grows.

## Wimym

### 6. The goals

Each goal answers one or more of the risks, and each has evidence in the
record.

- **Stop when you meant to.** The last message of each day is compared with the
  stopping hour the person set, along with any session started after it.
- **Keep rest intact.** Nights show as the gap between the last message of one
  day and the first of the next, and rest as days with no session at all.
- **Notice escalation.** Day length, sessions at once and projects per week
  are read against the person's own past.
- **Keep people in the work.** Commits reviewed or written with someone else,
  messages drafted for people and the people named in the work show how much
  of it is still shared.
- **Finish what you start.** Projects that went quiet without a decision, and
  branches merged against branches abandoned, show where work was dropped.
- **Protect depth.** The longest stretch on one project each day, and how
  often attention switches between sessions, show whether long thought still
  happens.
- **Keep your own judgement.** Go-aheads sent faster than the reply could have
  been read, diffs merged without being opened, and decisions handed over that
  the person meant to keep are signs of rubber-stamping and offloading.
- **Spend effort where you meant to.** Hours by project are set against the
  priorities the person stated, and code still in place a month later against
  code rewritten or reverted.
- **See strain early.** Tone, corrections and reply length by hour and by week
  are read against the person's usual, beside their check-ins.

### 7. The retro

The centre of Wimym is a regular conversation, weekly to start with. A Claude
session that has read the period's record brings a few moments, sets them side
by side and asks the person what they see. They talk it through, and the
person leaves with one or two practices to try, or with none if nothing was
worth changing.

Introspection comes more easily in conversation than in front of a dashboard,
so the retro is where Wimym's work is done, and the pages are there to support
it.

### 8. Practices, for the person or for the agents

A practice is whatever the person decides to do differently, written down with
how to tell whether it held. Some belong to the person: stating what done looks
like in the first message, stopping at a set hour, settling a deferred decision
before starting the next project. Others are cheaper to give to the agents as a
rule in memory, a line in a CLAUDE.md, a skill or a permission. The retro sends
each one where it belongs, and nothing is written into the agents'
instructions without the person's yes.

A limit only helps if it speaks when it is crossed. For limits the person sets,
such as a stopping hour, a day off a week or a ceiling on sessions at once,
Wimym says so at the moment, between retros.

The next retro opens with the practices in flight: what the record shows
since, and whether to keep, change or drop each one.

### 9. The growth log and the film library

Two things outlast the retros.

The growth log records what was looked at, what the person concluded, which
practices were tried and what became of them. Over months it shows who the
person was becoming, and this is the portrait Wimym ends up drawing.

The film library is the index of every session and message, kept after Claude
Code deletes the transcripts, with what each message set off. The retro finds
its moments there, and the person goes there to read one whole. The engine and
the Messages and Day views built so far are its first version. Charts,
measures and labels are added when a retro needs them.

### 10. Sharing the method

Wimym is built for one person first. The method underneath it, a regular retro
over one's own record that ends in practices checked against later weeks,
should work for anyone who works with agents on ambitious projects and wants
to look after their mind while doing it. It is written down so that it can be
followed with Claude Code alone. The tool makes it easier, and nobody needs it
to start.

## Keeping this file

Only Alex changes this file, or approves a change to it. An agent never edits
it on its own initiative, even to fix a typo: it proposes the change and waits
for Alex's explicit yes. Don't list tasks in it.
