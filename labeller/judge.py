#!/usr/bin/env python3
"""A second judge for any label set: cards for an Opus session to mark, and the accuracy its marks give.

    python3 labeller/judge.py cards acts --ids IDS.json --out DIR --chunks 6   # DIR/cards-N.json, one per judge
    python3 labeller/judge.py cards sessions --out DIR --chunks 4              # the set's stored sample
    python3 labeller/judge.py score acts --marks DIR                           # accuracy from DIR/marks-*.json

A card holds what the labeller saw and the labels it gave. A judge writes marks-N.json beside cards-N.json:
[{"id": …, "marks": {field: {"ok": true | false | null, "fix": the right value when false, "why": "…"}}}].
"ok": null means the definition doesn't settle it; those are left out of the counts.
"""
import argparse
import glob
import json
import math
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import label as L  # noqa: E402
from label import DEFS, load_json  # noqa: E402
from wimym.paths import LABELS_DIR  # noqa: E402


def wilson(k, n, z=1.96):
    if not n:
        return 0, 0
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0, (c - r) / d), min(1, (c + r) / d)


def cards(name, ids_file, out, chunks, folder):
    store = load_json(os.path.join(folder, DEFS[name]["file"]))
    labs = store.get("labels") or {}
    ids = load_json(ids_file) if ids_file else store.get("sample") or []
    keys = [f["key"] for f in DEFS[name]["fields"]]
    if name == "rules":  # a card per group: the rule and the words of every message in it
        mine = L.load_prompts()[0]
        prompts = {p["id"]: p for p in mine + L.load_history(mine)}
        acts = {**(load_json(os.path.join(folder, L.file_of("acts", True))).get("labels") or {}),
                **(load_json(os.path.join(folder, DEFS["acts"]["file"])).get("labels") or {})}
        rows = [{"id": str(n), "labels": {k: g[k] for k in ("rule", "kind", "known")},
                 "members": [{"id": i, "project": prompts[i]["project"], "extracted": (acts.get(i) or {}).get("rule"),
                              "alex": prompts[i]["text"][:1200]} for i in g["ids"] if i in prompts]}
                for n, g in enumerate(store.get("groups") or [])]
    elif DEFS[name].get("level", "message") == "message":
        prompts = {p["id"]: p for p in L.load_prompts()[0]}
        rows = [{"id": i, "project": prompts[i]["project"], "claude_before": L.before_of(name, prompts[i]),
                 "alex": prompts[i]["text"], "labels": {k: labs[i].get(k) for k in keys}}
                for i in ids if i in labs and i in prompts]
    else:
        import accounts as A
        sessions = A.load_sessions()
        if name == "sessions":
            src = {s["id"]: A.session_text(s) for s in sessions if s["id"] in set(ids)}
        elif name == "weeks":
            src = {w["id"]: A.week_text(w) for w in A.load_weeks(folder) if w["id"] in set(ids)}
        else:
            src = {d["id"]: A.day_text(d) for d in A.load_days(sessions, folder) if d["id"] in set(ids)}
        rows = []
        for i in ids:
            if i in labs and i in src:
                lab = {k: labs[i].get(k) for k in keys}
                for f in DEFS[name]["fields"]:  # show the short ids the writer saw
                    if f["type"] == "refs":
                        lab[f["key"]] = [{"t": x["t"], "m": A.ref(x["m"]) if x.get("m") else ""} for x in lab[f["key"]]]
                rows.append({"id": i, "input": src[i], "labels": lab})
    os.makedirs(out, exist_ok=True)
    size = math.ceil(len(rows) / chunks)
    for n in range(chunks):
        part = rows[n * size:(n + 1) * size]
        if part:
            with open(os.path.join(out, f"cards-{n + 1}.json"), "w", encoding="utf-8") as f:
                json.dump(part, f, ensure_ascii=False, indent=1)
    print(f"{len(rows)} cards in {chunks} files in {out}")


def score(name, marks_dir, extra_file=None):
    marks = []
    for f in sorted(glob.glob(os.path.join(marks_dir, "marks-*.json"))):
        marks += load_json(f) or []
    cardsets = {}
    for f in glob.glob(os.path.join(marks_dir, "cards-*.json")):
        for c in load_json(f) or []:
            cardsets[c["id"]] = c
    extra = (load_json(extra_file) or {}).get("extra") or {} if extra_file else {}
    out = {"set": name, "v": DEFS[name]["version"], "cards": len(marks), "fields": {}}
    print(f"{name} v{DEFS[name]['version']}: {len(marks)} cards marked")
    for f in DEFS[name]["fields"]:
        k = f["key"]
        rows = []
        for m in marks:
            mk = (m.get("marks") or {}).get(k)
            c = cardsets.get(m.get("id"))
            if mk is None or c is None or mk.get("ok") is None:
                continue
            rows.append((c["labels"].get(k), bool(mk["ok"]), mk.get("fix"), m["id"] in extra, mk.get("why"), c))
        rnd = [r for r in rows if not r[3]]
        right = sum(r[1] for r in rnd)
        lo, hi = wilson(right, len(rnd))
        res = {"random": [right, len(rnd)], "ci": [round(lo, 2), round(hi, 2)]}
        line = f"  {k:<10} random {right}/{len(rnd)} ({100 * lo:.0f}–{100 * hi:.0f}%)"
        if f["type"] in ("bool", "enum"):
            vals = Counter(json.dumps(r[0]) for r in rows)
            per = {}
            for v in vals:
                rr = [r for r in rows if json.dumps(r[0]) == v]
                ok = sum(r[1] for r in rr)
                per[v] = [ok, len(rr)]
            missed = Counter(json.dumps(r[2]) for r in rows if not r[1] and r[2] is not None)
            res.update(precision=per, missed=dict(missed))
            line += "   given → right (all cards): " + ", ".join(f"{v} {a}/{b}" for v, (a, b) in sorted(per.items(), key=lambda x: -x[1][1]))
            if missed:
                line += "   should have been: " + ", ".join(f"{v} {n}" for v, n in missed.most_common())
        else:
            ok_all = sum(r[1] for r in rows)
            filled = [r for r in rows if r[0] not in ("", [], None)]
            res.update(all=[ok_all, len(rows)], filled=[sum(r[1] for r in filled), len(filled)])
            line += f"   all {ok_all}/{len(rows)}, filled ones right {sum(r[1] for r in filled)}/{len(filled)}"
        out["fields"][k] = res
        print(line)
        for r in [r for r in rows if not r[1]][:12]:
            c = r[5]
            what = (c.get("alex") or c.get("id"))[:90].replace("\n", " ")
            print(f"      ✗ {str(r[0])[:40]!s:<40} → {str(r[2])[:40]!s:<40} {what!r}  ({(r[4] or '')[:120]})")
    with open(os.path.join(marks_dir, "score.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("what", choices=["cards", "score"])
    ap.add_argument("set", choices=list(DEFS))
    ap.add_argument("--ids")
    ap.add_argument("--out")
    ap.add_argument("--marks")
    ap.add_argument("--extra", help="the sample file whose 'extra' ids were picked by keyword (left out of the random rate)")
    ap.add_argument("--chunks", type=int, default=4)
    ap.add_argument("--dir", default=LABELS_DIR)
    a = ap.parse_args()
    if a.what == "cards":
        cards(a.set, a.ids, os.path.expanduser(a.out), a.chunks, os.path.expanduser(a.dir))
    else:
        score(a.set, os.path.expanduser(a.marks), a.extra)


if __name__ == "__main__":
    main()
