"""Windows, on any machine: Claude Code there writes folders as C:\\Users\\robin\\loom and names their transcripts
folders C--Users-robin-loom. The engine reads them as it reads a Mac's: the same project names, worktrees,
scratchpads and memory notes. Also the file lock and the process check, which differ there.

    python3 -m unittest discover -s engine/tests

Fixture strings, and transcripts and a lock in a temporary folder: nothing of yours is read or written, and the
home folders named here are only patched in, never opened.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

TMP = tempfile.mkdtemp(prefix="wimym-tests-")
if "wimym.paths" not in sys.modules:
    os.environ.update(HOME=os.path.join(TMP, "home"), USERPROFILE=os.path.join(TMP, "home"),
                      CLAUDE_CONFIG_DIR=os.path.join(TMP, "home", ".claude"),
                      WIMYM_DATA=os.path.join(TMP, "data"), WIMYM_CACHE=os.path.join(TMP, "cache"))
ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ENGINE)

from wimym import memory, paths, practices, scan, text, update  # noqa: E402

ROBIN = "C:\\Users\\robin"


def windows_home(home=ROBIN):
    """Patch Robin's Windows home into every module that compares with it."""
    return mock.patch.multiple(text, HOME=home), mock.patch.multiple(paths, HOME=home), \
        mock.patch.multiple(memory, HOME_SLUG=memory.folder_name(home))


class Paths(unittest.TestCase):
    def test_slashed(self):
        self.assertEqual(paths.slashed("C:\\Users\\robin\\loom"), "C:/Users/robin/loom")
        self.assertEqual(paths.slashed("c:\\Users\\robin"), "C:/Users/robin")
        self.assertEqual(paths.slashed("D:/work/app"), "D:/work/app")
        self.assertEqual(paths.slashed("/Users/robin/loom"), "/Users/robin/loom")  # a Mac's path: as it is
        self.assertIsNone(paths.slashed(None))

    def test_under(self):
        self.assertEqual(paths.under("C:\\Users\\robin\\loom\\src", ROBIN), "loom/src")
        self.assertEqual(paths.under("c:\\users\\Robin\\Loom", ROBIN), "Loom")  # Windows: any case, the path's own kept
        self.assertEqual(paths.under(ROBIN, ROBIN), "")
        self.assertIsNone(paths.under("C:\\Users\\robinson\\loom", ROBIN))
        self.assertEqual(paths.under("/Users/robin/loom", "/Users/robin"), "loom")
        self.assertIsNone(paths.under("/Users/Robin/loom", "/Users/robin"))  # a Mac's paths: compared as they are

    def test_tilde(self):
        with mock.patch.object(paths, "HOME", ROBIN):
            self.assertEqual(paths.tilde("C:\\Users\\robin\\loom\\a.py"), "~/loom/a.py")
            self.assertEqual(paths.tilde(ROBIN), "~")
            self.assertEqual(paths.tilde("D:\\work"), "D:\\work")
        with mock.patch.object(paths, "HOME", "/Users/robin"):
            self.assertEqual(paths.tilde("/Users/robin/loom"), "~/loom")
            self.assertEqual(paths.tilde("/Users/robinson"), "/Users/robinson")

    def test_scratch(self):
        self.assertTrue(paths.scratch("C:\\Users\\robin\\AppData\\Local\\Temp\\claude\\abc"))
        self.assertTrue(paths.scratch("C:\\Windows\\Temp\\x"))
        self.assertTrue(paths.scratch("/private/tmp/x"))
        self.assertFalse(paths.scratch("C:\\Users\\robin\\loom"))
        self.assertFalse(paths.scratch("/Users/robin/loom"))

    def test_folder_name(self):
        # as Claude Code names the folder of a working folder's transcripts
        self.assertEqual(memory.folder_name("C:\\Users\\robin\\code\\app"), "C--Users-robin-code-app")
        self.assertEqual(memory.folder_name("/Users/robin/mirror/.claude/worktrees/x"), "-Users-robin-mirror--claude-worktrees-x")


class Projects(unittest.TestCase):
    def test_project_names(self):
        a, b, c = windows_home()
        with a, b, c:
            self.assertEqual(text.project_of("C:\\Users\\robin\\loom"), "loom")
            self.assertEqual(text.project_of("C:\\Users\\robin\\loom\\src"), "loom")
            self.assertEqual(text.project_of("c:\\users\\robin\\loom"), "loom")
            self.assertEqual(text.project_of("C:\\Users\\robin\\loom\\.claude\\worktrees\\brave-x"), "loom")
            self.assertEqual(text.project_of(ROBIN), "~")
            self.assertEqual(text.project_of("C:\\Users\\robin\\AppData\\Local\\Temp\\claude\\s1"), "scratchpads")
            self.assertEqual(text.project_of("D:\\work\\app"), "D:/work/app")  # outside the home: the whole folder

    def test_mac_names_unchanged(self):
        with mock.patch.object(text, "HOME", "/Users/robin"):
            self.assertEqual(text.project_of("/Users/robin/loom/.claude/worktrees/x"), "loom")
            self.assertEqual(text.project_of("/Users/robin"), "~")
            self.assertEqual(text.project_of("/private/tmp/x"), "scratchpads")
            self.assertEqual(text.project_of("/opt/app"), "/opt/app")

    def test_memory_folders(self):
        a, b, c = windows_home()
        with a, b, c:
            self.assertEqual(memory.project_label("C--Users-robin-loom"), "loom")
            self.assertEqual(memory.project_label("C--Users-robin-loom--claude-worktrees-brave-x"), "loom")
            self.assertEqual(memory.project_label("c--users-robin-loom"), "loom")
            self.assertEqual(memory.project_label("C--Users-robin"), "~")
            self.assertEqual(memory.project_label("C--Users-robin-AppData-Local-Temp-claude-s1"), "scratchpads")

    def test_typing_in_a_scratchpad_is_no_ones(self):
        o = {"origin": {"kind": "human"}}
        self.assertEqual(text.source_of(o, "hi", "C:\\Users\\robin\\loom"), "desk")
        self.assertEqual(text.source_of(o, "hi", "C:\\Users\\robin\\AppData\\Local\\Temp\\claude\\x"), "auto")


class Transcript(unittest.TestCase):
    """A transcript as Claude Code writes it on Windows, scanned."""

    def test_scan(self):
        cwd = "C:\\Users\\robin\\loom\\.claude\\worktrees\\brave-x"
        note = "C:\\Users\\robin\\.claude\\projects\\C--Users-robin-loom\\memory\\tests.md"
        folder = os.path.join(TMP, "projects", "C--Users-robin-loom--claude-worktrees-brave-x")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "s1.jsonl")
        lines = [
            {"type": "user", "uuid": "u1", "sessionId": "s1", "cwd": cwd, "timestamp": "2026-10-14T09:00:00.000Z",
             "origin": {"kind": "human"}, "message": {"role": "user", "content": "add the tests"}},
            {"type": "assistant", "uuid": "a1", "sessionId": "s1", "cwd": cwd, "timestamp": "2026-10-14T09:00:30.000Z",
             "message": {"id": "m1", "role": "assistant", "model": "claude-test", "content": [
                 {"type": "tool_use", "id": "t1", "name": "Edit", "input": {"file_path": cwd + "\\src\\app.py"}},
                 {"type": "tool_use", "id": "t2", "name": "Write", "input": {"file_path": note}}]}},
        ]
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(json.dumps(o, separators=(",", ":")) + "\n" for o in lines)
        r = scan.scan(path)
        self.assertFalse(r["sub"])
        self.assertEqual(r["cwd"], "C:/Users/robin/loom/.claude/worktrees/brave-x")
        t = r["turns"][0]
        self.assertEqual(t["src"], "desk")
        self.assertIn("C:/Users/robin/loom/.claude/worktrees/brave-x/src/app.py", t["files"])
        self.assertEqual([p for p, _ in r["docs"]["writes"]], [paths.slashed(os.path.normpath(note))])
        self.assertIn("/memory/", r["docs"]["writes"][0][0])
        a, b, c = windows_home()
        with a, b, c:
            self.assertEqual(text.project_of(t["cwd"]), "loom")
            self.assertEqual(paths.tilde(t["files"][-1]), "~/loom/.claude/worktrees/brave-x/src/app.py")


class Processes(unittest.TestCase):
    def test_alive(self):
        self.assertTrue(paths.alive(os.getpid()))
        p = subprocess.Popen([sys.executable, "-c", "pass"])
        p.wait()
        self.assertFalse(paths.alive(p.pid))

    def test_alive_never_ends_a_process(self):
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            self.assertTrue(paths.alive(p.pid))
            time.sleep(.3)
            self.assertIsNone(p.poll(), "asking whether it runs ended it")
        finally:
            p.kill()
            p.wait()


class Lock(unittest.TestCase):
    def test_one_writer_across_processes(self):
        """While this process holds the lock, another waits for it."""
        child = ("import sys, time; sys.path.insert(0, sys.argv[1]); from wimym import practices\n"
                 "with practices._lock: print(time.time())")
        env = dict(os.environ, WIMYM_DATA=practices.DATA_DIR, WIMYM_CACHE=os.path.join(TMP, "cache"))
        with practices._lock:
            p = subprocess.Popen([sys.executable, "-c", child, ENGINE], stdout=subprocess.PIPE, text=True, env=env)
            time.sleep(1.5)
            released = time.time()
        got = float(p.communicate(timeout=30)[0])
        self.assertGreaterEqual(got, released - .05)


class Commands(unittest.TestCase):
    def test_update_command(self):
        self.assertEqual(update.command("--update", root="C:\\Users\\robin\\wimym", windows=True),
                         os.path.join("C:\\Users\\robin\\wimym", "install.cmd") + " --update")
        self.assertTrue(update.command(root="C:\\Users\\robin\\my code\\wimym", windows=True).startswith('& "'))
        home = os.path.expanduser("~")
        self.assertEqual(update.command("--update", root=os.path.join(home, "wimym"), windows=False),
                         "cd ~" + os.sep + "wimym && ./install.sh --update")

    def test_installer_options(self):
        sys.path.insert(0, os.path.join(ENGINE, ".."))
        import install
        o = install.options(["--port=8991", "--demo", "--no-open", "--link"])
        self.assertEqual((o["port"], o["port_given"], o["demo"], o["open"], o["link"]), ("8991", True, True, False, "yes"))
        with self.assertRaises(SystemExit), mock.patch("sys.stderr"):
            install.options(["--nope"])


if __name__ == "__main__":
    unittest.main()
