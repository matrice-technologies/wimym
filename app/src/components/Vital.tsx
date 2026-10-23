import * as d3 from "d3";
import { useMemo } from "react";
import { fmtDate } from "../lib/format";
import { useWidth } from "../lib/hooks";
import type { Measure, MeasureUnit } from "../lib/types";

/** Weekly totals: the current week's is partial, so it can only be held against a usual week by the same day. */
export const SUMMED = new Set(["load", "daysoff", "landed", "late", "people"]);

/** A measure's value in its unit: 7.1 h, 42 min, 2 days, 12%, 5.7 an hour. */
export function fmtUnit(v: number | null | undefined, unit: MeasureUnit, short = false): string {
  if (v == null) return "—";
  const r = (x: number, d = 1) => (Math.abs(x) >= 10 ? Math.round(x).toLocaleString("en") : x.toFixed(d).replace(/\.0$/, ""));
  switch (unit) {
    case "h": return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} h`;
    case "min": {
      const m = Math.round(v);
      if (m < 90) return `${m} min`;
      return short ? `${(m / 60).toFixed(1).replace(/\.0$/, "")} h` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
    }
    case "days": return short ? `${r(v)} d` : `${r(v)} ${Math.round(v * 10) === 10 ? "day" : "days"}`;
    case "%": return `${r(v)}%`;
    case "perh": return short ? `${r(v)}/h` : `${r(v)} an hour`;
    default: return r(v, v < 10 ? 1 : 0);
  }
}

/**
 * Twelve weeks as a line over the person's own range (the shaded band, which moves as the
 * weeks go by), and this week so far as an open dot: open because the week isn't over.
 */
export function RangeLine(p: { m: Measure; weeks: string[]; height?: number; n?: number; axis?: boolean; pace?: number | null }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  return <div ref={ref} className="rl-box" style={{ height: p.height ?? 64 }}>{w > 0 && <RangeSvg {...p} width={w} />}</div>;
}

function RangeSvg({ m, weeks, width, height = 64, n = 12, axis = false, pace = null }: {
  m: Measure; weeks: string[]; width: number; height?: number; n?: number; axis?: boolean; pace?: number | null;
}) {
  const g = useMemo(() => {
    const L = weeks.length, from = Math.max(0, L - n);
    const idx = d3.range(from, L);
    const vals = [...idx.flatMap(i => [m.weekly[i], m.band[i]?.lo, m.band[i]?.hi]), pace].filter((v): v is number => v != null);
    if (!vals.length) return null;
    const padL = axis ? 34 : 4, padB = axis ? 18 : 4;
    const x = d3.scaleLinear().domain([from, L - 1]).range([padL, width - 8]);
    let [lo, hi] = d3.extent(vals) as [number, number];
    if (lo === hi) { lo -= 1; hi += 1; }
    const span = hi - lo;
    const y = d3.scaleLinear().domain([Math.max(0, lo - span * 0.18), hi + span * 0.18]).range([height - padB, 6]).nice();
    const bands = idx.filter(i => m.band[i]).map(i => ({ i, ...m.band[i]! }));
    const area = d3.area<typeof bands[0]>().x(b => x(b.i)).y0(b => y(b.lo)).y1(b => y(b.hi)).curve(d3.curveMonotoneX);
    const mid = d3.line<typeof bands[0]>().x(b => x(b.i)).y(b => y(b.mid)).curve(d3.curveMonotoneX);
    // the line runs over complete weeks only; the current week is the open dot
    const done = idx.slice(0, -1).filter(i => m.weekly[i] != null).map(i => [i, m.weekly[i]!] as [number, number]);
    const line = d3.line<[number, number]>().x(p => x(p[0])).y(p => y(p[1])).curve(d3.curveMonotoneX);
    const now = m.now ?? m.weekly[L - 1];
    const b = m.band[L - 1];
    const out = now != null && b ? (now > b.hi ? "above" : now < b.lo ? "below" : null) : null;
    const last = done[done.length - 1];
    return {
      x, y, from, L, padL, padB,
      area: bands.length > 1 ? area(bands) : null, mid: bands.length > 1 ? mid(bands) : null,
      line: done.length > 1 ? line(done) : null, last, now, out,
      ticks: y.ticks(3),
    };
  }, [m, weeks, width, height, n, axis, pace]);

  if (!g) return <svg className="rangeline empty" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><Hatch w={width} h={height} /></svg>;
  const flagged = m.flag != null;
  return (
    <svg className={"rangeline" + (flagged ? " flagged" : "")} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible", display: "block" }} aria-hidden="true">
      {axis && g.ticks.map(t => (
        <g key={t}>
          <line x1={g.padL} x2={width - 8} y1={g.y(t)} y2={g.y(t)} className="grid" />
          <text x={g.padL - 6} y={g.y(t)} textAnchor="end" dominantBaseline="middle">{t}</text>
        </g>
      ))}
      {axis && [g.from, Math.round((g.from + g.L - 1) / 2), g.L - 1].map(i => (
        <text key={i} x={g.x(i)} y={height - 2} textAnchor={i === g.L - 1 ? "end" : i === g.from ? "start" : "middle"}>{i === g.L - 1 ? "This week" : fmtDate(weeks[i])}</text>
      ))}
      {g.area && <path d={g.area} className="band" />}
      {g.mid && <path d={g.mid} className="bandmid" />}
      {g.line && <path d={g.line} className="line" pathLength={1} />}
      {g.last && <circle cx={g.x(g.last[0])} cy={g.y(g.last[1])} r={2.4} className="last" />}
      {pace != null && <line x1={g.x(g.L - 1) - 7} x2={g.x(g.L - 1) + 7} y1={g.y(pace)} y2={g.y(pace)} className="pace" />}
      {g.now != null && <circle cx={g.x(g.L - 1)} cy={g.y(g.now)} r={4} className={"nowdot" + (g.out ? " out" : "")} />}
    </svg>
  );
}

function Hatch({ w, h }: { w: number; h: number }) {
  return (
    <>
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="hatch" />
        </pattern>
      </defs>
      <rect x={1} y={h * 0.25} width={w - 2} height={h * 0.5} rx={4} fill="url(#hatch)" />
    </>
  );
}
