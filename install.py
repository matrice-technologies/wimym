"""Wimym in one command: check what it needs, build the page, start the engine, open the browser.

  ./install.sh                 # the first time, and any time after: it only redoes what changed (install.cmd on Windows)
  ./install.sh --update        # the latest Wimym: pull it, say what's new, rebuild and restart onto it
  ./install.sh --port 8990     # another port (default 8990, or $WIMYM_PORT)
  ./install.sh --link          # also put the `wimym` command in ~/.local/bin (it asks otherwise)
  ./install.sh --no-link       # don't ask
  ./install.sh --no-open       # don't open the browser
  ./install.sh --stop          # stop the engine this script started
  ./install.sh --demo          # show Robin, a made-up person, on port 8997 (or --port): none of your data is read

It writes only inside this folder (app/node_modules, app/dist), in ~/.wimym (what you enter) and
~/.cache/wimym (the index; WIMYM_DATA and WIMYM_CACHE move them), and in ~/.local/bin if you say yes.
No sudo. Wimym reads your Claude Code transcripts where they are and sends nothing of yours anywhere. Once a
day it asks GitHub whether a newer Wimym is out; {"updates": false} in ~/.wimym/settings.json turns that off.
"""
# One installer for macOS, Linux and Windows, standard library only: install.sh and install.cmd find Python and
# hand everything to it.
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
WINDOWS = os.name == "nt"
NAME = "install.cmd" if WINDOWS else "./install.sh"
HOME = os.path.expanduser("~")


def say(*s):
    print(*s, flush=True)


def fail(s):
    print(f"Stopped: {s}", file=sys.stderr, flush=True)
    sys.exit(1)


def options(argv):
    o = {"port": os.environ.get("WIMYM_PORT") or "8990", "port_given": False, "update": False, "link": "ask",
         "open": True, "stop": False, "demo": False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--port" and i + 1 < len(argv):
            o["port"], o["port_given"] = argv[i + 1], True
            i += 1
        elif a.startswith("--port="):
            o["port"], o["port_given"] = a.split("=", 1)[1], True
        elif a == "--update":
            o["update"] = True
        elif a == "--link":
            o["link"] = "yes"
        elif a == "--no-link":
            o["link"] = "no"
        elif a == "--no-open":
            o["open"] = False
        elif a == "--stop":
            o["stop"] = True
        elif a == "--demo":
            o["demo"] = True
        elif a in ("-h", "--help"):
            doc = __doc__.strip().replace("./install.sh", NAME)
            say(doc.replace("~/.local/bin", "~\\.local\\bin") if WINDOWS else doc)
            sys.exit(0)
        else:
            print(f"Unknown option: {a} (see {NAME} --help)", file=sys.stderr)
            sys.exit(2)
        i += 1
    if not o["port"].isdigit():
        fail(f"--port wants a number, not {o['port']}.")
    return o


def run(*cmd, **kw):
    """A command's exit code; never raises for a missing program (127, as a shell says)."""
    try:
        return subprocess.run(cmd, **kw).returncode
    except OSError:
        return 127


def out(*cmd):
    """A command's output, or None when it failed."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except OSError:
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def git(*args):
    return out("git", "-C", HERE, *args)


# --- the engine this script started, while it still is that engine: a pid can be reused by something else later

def command_line(pid):
    """The command line of a running process, or None."""
    if WINDOWS:
        ps = f"(Get-CimInstance Win32_Process -Filter 'ProcessId={int(pid)}').CommandLine"
        return out("powershell", "-NoProfile", "-NonInteractive", "-Command", ps) or None
    return out("ps", "-p", str(pid), "-o", "command=") or None


def ours(pidfile):
    """The pid in pidfile when it is still an engine from this script, else None."""
    try:
        with open(pidfile) as f:
            pid = int(f.read().strip())
    except (OSError, ValueError):
        return None
    return pid if "engine/server.py" in (command_line(pid) or "").replace("\\", "/") else None


def running(pid):
    if WINDOWS:
        return bool(out("tasklist", "/FI", f"PID eq {pid}", "/NH", "/FO", "CSV") or "").count(f'"{pid}"') > 0
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def stop_engine(pidfile):
    pid = ours(pidfile)
    if not pid:
        return False
    if WINDOWS:  # the whole tree: the demo's engine runs as a child of the one started here
        run("taskkill", "/PID", str(pid), "/T", "/F", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.kill(pid, 15)
        except OSError:
            return False
    for _ in range(50):
        if not running(pid):
            break
        time.sleep(.1)
    try:
        os.remove(pidfile)
    except OSError:
        pass
    return True


def answers(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=2) as r:
            return "state" in json.load(r)
    except Exception:
        return False


def port_free(port):
    s = socket.socket()
    if not WINDOWS:  # as the server does: a just-closed port is free (on Windows this would take a used one)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("127.0.0.1", int(port)))
        return True
    except OSError:
        return False
    finally:
        s.close()


def newer_than(target, sources, ext=None):
    """Whether any file under sources (files or folders) changed after target."""
    t = os.path.getmtime(target)
    for src in sources:
        if os.path.isfile(src):
            if os.path.getmtime(src) > t:
                return True
            continue
        for d, dirs, files in os.walk(src):
            dirs[:] = [x for x in dirs if x != "node_modules"]
            for f in files:
                if (not ext or f.endswith(ext)) and os.path.getmtime(os.path.join(d, f)) > t:
                    return True
    return False


# --- --update: the latest code, then the rest of this script as the new code has it

def update(argv):
    if git("rev-parse", "--abbrev-ref", "@{upstream}") is None:
        fail("This folder isn't a clone of Wimym's repository, so there is nothing to update it from.")
    if git("status", "--porcelain", "--untracked-files=no"):
        fail(f'This folder has changes of its own (git -C "{HERE}" status lists them): put them aside, then run this again.')
    before = git("rev-parse", "HEAD")
    say("Fetching the latest Wimym…")
    if run("git", "-C", HERE, "pull", "--ff-only", "--quiet") != 0:
        fail("The update didn't come through; what git said is above.")
    if git("rev-parse", "HEAD") == before:
        say("This is already the latest Wimym.")
    else:
        diff = git("diff", before, "HEAD", "--", "CHANGES.md") or ""
        news = [f"  {line[1:]}" for line in diff.splitlines() if line.startswith("+- ")]
        if not news:
            news = [f"  - {s}" for s in (git("log", "--format=%s", f"{before}..HEAD") or "").splitlines()[:20]]
        say("What's new (all of it in CHANGES.md):")
        say("\n".join(news))
    rest = [a for a in argv if a != "--update"]
    # the pull may have changed this script: the new one goes on
    cmd = [sys.executable, os.path.join(HERE, "install.py"), *rest]
    if WINDOWS:
        sys.exit(subprocess.call(cmd))
    os.execv(sys.executable, cmd)


# --- the page: built when it's missing or older than its sources (needs Node.js 18 or later)

def build(cache):
    dist = os.path.join(HERE, "app", "dist", "index.html")
    sources = [os.path.join(HERE, *p.split("/")) for p in
               ("app/src", "app/public", "app/index.html", "app/package.json", "app/vite.config.ts", "lab/hero", "lab/src")]
    if os.path.isfile(dist) and not newer_than(dist, sources):
        say("The page is up to date.")
        return
    npm, node = shutil.which("npm"), shutil.which("node")
    if not npm or not node:
        if os.path.isfile(dist):
            say("The page is older than its code, and npm isn't here to rebuild it: using the old one.")
            return
        fail("Building the page needs Node.js 18 or later (nodejs.org, " +
             ("or 'winget install OpenJS.NodeJS.LTS'" if WINDOWS else "or 'brew install node'") + "). Then run this again.")
    v = out(node, "-v") or "?"
    if run(node, "-e", 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)') != 0:
        fail(f"Building the page needs Node.js 18 or later; this one is {v}.")
    # the page takes its planet from lab/, whose own packages its type check reads
    for name in ("lab", "app"):
        d = os.path.join(HERE, name)
        if not os.path.isfile(os.path.join(d, "package.json")):
            continue
        lock, done = os.path.join(d, "package-lock.json"), os.path.join(d, "node_modules", ".package-lock.json")
        if not os.path.isdir(os.path.join(d, "node_modules")) or not os.path.exists(done) or \
                (os.path.exists(lock) and os.path.getmtime(lock) > os.path.getmtime(done)):
            say(f"Installing the page's packages in {name} (once, about a minute)…")
            # as the lock file says, and never rewrites it
            if run(npm, "ci", "--no-audit", "--no-fund", "--no-update-notifier", "--loglevel=error", cwd=d) != 0:
                fail(f"The page's packages didn't install in {name}; what npm said is above.")
    say("Building the page…")
    os.makedirs(cache, exist_ok=True)
    log = os.path.join(cache, "build.log")
    with open(log, "wb") as f:
        code = run(npm, "run", "build", "--silent", cwd=os.path.join(HERE, "app"), stdout=f, stderr=subprocess.STDOUT)
    if code != 0:
        with open(log, encoding="utf-8", errors="replace") as f:
            say("".join(f.readlines()[-20:]).rstrip())
        fail(f"The page didn't build; what went wrong is above, and all of it in {log}")


# --- the wimym command, for asking your own record questions in any terminal (optional)

def link(how):
    bindir = os.path.join(HOME, ".local", "bin")
    target = os.path.join(bindir, "wimym.cmd" if WINDOWS else "wimym")
    if how == "ask" and sys.stdin.isatty() and not os.path.lexists(target):
        try:
            answer = input(f"Put the wimym command in {bindir}, so you can ask your record questions from any terminal? [y/N] ")
        except EOFError:
            answer = ""
        how = "yes" if answer.strip().lower().startswith("y") else "no"
    if how != "yes":
        return
    os.makedirs(bindir, exist_ok=True)
    if WINDOWS:  # no symbolic links without admin rights: a one-line command that runs this folder's
        with open(target, "w", encoding="utf-8", newline="\r\n") as f:
            f.write(f'@"{os.path.join(HERE, "bin", "wimym.cmd")}" %*\n')
    else:
        if os.path.lexists(target):
            os.remove(target)
        os.symlink(os.path.join(HERE, "bin", "wimym"), target)
    say(f"Linked {target}.")
    on_path = [os.path.normcase(os.path.abspath(p)) for p in os.environ.get("PATH", "").split(os.pathsep) if p]
    if os.path.normcase(bindir) not in on_path:
        if WINDOWS:
            say(f"Add {bindir} to your PATH to use it (then open a new terminal), in PowerShell:\n"
                f"  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';{bindir}', 'User')")
        else:
            say(f"Add {bindir} to your PATH to use it: echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> ~/.zshrc")


# --- the engine: started unless it's already running on this port

def start(o, cache, pidfile):
    port = o["port"]
    # an engine started before this folder's code changed (an update, a pull) is restarted onto the new code
    if answers(port) and ours(pidfile) and newer_than(pidfile, [os.path.join(HERE, "engine")], ext=".py"):
        say("Restarting Wimym on the new code…")
        stop_engine(pidfile)
    if answers(port):
        say("Wimym is already running.")
        return
    if not port_free(port):
        fail(f"Port {port} is taken by something else. Try {NAME} --port 8991")
    os.makedirs(cache, exist_ok=True)
    cmd = [sys.executable, os.path.join(HERE, "engine", "server.py")] + (["--demo"] if o["demo"] else []) + \
          ["--no-open", "--port", port]
    if o["demo"]:
        say("Writing the demo person (a few seconds, once a day)…")
    env = dict(os.environ)
    if WINDOWS:
        env["PYTHONUTF8"] = "1"  # the engine's files and log in UTF-8, whatever Windows' code page
    with open(os.path.join(cache, "engine.log"), "ab") as log:
        kw = dict(stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=env)
        if not WINDOWS:
            p = subprocess.Popen(cmd, start_new_session=True, **kw)  # as nohup did: it outlives this terminal
        else:
            # its own hidden console, so the git it runs opens no window and closing this terminal leaves it running;
            # out of the terminal's job too where Windows allows it (CREATE_BREAKAWAY_FROM_JOB), so the job can't end it
            flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            try:
                p = subprocess.Popen(cmd, creationflags=flags | 0x01000000, **kw)
            except OSError:
                p = subprocess.Popen(cmd, creationflags=flags, **kw)
    with open(pidfile, "w") as f:
        f.write(f"{p.pid}\n")
    for _ in range(150):
        if answers(port):
            break
        if p.poll() is not None:
            break
        time.sleep(.2)
    if not answers(port):
        fail(f"The engine didn't start. Its log: {os.path.join(cache, 'engine.log')}")
    stop = f"{NAME} --demo --stop" if o["demo"] else f"{NAME} --stop"
    if o["demo"]:
        say(f"The demo is running (stop it with {stop}): Robin is made up, and none of your data is read.")
    else:
        say(f"Wimym is running (stop it with {stop}). It reads your transcripts now; the page shows how far it is.")


def open_page(url):
    if sys.platform == "darwin" and shutil.which("open"):
        run("open", url)
    elif WINDOWS:
        os.startfile(url)
    elif shutil.which("xdg-open"):
        subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main(argv):
    for stream in (sys.stdout, sys.stderr):
        if WINDOWS and not stream.isatty():  # read through a pipe (Claude Code, a log): UTF-8, not Windows' code page
            stream.reconfigure(encoding="utf-8")
        else:  # a console in another code page: never stop on a character
            stream.reconfigure(errors="replace")
    o = options(argv)
    cache = os.environ.get("WIMYM_CACHE") or os.environ.get("MIRROR_CACHE") or os.path.join(HOME, ".cache", "wimym")
    if o["demo"]:  # the demo keeps its own made-up home, data and cache, and its own port
        cache = os.environ.get("WIMYM_DEMO") or os.path.join(HOME, ".cache", "wimym-demo")
        if not o["port_given"] and not os.environ.get("WIMYM_PORT"):
            o["port"] = "8997"
        o["link"] = "no"
    pidfile = os.path.join(cache, "engine.pid")
    url = f"http://127.0.0.1:{o['port']}/"

    if o["stop"]:
        say("Wimym stopped." if stop_engine(pidfile) else "No engine started by this script is running.")
        return
    if o["update"]:
        update(argv)

    # --- Python, 3.9 or later: the engine (standard library only)
    if sys.version_info < (3, 9):
        fail(f"Wimym needs Python 3.9 or later; this one is {sys.version.split()[0]}. Install a newer one from python.org.")

    # --- Claude Code's transcripts: what Wimym reads
    projects = os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(HOME, ".claude"), "projects")
    if not o["demo"] and not os.path.isdir(projects):
        say(f"No Claude Code transcripts found in {projects} yet. Wimym will start, and fill in once you've used Claude Code.")

    build(cache)
    link(o["link"])
    start(o, cache, pidfile)
    say(url)
    if o["open"]:
        open_page(url)


if __name__ == "__main__":
    main(sys.argv[1:])
