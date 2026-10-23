# Contract: `GET /api/week?start=YYYY-MM-DD`

One week for the retro: its vital signs against the person's range, its days, and candidate moments.
`start` is a Monday from `weeks` in `/api/vitals`; without it, the current week. Any other date is a 404.
The engine session owns it and may add fields; it must not rename or remove these without telling the
app session. Definitions (day, block, active time, night, switch, unread) are the ones in
`docs/contract-vitals.md` and `engine/wimym/vitals.py`.

```jsonc
{
  "week": "2026-10-12",
  "complete": true,                       // false for the current week
  "summary": "Alex sent 858 messages over all 7 days, …",   // the week's account (weeks labels) when there is one,
                                          // else the same as "figures"
  "figures": "49 hours of work over 7 days, nights of 10.0 hours; outside your usual: night higher, sessions at once higher.",
                                          // one plain sentence from the numbers; no "outside" list for the current week
  "account": {                            // the weeks label set's account, a model's reading; null when not written
    "account": "…", "decided": [{"t": "…", "m": "<message id>"}], "dropped": [], "postponed": [],
    "open": ["…"], "strain": "…", "cites": ["<message id>"],
    "citeIds": { "a7176289": "<message id>" } },  // the [a7176289] citations in account and strain, resolved
                                                  // (the same on /api/day's account)
  "vitals": [                             // the /api/vitals measures, for this week only
    { "key": "night", "goal": "rest", "label": "Night", "question": "How long are your nights?", "unit": "h",
      "better": "higher", "status": "ok", "note": null, "since": "2026-03-24",
      "value": 10.0,                      // the week's value (null = no data); "now" repeats it
      "band": { "lo": 9.07, "mid": 9.6, "hi": 9.95 },   // the 8 weeks before; null under 4
      "side": "above",                    // above | below | null: outside the band this week
      "flag": "above",                    // outside on the same side this week and the week before
      "sentence": "Your nights were longer than usual: 10.0 hours, against a usual 9.4.",  // only when outside, complete weeks
      "daily": [8.9, 11.2, 10.0, 8.8, 12.2, 10.0, 10.2],   // the week's 7 days, when the measure is daily
      "evidence": { "messages": ["<message id>"] } }
  ],
  "days": [                               // Monday to Sunday, always 7
    {
      "day": "2026-10-12", "dow": 0,
      "messages": 135,                    // your messages (transcripts and history.jsonl)
      "off": false,                       // no message that day
      "night": 8.9,                       // hours since the day before's last message; null if either day is off
      "landed": 71,                       // commits by you or an agent that reached the default branch; null if git not read
      // only when not off:
      "first": 7.69, "last": 21.54,       // hours since midnight of the day; 25.5 is 01:30 the next morning
      "active": 6.86,                     // hours, the sum of the blocks
      "blocks": [{ "from": 7.69, "to": 8.1, "messages": 3, "id": "<first message id>" }],
      "stretch": 1.13,                    // hours, the longest run on one project
      "switches": 65,                     // changes of session inside blocks
      "late": null,                       // minutes after the stopping hour; null when none is set
      "projects": { "matrice-eloom": 214 },   // minutes of active time by project
      "sessions": 12,
      "unread": 2, "stopped": 0,          // null before transcripts begin (2026-06-29)
      "corrections": 4,                   // labelled corrections (0 when unlabelled)
      "history": 0                        // how many of the messages come from history.jsonl
    }
  ],
  "moments": [                            // candidates, most unusual first
    {
      "key": "longest-day",               // week (the week account's own moments, first) |
                                          // latest-night | short-night | longest-day | switching | deep | unread |
                                          // stopped | corrections | quiet | branches | abandoned (sessions labels) |
                                          // high | low | decided | dropped | postponed (day accounts, days labels)
      "title": "Saturday: 8.7 hours, 08:08 to 22:47",   // a short headline
      "reason": "Your longest day: Saturday, 8.7 hours of work from 08:08 to 22:47.",   // the longer sentence
      "about": "escalation",              // the goal key from /api/vitals it bears on
      "question": "What made Saturday such a long day, and was it worth it?",   // one open question for the retro
      "messages": ["<message id>", "…"],  // up to 12; open with /api/message/<id>
      "day": "2026-10-17",                // null for branches
      "kind": "longest-day",              // same as key (kept for the first version)
      "value": 8.65,                      // the number behind it
      "unusual": 0.79,                    // share of the 8 weeks' days before it this beats (0 to 1); null when not ranked
      "branches": [{ "project": "aune", "name": "claude/x", "ahead": 3, "last": "2026-09-30" }]   // key "branches" only
    }
  ],
  "more": { "decided": [ /* moments, same shape */ ] }   // day-account items beyond the ones picked, per key
}
```

Notes:

- `quiet` is a project with 30 or more of your messages in the four weeks before, none this week, and
  nothing landed this week.
- `branches` lists your (or an agent's) unmerged branches whose last commit is two to four weeks
  before the week's end: candidates for keep, park or drop.
- `week` moments come from the week's account (`weeks.json`, keyed by ISO week), at most three, and lead the
  list; their `about` is null.
- `high`, `low`, `decided`, `dropped` and `postponed` come from the day accounts (`days.json`), picked across
  the week: at most 2 highs, 2 lows, 4 decided, 3 dropped and 3 put off, one day at a time (the busiest days
  first, then days whose account notes strain), so each comes from a different day where it can. The rest
  are under `more`. `abandoned` comes from the session accounts (`sessions.json`). All of these are model
  readings that haven't been checked.
- `about`: latest-night → stop; short-night → rest; longest-day → escalation; switching, deep → depth; unread,
  stopped, decided → judgement; corrections, low → strain; quiet, branches, abandoned, dropped, postponed →
  finish; high → output.
- `unusual` ranks only moments with a day-level measure (latest stop, night, day length, stretch).
  The others sort as if 0.5.
