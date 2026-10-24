import * as d3 from "d3";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWide } from "../lib/hooks";
import { shareOn } from "../lib/share";
import Judgement from "../components/Judgement";
import { Priorities, StopHour } from "../components/Limits";
import Loading from "../components/Loading";
import Postcard from "../components/Postcard";
import { usualDay } from "../lib/blocks";
import { fmtUnit, RangeLine, SUMMED } from "../components/Vital";
import WeekSpiral, { spiralBlocks } from "../components/WeekSpiral";
import { useData, useMessages, usePoints, useVitals, useWeek } from "../lib/data";
import { famColor, fmtDate, fmtDay, fmtHour } from "../lib/format";
import type { Core, Measure, Message, Vitals } from "../lib/types";

const iso = d3.timeFormat("%Y-%m-%d");
// The strummed Loom and its aurora (lab/hero) load after the page, so the words come first.
const Hero = lazy(() => import("@wimym/hero").then(m => ({ default: m.Hero })));
const FirstRun = lazy(() => import("@wimym/hero").then(m => ({ default: m.FirstRun })));
const ORDER = { flag: 0, ok: 1, partial: 2, missing: 3 };
const rank = (m: Measure) => (m.flag && m.status !== "missing" ? ORDER.flag : ORDER[m.status]);
const LOOM = "Your messages as a harp of light, under an aurora of the weight each project carries";
const WORDS = ["", "One day", "Two days", "Three days", "Four days", "Five days", "Six days", "Seven days"];

/** The front page: where your mind has been this week, against your own usual. */
export default function ThisWeek() {
  const { core, state } = useData();
  const points = usePoints();
  // Decided once per visit: someone whose engine is still on its first build gets the first-run show,
  // which hands over to the planet itself; someone up to date goes straight to the Loom.
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  useEffect(() => { if (firstRun == null && (state || core)) setFirstRun(!!state?.first); }, [state, core, firstRun]);
  const pts = points && points !== "absent" ? points : null;
  const nav = useNavigate();
  const wide = useWide();
  const [caption, setCaption] = useState<{ line: string; sub: string } | null>(null);
  const vitals = useVitals();
  const wk = useWeek();
  const [open, setOpen] = useState<string | null>(null);

  const week = useMemo(() => {
    if (!vitals || vitals === "absent") return null;
    const mon = vitals.weeks[vitals.weeks.length - 1];
    const d0 = new Date(mon + "T05:00:00");
    const days = d3.range(7).map(i => iso(new Date(d0.getTime() + i * 864e5 + 12 * 3600e3)));
    return { mon, days, nowT: (Date.now() - d0.getTime()) / 3600e3 };
  }, [vitals]);

  // Your usual day: the median first and last message over the eight weeks before this one.
  const usual = useMemo(() => (core && week ? usualDay(core.days, week.mon) : null), [core, week]);

  if (vitals === "absent" || wk === "absent") return <Older />;
  // the Loom draws from /api/points alone, so it starts before the rest of the data is here
  const stage = firstRun
    ? <Suspense fallback={null}><FirstRun state={state} points={state?.first === false ? pts : null} days={core?.days ?? null}
        share={shareOn} shift={wide ? 0.25 : 0} onSelect={d => nav(`/days/${d}`)} onCaption={setCaption} style={{ position: "absolute", inset: 0 }} /></Suspense>
    : pts && <Suspense fallback={null}><Hero piece="loom" points={pts} days={core?.days} share={shareOn}
        onSelect={d => nav(`/days/${d}`)} onCaption={setCaption} style={{ position: "absolute", inset: 0 }} /></Suspense>;
  if (!core || !vitals || !week) {
    // The question is there from the first paint; the same first elements as below, so the Loom
    // (or the first-run show) isn't restarted when the rest of the data arrives.
    return (
      <div className="wrap thisweek">
        <section className={"planet band dark" + (firstRun ? " first" : "")} aria-label={firstRun ? "Your days, as a world" : LOOM}>
          <div className="pl-stage">{stage}</div>
          <div className="pl-scrim" aria-hidden="true" />
          <div className="pl-words">
            <h1 className="wiym">Where is your <span className="hl">mind</span>?</h1>
            {!firstRun && <p className="pl-wait">{state && state.phase !== "ready" && state.phase !== "git" ? state.label : "\u00a0"}</p>}
          </div>
        </section>
      </div>
    );
  }
  const get = (k: string) => vitals.measures.find(m => m.key === k);
  const load = get("load");
  const dayN = Math.min(7, Math.floor(week.nowT / 24) + 1);

  return (
    <div className="wrap thisweek">
      <section className="planet band dark" aria-label={firstRun ? "Your days since March, as a world" : LOOM}>
        <div className="pl-stage">{stage}</div>
        <div className="pl-scrim" aria-hidden="true" />
        <div className="pl-words">
          <h1 className="wiym">Where is your <span className="hl">mind</span>?</h1>
          <p className="pl-line" key={caption?.line ? "c" : "w"}>{caption?.line || "\u00a0"}</p>
          {caption?.sub && <p className="pl-sub">{caption.sub}</p>}
          <div className="pl-week">
            <p className="kicker">This week, from {fmtDay(week.mon, { day: "numeric", month: "long" })}, {WORDS[dayN].toLowerCase()} in</p>
            <p className="pl-head">{headline(vitals, dayN)}</p>
            <a className="pl-next" href="#week" onClick={e => { e.preventDefault(); document.getElementById("week")?.scrollIntoView({ behavior: "smooth" }); }}>See this week, turn by turn</a>
          </div>
          <Postcard />
        </div>
      </section>

      <section className="hw band dark" id="week">
        <div className="hw-art">
          {!wk ? <div className="spiral-wait"><Loading label="Drawing your week" /></div> : <WeekSpiral week={week.days} blocks={spiralBlocks(week.days, wk.days)} nowT={week.nowT} usual={usual} stopHour={vitals.limits.stopHour}
            center={<>
              <b className="num">{load && load.now != null ? fmtUnit(load.now, "h") : WORDS[dayN]}</b>
              <span>{load && load.now != null ? "active this week" : "into the week"}</span>
            </>} />}
        </div>
        <div className="hw-text">
          <h2 className="section hw-title">This week, turn by turn</h2>
          <p className="lede">{summary(vitals, dayN, usual)}</p>
          <p className="sub">One turn of the spiral for each day, from Monday at the centre, noon at the top and midnight at the bottom.</p>
          <ul className="legend">
            <li><i className="lg work" />Working, messages under 20 minutes apart</li>
            <li><i className="lg night" />Nights, last message to first</li>
            {usual && <li><i className="lg usual" />Your usual day, {fmtHour(usual.start)} to {fmtHour(usual.end)}</li>}
            {(vitals.limits.stopHour ?? usual) && <li><i className="lg late" />Past {vitals.limits.stopHour != null ? `your stopping hour, ${fmtHour(vitals.limits.stopHour)}` : "your usual stop"}</li>}
          </ul>
          <StopHour value={vitals.limits.stopHour} compact />
        </div>
      </section>

      {(["health", "performance"] as const).map(group => {
        const keys = vitals.goals.filter(g => g.group === group).flatMap(g => g.measures);
        const ms = vitals.measures.filter(m => keys.includes(m.key)).sort((a, b) => rank(a) - rank(b) || keys.indexOf(a.key) - keys.indexOf(b.key));
        const live = ms.filter(m => m.status !== "missing"), gone = ms.filter(m => m.status === "missing");
        return (
          <section key={group} className="vgroup">
            <header>
              <h2 className="section">{group === "health" ? "Health" : "Performance"}</h2>
              <p className="sub">{group === "health"
                ? "Each line is twelve weeks. The band is your own range, the middle half of the eight weeks before; the open dot is this week so far. Signs outside the band two weeks running come first."
                : vitals.coverage.git ? "What lands, against the effort it took: commits that reached the default branch, and how they got there." : "What lands, against the effort it took. Git isn't read yet, so this is what Claude committed in your sessions."}</p>
            </header>
            <div className="vgrid">
              {live.map((m, i) => <Tile key={m.key} m={m} v={vitals} i={i} dayN={dayN} onOpen={() => setOpen(m.key)} />)}
            </div>
            {gone.length > 0 && (
              <div className="notyet">
                <span>Not measured yet</span>
                {gone.map(m => <button key={m.key} className="chip" onClick={() => setOpen(m.key)} title={m.question}>{m.label}<em>{m.note}</em></button>)}
              </div>
            )}
          </section>
        );
      })}

      <p className="coverage">
        {vitals.coverage.full_from && <>Full detail, with Claude's replies and what each message set off, from {fmtDate(vitals.coverage.full_from)}; </>}
        {vitals.coverage.full_from ? "your" : "Your"} prompts alone from {fmtDate(vitals.coverage.prompts_from)}.
        {" "}{vitals.coverage.git ? "Git is read." : "Git isn't read yet."}
      </p>

      {open && <Drawer m={get(open)!} v={vitals} dayN={dayN} onClose={() => setOpen(null)} />}
    </div>
  );
}

function headline(v: Vitals, dayN: number): string {
  // A sign outside your range two weeks running, health first, and only from measures that hold.
  const health = new Set(v.goals.filter(g => g.group === "health").flatMap(g => g.measures));
  // a run of days without a day off leads: it is the plainest sign of the loop with no end
  const flagged = v.measures.filter(m => m.flag && m.sentence && m.status === "ok")
    .sort((a, b) => Number(b.key === "streak") - Number(a.key === "streak") || Number(health.has(b.key)) - Number(health.has(a.key)));
  if (flagged.length) return flagged[0].sentence!;
  // Otherwise, how the week is going against a usual week by the same day.
  const load = v.measures.find(m => m.key === "load" && m.status !== "missing");
  const by = load ? soFar(load, v, dayN) : null;
  if (load?.now != null && by) {
    const r = load.now / by;
    if (r > 1.15) return "A fuller week than usual.";
    if (r < 0.85) return "A lighter week than usual.";
    return "A usual week, so far.";
  }
  return "Nothing has been outside your usual range for two weeks.";
}

function summary(v: Vitals, dayN: number, usual: { start: number; end: number } | null): string {
  const m = (k: string) => v.measures.find(x => x.key === k && x.status !== "missing");
  const parts: string[] = [];
  const load = m("load"), by = load ? soFar(load, v, dayN) : null;
  if (load?.now != null) parts.push(`${fmtUnit(load.now, "h")} at it in ${WORDS[dayN].toLowerCase()}${by != null ? `, against ${fmtUnit(by, "h")} by now in a usual week` : ""}`);
  const night = m("night"), nb = night?.band[night.band.length - 1];
  if (night?.now != null) parts.push(`nights of ${fmtUnit(night.now, "h")}${nb ? `, against ${fmtUnit(nb.mid, "h")} usually` : ""}`);
  const off = m("daysoff");
  if (off?.now != null) parts.push(off.now ? `${off.now === 1 ? "one day" : off.now + " days"} off` : "no day off yet");
  const stretch = m("stretch");
  if (stretch?.now != null) parts.push(`a longest stretch of ${fmtUnit(stretch.now, "h")} on one project`);
  let s = parts.length ? parts.join(", ").replace(/^./, c => c.toUpperCase()) + "." : "";
  const out = v.measures.filter(x => x.flag && x.status !== "missing");
  const lead = headline(v, dayN);
  const others = out.filter(x => x.sentence !== lead);
  if (others.length) s += ` Outside your range two weeks running: ${others.map(x => x.label.toLowerCase()).join(", ")}.`;
  if (!s && usual) s = `Your usual day runs from ${fmtHour(usual.start)} to ${fmtHour(usual.end)}.`;
  return s;
}

/** A summed measure's total by this weekday in a usual week: the median over the eight weeks before. */
function soFar(m: Measure, v: Vitals, dayN: number): number | null {
  if (!m.daily) return null;
  const at = new Map(v.days.map((d, i) => [d, i]));
  const L = v.weeks.length;
  const sums = v.weeks.slice(Math.max(0, L - 9), L - 1).map(w => {
    const i = at.get(w);
    if (i == null) return null;
    const vals = m.daily!.slice(i, i + dayN);
    return vals.every(x => x == null) ? null : d3.sum(vals, x => x ?? 0);
  }).filter((x): x is number => x != null);
  return sums.length >= 4 ? d3.median(sums)! : null;
}

function Tile({ m, v, i, dayN, onOpen }: { m: Measure; v: Vitals; i: number; dayN: number; onOpen: () => void }) {
  const goal = v.goals.find(g => g.key === m.goal);
  const summed = SUMMED.has(m.key);
  const pace = summed ? soFar(m, v, dayN) : null;
  return (
    <button className={"vital" + (m.flag ? " flagged" : "") + (m.status === "partial" ? " partial" : "")} onClick={onOpen} title={goal?.label}
      style={{ animationDelay: `${0.9 + i * 0.06}s` }} aria-label={`${m.label}: ${fmtUnit(m.now, m.unit)}. ${m.sentence || m.question}`}>
      <span className="v-top">
        <span className="v-name">{m.label}</span>
        <span className="v-val num">{fmtUnit(m.now, m.unit)}{summed && <small> so far</small>}</span>
      </span>
      <RangeLine m={m} weeks={v.weeks} height={58} pace={pace} />
      <span className="v-say">{m.sentence || m.question}</span>
      {m.status === "partial" && <span className="v-note">A partial reading</span>}
    </button>
  );
}

/** This week's go-aheads (as labelled, and the ones the engine counted) over the four weeks before. */
function Approvals({ ids, mon }: { ids: string[]; mon: string }) {
  const { messages } = useMessages();
  const from = iso(new Date(new Date(mon + "T12:00:00").getTime() - 28 * 864e5));
  const flagged = new Set(ids);
  const go = (messages ?? []).filter(x => (x.intent === "go-ahead" || flagged.has(x.id)) && x.origin !== "history" && x.readWords != null && x.gap != null && x.day >= from);
  return (
    <>
      <h3 className="h4">Each go-ahead</h3>
      <p className="sub">How long Claude's reply was, against how long you took to answer it. Under the line, the go-ahead came before the reply could be read. This week is solid, the four weeks before are faint.</p>
      <Judgement now={go.filter(x => x.day >= mon)} before={go.filter(x => x.day < mon)} />
    </>
  );
}

/** Projects you worked on in the last eight weeks, busiest first. */
function recentProjects(core: Core | null) {
  if (!core) return [];
  const from = iso(new Date(Date.now() - 56 * 864e5));
  return core.projects.filter(p => p.last >= from).sort((a, b) => b.n - a.n).slice(0, 16).map(p => p.project);
}

function Drawer({ m, v, dayN, onClose }: { m: Measure; v: Vitals; dayN: number; onClose: () => void }) {
  const { core } = useData();
  const { byId } = useMessages();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); prev?.focus(); };
  }, [onClose]);
  const goal = v.goals.find(g => g.key === m.goal);
  const L = v.weeks.length, b = m.band[L - 1];
  const pace = SUMMED.has(m.key) ? soFar(m, v, dayN) : null;
  const at = v.days.indexOf(v.weeks[L - 1]);
  const week = m.daily && at >= 0 ? v.days.slice(at, at + 7).map((d, i) => ({ d, x: m.daily![at + i] ?? null })) : null;
  const max = week ? d3.max(week, w => w.x ?? 0) || 1 : 1;
  const ev = m.evidence.messages.map(id => byId.get(id)).filter((x): x is Message => !!x);
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={m.label} tabIndex={-1} ref={ref} onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <p className="kicker">{goal?.label}</p>
        <h2 className="dtitle">{m.label}</h2>
        <p className="dq">{m.question}</p>
        {m.key === "late" && <StopHour value={v.limits.stopHour} />}
        {m.key === "priorities" && <Priorities value={v.limits.priorities ?? null} projects={recentProjects(core)} />}
        {m.status === "missing" ? (
          (m.key !== "late" && m.key !== "priorities") && <p className="partial">Not measured yet: {m.note}. It will show here, with the messages behind it, once the record holds what it needs.</p>
        ) : <>
          <div className="dnow">
            <div><span>This week so far</span><b className="num">{fmtUnit(m.now, m.unit)}</b></div>
            {pace != null
              ? <div><span>Usual by this day</span><b className="num">{fmtUnit(pace, m.unit)}</b>{b && <em>A whole week: {fmtUnit(b.mid, m.unit)}, {fmtUnit(b.lo, m.unit, true)} to {fmtUnit(b.hi, m.unit, true)}</em>}</div>
              : b && <div><span>Your usual</span><b className="num">{fmtUnit(b.mid, m.unit)}</b><em>{fmtUnit(b.lo, m.unit, true)} to {fmtUnit(b.hi, m.unit, true)}</em></div>}
          </div>
          {m.sentence && <p className="dsent">{m.sentence}</p>}
          <RangeLine m={m} weeks={v.weeks} height={170} axis pace={pace} />
          {m.key === "unread" && <Approvals ids={m.evidence.messages} mon={v.weeks[L - 1]} />}
          {m.note && <p className="sub" style={{ marginTop: 10 }}>{m.status === "partial" ? "A partial reading: " : ""}{m.note}.</p>}
          {week && (
            <>
              <h3 className="h4">Day by day</h3>
              <div className="dbars">
                {week.map(w => (
                  <Link key={w.d} to={`/days/${w.d}`} className={w.x == null ? "none" : ""} title={`${fmtDay(w.d)}: ${fmtUnit(w.x, m.unit)}`}>
                    <b className="num">{w.x == null ? "" : fmtUnit(w.x, m.unit, true)}</b>
                    <i style={{ height: `${w.x == null ? 0 : Math.max(3, (w.x / max) * 72)}%` }} />
                    <span>{fmtDay(w.d, { weekday: "narrow" })}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
          <h3 className="h4">The messages behind it</h3>
          {ev.length ? (
            <ul className="evid">
              {ev.map(x => (
                <li key={x.id}>
                  <Link to={`/messages/${encodeURIComponent(x.id)}`}>
                    <span className="dot" style={{ background: famColor(x.family) }} />
                    <span className="et">{x.text.slice(0, 140) || "(no text)"}</span>
                    <span className="ew">{fmtDay(x.day, { weekday: "short" })} {fmtHour(x.hour)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="sub">No single message stands for this one; open a day to see how it went.</p>}
        </>}
      </aside>
    </div>
  );
}

/** Said when the engine predates /api/vitals or /api/week. */
function Older() {
  return (
    <div className="wrap narrow" style={{ paddingTop: "12vh" }}>
      <h1 className="title">Restart the engine</h1>
      <p className="lede">This page reads the vital signs and the week from the engine, and the one running is older than that. Stop it and start it again with <code>python3 engine/server.py</code>.</p>
    </div>
  );
}
