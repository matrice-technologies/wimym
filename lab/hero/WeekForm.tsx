// The week page's header: one living form for the chosen week, moved by its vital signs against
// the person's own range. Calm and round when every sign is inside its usual range; lobes drifting
// apart with switching and sessions at once; a frayed skin with short nights or strain; a slow,
// heavy pulse when the run of days in a row is longer than usual; a thin core when the longest
// stretch on one project was short. Changing the week morphs the form, so the difference is felt
// before it is read.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import { Form } from "../src/pieces/form";
import { DARK, LIGHT } from "../src/shared/palette";
import { weekCaption, weekShape, type WeekPayload } from "./weekShape";
import stillDark from "./fallback-week-dark.jpg";
import stillLight from "./fallback-week-light.jpg";

export interface WeekFormProps {
  /** GET /api/week?start=… as is (docs/contract-week.md). Its vitals carry the bands the form is read against. */
  week: WeekPayload | null;
  /** GET /api/vitals, accepted for the page's convenience; the week's own vitals and bands are what is read. */
  vitals?: unknown;
  theme: "light" | "dark";
  /** Nothing personal is ever drawn (only the form and counts); accepted so pages pass it everywhere alike. */
  share?: boolean;
  /** "auto" follows prefers-reduced-motion; "still" draws one frame and holds it. Default "auto". */
  motion?: "auto" | "full" | "still";
  /** Move the form sideways by a share of the width, to leave room for words. Default 0. */
  shift?: number;
  /** Draw the one-line caption under the form. Default false: the page sets its own words from onCaption. */
  caption?: boolean;
  /** Which signs shape the form, strongest first: { line, sub }, whenever the week changes. */
  onCaption?: (c: { line: string; sub: string }) => void;
  /** An image where WebGL isn't available. By default a still of a calm form. */
  fallbackSrc?: string;
  className?: string;
  style?: CSSProperties;
}

export interface WeekFormHandle { savePNG(): void }

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
function webgl2() {
  try { const gl = document.createElement("canvas").getContext("webgl2"); gl?.getExtension("WEBGL_lose_context")?.loseContext(); return !!gl; } catch { return false; }
}

export const WeekForm = forwardRef<WeekFormHandle, WeekFormProps>(function WeekForm(props, ref) {
  const { week, theme, motion = "auto", shift = 0, caption = false, onCaption, fallbackSrc, className, style } = props;
  const box = useRef<HTMLDivElement>(null), holder = useRef<HTMLDivElement>(null);
  const live = useRef<{ form: Form; t: number } | null>(null);
  const [noGL, setNoGL] = useState(() => !webgl2());
  const still = motion === "still" || (motion === "auto" && reduced());
  const shape = useMemo(() => weekShape(week), [week]);
  const words = useMemo(() => weekCaption(week), [week]);
  const latest = useRef({ shape, theme, shift });
  latest.current = { shape, theme, shift };

  useEffect(() => {
    const el = box.current, hold = holder.current;
    if (!el || !hold || noGL) return;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "The week as a living form");
    Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
    hold.append(canvas);
    let form: Form;
    try { form = new Form(canvas, latest.current.theme === "dark" ? DARK : LIGHT, still); } catch { canvas.remove(); setNoGL(true); return; }
    form.setShape(latest.current.shape, true);
    form.setShift(latest.current.shift);
    const state = { form, t: 0 };
    live.current = state;
    const size = () => { const r = el.getBoundingClientRect(); if (r.width && r.height) form.resize(r.width, r.height, Math.min(devicePixelRatio || 1, 2)); };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    let visible = true, raf = 0, timer = 0, last = performance.now();
    const loop = (now: number) => {
      if (!visible) { raf = 0; return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      state.t += dt;
      form.frame(state.t, dt);
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !still && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    });
    io.observe(el);
    if (still) {
      const holdFrame = () => { raf = requestAnimationFrame(() => form.frame(6, 0)); };
      holdFrame();
      timer = window.setInterval(holdFrame, 800);
    } else raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); clearInterval(timer); ro.disconnect(); io.disconnect(); form.dispose(); canvas.remove(); live.current = null; };
  }, [still, noGL]);

  useEffect(() => { live.current?.form.setShape(shape); }, [shape]);
  useEffect(() => { live.current?.form.setTheme(theme === "dark" ? DARK : LIGHT); }, [theme]);
  useEffect(() => { live.current?.form.setShift(shift); }, [shift]);
  useEffect(() => { onCaption?.(words); }, [words]);

  useImperativeHandle(ref, () => ({
    savePNG: () => {
      const l = live.current;
      if (!l) return;
      l.form.frame(l.t, 0);  // draw now so the buffer is fresh
      const a = document.createElement("a");
      a.download = `wimym-week-${week?.week ?? "form"}.png`;
      a.href = (l.form.renderer.domElement as HTMLCanvasElement).toDataURL("image/png");
      a.click();
    },
  }), [week]);

  const muted = theme === "dark" ? "#7d8698" : "#6b7386", ink = theme === "dark" ? "#b4bccb" : "#3d4559";
  return (
    <div ref={box} className={className} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      <div ref={holder} style={{ position: "absolute", inset: 0 }} />
      {noGL && <img src={fallbackSrc ?? (theme === "dark" ? stillDark : stillLight)} alt="A soft, rounded form" style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", objectPosition: `${50 + shift * 100}% 50%`,
        maskImage: "radial-gradient(closest-side, #000 80%, transparent)", WebkitMaskImage: "radial-gradient(closest-side, #000 80%, transparent)",
      }} />}
      {caption && words.line && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: "clamp(16px, 5%, 40px)", textAlign: "center", pointerEvents: "none",
          transform: `translateX(${shift * 100}%)`, font: "400 15px/1.5 var(--text, system-ui)", padding: "0 16px" }}>
          <div style={{ color: ink, fontSize: 16 }}>{words.line}</div>
          {words.sub && <div style={{ color: muted, maxWidth: "70ch", margin: "2px auto 0" }}>{words.sub}</div>}
        </div>
      )}
    </div>
  );
});

export default WeekForm;
