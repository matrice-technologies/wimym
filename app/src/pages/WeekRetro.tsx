import * as d3 from "d3";
import { lazy, Suspense, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import DayStrip from "../components/DayStrip";
import Loading from "../components/Loading";
import { fmtUnit, SUMMED } from "../components/Vital";
import { usualDay } from "../lib/blocks";
import { useWide } from "../lib/hooks";
import { shareOn } from "../lib/share";
import type { WeekPayload } from "@wimym/hero";
import { useData, useVitals, useWeek, useMessages } from "../lib/data";
import { famColor, fmtDate, fmtDay, fmtHour, plural } from "../lib/format";
import type { Message, WeekDay, WeekMoment } from "../lib/types";

// What each kind of moment is called, and the question the retro asks about it.
const KINDS: Record<string, [string, string]> = {
  week: ["From the week's account", "What do you make of this, looking back on the week?"],
  "latest-night": ["Latest stop", "What kept you going that late, and how was the day after?"],
  "short-night": ["Shortest night", "What cut the night short? Would you make the same trade again?"],
  "longest-day": ["Longest day", "What made this day so long, and would you choose it again?"],
  switching: ["Most scattered hour", "What pulled your attention from one session to the next here?"],
  deep: ["Longest stretch", "What made this stretch possible, and can you set it up again?"],
  unread: ["Approved unread", "Could you give these go-aheads without reading the reply, or did something slip through?"],
  stopped: ["Stopped mid-turn", "What made you stop Claude? Would a clearer first message have avoided it?"],
  corrections: ["Corrections", "What did Claude keep getting wrong? Is it worth a rule for the agents?"],
  quiet: ["Gone quiet", "Is this project parked, finished or dropped? Say which, so it stops pulling at you."],
  branches: ["Unmerged branches", "Keep, park or drop each one?"],
  abandoned: ["Left unfinished", "Was this session dropped on purpose?"],
  high: ["A high point", "What made this a high point, and what would bring more of it?"],
  low: ["A low point", "What made this a low point? Was it the work, or something around it?"],
  decided: ["Decided", "Does this decision still hold?"],
  dropped: ["Dropped", "Was dropping it the right call?"],
  postponed: ["Put off", "When will you come back to this, or will you?"],
};
const LOOSE = new Set(["quiet", "branches", "abandoned"]);
// The week's form loads after the page, like the planet.
const WeekForm = lazy(() => import("@wimym/hero").then(m => ({ default: m.WeekForm })));

/** The retro's page: a few moments from the week, each with its messages and a question. */
export default function WeekRetro() {
  const { core } = useData();
  const [params, setParams] = useSearchParams();
  const wide = useWide();
  const [caption, setCaption] = useState<{ line: string; sub: string } | null>(null);
  const start = params.get("start");
  const vitals = useVitals();
  const wk = useWeek(start);
  if (wk === "absent") return <p className="partial" style={{ margin: "12vh auto 0" }}>This week isn't in the record, or the engine running is older than this page.</p>;
  if (!core || !wk) return <Loading label="Opening the week" />;

  const weeks = vitals && vitals !== "absent" ? vitals.weeks : [];
  const i = weeks.indexOf(wk.week);
  const go = (w: string | undefined) => w && setParams(w === weeks[weeks.length - 1] ? {} : { start: w });
  const days = d3.range(7).map(k => d3.timeFormat("%Y-%m-%d")(new Date(new Date(wk.week + "T12:00:00").getTime() + k * 864e5)));
  const byDay = new Map(wk.days.map(d => [d.day, d]));
  const usual = usualDay(core.days, wk.week);
  // the week account's own moments (key "week") lead as the retro's main ones; others fill up to three
  const kind = (m: WeekMoment) => m.key ?? m.kind;
  const own = wk.moments.filter(m => kind(m) === "week");
  const rest = wk.moments.filter(m => kind(m) !== "week" && !LOOSE.has(kind(m)));
  const main = [...own, ...rest.slice(0, Math.max(0, 3 - own.length))];
  const more = rest.slice(Math.max(0, 3 - own.length));
  const loose = wk.moments.filter(m => LOOSE.has(kind(m)));
  const counted = wk.vitals.filter(v => v.status !== "missing" && v.value != null && (wk.complete || !SUMMED.has(v.key)));
  const out = counted.filter(v => v.flag || v.side).sort((a, b) => Number(!!b.flag) - Number(!!a.flag));
  const inside = counted.filter(v => !v.flag && !v.side);
  const told = wk.account?.account ? wk.summary : null;  // the week's written account, when there is one

  return (
    <div className="wrap retro">
      {/* the week's form: one living shape moved by its signs (lab/hero); it stays mounted and morphs between weeks */}
      <section className="wform band dark" aria-label="This week's signs, as one form">
        <div className="wf-stage">
          <Suspense fallback={null}>
            <WeekForm week={wk as unknown as WeekPayload} vitals={vitals && vitals !== "absent" ? vitals : undefined} share={shareOn}
              shift={wide ? 0.2 : 0} onCaption={setCaption} style={{ position: "absolute", inset: 0 }} />
          </Suspense>
        </div>
        <div className="wf-words">
          <nav className="weeknav" aria-label="Weeks">
            <button className="pill" disabled={i <= 0} onClick={() => go(weeks[i - 1])}>Week before</button>
            <button className="pill" disabled={i < 0 || i >= weeks.length - 1} onClick={() => go(weeks[i + 1])}>Week after</button>
          </nav>
          <p className="kicker">{wk.complete ? "A week of your record" : "This week, so far"}</p>
          <h1 className="title">The week of {fmtDay(wk.week, { day: "numeric", month: "long" })}</h1>
          <p className="wf-line" key={caption?.line}>{caption?.line || "\u00a0"}</p>
          {caption?.sub && <p className="wf-sub" key={caption.sub}>{caption.sub}</p>}
        </div>
      </section>
      <div className="retro-body">
      {told ? <><Account text={told} lead />{wk.figures && <p className="figures">{wk.figures}</p>}</>
        : (wk.figures || wk.summary) && <p className="lede wsum">{wk.figures || wk.summary}</p>}
      <p className="sub">A few moments worth looking at, each with the messages that make it up and a question. What they mean, and whether anything should change, is yours to say.</p>

      {out.length > 0 && (
        <div className="outside">
          <span>Outside your range {wk.complete ? "this week" : "so far"}</span>
          {out.map(v => (
            <span key={v.key} className={"chip " + ((v.flag ?? v.side) === "above" ? "up" : "down") + (v.flag ? " twice" : "")}
              title={(v.flag ? "Outside two weeks running. " : "") + (v.band ? `Your usual: ${fmtUnit(v.band.lo, v.unit, true)} to ${fmtUnit(v.band.hi, v.unit, true)}` : "")}>
              {v.label} <b className="num">{fmtUnit(v.value, v.unit, true)}</b>{v.band && <em>usually {fmtUnit(v.band.mid, v.unit, true)}</em>}
            </span>
          ))}
        </div>
      )}
      {inside.length > 0 && (
        <details className="inside">
          <summary>Inside your range: {inside.length} more</summary>
          <div className="outside">{inside.map(v => (
            <span key={v.key} className="chip">{v.label} <b className="num">{fmtUnit(v.value, v.unit, true)}</b>{v.band && <em>usually {fmtUnit(v.band.mid, v.unit, true)}</em>}</span>
          ))}</div>
        </details>
      )}

      {main.length ? (
        <ol className="momentlist">
          {main.map((m, k) => <MomentCard key={k} m={m} day={m.day ? byDay.get(m.day) : undefined} usual={usual} />)}
        </ol>
      ) : (
        <div className="empty"><h2 className="section">Nothing stands out yet</h2><p>No moment of this week ranks against your earlier weeks. The days are below.</p></div>
      )}

      {(more.length > 0 || Object.values(wk.more ?? {}).some(ms => ms.length)) && (
        <section className="also">
          <h2 className="section">Also this week</h2>
          <ul>{more.map((m, k) => <Also key={k} m={m} />)}</ul>
          {Object.entries(wk.more ?? {}).filter(([, ms]) => ms.length).map(([k, ms]) => <More key={k} k={k} ms={ms} />)}
        </section>
      )}

      {loose.length > 0 && (
        <section className="also">
          <h2 className="section">Loose ends</h2>
          <p className="sub">Work that went quiet without a decision. Keep, park or drop: deciding is what lets it go.</p>
          <ul>{loose.map((m, k) => <Also key={k} m={m} />)}</ul>
        </section>
      )}

      <h2 className="section" style={{ marginTop: 64 }}>Day by day</h2>
      <p className="sub">Each line runs from 05:00 to 05:00. The wash is your usual day{usual ? `, ${fmtHour(usual.start)} to ${fmtHour(usual.end)}` : ""}; time past its end is drawn warm.</p>
      <ul className="weekdays">
        <li className="wd-axis" aria-hidden="true"><span /><span className="wd-hours">{["06", "12", "18", "00"].map((h, k) => <em key={h} style={{ left: `${((1 + k * 6) / 24) * 100}%` }}>{h}</em>)}</span><span /></li>
        {days.map(d => {
          const r = byDay.get(d);
          return (
            <li key={d} className={!r ? "later" : r.off ? "off" : ""}>
              <Link to={`/days/${d}`}>
                <span className="wd-name"><b>{fmtDay(d, { weekday: "long" })}</b><span className="muted">{fmtDay(d, { day: "numeric", month: "short" })}</span></span>
                {r && !r.off ? <DayStrip blocks={r.blocks ?? []} usual={usual} /> : <span className="wd-none">{r ? "A day off" : ""}</span>}
                <span className="wd-n num">{r && !r.off && r.active != null ? `${r.active.toFixed(1)} h` : ""}<em>{r && !r.off && r.night != null ? `after ${r.night.toFixed(1)} h of night` : ""}</em></span>
              </Link>
              {r?.account && <Account text={r.account} />}
            </li>
          );
        })}
      </ul>
      </div>
    </div>
  );
}

function MomentCard({ m, day, usual }: { m: WeekMoment; day?: WeekDay; usual: { start: number; end: number } | null }) {
  const { byId } = useMessages();
  const [all, setAll] = useState(false);
  const ms = m.messages.map(id => byId.get(id)).filter((x): x is Message => !!x);
  const [name, ask] = KINDS[m.kind] ?? [m.kind, null];
  const question = m.question || ask;
  const mark: [number, number] | null = m.kind === "latest-night" && day?.last != null ? [day.last - 0.1, day.last]
    : m.kind === "short-night" && day?.first != null ? [day.first, day.first + 0.1]
    : m.kind === "longest-day" && day?.first != null && day.last != null ? [day.first, day.last] : null;
  const many = new Set(ms.map(x => x.day)).size > 1;
  return (
    <li className="moment">
      <p className="mk">{name}{m.day ? `, ${fmtDay(m.day, { weekday: "long" })}` : ""}</p>
      <h2 className="mreason">{m.reason}</h2>
      {m.unusual != null && <p className="sub">{rank(m)}</p>}
      {day?.blocks && <div className="mstrip"><DayStrip blocks={day.blocks} usual={usual} height={22} mark={mark} /></div>}
      {ms.length > 0 && (
        <ul className="evid">
          {(all ? ms : ms.slice(0, 4)).map(x => (
            <li key={x.id}><Link to={`/messages/${encodeURIComponent(x.id)}`}>
              <span className="dot" style={{ background: famColor(x.family) }} />
              <span className="et">{x.text.slice(0, 220) || "(no text)"}</span>
              <span className="ew">{many ? fmtDay(x.day, { weekday: "short" }) + " " : ""}{fmtHour(x.hour)}</span>
            </Link></li>
          ))}
        </ul>
      )}
      {ms.length > 4 && <button className="link more" onClick={() => setAll(!all)}>{all ? "Fewer" : `All ${plural(ms.length, "message")}`}</button>}
      {question && <p className="question">{question}</p>}
    </li>
  );
}

function rank(m: WeekMoment) {
  const p = Math.round((m.unusual ?? 0) * 100);
  const what = m.kind === "short-night" ? "shorter than" : m.kind === "latest-night" ? "later than" : "longer than";
  return p >= 50 ? `${what[0].toUpperCase() + what.slice(1)} ${p}% of your days in the eight weeks before.` : `An ordinary day by your eight weeks before: ${what} ${p}% of them.`;
}

function Also({ m }: { m: WeekMoment }) {
  const [open, setOpen] = useState(false);
  const { byId } = useMessages();
  const ms = m.messages.map(id => byId.get(id)).filter((x): x is Message => !!x);
  const [name, ask] = KINDS[m.kind] ?? [m.kind, null];
  const question = m.question || ask;
  const can = ms.length > 0 || !!m.branches?.length;
  return (
    <li className={open ? "open" : ""}>
      <button className="ahead" onClick={() => can && setOpen(!open)} aria-expanded={open} disabled={!can}>
        <span className="ak">{name}</span><span className="ar">{m.reason}</span>
      </button>
      {open && (
        <div className="abody">
          {ms.length > 0 && <ul className="evid">{ms.map(x => (
            <li key={x.id}><Link to={`/messages/${encodeURIComponent(x.id)}`}>
              <span className="dot" style={{ background: famColor(x.family) }} />
              <span className="et">{x.text.slice(0, 200) || "(no text)"}</span>
              <span className="ew">{fmtDay(x.day, { weekday: "short", day: "numeric", month: "short" })}</span>
            </Link></li>))}</ul>}
          {m.branches && m.branches.length > 0 && (
            <ul className="branches">{m.branches.slice(0, 40).map(b => (
              <li key={b.project + b.name}><b>{b.project}</b><code>{b.name}</code><span className="muted num">{plural(b.ahead, "commit")} ahead, last {fmtDate(b.last)}</span></li>
            ))}{m.branches.length > 40 && <li className="muted">and {m.branches.length - 40} more</li>}</ul>
          )}
          {question && <p className="question small">{question}</p>}
        </div>
      )}
    </li>
  );
}

/** A day's account, a model's reading of it, with its [id8] citations opening their messages. */
function Account({ text, lead = false }: { text: string; lead?: boolean }) {
  const { messages } = useMessages();
  const parts = text.split(/(\[[0-9a-z-]{6,12}\])/i);
  const find = (p: string) => (messages ?? []).find(m => m.id.startsWith(p));
  return (
    <p className={lead ? "account lead" : "account"}>
      {parts.map((t, i) => {
        const m = /^\[([0-9a-z-]{6,12})\]$/i.exec(t);
        if (!m) return <span key={i}>{t}</span>;
        const hit = find(m[1]);
        return hit ? <Link key={i} className="cite" to={`/messages/${encodeURIComponent(hit.id)}`} title={hit.text.slice(0, 120)}>{fmtHour(hit.hour)}</Link> : null;
      })}
      <em> A reading by a model, not checked.</em>
    </p>
  );
}

/** The day-account moments beyond the ones picked for the week, one quiet fold per kind. */
function More({ k, ms }: { k: string; ms: WeekMoment[] }) {
  const [open, setOpen] = useState(false);
  const name = (KINDS[k]?.[0] ?? k).toLowerCase();
  return open
    ? <ul>{ms.map((m, i) => <Also key={i} m={m} />)}</ul>
    : <button className="link showmore" onClick={() => setOpen(true)}>Show {ms.length} more: {name}</button>;
}
