"""Whether a newer Wimym is out, and whether this engine runs older code than its folder holds, for the page
to say so (docs/contract-state.md, "update").

Once a day the engine asks the repository this folder was cloned from which commit its branch is at
(`git ls-remote`, with the person's own git login): one request to GitHub that carries nothing of theirs. A commit
this folder doesn't have yet means a newer Wimym, and the page shows `./install.sh --update`. Never asked for a
folder that isn't a clone following another, nor for the demo. WIMYM_UPDATES=0, or
{"updates": false} in the data dir's settings.json, turns it off.
"""
import os
import subprocess
import time

from . import paths

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KEPT = os.path.join(paths.CACHE_DIR, "update.json")
EVERY = 24 * 3600  # seconds between two asks
RETRY = 3600       # after an ask that got no answer (offline, logged out)
STARTED = time.time()

_up = []                                       # [(remote, ref)] once looked up, [None] when there is none
_now = {"available": False, "checked": None}   # what the last look found


def on():
    if os.environ.get("WIMYM_UPDATES"):
        return os.environ["WIMYM_UPDATES"] not in ("0", "false", "no")
    s = paths.read_json(os.path.join(paths.DATA_DIR, "settings.json"), {})
    return not (isinstance(s, dict) and s.get("updates") is False)


def _git(*args, timeout=20):
    """git in this folder, never asking for a password: an ask that would need one just fails. Its output, or None."""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
    env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
    try:
        r = subprocess.run(["git", "-C", ROOT, "-c", "credential.interactive=never", *args], capture_output=True, text=True,
                           timeout=timeout, env=env, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def _upstream():
    """("origin", "refs/heads/main") for the branch this folder follows, or None."""
    if not _up:
        up = _git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}", timeout=5)
        remote, _, branch = (up or "").partition("/")
        _up.append((remote, "refs/heads/" + branch) if branch else None)
    return _up[0]


def check():
    """From the engine's loop: asks when it is time, and works out once per answer whether it is news here."""
    if not on() or not _upstream():
        _now.update(available=False, checked=None)
        return
    kept = paths.read_json(KEPT, {})
    kept = kept if isinstance(kept, dict) else {}
    due = time.time() - (kept.get("at") or 0) >= (EVERY if kept.get("sha") else RETRY)
    if not due and _now["checked"] == kept.get("at"):
        return
    if due:
        out = _git("ls-remote", *_upstream())
        kept = {"at": time.time(), "sha": out.split()[0] if out else None}
        paths.write_json(KEPT, kept)
    sha = kept.get("sha")
    # new when this folder doesn't have that commit, or has it without it being part of what is checked out
    new = bool(sha) and (_git("cat-file", "-e", sha + "^{commit}", timeout=5) is None
                         or _git("merge-base", "--is-ancestor", sha, "HEAD", timeout=5) is None)
    _now.update(available=new, checked=kept.get("at"))


def code_changed():
    """Whether the engine's code on disk is newer than this process: pulled, and not restarted onto it."""
    for d, _, files in os.walk(os.path.join(ROOT, "engine")):
        for f in files:
            if f.endswith(".py"):
                try:
                    if os.path.getmtime(os.path.join(d, f)) > STARTED:
                        return True
                except OSError:
                    pass
    return False


def status():
    """For /api/state."""
    checked = _now["checked"]
    return {"available": _now["available"], "restart": code_changed(),
            "checked": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(checked)) if checked else None,
            "command": command("--update"), "restartCommand": command()}


def command(*args, root=None, windows=None):
    """What to type to run the installer in this folder: in a Mac or Linux terminal, or in Windows' PowerShell."""
    root = root or ROOT
    windows = os.name == "nt" if windows is None else windows
    if windows:
        cmd = os.path.join(root, "install.cmd")
        return " ".join([f'& "{cmd}"' if " " in cmd else cmd, *args])
    home = os.path.expanduser("~")
    folder = f'"{root}"' if " " in root else "~" + root[len(home):] if root.startswith(home + os.sep) else root
    return " ".join([f"cd {folder} && ./install.sh", *args])
