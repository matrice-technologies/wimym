#!/usr/bin/env python3
"""Wimym (Where is your mind): you, as you work with AI agents.

    python3 engine/server.py              # http://127.0.0.1:8990 (the built app, and its API)
    python3 engine/server.py --no-open --port 8991

Reads Claude Code's transcripts (~/.claude/projects), keeps an index in ~/.cache/wimym and
what you enter (check-ins) in ~/.wimym. Standard library only. Listens on 127.0.0.1 and
answers only requests whose Host is this machine.
"""
import argparse
import gzip
import json
import os
import re
import sys
import threading
import time
import webbrowser
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wimym import paths  # noqa: E402

if __name__ == "__main__" and "--demo" not in sys.argv:
    # the one place the old Mirror folders get moved, before the rest of wimym reads the names; never for the
    # demo, which runs this file again with its own folders set (its own HOME and WIMYM_* make this a no-op)
    paths.migrate()

from wimym import guide, labels, store, vitals  # noqa: E402
from wimym.codex import Codex  # noqa: E402
from wimym.gitlog import Git  # noqa: E402
from wimym.history import History  # noqa: E402
from wimym.index import Index  # noqa: E402
from wimym.model import Model  # noqa: E402
from wimym.paths import LABELS_DIR  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "app", "dist")
LOCAL = ("127.0.0.1", "localhost", "[::1]")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json",
         ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8"}
# the loop reads the transcripts at most this often: while any session runs one has always changed, and each change
# re-measures everything (5 to 10 s of CPU), so every 30 s kept a core busy. What you enter still shows at once.
READ_EVERY = 300


class Engine:
    """Keeps the index fresh and the model built from it."""

    def __init__(self):
        self.index = Index()
        self.history = History()
        self.git = Git()
        self.codex = Codex()
        self.git_at = 0
        self.read_at = 0
        self.model = None
        self.vitals = None
        self.lock = threading.Lock()
        self.payloads = {}
        self.inputs = None
        self.step = "starting"   # what the engine is doing now, for /api/state
        self.error = None
        self.ticking = threading.Lock()
        self.dirty = False

    def _inputs(self):
        def mt(p):
            try:
                return os.path.getmtime(p)
            except OSError:
                return 0
        names = ("categories", "categories-history", "signals", "acts", "acts-history", "sessions", "days", "weeks", "rules", "audit-opus")
        return tuple(mt(os.path.join(LABELS_DIR, n + ".json")) for n in names) + (store.mtime(), store.limits_mtime())

    def rebuild(self):
        self.step = "measuring"
        m = Model(self.index.records() + self.codex.records(), labels.load(), store.checkins(), self.history.list())
        payloads = {
            "core": {"generated": m.generated, "profile": m.profile, "days": m.days, "weeks": m.weeks, "projects": m.projects, "memory": m.memory},
            "messages": {"generated": m.generated, "messages": m.messages},
            "sessions": {"generated": m.generated, "sessions": [{k: v for k, v in s.items()} for s in m.sessions.values()]},
            "labels": guide.page(m),
        }
        v = vitals.build(m, git=self.git)
        payloads["vitals"] = v.payload()
        payloads["points"], payloads["points-ids"] = v.points()
        _write_pulse(v.pulse())
        enc = {k: _encode(v) for k, v in payloads.items()}
        with self.lock:
            self.model, self.payloads, self.vitals = m, enc, v

    def folders(self):
        return {t.get("cwd") for _, r in self.index.records() + self.codex.records() for t in r.get("turns") or []} | \
            {e.get("cwd") for e in self.history.entries.values()}

    def tick(self, git=True, read=True):
        """One pass at a time: a tick asked for while another runs marks the data dirty, and the running one goes
        round again before it lets go, so a check-in or a limit saved mid-rebuild is never lost."""
        self.dirty = True
        if not self.ticking.acquire(blocking=False):
            return
        try:
            while self.dirty:
                self.dirty = False
                try:
                    self._tick(git, read)
                except Exception:
                    self.step = "error"
                    raise
        finally:
            self.ticking.release()

    def safe_tick(self):
        """A tick from a POST, in its own thread: errors are logged and shown in /api/state, never lost."""
        try:
            self.tick(git=False)
        except Exception as e:
            self.error = f"{type(e).__name__}: {e}"
            import traceback
            traceback.print_exc()

    def _tick(self, git, read=True):
        changed = False
        if read:  # without it, only what you entered (labels, check-ins, limits) is looked at
            self.read_at = time.time()
            self.step = "indexing"
            changed = self.index.refresh()
            self.step = "history"
            changed = self.history.refresh() or changed
            changed = self.codex.refresh() or changed
        if git and time.time() - self.git_at > 300:  # git every five minutes; the first read takes half a minute
            self.git_at = time.time()
            self.step = "git"
            changed = self.git.refresh(self.folders() - {None}) or changed
        inputs = self._inputs()
        if changed or self.model is None or inputs != self.inputs:
            self.rebuild()
            self.inputs = inputs  # only once the rebuild that read them succeeded
        self.step, self.error = "ready", None

    def state(self):
        """What the engine is doing, in numbers and in words, for a loading screen (docs/contract-state.md)."""
        ix = self.index.state
        found = dict(ix.get("found") or {})
        if found.get("first"):
            found["firstDay"] = found.pop("first")[:10]
        else:
            found.pop("first", None)
            found["firstDay"] = None
        g = self.git.state
        if g.get("commits") or g.get("repos"):
            found.update(repos=g.get("repos"), commits=g.get("commits"))
        found["history"] = len(self.history.entries)
        step = "error" if self.error else self.step
        if step == "indexing" and ix.get("total"):
            label = f"Reading {ix['total']:,} transcripts… {ix['done']:,} so far"
            done, total = ix["done"], ix["total"]
        elif step == "git" and g.get("reading"):
            label = f"Reading your git history… {g.get('done', 0)} of {g.get('total', 0)} repositories"
            done, total = g.get("done", 0), g.get("total", 0)
        else:
            label = {"starting": "Waking up", "indexing": "Checking for new conversations", "history": "Reading your prompt history",
                     "git": "Reading your git history", "measuring": "Measuring your weeks", "ready": "Up to date",
                     "error": "Something went wrong; showing the last good reading"}[step]
            done, total = 0, 0
        return {"phase": step, "label": label, "done": done, "total": total, "first": self.model is None, "found": found,
                "updated": ix.get("updated"), "error": self.error}

    def loop(self):
        while True:
            try:
                self.tick(read=time.time() - self.read_at >= READ_EVERY)
            except Exception as e:  # keep serving the last good model
                self.error = f"{type(e).__name__}: {e}"
                import traceback
                traceback.print_exc()
            time.sleep(30)


def _write_pulse(p):
    """pulse.json in the cache dir, for hooks/limits.py and hooks/statusline.sh."""
    try:
        os.makedirs(paths.CACHE_DIR, exist_ok=True)
        dest = os.path.join(paths.CACHE_DIR, "pulse.json")
        tmp = paths.tmp_name(dest)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(p, f, separators=(",", ":"))
        os.replace(tmp, dest)
    except OSError:
        pass


def _encode(obj):
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    return {"raw": raw, "gz": gzip.compress(raw, 6), "generated": obj.get("generated")}


ENGINE = None


class Handler(BaseHTTPRequestHandler):
    server_version = "wimym"

    def log_message(self, *a):
        pass

    def send(self, code, body=b"", ctype="application/json", headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def json(self, obj):
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
        if len(body) > 20000 and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            return self.send(200, gzip.compress(body, 6), headers={"Content-Encoding": "gzip"})
        self.send(200, body)

    def payload(self, name):
        with ENGINE.lock:
            p = ENGINE.payloads.get(name)
        if not p:
            return self.json({"state": ENGINE.state(), "data": None})
        if "gzip" in (self.headers.get("Accept-Encoding") or ""):
            return self.send(200, p["gz"], headers={"Content-Encoding": "gzip"})
        self.send(200, p["raw"])

    def local(self):
        return (self.headers.get("Host") or "").rsplit(":", 1)[0] in LOCAL

    def do_GET(self):
        if not self.local():
            return self.send(403, b"forbidden", "text/plain")
        path, _, query = self.path.partition("?")
        if path == "/api/state":
            with ENGINE.lock:
                gen = ENGINE.model.generated if ENGINE.model else None
            return self.json({"state": ENGINE.state(), "generated": gen})
        if path in ("/api/core", "/api/messages", "/api/sessions", "/api/labels", "/api/vitals"):
            return self.payload(path[5:])
        if path == "/api/points":
            return self.payload("points-ids" if re.search(r"(?:^|&)ids=1(?:&|$)", query) else "points")
        if path == "/api/week":
            q = re.search(r"(?:^|&)start=(\d{4}-\d{2}-\d{2})", query)
            with ENGINE.lock:
                v = ENGINE.vitals
            if not v:
                return self.json({"state": ENGINE.state(), "data": None})
            start = q.group(1) if q else v.weeks[-1]
            w = v.week(start)
            return self.json(w) if w else self.send(404, b"no such week: start is a Monday from the first one with data", "text/plain")
        if path == "/api/limits":
            return self.json(store.limits())
        if path == "/api/practices":
            from wimym import practices
            return self.json({"practices": practices.practices(), "log": practices.log()})
        if path == "/api/rules":
            return self.json(labels.rules())
        if path == "/api/git":
            return self.json(ENGINE.git.summary())
        m = re.fullmatch(r"/api/day/(\d{4}-\d{2}-\d{2})", path)
        if m:
            try:
                date.fromisoformat(m.group(1))
            except ValueError:
                return self.send(404, b"no such day", "text/plain")
            with ENGINE.lock:
                model = ENGINE.model
            return self.json(model.day_detail(m.group(1)) if model else None)
        m = re.fullmatch(r"/api/message/(.+)", path)
        if m:
            with ENGINE.lock:
                model = ENGINE.model
            d = model.message_detail(unquote(m.group(1))) if model else None
            return self.json(d) if d else self.send(404, b"not found", "text/plain")
        if path.startswith("/api/"):
            return self.send(404, b"not found", "text/plain")
        return self.static(path)

    def static(self, path):
        if not os.path.isdir(DIST):
            return self.send(200, b"Wimym's app isn't built yet: run `npm install && npm run build` in app/, or `npm run dev` there.",
                             "text/plain; charset=utf-8")
        rel = os.path.normpath(unquote(path)).lstrip("/")
        full = os.path.join(DIST, rel)
        if rel.startswith("..") or not os.path.isfile(full):
            full = os.path.join(DIST, "index.html")  # the app routes its own pages
        with open(full, "rb") as f:
            body = f.read()
        ext = os.path.splitext(full)[1]
        cache = {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in full else {}
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(ext, "application/octet-stream"))
        for k, v in cache.items():
            self.send_header(k, v)
        if not cache:
            self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        """POST /api/checkin (how a day went) and /api/limits (what you mean to keep to), from the page.
        JSON only, this machine, this origin."""
        origin = self.headers.get("Origin")
        if not self.local() or (origin and (origin.split("://", 1)[-1].rsplit(":", 1)[0] not in LOCAL)):
            return self.send(403, b"forbidden", "text/plain")
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            return self.send(415, b"json only", "text/plain")
        n = int(self.headers.get("Content-Length") or 0)
        if n > 65536:
            return self.send(413, b"too large", "text/plain")
        try:
            body = json.loads(self.rfile.read(n) or b"null")
            if self.path == "/api/checkin":
                result = store.save_checkin(body)
            elif self.path == "/api/limits":
                result = store.save_limits(body)
            else:
                return self.send(404, b"not found", "text/plain")
        except (ValueError, TypeError, KeyError) as e:
            return self.send(400, json.dumps({"error": str(e)}).encode())
        threading.Thread(target=ENGINE.safe_tick, daemon=True).start()
        return self.json({"ok": True, "result": result})


def main():
    global ENGINE
    ap = argparse.ArgumentParser(description="Wimym (Where is your mind): you, as you work with AI agents.")
    ap.add_argument("--port", type=int, default=int(os.environ.get("WIMYM_PORT") or os.environ.get("MIRROR_PORT") or 8990))
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--demo", action="store_true", help="show Robin, a made-up person (engine/wimym/demo.py), on port 8997 unless --port; "
                                                         "nothing of yours is read")
    args = ap.parse_args()
    if args.demo:
        return demo(args)
    paths.clean_tmp(paths.CACHE_DIR)
    paths.clean_tmp(paths.DATA_DIR)
    ENGINE = Engine()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)  # listen first: the page narrates the first build

    def first():
        t0 = time.time()
        try:
            ENGINE.tick(git=False)  # git is read by the loop, after the first numbers are on screen
            print(f"index ready in {time.time() - t0:.1f}s: {len(ENGINE.index.files)} transcripts", flush=True)
        except Exception as e:
            ENGINE.error = f"{type(e).__name__}: {e}"
            import traceback
            traceback.print_exc()
        ENGINE.loop()
    threading.Thread(target=first, daemon=True).start()
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Wimym on {url}  (Ctrl-C to stop)", flush=True)
    if not args.no_open:
        threading.Timer(.5, webbrowser.open, [url]).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def demo(args):
    """Write the demo once a day into ~/.cache/wimym-demo, then run this server on it, and only on it: its own
    home, Claude folder, data and cache. GitHub tokens are left out, so nothing asks GitHub who you are."""
    from wimym import demo as made_up
    root = os.environ.get("WIMYM_DEMO") or os.path.join(os.path.expanduser("~"), ".cache", "wimym-demo")
    print("Writing the demo (Robin, a made-up person)…" if not os.path.exists(os.path.join(root, "demo.json")) else "", end="", flush=True)
    made_up.ensure(root)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("WIMYM_", "MIRROR_", "GH_", "GITHUB_", "CLAUDE_CONFIG_DIR"))}
    env.update(HOME=os.path.join(root, "home"), CLAUDE_CONFIG_DIR=os.path.join(root, "home", ".claude"),
               WIMYM_DATA=os.path.join(root, "data"), WIMYM_CACHE=os.path.join(root, "cache"), GIT_CONFIG_NOSYSTEM="1")
    port = args.port if "--port" in " ".join(sys.argv) or os.environ.get("WIMYM_PORT") else 8997
    argv = [sys.executable, os.path.abspath(__file__), "--port", str(port)] + (["--no-open"] if args.no_open else [])
    print(f"\nDemo: {root}", flush=True)
    os.execve(sys.executable, argv, env)


if __name__ == "__main__":
    main()
