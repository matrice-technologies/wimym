"""The structural signals on small hand-built transcripts: the 05:00 day, work blocks and active time,
nights, days in a row, switches between sessions, unread approvals and the person's range (bands).

    python3 -m unittest discover -s engine/tests

Everything runs in UTC, on fixtures in a temporary folder: nothing of yours is read or written.
"""
import json
import os
import shutil
import sys
import tempfile
import time
import unittest
import uuid
from datetime import date, datetime

TMP = tempfile.mkdtemp(prefix="wimym-tests-")
os.environ.update(TZ="UTC", CLAUDE_CONFIG_DIR=os.path.join(TMP, "claude"), WIMYM_CACHE=os.path.join(TMP, "cache"),
                  WIMYM_DATA=os.path.join(TMP, "data"))
if hasattr(time, "tzset"):  # not on Windows, whose CI runners keep UTC anyway
    time.tzset()
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from wimym import scan  # noqa: E402
from wimym.model import Model, day_of  # noqa: E402
HOME = "/Users/wimym-tests"  # the fixtures' working folder: never read or written, only named in the transcripts

# Never wimym.paths.PROJECTS: another test module may import wimym first, before this file sets the
# environment, and PROJECTS would then be the real ~/.claude/projects. Fixtures live in TMP, always.
PROJECTS = os.path.join(TMP, "claude", "projects")
from wimym.vitals import Vitals, pctile  # noqa: E402

NO_LABELS = {"categories": {}, "signals": {}, "acts": {}, "sessions": {}, "days": {}, "versions": {}}


def line(o):
    return json.dumps(o, separators=(",", ":")) + "\n"  # compact, as Claude Code writes them (scan.py relies on it)


def transcript(sid, turns, project="proj-a"):
    """A transcript file: turns are (time "YYYY-MM-DD HH:MM:SS" UTC, your text, Claude's reply, seconds Claude took),
    and optionally Claude's output tokens on the reply."""
    d = os.path.join(PROJECTS, "-fixture-" + project)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, sid + ".jsonl")
    cwd = os.path.join(HOME, project)
    with open(path, "w", encoding="utf-8") as f:
        for at, text, reply, took, *out in turns:
            t0 = datetime.fromisoformat(at)
            t1 = datetime.fromtimestamp(t0.timestamp() + took)
            mid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{sid}/{at}/{text}"))  # stable, as Claude Code's own ids are
            f.write(line({"type": "user", "uuid": mid, "sessionId": sid, "cwd": cwd,
                          "timestamp": t0.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "origin": {"kind": "human"},
                          "message": {"role": "user", "content": text}}))
            f.write(line({"type": "assistant", "uuid": str(uuid.uuid4()), "sessionId": sid, "cwd": cwd,
                          "timestamp": t1.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                          "message": {"id": str(uuid.uuid4()), "role": "assistant", "model": "claude-test",
                                      "content": [{"type": "text", "text": reply}],
                                      **({"usage": {"input_tokens": 10, "output_tokens": out[0]}} if out else {})}}))
    return path


def build(*files, today=None):
    m = Model([(p, scan.scan(p)) for p in files], NO_LABELS, {})
    v = Vitals(m, [], [], {}, False, today=today)
    return m, v


def reset():
    """Empty the fixtures folder, and only it: refuses anything outside this run's temporary folder."""
    real = os.path.realpath(PROJECTS)
    if not (real.startswith(os.path.realpath(TMP) + os.sep) and os.path.basename(TMP).startswith("wimym-tests-")):
        raise RuntimeError(f"refusing to delete {PROJECTS}: not inside the tests' temporary folder")
    shutil.rmtree(PROJECTS, ignore_errors=True)


class DayBoundary(unittest.TestCase):
    def test_five_in_the_morning(self):
        self.assertEqual(day_of(datetime(2026, 10, 14, 4, 59)).isoformat(), "2026-10-13")
        self.assertEqual(day_of(datetime(2026, 10, 14, 5, 0)).isoformat(), "2026-10-14")

    def test_message_after_midnight_belongs_to_the_evening(self):
        reset()
        p = transcript("s1", [("2026-10-13 22:00:00", "evening", "ok", 10), ("2026-10-14 01:30:00", "late", "ok", 10)])
        m, _ = build(p, today=date(2026, 10, 14))
        self.assertEqual([x["day"] for x in m.messages], ["2026-10-13", "2026-10-13"])
        self.assertEqual(m.messages[1]["hour"], 25.5)


class Blocks(unittest.TestCase):
    def test_blocks_and_active_time(self):
        reset()
        # 09:00, 09:10 (one block), 09:50 after 40 minutes (a new block), 10:00
        p = transcript("s1", [("2026-10-14 09:00:00", "a", "ok", 5), ("2026-10-14 09:10:00", "b", "ok", 5),
                              ("2026-10-14 09:50:00", "c", "ok", 5), ("2026-10-14 10:00:00", "d", "ok", 5)])
        _, v = build(p, today=date(2026, 10, 14))
        day = v.sig.day["2026-10-14"]
        self.assertEqual(len(day["blocks"]), 2)
        self.assertAlmostEqual(day["active"], 0.5)  # 10 + 5 minutes, twice

    def test_a_gap_of_exactly_twenty_minutes_keeps_the_block(self):
        reset()
        p = transcript("s1", [("2026-10-14 09:00:00", "a", "ok", 5), ("2026-10-14 09:20:00", "b", "ok", 5)])
        _, v = build(p, today=date(2026, 10, 14))
        self.assertEqual(len(v.sig.day["2026-10-14"]["blocks"]), 1)

    def test_stretch_on_one_project(self):
        reset()
        a = transcript("s1", [("2026-10-14 09:00:00", "a", "ok", 5), ("2026-10-14 09:30:00", "b", "ok", 5)], project="proj-a")
        b = transcript("s2", [("2026-10-14 09:40:00", "c", "ok", 5), ("2026-10-14 09:50:00", "d", "ok", 5)], project="proj-b")
        _, v = build(a, b, today=date(2026, 10, 14))
        # 09:00 alone; then 09:30 a, 09:40 b, 09:50 b: the longest run on one project is b's, 10 + 5 minutes
        self.assertAlmostEqual(v.sig.day["2026-10-14"]["stretch"], 0.25)


class Nights(unittest.TestCase):
    def test_night_from_last_to_first(self):
        reset()
        p = transcript("s1", [("2026-10-13 22:00:00", "a", "ok", 5), ("2026-10-14 07:00:00", "b", "ok", 5)])
        _, v = build(p, today=date(2026, 10, 14))
        self.assertAlmostEqual(v.sig.night("2026-10-14"), 9.0)

    def test_no_night_after_a_day_off(self):
        reset()
        p = transcript("s1", [("2026-10-12 22:00:00", "a", "ok", 5), ("2026-10-14 07:00:00", "b", "ok", 5)])
        _, v = build(p, today=date(2026, 10, 14))
        self.assertIsNone(v.sig.night("2026-10-14"))


class Streak(unittest.TestCase):
    def test_days_in_a_row(self):
        reset()
        days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-16"]
        p = transcript("s1", [(d + " 10:00:00", "a", "ok", 5) for d in days])
        _, v = build(p, today=date(2026, 10, 16))
        daily, weekly, _, _ = v.m_streak()
        self.assertEqual([daily[d] for d in v.days], [1, 2, 3, 0, 1])
        self.assertEqual(weekly, [3])

    def test_today_is_no_day_off_until_it_ends(self):
        reset()
        p = transcript("s1", [("2026-10-13 10:00:00", "a", "ok", 5), ("2026-10-14 10:00:00", "b", "ok", 5)])
        _, v = build(p, today=date(2026, 10, 15))   # nothing yet on the 15th
        self.assertEqual(v.m_streak()[0]["2026-10-15"], 2)
        self.assertIsNone(v.m_daysoff()[0]["2026-10-15"])

    def test_sentence_once_the_run_is_long(self):
        reset()
        p = transcript("s1", [(f"2026-10-{d:02d} 10:00:00", "a", "ok", 5) for d in range(1, 17)])
        _, v = build(p, today=date(2026, 10, 16))
        daily = v.m_streak()[0]
        self.assertIn("16 days in a row", v.streak_sentence(daily))


class Switches(unittest.TestCase):
    def test_changes_of_session_inside_a_block(self):
        reset()
        a = transcript("sa", [("2026-10-14 09:00:00", "a", "ok", 5), ("2026-10-14 09:10:00", "c", "ok", 5)])
        b = transcript("sb", [("2026-10-14 09:05:00", "b", "ok", 5), ("2026-10-14 11:00:00", "d", "ok", 5)])
        _, v = build(a, b, today=date(2026, 10, 14))
        # a → b → a inside one block: two switches; 11:00 starts a new block, so no switch there
        self.assertEqual(v.sig.day["2026-10-14"]["switches"], 2)


class Unread(unittest.TestCase):
    def test_go_ahead_faster_than_reading(self):
        reset()
        long_reply = " ".join(["word"] * 250)  # a minute to read at 250 words a minute
        p = transcript("s1", [("2026-10-14 09:00:00", "plan it", long_reply, 30),   # Claude ends at 09:00:30
                              ("2026-10-14 09:00:40", "yes", long_reply, 30),       # 10 s later: unread
                              ("2026-10-14 09:03:10", "ok", "done", 5)])            # 2 minutes later: read
        _, v = build(p, today=date(2026, 10, 14))
        rows = {m["text"]: unread for m, unread, _ in v.unread_rows()}
        self.assertEqual(rows, {"yes": True, "ok": False})

    def test_a_request_is_not_an_approval(self):
        reset()
        p = transcript("s1", [("2026-10-14 09:00:00", "plan it", "x " * 300, 30),
                              ("2026-10-14 09:00:35", "now build the whole page with tests", "ok", 5)])
        _, v = build(p, today=date(2026, 10, 14))
        self.assertEqual(v.unread_rows(), [])


class Bands(unittest.TestCase):
    def test_percentiles(self):
        self.assertEqual(pctile([1, 2, 3, 4], .25), 1.75)
        self.assertEqual(pctile([1, 2, 3, 4], .5), 2.5)
        self.assertEqual(pctile([5], .75), 5)

    def test_band_needs_four_weeks_and_uses_eight(self):
        v = Vitals.__new__(Vitals)
        weekly = [None, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        b = v.bands(weekly)
        self.assertEqual(b[:5], [None] * 5)               # under four weeks with a value before
        self.assertEqual(b[5], {"lo": 1.75, "mid": 2.5, "hi": 3.25})
        self.assertEqual(b[11], {"lo": 4.75, "mid": 6.5, "hi": 8.25})   # the 8 weeks before: 3 to 10

    def test_flag_needs_two_weeks_outside(self):
        v = Vitals.__new__(Vitals)
        b = {"lo": 5, "mid": 6, "hi": 7}
        self.assertEqual(v.side(8, b), "above")
        self.assertEqual(v.side(6, b), None)
        self.assertEqual(v.side(None, b), None)


class Hook(unittest.TestCase):
    def test_streak_and_stop_hour(self):
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "hooks"))
        import limits
        pulse = {"today": "2026-10-16", "run": {"2026-10-15": 20}, "active": {"2026-10-16": 2.5}}
        now = datetime(2026, 10, 16, 23, 10)
        self.assertEqual(limits.streak(pulse, date(2026, 10, 16)), 21)
        said = limits.notes(now, {"stopHour": 22.5}, pulse)
        self.assertEqual(said, ["It's 23:10, past the 22:30 you set.", "21 days in a row."])
        # a stop after midnight: 23:50 is before it, 01:00 past it (both belong to the same day)
        self.assertEqual(limits.notes(datetime(2026, 10, 16, 23, 50), {"stopHour": 0.5}, {}), [])
        self.assertEqual(limits.notes(datetime(2026, 10, 17, 1, 0), {"stopHour": 0.5}, {}), ["It's 01:00, past the 00:30 you set."])
        self.assertEqual(limits.status(now, pulse), "2h30 today · 21 days in a row")


class Points(unittest.TestCase):
    def test_each_point_carries_the_output_tokens_of_its_turn(self):
        reset()
        p = transcript("s1", [("2026-10-14 09:00:00", "a", "ok", 5, 1200), ("2026-10-14 09:10:00", "b", "ok", 5, 300)])
        _, v = build(p, today=date(2026, 10, 14))
        pts, _ = v.points()
        self.assertEqual(pts["fields"][-1], "outAll")
        self.assertEqual([r[-1] for r in pts["rows"]], [1200, 300])


class IndexKeepsTurns(unittest.TestCase):
    def test_a_transcript_written_again_shorter_keeps_its_old_turns(self):
        from wimym import index
        reset()
        p = transcript("s1", [("2026-10-14 09:00:00", "first", "ok", 5), ("2026-10-14 09:10:00", "second", "ok", 5)])
        ix = index.Index.__new__(index.Index)
        ix.files = {}
        ix._keep(p, os.stat(p), scan.scan(p))
        transcript("s1", [("2026-10-14 11:00:00", "after the wipe", "ok", 5)])   # deleted and written again, shorter
        ix._keep(p, os.stat(p), scan.scan(p))
        self.assertEqual([t["text"] for t in ix.files[p]["r"]["turns"]], ["first", "second", "after the wipe"])
        # and when the file grows again afterwards, the old turns still stay
        transcript("s1", [("2026-10-14 11:00:00", "after the wipe", "ok", 5), ("2026-10-14 11:05:00", "and more", "ok", 5),
                          ("2026-10-14 11:06:00", "a long one " * 200, "ok " * 200, 5)])
        ix._keep(p, os.stat(p), scan.scan(p))
        self.assertEqual([t["text"][:10] for t in ix.files[p]["r"]["turns"]], ["first", "second", "after the ", "and more", "a long one"])


class Tokens(unittest.TestCase):
    def test_a_turns_tokens(self):
        reset()
        d = os.path.join(PROJECTS, "-fixture-proj-a")
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "s1.jsonl")
        base = {"sessionId": "s1", "cwd": os.path.join(HOME, "proj-a")}

        def call(mid, at, usage, side=False):
            return line({**base, "type": "assistant", "uuid": str(uuid.uuid4()), "timestamp": at, "isSidechain": side,
                         "message": {"id": mid, "role": "assistant", "model": "claude-test", "usage": usage,
                                     "content": [{"type": "text", "text": "ok"}]}})
        a = {"input_tokens": 3, "cache_creation_input_tokens": 1000, "cache_read_input_tokens": 5000, "output_tokens": 200}
        b = {"input_tokens": 2, "cache_creation_input_tokens": 300, "cache_read_input_tokens": 6000, "output_tokens": 50}
        with open(p, "w", encoding="utf-8") as f:
            f.write(line({**base, "type": "user", "uuid": str(uuid.uuid4()), "timestamp": "2026-10-14T09:00:00.000Z",
                          "origin": {"kind": "human"}, "message": {"role": "user", "content": "go"}}))
            f.write(call("A", "2026-10-14T09:00:05.000Z", a))
            f.write(call("A", "2026-10-14T09:00:06.000Z", a))  # one call written over two lines counts once
            f.write(call("S", "2026-10-14T09:00:07.000Z", {"input_tokens": 9999, "output_tokens": 9999}, side=True))
            f.write(call("B", "2026-10-14T09:00:10.000Z", b))
        m, _ = build(p, today=date(2026, 10, 14))
        x = m.messages[0]
        self.assertEqual((x["out"], x["inpFresh"], x["inpWrite"], x["inpRead"], x["inp"]), (250, 5, 1300, 11000, 12305))
        self.assertEqual(x["ctx"], 2 + 300 + 6000 + 50)  # the last call's context, not the turn's sum

    def test_codex_tokens(self):
        from wimym import codex
        p = os.path.join(TMP, "codex", "rollout-t1.jsonl")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        at = "2026-10-14T09:00:00.000Z"
        ms = int(datetime(2026, 10, 14, 9).timestamp() * 1000)

        def tokens(i, cached, out, **more):
            return {"timestamp": at, "type": "event_msg", "payload": {"type": "token_count", "info": {"last_token_usage":
                    {"input_tokens": i, "cached_input_tokens": cached, "output_tokens": out, **more}}}}
        with open(p, "w", encoding="utf-8") as f:
            for o in ({"timestamp": at, "type": "session_meta", "payload": {"source": "vscode", "cwd": os.path.join(HOME, "proj-a")}},
                      {"timestamp": at, "type": "turn_context", "payload": {"model": "gpt-test"}},
                      {"timestamp": at, "type": "event_msg", "payload": {"type": "item_completed", "started_at_ms": ms,
                       "item": {"type": "UserMessage", "id": "u1", "content": [{"type": "text", "text": "go"}]}}},
                      tokens(1000, 800, 100), tokens(1500, 1200, 40, cache_write_input_tokens=100)):
                f.write(line(o))
        t = codex.scan(p)["turns"][0]
        self.assertEqual((t["out"], t["inpFresh"], t["inpWrite"], t["inpRead"], t["ctx"]), (140, 400, 100, 2000, 1540))


class Leverage(unittest.TestCase):
    """Output a message set off beyond its own turn: subagents, sessions it started, the turns that followed."""

    def write(self, path, lines):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(line(o) for o in lines)
        return path

    def user(self, sid, at, text, pid, human=True, **more):
        o = {"type": "user", "uuid": str(uuid.uuid4()), "sessionId": sid, "cwd": os.path.join(HOME, "proj-a"),
             "timestamp": at, "promptId": pid, "message": {"role": "user", "content": text}, **more}
        return {**o, "origin": {"kind": "human"}} if human else {**o, "promptSource": "sdk", "turnOrigin": "sdk"}

    def call(self, sid, at, out, side=False, tool=None):
        content = [{"type": "text", "text": "ok"}] + ([{"type": "tool_use", "id": "t1", **tool}] if tool else [])
        return {"type": "assistant", "uuid": str(uuid.uuid4()), "sessionId": sid, "timestamp": at, "isSidechain": side,
                "message": {"id": str(uuid.uuid4()), "role": "assistant", "model": "claude-test",
                            "usage": {"output_tokens": out}, "content": content}}

    def test_subagents_and_started_sessions(self):
        reset()
        d = os.path.join(PROJECTS, "-fixture-proj-a")
        brief = "Work out how token counts can feed the hero and the postcard, then build the version picked."
        start = {"name": "mcp__ccd_session__start_session", "input": {"prompt": brief, "background": "x"}}
        parent = self.write(os.path.join(d, "p1.jsonl"), [
            self.user("p1", "2026-10-14T09:00:00.000Z", "go", "P1"),
            self.call("p1", "2026-10-14T09:00:05.000Z", 100, tool={"name": "Agent", "input": {}}),
            self.call("p1", "2026-10-14T09:00:06.000Z", 7, side=True),  # inline, as older Claude Code wrote them
            self.call("p1", "2026-10-14T09:00:20.000Z", 50, tool=start),
            self.user("p1", "2026-10-14T09:30:00.000Z", "<side-sessions-event>done</side-sessions-event>", "P2", human=False),
            self.call("p1", "2026-10-14T09:30:05.000Z", 30),
            self.user("p1", "2026-10-14T10:00:00.000Z", "next", "P3"),
            self.call("p1", "2026-10-14T10:00:05.000Z", 10)])
        by_pid = self.write(os.path.join(d, "p1", "subagents", "agent-a.jsonl"), [
            {**self.user("p1", "2026-10-14T09:00:05.000Z", "dig", "P1", isSidechain=True)},
            self.call("p1", "2026-10-14T09:00:09.000Z", 400, side=True)])
        by_time = self.write(os.path.join(d, "p1", "subagents", "agent-b.jsonl"), [
            {**self.user("p1", "2026-10-14T10:00:02.000Z", "dig", None, isSidechain=True)},
            self.call("p1", "2026-10-14T10:00:04.000Z", 60, side=True)])
        child = self.write(os.path.join(d, "c1.jsonl"), [
            self.user("c1", "2026-10-14T09:00:21.000Z",
                      "Background (from the session that started this one):\nx\n\n" + brief, "C1", human=False),
            self.call("c1", "2026-10-14T09:20:00.000Z", 2000),
            self.user("c1", "2026-10-14T09:40:00.000Z", "<cross-session-message>and this</cross-session-message>", "C2", human=False),
            self.call("c1", "2026-10-14T09:45:00.000Z", 300)])
        m, _ = build(parent, by_pid, by_time, child, today=date(2026, 10, 14))
        go, nxt = m.messages
        self.assertEqual((go["out"], go["outSub"]), (150, 407))
        # the started session's turns, and the turn its report started in this session
        self.assertEqual(go["outAuto"], 2000 + 300 + 30)
        self.assertEqual(go["outAll"], 150 + 407 + 2330)
        self.assertEqual((nxt["outSub"], nxt["outAuto"], nxt["outAll"]), (60, 0, 70))


class KeptFiles(unittest.TestCase):
    def test_a_file_that_wont_parse_is_kept_not_overwritten(self):
        from wimym import paths
        p = os.path.join(TMP, "kept", "checkins.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write('{"days": {"2026-10-01": ')
        self.assertEqual(paths.read_json(p, {"x": 1}), {"x": 1})
        bad = [n for n in os.listdir(os.path.dirname(p)) if n.startswith("checkins.json.bad-")]
        self.assertEqual(len(bad), 1)
        self.assertFalse(os.path.exists(p))
        paths.write_json(p, {"days": {}})
        self.assertEqual(paths.read_json(p, None), {"days": {}})


class Checked(unittest.TestCase):
    def test_a_mark_counts_for_its_version_only(self):
        from wimym import labels
        here = os.path.join(TMP, "labels")  # never the real labels folder, whatever imported wimym first
        os.makedirs(here, exist_ok=True)
        with open(os.path.join(here, "acts.json"), "w") as f:
            json.dump({"version": 2, "labels": {}, "checked": ["st"]}, f)
        with open(os.path.join(here, "categories.json"), "w") as f:
            json.dump({"version": 2, "labels": {}}, f)
        with open(os.path.join(here, "definitions.json"), "w") as f:   # nothing marked, whatever the real one says
            json.dump({"sets": {"categories": {"version": 3}, "acts": {"version": 2}}}, f)
        saved, labels.LABELS_DIR = labels.LABELS_DIR, here
        self.addCleanup(setattr, labels, "LABELS_DIR", saved)
        saved_defs, labels.DEFINITIONS = labels.DEFINITIONS, os.path.join(here, "definitions.json")
        self.addCleanup(setattr, labels, "DEFINITIONS", saved_defs)
        self.assertTrue(labels.checked("acts", "st"))
        self.assertTrue(labels.checked("acts", "st", 2))
        self.assertFalse(labels.checked("acts", "st", 3))
        self.assertFalse(labels.checked("acts", "ppl"))
        self.assertTrue(labels.checked("categories", "in", 2))     # the audited versions
        self.assertTrue(labels.checked("categories", "in", 3))
        self.assertFalse(labels.checked("categories", "in", 4))
        self.assertTrue(labels.checked("categories", "to", "4-jev"))  # Jev's own judge, not Haiku's
        self.assertFalse(labels.checked("categories", "sp", "4-jev"))
        self.assertTrue(labels.checked("acts", "off", "4-jev"))
        self.assertFalse(labels.checked("acts", "dec", "4-jev"))
        self.assertTrue(labels.checked("sessions", "goal", 5))
        self.assertFalse(labels.checked("sessions", "goal", 6))


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
