import * as d3 from "d3";
import Loading from "../components/Loading";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useMessages } from "../lib/data";
import { FAMILIES, famColor, fmtDay, fmtN } from "../lib/format";
import type { Note } from "../lib/types";

const human = (name: string) => {
  const t = name.replace(/^(feedback|user|project|reference)[-_]/, "").replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const unquote = (s: string) => s.replace(/^["'“]|["'”]$/g, "").replace(/\\"/g, '"');

export default function TheirView() {
  const { core } = useData();
  const { messages } = useMessages();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const mem = core?.memory;
  const fb = useMemo(() => (mem?.notes || []).filter(n => n.type === "feedback"), [mem]);
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? fb.filter(n => (n.name + " " + n.desc + " " + n.body + " " + n.project).toLowerCase().includes(ql)) : fb;
  }, [fb, q]);
  if (!core || !mem || !messages) return <Loading label="Reading their notes" />;
  // "Contact guillaume" → "guillaume"; a note about people in general keeps its title
  const personName = (t: string) => { const s = t.replace(/^(Contact|People|Person) /, ""); return /^(and|&) /.test(s) ? t : s; };
  const isPerson = (n: Note) => /^(contact|people|person)[-_ ]/i.test(n.name);
  const users = mem.notes.filter(n => n.type === "user" && !isPerson(n));
  const people = mem.notes.filter(n => n.type === "user" && isPerson(n));
  const P = messages.filter(m => m.kind === "prompt" && m.family);
  const taught = fb.filter(n => n.taught?.family);
  const share = (arr: { family: string | null }[], f: string) => (arr.length ? (100 * arr.filter(x => x.family === f).length) / arr.length : 0);
  const fromCorr = Math.round(share(taught.map(n => n.taught!), "steer"));
  return (
    <div className="wrap">
      <h1 className="title">Their view of you</h1>
      <p className="lede">
        Across {mem.projects} projects your agents have written down {mem.counts.user || 0} notes about who you are and {mem.counts.feedback || 0} about how you want them to work. Claude opened them {fmtN(mem.reads)} times.
        The rest of Wimym is what your messages show; this is what your agents decided to remember.
      </p>

      <section className="block" style={{ marginTop: 40 }}>
        <header><div><h2 className="section">Who you are, to them</h2><p className="sub" style={{ margin: 0 }}>Notes saved as being about you, newest first.</p></div></header>
        <div className="dossier">
          {users.map(n => (
            <article key={n.file} className="dnote">
              <h3>{human(n.name)}</h3>
              <p>{unquote(n.desc)}</p>
              <span className="muted">{n.project}, {fmtDay(new Date(n.mtime * 1000).toISOString().slice(0, 10), { day: "numeric", month: "short" })}</span>
            </article>
          ))}
        </div>
      </section>

      {people.length > 0 && (
        <section className="block">
          <header><div><h2 className="section">People they know of</h2><p className="sub" style={{ margin: 0 }}>Contacts and people in your life that agents saved under "about you".</p></div></header>
          <div className="people">{people.map(n => <span key={n.file} className="chip" title={unquote(n.desc)}>{personName(human(n.name))}<span className="muted">{n.project}</span></span>)}</div>
        </section>
      )}

      <section className="block">
        <header><div><h2 className="section">Where your rules come from</h2>
          <p className="sub" style={{ margin: 0 }}>For the {taught.length} rules whose writing can be traced to a message of yours: what that message was. {fromCorr}% followed a correction, against {Math.round(share(P, "steer"))}% of your messages overall.</p></div></header>
        <div className="panel">
          <div className="compare">
            {[["The messages that led to a rule", taught.map(n => n.taught!)], ["All your messages", P]].map(([label, arr]) => (
              <div key={label as string}>
                <span className="muted">{label as string}</span>
                <div className="stackbar">{FAMILIES.map(f => { const v = share(arr as { family: string | null }[], f.key); return v ? <i key={f.key} style={{ flex: v, background: famColor(f.key) }} title={`${f.name} ${Math.round(v)}%`}>{v >= 7 ? `${f.name} ${Math.round(v)}%` : ""}</i> : null; })}</div>
              </div>
            ))}
          </div>
          <Taught notes={fb} />
        </div>
      </section>

      <section className="block">
        <header>
          <div><h2 className="section">The rules you've taught</h2>
            <p className="sub" style={{ margin: 0 }}>How you want agents to work, in their words. Open one for the whole note and the message of yours that led to it.</p></div>
          <input className="search" style={{ maxWidth: 280 }} type="search" placeholder="Search the rules" value={q} onChange={e => setQ(e.target.value)} />
        </header>
        <ol className="rules">
          {shown.map(n => (
            <li key={n.file} className={open === n.file ? "open" : ""}>
              <button className="rhead" onClick={() => setOpen(open === n.file ? null : n.file)} aria-expanded={open === n.file}>
                <span className="rd">{unquote(n.desc) || human(n.name)}</span>
                <span className="rm muted">{n.project}{n.written ? `, ${fmtDay(n.written, { day: "numeric", month: "short" })}` : ""}{n.reads ? `, opened ${n.reads}×` : ""}</span>
              </button>
              {open === n.file && (
                <div className="rbody">
                  {n.taught && (
                    <p className="taught"><span className="dot" style={{ background: famColor(n.taught.family) }} /> After you said: <Link className="link" to={`/messages/${encodeURIComponent(n.taught.id)}`}>“{n.taught.text}”</Link></p>
                  )}
                  <div className="md" style={{ whiteSpace: "pre-wrap", maxHeight: 320 }}>{n.body}</div>
                  <p className="sub" style={{ marginTop: 8 }}>{n.file}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Rules written per week. */
function Taught({ notes }: { notes: Note[] }) {
  const fmtW = d3.timeFormat("%Y-%m-%d");
  const counts = d3.rollup(notes.filter(n => n.written), v => v.length, n => fmtW(d3.timeMonday.floor(new Date(n.written! + "T12:00"))));
  if (!counts.size) return null;
  // every week from the first to the last, quiet weeks included, so the axis is time
  const ks = [...counts.keys()].sort();
  const weeks: [string, number][] = d3.timeMonday.range(new Date(ks[0] + "T12:00"), d3.timeDay.offset(new Date(ks[ks.length - 1] + "T12:00"), 1)).map(d => [fmtW(d), counts.get(fmtW(d)) || 0]);
  const max = d3.max(weeks, w => w[1]) || 1;
  return (
    <div style={{ marginTop: 22 }}>
      <h3>Rules written, week by week</h3>
      <div className="hist" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`, height: 140 }}>
        {weeks.map(([w, n], i) => <div key={w}><i style={{ height: `${(100 * n) / max}%`, background: "var(--ink-2)", opacity: 0.55 }} /><span className="num">{n || ""}</span><em className={i % 3 ? "minor" : ""}>{fmtDay(w, { day: "numeric", month: "short" })}</em></div>)}
      </div>
    </div>
  );
}
