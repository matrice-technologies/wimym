// A stand-in for GET /api/state during a first run, in the shape of docs/contract-state.md, so the
// show can be watched at any speed without wiping an index.
import type { EngineState } from "./FirstRun";

const fmt = (n: number) => n.toLocaleString("en");

/**
 * The engine's state `elapsed` seconds into a first run that reaches a ready page after `seconds`,
 * with the totals it would end on. Git follows the ready page, as it does in the engine.
 */
export function mockEngineState(elapsed: number, seconds: number, totals = { transcripts: 4600, conversations: 1599, messages: 15000, firstDay: "2026-03-23", history: 7529, repos: 10, commits: 8757 }): EngineState {
  const p = elapsed / Math.max(0.1, seconds);
  const T = totals;
  if (p >= 1) {
    const g = Math.min(1, (p - 1) / 0.6);
    const found = { conversations: T.conversations, messages: T.messages, firstDay: T.firstDay, history: T.history, repos: T.repos, commits: Math.round(T.commits * g) };
    return g < 1
      ? { phase: "git", label: `Reading your git history… ${Math.ceil(g * T.repos)} of ${T.repos} repositories`, done: Math.ceil(g * T.repos), total: T.repos, first: false, found }
      : { phase: "ready", label: "Up to date", done: 0, total: 0, first: false, found };
  }
  const steps: [EngineState["phase"], number][] = [["starting", 0.04], ["indexing", 0.72], ["history", 0.8], ["measuring", 1]];
  const i = steps.findIndex(([, end]) => p < end), phase = steps[i][0];
  const k = (p - (i ? steps[i - 1][1] : 0)) / (steps[i][1] - (i ? steps[i - 1][1] : 0));
  const read = phase === "indexing" ? k : phase === "starting" ? 0 : 1;
  const found = {
    conversations: Math.round(T.conversations * read),
    // transcripts' prompts while indexing; history.jsonl's are counted apart, under history
    messages: Math.round((T.messages - T.history) * read),
    firstDay: read > 0.12 ? T.firstDay : null,
    history: phase === "history" ? Math.round(T.history * k) : phase === "measuring" ? T.history : 0,
  };
  const done = Math.round(T.transcripts * k);
  const label = { starting: "Waking up", indexing: `Reading ${fmt(T.transcripts)} transcripts… ${fmt(done)} so far`, history: "Reading your prompt history", measuring: "Measuring your weeks" }[phase as "starting"];
  return { phase, label, first: true, found, done: phase === "indexing" ? done : 0, total: phase === "indexing" ? T.transcripts : 0 };
}
