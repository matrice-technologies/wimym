# Limits at the moment: hooks and status line

Two small scripts bring the limits you set in Wimym into Claude Code itself (STRATEGY.md §4). Nothing is
installed yet: the snippet below goes into `~/.claude/settings.json` only once you approve it.

- `hooks/limits.py`, a hook on SessionStart and UserPromptSubmit. When a limit is crossed it adds one
  plain line to Claude's context, for example
  `Wimym: It's 23:30, past the 21:30 you set. 85 days in a row. 7 sessions running, more than the 4 you set.`
  It says nothing otherwise, and repeats the same line at most once every 30 minutes in a session.
  - stopping hour: from `limits.json` (`stopHour`; under 5 means after midnight)
  - days in a row: more than 14, always (no limit needed)
  - sessions running: transcripts written in the last ten minutes, against `maxSessions`
- `hooks/statusline.sh`, a status line: `9h35 today · 85 days in a row`.

Both read only `limits.json` (data dir), `pulse.json` (cache dir, which the engine writes on each rebuild:
active hours by day and the run of days), the modification times of the transcripts, and a small state file.
A hook call takes about 50 ms. Any error means silence; they never block a prompt.

Today's active time needs the engine to have run today (`python3 engine/server.py`); without it, the status
line shows only the days in a row.

## Try them first

```sh
python3 hooks/limits.py --check     # what the hook would say now
python3 hooks/limits.py --status    # what the status line would show
```

## Install (after your yes)

Your settings already have a `statusLine` and a `PreToolUse` hook. Merge, don't replace: add the two
entries under `hooks`, and swap `statusLine` only if you want Wimym's in place of yours.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "python3 ~/wimym/hooks/limits.py", "timeout": 5 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "python3 ~/wimym/hooks/limits.py", "timeout": 5 }] }
    ]
  },
  "statusLine": { "type": "command", "command": "~/wimym/hooks/statusline.sh" }
}
```

On Windows, the same with `py -3` and the folder's full path written with forward slashes, which every
shell Claude Code runs there reads the same way; the status line is the hook with `--status`:
`"command": "py -3 C:/Users/robin/wimym/hooks/limits.py"`, and
`"statusLine": { "type": "command", "command": "py -3 C:/Users/robin/wimym/hooks/limits.py --status" }`.

The paths assume Wimym is cloned into `~/wimym`; write your own folder in its place. To turn them off, remove the entries. Set your limits
with `wimym limits set stopHour 21.5` (the CLI) or on the app's limits page; they live in `~/.wimym/limits.json`.
