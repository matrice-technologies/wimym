import * as d3 from "d3";
import Loading from "../components/Loading";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CheckIn from "../components/CheckIn";
import { BandLines, wilson } from "../components/charts";
import WhenChart from "../components/WhenChart";
import { useTip } from "../components/Tip";
import { useData, useVitals, useMessages } from "../lib/data";
import { FAMILIES, famColor, fmtDay, fmtHour, fmtN } from "../lib/format";
import type { Day, Family, Message } from "../lib/types";

const METRICS: { key: string; label: string; get: (d: Day) => number | null | undefined; fmt: (v: number) => string; steer?: boolean }[] = [
  { key: "n", label: "Messages", get: d => d.n || null, fmt: v => fmtN(v) },
  { key: "span", label: "Day length", get: d => d.span, fmt: v => v.toFixed(1) + " h" },
  { key: "end", label: "Last message", get: d => d.end, fmt: v => fmtHour(v) },
  { key: "projects", label: "Projects", get: d => d.projects, fmt: v => String(v) },
  { key: "avgAt", label: "Sessions at once", get: d => d.avgAt, fmt: v => v.toFixed(1) },
  { key: "commits", label: "Commits", get: d => d.commits, fmt: v => String(v) },
  { key: "frustrated", label: "Sounds frustrated", get: d => d.frustrated, fmt: v => v.toFixed(0) + "%" },
  { key: "own", label: "Your own ideas", get: d => d.own, fmt: v => v.toFixed(0) + "%", steer: true },
  { key: "mood", label: "Your mood", get: d => d.check?.mood, fmt: v => v + " of 5" },
];

const today = () => d3.timeFormat("%Y-%m-%d")(new Date(Date.now() - 5 * 3600e3));

export default function Days() {
  const { core } = useData();
  const { messages } = useMessages();
  const vitals = useVitals();
  const stopHour = vitals && vitals !== "absent" ? vitals.limits.stopHour : null;
  const [metric, setMetric] = useState("n");
  const [focus, setFocus] = useState<Family | null>(null);
  if (!core || !messages) return <Loading label="Laying out your days" />;
  const days = core.days, on = days.filter(d => d.n);
  const t = today();
  const row = days.find(d => d.day === t);
  const prompts = messages.filter(m => m.kind === "prompt");
  const med = (f: (d: Day) => number | undefined | null) => d3.median(on, d => f(d) ?? undefined);
  return (
    <div className="wrap">
      <h1 className="title">Your days</h1>
      <p className="lede">
        {on.length} days with Claude out of {days.length}. A typical one starts around {fmtHour(med(d => d.start))}, ends around {fmtHour(med(d => d.end))}, and holds {fmtN(med(d => d.n) || 0)} messages. A day runs from 05:00 to 05:00, so a late night counts with the evening before.
      </p>

      <section className="block" style={{ marginTop: 36 }}>
        <div className="panel today">
          <div>
            <h2 className="section">How was today?</h2>
            <p className="sub">Three taps, kept on this Mac. After a few weeks your answers can be held up against what your messages show.</p>
            {row?.n ? <p className="sub" style={{ color: "var(--ink-2)" }}>So far today: {fmtN(row.n)} messages since {fmtHour(row.start)}, {row.projects} projects, {row.commits} commits. <Link className="link" to={`/days/${t}`}>Open today</Link></p> : null}
          </div>
          <CheckIn key={t} day={t} check={row?.check} />
        </div>
      </section>

      <section className="block">
        <header>
          <div><h2 className="section">When you work</h2>
            <p className="sub" style={{ margin: 0 }}>Each column is a day; the grey band runs from your first message to your last, the dots are your messages, coloured by what they ask for. Click a day to open it.</p></div>
          <div className="seg">{[null, ...FAMILIES.map(f => f.key)].map(k => (
            <button key={k || "all"} className={focus === k ? "on" : ""} onClick={() => setFocus(k as Family | null)}>
              {k ? <><span className="dot" style={{ background: famColor(k as Family), marginRight: 6 }} />{FAMILIES.find(f => f.key === k)!.name}</> : "All"}
            </button>))}
          </div>
        </header>
        <div className="panel"><WhenChart messages={prompts} days={days} focus={focus} stopHour={stopHour} /></div>
      </section>

      <section className="block">
        <header>
          <div><h2 className="section">Calendar</h2><p className="sub" style={{ margin: 0 }}>Shaded by the measure you pick, against your own range. The strip at the foot of each day is its mix of messages.</p></div>
          <div className="seg">{METRICS.filter(mt => !mt.steer || core.profile.coverage?.signals.covered).map(mt => <button key={mt.key} className={metric === mt.key ? "on" : ""} onClick={() => setMetric(mt.key)}>{mt.label}</button>)}</div>
        </header>
        <Calendar days={days} metric={METRICS.find(x => x.key === metric)!} />
      </section>

      <Wear messages={prompts} steer={!!core.profile.coverage?.signals.covered} />
      <Retro days={days} />
    </div>
  );
}

function Calendar({ days, metric }: { days: Day[]; metric: (typeof METRICS)[number] }) {
  const nav = useNavigate();
  const tip = useTip();
  const vals = days.map(metric.get).filter((v): v is number => v != null);
  const [lo, hi] = d3.extent(vals) as [number, number];
  const norm = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  // weeks starting Monday
  const first = new Date(days[0].day + "T12:00");
  const pad = (first.getDay() + 6) % 7;
  const cells: (Day | null)[] = [...Array(pad).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = d3.range(cells.length / 7).map(i => cells.slice(i * 7, i * 7 + 7));
  return (
    <div className="cal scroll-x">
      <div className="cal-head">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <span key={d}>{d}</span>)}</div>
      {weeks.map((wk, i) => (
        <div className="cal-week" key={i}>
          {wk.map((d, j) => {
            if (!d) return <span key={j} className="cal-cell empty" />;
            const v = metric.get(d);
            const fam = d.fam || {};
            const tot = d3.sum(Object.values(fam) as number[]);
            const first = d.day.endsWith("-01") || (i === 0 && j === pad);
            return (
              <button key={j} className={"cal-cell" + (d.n ? "" : " off")} onClick={() => nav(`/days/${d.day}`)}
                style={{ background: v != null ? `color-mix(in srgb, var(--focus) ${Math.round(8 + 62 * norm(v))}%, var(--surface))` : undefined }}
                onMouseMove={ev => tip.show(<div><b>{fmtDay(d.day, { weekday: "long", day: "numeric", month: "long" })}</b><div className="m">{metric.label}: {v == null ? "—" : metric.fmt(v)}</div>{d.check?.note && <div>“{d.check.note}”</div>}</div>, ev.clientX, ev.clientY)}
                onMouseLeave={() => tip.hide()}>
                <span className="cd">{first ? fmtDay(d.day, { day: "numeric", month: "short" }) : +d.day.slice(8)}</span>
                <span className="cv num">{v == null ? "" : metric.fmt(v)}</span>
                {tot > 0 && <span className="cf">{FAMILIES.map(f => fam[f.key] ? <i key={f.key} style={{ flex: fam[f.key], background: famColor(f.key) }} /> : null)}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type WearSeries = { label: string; said: string; color: string; test: (m: Message) => boolean; steer?: boolean };
const WEAR: Record<string, { name: string; series: WearSeries[] }> = {
  steer: { name: "How you steer", series: [
    { label: "Bare go-aheads", said: "bare go-aheads", color: "var(--f-approve)", test: m => m.intent === "go-ahead" },
    { label: "Corrections", said: "corrections", color: "var(--f-steer)", test: m => m.intent === "correct" },
  ] },
  sound: { name: "How you sound", series: [
    { label: "Sound frustrated", said: "messages that sound frustrated", color: "var(--f-run)", test: m => m.tone === "frustrated" },
    { label: "Annoyed at Claude", said: "messages annoyed at Claude", color: "var(--f-steer)", test: m => m.irk === "claude", steer: true },
  ] },
  ideas: { name: "Whose call", series: [
    { label: "Ideas of your own", said: "ideas of your own", color: "var(--f-think)", test: m => !!m.own, steer: true },
    { label: "Claude makes the call", said: "calls left to Claude", color: "var(--f-ask)", test: m => m.who === "claude", steer: true },
  ] },
};

/** How your messages change as the day wears on: from the hours since your first message. */
function Wear({ messages, steer }: { messages: Message[]; steer: boolean }) {
  const [axis, setAxis] = useState<"into" | "clock">("into");
  const [view, setView] = useState<keyof typeof WEAR>("steer");
  const series = useMemo(() => {
    const firstOf = new Map<string, number>();
    for (const m of messages) if (!firstOf.has(m.day) || m.hour < firstOf.get(m.day)!) firstOf.set(m.day, m.hour);
    const bins = axis === "into"
      ? [[0, 2, "0–2 h"], [2, 4, "2–4 h"], [4, 6, "4–6 h"], [6, 8, "6–8 h"], [8, 10, "8–10 h"], [10, 12, "10–12 h"], [12, 99, "12 h+"]] as const
      : [[5, 10, "before 10"], [10, 12, "10–12"], [12, 14, "12–14"], [14, 16, "14–16"], [16, 18, "16–18"], [18, 20, "18–20"], [20, 22, "20–22"], [22, 24, "22–24"], [24, 30, "after 24"]] as const;
    const key = (m: Message) => (axis === "into" ? m.hour - firstOf.get(m.day)! : m.hour);
    return WEAR[view].series.filter(x => steer || !x.steer).map(x => {
      const lab = messages.filter(m => (x.steer ? m.who != null : m.intent) && !m.first);
      return {
        key: x.label, label: x.label, said: x.said, color: x.color,
        points: bins.map(([a, b, name]) => {
          const g = lab.filter(m => key(m) >= a && key(m) < b);
          const k = g.filter(x.test).length, ci = wilson(k, g.length);
          return { x: name, v: g.length >= 30 ? (100 * k) / g.length : null, lo: g.length >= 30 ? ci?.[0] : null, hi: g.length >= 30 ? ci?.[1] : null, n: g.length };
        }),
      };
    });
  }, [messages, axis, view, steer]);
  // what moves: a series moves when its highest and lowest stretches' ranges don't overlap
  const said = series.map(s => {
    const pts = s.points.filter(p => p.v != null && p.lo != null);
    if (pts.length < 2) return null;
    const lo = pts.reduce((a, b) => (b.v! < a.v! ? b : a)), hi = pts.reduce((a, b) => (b.v! > a.v! ? b : a));
    const moves = hi.lo! > lo.hi!;
    return moves ? `${s.said} run from ${lo.v!.toFixed(1)}% (${lo.x}) to ${hi.v!.toFixed(1)}% (${hi.x})` : `${s.said} stay around ${((lo.v! + hi.v!) / 2).toFixed(0)}%`;
  }).filter(Boolean);
  return (
    <section className="block">
      <header>
        <div><h2 className="section">As the day wears on</h2>
          <p className="sub" style={{ margin: 0 }}>Share of your messages, with the range where the true share likely sits: where two ranges overlap, the difference may be chance. A session's first message is left out, since there's nothing yet to correct.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="seg">{Object.entries(WEAR).filter(([k]) => steer || k === "steer" || k === "sound").map(([k, v]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{v.name}</button>)}</div>
          <div className="seg"><button className={axis === "into" ? "on" : ""} onClick={() => setAxis("into")}>Hours into your day</button><button className={axis === "clock" ? "on" : ""} onClick={() => setAxis("clock")}>Time of day</button></div>
        </div>
      </header>
      <div className="panel">
        <BandLines series={series} note={x => `${fmtN(series[0]?.points.find(p => p.x === x)?.n || 0)} messages`} />
        {said.length > 0 && <p className="sub" style={{ margin: "12px 0 0" }}>{said.join("; ").replace(/^./, c => c.toUpperCase())}.</p>}
      </div>
    </section>
  );
}

function Retro({ days }: { days: Day[] }) {
  const recent = days.slice(-15, -1).reverse();
  const rated = recent.filter(d => d.check && (d.check.energy || d.check.mood || d.check.focus)).length;
  return (
    <section className="block">
      <header><div><h2 className="section">The last two weeks, from memory</h2>
        <p className="sub" style={{ margin: 0 }}>{rated} of 14 rated. Memory of a day fades, so these count as rated afterwards; the numbers beside each day are there to jog it.</p></div></header>
      <div className="panel scroll-x">
        <table className="t retro">
          <thead><tr><th>Day</th><th className="r">Messages</th><th className="r">Hours</th><th className="r">Projects</th><th>Energy, mood, focus</th></tr></thead>
          <tbody>
            {recent.map(d => (
              <tr key={d.day}>
                <td><Link className="link" to={`/days/${d.day}`}>{fmtDay(d.day)}</Link></td>
                <td className="r">{d.n || "off"}</td><td className="r">{d.span != null ? d.span.toFixed(1) : ""}</td><td className="r">{d.projects ?? ""}</td>
                <td><CheckIn key={d.day} day={d.day} check={d.check} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
