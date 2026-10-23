"""Where Wimym reads and keeps things.

- Claude Code's transcripts: ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects), read only.
- The index: ~/.cache/wimym/index.json, rebuilt from the transcripts when lost, except for
  sessions whose transcripts Claude Code has since cleaned up: those live only there.
- What you tell Wimym (check-ins, label marks): ~/.wimym, never a cache.
- Haiku labels: ~/.wimym/labels (categories.json, signals.json, audit marks), copied from claude-memory-map on 22 Oct.

WIMYM_CACHE, WIMYM_DATA and WIMYM_LABELS put them elsewhere (MIRROR_* still work). The project
was first called Mirror. Importing this module changes nothing on disk: it uses the new folders when
they exist, else the old ones. migrate(), called once by the server at startup, moves ~/.mirror and
~/.cache/mirror to the new names and leaves the old names as links to them, so anything still using
them (a relabel already running) writes into the moved folders.
"""
import os
import sys

HOME = os.path.expanduser("~")


def tilde(p):
    return "~" + p[len(HOME):] if p and p.startswith(HOME + "/") else p


def read_json(path, default):
    """A JSON file Wimym keeps, or default when there is none. A file that is there but won't parse is never
    overwritten: it is moved aside to <path>.bad-<time>, kept, and said so on stderr, and default comes back."""
    import json
    try:
        f = open(path, encoding="utf-8")
    except FileNotFoundError:
        return default
    with f:
        try:
            return json.load(f)
        except ValueError:
            pass
    from datetime import datetime
    bad = f"{path}.bad-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    os.replace(path, bad)
    print(f"wimym: {tilde(path)} couldn't be read. It is kept as {tilde(bad)}, untouched; starting from nothing.", file=sys.stderr)
    return default


def write_json(path, obj, **dump):
    """Write a JSON file whole or not at all: a temporary file, flushed to disk, then renamed over the old one."""
    import json
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = tmp_name(path)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, **dump)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def clean_tmp(folder, older=3600):
    """Remove temporary files left by a writer that died mid-write (its process is gone, or the file is old)."""
    import glob
    import time
    for p in glob.glob(os.path.join(folder, "*.tmp")):
        parts = os.path.basename(p).split(".")
        pid = int(parts[-3]) if len(parts) >= 4 and parts[-3].isdigit() else None
        alive = False
        if pid:
            try:
                os.kill(pid, 0)
                alive = True
            except OSError:
                pass
        try:
            if not alive or time.time() - os.path.getmtime(p) > older:
                os.remove(p)
        except OSError:
            pass


def tmp_name(path):
    """A temporary name next to path, unique to this process and thread, for writing then os.replace: several
    engines can share one cache dir."""
    import threading
    return f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"


def _env(name):
    return os.environ.get("WIMYM_" + name) or os.environ.get("MIRROR_" + name)


def _moved(old, new):
    """The folder to use: new, once old (from when the project was Mirror) has been moved there.
    Moves, never copies or deletes; if the move fails, keeps using old."""
    if os.path.islink(old) or not os.path.isdir(old):
        return new
    if os.path.lexists(new):
        print(f"wimym: both {tilde(old)} and {tilde(new)} exist; using {tilde(new)}, {tilde(old)} left as it is",
              file=sys.stderr)
        return new
    try:
        os.makedirs(os.path.dirname(new), exist_ok=True)
        os.rename(old, new)
    except OSError as e:
        print(f"wimym: couldn't move {tilde(old)} to {tilde(new)} ({e}); using {tilde(old)}", file=sys.stderr)
        return old
    try:
        os.symlink(new, old)
        print(f"wimym: moved {tilde(old)} to {tilde(new)}, and left {tilde(old)} as a link to it", file=sys.stderr)
    except OSError as e:
        print(f"wimym: moved {tilde(old)} to {tilde(new)} (no link left at the old name: {e})", file=sys.stderr)
    return new


CLAUDE = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(HOME, ".claude")
PROJECTS = os.path.join(CLAUDE, "projects")
COWORK = os.path.join(HOME, "Library", "Application Support", "Claude", "local-agent-mode-sessions")
OLD_NEW = {"CACHE": (os.path.join(HOME, ".cache", "mirror"), os.path.join(HOME, ".cache", "wimym")),
           "DATA": (os.path.join(HOME, ".mirror"), os.path.join(HOME, ".wimym"))}


def _pick(name):
    """The folder to use without moving anything: the env var, the new name if it exists, else the old one if it does."""
    old, new = OLD_NEW[name]
    if _env(name):
        return _env(name)
    if os.path.lexists(new) or not os.path.isdir(old) or os.path.islink(old):
        return new
    return old


CACHE_DIR = _pick("CACHE")
DATA_DIR = _pick("DATA")
LABELS_DIR = _env("LABELS") or os.path.join(DATA_DIR, "labels")
INDEX = os.path.join(CACHE_DIR, "index.json")


def migrate():
    """Move the folders from when the project was Mirror to their new names, once. Call it before importing the
    rest of wimym (they read these names at import). Does nothing for a folder an env var sets."""
    global CACHE_DIR, DATA_DIR, LABELS_DIR, INDEX
    if not _env("CACHE"):
        CACHE_DIR = _moved(*OLD_NEW["CACHE"])
    if not _env("DATA"):
        DATA_DIR = _moved(*OLD_NEW["DATA"])
    LABELS_DIR = _env("LABELS") or os.path.join(DATA_DIR, "labels")
    INDEX = os.path.join(CACHE_DIR, "index.json")
SCRATCH = ("/private/tmp/", "/tmp/", "/var/folders/")
