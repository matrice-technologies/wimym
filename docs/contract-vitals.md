# Contract: `GET /api/vitals`

The engine serves it and the front page reads it, so the two can be built at the same time.
The engine session owns the implementation and may add fields; it must not rename or remove
these without telling the app session. Measures and goals are the ones in STRATEGY.md §2.

```jsonc
{
  "asof": "2026-10-22T22:40:00",          // local time of the Mac
  "coverage": {
    "full_from": "2026-06-29",            // transcripts with replies, tools, effort
    "prompts_from": "2026-03-23",         // history.jsonl: prompts only
    "git": true                           // whether git was read
  },
  "days":  ["2026-03-23", "…"],           // every calendar day from prompts_from to today
  "weeks": ["2026-03-23", "…"],           // Mondays, same span; the last one is the current, partial week
  "limits": { "stopHour": null, "daysOffPerWeek": null, "maxSessions": null },  // set by the person, null if not
  "goals": [
    { "key": "rest", "label": "Keep rest intact", "group": "health", "measures": ["night", "daysoff", "streak"] }
    // stop, rest, escalation, people, finish, depth, judgement, direction, strain   (group "health")
    // output                                                                      (group "performance")
  ],
  "measures": [
    {
      "key": "night",                     // late, night, daysoff, streak, load, peak, people, loops, stretch,
                                          // switches, unread, priorities, strain,
                                          // landed, ftr, survival, leverage, ttd
      "goal": "rest",
      "label": "Night",                   // short name for a tile
      "question": "How long are your nights?",  // what the tile answers, in plain words
      "unit": "h",                        // h | min | days | % | count | perh
      "better": "higher",                 // higher | lower | null when neither is better
      "daily":  [7.5, null, "…"],         // aligned with days; null = no data that day; omit if not daily
      "weekly": [7.1, "…"],               // aligned with weeks; the week's median or total, as fits
      "band":   [{ "lo": 6.2, "mid": 7.0, "hi": 7.8 }, null, "…"],
                                          // aligned with weeks: the person's range from the 8 complete weeks
                                          // before that week (25th, 50th, 75th percentile); null under 4 weeks
      "now": 6.1,                         // the current, partial week so far
      "flag": "below",                    // above | below | null: latest complete week outside its band,
                                          // and the week before it too
      "sentence": "Your nights were an hour shorter than usual for two weeks.",  // null when nothing to say
      "status": "ok",                     // ok | partial | missing
      "note": null,                       // why partial or missing: "needs a stopping hour", "git not read yet"
      "since": "2026-03-23",              // first day with data for this measure
      "evidence": { "messages": ["<turn uuid>", "…"] }   // up to 10 messages that show it this week, if any
    }
  ]
}
```

Rules:

- Times are the Mac's local time. A day runs from 05:00 to 05:00, so a message at 01:30 belongs to
  the day before; the engine says so in one place and the app never recomputes it.
- A work block is a run of the person's own messages with no gap over 20 minutes; active time is
  the sum of a day's blocks, each counted from its first message to its last plus 5 minutes.
- `streak` is the number of days in a row with a message of yours, up to each day (0 on a day off). Its
  weekly value is the longest run the week reached, and `now` is the run as of today. Because a long run
  can be someone's usual, its sentence doesn't wait for the band: it is written whenever the current run
  reaches 14 days ("You have worked 85 days in a row; your last day off was Wednesday 29 July, …").
- `limits` also carries `priorities` (project names), from the same `limits.json`.
- Days and weeks before `full_from` carry only measures that prompts alone can give; the others
  are null there, never zero.
- Every number the app shows comes from this payload or another endpoint. The app does not invent
  data; a fixture used before the endpoint exists must follow this shape exactly.
