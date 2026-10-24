#!/usr/bin/env python3
"""Limits at the moment: a Claude Code hook (SessionStart, UserPromptSubmit) and the status line's numbers.

    python3 hooks/limits.py            # as a hook: reads the event on stdin, adds one line of context or nothing
    python3 hooks/limits.py --status   # one short line for the status line: today's active time, days in a row
    python3 hooks/limits.py --check    # what the hook would say right now, ignoring the once-every-30-minutes rule

On Windows, py -3 in place of python3 (hooks/statusline.sh is only this, with --status, for a Mac or Linux).

It adds one plain line when a limit you set in Wimym is crossed: the stopping hour has passed, you have
worked more than 14 days in a row, or more sessions are running than you allowed. Otherwise it says
nothing. The same line is said at most once every 30 minutes in a session.

It must stay fast (well under 200 ms) and never get in the way: it reads only limits.json (data dir),
pulse.json (cache dir, written by the engine on each rebuild), the modification times of Claude Code's
transcripts, and a small state file. Any error means silence. Standard library only.
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "engine"))
from wimym import paths  # noqa: E402  (importing paths changes nothing on disk)

DAY_START = 5
LONG_RUN = 14          # days in a row: past this, say so
RUNNING = 10 * 60      # seconds: a transcript written to this recently is a session running now
REPEAT = 30 * 60       # seconds between two reminders in one session


def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def day_of(dt):
    return (dt - timedelta(hours=DAY_START)).date()


def hours(dt):
    """Hours since midnight of the day it belongs to: 00:30 is 24.5."""
    h = dt.hour + dt.minute / 60
    return h + 24 if h < DAY_START else h


def clock(h):
    h = h % 24
    return f"{int(h):02d}:{int(round((h % 1) * 60)) % 60:02d}"


def streak(pulse, today):
    """Days in a row with work, today included (the hook firing means today is a work day)."""
    yesterday = (today - timedelta(days=1)).isoformat()
    if yesterday in (pulse.get("run") or {}):
        return pulse["run"][yesterday] + 1
    active = pulse.get("active") or {}
    n, d = 1, today - timedelta(days=1)
    while active.get(d.isoformat()):
        n += 1
        d -= timedelta(days=1)
    return n


def running(now):
    """Sessions whose transcript was written to in the last ten minutes (subagents left out)."""
    n = 0
    try:
        for proj in os.scandir(paths.PROJECTS):
            if not proj.is_dir():
                continue
            for e in os.scandir(proj.path):
                if e.name.endswith(".jsonl") and now - e.stat().st_mtime < RUNNING:
                    n += 1
    except OSError:
        pass
    return n


def active_today(pulse, today):
    if (pulse.get("today") or "") < today.isoformat():
        return None  # the engine hasn't run today
    return (pulse.get("active") or {}).get(today.isoformat(), 0)


def notes(now_dt, limits, pulse):
    today = day_of(now_dt)
    out = []
    stop = limits.get("stopHour")
    if isinstance(stop, (int, float)):
        s = stop + 24 if stop < DAY_START else stop
        if hours(now_dt) >= s:
            out.append(f"It's {clock(hours(now_dt))}, past the {clock(s)} you set.")
    run = streak(pulse, today)
    if run > LONG_RUN:
        out.append(f"{run} days in a row.")
    most = limits.get("maxSessions")
    if isinstance(most, int):
        n = running(now_dt.timestamp())
        if n > most:
            out.append(f"{n} sessions running, more than the {most} you set.")
    return out


def status(now_dt, pulse):
    today = day_of(now_dt)
    parts = []
    a = active_today(pulse, today)
    if a is not None:
        parts.append(f"{int(a)}h{int(round((a % 1) * 60)):02d} today")
    run = streak(pulse, today)
    if run > 1:
        parts.append(f"{run} days in a row")
    return " · ".join(parts)


def main():
    if (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":  # Windows' code page: Claude Code reads UTF-8 ("·")
        sys.stdout.reconfigure(encoding="utf-8")
    limits = _read(os.path.join(paths.DATA_DIR, "limits.json"), {})
    pulse = _read(os.path.join(paths.CACHE_DIR, "pulse.json"), {})
    now_dt = datetime.now()
    if "--status" in sys.argv:
        print(status(now_dt, pulse))
        return
    if "--check" in sys.argv:
        print(" ".join(notes(now_dt, limits, pulse)) or "(nothing to say)")
        return
    try:
        event = json.load(sys.stdin)
    except ValueError:
        event = {}
    line = " ".join(notes(now_dt, limits, pulse))
    if not line:
        return
    # once every 30 minutes per session, so it reads as a reminder, not a nag
    state_path = os.path.join(paths.CACHE_DIR, "hook-state.json")
    state = _read(state_path, {})
    sid = event.get("session_id") or "?"
    said = state.get(sid) or {}
    if said.get("line") == line and time.time() - said.get("at", 0) < REPEAT:
        return
    state = {k: v for k, v in state.items() if time.time() - (v or {}).get("at", 0) < 86400}
    state[sid] = {"line": line, "at": time.time()}
    try:
        os.makedirs(paths.CACHE_DIR, exist_ok=True)
        tmp = paths.tmp_name(state_path)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f)
        os.replace(tmp, state_path)
    except OSError:
        pass
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event.get("hook_event_name") or "UserPromptSubmit",
                                             "additionalContext": f"Wimym: {line}"}}))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # a limit reminder must never break a prompt
        pass
