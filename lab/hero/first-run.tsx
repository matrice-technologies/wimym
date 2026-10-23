// The first run as a new person would see it, driven by a mock engine state.
// ?seconds=2 for a quick build, ?seconds=34 for Alex's from nothing (default 14); ?real polls the engine's
// /api/state instead (a new person's engine shows the reading; an up-to-date one goes straight to
// the planet); ?demo for synthetic data.
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource-variable/instrument-sans/index.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FirstRun, syntheticData, type EngineState, type PointsPayload, type RawDay, type RawMessage } from "./index";
import { mockEngineState } from "./mockState";

const q = new URLSearchParams(location.search);
const seconds = Number(q.get("seconds") || 14);

function Demo() {
  const [state, setState] = useState<EngineState | null>(null);
  const [data, setData] = useState<{ points?: PointsPayload; messages?: RawMessage[]; days?: RawDay[] } | null>(null);
  const [run, setRun] = useState(0);

  // the data loads in the background, as the app's would once the engine is ready
  useEffect(() => {
    if (q.has("demo")) { setData(syntheticData()); return; }
    // the front page's way in: the points alone, no /api/messages
    fetch("/api/points").then(r => r.json()).then(p => (p.rows ? setData({ points: p }) : Promise.reject())).catch(() => setData(syntheticData()));
  }, []);
  useEffect(() => {
    const t0 = performance.now();
    const n = data?.points?.rows.length ?? data?.messages?.filter(m => m.kind === "prompt").length ?? 15000;
    const tick = q.has("real")
      ? () => fetch("/api/state").then(r => r.json()).then(j => setState(j.state)).catch(() => {})
      : () => setState(mockEngineState((performance.now() - t0) / 1000, seconds, { transcripts: 4600, conversations: 1599, messages: n, firstDay: data?.points?.day0 ?? data?.days?.[0]?.day ?? "2026-03-23", history: 7529, repos: 10, commits: 8757 }));
    tick();
    const id = setInterval(tick, q.has("real") ? 500 : 100);
    return () => clearInterval(id);
  }, [run, data !== null]);

  const ready = state?.first === false;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#080b14", color: "#e9edf5", ["--text" as string]: '"Instrument Sans Variable", system-ui', fontFamily: "var(--text)" }}>
      {state && <FirstRun key={run} state={state} points={ready ? data?.points : null} messages={ready ? data?.messages : null} days={ready ? data?.days : null} shift={innerWidth > 900 ? 0.17 : 0} />}
      <header style={{ position: "absolute", top: "clamp(24px, 6vh, 64px)", left: "clamp(16px, 5vw, 72px)", pointerEvents: "none" }}>
        <h1 style={{ margin: 0, font: "650 clamp(40px, 6.2vw, 88px)/0.98 'Bricolage Grotesque Variable', system-ui", letterSpacing: "-0.035em", maxWidth: "6ch" }}>Where is your mind?</h1>
      </header>
      <button onClick={() => setRun(r => r + 1)} style={{ position: "absolute", left: "clamp(16px, 5vw, 72px)", bottom: 28, border: "1px solid #313b50", background: "none", color: "inherit", borderRadius: 999, padding: "4px 12px", font: "500 12.5px var(--text)", cursor: "pointer" }}>Replay</button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Demo /></StrictMode>);
