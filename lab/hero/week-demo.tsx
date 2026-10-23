// The week page's header as the app would use it. ←/→ or the buttons walk the weeks; ?week=2026-10-12
// opens one; ?theme=light|dark; ?still for reduced motion.
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource-variable/instrument-sans/index.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WeekForm, type WeekPayload } from "./index";

const q = new URLSearchParams(location.search);
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const title = (w: string) => { const d = new Date(w + "T12:00:00"); return `The week of ${d.getDate()} ${MON[d.getMonth()]}`; };

function Demo() {
  const [weeks, setWeeks] = useState<string[]>([]);
  const [at, setAt] = useState(-1);
  const [week, setWeek] = useState<WeekPayload | null>(null);
  const [cap, setCap] = useState({ line: "", sub: "" });
  const theme = (q.get("theme") as "light" | "dark") || "dark";
  const dark = theme === "dark";

  useEffect(() => {
    // ?calm: a week inside every range, made up, for the fallback still
    if (q.has("calm")) { setWeek({ week: "2026-01-05", vitals: [] }); return; }
    fetch("/api/vitals").then(r => r.json()).then(v => {
      const ws: string[] = (v.data ?? v).weeks;
      setWeeks(ws);
      const want = q.get("week");
      setAt(want && ws.includes(want) ? ws.indexOf(want) : ws.length - 2);
    });
  }, []);
  useEffect(() => {
    if (at < 0) return;
    fetch(`/api/week?start=${weeks[at]}`).then(r => r.json()).then(w => setWeek(w.data ?? w));
  }, [at]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") setAt(a => Math.max(0, a - 1)); if (e.key === "ArrowRight") setAt(a => Math.min(weeks.length - 1, a + 1)); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [weeks.length]);

  const C = dark ? { ground: "#080b14", ink: "#e9edf5", ink2: "#b4bccb", muted: "#7d8698", line: "#313b50" } : { ground: "#eef0f4", ink: "#121725", ink2: "#3d4559", muted: "#6b7386", line: "#c9cfdb" };
  const btn = { border: `1px solid ${C.line}`, background: "none", color: C.ink2, borderRadius: 999, padding: "4px 12px", font: "500 12.5px var(--text)", cursor: "pointer" };
  return (
    <div style={{ minHeight: "100vh", background: C.ground, color: C.ink, ["--text" as string]: '"Instrument Sans Variable", system-ui', fontFamily: "var(--text)" }}>
      <div style={{ position: "relative", height: "min(62vh, 560px)" }}>
        <WeekForm week={week} theme={theme} shift={innerWidth > 900 ? 0.2 : 0} motion={q.has("still") ? "still" : "auto"} onCaption={setCap} />
        <header style={{ position: "absolute", left: "clamp(16px, 5vw, 72px)", top: "clamp(24px, 6vh, 56px)", maxWidth: "min(34ch, 90vw)" }}>
          <h1 style={{ margin: 0, font: "650 clamp(32px, 4.4vw, 56px)/1.02 'Bricolage Grotesque Variable', system-ui", letterSpacing: "-0.03em" }}>{week ? title(week.week) : " "}</h1>
          <p style={{ margin: "16px 0 0", color: C.ink2, fontSize: 18, lineHeight: 1.45, textWrap: "pretty" }}>{cap.line}</p>
          <p style={{ margin: "8px 0 0", color: C.muted, fontSize: 14.5, lineHeight: 1.5, textWrap: "pretty" }}>{cap.sub}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 20 }}>
            <button style={btn} onClick={() => setAt(a => Math.max(0, a - 1))}>Week before</button>
            <button style={btn} onClick={() => setAt(a => Math.min(weeks.length - 1, a + 1))}>Week after</button>
          </div>
        </header>
      </div>
      <p style={{ margin: 0, padding: "24px clamp(16px, 5vw, 72px)", color: C.muted, maxWidth: "70ch" }}>{week?.summary}</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Demo /></StrictMode>);
