"""What your agents remember about you: Claude Code's memory notes (~/.claude/projects/*/memory/*.md).

Notes of type "user" say who you are; "feedback" notes say how you want agents to work. They
are the agents' own picture of you, written down; the rest of Wimym is what your messages show.
"""
import glob
import os
import re

from .paths import HOME, PROJECTS, tilde

HOME_SLUG = HOME.replace("/", "-")


def project_label(slug):
    if slug.startswith("-private-tmp") or slug.startswith("-tmp"):
        return "scratchpads"
    base = slug.split("--claude-worktrees-")[0]
    if base.startswith(HOME_SLUG + "-"):
        return base[len(HOME_SLUG) + 1:] or "~"
    return "~" if base == HOME_SLUG else base.strip("-")


def parse(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    meta, body = {}, text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if m:
        body = m.group(2)
        for line in m.group(1).splitlines():
            kv = re.match(r"^\s*(\w+):\s*(.*)$", line)
            if kv and kv.group(2).strip():
                meta.setdefault(kv.group(1), kv.group(2).strip().strip("\"'"))
    return meta, body.strip()


def notes():
    out = []
    for p in glob.glob(os.path.join(PROJECTS, "*", "memory", "*.md")):
        if os.path.basename(p) == "MEMORY.md":
            continue
        try:
            meta, body = parse(p)
            mtime = os.path.getmtime(p)
        except OSError:
            continue
        typ = meta.get("type")
        if not typ:  # newer notes keep it under metadata:
            m = re.search(r"^\s+type:\s*(\w+)", open(p, encoding="utf-8", errors="replace").read()[:800], re.M)
            typ = m.group(1) if m else "other"
        slug = p.split(os.sep)[-3]
        out.append({"path": p, "name": meta.get("name") or os.path.splitext(os.path.basename(p))[0],
                    "desc": meta.get("description", ""), "type": typ, "project": project_label(slug),
                    "mtime": int(mtime), "body": re.sub(r"\n{3,}", "\n\n", body)[:1400], "file": tilde(p)})
    return out
