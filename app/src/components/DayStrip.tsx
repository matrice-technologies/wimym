import { DAY0 } from "../lib/blocks";
import { useData } from "../lib/data";
import { fmtHour, plural } from "../lib/format";
import { useWidth } from "../lib/hooks";
import type { WeekBlock } from "../lib/types";
import { useTip } from "./Tip";

/** One day from 05:00 to 05:00 as a strip: your usual day as a wash, work blocks on it, late time warm. */
export default function DayStrip({ blocks, usual, height = 18, mark }: {
  blocks: WeekBlock[]; usual: { start: number; end: number } | null; height?: number;
  mark?: [number, number] | null;  // a stretch to point at, in hours since midnight
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const { byId } = useData();
  const x = (h: number) => ((h - DAY0) / 24) * w;
  const late = usual ? usual.end : Infinity;
  const y = height / 2, bh = Math.max(6, height * 0.5);
  return (
    <div ref={ref} className="strip" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} aria-hidden="true">
          <line x1={0} x2={w} y1={y} y2={y} className="s-track" />
          {[6, 12, 18, 24].map(h => <line key={h} x1={x(h)} x2={x(h)} y1={y - 3} y2={y + 3} className="s-tick" />)}
          {usual && <rect x={x(usual.start)} width={x(usual.end) - x(usual.start)} y={y - height * 0.42} height={height * 0.84} rx={height * 0.42} className="s-usual" />}
          {mark && <rect x={x(mark[0]) - 3} width={Math.max(6, x(mark[1]) - x(mark[0]) + 6)} y={1} height={height - 2} rx={(height - 2) / 2} className="s-mark" />}
          {blocks.map((b, i) => {
            const parts: [number, number, boolean][] = b.to <= late ? [[b.from, b.to, false]] : b.from >= late ? [[b.from, b.to, true]] : [[b.from, late, false], [late, b.to, true]];
            const f = byId.get(b.id);
            return (
              <g key={i} onMouseMove={ev => tip.show(<div><b>{fmtHour(b.from)} to {fmtHour(b.to)}</b><div className="m">{plural(b.messages, "message")}{f ? `, ${f.project}` : ""}</div>{f && <div style={{ marginTop: 6 }}>{f.text.slice(0, 110)}{f.text.length > 110 ? "…" : ""}</div>}</div>, ev.clientX, ev.clientY)} onMouseLeave={tip.hide}>
                {parts.map(([a, z, l], j) => <rect key={j} x={x(a)} width={Math.max(2, x(z) - x(a))} y={y - bh / 2} height={bh} rx={bh / 2} className={l ? "s-work late" : "s-work"} />)}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
