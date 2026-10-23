import * as d3 from "d3";
import { useMemo, useState } from "react";
import { useWidth } from "../lib/hooks";
import { fmtDate, fmtN } from "../lib/format";
import type { Project } from "../lib/types";
import { useTip } from "./Tip";

/** Projects as layers over the weeks, in shades of ink (colour stays reserved for what you ask for). */
export default function Strata({ projects, weeks, eras }: {
  projects: Project[]; weeks: string[]; eras: { project: string; from: string; to: string }[];
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hot, setHot] = useState<string | null>(null);
  const tip = useTip();
  const H = 300, m = { t: 10, b: 26, l: 4, r: 4 };
  const g = useMemo(() => {
    if (!w) return null;
    const top = projects.slice(0, 10).map(p => p.project);
    const rows = weeks.map((wk, i) => {
      const r: Record<string, number | string> = { week: wk };
      let other = 0;
      for (const p of projects) {
        if (top.includes(p.project)) r[p.project] = p.weekly[i] || 0;
        else other += p.weekly[i] || 0;
      }
      r["Other projects"] = other;
      return r;
    });
    const keys = [...top, "Other projects"];
    const stack = d3.stack<Record<string, number | string>>().keys(keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut)
      .value((d, k) => +(d[k] || 0));
    const series = stack(rows);
    const x = d3.scaleLinear().domain([0, weeks.length - 1]).range([m.l, w - m.r]);
    const y = d3.scaleLinear().domain([d3.min(series, s => d3.min(s, d => d[0]))!, d3.max(series, s => d3.max(s, d => d[1]))!]).range([H - m.b, m.t]);
    const area = d3.area<d3.SeriesPoint<Record<string, number | string>>>().x((_, i) => x(i)).y0(d => y(d[0])).y1(d => y(d[1])).curve(d3.curveBasis);
    const labels = series.map(s => {
      let best = 0, bi = 0;
      s.forEach((d, i) => { const th = y(d[0]) - y(d[1]); if (th > best && i > 0 && i < s.length - 1) { best = th; bi = i; } });
      return { key: s.key, x: x(bi), y: (y(s[bi][0]) + y(s[bi][1])) / 2, th: best };
    });
    return { series, area, x, labels, keys };
  }, [w, projects, weeks]);

  const shade = (i: number, n: number) => 0.12 + 0.5 * ((i * 7) % n) / n;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {g && (
        <svg width={w} height={H + 34} style={{ display: "block", overflow: "visible" }}>
          {g.series.map((s, i) => (
            <path key={s.key} d={g.area(s)!} fill={hot === s.key ? "var(--focus)" : "var(--ink)"}
              opacity={hot ? (hot === s.key ? 0.75 : 0.06) : shade(i, g.series.length)} stroke="var(--surface)" strokeWidth={1}
              onMouseMove={ev => {
                setHot(s.key);
                const i2 = Math.max(0, Math.min(weeks.length - 1, Math.round(g.x.invert(ev.nativeEvent.offsetX))));
                const v = s[i2][1] - s[i2][0];
                const pr = projects.find(p => p.project === s.key);
                tip.show(<div><b>{s.key}</b><div className="m">Week of {fmtDate(weeks[i2])}: {fmtN(v)} messages</div>
                  {pr && <div className="m">{fmtN(pr.n)} messages in all, {fmtN(pr.commits)} commits, {pr.days} days</div>}</div>, ev.clientX, ev.clientY);
              }}
              onMouseLeave={() => { setHot(null); tip.hide(); }} />
          ))}
          {g.labels.filter(l => l.th > 18 && (!hot || hot === l.key)).map(l => (
            <text key={l.key} x={l.x} y={l.y} dy="0.32em" textAnchor="middle" className="ink" style={{ fontSize: 12, fontWeight: 600, pointerEvents: "none", paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3 }}>{l.key}</text>
          ))}
          {weeks.map((wk, i) => (wk.slice(8, 10) <= "07" && i > 0) && (
            <text key={wk} x={g.x(i)} y={H - 6} textAnchor="middle">{fmtDate(wk).split(" ")[1]}</text>
          ))}
          {eras.map(e => {
            const a = weeks.indexOf(e.from), b = weeks.indexOf(e.to);
            if (a < 0 || b < 0) return null;
            const step = g.x(1) - g.x(0), x0 = g.x(a) - step / 2 + 1, x1 = g.x(b) + step / 2 - 1, wd = x1 - x0;
            const label = e.project.length * 6.6 < wd - 10 ? e.project : wd > 30 ? e.project.slice(0, Math.floor((wd - 10) / 6.6)) + "…" : "";
            return (
              <g key={e.from} transform={`translate(${Math.max(m.l, x0)},${H + 8})`}>
                <rect width={Math.max(2, Math.min(wd, w - x0))} height={22} rx={5} fill="var(--raised)" stroke="var(--line)" />
                {label && <text x={8} y={11} dy="0.32em" className="ink2" style={{ fontSize: 11.5 }}>{label}</text>}
              </g>
            );
          })}
        </svg>
      )}
      <p className="sub" style={{ margin: "10px 0 0" }}>The row underneath names the project that led each stretch of weeks.</p>
    </div>
  );
}
