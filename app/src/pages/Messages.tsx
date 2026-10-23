import * as d3 from "d3";
import Loading from "../components/Loading";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Partial from "../components/Partial";
import { useData, useMessageDetail, useMessages } from "../lib/data";
import { IRK, SCOPE, SCOPE_ORDER, WHO, WHO_ORDER } from "../lib/labels";
import { FAMILIES, famColor, famName, fmtDay, fmtDur, fmtHour, fmtK, fmtN, INTENTS, plural } from "../lib/format";
import type { Family, Message } from "../lib/types";

type Facet = { key: string; label: string; get: (m: Message) => string | null; name?: (v: string) => string; order?: string[]; steer?: boolean };
const yn = (b: boolean | null) => (b == null ? null : b ? "yes" : "no");
const YN = (v: string) => (v === "yes" ? "Yes" : "No");
const FACETS: Facet[] = [
  { key: "intent", label: "What it asks for", get: m => m.intent, name: v => INTENTS[v] || v,
    order: FAMILIES.flatMap(f => Object.keys(INTENTS).filter(i => familyOf(i) === f.key)) },
  { key: "tone", label: "Tone", get: m => m.tone, name: v => ({ neutral: "Neutral", pleased: "Pleased", frustrated: "Frustrated" }[v] || v), order: ["frustrated", "pleased", "neutral"] },
  { key: "specific", label: "Says what done looks like", get: m => yn(m.specific), name: YN, order: ["yes", "no"] },
  { key: "own", label: "Your own idea", get: m => yn(m.own), name: YN, order: ["yes", "no"], steer: true },
  { key: "who", label: "Who makes the call", get: m => m.who, name: v => WHO[v] || v, order: WHO_ORDER, steer: true },
  { key: "scope", label: "Scope", get: m => m.scope, name: v => SCOPE[v] || v, order: SCOPE_ORDER, steer: true },
  { key: "irk", label: "Annoyed at", get: m => m.irk, name: v => IRK[v] || v, order: ["claude", "other", "none"], steer: true },
  { key: "pressure", label: "Under pressure", get: m => yn(m.pressure), name: YN, order: ["yes", "no"], steer: true },
  { key: "play", label: "Playful", get: m => yn(m.play), name: YN, order: ["yes", "no"], steer: true },
  { key: "effect", label: "What it set off", get: m => (m.stopped ? "stopped" : m.commits || m.pushes || m.prs ? "shipped" : m.files ? "changed" : "answered"),
    name: v => ({ stopped: "You stopped it", shipped: "Committed or shipped", changed: "Changed files", answered: "Answered only" }[v] || v), order: ["answered", "changed", "shipped", "stopped"] },
  { key: "project", label: "Project", get: m => m.project },
  { key: "src", label: "Where you typed", get: m => m.src, name: v => (v === "desk" ? "At the Mac" : "Through Massistant") },
  { key: "lang", label: "Language", get: m => m.lang, name: v => (v === "fr" ? "French" : "English") },
  { key: "model", label: "Model", get: m => (m.model && m.model.startsWith("claude-") ? m.model : null), name: modelName },
  { key: "effort", label: "Effort", get: m => m.effort, name: v => v[0].toUpperCase() + v.slice(1), order: ["low", "medium", "high", "xhigh", "max"] },
];
// claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5
function modelName(id: string): string {
  const [fam, ...ver] = id.replace(/^claude-/, "").replace(/-\d{8}$/, "").split("-");
  return `${fam[0].toUpperCase()}${fam.slice(1)} ${ver.join(".")}`.trim();
}
function familyOf(intent: string): Family | null {
  const map: Record<string, Family> = { question: "ask", correct: "steer", build: "make", fix: "make", design: "make", "go-ahead": "approve", answer: "approve", ops: "run", setup: "run", ship: "ship", plan: "think", review: "think" };
  return map[intent] || null;
}

const SORTS: Record<string, [string, (a: Message, b: Message) => number]> = {
  new: ["Newest", (a, b) => (a.ts < b.ts ? 1 : -1)],
  old: ["Oldest", (a, b) => (a.ts > b.ts ? 1 : -1)],
  work: ["Most work", (a, b) => b.tools - a.tools],
  long: ["Longest", (a, b) => b.words - a.words],
  time: ["Slowest", (a, b) => b.dur - a.dur],
};

export default function Messages() {
  const { core } = useData();
  const { messages } = useMessages();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [sel, setSel] = useState<Record<string, Set<string>>>(() => {
    const o: Record<string, Set<string>> = {};
    for (const f of FACETS) { const v = params.get(f.key); if (v) o[f.key] = new Set(v.split(",")); }
    return o;
  });
  const [sort, setSort] = useState("new");
  const [showF, setShowF] = useState(false);  // phones: the filters fold away
  // a message opens at /messages/<id> (the CLI and the skills link there); ?id= still works
  const nav = useNavigate();
  const id = useParams().id ?? params.get("id");

  const all = useMemo(() => (messages || []).filter(m => m.kind === "prompt" || m.kind === "shell" || m.kind === "command"), [messages]);
  const ql = q.trim().toLowerCase();
  const pass = (m: Message, skip?: string) => {
    if (ql && !(m.text.toLowerCase().includes(ql) || m.project.toLowerCase().includes(ql))) return false;
    for (const f of FACETS) {
      if (f.key === skip) continue;
      const s = sel[f.key];
      if (s && s.size && !s.has(f.get(m) ?? "")) return false;
    }
    return true;
  };
  const rows = useMemo(() => all.filter(m => pass(m)).sort(SORTS[sort][1]), [all, ql, sel, sort]);
  // keep the URL in step, so a filtered view can be linked
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    for (const [k, s] of Object.entries(sel)) if (s.size) p.set(k, [...s].join(","));
    setParams(p, { replace: true });
  }, [q, sel]);

  const toggle = (k: string, v: string) => setSel(s => {
    const n = new Set(s[k] || []);
    if (n.has(v)) n.delete(v); else n.add(v);
    return { ...s, [k]: n };
  });
  const open = (mid: string | null) => {
    const p = new URLSearchParams(params);
    p.delete("id");
    nav({ pathname: mid ? `/messages/${encodeURIComponent(mid)}` : "/messages", search: p.toString() });
  };
  const current = id ? all.find(m => m.id === id) || null : null;

  if (!messages) return <Loading label="Gathering your messages" />;
  const active = Object.values(sel).some(s => s.size) || ql;
  return (
    <div className="msgs">
      <aside className="facets">
        <h1 className="title" style={{ fontSize: "var(--t-2xl)" }}>Messages</h1>
        <input className="search" type="search" placeholder="Search your words" value={q} onChange={e => setQ(e.target.value)} aria-label="Search your messages" />
        {active && <button className="link" style={{ fontSize: "var(--t-s)" }} onClick={() => { setSel({}); setQ(""); }}>Clear filters</button>}
        <button className="pill ftoggle" onClick={() => setShowF(!showF)} aria-expanded={showF}>
          {showF ? "Hide filters" : `Filters${Object.values(sel).filter(x => x.size).length ? ` (${Object.values(sel).filter(x => x.size).length} on)` : ""}`}
        </button>
        <div className={"fbody" + (showF ? " open" : "")}>
        {FACETS.filter(f => !f.steer).slice(0, 3).map(f => <FacetBox key={f.key} f={f} all={all} pass={pass} sel={sel[f.key]} onToggle={v => toggle(f.key, v)} />)}
        <h3 className="fgroup">How you steer</h3>
        {core && !core.profile.coverage?.signals.covered && !FACETS.some(f => f.steer && sel[f.key]?.size)
          ? <Partial c={core.profile.coverage.signals} what="Whose idea it is, who decides, scope, pressure, annoyance and play" />
          : FACETS.filter(f => f.steer).map(f => <FacetBox key={f.key} f={f} all={all} pass={pass} sel={sel[f.key]} onToggle={v => toggle(f.key, v)} />)}
        <h3 className="fgroup">Where and what</h3>
        {FACETS.filter(f => !f.steer).slice(3).map(f => <FacetBox key={f.key} f={f} all={all} pass={pass} sel={sel[f.key]} onToggle={v => toggle(f.key, v)} />)}
        </div>
      </aside>
      <section className="mlist">
        <header className="mhead">
          <span><b className="num">{fmtN(rows.length)}</b> <span className="muted">of {fmtN(all.length)} messages</span></span>
          <div className="seg">{Object.entries(SORTS).map(([k, [l]]) => <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button>)}</div>
        </header>
        <Mini rows={rows} />
        <VList rows={rows} current={id} onOpen={open} />
      </section>
      <section className={"mdetail" + (current ? " open" : "")}>
        {current ? <Detail m={current} onClose={() => open(null)} />
          : id ? <p className="partial">No message <code>{id}</code> in the record. It may be from a transcript that was never read. <button className="link" onClick={() => open(null)}>Back to all messages</button></p>
          : <Summary rows={rows} />}
      </section>
    </div>
  );
}

function FacetBox({ f, all, pass, sel, onToggle }: { f: Facet; all: Message[]; pass: (m: Message, skip?: string) => boolean; sel?: Set<string>; onToggle: (v: string) => void }) {
  const [more, setMore] = useState(false);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of all) { if (!pass(m, f.key)) continue; const v = f.get(m); if (v == null) continue; c.set(v, (c.get(v) || 0) + 1); }
    const e = [...c.entries()];
    if (f.order) e.sort((a, b) => f.order!.indexOf(a[0]) - f.order!.indexOf(b[0])); else e.sort((a, b) => b[1] - a[1]);
    return e;
  }, [all, pass, f]);
  const max = d3.max(counts, c => c[1]) || 1;
  const shown = more ? counts : counts.slice(0, 8);
  return (
    <div className="facet">
      <h4>{f.label}</h4>
      {shown.map(([v, n]) => {
        const on = sel?.has(v);
        const fam = f.key === "intent" ? familyOf(v) : null;
        return (
          <button key={v} className={"fv" + (on ? " on" : "")} onClick={() => onToggle(v)} aria-pressed={on}>
            <span className="fbar" style={{ width: `${(100 * n) / max}%`, background: fam ? famColor(fam) : "var(--ink)", opacity: fam ? 0.16 : 0.07 }} />
            {fam && <span className="dot" style={{ background: famColor(fam) }} />}
            <span className="fl">{f.name ? f.name(v) : v}</span>
            <span className="fn num">{fmtN(n)}</span>
          </button>
        );
      })}
      {counts.length > 8 && <button className="link" style={{ fontSize: "var(--t-xs)", marginTop: 4 }} onClick={() => setMore(!more)}>{more ? "Fewer" : `All ${counts.length}`}</button>}
    </div>
  );
}

/** The filtered messages over time: a small column chart by week, coloured by family. */
function Mini({ rows }: { rows: Message[] }) {
  const weeks = useMemo(() => {
    const g = d3.rollups(rows, v => d3.rollup(v, w => w.length, m => (m.family || "none") as string), m => d3.timeFormat("%Y-%m-%d")(d3.timeMonday.floor(new Date(m.day + "T12:00"))));
    return g.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [rows]);
  const max = d3.max(weeks, w => d3.sum([...w[1].values()])) || 1;
  return (
    <div className="mini" aria-hidden="true">
      {weeks.map(([wk, m]) => (
        <div key={wk} className="mcol" title={`Week of ${fmtDay(wk, { day: "numeric", month: "short" })}: ${d3.sum([...m.values()])}`}>
          {([...FAMILIES.map(f => f.key), "none"] as string[]).map(k => m.get(k) ? <i key={k} style={{ height: `${(100 * m.get(k)!) / max}%`, background: famColor(k as Family) }} /> : null)}
        </div>
      ))}
    </div>
  );
}

/** A windowed list: only the rows in view are in the page. */
function VList({ rows, current, onOpen }: { rows: Message[]; current: string | null; onOpen: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(800);
  const RH = 64;
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight)); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { box.current?.scrollTo({ top: 0 }); }, [rows]);
  // a message opened from a link: bring its row into view
  useEffect(() => {
    const el = box.current, i = current ? rows.findIndex(m => m.id === current) : -1;
    if (!el || i < 0) return;
    if (i * RH < el.scrollTop || (i + 1) * RH > el.scrollTop + el.clientHeight) el.scrollTo({ top: Math.max(0, i * RH - el.clientHeight / 3) });
  }, [current, rows]);
  const i0 = Math.max(0, Math.floor(top / RH) - 6), i1 = Math.min(rows.length, Math.ceil((top + h) / RH) + 6);
  return (
    <div ref={box} className="vlist" onScroll={e => setTop((e.target as HTMLDivElement).scrollTop)} role="list">
      <div style={{ height: rows.length * RH, position: "relative" }}>
        {rows.slice(i0, i1).map((m, j) => (
          <button key={m.id} role="listitem" className={"mrow" + (m.id === current ? " on" : "")} style={{ top: (i0 + j) * RH, height: RH }} onClick={() => onOpen(m.id)}>
            <span className="mdot" style={{ background: famColor(m.family) }} />
            <span className="mtext">{m.text || (m.images ? "(an image)" : "(empty)")}</span>
            <span className="mmeta">
              <span>{fmtDay(m.day, { day: "numeric", month: "short" })}, {fmtHour(m.hour)}</span>
              <span>{m.project}</span>
              {m.intent && <span style={{ color: "var(--ink-2)" }}>{INTENTS[m.intent]}</span>}
              {m.tone === "frustrated" && <span className="tag">frustrated</span>}
              {m.irk && m.irk !== "none" && <span className="tag">annoyed at {m.irk === "claude" ? "Claude" : "something else"}</span>}
              {m.own && <span>your idea</span>}
              {m.tools != null && <span className="num">{plural(m.tools, "tool")}{m.commits ? `, ${plural(m.commits, "commit")}` : ""}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Summary({ rows }: { rows: Message[] }) {
  const n = rows.length;
  if (!n) return <div className="msum"><h2 className="section">Nothing matches</h2><p className="sub">Loosen a filter or clear the search.</p></div>;
  const med = (f: (m: Message) => number) => d3.median(rows, f) || 0;
  const share = (f: (m: Message) => boolean) => Math.round((100 * rows.filter(f).length) / n);
  const sig = rows.filter(m => m.who != null);
  const pc = (f: (m: Message) => boolean) => Math.round((100 * sig.filter(f).length) / Math.max(1, sig.length));
  return (
    <div className="msum">
      <h2 className="section">These {fmtN(n)} messages</h2>
      <p className="sub">Pick one to read it whole, with what Claude did and said.</p>
      <dl className="facts">
        <div><dt>Median length</dt><dd>{Math.round(med(m => m.words))} words</dd></div>
        <div><dt>Claude, until done</dt><dd>{fmtDur(med(m => m.dur))}</dd></div>
        <div><dt>Tool calls each</dt><dd>{Math.round(med(m => m.tools))}</dd></div>
        <div><dt>Changed files</dt><dd>{share(m => m.files > 0)}%</dd></div>
        <div><dt>Ended in a commit</dt><dd>{share(m => m.commits > 0)}%</dd></div>
        <div><dt>You stopped Claude</dt><dd>{share(m => m.stopped)}%</dd></div>
        <div><dt>Next message corrects</dt><dd>{share(m => m.next === "correct")}%</dd></div>
        <div><dt>Sent while Claude worked</dt><dd>{share(m => m.queued)}%</dd></div>
        {sig.length >= 20 && <>
          <div><dt>Bring your own idea</dt><dd>{pc(m => !!m.own)}%</dd></div>
          <div><dt>Hand Claude the call</dt><dd>{pc(m => m.who === "claude")}%</dd></div>
        </>}
      </dl>
    </div>
  );
}

/** Claude's reply, with headings, lists, code and bold rendered (a small, safe subset of Markdown). */
function Md({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string, k: number) => {
    const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return <span key={k}>{parts.map((p, i) => p.startsWith("`") && p.endsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p)}</span>;
  };
  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (b.startsWith("```")) return <pre key={i}>{b.replace(/^```\w*\n?|```$/g, "")}</pre>;
        if (/^#{1,4} /.test(b)) return <h4 key={i}>{b.replace(/^#+ /, "")}</h4>;
        const lines = b.split("\n");
        if (lines.every(l => /^\s*([-*]|\d+\.)\s/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ""), j)}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <span key={j}>{inline(l, j)}{j < lines.length - 1 && <br />}</span>)}</p>;
      })}
    </div>
  );
}

function Detail({ m, onClose }: { m: Message; onClose: () => void }) {
  const d = useMessageDetail(m.id);
  const [copied, setCopied] = useState(false);
  const [raw, setRaw] = useState(false);
  const cmd = d ? `cd ${d.cwd} && claude --resume ${d.sid}` : "";
  const labels: [string, string | null][] = [
    ["Asks for", m.intent ? `${INTENTS[m.intent]} (${famName(m.family)})` : null],
    ["Tone", m.tone], ["Says what done looks like", m.specific == null ? null : m.specific ? "yes" : "no"],
    ["Your own idea", m.own == null ? null : m.own ? "yes" : "no"], ["Who makes the call", m.who && WHO[m.who]], ["Scope", m.scope && SCOPE[m.scope]],
    ["Under pressure", m.pressure == null ? null : m.pressure ? "yes" : "no"], ["Annoyed at", m.irk && IRK[m.irk]],
    ["Playful", m.play == null ? null : m.play ? "yes" : "no"],
  ];
  const people = Array.isArray(m.people) ? m.people.join(", ") : m.people;
  const readings: [string, string | null | undefined][] = [
    ["Decides", m.decides ? m.decision || "yes" : null], ["Puts off", m.defers ? m.putOff || "yes" : null],
    ["With people", m.withPeople ? people || "yes" : null], ["How you are", m.selfState],
    ["Hands the call over", m.handsOver ? "yes" : null], ["States a rule", m.rule], ["Left not done", m.notDone ? (typeof m.notDone === "string" ? m.notDone : "yes") : null],
  ];
  const read = readings.filter(([, v]) => v);
  return (
    <article className="mfull">
      <div className="mtop">
        <span className="muted">{fmtDay(m.day, { weekday: "long", day: "numeric", month: "long" })}, {fmtHour(m.hour)}</span>
        <button className="pill" onClick={onClose} aria-label="Close">Close</button>
      </div>
      <h2 className="section" style={{ marginBottom: 4 }}>{m.project}</h2>
      {d?.title && <p className="sub" style={{ marginBottom: 12 }}>{d.title}</p>}
      <div className="you">{d ? (raw ? d.text : d.own || d.text) : m.text}{d?.truncated ? "\n…" : ""}</div>
      {d && d.own !== d.text && <button className="link" style={{ fontSize: "var(--t-xs)", marginTop: 6 }} onClick={() => setRaw(!raw)}>{raw ? "Show only your words" : "Show what the app wrapped around them"}</button>}
      <div className="lbls">{labels.filter(([, v]) => v).map(([k, v]) => <span key={k} className="chip"><span className="muted">{k}</span> {v}</span>)}
        <Link className="link" style={{ fontSize: "var(--t-xs)", alignSelf: "center" }} to="/labels">What these mean</Link></div>
      {read.length > 0 && (
        <div className="readings">
          <span className="muted">Readings by a model, not checked yet</span>
          {read.map(([k, v]) => <span key={k} className="chip reading"><span className="muted">{k}</span> {v}</span>)}
        </div>
      )}
      <dl className="facts">
        <div><dt>Claude, until done</dt><dd>{fmtDur(m.dur)}</dd></div>
        <div><dt>Tool calls</dt><dd>{fmtN(m.tools)}</dd></div>
        <div><dt>Files, lines</dt><dd>{m.files} <span className="muted">+{fmtN(m.add)} −{fmtN(m.del)}</span></dd></div>
        <div><dt>Commits, PRs</dt><dd>{m.commits}{m.prs ? `, ${m.prs} PR` : ""}</dd></div>
        <div><dt>Tokens written</dt><dd>{fmtK(m.out)}</dd></div>
        <div><dt>Thinking</dt><dd>{m.thinkMs ? fmtDur(m.thinkMs / 1000) : "—"}</dd></div>
      </dl>
      {Object.keys(m.cat).length > 0 && (
        <div className="toolbar" title="Tool calls by kind">
          {Object.entries(m.cat).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} style={{ flex: v }}><i />{k} {v}</span>)}
        </div>
      )}
      {d?.reply && <><h4 className="h4">Claude's last words in that turn</h4><Md text={d.reply} /></>}
      {d && d.files.length > 0 && <><h4 className="h4">Files changed</h4><div className="files">{d.files.map(f => <div key={f}>{f}</div>)}</div></>}
      <h4 className="h4">Pick it up again</h4>
      <button className="cmd" onClick={() => { navigator.clipboard?.writeText(cmd).then(() => setCopied(true), () => {}); setTimeout(() => setCopied(false), 1200); }}>{cmd || "…"}<span>{copied ? "Copied" : "Copy"}</span></button>
      <p className="sub" style={{ marginTop: 12 }}><Link className="link" to={`/days/${m.day}`}>See this day</Link>{m.model ? ` · ${m.model}` : ""}{m.effort ? `, ${m.effort} effort` : ""}</p>
    </article>
  );
}
