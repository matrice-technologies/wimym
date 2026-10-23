"""Tests for the CLI and database layer: wimym sql stays read-only, the person's files are never wiped,
ids stay unique.

    S=<a scratch folder>; HOME=$S/decoy CLAUDE_CONFIG_DIR=$S/decoy/.claude WIMYM_DATA=$S/decoy/data \
      WIMYM_CACHE=$S/decoy/cache python3 -m unittest discover -s engine/tests

Run tests only with a decoy home (docs/sprint.md). Before importing wimym this module points HOME,
CLAUDE_CONFIG_DIR, WIMYM_DATA, WIMYM_CACHE and WIMYM_LABELS into its own temporary folder, then asserts
that every folder wimym uses is inside a tests' temporary folder. When another test module has already
imported wimym into its own temporary folder (test_signals, which loads first), those folders are used
and checked the same way. It deletes nothing outside these folders.
"""
import glob
import json
import os
import sqlite3
import sys
import tempfile
import unittest

TMP = tempfile.mkdtemp(prefix="wimym-tests-")
if "wimym.paths" not in sys.modules:
    os.environ.update(HOME=os.path.join(TMP, "home"), CLAUDE_CONFIG_DIR=os.path.join(TMP, "home", ".claude"),
                      WIMYM_DATA=os.path.join(TMP, "data"), WIMYM_CACHE=os.path.join(TMP, "cache"),
                      WIMYM_LABELS=os.path.join(TMP, "data", "labels"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from wimym import cli, db, paths, practices  # noqa: E402


def _in_tests_tmp(p):
    """Inside a temporary folder made by these tests (wimym-tests-…) under the system's temp dir."""
    real = os.path.realpath(p)
    root = os.path.realpath(tempfile.gettempdir())
    parts = os.path.relpath(real, root).split(os.sep)
    return real.startswith(root + os.sep) and parts[0].startswith("wimym-tests-")


for _p in (paths.PROJECTS, paths.CLAUDE, paths.DATA_DIR, paths.CACHE_DIR, paths.LABELS_DIR, paths.INDEX):
    assert _in_tests_tmp(_p), f"refusing to test: {_p} is not inside a tests' temporary folder"


def tiny_db():
    path = os.path.join(TMP, "tiny.db")
    if not os.path.exists(path):
        c = sqlite3.connect(path)
        c.execute("create table messages (id TEXT, text TEXT)")
        c.executemany("insert into messages values (?, ?)", [("h-1775049619825-8f0d78a8", "a"), ("h-1775049700000-11111111", "b"),
                                                             ("3e5bf6dd-6977-4b60-b4e2-f69c5d8a508f", "c")])
        c.execute("create table turns (id TEXT)")
        c.commit()
        c.close()
    return path


def run(c, sql):
    out = []
    for st in cli.statements(sql):
        out.append(db.query(c, st).fetchall())
    return out


class ReadOnly(unittest.TestCase):
    def setUp(self):
        self.c = db.connect(tiny_db())
        self.target = os.path.join(TMP, "written.db")

    def tearDown(self):
        self.c.close()

    def refused(self, sql):
        with self.assertRaises(sqlite3.DatabaseError, msg=sql):
            run(self.c, sql)
        self.assertFalse(os.path.exists(self.target), f"{sql} created a file")

    def test_reads_work(self):
        self.assertEqual(run(self.c, "select count(*) from messages")[0][0][0], 3)
        self.assertEqual(run(self.c, "/* note */ with a as (select 1) select * from a")[0][0][0], 1)
        self.assertTrue(run(self.c, "pragma table_info(messages)")[0])

    def test_attach_is_refused(self):
        self.refused(f"attach '{self.target}' as w")
        self.refused(f"pragma query_only=0; attach '{self.target}' as w; create table w.x(a)")
        self.refused(f"select 1; attach database '{self.target}' as w")

    def test_vacuum_into_is_refused(self):
        self.refused(f"vacuum into '{self.target}'")

    def test_writes_and_pragmas_are_refused(self):
        for sql in ("delete from messages", "insert into messages values ('x', 'y')", "drop table messages",
                    "with a as (select 1) insert into messages select 'x', 'y' from a", "pragma query_only = 0",
                    "pragma writable_schema = 1", "pragma trusted_schema", "begin", "select load_extension('x')",
                    "explain delete from messages"):
            self.refused(sql)
        self.assertEqual(run(self.c, "select count(*) from messages")[0][0][0], 3)


class PersonsFiles(unittest.TestCase):
    def setUp(self):
        # only the person's three files and their set-aside copies, only inside the tests' folder
        assert _in_tests_tmp(paths.DATA_DIR)
        os.makedirs(paths.DATA_DIR, exist_ok=True)
        for n in ("practices.json", "limits.json", "log.jsonl"):
            for p in glob.glob(practices.path(n)) + glob.glob(practices.path(n) + ".bad-*"):
                os.remove(p)

    def test_unreadable_practices_are_set_aside_not_wiped(self):
        p = practices.path("practices.json")
        broken = '{"practices": [{"id": "a", "text": "Stop at 21:00", "status": "trying", "start": "2026-10-01"},]}'
        open(p, "w").write(broken)
        self.assertEqual(practices.practices(), [])  # reading shows nothing, and says so
        self.assertEqual(open(p).read(), broken)  # but leaves the file alone
        with self.assertRaises(practices.BadFile):
            practices.add("Another practice")
        bad = glob.glob(p + ".bad-*")
        self.assertEqual(len(bad), 1)
        self.assertEqual(open(bad[0]).read(), broken)
        self.assertFalse(os.path.exists(p))
        practices.add("Another practice")  # now absent: starts empty, the old one kept aside
        self.assertEqual([x["text"] for x in practices.practices()], ["Another practice"])

    def test_unreadable_limits_are_set_aside_not_wiped(self):
        p = practices.path("limits.json")
        open(p, "w").write('{"stopHour": 21, "priorities": ["eloom"],}')
        with self.assertRaises(practices.BadFile):
            practices.set_limit("daysOffPerWeek", 1)
        self.assertEqual(len(glob.glob(p + ".bad-*")), 1)

    def test_lock_is_reentrant_for_store(self):
        with practices._lock:  # store.py writes priorities under this lock and may call set_limit inside it
            practices.set_limit("stopHour", 21)
        self.assertEqual(practices.limits()["stopHour"], 21)


class ShortIds(unittest.TestCase):
    def test_prefix_is_unique(self):
        cli._CONN, cli._IDS = db.connect(tiny_db()), None
        a, b = "h-1775049619825-8f0d78a8", "h-1775049700000-11111111"
        sa, sb = cli.short(a), cli.short(b)
        self.assertTrue(a.startswith(sa) and b.startswith(sb))
        self.assertNotEqual(sa, sb)
        self.assertFalse(b.startswith(sa) or a.startswith(sb))
        self.assertEqual(cli.short("3e5bf6dd-6977-4b60-b4e2-f69c5d8a508f"), "3e5bf6dd")


if __name__ == "__main__":
    unittest.main()
