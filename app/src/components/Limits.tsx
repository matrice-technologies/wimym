import { useState } from "react";
import { saveLimits } from "../lib/data";
import { fmtHour } from "../lib/format";
import { shareOn } from "../lib/share";

const HOURS = Array.from({ length: 17 }, (_, i) => 16 + i * 0.5);  // 16:00 to 24:00

/** The stopping hour you mean to keep to: set, changed or removed from the page, kept on this Mac. */
export function StopHour({ value, compact = false }: { value: number | null; compact?: boolean }) {
  const [edit, setEdit] = useState(false);
  const [h, setH] = useState(value ?? 21);
  const [msg, setMsg] = useState("");
  const save = async (v: number | null) => {
    setMsg("Saving…");
    try { await saveLimits({ stopHour: v }); setMsg(v == null ? "Removed." : "Saved. The page catches up in a moment."); setEdit(false); }
    catch (e) { setMsg((e as Error).message); }
  };
  if (!edit) return (
    <p className={"limit" + (compact ? " compact" : "")}>
      {value == null
        ? <>No stopping hour set. {!shareOn && <button className="link" onClick={() => setEdit(true)}>Set one</button>}</>
        : <>You mean to stop by <b className="num">{fmtHour(value)}</b>. {!shareOn && <button className="link" onClick={() => setEdit(true)}>Change</button>}</>}
      {msg && <span className="muted"> {msg}</span>}
    </p>
  );
  return (
    <div className={"limit edit" + (compact ? " compact" : "")}>
      <label>Stop by
        <select value={h} onChange={e => setH(Number(e.target.value))}>
          {HOURS.map(x => <option key={x} value={x}>{x === 24 ? "midnight" : fmtHour(x)}</option>)}
        </select>
      </label>
      <button className="pill on" onClick={() => save(h)}>Save</button>
      {value != null && <button className="pill" onClick={() => save(null)}>Remove</button>}
      <button className="link" onClick={() => setEdit(false)}>Cancel</button>
      {msg && <span className="muted">{msg}</span>}
      <p className="sub">Time after it counts as late, the spiral draws it warm, and later Wimym can say so at the moment.</p>
    </div>
  );
}

/** The projects you said matter most, against which time is weighed. */
export function Priorities({ value, projects }: { value: string[] | null; projects: string[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(value ?? []));
  const [msg, setMsg] = useState("");
  const toggle = (p: string) => { const n = new Set(sel); if (n.has(p)) n.delete(p); else n.add(p); setSel(n); };
  const save = async () => {
    setMsg("Saving…");
    try { await saveLimits({ priorities: sel.size ? [...sel] : null }); setMsg("Saved. The page catches up in a moment."); }
    catch (e) { setMsg((e as Error).message); }
  };
  if (shareOn) return <p className="limit muted">Share mode is on: priorities can't be changed while project names are hidden.</p>;
  return (
    <div className="limit edit prio">
      <p className="sub">Pick the projects that matter most right now. Time on them is weighed against the rest, week by week.</p>
      <div className="prios">
        {projects.map(p => (
          <label key={p} className={"chip" + (sel.has(p) ? " on" : "")}>
            <input type="checkbox" checked={sel.has(p)} onChange={() => toggle(p)} />{p}
          </label>
        ))}
      </div>
      <button className="pill on" onClick={save}>Save priorities</button>
      {msg && <span className="muted"> {msg}</span>}
    </div>
  );
}
