import * as d3 from "d3";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { alpha, useColors, useWidth } from "../lib/hooks";
import { fmtDay, fmtHour, fmtN } from "../lib/format";
import type { Day, Family, Message } from "../lib/types";
import { useTip } from "./Tip";

/** Every day a column, the hours running down it: your messages as dots, your day as a band. */
export default function WhenChart({ messages, days, focus, height = 420, stopHour = null }: {
  messages: Message[]; days: Day[]; focus?: Family | null; height?: number; stopHour?: number | null;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const cv = useRef<HTMLCanvasElement>(null);
  const C = useColors();
  const tip = useTip();
  const nav = useNavigate();
  const m = { t: 8, r: 8, b: 26, l: 44 };
  const g = useMemo(() => {
    const x = d3.scaleBand<string>().domain(days.map(d => d.day)).range([m.l, Math.max(m.l + 10, w - m.r)]).paddingInner(0.18);
    const y = d3.scaleLinear().domain([6, 27]).range([m.t, height - m.b]).clamp(true);
    return { x, y };
  }, [days, w, height]);

  useEffect(() => {
    const c = cv.current;
    if (!c || !w) return;
    const dpr = devicePixelRatio || 1;
    c.width = w * dpr; c.height = height * dpr; c.style.width = w + "px"; c.style.height = height + "px";
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    const { x, y } = g, bw = x.bandwidth();
    ctx.font = "11.5px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let h = 6; h <= 27; h += 3) {
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.l, y(h) + .5); ctx.lineTo(w - m.r, y(h) + .5); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.fillText(fmtHour(h), m.l - 8, y(h));
    }
    // weekends, lightly
    for (const d of days) if (d.dow >= 5) { ctx.fillStyle = alpha(C.ink, C.dark ? .03 : .025); ctx.fillRect(x(d.day)! - bw * .1, m.t, bw * 1.2, height - m.t - m.b); }
    for (const d of days) {
      if (!d.n || d.start == null || d.end == null) continue;
      ctx.fillStyle = alpha(C.ink, C.dark ? .09 : .07);
      const y0 = y(d.start), y1 = y(d.end);
      ctx.beginPath(); ctx.roundRect(x(d.day)!, y0 - 2, bw, Math.max(4, y1 - y0 + 4), Math.min(4, bw / 2)); ctx.fill();
    }
    const r = Math.max(1, Math.min(2.4, bw * .32));
    for (const msg of messages) {
      const X = x(msg.day);
      if (X == null) continue;
      const dim = focus && msg.family !== focus;
      ctx.fillStyle = alpha(C.fam[msg.family || "none"], dim ? .1 : .95);
      ctx.beginPath(); ctx.arc(X + bw / 2 + ((msg.hour * 997) % 1 - .5) * bw * .5, y(msg.hour), r, 0, Math.PI * 2); ctx.fill();
    }
    // the stopping hour you set, across every day
    if (stopHour != null) {
      const sy = y(stopHour < 6 ? stopHour + 24 : stopHour) + .5;
      ctx.strokeStyle = C.late; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(m.l, sy); ctx.lineTo(w - m.r, sy); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillStyle = C.late;
      ctx.fillText(`stop by ${fmtHour(stopHour)}`, w - m.r, sy - 3);
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = C.muted;
    let last = "";
    for (const d of days) {
      const mo = d.day.slice(0, 7);
      if (mo !== last && +d.day.slice(8) <= 7) { ctx.fillText(fmtDay(d.day, { month: "long" }), x(d.day)!, height - 6); last = mo; }
      else if (mo !== last) last = mo;
    }
  }, [g, w, height, messages, days, focus, C, stopHour]);

  const at = (ev: React.MouseEvent) => {
    const r = cv.current!.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const step = g.x.step();
    const i = Math.floor((px - m.l) / step);
    return i >= 0 && i < days.length ? days[i] : null;
  };
  return (
    <div ref={ref}>
      <canvas ref={cv} style={{ display: "block", cursor: "pointer" }} role="img" aria-label="When you work, day by day"
        onMouseMove={ev => {
          const d = at(ev);
          if (!d) return tip.hide();
          tip.show(<div><b>{fmtDay(d.day, { weekday: "long", day: "numeric", month: "long" })}</b>
            {d.n ? <div className="m">{fmtN(d.n)} messages, {fmtHour(d.start)} to {fmtHour(d.end)}, {d.projects} projects, {d.commits} commits</div> : <div className="m">A day off</div>}</div>, ev.clientX, ev.clientY);
        }}
        onMouseLeave={() => tip.hide()}
        onClick={ev => { const d = at(ev); if (d) { tip.hide(); nav(`/days/${d.day}`); } }} />
    </div>
  );
}
