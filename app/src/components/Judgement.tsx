import * as d3 from "d3";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { fmtDay, fmtDur, fmtHour, fmtN } from "../lib/format";
import { useWidth } from "../lib/hooks";
import type { Message } from "../lib/types";
import { useTip } from "./Tip";

const WPM = 250;  // the reading speed the engine uses for unread approvals

/**
 * Each go-ahead as a point: how long Claude's reply was, against how long you took to answer it.
 * The line is reading at 250 words a minute; points under it were sent before the reply could be
 * read. This week's go-aheads are solid, the four weeks before are faint behind them.
 */
export default function Judgement({ now, before, height = 260 }: { now: Message[]; before: Message[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const nav = useNavigate();
  const g = useMemo(() => {
    if (!w) return null;
    const pad = { l: 44, r: 10, t: 10, b: 30 };
    const top = Math.max(200, (d3.max([...now, ...before], m => m.readWords ?? 0) ?? 0) * 1.3);
    const x = d3.scaleLog().domain([5, top]).range([pad.l, w - pad.r]).clamp(true);
    const y = d3.scaleLog().domain([1, 3600]).range([height - pad.b, pad.t]).clamp(true);
    return { x, y, pad, top };
  }, [w, height, now, before]);
  const pt = (m: Message) => ({ m, cx: g!.x(Math.max(5, m.readWords!)), cy: g!.y(Math.max(1, m.gap!)), fast: m.gap! < (m.readWords! / WPM) * 60 });
  return (
    <div ref={ref} className="judge" style={{ height }}>
      {g && (
        <svg width={w} height={height} role="img" aria-label="Your go-aheads: reply length against time to answer">
          {[10, 100, 1000].filter(v => v <= g.top).map(v => <g key={v}><line x1={g.x(v)} x2={g.x(v)} y1={g.pad.t} y2={height - g.pad.b} className="grid" /><text x={g.x(v)} y={height - 12} textAnchor="middle">{fmtN(v)} words</text></g>)}
          {[1, 10, 60, 600, 3600].map(v => <g key={v}><line x1={g.pad.l} x2={w - g.pad.r} y1={g.y(v)} y2={g.y(v)} className="grid" /><text x={g.pad.l - 6} y={g.y(v)} textAnchor="end" dominantBaseline="middle">{v < 60 ? `${v} s` : v < 3600 ? `${v / 60} min` : "1 h"}</text></g>)}
          <path d={`M${g.x(5)},${g.y((5 / WPM) * 60)}L${g.x(g.top)},${g.y((g.top / WPM) * 60)}`} className="readline" />
          <text x={w - g.pad.r} y={g.y((g.top / WPM) * 60) + 18} textAnchor="end" className="readlabel">read at 250 words a minute</text>
          {before.map(m => { const p = pt(m); return <circle key={m.id} cx={p.cx} cy={p.cy} r={2.4} className="jp old" />; })}
          {now.map(m => {
            const p = pt(m);
            return <circle key={m.id} cx={p.cx} cy={p.cy} r={4.2} className={"jp" + (p.fast ? " fast" : "")}
              onMouseMove={ev => tip.show(<div><b>{fmtDay(m.day, { weekday: "long" })} {fmtHour(m.hour)}</b><div className="m">Answered in {fmtDur(m.gap)}, to a reply of {fmtN(m.readWords)} words{p.fast ? ", before it could be read" : ""}</div><div style={{ marginTop: 6 }}>{m.text.slice(0, 90)}</div></div>, ev.clientX, ev.clientY)}
              onMouseLeave={tip.hide} onClick={() => { tip.hide(); nav(`/messages/${encodeURIComponent(m.id)}`); }} />;
          })}
        </svg>
      )}
    </div>
  );
}
