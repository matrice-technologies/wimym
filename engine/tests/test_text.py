"""Work orders about the person: the rule that spots "Alex wants…" fires for whoever uses Wimym, by their own name.

    python3 -m unittest discover -s engine/tests

Fixture strings and a .claude.json written to a temporary folder: nothing of yours is read or written.
"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

TMP = tempfile.mkdtemp(prefix="wimym-tests-")
if "wimym.paths" not in sys.modules:
    os.environ.update(HOME=os.path.join(TMP, "home"), USERPROFILE=os.path.join(TMP, "home"),  # USERPROFILE: Windows' home
                      CLAUDE_CONFIG_DIR=os.path.join(TMP, "home", ".claude"),
                      WIMYM_DATA=os.path.join(TMP, "data"), WIMYM_CACHE=os.path.join(TMP, "cache"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from wimym import text  # noqa: E402

BRIEFS = {
    "Alex": ["Alex wants the engine to stop naming him.", "Context: Alex asked for a fix before Friday.",
             "Alex is away today, so commit on a branch.", "Alex (the founder) owns the repo."],
    "Priya": ["Priya wants the export to keep its columns.", "Note that Priya has already reviewed the first half.",
              "Priya said to leave VISION.md alone."],
}
TYPED = {
    "Alex": ["Alex, can you check this?", "Alex: here is what I think", "fix the export, it drops a column"],
    "Priya": ["Priya, the build is red", "the user is redirected after login, keep that", "fix the export"],
}


class AboutYou(unittest.TestCase):
    def test_briefs_about_you_are_spotted(self):
        for name, briefs in BRIEFS.items():
            rule = text.about_you([name])
            for b in briefs:
                self.assertTrue(rule.search(b), f"{name}: {b}")

    def test_words_to_you_are_not(self):
        for name, typed in TYPED.items():
            rule = text.about_you([name])
            for t in typed:
                self.assertFalse(rule.search(t), f"{name}: {t}")

    def test_someone_else_is_not_you(self):
        self.assertFalse(text.about_you(["Priya"]).search(BRIEFS["Alex"][0]))
        self.assertFalse(text.about_you(["Alex"]).search(BRIEFS["Priya"][0]))

    def test_no_name_no_rule(self):
        self.assertIsNone(text.about_you([]))

    def test_not_typed_uses_your_name(self):
        for name in BRIEFS:
            with mock.patch.object(text, "_you", lambda n=name: text.about_you([n])):
                self.assertTrue(all(text.not_typed(b) for b in BRIEFS[name]), name)
                self.assertFalse(any(text.not_typed(t) for t in TYPED[name]), name)


class FirstNames(unittest.TestCase):
    def test_sources(self):
        self.assertEqual(text.first_names("Alex", "Alexandre Collet", "alexcollet"), ["Alex", "Alexandre"])
        self.assertEqual(text.first_names(None, None, "priya sharma"), ["Priya"])
        self.assertEqual(text.first_names(None, None, "psharma"), [])  # a handle, not a name
        self.assertEqual(text.first_names("Will", "Will Smith", None), [])  # an everyday word

    def test_account_from_claude_json(self):
        path = os.path.join(TMP, "claude.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"oauthAccount": {"displayName": "Priya", "fullName": "Priya Sharma"}, "projects": {}}, f)
        self.assertEqual(text.account(path), ("Priya", "Priya Sharma"))
        self.assertEqual(text.account(os.path.join(TMP, "none.json")), (None, None))
        with open(path, "w", encoding="utf-8") as f:
            f.write("{not json")
        self.assertEqual(text.account(path), (None, None))


if __name__ == "__main__":
    unittest.main()
