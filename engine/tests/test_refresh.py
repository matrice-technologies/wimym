"""labeller/refresh.py, the whole label chain on what's new: today and a week still going wait, a set at an older
version is left untouched, a dry run writes nothing, and a second run finds nothing to send.

    python3 -m unittest discover -s engine/tests

Fixtures, the index and the label files are all in a temporary folder, and no call reaches Claude: the labeller's
`ask` is replaced by one that answers every item with the first allowed value. Nothing of yours is read or written.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import uuid
from datetime import datetime
from unittest import mock

TMP = tempfile.mkdtemp(prefix="wimym-tests-")
if "wimym.paths" not in sys.modules:
    os.environ.update(HOME=os.path.join(TMP, "home"), USERPROFILE=os.path.join(TMP, "home"),  # USERPROFILE: Windows' home
                      CLAUDE_CONFIG_DIR=os.path.join(TMP, "home", ".claude"),
                      WIMYM_DATA=os.path.join(TMP, "data"), WIMYM_CACHE=os.path.join(TMP, "cache"),
                      WIMYM_LABELS=os.path.join(TMP, "data", "labels"))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "engine"))
sys.path.insert(0, os.path.join(ROOT, "labeller"))

from wimym import index, paths  # noqa: E402

import accounts as A  # noqa: E402
import label as L  # noqa: E402
import refresh as R  # noqa: E402

# this module's own transcripts and index, whatever folders another test module set first
PROJECTS = os.path.join(TMP, "projects")
LABELS = os.path.join(TMP, "labels")
for _p in (paths.CLAUDE, paths.DATA_DIR, paths.CACHE_DIR, paths.LABELS_DIR, PROJECTS, LABELS):
    _real, _root = os.path.realpath(_p), os.path.realpath(tempfile.gettempdir())
    assert _real.startswith(_root + os.sep) and os.path.relpath(_real, _root).split(os.sep)[0].startswith("wimym-tests-"), \
        f"refusing to test: {_p} is not inside a tests' temporary folder"

TODAY = "2026-10-20"  # a Tuesday: the week of 12 Oct has ended, the week of 19 Oct is going


def transcript(sid, turns):
    """turns: (time "YYYY-MM-DD HH:MM:SS" UTC, your text). Noon UTC is the same day as Wimym counts it from UTC-7 to UTC+12."""
    d = os.path.join(PROJECTS, "-fixture-proj")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, sid + ".jsonl"), "w", encoding="utf-8") as f:
        for at, text in turns:
            t0 = datetime.fromisoformat(at)
            for o in ({"type": "user", "uuid": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{sid}/{at}")), "origin": {"kind": "human"},
                       "timestamp": t0.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "message": {"role": "user", "content": text}},
                      {"type": "assistant", "uuid": str(uuid.uuid4()), "timestamp": t0.strftime("%Y-%m-%dT%H:%M:30.000Z"),
                       "message": {"id": str(uuid.uuid4()), "role": "assistant", "model": "claude-test",
                                   "content": [{"type": "text", "text": "Done."}]}}):
                f.write(json.dumps({**o, "sessionId": sid, "cwd": "/Users/wimym-tests/proj"}, separators=(",", ":")) + "\n")


def answer(name):
    """A valid answer for one item of a set: the first allowed value of every field, and a standing rule from acts."""
    a = {}
    for f in L.DEFS[name]["fields"]:
        t = f["type"]
        a[f["key"]] = False if t == "bool" else "" if t == "text" else [] if t in ("list", "refs") else f["values"][0]["key"]
    if name == "acts":
        a["rule"] = "run the tests before saying it's done"
    return a


SETS = {L.system_prompt(n): n for n in L.DEFS}
CALLS = []


def fake_ask(prompt, system, model, timeout, think):
    name = SETS[system]
    CALLS.append(name)
    if name == "rules":
        arr = []
    elif name in ("days", "weeks"):
        arr = answer(name)
    else:
        n = prompt.count("### Message ") if name in L.MESSAGE_SETS else prompt.count("## Session ")
        arr = [{"i": i + 1, **answer(name)} for i in range(n)]
    return {"result": json.dumps(arr), "usage": {"input_tokens": 100, "output_tokens": 10}, "total_cost_usd": 0.01}


def run(*argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        R.main([*argv, "--dir", LABELS])
    return out.getvalue()


class Refresh(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        transcript("s-mon", [("2026-10-13 12:00:00", "Fix the login page"), ("2026-10-13 12:10:00", "Now the tests")])
        transcript("s-wk2", [("2026-10-19 12:00:00", "Start the export")])
        transcript("s-now", [("2026-10-20 12:00:00", "Still at it"), ("2026-10-20 12:05:00", "And this")])
        claude = os.path.join(TMP, "claude-bin")
        open(claude, "w").close()
        cls.patches = [mock.patch.object(index, "PROJECTS", PROJECTS), mock.patch.object(index, "COWORK", os.path.join(TMP, "none")),
                       mock.patch.object(index, "INDEX", os.path.join(TMP, "index.json")),
                       mock.patch.object(L, "ask", fake_ask), mock.patch.object(A, "ask", fake_ask),
                       mock.patch.object(L, "CLAUDE_BIN", claude), mock.patch.object(R, "today", lambda: TODAY)]
        for p in cls.patches:
            p.start()
        index.Index().refresh()

    @classmethod
    def tearDownClass(cls):
        for p in cls.patches:
            p.stop()

    def files(self):
        return {f: os.path.getmtime(os.path.join(LABELS, f)) for f in os.listdir(LABELS)} if os.path.isdir(LABELS) else {}

    def labels(self, name):
        with open(os.path.join(LABELS, L.DEFS[name]["file"]), encoding="utf-8") as f:
            return json.load(f)

    def test_1_dry_run_counts_whats_settled_and_writes_nothing(self):
        before = self.files()
        out = run("--dry-run")
        self.assertEqual(self.files(), before)
        self.assertEqual(CALLS, [])
        self.assertRegex(out, r"categories\s+v\d+\s+3 messages new")
        self.assertRegex(out, r"sessions\s+v\d+\s+2 sessions new")
        self.assertRegex(out, r"days\s+v\d+\s+2 days new")
        self.assertRegex(out, r"weeks\s+v\d+\s+1 week new")  # 12 Oct's, from the day about to be written
        self.assertIn("Left for a later run: 2 messages, 1 session, 1 day from today or still going, and the week in progress.", out)

    def test_2_without_a_terminal_it_stops_at_the_plan(self):
        before = self.files()
        with mock.patch.object(sys.stdin, "isatty", lambda: False):
            out = run()
        self.assertIn("Nothing sent. Run it again with --yes", out)
        self.assertEqual((self.files(), CALLS), (before, []))

    def test_3_yes_runs_the_chain_in_order_and_leaves_today(self):
        run("--yes")
        order = list(dict.fromkeys(CALLS))
        self.assertEqual(order, ["categories", "signals", "acts", "sessions", "days", "weeks", "rules"])
        self.assertEqual(len(self.labels("categories")["labels"]), 3)
        self.assertEqual(sorted(self.labels("days")["labels"]), ["2026-10-13", "2026-10-19"])
        self.assertEqual(sorted(self.labels("weeks")["labels"]), ["2026-W42"])
        self.assertEqual(self.labels("sessions")["runs"][-1]["mode"], "refresh")
        self.assertTrue(self.labels("rules").get("h"))

    def test_4_a_second_run_has_nothing_to_send(self):
        CALLS.clear()
        out = run("--yes")
        self.assertIn("Nothing to send.", out)
        self.assertRegex(out, r"rules\s+up to date")
        self.assertEqual(CALLS, [])

    def test_5_a_set_at_an_older_version_is_left_as_it_is(self):
        path = os.path.join(LABELS, L.DEFS["signals"]["file"])
        old = L.DEFS["signals"]["version"] - 1
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"version": old, "labels": {"x": {"h": "0", "v": old}}, "calls": [], "runs": []}, f)
        with open(path, "rb") as f:
            was = f.read()
        transcript("s-tue", [("2026-10-14 12:00:00", "One more")])
        index.Index().refresh()
        CALLS.clear()
        out = run("--yes")
        with open(path, "rb") as f:
            self.assertEqual(f.read(), was)
        self.assertNotIn("signals", CALLS)
        self.assertIn("categories", CALLS)
        self.assertRegex(out, rf"signals\s+v{old}\s+left as it is")
        self.assertIn("Left as it is: signals.", out)


    def test_6_with_a_typesafe_key_the_message_sets_go_to_jev(self):
        def jev_ask(body, timeout):
            CALLS.append("jev")
            return {"answers": {k: {"choice": next(iter(q["criteria"])), "probabilities": {}} if q["type"] == "choice"
                                else {"noul": 0.1} for k, q in body["questions"].items()},
                    "usage": {"input_tokens": 100}, "model": "jev-test"}
        key = os.path.join(TMP, "typesafe.key")
        open(key, "w").close()
        folder = os.path.join(TMP, "labels-jev")
        CALLS.clear()
        out = io.StringIO()
        with mock.patch.object(L, "KEY_FILE", key), mock.patch.object(L, "jev_ask", jev_ask), contextlib.redirect_stdout(out):
            R.main(["--yes", "--dir", folder])
        self.assertRegex(out.getvalue(), r"categories\s+v\d+-jev\s+4 messages new\s+about \$[\d.]+\s+Jev")
        self.assertIn("Jev's are billed to your TypeSafe key", out.getvalue())
        with open(os.path.join(folder, L.DEFS["categories"]["file"]), encoding="utf-8") as f:
            self.assertTrue(json.load(f)["version"].endswith("-jev"))
        self.assertNotIn("categories", CALLS)  # none of the message sets went to claude
        self.assertIn("jev", CALLS)
        self.assertIn("sessions", CALLS)


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
