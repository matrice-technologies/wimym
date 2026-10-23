import * as d3 from "d3";
import { useData } from "../lib/data";
import { fmtDate, fmtN } from "../lib/format";

/** A spiral of `turns` turns, from radius r0 to r1, as an SVG path. */
export function spiralPath(cx: number, cy: number, r0: number, r1: number, turns: number, from = -Math.PI / 2) {
  const n = Math.ceil(turns * 64);
  return "M" + d3.range(n + 1).map(i => {
    const p = i / n, a = from + p * turns * Math.PI * 2, r = r0 + (r1 - r0) * p;
    return `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
  }).join("L");
}

/** The mark: a week's spiral with the present as a dot at its end. */
export function Mark({ size = 26 }: { size?: number }) {
  const end = -Math.PI / 2 + 2.6 * Math.PI * 2;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mark">
      <path d={spiralPath(16, 16, 2.5, 12.5, 2.6)} fill="none" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx={16 + Math.cos(end) * 12.5} cy={16 + Math.sin(end) * 12.5} r="2.9" />
    </svg>
  );
}

/** First impression while the engine reads the transcripts: the spiral drawing itself, and what it has found. */
export default function Loading({ label = "Putting your week together" }: { label?: string }) {
  const { state } = useData();
  const f = state?.found;
  const reading = !state ? "Waking the engine" : state.first || state.phase === "indexing" ? state.label || "Reading your transcripts" : label;
  const found = state?.first && f && (f.conversations || f.messages)
    ? [f.conversations ? `${fmtN(f.conversations)} conversations` : null, f.messages ? `${fmtN(f.messages)} of your messages` : null,
       f.firstDay ? `since ${fmtDate(f.firstDay)}` : null].filter(Boolean).join(", ")
    : state?.phase === "indexing" && state.total ? `${fmtN(state.done)} of ${fmtN(state.total)}` : null;
  return (
    <div className="loading-w" role="status" aria-live="polite">
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
        <path d={spiralPath(66, 66, 8, 58, 5)} className="ld-track" />
        <path d={spiralPath(66, 66, 8, 58, 5)} className="ld-draw" pathLength={1} />
      </svg>
      <p className="ld-what">{reading}</p>
      <p className="ld-n num">{found || "\u00a0"}</p>
      {state?.phase === "error" && state.error && <p className="partial">{state.error}</p>}
    </div>
  );
}
