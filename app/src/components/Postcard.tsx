import { useState } from "react";
import { useData, usePoints } from "../lib/data";

/**
 * Save a postcard: a few seconds of the strummed Loom in share mode with three true lines from the record, as a
 * video (a picture where the browser can't make one; lab/hero/postcard.ts). Always shapes and counts only, never a
 * word you wrote or a project's name. Made from the data, so it works whatever is on screen.
 */
export default function Postcard({ compact = false }: { compact?: boolean }) {
  const { core } = useData();
  const points = usePoints();
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  if (!core || !points || points === "absent") return null;
  const save = async (format: "landscape" | "portrait") => {
    setBusy(0);
    try {
      const { savePostcard } = await import("@wimym/hero");
      await savePostcard(points, core.days, { format, onProgress: setBusy });
    } finally { setBusy(null); setOpen(false); }
  };
  return (
    <div className={"postcard" + (compact ? " compact" : "")}>
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open} disabled={busy !== null}>{busy !== null ? `Making the postcard… ${Math.round(busy * 100)}%` : "Save a postcard"}</button>
      {open && busy === null && (
        <span className="pc-menu">
          <button className="pill" onClick={() => save("landscape")}>Wide, for a link or a post</button>
          <button className="pill" onClick={() => save("portrait")}>Tall, for a phone</button>
          <span className="muted">A few seconds of video. Shapes and counts only: no words, no project names.</span>
        </span>
      )}
    </div>
  );
}
