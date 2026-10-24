import { Link } from "react-router-dom";
import Loading from "../components/Loading";
import { useTip } from "../components/Tip";
import { useLabels } from "../lib/data";
import { famColor, fmtDay, fmtN } from "../lib/format";
import type { Family, LabelField, LabelSet, LabelsPage, Ratio } from "../lib/types";

const FAM_OF: Record<string, Family> = { question: "ask", correct: "steer", build: "make", fix: "make", design: "make", "go-ahead": "approve", answer: "approve", ops: "run", setup: "run", ship: "ship", plan: "think", review: "think" };
const PAGE: Record<string, string> = { Portrait: "/", Days: "/days", Messages: "/messages", "How you lead": "/lead", "Your voice": "/voice", Projects: "/projects", "Day score": "/days" };
const anchor = (f: LabelField) => `label-${f.key}`;
const pct = (r: Ratio) => Math.round((100 * r.k) / Math.max(1, r.n));

export default function Labels() {
  const d = useLabels();
  if (!d) return <Loading label="Reading the labels" />;
  const bySet = (s: string) => d.fields.filter(f => f.set === s);
  return (
    <div className="wrap labels">
      <h1 className="title">What the labels mean</h1>
      <p className="lede">
        Haiku read each of your messages, with the end of Claude's turn before it, and wrote down what it asks for, how it sounds and how you steer.
        Those labels color the rings, fill the filters and feed several measures. Here is what each one means, how often it applies to you, real examples,
        how it was made, and how far to trust it.
      </p>
      <nav className="jump" aria-label="Labels on this page">
        {d.sets.map(s => (
          <div key={s.key}><span className="muted">{s.name}</span>
            {bySet(s.key).map(f => <a key={f.key} className="chip" href={`#${anchor(f)}`}>{f.name}</a>)}
          </div>
        ))}
      </nav>
      <section className="block">
        <header><div><h2 className="section">How they were made</h2>
          <p className="sub" style={{ margin: 0 }}>Two sets, each with its own version: when the wording Haiku gets changes, every message is labelled again. Only labels of the current version count.</p></div></header>
        <div className="grid cols-2">{d.sets.map(s => <SetCard key={s.key} s={s} />)}</div>
        <p className="sub" style={{ marginTop: 14 }}>
          {fmtN(d.notTyped)} messages Haiku found weren't typed by you (briefs other sessions wrote, automated checks) are left out of Wimym altogether.
        </p>
      </section>
      <Trust d={d} />
      {d.sets.map(s => (
        <div key={s.key}>
          <h2 className="set-title">{s.name}</h2>
          {bySet(s.key).map(f => <Field key={f.key} f={f} set={s} />)}
        </div>
      ))}
    </div>
  );
}

function SetCard({ s }: { s: LabelSet }) {
  const share = s.of ? s.labelled / s.of : 0;
  const m = s.made;
  return (
    <div className="panel setcard">
      <h3>{s.name}</h3>
      <p className="sub">{s.about}</p>
      <div className="cover" aria-label={`${Math.round(100 * share)}% of your messages labelled`}><i style={{ width: `${100 * share}%` }} /></div>
      <p className="sub" style={{ margin: "6px 0 12px" }}>
        <b className="num" style={{ color: "var(--ink)" }}>{fmtN(s.labelled)}</b> of your {fmtN(s.of)} messages labelled ({Math.round(100 * share)}%)
        {share < 0.8 && <>: views that use this set wait until it covers most of them</>}.
      </p>
      <dl className="facts">
        <div><dt>Version</dt><dd>{s.version ?? "—"}</dd></div>
        <div><dt>Model</dt><dd style={{ fontSize: "var(--t-m)" }}>{m ? m.model.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-(\d)-(\d)/, " $1.$2").replace(/^\w/, c => c.toUpperCase()) : "—"}</dd></div>
        <div><dt>{m?.thisVersionOnly ? "Cost of this version" : "Cost of every run so far"}</dt><dd>{m ? `$${m.usd.toFixed(2)}` : "—"}</dd></div>
        <div><dt>{m && m.from && m.to && m.from.slice(0, 10) !== m.to.slice(0, 10) ? "Labelled from, to" : "Labelled on"}</dt>
          <dd style={{ fontSize: "var(--t-m)" }}>{m?.from ? (m.to && m.from.slice(0, 10) !== m.to.slice(0, 10) ? `${fmtDay(m.from.slice(0, 10), { day: "numeric", month: "short" })} – ${fmtDay(m.to.slice(0, 10), { day: "numeric", month: "short" })}` : fmtDay(m.from.slice(0, 10), { day: "numeric", month: "long" })) : "—"}</dd></div>
      </dl>
      {s.changes.length > 0 && (
        <details className="rule"><summary>What changed in each version</summary>
          <ol className="versions">{s.changes.map(c => <li key={c.v} className={c.v === s.version ? "now" : ""}><b>Version {c.v}{c.v === s.version ? ", now" : ""}.</b> {c.text}</li>)}</ol>
        </details>
      )}
      {m && <p className="sub" style={{ margin: "12px 0 0" }}>{fmtN(m.calls)} calls of about 50 messages each{m.messages > s.labelled * 1.2 ? `, ${fmtN(m.messages)} labels written in all (some messages more than once, as the wording changed)` : ""}.</p>}
    </div>
  );
}

function Trust({ d }: { d: LabelsPage }) {
  if (!d.audit.at || !d.audit.model) return null;
  return (
    <section className="block">
      <header><div><h2 className="section">How far to trust them</h2>
        <p className="sub" style={{ margin: 0 }}>
          On {fmtDay(d.audit.at, { day: "numeric", month: "long" })}, a second judge ({d.audit.model.replace(/^claude-/, "").replace(/-(\d)-(\d)/, " $1.$2").replace(/^\w/, c => c.toUpperCase())}) re-read {d.audit.marks} labels on {d.audit.cards} messages and said, for each, whether Haiku was right.
          That gives two numbers per label, each with the range where the true rate likely sits (95%):
        </p></div></header>
      <div className="grid cols-2">
        <div className="panel"><h3>On any message</h3><p className="sub" style={{ margin: 0 }}>Twenty messages picked at random. High for almost every label, because most messages take the plain value (neutral, no, nobody) and that is easy to get right.</p></div>
        <div className="panel"><h3>When Haiku says the rare thing</h3><p className="sub" style={{ margin: 0 }}>Five to seven messages per rare value (frustrated, pressure, annoyed at Claude). This is the number to look at before reading much into a share: with so few checked, the ranges are wide.</p></div>
      </div>
      <p className="sub" style={{ marginTop: 14 }}>
        The second judge checked the labels as they were then (version 2 of both sets), with Haiku's label in front of it, so a defensible other label counts as wrong and
        those old labels score higher than any fresh run would. The wording Haiku gets was rewritten afterwards to fix what it found. Under each label: which of its problems
        are better now, and "Labelled again, now": how often the current label agrees with the second judge on those same messages. Compare it with a fresh run of the old wording
        (docs/research/relabel.md), not with the old score.
      </p>
    </section>
  );
}

function Field({ f, set }: { f: LabelField; set: LabelSet }) {
  const partial = f.labelled < 0.8 * f.of;
  const isIntent = f.key === "in";
  const max = Math.max(...f.values.map(v => v.share || 0), 1);
  const values = [...f.values].sort((a, b) => (isIntent ? b.n - a.n : 0));
  return (
    <section className="block field" id={anchor(f)}>
      <header><div>
        <h2 className="section">{f.name}</h2>
        <p className="lede" style={{ fontSize: "var(--t-m)", marginBottom: 6 }}>{f.plain}</p>
        <p className="sub" style={{ margin: 0 }}>
          Used in {f.used.map((u, i) => <span key={u}>{i ? ", " : ""}<Link className="link" to={PAGE[u] || "/"}>{u}</Link></span>)}.{" "}
          {partial ? <b style={{ color: "var(--ink-2)" }}>Labelled on {fmtN(f.labelled)} of {fmtN(f.of)} messages so far, so the shares below come from that sample.</b>
            : <>Shares of the {fmtN(f.labelled)} messages labelled.</>}
        </p>
      </div></header>
      <div className="values">
        {values.map(v => (
          <div className="value" key={v.key}>
            <div className="vhead">
              <span className="vname">{isIntent && <span className="dot" style={{ background: famColor(FAM_OF[v.key]), marginRight: 8 }} />}{v.name}</span>
              <span className="vbar"><i style={{ width: `${(100 * (v.share || 0)) / max}%`, background: isIntent ? famColor(FAM_OF[v.key]) : "var(--ink-2)" }} /></span>
              <span className="vshare num">{v.share == null ? "—" : `${v.share < 10 ? v.share.toFixed(1) : Math.round(v.share)}%`}</span>
              <Link className="vn link num" to={`/messages?${f.msg}=${encodeURIComponent(v.key)}`}>{fmtN(v.n)}</Link>
            </div>
            <p className="vmean">{v.meaning}</p>
            {v.examples.length > 0 && (
              <ul className="examples">
                {v.examples.slice(0, 3).map(e => <li key={e.id}><Link to={`/messages/${encodeURIComponent(e.id)}`}>{e.text}</Link></li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      {(f.rule || f.values.some(v => v.rule)) && (
        <details className="rule"><summary>The exact words Haiku gets (version {set.version})</summary>
          <div className="exact">
            {f.values.some(v => v.rule) && <ul>{f.values.filter(v => v.rule).map(v => <li key={v.key}><b>{v.name}</b>: {v.rule}</li>)}</ul>}
            {f.rule && <p>{f.rule}</p>}
          </div>
        </details>
      )}
      <Accuracy f={f} />
    </section>
  );
}

function Accuracy({ f }: { f: LabelField }) {
  const tip = useTip();
  const a = f.audit;
  if (!a) return null;
  const name = (k: string) => f.values.find(v => v.key === k)?.name || k;
  const order = f.values.map(v => v.key);
  const rows: { key: string; label: string; r: Ratio; strong?: boolean }[] = [
    { key: "_random", label: "Any message", r: a.random, strong: true },
    ...Object.entries(a.values).filter(([, r]) => r.n).sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]))
      .map(([k, r]) => ({ key: k, label: `Says “${name(k)}”`, r })),
  ];
  if (a.now) rows.push({ key: "_now", label: "Labelled again, now", r: a.now, strong: true });
  return (
    <div className="trust panel">
      <div className="trust-head">
        <h3>How far to trust it</h3>
        <span className="muted">Right, out of the messages the second judge checked; the bar is the likely range, and a red dot means right less than 7 times in 10{a.unclear ? `. It couldn't decide on ${a.unclear}, left out` : ""}.</span>
      </div>
      <div className="acc">
        {rows.map(r => {
          const lo = r.r.ci?.[0] ?? 0, hi = r.r.ci?.[1] ?? 100, p = pct(r.r);
          const weak = p < 70;
          return (
            <div key={r.key} className={"arow" + (r.strong ? " strong" : "")}
              onMouseMove={ev => tip.show(<div><b>{r.label}</b><div>{r.r.k} of {r.r.n} right ({p}%)</div><div className="m">The true rate likely sits between {lo}% and {hi}%.</div></div>, ev.clientX, ev.clientY)}
              onMouseLeave={() => tip.hide()}>
              <span className="al">{r.label}</span>
              <span className="ascale">
                <i className="arange" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
                <i className={"apt" + (weak ? " weak" : "")} style={{ left: `${p}%` }} />
              </span>
              <span className="av num"><b>{r.r.k} of {r.r.n}</b> <span className="muted">{lo}–{hi}%</span></span>
            </div>
          );
        })}
        <div className="arow axis" aria-hidden="true"><span /><span className="ascale">{[0, 50, 100].map(t => <em key={t} style={{ left: `${t}%` }}>{t}%</em>)}</span><span /></div>
      </div>
      {f.rerun && (
        <p className="sub rerun">
          <b>Same message, labelled twice:</b> the two runs agree about {f.rerun.agree}% of the time ({f.rerun.note}). Read a share that moves by a few points between versions as noise.
        </p>
      )}
      {f.biases.length > 0 && (
        <ul className="biases">
          {f.biases.map((b, i) => <li key={i}>{b.text} {b.status === "better" ? <span className="chip ok">better now</span> : b.status === "rule" ? <span className="chip">new wording, not measured yet</span> : <span className="chip warn">still there</span>}</li>)}
        </ul>
      )}
      {a.wrong.length > 0 && (
        <details className="wrong">
          <summary>Where the second judge disagreed ({a.wrong.length})</summary>
          <ul>
            {a.wrong.map(w => (
              <li key={w.id}>
                <Link to={`/messages/${encodeURIComponent(w.id)}`}>{w.text}</Link>
                <span className="muted"> Haiku said <b>{name(w.was)}</b>{w.fix ? <>, should be <b>{name(w.fix)}</b></> : null}{w.why ? `: ${w.why}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
