import * as d3 from "d3";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWidth } from "../lib/hooks";
import { fmtDay, fmtHour, plural } from "../lib/format";
import { DAY0 } from "../lib/blocks";
import { useData } from "../lib/data";
import type { WeekDay } from "../lib/types";
import { useTip } from "./Tip";

/**
 * The week as a spiral: one turn per day, from Monday 05:00 at the centre to Sunday at the edge,
 * noon at the top and midnight at the bottom. Thick strokes are your work blocks (messages less
 * than 20 minutes apart); the indigo stretches between days are your nights; the faint wash
 * under each turn is your usual day, first message to last over the eight weeks before.
 * Time past your usual stop is drawn warm.
 */
const H = 24, DAYS = 7, T = H * DAYS;

interface Gap { a: number; b: number; night: boolean; open: boolean }

/** A work block on the week's clock: hours since Monday 05:00, with its first message's id. */
export interface SpiralBlock { a: number; b: number; day: string; n: number; id: string }

/** The engine's blocks for each day (hours since midnight) on the week's clock. */
export function spiralBlocks(week: string[], days: WeekDay[]): SpiralBlock[] {
  return days.flatMap(d => (d.blocks ?? []).map(b => {
    const off = week.indexOf(d.day) * H - DAY0;
    return { a: off + b.from, b: off + b.to, day: d.day, n: b.messages, id: b.id };
  })).sort((x, y) => x.a - y.a);
}

export default function WeekSpiral({ week, blocks, nowT, usual, stopHour, center }: {
  week: string[];                  // the seven days of the week, Monday first
  blocks: SpiralBlock[];
  nowT: number;                    // hours since Monday 05:00
  usual: { start: number; end: number } | null;
  stopHour: number | null;
  center: React.ReactNode;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const nav = useNavigate();
  const size = Math.min(width, 560);
  const narrow = size < 420, pad = narrow ? 30 : 34;

  const geo = useMemo(() => {
    const cx = size / 2, cy = size / 2, R = size / 2 - pad, r0 = R * 0.3;
    const g = (R - r0) / DAYS;
    const ang = (t: number) => (((DAY0 + t) % H) - 12) / H * Math.PI * 2 - Math.PI / 2;
    // the spiral starts half a turn's width out, so turn d sits at r0 + g*(d + 0.5) at its own 05:00
    const rad = (t: number) => r0 + g * (t / H + 0.5);
    const pt = (t: number): [number, number] => [cx + Math.cos(ang(t)) * rad(t), cy + Math.sin(ang(t)) * rad(t)];
    const path = (a: number, b: number) => {
      const n = Math.max(2, Math.ceil((b - a) / 0.08));
      return "M" + d3.range(n + 1).map(i => pt(a + (b - a) * i / n).map(v => v.toFixed(1)).join(",")).join("L");
    };
    return { cx, cy, R, r0, g, ang, rad, pt, path };
  }, [size, pad]);

  const { byId } = useData();
  const gaps = useMemo(() => {
    // The stretches between blocks: a night when it crosses 05:00, a break otherwise.
    const gaps: Gap[] = [];
    let prev = 0;
    for (const b of [...blocks, null]) {
      const a = prev, z = b ? b.a : Math.min(nowT, T);
      if (z > a + 0.02) gaps.push({ a, b: z, night: a === 0 || Math.floor(a / H) !== Math.floor(z / H) || (!b && z - a > 3), open: !b });
      if (b) prev = b.b;
    }
    return gaps;
  }, [blocks, nowT]);

  if (!size) return <div ref={box} className="spiral-box" />;
  const { cx, cy, R, r0, g, ang, pt, path } = geo;
  const lateFrom = stopHour ?? usual?.end ?? null;
  // when on turn d does "late" start, in hours since Monday 05:00
  const lateT = (d: number) => (lateFrom == null ? Infinity : d * H + ((lateFrom - DAY0 + H) % H));
  const delay = (t: number) => `${(Math.min(t, nowT) / Math.max(nowT, 1)) * 1.5}s`;
  const dur = (a: number, b: number) => `${Math.max(0.12, Math.min(0.9, (b - a) / 10))}s`;
  const today = Math.min(DAYS - 1, Math.floor(nowT / H));
  const [nx, ny] = pt(Math.min(nowT, T));
  const showTip = (ev: React.MouseEvent, c: React.ReactNode) => tip.show(c, ev.clientX, ev.clientY);
  const clock = (t: number) => fmtHour((DAY0 + t) % H);

  return (
    <div ref={box} className="spiral-box">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" className="spiral"
        aria-label={`This week as a spiral: ${plural(blocks.length, "work block")} so far, one turn per day.`}>
        {/* the clock: hour ticks, four labels */}
        {d3.range(0, 24, 1).map(h => {
          const a = ang((h - DAY0 + H) % H), major = h % 6 === 0;
          const r1 = R + g * 0.5 + 4, r2 = r1 + (major ? 7 : 3);
          return <line key={h} x1={cx + Math.cos(a) * r1} y1={cy + Math.sin(a) * r1} x2={cx + Math.cos(a) * r2} y2={cy + Math.sin(a) * r2} className={major ? "tick major" : "tick"} />;
        })}
        {[12, 18, 0, 6].map(h => {
          const a = ang((h - DAY0 + H) % H), r = R + g * 0.5 + (h % 12 ? (narrow ? 12 : 16) : (narrow ? 18 : 22));
          return <text key={h} x={cx + Math.cos(a) * r} y={cy + Math.sin(a) * r} textAnchor={h === 6 ? "end" : h === 18 ? "start" : "middle"} dominantBaseline="middle" className="hour">{String(h).padStart(2, "0")}{narrow ? "" : ":00"}</text>;
        })}

        {/* your usual day, a wash under each turn */}
        {usual && d3.range(DAYS).map(d => {
          const a = d * H + ((usual.start - DAY0 + H) % H), b = d * H + ((usual.end - DAY0 + H) % H);
          return <path key={d} d={path(a, b)} className={"usual" + (d > today ? " ahead" : "")} strokeWidth={g * 0.72} style={{ animationDelay: `${0.1 + d * 0.05}s` }} />;
        })}

        {/* the time line, with the part still to come dotted */}
        <path d={path(0, Math.min(nowT, T))} className="track" />
        {nowT < T && <path d={path(nowT, T)} className="track future" />}

        {/* nights and breaks */}
        {gaps.filter(x => x.night).map((x, i) => (
          <path key={i} d={path(x.a, x.b)} className={"night" + (x.open ? " open" : "")} strokeWidth={Math.max(2, g * 0.22)} pathLength={1}
            style={{ animationDelay: delay(x.a), animationDuration: dur(x.a, x.b) }}
            onMouseMove={ev => showTip(ev, <div><b>{x.open ? "Since your last message" : x.a === 0 ? "Into the week" : "Night"}</b><div className="m">{(x.b - x.a).toFixed(1)} h, {clock(x.a)} to {x.open ? "now" : clock(x.b)}</div></div>)}
            onMouseLeave={tip.hide} />
        ))}

        {/* work blocks, warm after your usual stop */}
        {blocks.map((b, i) => {
          const d = Math.floor(b.a / H), lt = lateT(d), w = Math.max(3, g * 0.44);
          const parts: [number, number, boolean][] = b.b <= lt ? [[b.a, b.b, false]] : b.a >= lt ? [[b.a, b.b, true]] : [[b.a, lt, false], [lt, b.b, true]];
          return (
            <g key={i} className="block" onClick={() => { tip.hide(); nav(`/days/${b.day}`); }}
              onMouseMove={ev => { const f = byId.get(b.id); showTip(ev, <div><b>{fmtDay(b.day, { weekday: "long", day: "numeric", month: "long" })}</b>
                <div className="m">{clock(b.a)} to {clock(b.b)}, {plural(b.n, "message")}{f ? `, ${f.project}` : ""}</div>
                {f && <div style={{ marginTop: 6 }}>{f.text.slice(0, 120)}{f.text.length > 120 ? "…" : ""}</div>}</div>); }}
              onMouseLeave={tip.hide}>
              {parts.map(([a, z, late], j) => (
                <path key={j} d={path(a, z)} className={late ? "work late" : "work"} strokeWidth={w} pathLength={1}
                  style={{ animationDelay: delay(a), animationDuration: dur(a, z) }} />
              ))}
            </g>
          );
        })}

        {/* a stopping hour the person set */}
        {stopHour != null && (() => {
          const a = ang((stopHour - DAY0 + H) % H);
          return <line x1={cx + Math.cos(a) * (r0 - 4)} y1={cy + Math.sin(a) * (r0 - 4)} x2={cx + Math.cos(a) * (R + g)} y2={cy + Math.sin(a) * (R + g)} className="stopline" />;
        })()}

        {/* day names, down the 01:00 spoke where the turns run nearly vertical, so they stack like a ruler */}
        {week.map((d, i) => {
          const [x, y] = pt(i * H + 20);
          return <text key={d} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className={"dayname" + (i === today ? " now" : i > today ? " later" : "")}>{fmtDay(d, { weekday: narrow ? "narrow" : "short" })}</text>;
        })}

        {/* now */}
        {nowT <= T && <g className="now" style={{ animationDelay: "1.55s" }}>
          <circle cx={nx} cy={ny} r={Math.max(7, g * 0.5)} className="halo" />
          <circle cx={nx} cy={ny} r={3.6} className="dot" />
        </g>}
        <circle cx={cx} cy={cy} r={r0 - g * 0.2} className="hub" />
      </svg>
      <div className="spiral-center" style={{ width: (r0 - g * 0.3) * 2, height: (r0 - g * 0.3) * 2 }}>{center}</div>
    </div>
  );
}
