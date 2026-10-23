"""What you tell Wimym, kept in ~/.wimym (not a cache: deleting it loses it).

checkins.json: {"days": {"YYYY-MM-DD": {"energy": 1-5, "mood": 1-5, "focus": 1-5, "note": "…", "at": iso}}}
limits.json: the stopping hour, days off a week, sessions at once and priority projects you set
"""
import os
import re
import threading
from datetime import datetime

from . import paths
from .paths import DATA_DIR

_lock = threading.Lock()
CHECKS = ("energy", "mood", "focus")


def _path():
    return os.path.join(DATA_DIR, "checkins.json")


def mtime():
    try:
        return os.path.getmtime(_path())
    except OSError:
        return 0


def checkins():
    d = paths.read_json(_path(), {})
    return (d.get("days") or {}) if isinstance(d, dict) else {}


def save_checkin(body):
    if not isinstance(body, dict) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(body.get("day") or "")):
        raise ValueError("a check-in needs a day (YYYY-MM-DD)")
    with _lock:
        days = checkins()
        row = dict(days.get(body["day"]) or {})
        for k in CHECKS:
            if k in body:
                v = body[k]
                if v is None:
                    row.pop(k, None)
                elif isinstance(v, int) and 1 <= v <= 5:
                    row[k] = v
                else:
                    raise ValueError(f"{k} is 1 to 5")
        if "note" in body:
            note = str(body["note"] or "").strip()[:500]
            if note:
                row["note"] = note
            else:
                row.pop("note", None)
        row["at"] = datetime.now().isoformat(timespec="seconds")
        if set(row) <= {"at"}:
            days.pop(body["day"], None)
        else:
            days[body["day"]] = row
        paths.write_json(_path(), {"days": days}, indent=1, ensure_ascii=False)
        return days.get(body["day"])


# ---------------------------------------------------------------------------
# limits.json, one file shared with the CLI (practices.py writes the same one, and logs each change):
# {"stopHour": 0-30 (22.5 is 22:30; under 5 or over 24 means after midnight), "daysOffPerWeek": 0-7,
#  "maxSessions": 1-50, "priorities": ["project", …], "at": iso}; an absent or null key is not set.
# practices.py keeps the first three; priorities, which only the engine uses, sit in the same file.

def _limits_path():
    return os.path.join(DATA_DIR, "limits.json")


def limits_mtime():
    try:
        return os.path.getmtime(_limits_path())
    except OSError:
        return 0


def _limits_file():
    d = paths.read_json(_limits_path(), {})
    return d if isinstance(d, dict) else {}


def limits():
    from . import practices
    return practices.limits() | {"priorities": _limits_file().get("priorities")}


def save_limits(body):
    from . import practices
    keys = set(practices.LIMITS) | {"priorities"}
    if not isinstance(body, dict) or not set(body) & keys:
        raise ValueError("limits are " + ", ".join(sorted(keys)))
    for k in practices.LIMITS:
        if k in body and body[k] is not None and (isinstance(body[k], bool) or not isinstance(body[k], (int, float))):
            raise ValueError(f"{k} is a number")
    pr = body.get("priorities")
    if "priorities" in body and pr is not None and not isinstance(pr, list):
        raise ValueError("priorities is a list of project names")
    for k in practices.LIMITS:
        if k in body:
            practices.set_limit(k, body[k])
    if "priorities" in body:
        with getattr(practices, "_lock", _lock):
            d = _limits_file()
            if pr is None:
                d.pop("priorities", None)
            else:
                d["priorities"] = [str(p).strip()[:120] for p in pr if str(p).strip()][:20]
            d["at"] = datetime.now().isoformat(timespec="seconds")
            paths.write_json(_limits_path(), d, indent=1, ensure_ascii=False)
    return limits()
