import * as d3 from "d3";
import { useMemo } from "react";

/** A small line over weeks: area wash, last point emphasised, the recent weeks shaded behind. */
export default function Spark({ series, from, color = "var(--ink-2)", width = 220, height = 44 }: {
  series: [string, number | null][]; from?: string; color?: string; width?: number; height?: number;
}) {
  const pts = series.filter(([, v]) => v != null) as [string, number][];
  const g = useMemo(() => {
    if (pts.length < 2) return null;
    const x = d3.scaleLinear().domain([0, series.length - 1]).range([3, width - 5]);
    const ext = d3.extent(pts, p => p[1]) as [number, number];
    const pad = (ext[1] - ext[0]) * 0.15 || 1;
    const y = d3.scaleLinear().domain([Math.max(0, ext[0] - pad), ext[1] + pad]).range([height - 3, 4]);
    const idx = new Map(series.map(([w], i) => [w, i]));
    const line = d3.line<[string, number]>().x(p => x(idx.get(p[0])!)).y(p => y(p[1])).curve(d3.curveMonotoneX);
    const area = d3.area<[string, number]>().x(p => x(idx.get(p[0])!)).y0(height).y1(p => y(p[1])).curve(d3.curveMonotoneX);
    const fi = from ? series.findIndex(([w]) => w >= from) : -1;
    const last = pts[pts.length - 1];
    return { line: line(pts)!, area: area(pts)!, shade: fi >= 0 ? x(Math.max(0, fi - 0.5)) : null, lx: x(idx.get(last[0])!), ly: y(last[1]) };
  }, [pts, series, from, width, height]);
  if (!g) return <svg width={width} height={height} />;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: width, display: "block", overflow: "visible" }} aria-hidden="true">
      {g.shade != null && <rect x={g.shade} y={0} width={width - g.shade} height={height} fill="var(--raised)" rx={4} />}
      <path d={g.area} fill={color} opacity={0.1} />
      <path d={g.line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={g.lx} cy={g.ly} r={3} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
