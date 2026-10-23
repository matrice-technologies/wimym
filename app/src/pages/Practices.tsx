import { useState } from "react";
import { Link } from "react-router-dom";
import { useMessages, useOptional } from "../lib/data";
import { famColor, fmtDate, fmtDay, plural } from "../lib/format";
import type { Message } from "../lib/types";

// GET /api/practices (engine/wimym/practices.py) and GET /api/rules (the labels session's rules.json).
interface Verdict { at: string; verdict: "keep" | "change" | "drop"; note?: string | null }
interface Practice {
  id: string; text: string; owner?: "person" | "agents"; where?: string | null; measure?: string | null; target?: string | null;
  start?: string | null; trial?: number; status?: "trying" | "kept" | "changed" | "dropped"; verdicts?: Verdict[]; why?: string | null;
}
interface LogEntry { at: string; kind: string; text: string; week?: string | null; refs?: string[]; practice?: string | null }
interface RuleGroup { rule: string; kind?: string; n: number; sessions?: number; ids: string[]; known?: boolean | string | null; first?: string; last?: string; projects?: string[] }

const STATUS: Record<string, string> = { trying: "Trying", kept: "Kept", changed: "Changed", dropped: "Dropped" };

/** What you decided to do differently, each with the sign that would show it held. */
export default function Practices() {
  const p = useOptional<{ practices: Practice[]; log: LogEntry[] }>("/api/practices", x => Array.isArray(x?.practices));
  const r = useOptional<{ version: number | null; groups: RuleGroup[] }>("/api/rules", x => Array.isArray(x?.groups));
  const list = p && p !== "absent" ? p.practices : [];
  const log = p && p !== "absent" ? p.log ?? [] : [];
  const rules = r && r !== "absent" ? r.groups : [];
  return (
    <div className="wrap narrow">
      <h1 className="title">Practices</h1>
      <p className="lede">
        A practice is something you decide to do differently, written down with the sign that would show it held:
        stopping at a set hour, saying what done looks like in the first message, settling a deferred decision before
        starting the next project. Some are yours to keep, others are cheaper to hand to the agents as a rule.
      </p>

      {list.length ? (
        <ul className="plist">
          {list.map(x => (
            <li key={x.id} className={"prac " + (x.status ?? "trying")}>
              <div className="ph">
                <b>{x.text}</b>
                <span className="chip">{STATUS[x.status ?? "trying"]}</span>
              </div>
              <span className="muted">
                {[x.owner === "agents" ? `For the agents${x.where ? `, in ${x.where}` : ""}` : "Yours to keep",
                  x.start ? `since ${fmtDate(x.start)}${x.trial ? `, a ${x.trial}-day trial` : ""}` : null,
                  x.measure ? `read from ${x.measure}${x.target ? ` (held if ${x.target})` : ""}` : null].filter(Boolean).join(". ")}
              </span>
              {x.why && <span className="muted">Why: {x.why}</span>}
              {x.verdicts?.length ? <ul className="verdicts">{x.verdicts.map((v, i) => <li key={i}><b>{v.verdict === "keep" ? "Keep" : v.verdict === "change" ? "Change" : "Drop"}</b>, {fmtDate(v.at.slice(0, 10))}{v.note ? `: ${v.note}` : ""}</li>)}</ul> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <h2 className="section">None yet</h2>
          <p>Practices come out of the weekly retro. Run <code>/retro</code> in any Claude Code session: it reads the week, brings a few moments and asks what you see. Whatever you decide to try is written here, and each one is shown with its measure before and during the trial, so later weeks can say whether it held.</p>
          <p>Until then, <Link className="link" to="/">this week's vital signs</Link> and <Link className="link" to="/week">the week's moments</Link> are the places to notice what might be worth changing.</p>
        </div>
      )}

      <section className="also">
        <h2 className="section">Things you keep telling Claude</h2>
        <p className="sub">The same correction or instruction, given again across sessions. Each is a candidate rule for the agents: written once in memory or a CLAUDE.md, it stops costing you a message. Nothing is written without your yes.</p>
        {rules.length ? <ul className="rules2">{rules.map((g, i) => <Rule key={i} g={g} />)}</ul>
          : <p className="partial">None found yet: the repeated instructions appear here once the labels are read for them.</p>}
      </section>

      {log.length > 0 && (
        <section className="also">
          <h2 className="section">The growth log</h2>
          <p className="sub">What was looked at, what you concluded and what became of it, newest first.</p>
          <ul className="glog">
            {[...log].reverse().map((e, i) => (
              <li key={i}><span className="muted num">{fmtDay(e.at.slice(0, 10), { day: "numeric", month: "short" })}</span><span className="chip">{e.kind}</span><span>{e.text}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Rule({ g }: { g: RuleGroup }) {
  const { byId } = useMessages();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ex = g.ids.map(id => byId.get(id)).filter((m): m is Message => !!m);
  const line = `- ${g.rule}`;
  return (
    <li className={open ? "open" : ""}>
      <button className="ahead" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ak num">{plural(g.n, "time")}{g.sessions ? `, ${plural(g.sessions, "session")}` : ""}</span>
        <span className="ar">{g.rule}{g.known ? <em className="known"> already in a rule</em> : null}</span>
      </button>
      {open && (
        <div className="abody">
          {ex.length > 0 && <ul className="evid">{ex.slice(0, 8).map(m => (
            <li key={m.id}><Link to={`/messages/${encodeURIComponent(m.id)}`}>
              <span className="dot" style={{ background: famColor(m.family) }} />
              <span className="et">{m.text.slice(0, 200)}</span>
              <span className="ew">{fmtDay(m.day, { day: "numeric", month: "short" })}</span>
            </Link></li>))}</ul>}
          {!g.known && (
            <div className="makerule">
              <span className="muted">To make it a rule, add this line to the project's CLAUDE.md or to memory:</span>
              <button className="cmd" onClick={() => { navigator.clipboard?.writeText(line).then(() => setCopied(true)).catch(() => {}); }}>
                {line}<span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
