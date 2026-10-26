import type { Mind } from "./data";
import type { Theme } from "./palette";

/** What every hero piece offers, so the lab pages and the React component drive them the same way. */
export interface Piece {
  readonly canvas: HTMLCanvasElement;
  resize(w: number, h: number, dpr: number): void;
  /** t in seconds since start, dt since the last frame. Reduced motion calls this once with dt 0. */
  frame(t: number, dt: number): void;
  setShare(on: boolean): void;
  /** What sits under the pointer, as a short line or two of HTML, or null. */
  hover(x: number, y: number): string | null;
  /** Move the subject sideways by a share of the width (0.2 = a fifth to the right), to leave room for words. */
  setShift?(x: number): void;
  /** The day (YYYY-MM-DD) under the pointer, for a click to open; optional. */
  select?(x: number, y: number): string | null;
  /** One sentence for the caption, from the data; scale, rows to set under it (the Loom's lines, pages and books). */
  caption(): { line: string; sub: string; scale?: string[] };
  /** Small words placed on the picture (CSS pixels), redrawn every frame; alpha fades one out. */
  labels?(): { x: number; y: number; text: string; align?: "left" | "center" | "right"; alpha?: number }[];
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
/** Tokens, rounded as roundN does, in millions from what rounds to a million: 870,000, 1 million, 1.7 million, 98 million. */
export const fmtTokens = (n: number) => (n < 995_000 ? roundN(Math.round(n)) : `${n < 1e7 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") : Math.round(n / 1e6)} million`);
// What tokens would fill, in things a reader can hold: a token is about three quarters of a word, a line ten words, a
// page thirty lines, a book three hundred pages (90,000 words).
const WORDS_PER_TOKEN = 0.75;
const SCALE = [{ one: "line", words: 10 }, { one: "page", words: 300 }, { one: "book", words: 90_000 }];
/** The lines, pages and books tokens would fill, one row for each filled at least once: "≈ 25,000 lines",
 * "≈ 850 pages", "≈ 2.8 books"; "≈ 11 million lines" from a million. */
export function tokenScale(tokens: number) {
  const words = tokens * WORDS_PER_TOKEN;
  return SCALE.filter(u => words >= u.words).map(u => {
    const x = words / u.words, s = x < 9.95 ? x.toFixed(1).replace(/\.0$/, "") : fmtTokens(x);
    return `≈ ${s} ${u.one}${s === "1" ? "" : "s"}`;
  });
}
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
