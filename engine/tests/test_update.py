"""The check for a newer Wimym: a commit on the branch this folder follows that it doesn't have is news, and
pulling it ends the news. Off when turned off, and for a folder that follows nothing.

    python3 -m unittest discover -s engine/tests

Everything happens in git repositories made in a temporary folder: nothing of yours is read or written, and
nothing goes over the network.
"""
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

TMP = tempfile.mkdtemp(prefix="wimym-tests-")
if "wimym.paths" not in sys.modules:
    os.environ.update(HOME=os.path.join(TMP, "home"), USERPROFILE=os.path.join(TMP, "home"),  # USERPROFILE: Windows' home
                      CLAUDE_CONFIG_DIR=os.path.join(TMP, "home", ".claude"),
                      WIMYM_DATA=os.path.join(TMP, "data"), WIMYM_CACHE=os.path.join(TMP, "cache"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from wimym import update  # noqa: E402

GIT_ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@example.com", "GIT_CONFIG_NOSYSTEM": "1"}


def git(cwd, *args):
    subprocess.run(["git", "-C", cwd, *args], check=True, capture_output=True, env=dict(os.environ, **GIT_ENV))


def commit(cwd, name):
    with open(os.path.join(cwd, name), "w") as f:
        f.write(name)
    git(cwd, "add", name)
    git(cwd, "commit", "-qm", name)


class Update(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="wimym-update-", dir=TMP)
        self.origin, self.mine, self.theirs = (os.path.join(self.root, n) for n in ("origin.git", "mine", "theirs"))
        git(self.root, "init", "-q", "--bare", "-b", "main", self.origin)
        git(self.root, "clone", "-q", self.origin, self.theirs)
        git(self.theirs, "checkout", "-q", "-b", "main")
        commit(self.theirs, "one")
        git(self.theirs, "push", "-q", "origin", "main")
        git(self.root, "clone", "-q", self.origin, self.mine)
        for patch in (mock.patch.object(update, "ROOT", self.mine), mock.patch.object(update, "KEPT", os.path.join(self.root, "update.json")),
                      mock.patch.object(update, "_up", []), mock.patch.object(update, "_now", {"available": False, "checked": None}),
                      mock.patch.dict(os.environ, {"WIMYM_UPDATES": "1"})):
            patch.start()
            self.addCleanup(patch.stop)

    def ask(self):
        os.remove(update.KEPT) if os.path.exists(update.KEPT) else None  # the folder made in setUp, nothing else
        update.check()
        return update.status()["available"]

    def test_up_to_date_is_no_news(self):
        self.assertFalse(self.ask())
        self.assertIsNotNone(update.status()["checked"])

    def test_a_newer_commit_is_news_until_pulled(self):
        commit(self.theirs, "two")
        git(self.theirs, "push", "-q", "origin", "main")
        self.assertTrue(self.ask())
        git(self.mine, "pull", "-q", "--ff-only")
        self.assertFalse(self.ask())

    def test_asks_once_a_day(self):
        update.check()
        commit(self.theirs, "two")
        git(self.theirs, "push", "-q", "origin", "main")
        update.check()  # within the day: the last answer stands
        self.assertFalse(update.status()["available"])

    def test_off_switch(self):
        commit(self.theirs, "two")
        git(self.theirs, "push", "-q", "origin", "main")
        with mock.patch.dict(os.environ, {"WIMYM_UPDATES": "0"}):
            self.assertFalse(self.ask())
            self.assertFalse(os.path.exists(update.KEPT))  # never asked
        with mock.patch.dict(os.environ, {"WIMYM_UPDATES": ""}), \
                mock.patch.object(update.paths, "read_json", side_effect=lambda p, d: {"updates": False} if p.endswith("settings.json") else d):
            self.assertFalse(update.on())

    def test_a_folder_that_follows_nothing_never_asks(self):
        git(self.mine, "branch", "-q", "--unset-upstream")
        self.assertFalse(self.ask())
        self.assertFalse(os.path.exists(update.KEPT))

    def test_code_newer_than_the_engine_asks_for_a_restart(self):
        with mock.patch.object(update, "STARTED", time.time() + 3600):
            self.assertFalse(update.code_changed())
        with mock.patch.object(update, "STARTED", 0):
            self.assertFalse(update.code_changed())  # no engine/ in this folder
        os.makedirs(os.path.join(self.mine, "engine"))
        open(os.path.join(self.mine, "engine", "server.py"), "w").close()
        with mock.patch.object(update, "STARTED", 0):
            self.assertTrue(update.code_changed())


if __name__ == "__main__":
    unittest.main()
