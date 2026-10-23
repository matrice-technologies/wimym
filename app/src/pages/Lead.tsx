import * as d3 from "d3";
import Loading from "../components/Loading";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bars, WeekLines } from "../components/charts";
import Partial from "../components/Partial";
import { useTip } from "../components/Tip";
import { useData, useMessages } from "../lib/data";
import { FAMILIES, famColor, fmtDay, fmtK, fmtN, INTENTS } from "../lib/format";
import { useWidth } from "../lib/hooks";
import { SCOPE, SCOPE_ORDER, scopeColor, signals, whoColor } from "../lib/labels";
import type { Coverage, Family, Message, Week } from "../lib/types";

const verb = (f: Family) => FAMILIES.find(x => x.key === f)!.verb;
const FAM_OF: Record<string, Family> = { question: "ask", correct: "steer", build: "make", fix: "make", design: "make", "go-ahead": "approve", answer: "approve", ops: "run", setup: "run", ship: "ship", plan: "think", review: "think" };

export default function Lead() {
  const { core } = useData();
  const { messages } = useMessages();
  if (!core || !messages) return <Loading label="Reading how you lead" />;
  const P = messages.filter(m => m.kind === "prompt");
  const lab = P.filter(m => m.family);
  const fam = core.profile.families;
  const top = [...fam].sort((a, b) => b.share - a.share);
  const cov = signals(core);
  const sig = P.filter(m => m.who != null);
  const own = sig.length ? Math.round((100 * sig.filter(m => m.own).length) / sig.length) : null;
  return (
    <div className="wrap">
      <h1 className="title">How you lead</h1>
      <p className="lede">
        Your messages are mostly {verb(top[0].key)} ({Math.round(top[0].share)}%), then {verb(top[1].key)} ({Math.round(top[1].share)}%), then {verb(top[2].key)} ({Math.round(top[2].share)}%).
        {cov.covered && own != null ? ` ${own}% of your messages bring an idea of your own.` : ""}{" "}
        Here is how that mix moves, who makes the calls, how big your asks are, what you say after each kind of turn, and how much a message of yours sets in motion.
      </p>
      <Mix weeks={core.weeks} />
      <Calls weeks={core.weeks} msgs={sig} cov={cov} />
      <Scope weeks={core.weeks} msgs={sig} cov={cov} />
      <Grammar msgs={lab} />
      <Reach msgs={P} />
      <Autonomy msgs={P} weeks={core.weeks} />
      <Fleet weeks={core.weeks} msgs={P} />
    </div>
  );
}

function Mix({ weeks }: { weeks: Week[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const H = 320, m = { t: 10, r: 110, b: 26, l: 40 };
  const rows = weeks.filter(x => x.labelled >= 20);
  const keys = FAMILIES.map(f => f.key);
  const series = d3.stack<Week>().keys(keys).value((d, k) => (d.fam[k as Family] || 0) / Math.max(1, d.labelled)).offset(d3.stackOffsetExpand)(rows);
  const x = d3.scaleLinear().domain([0, rows.length - 1]).range([m.l, Math.max(m.l + 10, w - m.r)]);
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  const area = d3.area<d3.SeriesPoint<Week>>().x((_, i) => x(i)).y0(d => y(d[0])).y1(d => y(d[1])).curve(d3.curveMonotoneX);
  const last = rows.length - 1;
  return (
    <section className="block">
      <header><div><h2 className="section">Your mix, week by week</h2>
        <p className="sub" style={{ margin: 0 }}>Share of each family among your labelled messages. Weeks with fewer than 20 labelled messages are left out.</p></div></header>
      <div className="panel" ref={ref}>
        {w > 0 && (
          <svg width={w} height={H} style={{ display: "block" }}>
            {series.map(s => <path key={s.key} d={area(s) || ""} fill={famColor(s.key as Family)} opacity={0.88} stroke="var(--surface)" strokeWidth={1.5} />)}
            {[0, 0.25, 0.5, 0.75, 1].map(t => <text key={t} x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">{t * 100}%</text>)}
            {rows.map((r, i) => +r.week.slice(8) <= 7 && <text key={r.week} x={x(i)} y={H - 7} textAnchor="middle">{new Date(r.week + "T12:00").toLocaleDateString("en-GB", { month: "short" })}</text>)}
            {series.map(s => { const d = s[last]; const mid = (y(d[0]) + y(d[1])) / 2; return (y(d[0]) - y(d[1])) > 12 && <text key={s.key} x={x(last) + 10} y={mid} dy="0.32em" className="ink2">{FAMILIES.find(f => f.key === s.key)!.name} {Math.round((d[1] - d[0]) * 100)}%</text>; })}
            <rect x={m.l} y={m.t} width={Math.max(0, x(last) - m.l)} height={H - m.t - m.b} fill="transparent"
              onMouseMove={ev => {
                const r0 = (ev.target as SVGRectElement).getBoundingClientRect();
                const i = Math.max(0, Math.min(last, Math.round(x.invert(ev.clientX - r0.left + m.l))));
                const r = rows[i];
                tip.show(<div><b>Week of {new Date(r.week + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</b><div className="m">{fmtN(r.labelled)} labelled messages</div>
                  {[...keys].reverse().map(k => <div key={k}><span className="dot" style={{ background: famColor(k), marginRight: 7 }} />{FAMILIES.find(f => f.key === k)!.name}: <b>{Math.round((100 * (r.fam[k] || 0)) / r.labelled)}%</b></div>)}</div>, ev.clientX, ev.clientY);
              }} onMouseLeave={() => tip.hide()} />
          </svg>
        )}
      </div>
    </section>
  );
}

/** What you say after each kind of turn: rows are what came before, columns what you said next. */
function Grammar({ msgs }: { msgs: Message[] }) {
  const [mode, setMode] = useState<"after" | "next">("after");
  const nav = useNavigate();
  const tip = useTip();
  const rows = mode === "after"
    ? [
      { key: "answered", label: "Claude answered", test: (m: Message) => m.after === "answered" && !m.claudeAsked },
      { key: "asked", label: "Claude asked you something", test: (m: Message) => m.claudeAsked && m.after !== "stopped" },
      { key: "changed", label: "Claude changed files", test: (m: Message) => m.after === "changed" && !m.claudeAsked },
      { key: "shipped", label: "Claude committed or shipped", test: (m: Message) => m.after === "shipped" && !m.claudeAsked },
      { key: "stopped", label: "You stopped Claude", test: (m: Message) => m.after === "stopped" },
    ]
    : FAMILIES.map(f => ({ key: f.key, label: `After you ${f.name.toLowerCase()}`, test: (m: Message) => m.next != null && m.family === f.key }));
  const cell = (r: (typeof rows)[number], f: Family) => {
    const g = msgs.filter(r.test);
    const fam = (m: Message) => (mode === "after" ? m.family : FAM_OF[m.next!]);
    const k = g.filter(m => fam(m) === f).length;
    return { n: g.length, k, p: g.length ? k / g.length : 0 };
  };
  const base = Object.fromEntries(FAMILIES.map(f => [f.key, msgs.filter(m => m.family === f.key).length / msgs.length]));
  return (
    <section className="block">
      <header>
        <div><h2 className="section">The grammar of a conversation</h2>
          <p className="sub" style={{ margin: 0 }}>{mode === "after" ? "Read across: after each kind of turn from Claude, what share of your next messages fall in each family." : "Read across: after each kind of message of yours, what your next message in the same session asks for."} Bold cells are at least half again as common as usual.</p></div>
        <div className="seg"><button className={mode === "after" ? "on" : ""} onClick={() => setMode("after")}>After Claude's turn</button><button className={mode === "next" ? "on" : ""} onClick={() => setMode("next")}>After your message</button></div>
      </header>
      <div className="panel scroll-x">
        <table className="grammar">
          <thead><tr><th />{FAMILIES.map(f => <th key={f.key}><span className="dot" style={{ background: famColor(f.key) }} /> {f.name}</th>)}<th className="r">Messages</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const cs = FAMILIES.map(f => ({ f: f.key, ...cell(r, f.key) }));
              return (
                <tr key={r.key}>
                  <th>{r.label}</th>
                  {cs.map(c => {
                    const lift = base[c.f] ? c.p / base[c.f] : 0;
                    return (
                      <td key={c.f} style={{ background: `color-mix(in srgb, ${famColor(c.f)} ${Math.round(Math.min(1, c.p * 2.2) * 70)}%, var(--surface))` }}
                        className={lift >= 1.5 && c.k >= 10 ? "hot" : ""}
                        onMouseMove={ev => tip.show(<div><b>{r.label}</b><div>{FAMILIES.find(f => f.key === c.f)!.name}: {Math.round(c.p * 100)}% of your next messages ({verb(c.f)})</div><div className="m">{c.k} of {c.n}; usual share {Math.round(base[c.f] * 100)}%</div></div>, ev.clientX, ev.clientY)}
                        onMouseLeave={() => tip.hide()}>
                        {Math.round(c.p * 100)}%
                      </td>
                    );
                  })}
                  <td className="r muted">{fmtN(cs[0].n)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="sub" style={{ marginTop: 14 }}>
          <button className="link" onClick={() => nav("/messages?intent=correct")}>See your corrections</button> · <button className="link" onClick={() => nav("/messages?effect=stopped")}>the turns you stopped</button>
        </p>
      </div>
    </section>
  );
}

const wkOf = (m: Message) => d3.timeFormat("%Y-%m-%d")(d3.timeMonday.floor(new Date(m.day + "T12:00")));

/** Who decides: you, Claude, or nobody yet, among messages that decide something; and your own ideas. */
function Calls({ weeks, msgs, cov }: { weeks: Week[]; msgs: Message[]; cov: Coverage }) {
  const nav = useNavigate();
  const head = (
    <header><div><h2 className="section">Who makes the call</h2>
      <p className="sub" style={{ margin: 0 }}>Among your messages that decide something (plain questions, thanks and facts left out): the ones where you decide or instruct, the ones where you hand the decision itself to Claude, and the ones you leave open, thinking aloud. Beside it, the share of all your messages that bring an idea of your own. Weeks with fewer than 30 labelled messages are left out.</p></div></header>
  );
  if (!cov.covered) return <section className="block">{head}<Partial c={cov} what="Who makes the call and your own ideas" /></section>;
  const ds = msgs.filter(m => m.who !== "none");
  const share = (v: Message[], f: (m: Message) => boolean, need = 30) => (v.length >= need ? (100 * v.filter(f).length) / v.length : null);
  const gd = d3.group(ds, wkOf), ga = d3.group(msgs, wkOf);
  const ws = weeks.map(w => w.week);
  const handedTools = d3.median(msgs.filter(m => m.who === "claude"), m => m.tools) ?? 0;
  const youTools = d3.median(msgs.filter(m => m.who === "alex"), m => m.tools) ?? 0;
  const tot = (k: string) => Math.round((100 * ds.filter(m => m.who === k).length) / Math.max(1, ds.length));
  return (
    <section className="block">
      {head}
      <div className="vs" style={{ marginTop: 0, marginBottom: 16 }}>
        {(["alex", "claude", "open"] as const).map(k => (
          <button key={k} className="vsb" onClick={() => nav(`/messages?who=${k}`)}><span className="muted">{k === "alex" ? "You decide" : k === "claude" ? "You hand Claude the call" : "You leave it open"}</span><b className="num">{tot(k)}%</b><span className="muted">{fmtN(ds.filter(m => m.who === k).length)} messages</span></button>
        ))}
        <button className="vsb" onClick={() => nav("/messages?own=yes")}><span className="muted">Bring an idea of your own</span><b className="num">{Math.round((100 * msgs.filter(m => m.own).length) / Math.max(1, msgs.length))}%</b><span className="muted">of all your messages</span></button>
      </div>
      <div className="grid cols-2">
        <div className="panel"><h3>Who decides, week by week</h3>
          <WeekLines weeks={ws} unit="%" series={(["alex", "claude", "open"] as const).map(k => ({
            key: k, label: k === "alex" ? "You" : k === "claude" ? "Claude" : "Still open", color: whoColor(k),
            values: ws.map(w => share(gd.get(w) || [], m => m.who === k)),
          }))} /></div>
        <div className="panel"><h3>Ideas of your own</h3>
          <WeekLines weeks={ws} unit="%" series={[{ key: "own", label: "Of your messages", color: "var(--f-think)", values: ws.map(w => share(ga.get(w) || [], m => !!m.own)) }]} />
        </div>
      </div>
      <p className="sub" style={{ marginTop: 14 }}>
        When you hand Claude the call, it makes a median of {handedTools} tool calls before you speak again; when you decide, {youTools}.{" "}
        <Link className="link" to="/messages?who=claude">Read the messages where you hand it over</Link>
      </p>
    </section>
  );
}

/** How big your asks are, week by week, among messages that ask for work. */
function Scope({ weeks, msgs, cov }: { weeks: Week[]; msgs: Message[]; cov: Coverage }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const nav = useNavigate();
  const head = (
    <header><div><h2 className="section">How big your asks are</h2>
      <p className="sub" style={{ margin: 0 }}>Among your messages that ask for work (approvals, answers and questions left out), the share that asks for a tweak, a contained task, a multi-part project, or a call about the business itself. Weeks with fewer than 30 such messages are left out.</p></div></header>
  );
  if (!cov.covered) return <section className="block">{head}<Partial c={cov} what="Scope" /></section>;
  const keys = SCOPE_ORDER.filter(k => k !== "none");
  const work = msgs.filter(m => m.scope && m.scope !== "none");
  const g = d3.group(work, wkOf);
  const rows = weeks.map(x => ({ week: x.week, n: (g.get(x.week) || []).length, c: d3.rollup(g.get(x.week) || [], v => v.length, m => m.scope!) })).filter(r => r.n >= 30);
  const H = 260, m = { t: 10, r: 120, b: 26, l: 40 };
  const series = d3.stack<(typeof rows)[number]>().keys(keys).value((d, k) => (d.c.get(k) || 0) / d.n)(rows);
  const x = d3.scaleLinear().domain([0, Math.max(1, rows.length - 1)]).range([m.l, Math.max(m.l + 10, w - m.r)]);
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  const area = d3.area<d3.SeriesPoint<(typeof rows)[number]>>().x((_, i) => x(i)).y0(d => y(d[0])).y1(d => y(d[1])).curve(d3.curveMonotoneX);
  const last = rows.length - 1;
  const reach = keys.map(k => ({ k, med: d3.median(work.filter(m => m.scope === k), m => m.tools) ?? 0, n: work.filter(m => m.scope === k).length }));
  return (
    <section className="block">
      {head}
      <div className="grid cols-2">
        <div className="panel" ref={ref}><h3>Share of your asks, by size</h3>
          {rows.length < 2 && <div className="nodata" style={{ height: H }}>Not enough labelled messages in any week yet.</div>}
          {w > 0 && rows.length > 1 && (
            <svg width={w} height={H} style={{ display: "block" }}>
              {series.map(s => <path key={s.key} d={area(s) || ""} fill={scopeColor(s.key)} stroke="var(--surface)" strokeWidth={1.5} />)}
              {[0, 0.5, 1].map(t => <text key={t} x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">{t * 100}%</text>)}
              {rows.map((r, i) => +r.week.slice(8) <= 7 && <text key={r.week} x={x(i)} y={H - 7} textAnchor="middle">{new Date(r.week + "T12:00").toLocaleDateString("en-GB", { month: "short" })}</text>)}
              {series.map(s => { const d = s[last]; return y(d[0]) - y(d[1]) > 12 && <text key={s.key} x={x(last) + 10} y={(y(d[0]) + y(d[1])) / 2} dy="0.32em" className="ink2">{SCOPE[s.key]} {Math.round((d[1] - d[0]) * 100)}%</text>; })}
              <rect x={m.l} y={m.t} width={Math.max(0, x(last) - m.l)} height={H - m.t - m.b} fill="transparent"
                onMouseMove={ev => {
                  const r0 = (ev.target as SVGRectElement).getBoundingClientRect();
                  const r = rows[Math.max(0, Math.min(last, Math.round(x.invert(ev.clientX - r0.left + m.l))))];
                  tip.show(<div><b>Week of {fmtDay(r.week, { day: "numeric", month: "short" })}</b><div className="m">{fmtN(r.n)} asks for work</div>
                    {[...keys].reverse().map(k => <div key={k}><span className="dot" style={{ background: scopeColor(k), marginRight: 7 }} />{SCOPE[k]}: <b>{Math.round((100 * (r.c.get(k) || 0)) / r.n)}%</b></div>)}</div>, ev.clientX, ev.clientY);
                }} onMouseLeave={() => tip.hide()} />
            </svg>
          )}
        </div>
        <div className="panel"><h3>What each size sets off</h3>
          <p className="sub">Median tool calls Claude makes before your next message. If the label is sound, bigger asks should reach further.</p>
          <Bars rows={reach.map(r => ({ key: r.k, label: SCOPE[r.k], value: r.med, color: scopeColor(r.k), note: `· ${fmtN(r.n)}` }))} fmt={v => `${v} tools`} labelW={100}
            onClick={k => nav(`/messages?scope=${k}`)} />
        </div>
      </div>
    </section>
  );
}

function Reach({ msgs }: { msgs: Message[] }) {
  const byIntent = d3.rollups(msgs.filter(m => m.intent), v => ({ med: d3.median(v, m => m.tools) || 0, n: v.length, dur: d3.median(v, m => m.dur) || 0 }), m => m.intent!)
    .sort((a, b) => b[1].med - a[1].med);
  const bins = [0, 1, 3, 6, 11, 21, 51, 101, 201, 1e9];
  const names = ["0", "1–2", "3–5", "6–10", "11–20", "21–50", "51–100", "101–200", "200+"];
  const hist = names.map((n, i) => ({ n, k: msgs.filter(m => m.tools >= bins[i] && m.tools < bins[i + 1]).length }));
  const max = d3.max(hist, h => h.k) || 1;
  return (
    <section className="block">
      <header><div><h2 className="section">How far a message reaches</h2>
        <p className="sub" style={{ margin: 0 }}>Tool calls Claude makes before your next message. Most messages set off little; a few set off a lot.</p></div></header>
      <div className="grid cols-2">
        <div className="panel">
          <h3>Tool calls per message</h3>
          <div className="hist">
            {hist.map(h => <div key={h.n}><i style={{ height: `${(100 * h.k) / max}%` }} /><span className="num">{fmtK(h.k)}</span><em>{h.n}</em></div>)}
          </div>
        </div>
        <div className="panel">
          <h3>Median reach, by what you ask</h3>
          <Bars rows={byIntent.map(([k, v]) => ({ key: k, label: INTENTS[k] || k, value: v.med, color: famColor(FAM_OF[k]), note: `· ${fmtN(v.n)}` }))} fmt={v => `${v} tools`} labelW={130} />
        </div>
      </div>
    </section>
  );
}

function Autonomy({ msgs, weeks }: { msgs: Message[]; weeks: Week[] }) {
  const wk = (m: Message) => d3.timeFormat("%Y-%m-%d")(d3.timeMonday.floor(new Date(m.day + "T12:00")));
  const g = d3.group(msgs, wk);
  // permission decisions are only in transcripts since early October: start where they do
  const first = weeks.findIndex(w => (g.get(w.week) || []).some(m => m.asked || m.auto || m.blocked));
  const ws = first >= 0 ? weeks.slice(first) : [];
  const per = (f: (m: Message) => number) => ws.map(w => { const v = g.get(w.week) || []; return v.length >= 30 ? (100 * d3.sum(v, f)) / v.length : null; });
  const tot = (f: (m: Message) => number) => d3.sum(msgs, f);
  if (!ws.length) return null;
  return (
    <section className="block">
      <header><div><h2 className="section">How much you let Claude do alone</h2>
        <p className="sub" style={{ margin: 0 }}>Per 100 messages of yours: the times Claude stopped to ask your permission, the actions it took without asking (auto mode and your rules), and the ones blocked before they ran. Transcripts record this since the week of {fmtDay(ws[0].week, { day: "numeric", month: "long" })}.</p></div></header>
      <div className="vs" style={{ marginTop: 0, marginBottom: 16 }}>
        <div><span className="muted">Approved without you</span><b className="num">{fmtN(tot(m => m.auto))}</b><span className="muted">actions</span></div>
        <div><span className="muted">Asked your permission</span><b className="num">{fmtN(tot(m => m.asked))}</b><span className="muted">times</span></div>
        <div><span className="muted">Blocked before running</span><b className="num">{fmtN(tot(m => m.blocked))}</b><span className="muted">actions</span></div>
        <div><span className="muted">You said no</span><b className="num">{fmtN(tot(m => m.denied))}</b><span className="muted">times</span></div>
      </div>
      <div className="grid cols-2">
        <div className="panel"><h3>Taken without asking</h3>
          <WeekLines weeks={ws.map(w => w.week)} series={[{ key: "auto", label: "Per 100 messages", color: "var(--f-make)", values: per(m => m.auto) }]} /></div>
        <div className="panel"><h3>Asked or blocked</h3>
          <WeekLines weeks={ws.map(w => w.week)} series={[
            { key: "asked", label: "Asked you", color: "var(--f-steer)", values: per(m => m.asked) },
            { key: "blocked", label: "Blocked", color: "var(--f-run)", values: per(m => m.blocked) },
          ]} /></div>
      </div>
    </section>
  );
}

function Fleet({ weeks, msgs }: { weeks: Week[]; msgs: Message[] }) {
  const wk = (m: Message) => d3.timeFormat("%Y-%m-%d")(d3.timeMonday.floor(new Date(m.day + "T12:00")));
  const g = d3.group(msgs, wk);
  return (
    <section className="block">
      <header><div><h2 className="section">Your fleet</h2>
        <p className="sub" style={{ margin: 0 }}>How many of your sessions run side by side on a typical day that week, the most at any moment, and the helpers Claude starts: subagents inside a session, and new sessions it opens for you.</p></div></header>
      <div className="grid cols-2">
        <div className="panel"><h3>Sessions at once</h3>
          <WeekLines weeks={weeks.map(w => w.week)} series={[
            { key: "avg", label: "Typical day", color: "var(--f-ask)", values: weeks.map(w => w.avgAt) },
            { key: "peak", label: "Most at once", color: "var(--ink-2)", values: weeks.map(w => w.peak || null) },
          ]} /></div>
        <div className="panel"><h3>Helpers Claude starts</h3>
          <WeekLines weeks={weeks.map(w => w.week)} series={[
            { key: "agents", label: "Subagents", color: "var(--f-think)", values: weeks.map(w => d3.sum(g.get(w.week) || [], m => m.agents)) },
            { key: "spawn", label: "New sessions", color: "var(--f-ship)", values: weeks.map(w => d3.sum(g.get(w.week) || [], m => m.spawn)) },
          ]} /></div>
      </div>
    </section>
  );
}
