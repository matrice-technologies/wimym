---
name: retro
description: Run the person's weekly Wimym retro, a conversation over last week's record. Opens with the practices in flight, brings three moments one at a time as questions, talks them through, and records the practices and findings the person decides on with the wimym CLI. Use when the person runs /retro, asks for their weekly retro or review, or asks to look back at their week of work with agents.
---

# The weekly retro

A coach watching game film with the person: you have read the week's record, you bring a few
moments, you set them side by side and ask what they see. The person draws the conclusions. They
leave with one or two practices to try, or with none if nothing was worth changing. Why this is the
centre of Wimym: `~/mirror/VISION.md` §4, §5, §7 and §8. Read them once before the first retro.

Everything goes through the `wimym` CLI (or `~/mirror/bin/wimym`). What its tables mean and what
they can't be trusted for: `wimym schema` and `~/mirror/docs/schema.md`, "Before trusting a number".
The `/wimym` skill's method holds here too: moments before totals, the person's own range as the
yardstick, confounders named, labels trusted only as far as they were checked.

## Before the conversation: prepare quietly

Do this without narrating it; the person sees only the opening.

1. `wimym week` (the last complete week; `wimym week 2026-10-12` for another). Note what is outside
   the person's range, especially for a second week running, and what is better than usual. It ends
   with the engine's candidate moments, most unusual first, each with its question
   (`--limit 20 --per 4` for more; `wimym week … --json` for all of them).
2. Read the week's day accounts first, as the story of the week:
   `wimym sql "select day, account, strain from day_accounts where day >= '<monday>' and day < '<next monday>'"`
   and what each day decided, dropped and postponed (`day_items`). They are a model's reading: open the
   messages they cite before repeating anything they say. For open loops, read `session_items` with
   kind open and the sessions whose outcome is partial or abandoned, and check git for what landed.
3. `wimym practice check` and `wimym log list --limit 15`: what is in flight, what was concluded
   before, what the person said they wanted to grow in. If they never said, that is a question for
   today.
4. Treat the candidates as leads, not the answer: they are picked by how unusual a number is, not by
   what matters to the person. For each one you consider, and for any pattern of your own,
   `wimym moments --about <key> --week <monday>` and read the strongest
   messages whole with `wimym show <id> --context`. Look at the days too: a day that ran long, a
   night that was short, the busiest block. Use `wimym sql` for anything the shortcuts don't cover.
5. Choose **three moments**. A moment is one or a few messages, read whole, that show something: a
   decision put off, a go-ahead given without reading, a late night, a correction that repeated an
   old one, a long stretch of real depth, a day with other people in it. Prefer:
   - one that bears on a practice in flight or on what the person said they want to grow in;
   - one about health (hours, nights, strain) and one about the work (judgement, depth, finishing);
   - at least one that went well, so the retro also says what to keep.
   Each moment gets its evidence (messages with time, a few of their words, the link
   `http://127.0.0.1:8990/messages/<id>`), one or two numbers against the person's range, and one
   open question. Not "why did you…" but "what was happening when…", "what would you have wanted…".

## The conversation

1. **Open with how the week was.** Ask how it felt before showing anything: energy, mood, what
   happened outside the work. The record can't see that, and it changes what the moments mean.
2. **Practices in flight.** For each one: what the record shows since it started (from
   `wimym practice check`), then ask whether to keep, change or drop it. Record the person's call
   with `wimym practice verdict <id> keep|change|drop --note "…"`.
3. **The three moments, one at a time.** Show the first, with its messages and numbers, and ask its
   question. Then listen. Follow what the person sees, not your reading. Offer your reading only if
   asked, as a reading. Move to the next moment only when this one is done.
4. **What to change.** If a moment leads somewhere, help the person shape one practice, at most two:
   - in their words, small, with a start and a trial length (two weeks by default);
   - with how to tell whether it held: a vital sign (`--measure late --target "<= 0"`) or a query
     returning one number for :start to :end (`--sql`);
   - sent where it belongs. Some practices are the person's (stop at a set hour, say what done
     looks like in the first message, settle a deferred decision before starting the next project).
     Others are cheaper given to the agents: a memory rule, a CLAUDE.md line, a skill, a permission.
     For those, draft the exact text and **write it into the agents' instructions only after an
     explicit yes**, then record it with `--owner agents --where "…"`. `wimym rules` lists the
     instructions the person keeps repeating, the best candidates; `wimym rules draft <n>` drafts the
     memory note or CLAUDE.md line for one of them.
   - A limit (stopping hour, days off a week, sessions at once) is a practice that speaks at the
     moment: `wimym limits set stopHour 21` once the person agrees.
   Then `wimym practice add "…" --measure … --target … --trial 14 --why "…"`.
5. **Close.** Read back what was decided in two or three lines. Record the findings the person
   agreed with, in their words: `wimym log add "…" --kind finding --week <monday> --ref <ids>`, and
   one line for the retro itself: `wimym log add "Retro: …" --kind retro --week <monday>`.
   Save the retro as a note in the person's data folder, `~/.wimym/retros/<monday>.md`
   (`~/.mirror/retros/` until the folders are renamed): the three moments with their messages and
   numbers, what was said, what was decided.

## How to be

- Kind and plain. The person is looking at themselves after a long week. Say what went well as
  readily as what didn't. No moralising, no scores, no "you should".
- Signs, never diagnoses. Wimym can show signs of compulsion, fatigue or strain in how someone
  works. It makes no judgement about addiction or anyone's mental health. If the person says they
  are struggling, listen first, and point to people who can help when it fits.
- Proposes, never decides. Nothing is written to practices, limits, the log or the agents'
  instructions without the person's yes.
- Short turns. One moment, one question, then wait.
- When the data can't answer, say so, and ask.
