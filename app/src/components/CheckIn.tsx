import { useState } from "react";
import { saveCheckin, useData } from "../lib/data";
import { shareOn } from "../lib/share";
import { fmtDay } from "../lib/format";
import type { Check } from "../lib/types";

const SCALES: [keyof Check, string, string, string][] = [
  ["energy", "Energy", "drained", "full of it"],
  ["mood", "Mood", "low", "great"],
  ["focus", "Focus", "scattered", "deep"],
];

/** How a day felt, in three taps and a word. Kept on this Mac (~/.wimym/checkins.json). */
export default function CheckIn({ day, check, compact }: { day: string; check?: Check; compact?: boolean }) {
  const { reload } = useData();
  const [c, setC] = useState<Check>(check || {});
  const [note, setNote] = useState(check?.note || "");
  const [msg, setMsg] = useState("");
  const save = async (body: Record<string, unknown>) => {
    try {
      const r = await saveCheckin({ day, ...body });
      setC(r || {});
      setMsg("Saved");
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <div className={"checkin" + (compact ? " compact" : "")}>
      {SCALES.map(([k, name, lo, hi]) => (
        <div className="ci-row" key={k}>
          <span className="ci-name">{name}</span>
          <span className="ci-scale" role="radiogroup" aria-label={name}>
            {[1, 2, 3, 4, 5].map(v => (
              <button key={v} role="radio" aria-checked={c[k] === v} className={c[k] === v ? "on" : ""}
                title={v === 1 ? lo : v === 5 ? hi : String(v)}
                disabled={shareOn} onClick={() => save({ [k]: c[k] === v ? null : v })}>{v}</button>
            ))}
          </span>
          {!compact && <span className="ci-ends muted">1 {lo}, 5 {hi}</span>}
        </div>
      ))}
      {!compact && (
        <div className="ci-row">
          <span className="ci-name">A word</span>
          <input id={`note-${day}`} className="ci-note" value={note} readOnly={shareOn} maxLength={500} placeholder={`What made ${fmtDay(day, { weekday: "long" })}?`}
            onChange={e => setNote(e.target.value)} onBlur={() => note !== (c.note || "") && save({ note })}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </div>
      )}
      <span className="ci-msg muted" aria-live="polite">{shareOn ? "Share mode is on: nothing can be changed here." : msg}</span>
    </div>
  );
}
