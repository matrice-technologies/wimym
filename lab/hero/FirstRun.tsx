// The first run as a show. While the engine reads a new person's transcripts, a star arrives for
// each message it finds, laid out on the same spiral the planet's entrance starts from, and a line
// says in plain words what is happening. When the reading is done the stars hand over to the planet,
// which falls into place with its entrance. A two-second build still gets a short, whole show.
//
// The state it reads is the `state` object of GET /api/state (docs/contract-state.md). The engine's
// own label is shown as is; the line under it is made from the first numbers it has found.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { entranceDistance, spiralPoint } from "../src/pieces/globe";
import { Hero, type HeroProps } from "./Hero";
import type { PointsPayload, RawDay, RawMessage } from "../src/shared/data";

/** GET /api/state → state, as docs/contract-state.md sets it out. */
export interface EngineState {
  /** On a first run: starting, indexing, history, measuring, ready; git comes after ready, while the page is up. */
  phase: "starting" | "indexing" | "history" | "measuring" | "ready" | "git" | "error";
  label?: string;              // plain words to show as is
  done?: number; total?: number;
  first?: boolean;             // true until the first numbers exist
  found?: { conversations?: number; messages?: number; firstDay?: string | null; history?: number; repos?: number; commits?: number };
  updated?: string | null;
  error?: string | null;
}

export interface FirstRunProps extends Omit<HeroProps, "points" | "messages" | "days" | "entrance"> {
  /** The latest engine state, polled by the app (every second while `first` is true). */
  state: EngineState | null;
  /** The data, once the engine has it (/api/points, or messages and days). Null until then. */
  points?: PointsPayload | null;
  messages?: readonly RawMessage[] | null;
  days?: readonly RawDay[] | null;
  /** The shortest show, in seconds, however fast the build. Default 2.6. */
  minSeconds?: number;
  /** Draw the narration line at the foot of the box. Default true; the app can draw its own from onLine. */
  narrate?: boolean;
  onLine?: (line: string, detail: string) => void;
  /** Called once the planet has taken over. */
  onDone?: () => void;
}

const N = 16000;
const fmt = (n?: number) => (n ?? 0).toLocaleString("en");
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtDate = (s: string) => { const d = new Date(s + "T12:00:00"); return `${d.getDate()} ${MON[d.getMonth()]}`; };

/** What to say now: the engine's own label, and a smaller line of what it has found. */
export function narration(s: EngineState | null): { key: string; line: string; detail: string } {
  if (!s) return { key: "wait", line: "Waking up", detail: "" };
  const f = s.found ?? {};
  const found = f.messages ? `${fmt(f.messages)} messages from you${f.firstDay ? `, the first on ${fmtDate(f.firstDay)}` : ""}.` : "";
  // once the data exists the show ends on one line of its own, whatever the engine does next (git)
  if (s.phase === "ready" || (s.first === false && s.phase !== "error")) return { key: "ready", line: "Here is where your mind has been.", detail: found };
  if (s.phase === "git") return { key: "git", line: s.label ?? "Reading your git history", detail: f.commits ? `${fmt(f.commits)} commits in ${fmt(f.repos)} repositories.` : found };
  if (s.phase === "error") return { key: "error", line: s.label ?? "Something went wrong", detail: s.error ?? "" };
  return { key: s.phase, line: s.label ?? "", detail: s.phase === "history" && f.history ? `${found} ${fmt(f.history)} more from your prompt history.`.trim() : found };
}

const VERT = /* glsl */ `
  attribute float aSize; attribute float aSeed;
  uniform float uCount, uTime, uPx, uFade;
  varying float vA;
  void main() {
    float id = float(gl_VertexID);
    float age = clamp((uCount - id) / 260.0, 0.0, 1.0);     // the newest stars are still arriving
    vec3 p = position * (1.0 + 0.22 * (1.0 - age) * (1.0 - age));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = age * uFade * (0.8 + 0.2 * sin(uTime * (0.7 + aSeed * 1.9) + aSeed * 40.0));
    gl_PointSize = id < uCount ? aSize * uPx * (1.5 + 1.6 * (1.0 - age)) * (6.0 / -mv.z) : 0.0;
  }`;
const FRAG = /* glsl */ `
  uniform vec3 uStar;
  varying float vA;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p);
    if (d > 1.0) discard;
    float a = exp(-d * 8.0) + exp(-d * 2.4) * 0.2;
    gl_FragColor = vec4(uStar * a * vA * 2.6, 1.0);
  }`;

/** The stars of the show, in their own small scene. */
class Show {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  u = { uCount: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 }, uFade: { value: 1 }, uStar: { value: new THREE.Color("#c7dbff") } };
  w = 1; h = 1; shift = 0;
  points: THREE.Points;
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0, 0);
    // stars in time order, the first days at the core; hours drawn from a working day's shape
    const pos = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N);
    let s = 11;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      // a working day's shape: mornings to past midnight, thinner over lunch and dinner
      let hour = 8.3 + 16.2 * Math.pow(rnd(), 1.05);
      if (Math.abs(hour - 13) < 0.6 && rnd() < 0.6) hour += 1.2;
      if (Math.abs(hour - 19.4) < 0.8 && rnd() < 0.6) hour += 1.6;
      const t = i / N + rnd() / N;
      spiralPoint(t, hour, (rnd() - 0.5) * 0.04, v);
      pos.set([v.x, v.y, v.z], i * 3);
      size[i] = 1.0 + Math.log2(2 + Math.exp(2.4 + (rnd() - 0.5) * 2.2)) * 0.3;
      seed[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.points);
  }
  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.position.set(0, 0, entranceDistance(this.camera.aspect));
    this.camera.updateProjectionMatrix();
    this.setShift(this.shift, true);
    this.u.uPx.value = dpr * Math.min(1.5, h / 800);
  }
  setShift(x: number, force = false) {
    if (x === this.shift && !force) return;
    this.shift = x;
    if (x) this.camera.setViewOffset(this.w, this.h, -x * this.w, 0, this.w, this.h); else this.camera.clearViewOffset();
  }
  frame(count: number, t: number) { this.u.uCount.value = count; this.u.uTime.value = t; this.renderer.render(this.scene, this.camera); }
  dispose() { this.points.geometry.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); }
}

type Stage = "show" | "handover" | "planet";

export function FirstRun(props: FirstRunProps) {
  const { state, points, messages, days, minSeconds = 2.6, narrate = true, onLine, onDone, shift = 0, style, className, ...hero } = props;
  // a returning person, whose engine is already up to date, goes straight to the planet
  const [stage, setStage] = useState<Stage>(() => (state?.first === false ? "planet" : "show"));
  const [said, setSaid] = useState(() => { const n = narration(state); return { line: n.line, detail: n.detail }; });
  const [returning] = useState(stage === "planet");
  const box = useRef<HTMLDivElement>(null), holder = useRef<HTMLDivElement>(null);
  const hasData = !!(points?.rows?.length || (messages?.length && days?.length));
  const live = useRef({ state, hasData, count: points?.rows?.length ?? messages?.length ?? 0, shift, onLine, onDone, minSeconds });
  live.current = { state, hasData, count: points?.rows?.length ?? messages?.length ?? 0, shift, onLine, onDone, minSeconds };

  useEffect(() => {
    if (stage !== "show") return;
    const el = box.current, hold = holder.current;
    if (!el || !hold) return;
    // a fresh canvas each time: a context given back on cleanup can't be used again
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Your conversations being read");
    Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
    hold.append(canvas);
    const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let show: Show;
    try { show = new Show(canvas); } catch { canvas.remove(); setStage("planet"); return; }
    const size = () => { const r = el.getBoundingClientRect(); if (r.width && r.height) show.resize(r.width, r.height, Math.min(devicePixelRatio || 1, 2)); };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    const t0 = performance.now();
    let shown = 0, last = t0, raf = 0, lastKey = "", lineAt = t0 - 1000, lastSaid = "", readyAt = 0, done = false;
    const loop = (now: number) => {
      const L = live.current, dt = Math.min(0.05, (now - last) / 1000); last = now;
      const s = L.state, f = s?.found ?? {};
      // stars: one for each message found; while only conversations are counted, a share of the way
      let target = f.messages ?? 0;
      if (!target && s?.phase === "indexing" && s.total) target = ((s.done ?? 0) / s.total) * N * 0.6;
      if (L.hasData) target = Math.max(target, L.count);
      target = Math.min(N, target);
      // ease toward it, never so slow that a quick build looks empty
      shown = reduced ? target : Math.min(target, shown + Math.max((target - shown) * (1 - Math.exp(-dt * 2.2)), dt * 900));
      show.setShift(L.shift);
      show.frame(shown, (now - t0) / 1000);

      // the words: a new step holds the floor for at least 0.9 s; the same step updates its numbers in place
      const n = narration(s);
      if (n.key !== lastKey && now - lineAt > 900) { lastKey = n.key; lineAt = now; }
      if (n.key === lastKey && n.line + n.detail !== lastSaid) {
        lastSaid = n.line + n.detail;
        setSaid({ line: n.line, detail: n.detail });
        L.onLine?.(n.line, n.detail);
      }

      // the hand-over: reading done, data here, the show long enough, the last line read, the stars arrived
      const ready = (s?.phase === "ready" || s?.first === false) && L.hasData;
      if (ready && !readyAt && lastKey === "ready") readyAt = now;
      if (!done && readyAt && now - t0 > L.minSeconds * 1000 && now - readyAt > 900 && shown >= target - 1) {
        done = true;
        setStage("handover");
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); show.dispose(); canvas.remove(); };
  }, [stage === "show"]);

  // the show fades as the planet's own stars fade in where these were
  useEffect(() => {
    if (stage !== "handover") return;
    const t = setTimeout(() => { setStage("planet"); live.current.onDone?.(); }, 1100);
    return () => clearTimeout(t);
  }, [stage]);

  const ink = "#b4bccb", muted = "#7d8698";
  const heroData = useMemo(() => (hasData ? { points, messages, days } : null), [hasData, points, messages, days]);
  return (
    <div ref={box} className={className} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      {stage !== "show" && heroData && (
        // read once, when the planet is made: after a show it always makes its entrance
        <Hero {...hero} points={heroData.points} messages={heroData.messages} days={heroData.days} shift={shift}
          entrance={returning ? "auto" : "always"} style={{ position: "absolute", inset: 0 }} />
      )}
      {stage !== "planet" && (
        <div ref={holder} style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          opacity: stage === "handover" ? 0 : 1, transition: "opacity 1s ease-in 0.15s",
        }} />
      )}
      {narrate && stage !== "planet" && (
        <div aria-live="polite" style={{
          position: "absolute", left: 0, right: 0, bottom: "clamp(24px, 7vh, 64px)", textAlign: "center", pointerEvents: "none",
          opacity: stage === "handover" ? 0 : 1, transition: "opacity .6s ease .3s", font: "400 15px/1.5 var(--text, system-ui)",
          fontVariantNumeric: "tabular-nums", transform: `translateX(${shift * 100}%)`,
        }}>
          <div style={{ color: ink, fontSize: 16 }}>{said.line}</div>
          <div style={{ color: muted, minHeight: "1.5em" }}>{said.detail}</div>
        </div>
      )}
    </div>
  );
}

export default FirstRun;
