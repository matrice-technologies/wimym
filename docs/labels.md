# Labels

What each label file in `~/.wimym/labels/` (still `~/.mirror/labels/` during the sprint) holds, how it was made,
how far it can be trusted and what it cost. The wording each model gets is in `labeller/definitions.json`, one set
per file, each with a version. A label feeds a measure only once its accuracy is known (STRATEGY.md §3).

All calls go through `claude -p` on the subscription (no API key), with no tools, no MCP, no session saved, in an
empty folder. Costs below are the list-price equivalent `claude -p` reports, not money spent. Every file keeps its
own log: `calls` (one entry per call: messages, tokens in and out, seconds, cost, model) and `runs` (one per run).

## How a set is made

1. A definition in `definitions.json`, with a version.
2. A run on a sample, about 200 messages (40 sessions, 15 days).
3. A second judge: Opus reads what the labeller saw and marks each label right or wrong with a reason
   (`labeller/judge.py cards`, then `judge.py score`). Message samples add messages picked by keyword so that rare
   values (defers, self-state, people, rules) have enough cases to measure; the random rate leaves those out.
4. Wording fixes, a version bump, and the full run.

```sh
export WIMYM_CACHE=~/.cache/wimym-dev WIMYM_DATA=~/.mirror   # during the sprint
python3 labeller/label.py --set acts --all --jobs 16                # messages (Haiku)
python3 labeller/accounts.py sessions --all --per-call 3 --jobs 12  # sessions (Opus)
python3 labeller/accounts.py days --all --jobs 12                   # days since 29 Jun (Opus), after sessions and acts
python3 labeller/accounts.py weeks --all --jobs 12                  # weeks (Opus), after days
python3 labeller/accounts.py rules                                  # repeated rules (Opus), after acts
python3 labeller/label.py --history --all --jobs 12                 # March to June prompts: categories, then
python3 labeller/label.py --history --set acts --all --jobs 12      # acts, then
python3 labeller/accounts.py days --history --all --jobs 12         # their days
python3 labeller/judge.py cards acts --ids IDS.json --out DIR       # cards for an Opus judge; then judge.py score
```

`--jobs` sets the calls at once (at most 16). A call that fails on a rate limit or overload waits a minute before
its messages go back in the queue; each message is tried up to three times.

## What feeds measures ("checked")

A field feeds a measure only when `definitions.json` marks it `checked` on its set (the engine's
`labels.checked()`), and only for labels of the version the mark sits on: a version bump switches nothing on by
itself. Everything else is shown as a reading that hasn't been checked. Marked now:

| Set | Version | Checked fields | Why |
|---|---|---|---|
| categories | 3, 4 | `in` | The engine counts v2 intent already. In the research note `relabel.md`, v3 intent is as good as a v2 rerun against the Opus marks (26 and 25 of 38) and agrees with it as often as two v2 runs agree (79%). So the switch to v3 when the running relabel promotes it is seamless. Tone and "specific" stay unchecked: run to run, two v2 runs agree on only 75% of "specific", and the rare tones weren't measured again. |
| acts | 3, 4 | `dfr`, `dom`, `off`, `ppl` | 94–100% on the held-out random messages (`off` 85%). For `ppl`, only none against any value holds up (`with` against `mention` doesn't), and the engine can't express that. So a measure should read `ppl != "none"` ("days with people"), never `with` alone. |
| sessions | 5, 6 | `goal`, `outcome`, `decisions`, `rework`, `people`, `account` | 35/36 or better on the 40-session sample and 23–24/24 held out. `open` (33/37, 19/24 held out) stays a reading. |
| days | 5, 6 | `decided`, `dropped`, `postponed` | Across every days sample since v2 (12 + 12 held out + 8 history + 6 in the second person): decided 37/38, dropped 36/38, postponed 35/38. `high`, `low`, `strain` and the account are for reading, not counting. |

The second version in each row is the neutral wording (below, "Wording for anyone"): its marks were carried
over from the judged version without a new judge, because only the voice changed. The judged versions keep their
marks in the engine (`CHECKED` in `engine/wimym/labels.py`), so labels made before the change still count.

Not checked: `dec`, `dw`, `fw`, `names`, `st`, `rule`, `nd` in acts (rare values unreliable or too rare to
measure), weeks and rules (accounts and candidates to read, not measure inputs).

## The files

| File | Set, version | Model | Keyed by | What it holds |
|---|---|---|---|---|
| `acts.json` | acts v3 | Haiku | message id | What each message decides, puts off and hands over, who is in it, how he says he feels, a standing rule, the life domain, "Claude said done and it wasn't" |
| `sessions.json` | sessions v5 | Opus | transcript file id (`sid` in the engine) | One account per main session he typed in |
| `days.json` | days v5 | Opus | day, `YYYY-MM-DD` (5:00 to 5:00 local) | One account per day since 29 Jun |
| `weeks.json` | weeks v3 | Opus | ISO week, `2026-W42` | One account per week, with up to three moments for the retro |
| `rules.json` | rules v2 | Opus | (groups) | Standing rules he gave in two sessions or more, grouped |
| `categories-history.json` | categories v3 | Haiku | history id (`h-<ms>-<sid8>`) | Categories for the March to June prompts from `history.jsonl` |
| `acts-history.json` | acts v3 | Haiku | history id | acts for the same prompts |
| `days-history.json` | days v5 | Opus | day | One account per day from March to June (prompts only) |

Every file has `version`, `labels` (or `groups`), `calls` and `runs`. A label carries `h` (a hash of the
input it was made from) and `v` (the version); only labels whose `v` is the file's `version` count, and a
changed input is labelled again on the next run. Labels of an older version stay in the file until a new label
replaces them, so a version bump never loses work (rules keep the previous groups as `groups_v<old>`). Files are
written whole through a temporary name and `os.replace`. A file that won't parse is set aside as
`<file>.bad-<time>` and the run stops, so a damaged file is never replaced by an empty one.

Sessions v5, days v5 and weeks v3 write to Alex in the second person ("you decided…", "you said it worked"),
because he is the one reading them. Only the voice changed from the judged versions. A sample was judged again
by Opus: no field anywhere refers to Alex in the third person. Sessions v5: 79 of 80 fields right on 10 held-out
sessions (one open loop was Claude's own note). Weeks v3: every field right on 3 weeks. Days v5, on 6 days (4
since June, 2 from April and May): decided, postponed and low 6/6; dropped, high and strain 4/6; account 3/6 (two
too long, one with a mistyped id). `dropped` stays checked: 36 of 38 right across every days sample since v2. The judges' cards and marks are in `judge/` next to the files,
and the run logs in `logs/`.

## Jev: the message sets without Claude (24 Oct)

`label.py --engine jev` labels categories, signals and acts with TypeSafe's Jev instead of Haiku, through its
API with the person's own key, not their Claude plan. The key is optional: `label.py --key` asks for it
without showing it, checks it with TypeSafe and keeps it in `~/.wimym/typesafe.key` (mode 600), and while
that file exists Jev is the default engine; setup offers it in step 9 (`site/setup.md`). `TYPESAFE_API_KEY`
works too but doesn't change the default, so a key in the environment never switches a run by surprise. One request per message: the state is the message,
Claude's message before it and, for acts, the project; each choice field is a Choice question and each yes/no
field a Noul, in the same words as `definitions.json` (`--engine jev --prompt` prints them). A Noul over 0.5
is true, and each label keeps the probabilities behind it in `p`, so a threshold can be set against a judge.

```sh
python3 labeller/label.py --engine jev --set acts --dry-run   # what a full run would cost; nothing sent
python3 labeller/label.py --engine jev --set acts --check     # the stored sample and the Opus-marked messages,
                                                              # against the Opus marks and Haiku's labels
```

What differs from Haiku:

- **Text and list fields stay empty.** Jev picks and weighs; it doesn't write. So `dw`, `fw`, `names` and
  `rule` in acts are always empty, and `rules.json`, which groups `rule`, has nothing to group. None of them is
  checked. Sessions, days, weeks and rules are accounts, not choices, and stay with Opus.
- **Its own version.** Labels carry the version `<n>-jev` (`acts` v`4-jev`), so no mark a judge gave
  Haiku's labels counts for them; Jev's own judge (below) decides which fields count. One label file holds
  one engine's labels: a new person's Jev run writes straight into the labels folder, but a run that would
  set the other engine's labels aside stops. To try Jev beside Haiku's labels, run it with
  `--dir <labels>/jev` (which the engine doesn't read), and `--promote --engine jev --dir <labels>/jev` moves
  it in once a full run is complete.
- **Cost and speed.** About 2,000 tokens in per message for categories, 1,800 for signals and 3,500 for acts,
  at $0.042 a million (output is free), about 0.2 s a request. A dry run on 24 Oct put a full run of all three
  sets at about $2.30 at list price, against about $56 for the last Haiku runs (the table under "Wording for
  anyone").
- **Messages go to TypeSafe.** Its docs say Jev isn't trained on requests; zero retention is for enterprise
  accounts only.

**Against the Opus marks (24 Oct, jev-1.14.0, Alex's messages, into `labels/jev/`).** Categories and signals by
`--check` (the stored sample and every message in `audit-opus.json`); acts by `--ids` on the 453 messages of the
two acts judges (`judge/acts-v3`, `judge/acts-v3-heldout`), scored where Opus gave or confirmed a value. 902
requests, $0.11, under a minute in all.

| Field | Marks | Haiku | Jev |
|---|---|---|---|
| intent (`in`) | 38 | 33 judged labels; 25–26 on a rerun | 27 |
| tone (`to`) | 29 | 22 | 29 |
| says what done looks like (`sp`) | 21 | 16 | 17 |
| `own`, `who`, `sc`, `pr`, `irk`, `pl` | 24–29 each | 22, 24, 19, 21, 20, 19 | 22, 25, 20, 22, 26, 20 |
| acts `dfr`, random / held-out / keyword | 197 / 150 / 101 | 99% / 98% / 95% | 99% / 99% / 98% |
| acts `off` | 194 / 147 / 98 | 88% / 85% / 85% | 92% / 85% / 87% |
| acts `dom` | 187 / 142 / 100 | 98% / 99% / 97% | 96% / 96% / 97% |
| acts `ppl` none against any | 199 / 149 / 101 | 96% / 93% / 93% | 96% / 93% / 85% |
| acts `dec` | 197 / 148 / 102 | 95% / 90% / 89% | 96% / 91% / 91% |
| acts `st`, `nd` | about 150–200 each | 97–100% | 97–99% |

How to read it: the Haiku column is the labels Opus marked, and Opus saw them as it judged, so a mark of "right"
is Haiku's own value. That favours Haiku, and acts v3's wording was tuned on the 303-message sample before its
judge. The held-out 150 are the fairest acts column. Even so, Jev matches or beats Haiku on every checked field,
except `dom` (two to four points lower) and `ppl` on the keyword picks (people named in passing). Tone is the
clearest gain: Jev never inflated pleased or frustrated. Its intent misses lean towards build for design feedback
and towards plan or ship for "what's next?" questions. A Noul threshold of 0.5 was best or near best for `dec`,
`dfr` and `nd`; 0.7 gained one or two on `dfr` and `nd`.

**Jev's own judge (25 Oct).** The comparison above leans on marks Opus gave Haiku's labels, so Jev's labels had
their own judge, the way Haiku's had: `judge.py cards` from the Jev labels, 11 Opus judges of about 50 cards
each who saw only Jev's labels and the definitions, then `judge.py score`. Samples: the 150 held-out acts
messages (with the text fields left off the cards: Jev leaves them empty), and the stored random samples of
categories (200) and signals (198). Cards, marks and scores are in `labels/judge/jev-acts-heldout`,
`jev-categories` and `jev-signals`. Random cards right (Wilson 95%), next to Haiku's judge on the same kind of
sample (acts: the held-out 150; categories and signals: the 22 Oct audit's random cards):

| Field | Jev | Haiku | Checked for Jev |
|---|---|---|---|
| intent `in` | 180/195 (88–95%); every intent 70% or better as given | 18/19 | yes |
| tone `to` | 200/200 (98–100%); pleased 5/5, frustrated 5/5, none missed | 17/19; pleased 2/6, frustrated 4/7 | yes, on 10 rare cases |
| says what done looks like `sp` | 160/196 (76–86%); 34 missed yeses | 13/17 | no |
| not typed `ag` | 199/200 | — | no (the text rule decides) |
| acts `dfr` | 150/150 | 147/150 | yes |
| acts `off` | 140/149 (89–97%) | 125/147 (78–90%) | yes |
| acts `dom` | 146/148 | 140/142 | yes |
| acts `ppl`, none against any | 139/150; mention as given 3/11 | 139/149; mention 3/7 | yes, none against any only |
| acts `dec` | 142/149; true as given 15/19 | 133/148; true 14/24 | no: rare value |
| acts `nd`, `st` | 145/150 (true 2/4), 149/150 (one non-none) | 146/150, 149/150 | no: too rare to measure |
| signals `own`, `who`, `sc` | 190/197, 186/196, 182/197 | 19/20, 19/20, 17/20 | no measure uses them |
| signals `pr`, `irk`, `pl` | 196/198 each; pr and pl true 0/2 | 20/20, 18/20, 18/20 | no |

So `CHECKED` in `engine/wimym/labels.py` counts categories `in` and `to` and acts `dfr`, `dom`, `off` and `ppl`
at version `4-jev`. Tone is a first: Haiku's never held up, so for a Jev user strain counts frustrated messages
as well as corrections. Its rare values rest on 10 cases; a larger judge of pleased and frustrated is owed
before reading much into a weekly share of them. The judges saw the labels they marked, as Haiku's judges did.

## Wording for anyone (23 Oct)

Up to categories v3, signals v3, acts v3, sessions v5, days v5, rules v2 and weeks v3, every prompt named Alex
("a software founder (Alex)", "Alex's words", "he") and said messages were in English or French. Since Wimym ships
to other people, the next version of every set (categories v4, signals v4, acts v4, sessions v6, days v6, rules
v3, weeks v4) says "the person" and "they" for whoever typed the messages, says messages can be in any language,
and drops the examples from Alex's own life (his camper, the Truva team, a colleague's name). The inputs the
labeller builds name the speaker "Person" instead of "Alex", and the accounts still write to the reader as "you",
now told never to use a name or the third person. The stored key `alex` for "who makes the call" stays; the
prompt says it means the person who typed the message. The rules and guards are unchanged.

None of the new versions has been judged. A small Opus judge per set (the held-out samples) before the next
release is owed; until then their `checked` marks rest on the old versions' figures.

**Relabel for Alex: not needed.** His files stay at the old versions and keep counting through `CHECKED`. But a
version bump makes the next run of a set a full run: `label.py --all` or `accounts.py <set> --all` would relabel
every item of that set, not only the new ones. A dry run on copies of his files on 23 Oct
(`--dry-run`, nothing sent), with the cost of each set's last full run:

| Set | To go | Last full run |
|---|---|---|
| categories v4 | 8,064 (+ 7,152 history) | $14.19 (+ $10.19) |
| signals v4 | 7,901 | $13.92 |
| acts v4 | 7,901 (+ 7,148 history) | $28.12 (+ $20.80) |
| sessions v6 | 1,327 | $48.77 |
| days v6 | 102 (+ 85 history) | $10.61 (+ $6.58) |
| weeks v4 | 31 | $2.86 |
| rules v3 | 36 groups | $0.40 |
| **All** | | **about $156**, list price on the subscription |

There is no cheaper path: a new message gets a label at the new version only, and the file's version moves with
it. So until Alex chooses to pay for the full run, don't run the labeller on his data. When he does, run it into a
separate folder (`--dir`) and `--promote` it when complete, as the v2 to v3 relabel did, so his counts hold during
the run. Careful: `accounts.py rules` calls Opus whatever the flags (`--dry-run` is not read for rules).

## acts: what you decide, put off and hand over

One label per message Alex typed since 29 Jun (7,640), skipping what categories or the text rule find was
written by an agent. Haiku sees the project, 600 characters of Claude's message before (head and tail) and the
message.

| Field | Values | Meaning, in short |
|---|---|---|
| `dec` | bool | His words close a choice between alternatives, or rule something out, drop or park it |
| `dw` | text | When `dec`: what was chosen and over what, at most 12 words ("Postgres, not SQLite") |
| `dfr` | bool | Puts something off on purpose ("later", "for now", "not yet") |
| `fw` | text | When `dfr`: what is put off |
| `ppl` | none, mention, with | Another real person is in his words; `with` when the work is with or for them |
| `names` | list | Their names as written |
| `st` | none, tired, stressed, low, energised, unwell | What he says about how he feels, only in his own words |
| `off` | do, think, decide, ask, none | What the message hands to Claude: work, judgement, a choice, a fact, or nothing |
| `rule` | text | A rule about how Claude should work in general, beyond this task |
| `dom` | work, personal, health, family, admin | The part of his life the message is about |
| `nd` | bool | Claude's previous message said done, fixed or live, and his message says it isn't |

**Accuracy** (Opus second judge on 303 messages: the 200-message sample spread across projects and months,
plus 103 picked by keyword to give rare values enough cases; "random" counts the 200 only, Wilson 95%):

| Field | v1 | v2 | **v3** | v3, rare values given → right (all 303) | **v3 held out (150)** |
|---|---|---|---|---|---|
| dec | 166/196 | 171/199 | **188/198 (91–97%)** | true 40/50 (v1 62/98, v2 42/78) | **133/148**; true 14/24 |
| dw | 167/199 | 167/199 | **181/198 (87–95%)** | filled ones right 25/50 | **131/149**; filled 11/24 |
| dfr | 198/200 | 199/200 | **197/198** | true 12/14 | **147/150**; true 1/3 |
| ppl | 192/199 | 191/198 | **191/200 (92–98%)** | with 13/20, mention 4/10 | **138/149**; with 5/5, mention 3/7 |
| names | 199/200 | 200/200 | **197/200** | filled ones right 7/12 | **150/150** |
| st | 194/199 | 199/199 | **198/200** | stressed 1/2; energised was 1/9 in v1, never given since | **149/150** |
| off | 169/198 | 171/194 | **171/195 (82–92%)** | do 113/126, think 49/61, ask 55/61, none 37/45 | **125/147**; think 23/30, none 17/23 |
| rule | 197/198 | 199/200 | **197/200** | filled ones right 5/10 | **146/149**; filled 2/4 |
| dom | 191/194 | 188/193 | **184/188 (95–99%)** | admin 13/13, personal 7/7 | **140/142** |
| nd | 198/200 | 199/200 | **196/200** | true 4/10 | **146/150**; true 2/5 |

"Held out" is 150 random messages from the full run that were never used to tune the wording: the honest
figure. On the whole run: dec true on 932 messages (12%), dfr 217, ppl mention 407 and with 315, st not none
on 46, off do 3,049, ask 1,695, think 1,670, none 1,418, decide 31, rule filled on 180, dom not work on 342,
nd 202.

What to trust:

- **Good enough for measures**: `dfr`, `dom`, `off` as a share (do against think), `ppl` none against not none.
- **Use as readings, not measures**: `dec` (58 to 80% of the decisions it finds are right, and it misses some),
  `dw` (half the texts don't say what was chosen over what), `ppl` with against mention, `nd` (4 of 10 right:
  Haiku sees only 600 characters of Claude's claim).
- **Too rare to measure here**: `st` (he almost never says how he feels: 2 in 200 messages; the keyword
  picks found no real case Haiku missed), `rule` (5 right of 10 filled). `rules.json` regroups them with
  Sonnet and is the better way in.
- The marks are Opus's reading, not Alex's. Different judges differ in strictness by a few points.

Wording changes, v1 to v3, are in `definitions.json` (`changes`). The one that mattered: v3 asks for a decision
only when Haiku can name what it was chosen over or rules out, and `dw` must say so. That cut the false
decisions from 36 of 98 to 10 of 50.

## sessions: what each session did

One account per main session (not subagents) with at least one message he typed: 1,281 since 29 Jun. A fork
counts only the turns new in it. The input is his messages (with their 8-character ids and times) and Claude's
replies with what each turn did (tools, commits, pushes, PRs, stopped by him), cut to fit 36,000 characters:
long messages and replies are cut in the middle, and very long sessions keep their first and last turns whole.
Three sessions per call.

| Field | Type | Meaning |
|---|---|---|
| `scan` | text | Opus's working note: each of his messages marked decides, asks, yes, answers, rejects |
| `goal` | text | What he set out to do, one sentence |
| `outcome` | landed, partial, abandoned, answered, unknown | Judged against what he asked |
| `decisions` | `[{t, m}]` | His own decisions, each with the full id of the message whose words make it |
| `open` | list | This session's loose ends: what he asked for and didn't get, what he said he'd come back to |
| `rework` / `rw` | bool / text | The same thing done twice because a first result was wrong, and what |
| `people` | list | Real people the work is with, for or about |
| `account` | text | One or two plain sentences |

**Accuracy** (Opus judges, 40 sessions spread across projects and months):

| Field | v1 Sonnet | v2 Sonnet | v3 Sonnet | v4 Sonnet | **v4 Opus** | **v4 Opus, held out** |
|---|---|---|---|---|---|---|
| goal | 39/40 | 37/40 | 39/40 | 38/38 | **38/38** | **24/24** |
| outcome | 35/39 | 32/39 | 34/39 | 31/37 | **37/37** | **23/24** |
| decisions | 19/40 | 20/40 | 25/40 | 23/36 | **35/36** | **23/24** |
| open | 33/38 | 26/40 | 21/40 | 21/37 | **33/37** | **19/24** |
| rework | 35/40 | 37/40 | 37/40 | 36/38 | **37/38** | **23/23** |
| people | 30/40 | 30/36 | 36/40 | 35/37 | **37/37** | **23/24** |
| account | 36/40 | 35/40 | 33/40 | 38/38 | **38/38** | **23/24** |

"Held out" is 24 sessions from the full run that were never used to tune the wording: the honest figure.

v4 was judged blind: each judge marked both writers' accounts of the same sessions under neutral names. Sonnet
in `claude -p` doesn't think (about 300 tokens out per session) and kept listing go-aheads as decisions and
Claude's offers as open loops whatever the wording; Opus followed the same wording. **Decision: sessions are
written by Opus**, against the brief's Sonnet, for that reason. Every field is good enough to use; `open` is
the weakest (Claude's own offers still slip in now and then).

## days: what each day held

One account per day since 29 Jun with a message he typed (97 days), 5:00 to 5:00 local as in the app. The
input is the day's figures (first and last message, the gap since the day before, messages, sessions and
projects), the session account of every session he worked in that day, and his messages with ids, times and
the tags acts and categories gave them ({decides: …}, {puts off: …}, {state: …}, {frustrated}, {correction},
{Claude said done, it wasn't}). One call per day.

| Field | Type | Meaning |
|---|---|---|
| `decided`, `dropped`, `postponed` | `[{t, m}]` | His rulings, what he gave up for good, what he put off to later |
| `high`, `low` | `[{t, m}]` | Up to three moments each, visible in the message cited |
| `strain` | text | Grounded signs only (a short night, after midnight, his own words), with ids; never a diagnosis |
| `account` | text | Three to five plain sentences, with ids in brackets |
| `cites` | list | The full ids the account cites |

**Accuracy** (Opus judges, 12 days spread across months):

| Field | v1 Sonnet | **v2 Opus** | **v3 Opus, held out** |
|---|---|---|---|
| decided | 4/12 | **11/12** | **12/12** |
| dropped | 5/12 | **12/12** | **12/12** |
| postponed | 9/12 | **12/12** | **9/12** |
| high | 4/12 | **11/12** | **12/12** |
| low | 8/12 | **11/12** | **12/12** |
| strain | 4/12 | **10/12** | **11/12** |
| account | 3/12 | **9/12** | **9/12** |

The held-out misses: two accounts ran to six sentences, one pinned the day's session count on one project;
postponed once took a hand-over to another session, once cited a bare yes, once missed "down the line".

v3 adds two guards after the v2 judge: only what the input shows (one v2 account invented a session), and the
account reports how things stood at the end of the day. Cited ids that aren't in the input are dropped by the
labeller (`bad_refs` counts them). v4 adds a guard for March to June, where only his messages exist (see
below). These accounts feed the retro and the growth log: read them as a draft Alex can correct, not as the
record.

## weeks: what each week held

One account per ISO week (Monday to Sunday) with a day account: 31 weeks, from March to October. Built from the
day accounts only (days.json and days-history.json) and the week's figures; no new reading of the messages.

| Field | Type | Meaning |
|---|---|---|
| `account` | text | Four to six sentences: what the week was about and how time split across projects, what landed, the main decisions, what was left, how the days ran |
| `decided`, `dropped`, `postponed` | `[{t, m}]` | The week's most important ones, from the days |
| `open` | list | What the week leaves open |
| `strain` | text | Signs across the week, grounded in the days, with ids |
| `moments` | `[{t, m}]` | Up to three moments worth a look in the retro: a turning point, a pattern on several days, strain, a decision deferred again |

**Accuracy** (Opus judge, 5 weeks, v1): decided, dropped, postponed, open and strain 5/5; account 4/5 (one ran
to ten sentences); moments 3/5 (two weeks had chores among the moments, or an order the input didn't show).
v2 fixes both in the wording; it wasn't judged again. Every figure and cited id the judge checked was right.

## rules: what you asked for more than once

Every `rule` acts found (278 across both periods), grouped by Opus in one call that sees each rule with the
start of his own words and the feedback notes in the agents' memory. Groups with messages in only one session
are dropped.

`rules.json` has `groups`, most sessions first: `{rule, kind (writing, process, code, design, other), n
(messages), sessions, ids (full message ids), known (the memory note that already says it, or ""), first, last,
projects}`. 36 groups. The top ones: Opus for every agent and subagent (13 sessions); no mannered prose (12);
light prompts and skills (12); work in a worktree, not on main (11); proceed without asking (10); no em dashes
(9); minimal code comments (8); keep it lean (8). Eleven groups are in no memory note, the largest "reason from
first principles, not from existing material" (7), "don't let design.md anchor design work" (6) and "never push
or merge without asking first" (6). That last one pulls against "proceed without asking" (10): a question for
the retro, not for an agent to settle.

The memory notes were deleted from disk on 23 Oct at 00:33 (see below), so the final run matched groups against
the 30 note names the earlier runs had matched, kept in `memory-notes-seen.json`, not the full 196 notes.

**Accuracy** (Opus judges, every group, reading each member message's words):

| | v1 (the rules alone) | **v2 (with his words)** |
|---|---|---|
| rule says what the members ask | 29/36 | **36/36** |
| kind | 35/36 | **36/36** |
| known (note name fits) | 36/36 | **36/36** |
| groups with every member right | 20/36 | **18/36** |
| member messages that belong | 145/178 | **170/198 (86%)** |

The members that don't belong are mostly permissions for one task ("don't ask for permission" said about one
push) and picks among Claude's options. So `n` and `sessions` run a little high, and two of the smallest groups
would fall to one session without their stray member. Read a group as a candidate rule with its messages to
look at, not as a count.

## March to June: the history files

`history.jsonl` keeps each prompt typed in the terminal from 23 Mar, with no reply. The engine keeps them in
`history.json`; the labeller takes the ones no transcript holds (7,152 prompts) and labels them into separate
files, never into `categories.json` or `acts.json`: `categories-history.json` (categories v3), `acts-history.json`
(acts v3) and `days-history.json` (days v3; the few older agent-mode transcripts the index holds join their days).
Haiku saw no reply before each prompt, so the labels that lean on it are weaker there: `correct` against `fix`,
`nd` (almost never true), `dec` when it picks one of Claude's options. The day accounts say what Alex asked and
decided, not what landed.

**Accuracy** (Opus judge, 8 days from April to June):

| Field | v3 | **v4** |
|---|---|---|
| decided | 6/8 | **8/8** |
| dropped | 6/8 | **8/8** |
| postponed | 8/8 | **8/8** |
| high | 4/8 | **7/8** |
| low | 8/8 | **8/8** |
| strain | 8/8 | **7/8** |
| account | 2/8 | **4/8** |

v3 accounts said work was built or pushed when Alex had only asked for it; v4 fixed that (none left). The four
v4 accounts marked wrong run to six or seven sentences, and one cites an id with a typo (dropped by the
labeller). categories and acts on these prompts weren't judged separately.

## Runs and cost

List-price equivalents that `claude -p` reports; the calls ran on the subscription. "All calls" includes the
samples, the wording rounds, a v1 run of sessions stopped part way, and the second-person reruns of sessions,
days and weeks.

| File | Items | Full run | All calls |
|---|---|---|---|
| acts.json | 7,863 | 48 min, $28.12 (16 at once) | $35.73 |
| sessions.json | 1,325 | 13 min, $48.77 (Opus, 12 at once) | $124.33 (Sonnet v1 to v4 and Opus v4 included) |
| days.json | 101 | 4 min, $10.61 | $32.78 |
| weeks.json | 31 | 1 min, $2.86 | $10.04 |
| rules.json | 36 groups | 1 min, $0.40 | $1.07 |
| categories-history.json | 7,152 | 49 min, $10.19 (6 at once) | $10.19 |
| acts-history.json | 7,148 | 43 min, $20.80 | $20.80 |
| days-history.json | 85 | 3 min, $6.58 | $19.74 |
| **Total** | | | **about $260** |

The Opus second judges ran as subagents of the labels session, outside these logs: 43 judge runs, about 5
million tokens.

## Decisions taken during the sprint (22 to 23 Oct)

- **Sessions, days, weeks and rules are written by Opus**, not Sonnet. In `claude -p` Sonnet answers without
  thinking and didn't follow the wording on decisions and open loops; on the same 40 sessions, judged blind, Opus
  got decisions right 35/36 against 23/36.
- **acts holds the brief's message signals plus three more fields** in the same call: life domain, "Claude said
  done and it wasn't", and the standing rule that feeds `rules.json`. One full run instead of three.
- **self-state got a "low" value** (discouraged, sad) next to tired, stressed, energised and unwell.
- **The judge samples add messages picked by keyword** so rare values have cases; the random rate leaves them out.
  A held-out set from each full run gives the honest figure.
- **Days run 5:00 to 5:00**, as in the app. Days before 29 Jun go to `days-history.json`.
- **Week accounts were added** (STRATEGY §3 lists day and week accounts), with moments for the retro.
- **Rules are grouped by Opus** from the rules acts finds, with the start of each message's words.

## The 23 Oct loss, and what it means for these files

On 23 Oct at about 00:33, during the sprint, the real `~/.claude/projects` was emptied: every older transcript
and every memory note under `~/.claude/projects/*/memory`. The likely cause is `engine/tests/test_signals.py`,
whose `reset()` removes `PROJECTS`. When another test module imports `wimym.paths` first, `PROJECTS` is the real
folder, not the test's temporary one. The labeller only reads Wimym's index, which keeps a record of each
transcript after it is deleted, so every file above was built from the full record. Copies of the indexes
taken at 00:35 are in `~/.mirror/labels/rescue-2026-10-23-0035/`. Recovery is Alex's call.

Two effects on labels: the rules run had to use the 30 note names it had matched before (in
`memory-notes-seen.json`); and a session that was running at 00:33 has a new transcript from that time on, so
its record in the index may hold only its later part.
