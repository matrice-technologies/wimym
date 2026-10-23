import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { alpha, useColors, useWidth } from "../lib/hooks";
import { famColor, famName, fmtDay, fmtHour, fmtN } from "../lib/format";
import type { Day, Family, Message } from "../lib/types";
import { useTip } from "./Tip";

/**
 * Growth rings: every day a ring, the first at the centre and today at the edge. Around each
 * ring is the 24-hour clock, noon at the top. Dots are your messages when you sent them; the
 * trail after each is Claude working on it. The faint arc is your day, first message to last.
 */
export default function Rings({ messages, days, focus, onHover }: {
  messages: Message[]; days: Day[]; focus?: Family | null; onHover?: (d: Day | null) => void;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const C = useColors();
  const tip = useTip();
  const nav = useNavigate();
  const size = Math.min(width, 760);
  // The rings grow from the first day outwards once, when the page opens.
  const [reveal, setReveal] = useState(() => (matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0));
  useEffect(() => {
    if (reveal >= 1 || !size) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 1600);
      setReveal(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [size > 0]);

  const index = useMemo(() => new Map(days.map((d, i) => [d.day, i])), [days]);
  const geo = useMemo(() => {
    const cx = size / 2, cy = size / 2, R = size / 2 - 46, r0 = R * 0.16, N = Math.max(1, days.length);
    const band = (R - r0) / N;
    const rad = (i: number) => r0 + band * (i + 0.5);
    const ang = (h: number) => ((h - 12) / 24) * Math.PI * 2 - Math.PI / 2;
    return { cx, cy, R, r0, N, band, rad, ang };
  }, [size, days.length]);

  useEffect(() => {
    const cv = base.current;
    if (!cv || !size) return;
    const dpr = devicePixelRatio || 1;
    cv.width = cv.height = size * dpr;
    cv.style.width = cv.style.height = size + "px";
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const { cx, cy, R, r0, band, rad, ang } = geo;
    const upto = reveal * days.length;

    // hour spokes and labels
    ctx.strokeStyle = alpha(C.line, 1);
    ctx.lineWidth = 1;
    ctx.font = "500 11px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let h = 0; h < 24; h += 3) {
      const a = ang(h);
      ctx.globalAlpha = h % 6 ? 0.35 : 0.8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r0 - 4), cy + Math.sin(a) * (r0 - 4));
      ctx.lineTo(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = h % 6 ? C.faint : C.muted;
      ctx.fillText(String(h).padStart(2, "0") + ":00", cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20));
    }
    // your days: first message to last, as a faint arc
    days.forEach((d, i) => {
      if (!d.n || d.start == null || d.end == null || i > upto) return;
      ctx.strokeStyle = alpha(C.ink, C.dark ? 0.07 : 0.06);
      ctx.lineWidth = Math.max(1, band * 0.92);
      ctx.beginPath();
      ctx.arc(cx, cy, rad(i), ang(d.start), ang(d.end));
      ctx.stroke();
    });
    // Claude working on each message
    ctx.lineCap = "butt";
    for (const m of messages) {
      const i = index.get(m.day);
      if (i == null || m.dur < 20 || i > upto) continue;
      const dim = focus && m.family !== focus;
      ctx.strokeStyle = alpha(C.fam[m.family || "none"], dim ? 0.04 : C.dark ? 0.32 : 0.28);
      ctx.lineWidth = Math.max(0.8, band * 0.62);
      ctx.beginPath();
      ctx.arc(cx, cy, rad(i), ang(m.hour), ang(m.hour + Math.min(m.dur, 4 * 3600) / 3600));
      ctx.stroke();
    }
    // your messages
    const dot = Math.max(1, Math.min(2.6, band * 0.62));
    for (const m of messages) {
      const i = index.get(m.day);
      if (i == null || i > upto) continue;
      const dim = focus && m.family !== focus;
      ctx.fillStyle = alpha(C.fam[m.family || "none"], dim ? 0.12 : 1);
      const a = ang(m.hour), r = rad(i);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, dot, 0, Math.PI * 2);
      ctx.fill();
    }
    // month marks, along the night spoke where there's room
    ctx.font = "600 10.5px " + getComputedStyle(document.body).fontFamily;
    const a = ang(4);
    let lastM = "";
    days.forEach((d, i) => {
      const m = d.day.slice(0, 7);
      if (m === lastM) return;
      lastM = m;
      const r = rad(i);
      ctx.fillStyle = C.muted;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillText(fmtDay(d.day, { month: "short" }), cx + Math.cos(a) * r + 6, cy + Math.sin(a) * r);
    });
  }, [geo, size, messages, days, index, C, focus, reveal]);

  const hit = (ev: React.MouseEvent) => {
    const r = (ev.target as HTMLElement).getBoundingClientRect();
    const x = ev.clientX - r.left - geo.cx, y = ev.clientY - r.top - geo.cy;
    const dist = Math.hypot(x, y);
    const i = Math.floor((dist - geo.r0) / geo.band);
    if (i < 0 || i >= days.length) return null;
    let h = ((Math.atan2(y, x) + Math.PI / 2) / (Math.PI * 2)) * 24 + 12;
    h = ((h % 24) + 24) % 24;
    return { i, h };
  };

  const drawOver = (i: number | null) => {
    const cv = over.current;
    if (!cv || !size) return;
    const dpr = devicePixelRatio || 1;
    if (cv.width !== size * dpr) { cv.width = cv.height = size * dpr; cv.style.width = cv.style.height = size + "px"; }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (i == null) return;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(geo.cx, geo.cy, geo.rad(i) - geo.band / 2 - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(geo.cx, geo.cy, geo.rad(i) + geo.band / 2 + 0.5, 0, Math.PI * 2);
    ctx.stroke();
  };

  return (
    <div ref={box} style={{ width: "100%", display: "grid", placeItems: "center" }}>
      {size > 0 && (
        <div style={{ position: "relative", width: size, height: size }}>
          <canvas ref={base} aria-label="Your days as growth rings" role="img" />
          <canvas
            ref={over}
            style={{ position: "absolute", inset: 0, cursor: "pointer" }}
            onMouseMove={ev => {
              const p = hit(ev);
              drawOver(p ? p.i : null);
              if (!p) { tip.hide(); onHover?.(null); return; }
              const d = days[p.i];
              onHover?.(d);
              const near = messages.filter(m => m.day === d.day && Math.abs(((m.hour % 24) - p.h + 36) % 24 - 12) < 0.35).slice(0, 3);
              tip.show(
                <div>
                  <b>{fmtDay(d.day, { weekday: "long", day: "numeric", month: "long" })}</b>
                  {d.n ? <div className="m">{fmtN(d.n)} messages, {fmtHour(d.start)} to {fmtHour(d.end)}, {d.projects} project{d.projects === 1 ? "" : "s"}</div> : <div className="m">A day off</div>}
                  {near.map(m => (
                    <div key={m.id} style={{ marginTop: 6, display: "flex", gap: 7 }}>
                      <span className="dot" style={{ background: famColor(m.family), marginTop: 6 }} />
                      <span><span className="m">{fmtHour(m.hour)} · {famName(m.family)}</span><br />{m.text.slice(0, 90)}{m.text.length > 90 ? "…" : ""}</span>
                    </div>
                  ))}
                </div>, ev.clientX, ev.clientY);
            }}
            onMouseLeave={() => { drawOver(null); tip.hide(); onHover?.(null); }}
            onClick={ev => { const p = hit(ev); if (p) { tip.hide(); nav(`/days/${days[p.i].day}`); } }}
          />
        </div>
      )}
    </div>
  );
}
