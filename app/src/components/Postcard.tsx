import { useRef, useState } from "react";
import { useData, usePoints } from "../lib/data";

type PostcardDay = { day: string; date: string; today: boolean };
type Names = "hidden" | "anonymous" | "shown";
const NAMES: [Names, string][] = [["hidden", "Hidden"], ["anonymous", "Project A, B…"], ["shown", "Real names"]];

// the names choice and whose mind it is, remembered in this browser
const recall = (k: string) => { try { return localStorage.getItem("wimym.postcard." + k); } catch { return null; } };
const keep = (k: string, v: string) => { try { localStorage.setItem("wimym.postcard." + k, v); } catch { /* not kept */ } };

/**
 * Save a postcard of a day: the strummed Loom in share mode weaving that day from its first message to its last, with
 * three true lines about it (lab/hero/postcard.ts). Your last active day unless `day` says otherwise, and any day with a
 * message on it can be picked from the menu, as can how its projects are named under the loom and whose mind it asks
 * about ("Where is Alex's mind?"). First as a page, one small HTML file that plays the day live in any
 * browser; a video where a page can't go (a picture where the browser can't make one). Always shapes and counts only,
 * never a word you wrote, and a project's own name only when you choose it. Made from the data, so it works whatever is
 * on screen.
 */
export default function Postcard({ compact = false, day: initial }: { compact?: boolean; day?: string }) {
  const { core } = useData();
  const points = usePoints();
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<PostcardDay[] | null>(null);
  const [at, setAt] = useState(-1);
  const pick = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<Names>(() => (recall("names") as Names) || "anonymous");
  const [who, setWho] = useState(() => recall("who") ?? "");
  const pts = points && points !== "absent" ? points : null;
  if (!core || !pts) return null;
  const toggle = async () => {
    // the days it can tell, worked out when the menu first opens; it starts on the one asked for, else the last
    if (!open && !days) {
      const { postcardDays } = await import("@wimym/hero");
      const list = postcardDays(pts, core.days);
      setDays(list);
      setAt(nearest(list, initial));
    }
    setOpen(!open);
  };
  const chosen = days?.[at];
  const save = async (kind: "page" | "landscape" | "portrait") => {
    setBusy(0);
    try {
      const hero = await import("@wimym/hero");
      const opts = { day: chosen?.day, names, who };
      if (kind === "page") await hero.savePostcardPage(pts, core.days, opts);
      else await hero.savePostcard(pts, core.days, { ...opts, format: kind, onProgress: setBusy });
    } finally { setBusy(null); setOpen(false); }
  };
  const last = days ? at === days.length - 1 : false;
  return (
    <div className={"postcard" + (compact ? " compact" : "")}>
      <button className="link" onClick={toggle} aria-expanded={open} disabled={busy !== null}>{busy !== null ? `Making the postcard… ${Math.round(busy * 100)}%` : "Save a postcard"}</button>
      {open && busy === null && days && chosen && (
        <span className="pc-menu">
          <span className="pc-day">
            <button className="pc-step" onClick={() => setAt(at - 1)} disabled={at <= 0} aria-label="The day before, with messages">←</button>
            <button className="pc-date" onClick={() => pick.current?.showPicker?.()} title="Pick another day">
              {chosen.today ? "Today so far" : chosen.date}
            </button>
            <button className="pc-step" onClick={() => setAt(at + 1)} disabled={last} aria-label="The day after, with messages">→</button>
            <span className="pc-note">{chosen.today ? chosen.date : last ? "your last day at it" : ""}</span>
            <input ref={pick} type="date" className="pc-pick" tabIndex={-1} aria-hidden="true" value={chosen.day} min={days[0].day} max={days[days.length - 1].day}
              onChange={e => e.target.value && setAt(nearest(days, e.target.value))} />
          </span>
          <label className="pc-row">
            <span className="pc-label">Whose mind</span>
            <input className="pc-who" value={who} placeholder="your" maxLength={40} aria-describedby="pc-q"
              onChange={e => { setWho(e.target.value); keep("who", e.target.value); }} />
            <span className="pc-q" id="pc-q">{question(who)}</span>
          </label>
          <span className="pc-row" role="radiogroup" aria-label="Project names under the loom">
            <span className="pc-label">Project names</span>
            {NAMES.map(([k, label]) => (
              <button key={k} className={"pill" + (names === k ? " on" : "")} role="radio" aria-checked={names === k}
                onClick={() => { setNames(k); keep("names", k); }}>{label}</button>
            ))}
          </span>
          <button className="pill on" onClick={() => save("page")}>A page that plays it live</button>
          <span className="pc-or">or a video:</span>
          <button className="pill" onClick={() => save("landscape")}>Wide</button>
          <button className="pill" onClick={() => save("portrait")}>Tall, for a phone</button>
          <span className="muted">The day woven message by message. Shapes and counts only, never a word you wrote{names === "shown" ? "; your projects' own names are on it" : names === "anonymous" ? "; projects lettered, not named" : ", no project names"}.</span>
        </span>
      )}
    </div>
  );
}

/** The postcard's question, as lab/hero's postcardQuestion puts it. */
function question(who: string) {
  const w = who.trim();
  return `Where is ${w ? `${w}${/s$/i.test(w) ? "'" : "'s"}` : "your"} mind?`;
}

/** The day asked for if a postcard can tell it, else the nearest before it with messages (after it, if none is before);
 * the last day when none is asked for. */
function nearest(days: PostcardDay[], want?: string) {
  if (!want) return days.length - 1;
  let i = days.length - 1;
  while (i > 0 && days[i].day > want) i--;
  return days[i].day > want ? 0 : i;
}
