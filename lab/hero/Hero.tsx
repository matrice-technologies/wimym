// The front page's hero: one of the lab pieces in a box, driven by data the app already has.
// Data in (the app's messages and days), canvas out. The app sets the words around it; the piece
// supplies its own caption through onCaption if the app wants it.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import stillDark from "./fallback-planet-dark.jpg";
import stillLight from "./fallback-planet-light.jpg";
import { mindFrom, mindFromPoints, type Mind, type PointsPayload, type RawDay, type RawMessage } from "../src/shared/data";
import { DARK, LIGHT } from "../src/shared/palette";
import type { Piece, PieceFactory } from "../src/shared/piece";
import { recordLoop, savePNG } from "../src/shared/capture";
import { globe } from "../src/pieces/globe";
import { nebula } from "../src/pieces/nebula";
import { core } from "../src/pieces/core";
import { organism } from "../src/pieces/organism";
import { loomHero } from "../src/pieces/loom-strum";
import { makePostcard, type PostcardOptions } from "./postcard";

export type HeroPiece = "planet" | "nebula" | "core" | "organism" | "loom";
const PIECES: Record<HeroPiece, PieceFactory> = { planet: globe, nebula, core, organism, loom: loomHero };
// the strummed Loom draws on a 2D canvas, so it needs no WebGL and has no still in its place
const NEEDS_GL: Record<HeroPiece, boolean> = { planet: true, nebula: true, core: true, organism: true, loom: false };

export interface HeroProps {
  /** GET /api/points as is: every message as a small row. The light way in; text is then fetched one message at a time on hover. */
  points?: PointsPayload | null;
  /** Or the app's Message[] from /api/messages (only id, project, day, hour, kind, words, family, text are read). */
  messages?: readonly RawMessage[] | null;
  /** The app's Core.days from /api/core (day, n, start, end, active, rest, projects, switchH, frustrated). Needed with
   * messages; optional with points, which can give the days themselves (without nights' lengths or switches). */
  days?: readonly RawDay[] | null;
  /** Which picture. Default "planet". */
  piece?: HeroPiece;
  /** The app's resolved theme. */
  theme: "light" | "dark";
  /** Shapes only: tooltips give a time and nothing anyone wrote, no project names. Can change at any time. */
  share?: boolean;
  /** "auto" follows prefers-reduced-motion; "still" draws one frame and holds it. Default "auto". */
  motion?: "auto" | "full" | "still";
  /** The planet's entrance (the nebula's stars falling into place): "auto" plays it on the first visit
   * in a browser session, "always" every time it mounts (after a first run), "never" not at all. Default "auto". */
  entrance?: "auto" | "always" | "never";
  /** Small words on the picture (today, March, midnight). Default true. */
  labels?: boolean;
  /** A tooltip on hover. Default true. */
  tooltips?: boolean;
  /** Move the picture sideways by a share of the box's width, to leave room for words (0.18 = right of centre). Default 0. */
  shift?: number;
  /** A click on a light or a slice: the day it belongs to, YYYY-MM-DD. */
  onSelect?: (day: string) => void;
  /** The piece's own one-line caption and sub-line, whenever they change. */
  onCaption?: (caption: { line: string; sub: string }) => void;
  /** An image to show where WebGL isn't available. By default a still of the planet drawn on made-up data. */
  fallbackSrc?: string;
  className?: string;
  /** The box. It fills its parent by default; give it a height. */
  style?: CSSProperties;
}

export interface HeroHandle {
  /** Save the picture as it is now as a PNG; with its caption unless told otherwise. */
  savePNG(withCaption?: boolean): void;
  /** Save six seconds as a webm. */
  recordLoop(seconds?: number): void;
  /** The postcard to post: the planet in share mode, the question and two true lines. Saves a PNG and returns its canvas. */
  savePostcard(opts?: PostcardOptions): Promise<HTMLCanvasElement | null>;
}

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const Hero = forwardRef<HeroHandle, HeroProps>(function Hero(props, ref) {
  const { points, messages, days, piece = "planet", theme, share = false, motion = "auto", labels = true, tooltips = true, shift = 0, entrance = "auto", onSelect, onCaption, fallbackSrc, className, style } = props;
  const [noGL, setNoGL] = useState(() => !webgl2());
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const live = useRef<{ piece: Piece; t: number } | null>(null);
  // props the running loop reads without restarting it
  const latest = useRef({ share, theme, labels, tooltips, shift, onSelect, onCaption });
  latest.current = { share, theme, labels, tooltips, shift, onSelect, onCaption };

  const mind = useMemo(() => shapesOf(points, messages, days, () => latest.current.share), [points, messages, days]);
  const shapes = useMemo(() => shapesOf(points, messages, days, () => true), [points, messages, days]);
  const still = motion === "still" || (motion === "auto" && reduced());
  const blocked = noGL && NEEDS_GL[piece];

  useEffect(() => {
    const el = box.current, holder = stage.current;
    if (!mind || !el || !holder || blocked) return;
    // a fresh canvas for each piece: two renderers never share one WebGL context
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", captionFor(piece));
    Object.assign(canvas.style, { display: "block", width: "100%", height: "100%", touchAction: "none", cursor: piece === "planet" ? "grab" : "default" });
    holder.append(canvas);
    let p: Piece;
    try {
      p = PIECES[piece](canvas, mind, latest.current.theme === "dark" ? DARK : LIGHT, { share: latest.current.share, still, intro: entrance === "auto" ? undefined : entrance === "always" });
    } catch (e) {
      console.warn("Hero: no WebGL, showing a still instead", e);
      canvas.remove();
      setNoGL(true);
      return;
    }
    p.setShift?.(latest.current.shift);
    if (import.meta.env.DEV) (window as unknown as { __hero: Piece }).__hero = p;  // for poking at it from the console
    const state = { piece: p, t: 0 };
    live.current = state;

    const size = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) p.resize(r.width, r.height, Math.min(devicePixelRatio || 1, 2));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    let lastCaption = "";
    const overlay = () => {
      const c = p.caption();
      if (c.line + c.sub !== lastCaption) { lastCaption = c.line + c.sub; latest.current.onCaption?.(c); }
      const box = labelRef.current;
      if (!box) return;
      const ls = latest.current.labels ? p.labels?.() ?? [] : [];
      while (box.children.length < ls.length) box.append(document.createElement("span"));
      [...box.children].forEach((node, i) => {
        const l = ls[i], s = node as HTMLSpanElement;
        if (!l) { s.hidden = true; return; }
        s.hidden = false;
        if (s.textContent !== l.text) s.textContent = l.text;
        s.style.opacity = l.alpha == null ? "" : String(l.alpha);
        const shift = l.align === "right" ? "-100%" : l.align === "left" ? "0" : "-50%";
        s.style.transform = `translate(${l.x}px, ${l.y}px) translate(${shift}, -50%)`;
      });
    };

    // run only while on screen
    let visible = true, raf = 0, last = performance.now(), timer = 0;
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !still && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    });
    io.observe(el);
    const loop = (now: number) => {
      if (!visible) { raf = 0; return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      state.t += dt;
      p.frame(state.t, dt);
      overlay();
      raf = requestAnimationFrame(loop);
    };
    if (still) {
      // one frame, redrawn now and then in case late data (the vital signs) arrives
      const hold = () => { raf = requestAnimationFrame(() => { p.frame(8, 0); overlay(); }); };
      hold();
      timer = window.setInterval(hold, 800);
    } else raf = requestAnimationFrame(loop);

    const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    let lastXY: readonly [number, number] | null = null;
    const showTip = (x: number, y: number) => {
      const tip = tipRef.current;
      if (!tip) return;
      const html = latest.current.tooltips ? p.hover(x, y) : null;
      if (!html) { tip.hidden = true; return; }
      tip.innerHTML = html; tip.hidden = false;
      const b = el.getBoundingClientRect(), r = tip.getBoundingClientRect();
      tip.style.left = Math.min(b.width - r.width - 8, x + 16) + "px";
      tip.style.top = Math.min(b.height - r.height - 8, y + 16) + "px";
    };
    const onMove = (e: PointerEvent) => { const xy = local(e); lastXY = xy; showTip(xy[0], xy[1]); };
    // a message's words arrive after the pointer stopped: show them where it is
    const unlisten = mind.listen?.(() => { if (lastXY) showTip(lastXY[0], lastXY[1]); });
    const onLeave = () => { lastXY = null; if (tipRef.current) tipRef.current.hidden = true; p.hover(-1, -1); };
    let downAt: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      // a click, not the end of a drag
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
      const [x, y] = local(e), day = p.select?.(x, y);
      if (day) latest.current.onSelect?.(day);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    return () => {
      cancelAnimationFrame(raf); clearInterval(timer); ro.disconnect(); io.disconnect(); unlisten?.();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      p.dispose();
      canvas.remove();
      live.current = null;
    };
  }, [mind, piece, still, blocked]);  // entrance is read once, when the piece is made

  useEffect(() => { live.current?.piece.setTheme(theme === "dark" ? DARK : LIGHT); }, [theme]);
  useEffect(() => { live.current?.piece.setShift?.(shift); }, [shift]);
  useEffect(() => { live.current?.piece.setShare(share); if (tipRef.current) tipRef.current.hidden = true; }, [share]);

  useImperativeHandle(ref, () => ({
    savePNG: (withCaption = true) => { const l = live.current; if (l) savePNG(l.piece, theme === "dark" ? DARK : LIGHT, piece, still ? 8 : l.t, withCaption); },
    recordLoop: (seconds = 6) => { const l = live.current; if (l) recordLoop(l.piece, piece, seconds); },
    // its own copy of the shapes, with share mode fixed on
    savePostcard: async (opts = {}) => (shapes ? makePostcard(shapes, { theme, ...opts }) : null),
  }), [theme, piece, still, shapes]);

  const ink = theme === "dark" ? "#e9edf5" : "#121725";
  return (
    <div ref={box} className={className} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      <div ref={stage} style={{ position: "absolute", inset: 0 }} />
      {blocked && <img src={fallbackSrc ?? (theme === "dark" ? stillDark : stillLight)} alt="A planet whose night side is covered in small warm lights" style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", objectPosition: `${50 + shift * 100}% 50%`,
        maskImage: "radial-gradient(closest-side, #000 82%, transparent)", WebkitMaskImage: "radial-gradient(closest-side, #000 82%, transparent)",
      }} />}
      <div ref={labelRef} aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", font: "500 12px/1 var(--text, system-ui)", color: theme === "dark" ? "#7d8698" : "#6b7386" }} className="wimym-hero-labels" />
      <div ref={tipRef} hidden className="wimym-hero-tip" style={{
        position: "absolute", zIndex: 2, maxWidth: 320, padding: "9px 11px", borderRadius: 8, pointerEvents: "none", font: "13px/1.4 var(--text, system-ui)", color: ink,
        background: theme === "dark" ? "rgba(20,25,37,.92)" : "rgba(255,255,255,.94)", border: `1px solid ${theme === "dark" ? "#242c3d" : "#dce0e8"}`,
        boxShadow: "0 8px 30px rgba(0,0,0,.18)", backdropFilter: "blur(6px)",
      }} />
      <style>{`.wimym-hero-labels span{position:absolute;left:0;top:0;white-space:nowrap}.wimym-hero-tip .m{color:${theme === "dark" ? "#7d8698" : "#6b7386"}}.wimym-hero-tip .q{margin-top:5px;color:${theme === "dark" ? "#b4bccb" : "#3d4559"}}`}</style>
    </div>
  );
});

/** The shapes from whichever data the app has: points (with or without days), or messages and days. */
export function shapesOf(points: PointsPayload | null | undefined, messages: readonly RawMessage[] | null | undefined, days: readonly RawDay[] | null | undefined, isShared: () => boolean): Mind | null {
  if (points?.rows?.length) return mindFromPoints(points, days, isShared);
  if (messages?.length && days?.length) return mindFrom(messages, days, isShared);
  return null;
}

function webgl2() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();  // only asking; give the context back
    return !!gl;
  } catch { return false; }
}

function captionFor(piece: HeroPiece) {
  return {
    planet: "Your days as a planet, every message a light",
    nebula: "Every message as a star on a spiral of time",
    core: "Your days stacked into a column",
    organism: "One week as a living form",
    loom: "Your messages as a harp of light, under an aurora of the weight each project carries",
  }[piece];
}

export default Hero;
