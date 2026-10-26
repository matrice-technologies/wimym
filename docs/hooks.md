# Limits at the moment: hooks and status line

Two small scripts bring the limits you set in Wimym into Claude Code itself (STRATEGY.md §4). Nothing is
installed by default: the snippet below goes into `~/.claude/settings.json` only once you approve it, and is
never offered if you chose to leave your Claude Code setup as it is (`wimym claude-setup` says which; the
setup asks it first, `site/setup.md`). `/retro` offers it once you set a limit.

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

First check `wimym claude-setup` doesn't say to leave the Claude Code setup as it is. Copy the settings file
to `~/.claude/settings.json.before-wimym` if that copy doesn't exist yet. Then merge, never replace: keep
every hook already there and add these two entries to their lists (skip one already present). Add the
`statusLine` only if there is none, or if you said to swap yours for Wimym's (`9h35 today · 85 days in a
row`). Check the file still parses with `python3 -m json.tool ~/.claude/settings.json > /dev/null`.

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

Wimym doesn't start at login. Until `./install.sh` runs again after a restart, the engine is off, and the status
line and the hook read what it last wrote: the status line shows no hours for today, and its days in a row stop
keeping up. The stopping hour and the sessions at once still speak, since they don't need the engine.
