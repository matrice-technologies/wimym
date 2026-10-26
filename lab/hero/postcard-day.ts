// The day a postcard tells: the last day with a message on it, woven from its first message to its last. What the film,
// the picture and the page share, and all the page carries: the shapes of that day and the two before it (for the
// columns and sessions it opens on), counts and times only, packed small.
import { monday, type DayRow, type Mind } from "../src/shared/data";
import { DARK } from "../src/shared/palette";
import { fmtHour, fmtTokens, tokenScale } from "../src/shared/piece";
import { Strum } from "../src/pieces/loom-strum";

const BEFORE = 2;          // days of shapes kept before the day, for the columns and sessions it opens on
const LEAD = 30;           // messages before the day woven out of sight, so the loom opens lit and its aurora gathered
const fmt = (n: number) => n.toLocaleString("en");
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Thursday 22 October". */
export function longDay(s: string) { const d = new Date(s + "T12:00:00"); return `${DOW[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`; }

/** The last day with a message on it, as an index into mind.days; -1 when there is none. */
export function lastActiveDay(m: Mind) {
  let d = -1;
  for (let i = 0; i < m.n; i++) d = Math.max(d, m.day[i]);
  return d;
}

/** What the columns under the loom are called: not at all, Project A, B, C (by how busy each was on the day), or by
 * their own names. */
export type PostcardNames = "hidden" | "anonymous" | "shown";

/** The shapes of day d and the BEFORE days before it, and nothing after: a mind whose last day is d. Its projects are
 * named as `names` says; hidden or anonymous, no project's own name is in it. */
export function dayMind(m: Mind, d: number, names: PostcardNames = "hidden"): Mind {
  const from = Math.max(0, d - BEFORE), keep: number[] = [];
  for (let i = 0; i < m.n; i++) if (m.day[i] >= from && m.day[i] <= d) keep.push(i);
  const pick = <T extends Uint16Array | Float32Array | Uint8Array | Int8Array>(a: T, make: (n: number) => T) => { const o = make(keep.length); keep.forEach((i, k) => (o[k] = a[i])); return o; };
  const days = m.days.slice(from, d + 1);
  return {
    synthetic: m.synthetic, days, weeks: [...new Set(days.map(monday))], fullFrom: Math.max(0, m.fullFrom - from), n: keep.length,
    day: Uint16Array.from(keep, i => m.day[i] - from), hour: pick(m.hour, n => new Float32Array(n)), project: pick(m.project, n => new Uint8Array(n)),
    family: pick(m.family, n => new Int8Array(n)), words: pick(m.words, n => new Uint16Array(n)),
    session: m.session ? Int32Array.from(keep, i => m.session![i]) : undefined, out: m.out ? pick(m.out, n => new Float32Array(n)) : undefined,
    projects: m.projects, perDay: m.perDay.slice(from, d + 1), detail: () => null, name: namer(m, keep, d, names),
  };
}
function namer(m: Mind, keep: number[], d: number, names: PostcardNames): (p: number) => string | null {
  if (names === "hidden") return () => null;
  if (names === "shown") { const own = new Map(keep.map(i => [m.project[i], m.name?.(m.project[i]) ?? null])); return p => own.get(p) ?? null; }
  // the busiest on the day first, then the days before
  const on = new Map<number, number>(), before = new Map<number, number>();
  for (const i of keep) { const p = m.project[i], c = m.day[i] === d ? on : before; c.set(p, (c.get(p) ?? 0) + 1); }
  const order = [...new Set(keep.map(i => m.project[i]))].sort((a, b) => (on.get(b) ?? 0) - (on.get(a) ?? 0) || (before.get(b) ?? 0) - (before.get(a) ?? 0));
  const letter = new Map(order.map((p, k) => [p, k < 26 ? `Project ${String.fromCharCode(65 + k)}` : `Project ${k + 1}`]));
  return p => letter.get(p) ?? null;
}

/** What a postcard may say about day d, all from the record: counts and times only. */
export function dayFacts(m: Mind, d = lastActiveDay(m)) {
  let n = 0, start = Infinity, end = -Infinity, after9 = 0;
  const projects = new Set<number>();
  for (let i = 0; i < m.n; i++) {
    if (m.day[i] !== d) continue;
    n++; start = Math.min(start, m.hour[i]); end = Math.max(end, m.hour[i]); projects.add(m.project[i]);
    if (m.hour[i] >= 21) after9++;
  }
  // the run of days in a row that ends on it
  let streak = 0;
  for (let k = d; k >= 0 && m.perDay[k]?.n; k--) streak++;
  const row = m.perDay[d];
  return { day: m.days[d], n, start, end, active: row?.active || 0, projects: projects.size, after9, streak: Math.max(streak, n ? 1 : 0) };
}

/** Three short true lines about the day, and the date they are about. */
export function dayLines(m: Mind, d = lastActiveDay(m)): { date: string; lines: string[] } {
  const f = dayFacts(m, d);
  const hours = f.active >= 1 ? `${f.active.toFixed(1).replace(/\.0$/, "")} hours` : `${Math.round(f.active * 60)} minutes`;
  return {
    date: longDay(f.day),
    lines: [
      `${fmt(f.n)} message${f.n === 1 ? "" : "s"} to AI agents, in one day.`,
      f.n === 1 ? `At ${fmtHour(f.start)}, in one project.`
        // a few messages far apart make a long day with little time at it: then the span alone
        : `From ${fmtHour(f.start)} to ${fmtHour(f.end)}${f.active >= 0.5 ? `: ${hours} at it,` : ","} ${f.projects === 1 ? "in one project" : `across ${f.projects} projects`}.`,
      f.streak >= 7 ? `The ${ordinal(f.streak)} day in a row.` : f.after9 ? `${fmt(f.after9)} sent after 9 pm.` : "Not one sent after 9 pm.",
    ],
  };
}
function ordinal(n: number) { const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"; return n + s; }

/** The strummed Loom for a postcard, in share mode: shapes only, no names or days on it; the aurora painted in step,
 * so a film made faster than it plays has it in every frame. Tall, the fell sits higher, clear of the lines. */
export function postcardLoom(mind: Mind, W: number, H: number, dpr = 2, canvas = document.createElement("canvas"), names = false) {
  const loom = new Strum(canvas, mind, DARK, true, false, { mass: true, colour: "type", words: false, names, worker: false, wheel: false });
  fitLoom(loom, W, H, dpr);
  return loom;
}
/** The columns' names under the loom, on the patches it laid for them: drawn on its own canvas after each frame. */
export function drawNames(loom: Strum) {
  if (!loom.onlyNames || !loom.names.length) return;
  const g = loom.g;
  g.save();
  g.setTransform(loom.dpr, 0, 0, loom.dpr, 0, 0);
  g.font = loom.font; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = DARK.ink;
  for (const l of loom.names) { g.globalAlpha = 0.72 * l.alpha; g.fillText(l.text, l.x, l.y); }
  g.restore();
}
/** Size the postcard's loom to W by H. */
export function fitLoom(loom: Strum, W: number, H: number, dpr: number) {
  loom.resize(W, H, dpr);
  if (W / H <= 1.25) loom.fell = H * 0.6;
}

/** Seconds the day takes to weave on a postcard: longer for a fuller day, never more than ten. */
export const weaveSeconds = (picks: number) => Math.min(10, Math.max(4, 3 + picks * 0.025));

/** Ready the loom to weave its last day: the messages before it woven out of sight and a hand swept across, so it
 * opens lit, and a pace that weaves the whole day in weaveSeconds. Returns the loom's time and the day's first pick. */
export function openDay(loom: Strum) {
  const n = loom.A.length, start = dayStart(loom);
  const t = loom.pose(LEAD, n - start);
  loom.pace = Math.max(1, loom.weaveTime(start) / weaveSeconds(n - start));
  return { t, start };
}

/** The day's first pick: the first message on the loom's last day. */
export function dayStart(loom: Strum) {
  const L = loom.mind.days.length - 1, k = loom.order.findIndex(i => loom.mind.day[i] === L);
  return k < 0 ? loom.A.length : k;
}

/** Where the day is, as it weaves: the time of the last message woven, how many of the day's are in, and the output
 * tokens Claude wrote on their turns (null when the record has none). */
export function dayClock(loom: Strum, start: number) {
  const n = loom.A.length, k = Math.max(start, Math.min(loom.cur, n) - 1), o = loom.mind.out;
  let tokens: number | null = null;
  if (o) for (let j = start; j < Math.min(loom.cur, n); j++) { const x = o[loom.order[j]]; if (!Number.isNaN(x)) tokens = (tokens ?? 0) + x; }
  return { time: k < n ? fmtHour(loom.mind.hour[loom.order[k]]) : "", woven: Math.max(0, Math.min(loom.cur, n) - start), of: n - start, tokens };
}
/** The clock's second line: "12 of 159 messages", and "· 340,000 tokens" once any are known. */
export function clockLine(c: ReturnType<typeof dayClock>) {
  return `${fmt(c.woven)} of ${fmt(c.of)} messages${c.tokens != null ? ` · ${fmtTokens(c.tokens)} tokens` : ""}`;
}
/** The rows under the clock's tokens, one more as each is filled: "≈ 25,000 lines", then "≈ 850 pages", then
 * "≈ 2.8 books". None while the tokens aren't known. */
export const clockScale = (c: ReturnType<typeof dayClock>) => tokenScale(c.tokens ?? 0);

/** The day's shapes as the page carries them: per message its day, minute, project rank, type and Claude's output tokens
 * (null unknown). */
export interface Packed { days: string[]; perDay: DayRow[]; fullFrom: number; projects: number; day: number[]; minute: number[]; project: number[]; family: number[]; out?: (number | null)[]; names?: Record<number, string> }
export function pack(m: Mind): Packed {
  const per = m.perDay.map(r => ({ ...r, active: Math.round(r.active * 100) / 100 }));
  // the names of the projects in it, when it has any: only the ones the loom can show
  const names: Record<number, string> = {};
  for (const p of new Set(m.project)) { const n = m.name?.(p); if (n) names[p] = n; }
  return { days: m.days, perDay: per, fullFrom: m.fullFrom, projects: m.projects, day: [...m.day], minute: Array.from(m.hour, h => Math.round(h * 60)), project: [...m.project], family: [...m.family],
    ...(m.out ? { out: Array.from(m.out, x => (Number.isNaN(x) ? null : x)) } : {}), ...(Object.keys(names).length ? { names } : {}) };
}
export function unpack(p: Packed): Mind {
  const n = p.day.length;
  return {
    synthetic: false, days: p.days, weeks: [...new Set(p.days.map(monday))], fullFrom: p.fullFrom, n,
    day: Uint16Array.from(p.day), hour: Float32Array.from(p.minute, x => x / 60), project: Uint8Array.from(p.project),
    family: Int8Array.from(p.family), words: new Uint16Array(n).fill(12), out: p.out ? Float32Array.from(p.out, x => x ?? NaN) : undefined, projects: p.projects, perDay: p.perDay,
    detail: () => null, name: q => p.names?.[q] ?? null,
  };
}
