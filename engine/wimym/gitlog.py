"""What landed: the git repositories behind the folders you worked in, read with the git CLI.

A folder's repository is found with `git rev-parse --git-common-dir`, so every worktree of a
repository counts once. For each repository Wimym keeps, in the cache dir (git.json):

  commits   sha → {"at": unix time, "a": author email, "k": "you" | "agent" | "person",
            "cc": a Claude co-author, "cp": co-authors who are people, "f": files, "add", "del",
            "p": parents, "l": reached the default branch (landed)}
  open      branch tips the default branch doesn't contain: {"name", "sha", "at", "ahead"}
            (abandoned candidates: what decides abandoned is how long since "at")

Commits are read once; a repository is read again only when one of its refs moved, and then only
the commits not reachable from the refs seen before. Landed is worked out again each time, since
merging a branch lands commits that were already read.

Pull requests, for repositories on GitHub, come from the gh CLI at most every six hours, and only when you
turn it on (it asks GitHub, over the network): WIMYM_GITHUB=1, or {"github": true} in the data dir's
settings.json. Off by default.
  prs       [{"n", "by": author login, "at": created, "merged": time or None, "state",
             "reviews": [{"by", "at", "state"}], "comments": [{"by", "at"}]}]

Survival, on a sample: up to SAMPLE landed commits a week (by you or an agent, chosen by sha so the sample
never changes) are blamed on the default branch as it stood 30 days after each one, file by file, and the
lines still attributed to the commit are counted. Kept per repository in "surv": sha → [lines counted,
lines still there]; a commit's answer never changes once 30 days have passed. A file moved or renamed since is
blamed at its new path. Done a minute at a time.

Who is you: the name and emails in git config (global and each repository's), any email used with
that name, and emails whose part before @ is that name without its punctuation (alex.collet@…). With no
git config at all, a guess: the author of the most commits with Claude as co-author ("guessed" in summary()).
Agents: anthropic.com and cursor.com addresses and bots. Everyone else is a person.
"""
import hashlib
import json
import os
import re
import subprocess
import threading
import time
from collections import Counter
from datetime import datetime

from . import paths
from .paths import CACHE_DIR
from .text import WORKTREE, project_of

KEPT = os.path.join(CACHE_DIR, "git.json")
VERSION = 1
FMT = "%x1e%H%x1f%at%x1f%an%x1f%ae%x1f%P%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)"
EMAIL = re.compile(r"<([^>]+)>")
GITHUB = re.compile(r"github[\w.-]*[:/]([^/:\s]+/[^/\s]+?)(?:\.git)?$")  # github.com, or an ssh alias like github-work:
BOTS = {"linear", "vercel", "netlify", "github-actions", "dependabot", "codecov", "coderabbitai", "sonarcloud", "copilot", "renovate", "cursor"}
PR_EVERY = 6 * 3600  # seconds between two reads of a repository's pull requests (all of them take a minute or two)
PR_VERSION = 2
SAMPLE = 6          # commits a week sampled for survival
SURV_VERSION = 2    # 2: follows renames
SURVIVE = 30        # days
MAX_FILES = 8       # files blamed per commit
SKIP = re.compile(r"(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|uv\.lock)$|\.(min\.js|map|svg|lock)$|(^|/)(dist|build|vendor|node_modules)/")


def _git(args, gitdir=None, stdin=None, timeout=300):
    cmd = ["git"] + (["--git-dir", gitdir] if gitdir else []) + args
    try:
        r = subprocess.run(cmd, input=stdin, capture_output=True, text=True, errors="replace", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 else None


def agent(name, email):
    e, n = (email or "").lower(), (name or "").lower()
    return e.endswith(("@anthropic.com", "@cursor.com")) or "[bot]" in e or "[bot]" in n or n.startswith(("claude", "cursor agent"))


def _squash(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def github_on():
    """Whether reading pull requests from GitHub (through gh) is turned on: off unless the person says so."""
    if os.environ.get("WIMYM_GITHUB"):
        return os.environ["WIMYM_GITHUB"] not in ("0", "false", "no")
    s = paths.read_json(os.path.join(paths.DATA_DIR, "settings.json"), {})
    return bool(isinstance(s, dict) and s.get("github"))


class Git:
    """readonly: for callers outside the server (the CLI's database): reads the cache and the repositories, never
    writes the cache and never asks GitHub anything."""

    def __init__(self, readonly=False):
        self.readonly = readonly
        self.lock = threading.Lock()
        self.folders = {}  # folder → git common dir, or None when not in a repository
        self.repos = {}    # git common dir → {"top", "project", "sig", "default", "commits", "open", "names", "emails"}
        self.state = {"read": False, "repos": 0, "commits": 0, "error": None}
        self.meta = {}
        d = paths.read_json(KEPT, {})
        if isinstance(d, dict) and d.get("v") == VERSION:  # another version: read again from the repositories
            self.folders, self.repos = d.get("folders") or {}, d.get("repos") or {}
            self.meta = d.get("meta") or {}

    # -- finding the repositories -----------------------------------------------------------
    def _resolve(self, folder):
        for cand in (folder, WORKTREE.sub("", folder)):
            if os.path.isdir(cand):
                out = _git(["-C", cand, "rev-parse", "--path-format=absolute", "--git-common-dir"])
                if out and out.strip():
                    return out.strip()
        return None

    def refresh(self, folders):
        """Read what changed in the repositories behind these folders; True when anything did."""
        changed = False
        for f in folders:
            if f and f not in self.folders:
                self.folders[f] = self._resolve(f)
                changed = True
        repos = sorted({g for g in self.folders.values() if g})
        self.state.update(reading=True, done=0, total=len(repos))
        for i, g in enumerate(repos):
            self.state["done"] = i
            try:
                changed = self._read(g) or changed
                self.state.update(repos=len(self.repos), commits=sum(len(r["commits"]) for r in self.repos.values()))
            except Exception as e:  # one broken repository doesn't stop the others
                self.state["error"] = f"{g}: {type(e).__name__}: {e}"
        if github_on() and not self.readonly:
            for g, r in self.repos.items():
                if time.time() - (r.get("prsAt") or 0) > PR_EVERY or r.get("prsV") != PR_VERSION:
                    changed = self._prs(g, r) or changed
        self.state.update(done=len(repos), commits=sum(len(r["commits"]) for r in self.repos.values()))
        changed = self.survival_step() or changed
        self.state["reading"] = False
        self.state.update(read=True, repos=len(self.repos), commits=sum(len(r["commits"]) for r in self.repos.values()),
                          prs=sum(len(r.get("prs") or []) for r in self.repos.values()))
        if changed:
            self.save()
        return changed

    def _refs(self, g):
        out = _git(["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/remotes", "refs/tags"], g)
        return [l.split(" ", 1) for l in (out or "").splitlines() if " " in l]

    def _default(self, g):
        out = _git(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"], g)
        refs = []
        if out and out.strip():
            refs.append(out.strip())
        for b in ("main", "master", "trunk"):
            if _git(["rev-parse", "-q", "--verify", "refs/heads/" + b], g):
                refs.append("refs/heads/" + b)
                break
        if not out:
            for b in ("main", "master"):
                if _git(["rev-parse", "-q", "--verify", "refs/remotes/origin/" + b], g):
                    refs.append("refs/remotes/origin/" + b)
                    break
        return refs

    def _read(self, g):
        refs = self._refs(g)
        sig = hashlib.sha1("\n".join(sorted(" ".join(r) for r in refs)).encode()).hexdigest()
        old = self.repos.get(g)
        if old and old.get("sig") == sig:
            return False
        top = os.path.dirname(g) if os.path.basename(g) == ".git" else g
        repo = old or {"top": top, "project": project_of(top), "commits": {}}
        cfg = [_git(["config", "--get", k], g) for k in ("user.name", "user.email")]
        repo["names"] = sorted({x.strip() for x in cfg[:1] if x and x.strip()})
        repo["emails"] = sorted({x.strip().lower() for x in cfg[1:] if x and x.strip()})
        # only commits not reachable from what was read before
        seen_tips = set(old.get("tips") or []) if old else set()
        stdin = "".join("^" + s + "\n" for s in sorted(seen_tips))
        out = _git(["log", "--branches", "--remotes", "--tags", "--stdin", "--numstat", "--no-renames", "--format=" + FMT], g, stdin=stdin)
        if out is None:
            return False
        C = repo["commits"]
        for chunk in out.split("\x1e")[1:]:
            head, _, rest = chunk.partition("\n")
            parts = head.split("\x1f")
            if len(parts) < 6:
                continue
            sha, at, an, ae, par, co = parts[:6]
            co = [c.strip() for c in co.replace("\n", "\x1d").split("\x1d") if c.strip()]
            claude = any(agent(c, (EMAIL.search(c) or [None, ""])[1]) for c in co)
            people = sum(1 for c in co if not agent(c, (EMAIL.search(c) or [None, ""])[1]))
            add = dele = files = 0
            for l in rest.splitlines():
                a = l.split("\t")
                if len(a) == 3:
                    files += 1
                    add += int(a[0]) if a[0].isdigit() else 0
                    dele += int(a[1]) if a[1].isdigit() else 0
            C[sha] = {"at": int(at), "n": an, "a": ae.lower(), "co": co[:4], "cc": claude, "cp": people,
                      "f": files, "add": add, "del": dele, "p": len(par.split()), "l": False}
        # landed: reachable from the default branch, here or on origin
        repo["default"] = self._default(g)
        landed = set((_git(["rev-list"] + repo["default"], g) or "").split()) if repo["default"] else set()
        for sha, c in C.items():
            c["l"] = sha in landed
        # branch tips the default branch doesn't contain
        base = repo["default"][0] if repo["default"] else None
        opens = []
        if base:
            out = _git(["for-each-ref", f"--format=%(refname:short)\x1f%(objectname)\x1f%(committerdate:unix)\x1f%(ahead-behind:{base})",
                        "refs/heads", "refs/remotes"], g) or ""
            for l in out.splitlines():
                p = l.split("\x1f")
                if len(p) < 4 or p[1] in landed or p[0].endswith("/HEAD") or p[0] == "origin":
                    continue
                ahead = p[3].split()[0] if p[3].strip() else "0"
                if ahead.isdigit() and int(ahead) > 0:
                    opens.append({"name": p[0], "sha": p[1], "at": int(p[2] or 0), "ahead": int(ahead)})
        repo.update(sig=sig, open=opens, tips=sorted({r[0] for r in refs}))
        self.repos[g] = repo
        return True

    def _prs(self, g, repo):
        """Pull requests of a repository on GitHub, with their reviews and comments, through gh."""
        repo["prsAt"], repo["prsV"] = time.time(), PR_VERSION
        m = GITHUB.search((_git(["config", "--get", "remote.origin.url"], g) or "").strip())
        if not m:
            return False
        try:
            r = subprocess.run(["gh", "pr", "list", "--repo", m.group(1), "--state", "all", "--limit", "1000",
                                "--json", "number,author,createdAt,mergedAt,state,reviews,comments"],
                               capture_output=True, text=True, timeout=60)
            rows = json.loads(r.stdout) if r.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired, ValueError):
            rows = None
        if rows is None:
            return False

        def who(x):
            return ((x or {}).get("author") or {}).get("login")
        repo["prs"] = [{"n": p["number"], "by": who(p), "at": p.get("createdAt"), "merged": p.get("mergedAt"), "state": p.get("state"),
                        "reviews": [{"by": who(x), "at": x.get("submittedAt"), "state": x.get("state")} for x in p.get("reviews") or []],
                        "comments": [{"by": who(x), "at": x.get("createdAt")} for x in p.get("comments") or []]} for p in rows]
        repo["github"] = m.group(1)
        return True

    # -- survival ----------------------------------------------------------------------------
    def _sample(self):
        """(git dir, repo, sha, commit) for the commits sampled for survival, old enough to be measured."""
        names, emails = self.identities()
        cut = time.time() - SURVIVE * 86400
        by_week = {}
        for g, r in self.repos.items():
            if not r.get("default"):
                continue
            for sha, c in r["commits"].items():
                if not c["l"] or c["p"] > 1 or not 1 <= c["add"] <= 5000 or c["at"] > cut:
                    continue
                if not (agent(c["n"], c["a"]) or c["a"] in emails or c["n"] in names):
                    continue
                wk = int((c["at"] + 3 * 86400) // (7 * 86400))  # weeks starting Monday (1970-01-01 was a Thursday)
                by_week.setdefault(wk, []).append((g, r, sha, c))
        out = []
        for wk, xs in by_week.items():
            seen = set()
            for x in sorted(xs, key=lambda x: x[2]):
                if x[2] not in seen:
                    seen.add(x[2])
                    out.append(x)
                if len(seen) >= SAMPLE:
                    break
        return out

    def _survive(self, g, r, sha, c):
        """[lines counted, lines still attributed to sha] at the default branch SURVIVE days after the commit."""
        at = c["at"] + SURVIVE * 86400
        rev = (_git(["rev-list", "-1", f"--before={at}", r["default"][0]], g) or "").strip()
        if not rev:
            return None
        files = []
        for l in (_git(["show", "--numstat", "--format=", "--no-renames", sha], g) or "").splitlines():
            a = l.split("\t")
            if len(a) == 3 and a[0].isdigit() and int(a[0]) > 0 and not SKIP.search(a[2]):
                files.append((int(a[0]), a[2]))
        # files moved or renamed since: blame them where they are now (rename detection needs the whole diff)
        moved = {}
        for l in (_git(["diff", "-M", "--name-status", "--diff-filter=R", sha, rev], g, timeout=120) or "").splitlines():
            a = l.split("\t")
            if len(a) == 3:
                moved[a[1]] = a[2]
        counted = kept = 0
        for added, f in sorted(files, reverse=True)[:MAX_FILES]:
            counted += added
            out = _git(["blame", "-l", "-s", "-w", rev, "--", moved.get(f, f)], g, timeout=60)
            if out:
                kept += sum(1 for l in out.splitlines() if l.startswith(sha))
        return [counted, min(kept, counted)]

    def survival_step(self, budget=60):
        """Blame sampled commits not measured yet, for at most budget seconds; True when any was measured."""
        t0, done = time.time(), 0
        for r in self.repos.values():
            if r.get("survV") != SURV_VERSION:
                r["surv"], r["survV"] = {}, SURV_VERSION
        for g, r, sha, c in self._sample():
            surv = r.setdefault("surv", {})
            if sha in surv:
                continue
            if time.time() - t0 > budget:
                break
            surv[sha] = self._survive(g, r, sha, c)
            done += 1
        self.state["survival"] = {"measured": sum(len(r.get("surv") or {}) for r in self.repos.values())}
        return bool(done)

    def survival(self):
        """[{"sha", "project", "at", "counted", "kept"}] for every sampled commit measured so far."""
        return [{"sha": sha, "project": r["project"], "at": r["commits"][sha]["at"], "counted": v[0], "kept": v[1]}
                for r in list(self.repos.values()) for sha, v in list((r.get("surv") or {}).items()) if v and v[0] and sha in r["commits"]]

    def login(self):
        """Your GitHub login, asked of gh once and kept in git.json."""
        if self.meta.get("login") is None and not self.meta.get("loginTried") and github_on() and not self.readonly:
            try:
                r = subprocess.run(["gh", "api", "user", "--jq", ".login"], capture_output=True, text=True, timeout=20)
                self.meta["login"] = r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None
            except (OSError, subprocess.TimeoutExpired):
                pass
            self.meta["loginTried"] = time.time()
            self.save()
        return self.meta.get("login")

    def reviews(self):
        """Reviews and comments by other people on pull requests: [{"project", "pr", "by", "at": unix, "kind"}]."""
        me = (self.login() or "").lower()
        out = []
        for r in self.repos.values():
            for p in r.get("prs") or []:
                for kind in ("reviews", "comments"):
                    for x in p.get(kind) or []:
                        by = (x.get("by") or "")
                        if not by or by.lower() in (me, *BOTS) or by.endswith("[bot]") or agent(by, "") or not x.get("at"):
                            continue
                        try:
                            at = datetime.fromisoformat(x["at"].replace("Z", "+00:00")).timestamp()
                        except ValueError:
                            continue
                        out.append({"project": r["project"], "pr": p["n"], "by": by, "at": at, "kind": kind[:-1]})
        return out

    def save(self):
        if self.readonly:
            return
        paths.write_json(KEPT, {"v": VERSION, "folders": self.folders, "repos": self.repos, "meta": self.meta}, separators=(",", ":"))

    # -- who is you ------------------------------------------------------------------------
    def identities(self):
        key = self.state.get("commits"), len(self.repos)
        if getattr(self, "_ids", None) and self._ids[0] == key:
            return self._ids[1]
        self._ids = (key, self._identities())
        return self._ids[1]

    def _identities(self):
        names = set(n for r in self.repos.values() for n in r.get("names") or [])
        emails = set(e for r in self.repos.values() for e in r.get("emails") or [])
        for k in ("user.name", "user.email"):
            v = (_git(["config", "--global", "--get", k]) or "").strip()
            if v:
                (names if k == "user.name" else emails).add(v if k == "user.name" else v.lower())
        self.guessed = False
        if not names and not emails:
            # no git config: guess from the author who made the most commits with Claude as co-author
            c = Counter((c["n"], c["a"]) for r in self.repos.values() for c in r["commits"].values() if c["cc"] and not agent(c["n"], c["a"]))
            if c:
                (n, e), _ = c.most_common(1)[0]
                names, emails, self.guessed = {n}, {e}, True
        squashed = {_squash(n) for n in names}
        for r in self.repos.values():
            for c in r["commits"].values():
                if c["n"] in names or _squash(c["a"].split("@")[0]) in squashed:
                    emails.add(c["a"])
        return names, emails

    def commits(self, prefer=None):
        """Every commit once, with its project and who wrote it. A repository can sit behind several folders, and
        two repositories can share history (a fork, a copy): a sha shared by both goes to the one in prefer
        (a Counter of messages by project), else the one with more commits.
        [{"sha", "project", "at", "who": "you" | "agent" | "person", "claude": co-authored by Claude,
          "people": co-authors who are people, "files", "add", "del", "merge", "landed"}]."""
        names, emails = self.identities()
        out, seen = [], set()
        prefer = prefer or {}
        landed = {sha for r in list(self.repos.values()) for sha, c in list(r["commits"].items()) if c["l"]}
        order = sorted(list(self.repos.values()), key=lambda r: (-prefer.get(r["project"], 0), -len(r["commits"])))
        for r in order:
            for sha, c in list(r["commits"].items()):
                if sha in seen:
                    continue
                seen.add(sha)
                who = "agent" if agent(c["n"], c["a"]) else "you" if (c["a"] in emails or c["n"] in names) else "person"
                out.append({"sha": sha, "repo": r["project"], "project": r["project"], "at": c["at"], "who": who,
                            "claude": c["cc"], "people": c["cp"], "files": c["f"], "add": c["add"], "del": c["del"],
                            "merge": c["p"] > 1, "landed": sha in landed})
        out.sort(key=lambda c: c["at"])
        return out

    def open_branches(self):
        names, emails = self.identities()
        out = []
        for r in self.repos.values():
            for b in r.get("open") or []:
                c = r["commits"].get(b["sha"]) or {}
                who = "agent" if agent(c.get("n"), c.get("a")) else "you" if (c.get("a") in emails or c.get("n") in names) else "person"
                out.append(dict(b, project=r["project"], who=who if c else None))
        return out

    def summary(self):
        """For /api/git, which can be asked while a refresh runs: tried again if a dict changes under it."""
        for _ in range(5):
            try:
                return self._summary()
            except RuntimeError:
                time.sleep(.2)
        return {"repos": [], "you": None, "state": self.state}

    def _summary(self):
        names, emails = self.identities()
        return {"repos": [{"project": r["project"], "top": paths.tilde(r["top"]),
                           "default": (r.get("default") or [None])[0], "commits": len(r["commits"]),
                           "landed": sum(c["l"] for c in r["commits"].values()), "open": len(r.get("open") or []),
                          "github": r.get("github"), "prs": len(r.get("prs") or [])}
                          for r in sorted(self.repos.values(), key=lambda r: -len(r["commits"]))],
                "you": {"names": sorted(names), "emails": sorted(emails), "github": self.login(),
                        "guessed": getattr(self, "guessed", False)}, "state": self.state}


def commits(prefer=None, folders=None):
    """Every commit as rows (see Git.commits), from the cache, without a server: read-only, nothing written and
    nothing asked of GitHub. With folders, the repositories behind them are read first."""
    g = Git(readonly=True)
    if folders:
        g.refresh(folders)
    return g.commits(prefer)
