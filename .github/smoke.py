"""The installer for real, as a friend runs it: the demo with Robin's month, --stop, then --update from a newer
commit. For CI (.github/workflows/ci.yml), on Windows and Linux; it runs on a Mac too.

    python .github/smoke.py

Everything goes in folders next to the checkout ($RUNNER_WORKSPACE, or the checkout's parent folder): never in
~/.wimym or ~/.cache/wimym, and never in a temporary folder, whose transcripts the engine leaves out.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WINDOWS = os.name == "nt"
WORK = os.environ.get("RUNNER_WORKSPACE") or os.path.dirname(HERE)
DEMO = os.path.join(WORK, "robin-demo")


def installer(folder, *args, **kw):
    cmd = ["cmd", "/c", os.path.join(folder, "install.cmd")] if WINDOWS else [os.path.join(folder, "install.sh")]
    env = dict(os.environ, WIMYM_DEMO=DEMO)
    r = subprocess.run(cmd + list(args), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=900, **kw)
    print(f"$ {' '.join(cmd[-1:] + list(args))}\n{r.stdout}{r.stderr}", flush=True)
    assert r.returncode == 0, f"the installer stopped ({r.returncode})"
    return r.stdout


def api(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=30) as r:
        return json.load(r)


def answers(port):
    try:
        return "state" in api(port, "/api/state")
    except Exception:
        return False


def ready(port):
    for _ in range(300):
        s = api(port, "/api/state")["state"]
        if s["phase"] == "ready" and s.get("updated"):
            return s
        time.sleep(1)
    raise AssertionError(f"the engine wasn't ready in 5 minutes: {s}")


def git(cwd, *args):
    return subprocess.run(["git", "-C", cwd, *args], check=True, capture_output=True, text=True).stdout.strip()


def demo():
    installer(HERE, "--demo", "--no-open", "--port", "8997")
    state = ready(8997)
    core = api(8997, "/api/core")
    t = core["profile"]["totals"]
    print("found:", state["found"], "\ntotals:", {k: t[k] for k in ("messages", "days", "sessions", "projects", "commits")})
    assert t["days"] >= 30 and t["messages"] > 1000, "Robin's month isn't all there"
    names = sorted(p["project"] for p in core["projects"])
    assert names == sorted(["loom", "loom-web", "loom-ios", "loom-infra", "loom-docs", "field-notes", "ledger-tools",
                            "talk-slides", "recipe-box"]), names
    assert {n["project"] for n in core["memory"]["notes"]} == {"loom"}, core["memory"]["notes"]
    # the page itself, and a file it loads
    with urllib.request.urlopen("http://127.0.0.1:8997/days", timeout=30) as r:
        page = r.read().decode()
    script = re.search(r'src="(/assets/[^"]+\.js)"', page).group(1)
    with urllib.request.urlopen("http://127.0.0.1:8997" + script, timeout=30) as r:
        assert r.headers["Content-Type"].startswith("text/javascript") and len(r.read()) > 1000, script
    folders = os.listdir(os.path.join(DEMO, "home", ".claude", "projects"))
    print("transcript folders:", folders[:2])
    if WINDOWS:  # as Claude Code writes them there: C:\…\loom, in a folder named C--…-loom
        assert all(f[0].isalpha() and f[1:3] == "--" for f in folders), folders
        first = os.path.join(DEMO, "home", ".claude", "projects", folders[0])
        with open(os.path.join(first, os.listdir(first)[0]), encoding="utf-8") as f:
            cwd = json.loads(f.readline())["cwd"]
        assert "\\" in cwd and cwd[1] == ":", cwd
    out = installer(HERE, "--demo", "--no-open", "--port", "8997")
    assert "already running" in out, out
    installer(HERE, "--demo", "--stop")
    time.sleep(1)
    assert not answers(8997), "--stop left the engine running"


def update():
    """A clone that follows another, which then gets a newer commit: --update pulls it, says what's new, and starts."""
    up, clone = os.path.join(WORK, "wimym-upstream"), os.path.join(WORK, "wimym-clone")
    for d in (up, clone):
        assert not os.path.exists(d), f"{d} is already there"
    subprocess.run(["git", "clone", "-q", HERE, up], check=True)
    git(up, "checkout", "-q", "-B", "ci-main")
    subprocess.run(["git", "clone", "-q", "-b", "ci-main", up, clone], check=True)
    with open(os.path.join(up, "CHANGES.md"), "a", encoding="utf-8") as f:
        f.write("\n## Today\n\n- A change for the update test\n")
    git(up, "add", "CHANGES.md")
    git(up, "commit", "-qm", "A change for the update test")
    # the page as built above, so the clone needs no packages of its own: copied after the clone, so it is newer
    import shutil
    shutil.copytree(os.path.join(HERE, "app", "dist"), os.path.join(clone, "app", "dist"), copy_function=shutil.copy)
    out = installer(clone, "--update", "--demo", "--no-open", "--port", "8998")
    assert "A change for the update test" in out, out
    assert git(clone, "rev-parse", "HEAD") == git(up, "rev-parse", "HEAD"), "the clone wasn't brought up to date"
    assert answers(8998), "the engine didn't start after the update"
    out = installer(clone, "--update", "--demo", "--no-open", "--port", "8998")
    assert "already the latest" in out, out
    installer(clone, "--demo", "--stop")
    time.sleep(1)
    assert not answers(8998), "--stop left the engine running"


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # what the installer says, as it says it, whatever Windows' code page
    demo()
    update()
    print("All good.")
