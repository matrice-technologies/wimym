"""Reading what a transcript line says: is it a message you typed, where from, which project,
what kind of tool call. Rules carried over from claude-memory-map (server.py and its studies),
so prompt ids and labels line up with the labels Haiku already gave there."""
import os
import re
from collections import Counter

from .paths import HOME, SCRATCH

SR = re.compile(r"<(system-reminder|artifact-view-context)\b.*?</\1>", re.S)
CMD = re.compile(r"<command-name>/?([^<]+)</command-name>")
CMD_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.S)
WORKTREE = re.compile(r"/\.claude/worktrees/[^/]+")

# Prompts no person typed: notices, other sessions, bridge bookkeeping, headless work orders.
AUTO_START = ("<task-notification", "<side-sessions-event", "<ci-monitor-event", "<cross-session-message", "<agent-message",
              "Another Claude session", "<local-command", "[Bridge note", "# Work order", "# Dispatcher run", "# The coordinator",
              "[Image:", "Caveat:", "<scheduled-task", "[You opened the call", "[Your texts", "[Passed on for an answer")
# First prompt of a session another Claude session started.
BY_SESSION = ("Background (from the session", "Another Claude session", "<cross-session-message", "<agent-message",
              "<side-sessions-event", "Task (from the session")
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
QUESTIONS = {"AskUserQuestion", "ExitPlanMode"}


def prompt_of(o):
    """A user line → (text, images, kind) when it's a prompt, else None (tool results, meta lines)."""
    if o.get("isMeta") or o.get("isSidechain"):
        return None
    c = (o.get("message") or {}).get("content")
    images = 0
    if isinstance(c, list):
        if any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
            return None
        parts = []
        for x in c:
            if isinstance(x, dict) and x.get("type") == "text":
                parts.append(x.get("text") or "")
            elif isinstance(x, dict) and x.get("type") == "image":
                images += 1
        c = "\n".join(parts)
    if not isinstance(c, str):
        return None
    t = SR.sub("", c).strip()
    if t.startswith(("<bash-stdout", "<bash-stderr", "<local-command-stdout")):
        return None
    b = re.match(r"<bash-input>(.*?)</bash-input>", t, re.S)
    if b:
        return "!" + b.group(1).strip(), images, "shell"
    m = CMD.search(t)
    if m:
        a = CMD_ARGS.search(t)
        args = a.group(1).strip() if a else ""
        return "/" + m.group(1).strip().lstrip("/") + (" " + args if args else ""), images, "command"
    if not t and not images:
        return None
    return t, images, "prompt"


def source_of(o, text, cwd):
    """desk: you, in the app or a terminal; massistant: you, through the bridge; auto: nobody typed it.
    cwd is the folder the session started in: a line's own cwd follows Claude's shell around."""
    cwd = cwd or ""
    if o.get("promptSource") == "system" or text.startswith(AUTO_START):
        return "auto"
    if cwd.startswith(SCRATCH) or "/.matrice-bridge/" in cwd + "/" or "/.massistant-probe" in cwd or "/Library/Logs/" in cwd:
        return "auto"
    if (o.get("origin") or {}).get("kind") == "human" or o.get("turnOrigin") == "human":
        return "desk"
    if o.get("entrypoint") == "sdk-cli":
        return "massistant"
    return "auto" if o.get("turnOrigin") == "sdk" else "desk"


def tool_kind(name):
    if name == "Bash":
        return "shell"
    if name in EDIT_TOOLS:
        return "edit"
    if name in ("Read", "Grep", "Glob"):
        return "read"
    if name in ("WebSearch", "WebFetch"):
        return "web"
    if name.startswith(("mcp__Claude_Browser__", "mcp__claude-in-chrome__", "mcp__computer-use__")):
        return "browser"
    if name in ("Agent", "Task", "SendMessage", "Workflow") or name.startswith("mcp__ccd_session__"):
        return "agents"
    if name in ("Skill",):
        return "skill"
    if name in QUESTIONS or name in ("TodoWrite", "EnterPlanMode"):
        return "plan"
    return "other"


def project_of(cwd):
    if not cwd:
        return "?"
    cwd = WORKTREE.sub("", cwd)
    if "/local-agent-mode-sessions/" in cwd or cwd.startswith("/sessions/"):  # Cowork: its folder here, or inside its sandbox
        return "cowork"
    if cwd.startswith(SCRATCH):
        return "scratchpads"
    if "/.matrice-bridge" in cwd:
        return "bridge contacts"
    if cwd == HOME:
        return "~"
    if cwd.startswith(HOME + "/"):
        return cwd[len(HOME) + 1:].split("/")[0]
    return cwd


# ---------------------------------------------------------------------------
# Text you didn't type, whatever Haiku says: test pings and work orders one session wrote for
# another. The same rule as claude-memory-map's categorize.py (NOT_TYPED, as of its commit 1223a32);
# its labels carry it as "ag" only for messages labelled after a rule was added, so Wimym applies it too.

NOT_TYPED = [
    re.compile(r"^\s*reply with exactly\b", re.I),
    re.compile(r"^\s*(?:continue sdlc dev\.\s*)?you are (?:a |an |the |starting|continuing|implementing|building|working)", re.I),
    re.compile(r"\bAlex\b(?! *[,:])(?=.{0,40}\b(?:wants|is|has|asked|said|owns|\(|will|needs|prefers)\b)"),
    re.compile(r"\b(?:read|boot per) `?(?:CLAUDE|AGENTS|BOOT|sdlc/BOOT)\.md`?(?: and [^.\n]{0,60})? first\b", re.I),
    re.compile(r"\bboot (?:via|per) `?\S*BOOT\.md", re.I),
    re.compile(r"\bread memory\b.{0,60}\bfirst\b", re.I),
    re.compile(r"^In ~/\S+ \("),
]
_HEADING = re.compile(r"^#{2,3} \S", re.M)


def not_typed(t):
    return any(r.search(t) for r in NOT_TYPED) or (len(t) > 600 and len(_HEADING.findall(t)) >= 2)


# ---------------------------------------------------------------------------
# Your own words, without what the app or the bridge wraps around them.

_BRACKET = re.compile(r"^\s*\[[^\]\n]{0,200}\]\s*")
_PASTE = re.compile(r"<pasted_content\b.*?(?:</pasted_content>|$)", re.S)
_COMMENT = re.compile(r"=== BEGIN ARTIFACT COMMENT (\w+) ===\n(.*?)\n=== END ARTIFACT COMMENT \1 ===", re.S)
_NOT_YOU = ("[Contact report", "[Bridge", "[Passed on")


def own_words(text):
    t = text or ""
    if t.startswith(_NOT_YOU):
        return ""
    m = _COMMENT.search(t)
    if m:
        t = re.sub(r"^> ?", "", m.group(2), flags=re.M)
        return re.sub(r"^[@＠]Claude\b[\s,:]*", "", t.strip()).strip()
    while t.lstrip().startswith("["):
        i = t.find("]\n\n", 0, 4000)
        u = t[i + 3:] if i >= 0 else _BRACKET.sub("", t, count=1)
        if u == t:
            break
        t = u
    return _PASTE.sub(" ", t).strip()


def pasted(text):
    """Characters you pasted in (pasted_content blocks) rather than typed."""
    return sum(len(m.group(0)) for m in _PASTE.finditer(text or ""))


# ---------------------------------------------------------------------------
# Language and typos, by plain rules (from the "Your days" study).

_FR = re.compile(r"\b(je|tu|est|pas|pour|avec|les|des|une|peux|c'est|qu'|mais|faire|merci|oui|ça|cette|nous|vous|dans|sur)\b", re.I)
_EN = re.compile(r"\b(the|is|can|you|we|it|and|to|this|that|let's|please|with|are|what|for|of)\b", re.I)
_WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_LINKS = re.compile(r"https?://\S+|`[^`]*`|\S*[/_.@#=<>{}\\]\S*")
_STRIP = re.compile(r"https?://\S+|`[^`]*`|\S*[/_.@#=<>{}\\]\S*|\b[A-Z][a-z]+\b")
_AB = "abcdefghijklmnopqrstuvwxyz"


def lang(t):
    f, e = len(_FR.findall(t)), len(_EN.findall(t))
    return "fr" if f > e else "en" if e > f else None


def words_of(t):
    """Lowercase words of a message, without links, paths, code, names and contractions."""
    return [w for w in _WORD.findall(_STRIP.sub(" ", t)) if w.islower() and "'" not in w]


def _edits1(w):
    sp = [(w[:i], w[i:]) for i in range(len(w) + 1)]
    return ({a + b[1:] for a, b in sp if b} | {a + b[1] + b[0] + b[2:] for a, b in sp if len(b) > 1}
            | {a + c + b[1:] for a, b in sp if b for c in _AB} | {a + c + b for a, b in sp for c in _AB})


class Speller:
    """A word is a typo when neither the system dictionary nor Claude's replies spell it that way,
    it isn't a plural or British form of one they have, and one they do have is one edit away."""

    def __init__(self, replies):
        try:
            with open("/usr/share/dict/words", encoding="utf-8") as f:
                self.D = {w.strip().lower() for w in f if w.strip()}
        except OSError:
            self.D = set()
        c = Counter(w.lower() for t in replies for w in _WORD.findall(_LINKS.sub(" ", t)) if "'" not in w)
        self.K = {w for w, n in c.items() if n >= 3} | self.D
        self.cache = {}

    def known(self, w):
        K = self.K
        if w in K:
            return True
        for suf, rep in (("s", ""), ("es", ""), ("ies", "y"), ("ed", ""), ("ed", "e"), ("d", ""), ("ing", ""), ("ing", "e"),
                         ("ly", ""), ("er", ""), ("ers", ""), ("isation", "ization"), ("ise", "ize"), ("ised", "ized"),
                         ("ising", "izing"), ("our", "or"), ("ours", "ors"), ("ement", "ment"), ("lled", "led"), ("lling", "ling")):
            if w.endswith(suf) and len(w) - len(suf) >= 3 and w[:-len(suf)] + rep in K:
                return True
        return False

    def typo(self, w):
        if w in self.cache:
            return self.cache[w]
        r = len(w) >= 4 and bool(self.D) and not self.known(w) and any(c in self.K for c in _edits1(w) if len(c) >= 3)
        self.cache[w] = r
        return r

    def check(self, t):
        """(typo words, words checked) in an English message."""
        ws = words_of(t)
        if len(ws) < 4:
            return [], 0
        return [w for w in ws if self.typo(w)], len(ws)
