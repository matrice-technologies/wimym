import * as d3 from "d3";
import Loading from "../components/Loading";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Rings from "../components/Rings";
import Spark from "../components/Spark";
import Strata from "../components/Strata";
import { useData, useMessages } from "../lib/data";
import { FAMILIES, famColor, fmtDay, fmtDur, fmtHour, fmtK, fmtN } from "../lib/format";
import type { Day, Family, Profile, Trait } from "../lib/types";

const GROUPS: [Trait["group"], string, string][] = [
  ["lead", "How you lead", "What a message of yours asks for, whose idea it is, who decides, and how much it sets in motion."],
  ["attention", "Where your attention goes", "Sessions, projects and how often you jump between them."],
  ["rhythm", "Your rhythm", "When your days start and end, and how many in a row."],
  ["voice", "How you talk", "Length, language, tone, annoyance and how fast you answer."],
  ["output", "What comes out", "Commits and the hours Claude works for you."],
];

function value(t: Trait, v: number | null = t.value) {
  if (v == null) return "—";
  if (t.unit === "%") return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
  if (t.unit === "seconds") return v >= 90 && v < 600 ? `${(v / 60).toFixed(1)} min` : fmtDur(v);
  if (t.unit === "hours") return `${v} h`;
  return d3.format("~g")(+v.toFixed(2));
}
const unitWord = (t: Trait) => (t.unit === "%" || t.unit === "seconds" || t.unit === "hours" ? "" : t.unit);

const numWord = (n: number) => (["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty", "Twenty-one", "Twenty-two"][n] || String(n));

/** Plain clauses that sum you up, from the traits. */
function portraitLine(p: Profile) {
  const T = Object.fromEntries(p.traits.map(t => [t.key, t]));
  const fam = Object.fromEntries(p.families.map(f => [f.key, f.share]));
  const bits: string[] = [];
  const par = T.parallel?.value ?? 1;
  bits.push(par >= 1.3 ? "You keep several agents running at once" : "You work with one agent at a time");
  const orders = (fam.make || 0) + (fam.ship || 0) + (fam.run || 0);
  bits.push((fam.ask || 0) > orders ? "ask more than you order" : "give more orders than you ask");
  // from the second label set, once it covers your messages: how often the idea is yours
  const own = T.own?.value;
  if (own != null && own >= 8) {
    const n = Math.round(100 / own);
    const words = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    bits.push(`bring an idea of your own to about one message in ${words[n] || n}`);
  }
  const cpd = T.ship?.value ?? 0;
  bits.push(cpd >= 8 ? `ship ${Math.round(cpd)} commits on a typical day` : `talk in ${T.brevity?.value ?? "?"}-word bursts`);
  return `${bits.slice(0, -1).join(", ")}, and ${bits[bits.length - 1]}.`;
}

export default function Portrait() {
  const { core } = useData();
  const { messages } = useMessages();
  const [focus, setFocus] = useState<Family | null>(null);
  const [hover, setHover] = useState<Day | null>(null);
  if (!core || !messages) return <Loading label="Drawing your portrait" />;
  const p = core.profile, t = p.totals;
  return (
    <div className="wrap">
      <Hero p={p} t={t} focus={focus} setFocus={setFocus} hover={hover}>
        <Rings messages={messages.filter(m => m.kind === "prompt")} days={core.days} focus={focus} onHover={setHover} />
      </Hero>
      <section className="block">
        <header><div><h2 className="section">Who you are with agents</h2>
          <p className="sub" style={{ margin: 0 }}>{numWord(p.traits.length)} measures, each against your own weeks: the line is week by week since {fmtDay(p.since, { day: "numeric", month: "short" })}, the shaded part is the last four weeks.</p></div></header>
        <div className="sheet">
          {GROUPS.map(([g, title, sub]) => (
            <div className="sheet-group" key={g}>
              <div className="sg-head"><h3>{title}</h3><p>{sub}</p></div>
              <div className="sg-rows">{p.traits.filter(x => x.group === g).map(x => <TraitRow key={x.key} t={x} from={p.recentFrom} />)}</div>
            </div>
          ))}
        </div>
      </section>
      <Shift p={p} />
      <section className="block">
        <header><div><h2 className="section">The projects of your weeks</h2>
          <p className="sub" style={{ margin: 0 }}>Your messages each week, layered by project. Hover a layer to follow one project.</p></div></header>
        <div className="panel"><Strata projects={core.projects} weeks={core.weeks.map(w => w.week)} eras={p.eras} /></div>
      </section>
      <Moments p={p} />
    </div>
  );
}

function Hero({ p, t, focus, setFocus, hover, children }: { p: Profile; t: Record<string, number>; focus: Family | null; setFocus: (f: Family | null) => void; hover: Day | null; children: React.ReactNode }) {
  const line = useMemo(() => portraitLine(p), [p]);
  return (
    <section className="hero">
      <div className="hero-text">
        <p className="kicker">{fmtDay(p.since, { day: "numeric", month: "long" })} to {fmtDay(p.until, { day: "numeric", month: "long" })}: {t.days} days with Claude</p>
        <h1 className="title">{line}</h1>
        <p className="lede">
          {fmtN(t.messages)} messages across {t.projects} projects. Claude worked {fmtN(t.claudeH)} hours for you, ran {fmtK(t.tools)} tool calls and made {fmtN(t.commits)} commits.
        </p>
        <div className="fams" role="group" aria-label="Highlight one kind of message">
          {FAMILIES.map(f => {
            const s = p.families.find(x => x.key === f.key)!;
            return (
              <button key={f.key} className={"fam" + (focus === f.key ? " on" : "") + (focus && focus !== f.key ? " off" : "")}
                onClick={() => setFocus(focus === f.key ? null : f.key)}>
                <span className="dot" style={{ background: famColor(f.key) }} />
                <span className="fn">{f.name}</span>
                <span className="fv num">{Math.round(s.share)}%</span>
                <span className="fd">{f.verb}</span>
              </button>
            );
          })}
        </div>
        <p className="how">
          {hover ? <HoverDay d={hover} /> : <>Each ring is a day, from {fmtDay(p.since, { day: "numeric", month: "short" })} in the centre to today at the edge, with noon at the top. Dots are your messages; the trail after each is Claude working on it. Click a ring to open that day.</>}
        </p>
      </div>
      <div className="hero-art">{children}</div>
    </section>
  );
}

function HoverDay({ d }: { d: Day }) {
  if (!d.n) return <><b>{fmtDay(d.day, { weekday: "long", day: "numeric", month: "long" })}</b>: a day off.</>;
  return <><b>{fmtDay(d.day, { weekday: "long", day: "numeric", month: "long" })}</b>: {fmtN(d.n)} messages from {fmtHour(d.start)} to {fmtHour(d.end)}, {d.projects} projects, {d.commits} commits{d.peak ? `, up to ${d.peak} sessions at once` : ""}.</>;
}

function TraitRow({ t, from }: { t: Trait; from: string }) {
  // a move smaller than a tenth (and, for shares, than a point) reads as steady
  const showDelta = t.recent != null && t.before != null &&
    Math.abs(t.recent - t.before) >= 0.1 * Math.max(Math.abs(t.before), 1e-9) && (t.unit !== "%" || Math.abs(t.recent - t.before) >= 1);
  const up = showDelta && (t.recent as number) > (t.before as number);
  return (
    <article className="trait">
      <div className="tl"><div className="tn">{t.name}</div><div className="tv"><span className="big">{value(t)}</span> <span className="muted">{unitWord(t)}</span></div></div>
      <p className="ts">{t.sentence}</p>
      <div className="tsp"><Spark series={t.series} from={from} width={240} height={40} /></div>
      <div className="td">{showDelta ? <><b>{up ? "↑" : "↓"} {value(t, t.recent)}</b><br /><span className="muted">lately, from {value(t, t.before)}</span></> : <span className="muted">steady</span>}</div>
    </article>
  );
}

function Shift({ p }: { p: Profile }) {
  const rows = [...p.families].sort((a, b) => b.share - a.share);
  const max = Math.max(...rows.flatMap(r => [r.recent || 0, r.before || 0])) * 1.08;
  const W = 640, rowH = 34, L = 92, Rr = 70;
  const x = d3.scaleLinear().domain([0, max]).range([L, W - Rr]);
  const moved = [...rows].sort((a, b) => Math.abs(b.recent - b.before) - Math.abs(a.recent - a.before))[0];
  return (
    <section className="block">
      <header><div><h2 className="section">What changed in the last four weeks</h2>
        <p className="sub" style={{ margin: 0 }}>Share of your messages in each family, before {fmtDay(p.recentFrom, { day: "numeric", month: "short" })} (hollow) and since (filled). The biggest move: {moved.name.toLowerCase()}, {moved.before?.toFixed(1)}% → {moved.recent?.toFixed(1)}%.</p></div></header>
      <div className="panel scroll-x">
        <svg viewBox={`0 0 ${W} ${rows.length * rowH + 26}`} style={{ width: "100%", minWidth: 520, maxWidth: 860, display: "block" }}>
          {x.ticks(5).map(v => <g key={v}><line x1={x(v)} x2={x(v)} y1={4} y2={rows.length * rowH + 4} stroke="var(--line)" /><text x={x(v)} y={rows.length * rowH + 20} textAnchor="middle">{v}%</text></g>)}
          {rows.map((r, i) => {
            const y = 4 + i * rowH + rowH / 2, a = x(r.before || 0), b = x(r.recent || 0);
            return (
              <g key={r.key}>
                <text x={0} y={y} dy="0.32em" className="ink" style={{ fontSize: 13 }}>{r.name}</text>
                <line x1={a} x2={b} y1={y} y2={y} stroke={famColor(r.key)} strokeWidth={3} opacity={0.45} strokeLinecap="round" />
                <circle cx={a} cy={y} r={5.5} fill="var(--surface)" stroke={famColor(r.key)} strokeWidth={2} />
                <circle cx={b} cy={y} r={6} fill={famColor(r.key)} stroke="var(--surface)" strokeWidth={2} />
                <text x={Math.max(a, b) + 12} y={y} dy="0.32em" className="ink2 num">{(r.recent || 0).toFixed(1)}%{Math.abs(r.recent - r.before) >= 0.5 ? ` (${r.recent > r.before ? "+" : "−"}${Math.abs(r.recent - r.before).toFixed(1)})` : ""}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function Moments({ p }: { p: Profile }) {
  return (
    <section className="block">
      <header><div><h2 className="section">Moments</h2><p className="sub" style={{ margin: 0 }}>Firsts and records, in order.</p></div></header>
      <ol className="moments">
        {p.firsts.filter(f => !(f.key === "auto" && f.day === p.since)).map(f => (
          <li key={f.key}>
            <span className="md num">{fmtDay(f.day, { day: "numeric", month: "short" })}</span>
            <span className="ml">{f.label}{f.value ? <span className="muted">: {f.value}</span> : null}</span>
            <span className="mx">
              <Link className="link" to={`/days/${f.day}`}>See the day</Link>
              {f.id && <> · <Link className="link" to={`/messages/${encodeURIComponent(f.id)}`}>the message</Link></>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
