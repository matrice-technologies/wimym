import * as d3 from "d3";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CheckIn from "../components/CheckIn";
import { useTip } from "../components/Tip";
import { useData, useDay, useSessions } from "../lib/data";
import { famColor, famName, fmtDay, fmtDur, fmtHour, INTENTS, plural } from "../lib/format";
import { useWidth } from "../lib/hooks";
import { SCOPE, WHO } from "../lib/labels";
import type { Day, DayDetail, DayTurn } from "../lib/types";

const shift = (day: string, n: number) => d3.timeFormat("%Y-%m-%d")(d3.timeDay.offset(new Date(day + "T12:00"), n));

export default function DayPage() {
  const { day = "" } = useParams();
  const { core } = useData();
  const d = useDay(day);
  const nav = useNavigate();
  const days = core?.days || [];
  const on = days.filter(x => x.n);
  const usual = (f: (x: Day) => number | null | undefined) => d3.median(on, x => f(x) ?? undefined);
  const row = d?.row;
  const i = days.findIndex(x => x.day === day);
  return (
    <div className="wrap">
      <nav className="daynav">
        <Link className="link" to="/days">All days</Link>
        <span className="sp" />
        {i > 0 && <button className="pill" onClick={() => nav(`/days/${shift(day, -1)}`)}>← {fmtDay(shift(day, -1), { weekday: "short", day: "numeric" })}</button>}
        {i >= 0 && i < days.length - 1 && <button className="pill" onClick={() => nav(`/days/${shift(day, 1)}`)}>{fmtDay(shift(day, 1), { weekday: "short", day: "numeric" })} →</button>}
      </nav>
      <h1 className="title">{fmtDay(day, { weekday: "long", day: "numeric", month: "long" })}</h1>
      {!d ? <div className="loading">Opening the day…</div> : !row?.n ? <p className="lede">A day off: no messages from you.</p> : (
        <>
          <p className="lede">
            {plural(row.n, "message")} from {fmtHour(row.start)} to {fmtHour(row.end)} across {plural(row.projects ?? 0, "project")} and {plural(row.sessions ?? 0, "session")}
            {row.peak && row.peak > 1 ? `, with up to ${row.peak} of yours running at once` : ""}. Claude worked {row.claudeH} hours and made {plural(row.commits ?? 0, "commit")}.
          </p>
          <div className="vs">
            {([
              ["Day length", row.span, usual(x => x.span), (v: number) => v.toFixed(1) + " h"],
              ["Projects", row.projects, usual(x => x.projects), (v: number) => String(Math.round(v))],
              ["Sessions at once", row.avgAt, usual(x => x.avgAt), (v: number) => v.toFixed(1)],
              ["Corrections", row.correct, usual(x => x.correct), (v: number) => v.toFixed(0) + "%"],
              ["Sounds frustrated", row.frustrated, usual(x => x.frustrated), (v: number) => v.toFixed(0) + "%"],
              ...(core?.profile.coverage?.signals.covered ? [
                ["Ideas of your own", row.own, usual(x => x.own), (v: number) => v.toFixed(0) + "%"],
                ["Annoyed at Claude", row.irkClaude, usual(x => x.irkClaude), (v: number) => v.toFixed(0) + "%"],
              ] : []),
              ["Commits", row.commits, usual(x => x.commits), (v: number) => String(Math.round(v))],
            ] as [string, number | null | undefined, number | undefined, (v: number) => string][]).map(([k, v, u, f]) => (
              <div key={k}><span className="muted">{k}</span><b className="num">{v == null ? "—" : f(v)}</b><span className="muted num">usual {u == null ? "—" : f(u)}</span></div>
            ))}
          </div>
          <section className="block" style={{ marginTop: 36 }}>
            <header><div><h2 className="section">The day as a score</h2>
              <p className="sub" style={{ margin: 0 }}>One line per session, grouped by project. Each bar is Claude working on a message, coloured by what you asked; grey bars are turns nobody typed (side sessions, notices). A notch on a bar is a commit. Above: how many of your sessions were running.</p></div></header>
            <div className="panel"><Score d={d} /></div>
          </section>
          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <section className="panel">
              <h2 className="section">How it felt</h2>
              <p className="sub">Your check-in for this day.</p>
              <CheckIn key={day} day={day} check={row.check} />
            </section>
            <section className="panel">
              <h2 className="section">The mix</h2>
              <p className="sub">What your {row.labelled} labelled messages asked for.</p>
              <Mix d={d} />
            </section>
          </div>
          <Thread d={d} />
        </>
      )}
    </div>
  );
}

/** The second label set on one message, in a line: "Your idea · Claude decides · A task · annoyed at Claude". */
function steer(t: DayTurn) {
  const bits = [
    t.own ? "Your idea" : null,
    t.who === "alex" ? "You decide" : t.who === "claude" ? "Claude decides" : t.who === "open" ? "Left open" : null,
    t.scope && t.scope !== "none" ? SCOPE[t.scope] : null,
    t.irk === "claude" ? "annoyed at Claude" : t.irk === "other" ? "annoyed at something else" : null,
    t.pressure ? "under pressure" : null, t.play ? "playful" : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : WHO.none;
}

// A session's outcome, as the sessions labels read it.
const OUTCOME: Record<string, string> = { landed: "Landed", partial: "Partly done", abandoned: "Left unfinished", answered: "Answered" };
const OUTCOME_COLOR: Record<string, string> = { landed: "var(--up)", partial: "var(--f-approve)", abandoned: "var(--down)", answered: "var(--faint)" };

function Score({ d }: { d: DayDetail }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const nav = useNavigate();
  const sessions = useSessions();
  const bySid = useMemo(() => new Map((sessions ?? []).map(s => [s.sid, s])), [sessions]);
  const lanes = useMemo(() => {
    const byProj = d3.groups(d.sessions, s => s.project || "?").map(([p, ss]) => ({ p, ss, n: d.turns.filter(t => t.project === p).length }))
      .sort((a, b) => b.n - a.n);
    const out: { kind: "head" | "lane"; p: string; sid?: string; label?: string }[] = [];
    for (const g of byProj) {
      out.push({ kind: "head", p: g.p });
      for (const s of g.ss) out.push({ kind: "lane", p: g.p, sid: s.sid, label: bySid.get(s.sid)?.goal || s.title || s.ex || "(no title)" });
    }
    return out;
  }, [d, bySid]);
  const L = Math.min(260, Math.max(160, w * 0.22)), laneH = 22, headH = 26, top = 70;
  const hs = d.turns.map(t => t.at).concat(d.turns.map(t => t.to));
  const lo = Math.floor((d3.min(hs) ?? 8) - 0.25), hi = Math.ceil((d3.max(hs) ?? 20) + 0.25);
  const x = d3.scaleLinear().domain([lo, hi]).range([L, Math.max(L + 50, w - 12)]);
  let yy = top;
  const ys = new Map<string, number>();
  const heads: [string, number][] = [];
  for (const l of lanes) { if (l.kind === "head") { heads.push([l.p, yy]); yy += headH; } else { ys.set(l.sid!, yy); yy += laneH; } }
  const H = yy + 26;
  const cmax = d3.max(d.curve, c => c[2]) || 1;
  const cy = d3.scaleLinear().domain([0, Math.max(2, cmax)]).range([top - 14, 8]);
  const curve = d.curve.filter(c => c[0] >= lo && c[0] <= hi);
  const show = (t: DayTurn, ev: React.MouseEvent) => tip.show(
    <div><b>{fmtHour(t.at)} · {t.project}</b>
      <div className="m">{t.mine ? (t.intent ? `${INTENTS[t.intent] || t.intent} (${famName(t.family)})` : "Not labelled") : "Not typed by you"}{t.tone && t.tone !== "neutral" ? `, sounds ${t.tone}` : ""}</div>
      {t.mine && t.who != null && <div className="m">{steer(t)}</div>}
      <div style={{ margin: "6px 0" }}>{t.text || "(no text)"}</div>
      <div className="m">Claude: {fmtDur((t.to - t.at) * 3600)}, {plural(t.tools, "tool call")}{t.files ? `, ${plural(t.files, "file")}, ${plural(t.lines, "line")}` : ""}{t.commits ? `, ${plural(t.commits, "commit")}` : ""}{t.stopped ? ", stopped by you" : ""}</div></div>, ev.clientX, ev.clientY);
  return (
    <div ref={ref} className="scroll-x">
      {w > 0 && (
        <svg width={Math.max(w, 640)} height={H} style={{ display: "block" }}>
          {d3.range(Math.ceil(lo), hi + 1).map(h => (
            <g key={h}>
              <line x1={x(h)} x2={x(h)} y1={top - 6} y2={H - 20} stroke="var(--line)" strokeDasharray={h % 3 ? "2 4" : undefined} />
              <text x={x(h)} y={H - 6} textAnchor="middle">{fmtHour(h)}</text>
            </g>
          ))}
          <path d={d3.area<[number, number, number]>().x(c => x(c[0])).y0(cy(0)).y1(c => cy(c[2])).curve(d3.curveStepAfter)(curve) || ""} fill="var(--ink)" opacity={0.08} />
          <path d={d3.area<[number, number, number]>().x(c => x(c[0])).y0(cy(0)).y1(c => cy(c[1])).curve(d3.curveStepAfter)(curve) || ""} fill="var(--focus)" opacity={0.5} />
          <text x={L - 10} y={cy(0) - 4} textAnchor="end">sessions at once</text>
          <text x={L - 10} y={cy(0) - 18} textAnchor="end" className="ink2">up to {d3.max(curve, c => c[1]) || 0} yours, {d3.max(curve, c => c[2]) || 0} in all</text>
          {heads.map(([p, y]) => <g key={p}><line x1={0} x2={Math.max(w, 640)} y1={y + 2} y2={y + 2} stroke="var(--line)" /><text x={0} y={y + 17} className="ink" style={{ fontWeight: 650, fontSize: 13 }}>{p}</text></g>)}
          {lanes.filter(l => l.kind === "lane").map(l => {
            const se = bySid.get(l.sid!), y = ys.get(l.sid!)! + laneH / 2;
            return (
              <g key={l.sid} onMouseMove={ev => se?.goal && tip.show(<div><b>{se.goal}</b>
                {se.outcome && <div className="m">{OUTCOME[se.outcome] ?? se.outcome}{se.rework ? ", with rework" : ""}</div>}
                {se.account && <div style={{ marginTop: 6 }}>{se.account}</div>}
                <div className="m" style={{ marginTop: 6 }}>A reading by a model, not checked.</div></div>, ev.clientX, ev.clientY)} onMouseLeave={() => tip.hide()}>
                {se?.outcome && <circle cx={4} cy={y} r={3.2} fill={OUTCOME_COLOR[se.outcome] ?? "var(--faint)"} />}
                <text x={12} y={y} dy="0.32em" style={{ fontSize: 11.5 }}>{(l.label || "").length > L / 6.4 ? (l.label || "").slice(0, Math.floor(L / 6.4)) + "…" : l.label}</text>
              </g>
            );
          })}
          {d.turns.map(t => {
            const y = ys.get(t.sid);
            if (y == null) return null;
            const x0 = x(t.at), x1 = Math.max(x0 + 2.5, x(t.to));
            const c = t.mine ? famColor(t.family) : "var(--faint)";
            return (
              <g key={t.id} style={{ cursor: t.mine ? "pointer" : "default" }} onMouseMove={ev => show(t, ev)} onMouseLeave={() => tip.hide()}
                onClick={() => t.mine && nav(`/messages/${encodeURIComponent(t.id)}`)}>
                <rect x={x0} y={y + 6} width={Math.max(4, x1 - x0)} height={laneH - 12} rx={3} fill={c} opacity={t.mine ? 0.55 : 0.45} />
                {t.mine && <circle cx={x0} cy={y + laneH / 2} r={4.5} fill={c} stroke="var(--surface)" strokeWidth={1.5} />}
                {t.commits > 0 && <path d={`M${x1 - 0.5},${y + 1} l4,4 l-4,4 l-4,-4 Z`} fill="var(--ink)" />}
                {t.stopped && <line x1={x1} x2={x1} y1={y + 3} y2={y + laneH - 3} stroke="var(--down)" strokeWidth={2} />}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function Mix({ d }: { d: DayDetail }) {
  const mine = d.turns.filter(t => t.mine && t.intent);
  const g = d3.rollups(mine, v => v.length, t => t.intent!).sort((a, b) => b[1] - a[1]);
  const max = g[0]?.[1] || 1;
  return (
    <div className="mix">
      {g.map(([k, n]) => {
        const fam = mine.find(t => t.intent === k)!.family;
        return <div key={k}><span>{INTENTS[k] || k}</span><i style={{ width: `${(100 * n) / max}%`, background: famColor(fam) }} /><b className="num">{n}</b></div>;
      })}
    </div>
  );
}

function Thread({ d }: { d: DayDetail }) {
  const [all, setAll] = useState(false);
  const mine = d.turns.filter(t => t.mine);
  const shown = all ? mine : mine.slice(0, 40);
  return (
    <section className="block">
      <header><div><h2 className="section">Your messages that day</h2><p className="sub" style={{ margin: 0 }}>In order. Click one to read it whole, with Claude's reply.</p></div></header>
      <ol className="thread">
        {shown.map(t => (
          <li key={t.id}>
            <span className="tt num">{fmtHour(t.at)}</span>
            <span className="dot" style={{ background: famColor(t.family) }} />
            <Link to={`/messages/${encodeURIComponent(t.id)}`} className="tx">{t.text || "(no text)"}</Link>
            <span className="tp muted">{t.project}</span>
          </li>
        ))}
      </ol>
      {mine.length > 40 && !all && <button className="pill" onClick={() => setAll(true)}>Show all {mine.length}</button>}
    </section>
  );
}
