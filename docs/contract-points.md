# Contract: `GET /api/points`

Every message of yours as one compact row, for drawing (the front page's planet, a focus ribbon), so a page
can show the whole record without loading `/api/messages` (19 MB raw). On Alex's data: 16,394 rows,
130 KB gzipped (540 KB raw). Built with the rest of the data, so it answers in a few milliseconds. The engine
session owns it and may add fields at the end of `fields`; it won't reorder them.

```jsonc
{
  "generated": "2026-10-22T23:58:00",
  "t0": 1774238400,                 // epoch seconds of 05:00 local on the first day (day0)
  "day0": "2026-03-23",
  "fields": ["minute", "day", "hour", "intent", "origin", "project", "stopped", "outAll"],
  "rows": [
    [757, 0, 17.62, 0, 0, 0, null, null]   // one per message, oldest first
  ],
  "intents":  ["plan", "go-ahead", "build", "…"],          // what an intent code means
  "origins":  ["history", "cowork", "transcript", "codex"], // what an origin code means
  "projects": ["learn_anything", "…"]                       // what a project code means
}
```

Per row:

| field | meaning |
|---|---|
| minute | minutes since `t0` (so `t0 + minute * 60` is the message's time) |
| day | index of its day from `day0` (days run 05:00 to 05:00, as everywhere) |
| hour | hours since midnight of its day: 25.5 is 01:30 the next morning |
| intent | index in `intents`, or null when the message isn't labelled |
| origin | index in `origins`: where it came from (history.jsonl prompts carry no replies or tools) |
| project | index in `projects` |
| stopped | 1 if you stopped Claude's turn, 0 if not, null when unknown (prompts from history.jsonl) |
| outAll | output tokens of everything the message set off: its turn, the subagents it launched, the sessions it started and their turns (messages.outAll in docs/schema.md), null when unknown (prompts from history.jsonl) |

`GET /api/points?ids=1` returns `{"generated", "ids": [...]}`, the message ids in the same order as `rows`
(234 KB gzipped), for a tooltip or a click to open `/api/message/<id>`. Load it only when needed.
Codes are assigned in order of first appearance, so they can change between two `generated`; read the
lists from the same response.
