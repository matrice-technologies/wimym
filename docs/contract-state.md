# Contract: `GET /api/state`

What the engine is doing, for the header's status and a first-run loading screen. The server answers
from its first second: the first build runs in the background, and until it ends the data endpoints
(`/api/core`, `/api/messages`, `/api/vitals`, …) answer `{"state": …, "data": null}`. Poll every second or
two while `first` is true, then every 30 seconds. The engine session owns this; it may add fields.

```jsonc
{
  "generated": null,                        // when the data last changed; null until the first build ends
  "state": {
    "phase": "indexing",                    // starting | indexing | history | measuring | git | ready | error
    "label": "Reading 4,600 transcripts… 1,136 so far",   // plain words to show as is
    "done": 1136, "total": 4600,            // progress of this phase when it has one (indexing, git), else 0 and 0
    "first": true,                          // true until the first numbers exist: show the loading screen
    "found": {                              // the first numbers, growing while the engine reads
      "conversations": 1136,                // sessions read so far (subagents left out)
      "messages": 5999,                     // prompts of yours found in them
      "firstDay": "2026-07-01",             // the earliest of them (YYYY-MM-DD), or null
      "history": 7529,                      // prompts in Claude Code's history.jsonl (0 if none)
      "repos": 10, "commits": 8757          // once git is being read
    },
    "updated": "2026-10-22T23:52:10",       // last time new transcripts were read
    "error": null                           // the last error, when phase is "error"; the last good data stays served
  }
}
```

Phases, in order on a first run, with the label each one shows:

| phase | label |
|---|---|
| starting | Waking up |
| indexing | Reading 4,600 transcripts… 1,136 so far (or "Checking for new conversations" on a warm start) |
| history | Reading your prompt history (history.jsonl and Codex sessions) |
| measuring | Measuring your weeks (the model and the vital signs, 5 to 30 seconds) |
| ready | Up to date: `first` turns false here, and the data endpoints answer |
| git | Reading your git history… 3 of 10 repositories (after the first page, every five minutes) |

On Alex's Mac a first build from nothing (4,600 transcripts, a loaded machine) takes about 34 seconds to a
ready page; a new user with a few dozen transcripts, under 2 seconds. Git follows in 10 to 40 seconds,
while the page is already up.

The fields the app read before (`phase`, `done`, `total`, with `phase` "indexing" while reading) keep their
meaning.
