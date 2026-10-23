// The hero as the app would use it: a mock of the front page's first screen.
// ?demo for synthetic data, ?share for shapes only, ?piece=nebula|core|organism.
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource-variable/instrument-sans/index.css";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Hero, syntheticData, type HeroHandle, type HeroPiece, type PointsPayload, type RawDay, type RawMessage } from "./index";

const q = new URLSearchParams(location.search);

function Demo() {
  const [data, setData] = useState<{ points?: PointsPayload; messages?: RawMessage[]; days?: RawDay[] } | null>(null);
  const [share, setShare] = useState(q.has("share") || q.has("demo"));
  const [piece, setPiece] = useState<HeroPiece>((q.get("piece") as HeroPiece) || "planet");
  const [caption, setCaption] = useState({ line: "", sub: "" });
  const [picked, setPicked] = useState<string | null>(null);
  const hero = useRef<HeroHandle>(null);
  (window as unknown as { __heroRef: typeof hero }).__heroRef = hero;  // for scripted checks
  const [wide, setWide] = useState(innerWidth > 900);
  useEffect(() => { const f = () => setWide(innerWidth > 900); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);

  useEffect(() => {
    if (q.has("demo")) { setData(syntheticData()); return; }
    // as the front page does: /api/points and core's days, never the 19 MB of /api/messages
    Promise.all([fetch("/api/points").then(r => r.json()), fetch("/api/core").then(r => r.json())])
      .then(([p, c]) => (p.rows ? setData({ points: p, days: c.days }) : Promise.reject()))
      .catch(() => setData(syntheticData()));
  }, []);

  const C = { ground: "#080b14", ink: "#e9edf5", ink2: "#b4bccb", muted: "#7d8698", line: "#242c3d" };
  const btn = (on: boolean) => ({ border: `1px solid ${on ? C.ink2 : C.line}`, background: "none", color: on ? C.ink : C.muted, borderRadius: 999, padding: "4px 11px", font: "500 12.5px var(--text)", cursor: "pointer" });

  return (
    <div style={{ position: "fixed", inset: 0, background: C.ground, color: C.ink, ["--text" as string]: '"Instrument Sans Variable", system-ui', fontFamily: "var(--text)" }}>
      {data && <Hero ref={hero} points={data.points} messages={data.messages} days={data.days} piece={piece} share={share} shift={wide ? 0.17 : 0} motion={q.has("still") ? "still" : "auto"} onCaption={setCaption} onSelect={setPicked} />}
      <header style={{ position: "absolute", top: "clamp(24px, 6vh, 64px)", left: "clamp(16px, 5vw, 72px)", maxWidth: "min(30ch, 80vw)", pointerEvents: "none" }}>
        <h1 style={{ margin: 0, font: "650 clamp(40px, 6.2vw, 88px)/0.98 'Bricolage Grotesque Variable', system-ui", letterSpacing: "-0.035em" }}>Where is your mind?</h1>
        <p style={{ margin: "18px 0 0", color: C.ink2, font: "400 clamp(16px, 1.4vw, 19px)/1.45 var(--text)", maxWidth: "36ch", textWrap: "pretty" }}>{caption.line}</p>
        <p style={{ margin: "8px 0 0", color: C.muted, fontSize: 14.5, maxWidth: "40ch", textWrap: "pretty" }}>{caption.sub}</p>
      </header>
      <nav style={{ position: "absolute", left: "clamp(16px, 5vw, 72px)", bottom: 28, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["planet", "nebula", "core", "organism"] as HeroPiece[]).map(p => <button key={p} style={btn(p === piece)} onClick={() => setPiece(p)}>{p[0].toUpperCase() + p.slice(1)}</button>)}
        <span style={{ width: 12 }} />
        <button style={btn(share)} onClick={() => setShare(s => !s)}>Shapes only</button>
        <button style={btn(false)} onClick={() => hero.current?.savePNG()}>Save a still</button>
        <button style={btn(false)} onClick={() => hero.current?.savePostcard({ format: "landscape" })}>Postcard</button>
        <button style={btn(false)} onClick={() => hero.current?.savePostcard({ format: "portrait" })}>Postcard, tall</button>
      </nav>
      {picked && <div style={{ position: "absolute", right: 24, bottom: 28, color: C.muted, fontSize: 13 }}>The app would open {picked}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Demo /></StrictMode>);
