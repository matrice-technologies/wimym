import * as d3 from "d3";
import { useWidth } from "../lib/hooks";
import { useTip } from "./Tip";

export function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [100 * Math.max(0, c - h), 100 * Math.min(1, c + h)];
}

export interface BandSeries { key: string; label: string; color: string; points: { x: string; v: number | null; lo?: number | null; hi?: number | null; n?: number }[] }

/** Lines over categories (bins), each with its 95% range as a band, labelled at the end. */
export function BandLines({ series, height = 240, unit = "%", note }: { series: BandSeries[]; height?: number; unit?: string; note?: (x: string) => string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const cats = series[0]?.points.map(p => p.x) || [];
  const m = { t: 12, r: 120, b: 28, l: 40 };
  const x = d3.scalePoint<string>().domain(cats).range([m.l + 8, Math.max(m.l + 20, w - m.r)]);
  const max = d3.max(series, s => d3.max(s.points, p => p.hi ?? p.v ?? 0)) || 1;
  const y = d3.scaleLinear().domain([0, max]).nice(4).range([height - m.b, m.t]);
  const line = d3.line<{ x: string; v: number | null }>().defined(p => p.v != null).x(p => x(p.x)!).y(p => y(p.v!)).curve(d3.curveMonotoneX);
  const band = d3.area<{ x: string; lo?: number | null; hi?: number | null }>().defined(p => p.lo != null).x(p => x(p.x)!).y0(p => y(p.lo!)).y1(p => y(p.hi!)).curve(d3.curveMonotoneX);
  // end labels, nudged apart
  const ends = series.map(s => { const last = [...s.points].reverse().find(p => p.v != null); return { s, y: last ? y(last.v!) : 0, v: last?.v }; }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
  return (
    <div ref={ref}>
      {w > 0 && (
        <svg width={w} height={height} style={{ display: "block" }}>
          {y.ticks(4).map(t => <g key={t}><line x1={m.l} x2={w - m.r + 8} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">{t}{unit}</text></g>)}
          {cats.map(c => <text key={c} x={x(c)} y={height - 8} textAnchor="middle">{c}</text>)}
          {series.map(s => <path key={s.key + "b"} d={band(s.points) || ""} fill={s.color} opacity={0.13} />)}
          {series.map(s => <path key={s.key} d={line(s.points) || ""} fill="none" stroke={s.color} strokeWidth={2} />)}
          {series.map(s => s.points.map(p => p.v != null && <circle key={s.key + p.x} cx={x(p.x)} cy={y(p.v)} r={3.2} fill={s.color} stroke="var(--surface)" strokeWidth={1.5} />))}
          {ends.map(e => <text key={e.s.key} x={w - m.r + 16} y={e.y} dy="0.32em" className="ink2">{e.s.label}</text>)}
          {cats.map(c => (
            <rect key={c + "h"} x={x(c)! - x.step() / 2} width={x.step()} y={m.t} height={height - m.t - m.b} fill="transparent"
              onMouseMove={ev => tip.show(<div><b>{c}</b>{note && <div className="m">{note(c)}</div>}
                {series.map(s => { const p = s.points.find(q => q.x === c)!; return <div key={s.key}><span className="dot" style={{ background: s.color, marginRight: 7 }} />{s.label}: <b>{p.v == null ? "—" : p.v.toFixed(1) + unit}</b>{p.lo != null && <span className="m"> ({p.lo.toFixed(1)}–{p.hi!.toFixed(1)})</span>}</div>; })}</div>, ev.clientX, ev.clientY)}
              onMouseLeave={() => tip.hide()} />
          ))}
        </svg>
      )}
    </div>
  );
}

/** Simple lines over weeks, one y axis, labelled at the end. */
export function WeekLines({ weeks, series, height = 220, unit = "", fmt }: {
  weeks: string[]; series: { key: string; label: string; color: string; values: (number | null)[] }[]; height?: number; unit?: string; fmt?: (v: number) => string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const m = { t: 12, r: 130, b: 26, l: 40 };
  const x = d3.scaleLinear().domain([0, weeks.length - 1]).range([m.l, Math.max(m.l + 10, w - m.r)]);
  const max = d3.max(series, s => d3.max(s.values, v => v ?? 0)) || 1;
  const y = d3.scaleLinear().domain([0, max]).nice(4).range([height - m.b, m.t]);
  const f = fmt || ((v: number) => d3.format("~g")(+v.toFixed(1)) + unit);
  if (!series.some(s => s.values.some(v => v != null))) return <div className="nodata" style={{ height }}>Not enough labelled messages in any week yet.</div>;
  const ends = series.map(s => { let i = s.values.length - 1; while (i > 0 && s.values[i] == null) i--; return { s, y: y(s.values[i] ?? 0), i }; }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
  return (
    <div ref={ref}>
      {w > 0 && (
        <svg width={w} height={height} style={{ display: "block" }}>
          {y.ticks(4).map(t => <g key={t}><line x1={m.l} x2={w - m.r + 8} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">{f(t)}</text></g>)}
          {weeks.map((wk, i) => (weeks.length <= 8 ? true : +wk.slice(8) <= 7 && i > 0) && <text key={wk} x={x(i)} y={height - 7} textAnchor="middle">{new Date(wk + "T12:00").toLocaleDateString("en-GB", weeks.length <= 8 ? { day: "numeric", month: "short" } : { month: "short" })}</text>)}
          {series.map(s => <path key={s.key} d={d3.line<number | null>().defined(v => v != null).x((_, i) => x(i)).y(v => y(v!)).curve(d3.curveMonotoneX)(s.values) || ""} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" />)}
          {ends.map(e => <g key={e.s.key}><circle cx={x(e.i)} cy={y(e.s.values[e.i] ?? 0)} r={3.5} fill={e.s.color} stroke="var(--surface)" strokeWidth={1.5} /><text x={w - m.r + 16} y={e.y} dy="0.32em" className="ink2">{e.s.label}</text></g>)}
          <rect x={m.l} y={m.t} width={Math.max(0, w - m.l - m.r)} height={height - m.t - m.b} fill="transparent"
            onMouseMove={ev => {
              const r = (ev.target as SVGRectElement).getBoundingClientRect();
              const i = Math.max(0, Math.min(weeks.length - 1, Math.round(x.invert(ev.clientX - r.left + m.l))));
              tip.show(<div><b>Week of {new Date(weeks[i] + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</b>
                {series.map(s => <div key={s.key}><span className="dot" style={{ background: s.color, marginRight: 7 }} />{s.label}: <b>{s.values[i] == null ? "—" : f(s.values[i]!)}</b></div>)}</div>, ev.clientX, ev.clientY);
            }}
            onMouseLeave={() => tip.hide()} />
        </svg>
      )}
    </div>
  );
}

/** Horizontal bars, sorted, labelled. */
export function Bars({ rows, max, fmt = v => String(v), labelW = 150, onClick }: {
  rows: { key: string; label: string; value: number; color: string; note?: string }[]; max?: number; fmt?: (v: number) => string; labelW?: number; onClick?: (k: string) => void;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const M = max ?? (d3.max(rows, r => r.value) || 1);
  const rowH = 30, valW = 120;
  const x = d3.scaleLinear().domain([0, M]).range([0, Math.max(10, w - labelW - valW - 8)]);
  return (
    <div ref={ref}>
      {w > 0 && (
        <svg width={w} height={rows.length * rowH} style={{ display: "block" }}>
          {rows.map((r, i) => (
            <g key={r.key} transform={`translate(0,${i * rowH})`} style={{ cursor: onClick ? "pointer" : undefined }} onClick={() => onClick?.(r.key)}>
              <text x={labelW - 10} y={rowH / 2} dy="0.32em" textAnchor="end" className="ink" style={{ fontSize: 13 }}>{r.label}</text>
              <rect x={labelW} y={7} width={Math.max(2, x(r.value))} height={rowH - 14} rx={4} fill={r.color} />
              <text x={labelW + x(r.value) + 8} y={rowH / 2} dy="0.32em" className="ink2 num" style={{ fontSize: 12.5 }}>{fmt(r.value)}{r.note ? <tspan className="muted" style={{ fill: "var(--muted)" }}> {r.note}</tspan> : null}</text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
