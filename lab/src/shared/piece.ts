import type { Mind } from "./data";
import type { Theme } from "./palette";

/** What every hero piece offers, so the lab pages and the React component drive them the same way. */
export interface Piece {
  readonly canvas: HTMLCanvasElement;
  resize(w: number, h: number, dpr: number): void;
  /** t in seconds since start, dt since the last frame. Reduced motion calls this once with dt 0. */
  frame(t: number, dt: number): void;
  setTheme(theme: Theme): void;
  setShare(on: boolean): void;
  /** What sits under the pointer, as a short line or two of HTML, or null. */
  hover(x: number, y: number): string | null;
  /** Move the subject sideways by a share of the width (0.2 = a fifth to the right), to leave room for words. */
  setShift?(x: number): void;
  /** The day (YYYY-MM-DD) under the pointer, for a click to open; optional. */
  select?(x: number, y: number): string | null;
  /** One sentence for the caption, from the data. */
  caption(): { line: string; sub: string };
  /** Small words placed on the picture (CSS pixels), redrawn every frame. */
  labels?(): { x: number; y: number; text: string; align?: "left" | "center" | "right" }[];
  dispose(): void;
}

/** intro: true always plays the piece's entrance, false never; left out, the piece decides. */
export type PieceFactory = (canvas: HTMLCanvasElement, mind: Mind, theme: Theme, opts: { share: boolean; still: boolean; intro?: boolean }) => Piece;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDay(s: string) { const d = new Date(s + "T12:00:00"); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; }
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function fmtMonth(s: string) { return MONTH[new Date(s + "T12:00:00").getMonth()]; }
export function fmtHour(h: number) { const m = Math.round(((h % 24) + 24) % 24 * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }
/** Two significant figures, so a round number stays close to the true one: 15,476 → 15,000, 2,575 → 2,600. */
export const roundN = (n: number) => { if (n < 100) return String(n); const p = 10 ** (Math.floor(Math.log10(n)) - 1); return (Math.round(n / p) * p).toLocaleString("en"); };
export const fmtN =(n: number) => n.toLocaleString("en");
export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A tooltip line for message i: always when it was sent, and what it said only outside share mode. */
export function messageTip(mind: Mind, i: number, extra = "") {
  const d = mind.days[mind.day[i]];
  const head = `<b>${fmtDay(d)}, ${fmtHour(mind.hour[i])}</b>${mind.hour[i] >= 24 ? " <span class=m>(after midnight)</span>" : ""}`;
  const det = mind.detail(i);
  if (!det) return head + (extra ? `<div class=m>${extra}</div>` : "");
  const t = det.text.replace(/\s+/g, " ").trim();
  return `${head}<div class=m>${esc(det.project)}${extra ? ", " + extra : ""}</div><div class=q>${esc(t.slice(0, 140))}${t.length > 140 ? "…" : ""}</div>`;
}
