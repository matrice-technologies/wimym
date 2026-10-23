import * as d3 from "d3";
import Loading from "../components/Loading";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bars, WeekLines } from "../components/charts";
import Partial from "../components/Partial";
import { useData, useMessages } from "../lib/data";
import { fmtDur, fmtK, fmtN } from "../lib/format";
import { signals } from "../lib/labels";
import type { Coverage, Message, Week } from "../lib/types";

// Words that carry no voice of their own, English and French.
const STOP = new Set(("a an the and or but if then so to of in on at for with from by as is are was were be been it its this that these those i you we he she they me my your our " +
  "do does did not no yes can could would should will just also there here what which who how when why all any some more most very too than into out up down about over " +
  "le la les un une des et ou mais de du au aux en dans sur pour par avec ce cet cette ces je tu il elle on nous vous ils elles me te se mon ton son ma ta sa mes tes ses " +
  "est sont pas ne que qui quoi ça ca c d l j n s t y have has had get got let let's it's i'm don't that's can't i've we're you're").split(" "));

export default function Voice() {
  const { core } = useData();
  const { messages } = useMessages();
  if (!core || !messages) return <Loading label="Listening to your voice" />;
  const P = messages.filter(m => m.kind === "prompt");
  const T = Object.fromEntries(core.profile.traits.map(t => [t.key, t]));
  return (
    <div className="wrap">
      <h1 className="title">Your voice</h1>
      <p className="lede">
        How you talk to Claude: half your messages are {T.brevity?.value} words or fewer, {T.french?.value}% are in French, and you answer a finished turn in a median {fmtDur(T.reply?.value)}.
        {T.irk?.value != null ? ` ${T.irk.value}% show annoyance at Claude's work.` : ""}
        Below, the shape of your messages, the words you lean on, and how your tone moves.
      </p>
      <Lengths msgs={P} weeks={core.weeks} />
      <Openers msgs={P} />
      <Tone weeks={core.weeks} msgs={P} cov={signals(core)} />
      <Pace msgs={P} />
      <Typos typos={core.profile.typos} msgs={P} />
    </div>
  );
}

function Lengths({ msgs, weeks }: { msgs: Message[]; weeks: Week[] }) {
  const edges = [1, 2, 4, 8, 16, 32, 64, 128, 256, 1e9];
  const names = ["1", "2–3", "4–7", "8–15", "16–31", "32–63", "64–127", "128–255", "256+"];
  const hist = names.map((n, i) => {
    const g = msgs.filter(m => m.words >= edges[i] && m.words < edges[i + 1]);
    return { n, k: g.length, fr: g.filter(m => m.lang === "fr").length, voice: g.filter(m => m.src === "massistant").length };
  });
  const max = d3.max(hist, h => h.k) || 1;
  const pasted = msgs.filter(m => m.pasted > 0).length;
  return (
    <section className="block">
      <header><div><h2 className="section">How long your messages are</h2>
        <p className="sub" style={{ margin: 0 }}>Words in your own part of each message (pasted text and what the app adds around it left out). {fmtN(pasted)} messages carried something pasted in.</p></div></header>
      <div className="grid cols-2">
        <div className="panel"><h3>Messages by length</h3>
          <div className="hist">{hist.map(h => <div key={h.n}><i style={{ height: `${(100 * h.k) / max}%` }} /><span className="num">{fmtK(h.k)}</span><em>{h.n}</em></div>)}</div>
          <p className="sub" style={{ margin: "10px 0 0" }}>Words per message, doubling at each step.</p>
        </div>
        <div className="panel"><h3>Over the weeks</h3>
          <WeekLines weeks={weeks.map(w => w.week)} unit="" series={[
            { key: "words", label: "Median words", color: "var(--ink-2)", values: weeks.map(w => w.words) },
            { key: "fr", label: "% in French", color: "var(--f-ask)", values: weeks.map(w => w.french) },
          ]} />
        </div>
      </div>
    </section>
  );
}

function tokens(t: string) {
  return t.toLowerCase().replace(/https?:\S+|`[^`]*`|\S*[/_@#=<>{}\\]\S*/g, " ").match(/[a-zàâçéèêëîïôûùüÿœ']+/g) || [];
}

function Openers({ msgs }: { msgs: Message[] }) {
  const [lang, setLang] = useState<"en" | "fr">("en");
  const { openers, words, pairs } = useMemo(() => {
    const ms = msgs.filter(m => m.lang === lang);
    const op = new Map<string, number>(), wd = new Map<string, number>(), pr = new Map<string, number>();
    for (const m of ms) {
      const t = tokens(m.text);
      if (!t.length) continue;
      const o = t.slice(0, (t[0] || "").length <= 3 && t.length > 1 ? 2 : 1).join(" ");
      op.set(o, (op.get(o) || 0) + 1);
      const seen = new Set<string>();
      t.forEach((w, i) => {
        if (w.length > 2 && !STOP.has(w) && !seen.has(w)) { seen.add(w); wd.set(w, (wd.get(w) || 0) + 1); }
        if (i > 0) { const a = t[i - 1] || "", p = a + " " + w; if (!STOP.has(a) || !STOP.has(w)) pr.set(p, (pr.get(p) || 0) + 1); }
      });
    }
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return { openers: top(op, 12), words: top(wd, 40), pairs: top(pr, 12), n: ms.length };
  }, [msgs, lang]);
  const wmax = words[0]?.[1] || 1;
  return (
    <section className="block">
      <header>
        <div><h2 className="section">The words you lean on</h2>
          <p className="sub" style={{ margin: 0 }}>How your messages open, and the words that come back most (each counted once per message, common little words left out).</p></div>
        <div className="seg"><button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>English</button><button className={lang === "fr" ? "on" : ""} onClick={() => setLang("fr")}>French</button></div>
      </header>
      <div className="grid cols-2">
        <div className="panel"><h3>How you open</h3>
          <Bars rows={openers.map(([k, v]) => ({ key: k, label: `“${k}…”`, value: v, color: "var(--ink-2)" }))} fmt={v => fmtN(v)} labelW={140} />
        </div>
        <div className="panel"><h3>Your words</h3>
          <p className="wordcloud">
            {words.map(([w, n]) => (
              <Link key={w} to={`/messages?q=${encodeURIComponent(w)}`} style={{ fontSize: 13 + 22 * Math.sqrt(n / wmax), opacity: 0.45 + 0.55 * Math.sqrt(n / wmax) }} title={`${n} messages`}>{w}</Link>
            ))}
          </p>
          <h3 style={{ marginTop: 18 }}>Pairs you repeat</h3>
          <p className="pairs">{pairs.map(([p, n]) => <span key={p} className="chip">{p} <b className="num">{n}</b></span>)}</p>
        </div>
      </div>
    </section>
  );
}

function Tone({ weeks, msgs, cov }: { weeks: Week[]; msgs: Message[]; cov: Coverage }) {
  const sig = msgs.filter(m => m.irk != null);
  const pc = (f: (m: Message) => boolean, of = sig) => (of.length ? (100 * of.filter(f).length) / of.length : 0);
  const fmt = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v))) + "%";
  const frus = sig.filter(m => m.tone === "frustrated");
  const irkC = sig.filter(m => m.irk === "claude");
  const wk = (w: Week, f: (w: Week) => number) => (w.sig >= 30 ? (100 * f(w)) / w.sig : null);
  return (
    <section className="block">
      <header><div><h2 className="section">Your tone</h2>
        <p className="sub" style={{ margin: 0 }}>How your messages sound, as Haiku reads them: mostly neutral, since short instructions read that way. Tone says how a message sounds; annoyance says what it's aimed at.</p></div></header>
      <div className="grid cols-2">
        <div className="panel"><h3>Frustrated or pleased</h3>
          <WeekLines weeks={weeks.map(w => w.week)} unit="%" series={[
            { key: "fr", label: "Frustrated", color: "var(--f-steer)", values: weeks.map(w => w.frustrated) },
            { key: "pl", label: "Pleased", color: "var(--f-make)", values: weeks.map(w => w.pleased) },
          ]} />
          <p className="sub" style={{ margin: "12px 0 0" }}>
            <Link className="link" to="/messages?tone=frustrated">Read the frustrated ones</Link> · <Link className="link" to="/messages?tone=pleased">the pleased ones</Link>
          </p>
        </div>
        <div className="panel"><h3>Annoyed at Claude, or at something else</h3>
          {cov.covered ? <>
            <WeekLines weeks={weeks.map(w => w.week)} unit="%" series={[
              { key: "c", label: "At Claude", color: "var(--f-steer)", values: weeks.map(w => wk(w, x => x.irk.claude || 0)) },
              { key: "o", label: "At something else", color: "var(--f-run)", values: weeks.map(w => wk(w, x => x.irk.other || 0)) },
            ]} />
            <p className="sub" style={{ margin: "12px 0 0" }}>
              <Link className="link" to="/messages?irk=claude">Read the ones at Claude</Link> · <Link className="link" to="/messages?irk=other">at something else</Link>
            </p>
          </> : <Partial c={cov} what="Annoyance" />}
        </div>
      </div>
      {cov.covered && (
        <>
          <div className="vs">
            <Link className="vsb" to="/messages?irk=claude"><span className="muted">Annoyed at Claude</span><b className="num">{fmt(pc(m => m.irk === "claude"))}</b><span className="muted">{fmtN(sig.filter(m => m.irk === "claude").length)} messages</span></Link>
            <Link className="vsb" to="/messages?irk=other"><span className="muted">At something else</span><b className="num">{fmt(pc(m => m.irk === "other"))}</b><span className="muted">a tool, a vendor, the situation</span></Link>
            <Link className="vsb" to="/messages?play=yes"><span className="muted">Playful</span><b className="num">{fmt(pc(m => !!m.play))}</b><span className="muted">a joke, a tease, irony</span></Link>
            <Link className="vsb" to="/messages?pressure=yes"><span className="muted">Under pressure</span><b className="num">{fmt(pc(m => !!m.pressure))}</b><span className="muted">a deadline, a client waiting</span></Link>
          </div>
          {frus.length >= 20 && irkC.length >= 20 && (
            <p className="sub" style={{ marginTop: 14 }}>
              The two labels overlap less than you'd think. Of the {fmtN(frus.length)} messages that sound frustrated, {Math.round(pc(m => m.irk === "claude", frus))}% are annoyed at Claude.
              But of the {fmtN(irkC.length)} annoyed at Claude, only {Math.round(pc(m => m.tone === "frustrated", irkC))}% sound frustrated; the rest say it plainly, and {Math.round(pc(m => m.intent === "correct", irkC.filter(m => m.tone !== "frustrated")))}% of those
              are corrections. <Link className="link" to="/messages?irk=claude&tone=neutral">Read the plain ones</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Pace({ msgs }: { msgs: Message[] }) {
  const gaps = msgs.filter(m => m.gap != null).map(m => m.gap!);
  const edges = [-1e9, 0, 10, 30, 60, 180, 600, 1800, 1e9];
  const names = ["while Claude worked", "under 10 s", "10–30 s", "30 s–1 min", "1–3 min", "3–10 min", "10–30 min", "a break (30 min+)"];
  const hist = names.map((n, i) => ({ n, k: gaps.filter(g => g >= edges[i] && g < edges[i + 1]).length }));
  const max = d3.max(hist, h => h.k) || 1;
  const queued = msgs.filter(m => m.queued).length;
  return (
    <section className="block">
      <header><div><h2 className="section">How fast you answer</h2>
        <p className="sub" style={{ margin: 0 }}>Time from the end of Claude's turn to your next message in the same session. {fmtN(queued)} messages were typed while Claude was still working and waited their turn.</p></div></header>
      <div className="panel">
        <Bars rows={hist.map(h => ({ key: h.n, label: h.n, value: h.k, color: h.n === "while Claude worked" ? "var(--f-approve)" : "var(--ink-2)" }))} max={max} fmt={v => fmtN(v)} labelW={170} />
      </div>
    </section>
  );
}

function Typos({ typos, msgs }: { typos: [string, number][]; msgs: Message[] }) {
  const checked = d3.sum(msgs, m => m.checked), found = d3.sum(msgs, m => m.typos);
  return (
    <section className="block">
      <header><div><h2 className="section">Typos</h2>
        <p className="sub" style={{ margin: 0 }}>{(100 * found / Math.max(1, checked)).toFixed(2)} per 100 words, across {fmtN(checked)} English words typed at the Mac. A word counts when neither the dictionary nor Claude's own replies spell it that way and a word they do spell is one letter away. The most frequent, so you can judge the rule:</p></div></header>
      <p className="pairs">{typos.map(([w, n]) => <Link key={w} className="chip" to={`/messages?q=${encodeURIComponent(w)}`}>{w} <b className="num">{n}</b></Link>)}</p>
    </section>
  );
}
