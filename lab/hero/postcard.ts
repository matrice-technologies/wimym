// The postcard: the last day you were at it, woven from its first message to its last on the strummed Loom under its
// aurora, with the question and three true lines about that day. As a page (one small HTML file that weaves the day
// live), an MP4 to post, or a PNG where the browser can't encode video. Always in share mode: no message text, no
// project names, nothing anyone wrote. Only counts and times, computed here from the same shapes the Loom is drawn from.
/// <reference path="./virtual.d.ts" />
import { mindFrom, mindFromPoints, tokensIn, type Mind, type PointsPayload, type RawDay, type RawMessage } from "../src/shared/data";
import { DARK } from "../src/shared/palette";
import { SWEEP_RINGS } from "../src/pieces/loom-strum";
import { clockLine, clockScale, dayClock, dayLines, dayMind, drawNames, lastActiveDay, longDay, openDay, pack, postcardLoom, type PostcardNames } from "./postcard-day";

export type PostcardFormat = "landscape" | "portrait";
export interface PostcardOptions {
  /** 1200x630 (link previews, X, LinkedIn) or 1080x1350 (Instagram). Default "landscape". */
  format?: PostcardFormat;
  /** Save it as a file as well as returning it. Default true. */
  download?: boolean;
  /** For the film: how far along it is, 0 to 1, as its frames are drawn. */
  onProgress?: (done: number) => void;
  /** The day to tell, YYYY-MM-DD. Default the last day with a message on it. */
  day?: string;
  /** The columns' names under the loom: "hidden" (the default), "anonymous" (Project A, B, C, by how busy each was on
   * the day) or "shown" (their own names). */
  names?: PostcardNames;
  /** Whose mind: "Alex" makes it "Where is Alex's mind?". Default "your". */
  who?: string;
}

/** The question, as two lines: "Where is" and "your mind?", or "Alex's mind?". */
export function postcardQuestion(who?: string): [string, string] {
  const w = who?.trim();
  return ["Where is", w ? `${w}${/s$/i.test(w) ? "'" : "'s"} mind?` : "your mind?"];
}

const SIZE: Record<PostcardFormat, [number, number]> = { landscape: [1200, 630], portrait: [1080, 1350] };
const DISPLAY = '"Bricolage Grotesque Variable", "Avenir Next", system-ui, sans-serif';
const TEXT = '"Instrument Sans Variable", -apple-system, system-ui, sans-serif';
const FPS = 30;
const HOLD = 0.5;     // seconds on the day woven before the hand sweeps across it: the film ends with every string lit

/** The numbers a postcard may say, all from the record: counts and times only. */
export function postcardFacts(m: Mind) {
  const days = m.perDay;
  // the run of days in a row up to now; today counts once it has a message, yesterday ends the run otherwise
  let end = days.length - 1;
  if (!days[end]?.n) end--;
  let current = 0;
  for (let d = end; d >= 0 && days[d].n; d--) current++;
  let longest = 0, run = 0;
  for (const d of days) { run = d.n ? run + 1 : 0; longest = Math.max(longest, run); }
  let after9 = 0, latest = 0;
  for (let i = 0; i < m.n; i++) { if (m.hour[i] >= 21) after9++; latest = Math.max(latest, m.hour[i]); }
  return {
    messages: m.n, since: m.days[0], current, longest, after9, latest,
    activeDays: days.filter(d => d.n).length, calendarDays: days.length,
  };
}

/** Three short true lines about the day told (the last active one unless d is given), and its date. */
export function postcardLines(m: Mind, d = lastActiveDay(m)): { date: string; lines: string[] } { return dayLines(m, d); }

/** What the strings and the aurora are, under the lines: by Claude's output where the day's tokens are known. */
function legend(mind: Mind, d: number) {
  return tokensIn(dayMind(mind, d)) != null
    ? "Each string is a session, rung as hard as all Claude wrote for the message. The aurora is what Claude wrote for each project."
    : "Each string is a session, rung as its messages pass. The aurora is the weight each project carries.";
}

/** The day a postcard tells, as an index into mind.days: opts.day if the record has it, else the last active one. */
function dayOf(mind: Mind, opts: PostcardOptions) {
  const d = opts.day ? mind.days.indexOf(opts.day) : -1;
  return d >= 0 ? d : lastActiveDay(mind);
}

/** The date, the question, the lines, the mark, and the soft fades behind them where they cross the loom: one layer,
 * drawn once and laid over every frame. */
async function wordsFor(mind: Mind, d: number, format: PostcardFormat, W: number, H: number, who?: string) {
  await Promise.all([document.fonts.load(`650 64px ${DISPLAY}`), document.fonts.load(`700 20px ${DISPLAY}`), document.fonts.load(`400 22px ${TEXT}`), document.fonts.load(`600 15px ${TEXT}`)]).catch(() => {});
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  const ink = "#eef1f7", ink2 = "#c2c9d6", muted = "#8b93a5", c = "8,11,20";
  const { date, lines } = postcardLines(mind, d);
  const wrap = (text: string, max: number) => {
    const words = text.split(" "), lines: string[] = [];
    let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (g.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  };
  const scrim = (y0: number, y1: number) => {
    const r = g.createLinearGradient(0, y0, 0, y1);
    r.addColorStop(0, `rgba(${c},0)`); r.addColorStop(1, `rgba(${c},0.85)`);
    g.fillStyle = r; g.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
  };
  // the question in two lines, smaller for a long name so that it keeps to its width
  const question = (x: number, y: number, px: number, gap: number, max: number) => {
    const q = postcardQuestion(who), font = (n: number) => `650 ${n}px ${DISPLAY}`;
    g.font = font(px); g.letterSpacing = `${-px * 0.035}px`;
    const k = Math.min(1, max / Math.max(...q.map(t => g.measureText(t).width)));
    g.font = font(px * k); g.letterSpacing = `${-px * k * 0.035}px`; g.fillStyle = ink;
    g.fillText(q[0], x, y); g.fillText(q[1], x, y + gap * (0.35 + 0.65 * k));
    g.letterSpacing = "0px";
  };
  const kicker = (x: number, y: number, px: number) => {
    g.font = `600 ${px}px ${TEXT}`; g.fillStyle = ACCENT; g.letterSpacing = `${px * 0.12}px`;
    g.fillText(date.toUpperCase(), x, y);
    g.letterSpacing = "0px";
  };

  g.textBaseline = "alphabetic";
  if (format === "landscape") {
    const x = 64;
    // the words at the left, the loom at the right: the sky fades out behind the words, as on the page
    const r = g.createLinearGradient(0, 0, W, 0);
    r.addColorStop(0, `rgba(${c},1)`); r.addColorStop(0.3, `rgba(${c},0.8)`); r.addColorStop(0.5, `rgba(${c},0)`);
    g.fillStyle = r; g.fillRect(0, 0, W, H);
    // and the corner the clock sits in
    const k = g.createRadialGradient(W, 0, 0, W, 0, 280);
    k.addColorStop(0, `rgba(${c},0.75)`); k.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = k; g.fillRect(W - 280, 0, 280, 280);
    kicker(x, 112, 15);
    question(x, 184, 72, 76, 520);
    g.font = `400 22px ${TEXT}`; g.fillStyle = ink2;
    let y = 330;
    for (const t of lines) for (const line of wrap(t, 470)) { g.fillText(line, x, y); y += 33; }
    g.font = `400 15px ${TEXT}`; g.fillStyle = muted;
    y += 14;
    for (const line of wrap(legend(mind, d), 420)) { g.fillText(line, x, y); y += 22; }
    mark(g, x, H - 46, ink, muted);
  } else {
    const x = 72;
    scrim(340, 0);
    kicker(x, 112, 22);
    question(x, 204, 96, 100, W - 2 * x);
    scrim(H - 400, H - 190);
    g.fillStyle = `rgba(${c},.85)`; g.fillRect(0, H - 190, W, 190);
    g.font = `400 31px ${TEXT}`; g.fillStyle = ink2;
    let y = H - 262;
    for (const t of lines) for (const line of wrap(t, W - 2 * x)) { g.fillText(line, x, y); y += 44; }
    mark(g, x, H - 62, ink, muted, 1.25);
  }
  return cv;
}
const ACCENT = "#ffb85c";

/** The day's clock, top right: the time of the last message woven, how many of the day's are in, and the tokens Claude
 * wrote on their turns, with what they'd fill under them, each row fading in at t as it's first filled (seen keeps when). */
function clock(g: CanvasRenderingContext2D, c: ReturnType<typeof dayClock>, format: PostcardFormat, W: number, t: number, seen: number[]) {
  const s = format === "landscape" ? 1 : 1.3, x = W - 56 * s;
  g.save();
  g.textAlign = "right"; g.textBaseline = "alphabetic";
  g.fillStyle = "#eef1f7"; g.font = `600 ${36 * s}px ${DISPLAY}`; g.letterSpacing = "-0.5px";
  g.fillText(c.time, x, 88 * s);
  g.letterSpacing = "0px";
  g.fillStyle = "#8b93a5"; g.font = `400 ${15 * s}px ${TEXT}`;
  g.fillText(clockLine(c), x, 114 * s);
  clockScale(c).forEach((row, i) => {
    seen[i] ??= t;
    g.globalAlpha = Math.min(1, (t - seen[i]) / 0.6);
    g.fillText(row, x, (114 + 22 * (i + 1)) * s);
  });
  g.restore();
}

/** One frame of the postcard: the ground, the loom scaled down, the words over it. */
function compose(g: CanvasRenderingContext2D, loom: HTMLCanvasElement, words: HTMLCanvasElement, W: number, H: number) {
  g.fillStyle = DARK.ground; g.fillRect(0, 0, W, H);
  g.imageSmoothingQuality = "high";
  g.drawImage(loom, 0, 0, W, H);
  g.drawImage(words, 0, 0);
}

/** The postcard as a picture: the day woven to its last message, every string on it lit. Returns its canvas (and
 * saves it unless download is false). */
export async function makePostcard(mind: Mind, opts: PostcardOptions = {}): Promise<HTMLCanvasElement> {
  const format = opts.format ?? "landscape", [W, H] = SIZE[format], d = dayOf(mind, opts);
  const words = await wordsFor(mind, d, format, W, H, opts.who);
  const loom = loomOf(mind, d, opts, W, H);
  loom.pose();
  drawNames(loom);
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  compose(out.getContext("2d")!, loom.canvas, words, W, H);
  loom.dispose();
  if (opts.download !== false) out.toBlob(b => b && download(b, `${mind.days[d]}-${format}`, "png"), "image/png");
  return out;
}

/** The postcard as a film: it opens on the morning, the strings of the day before lit; the day is woven, every message
 * striking its string as it lands, under the aurora, a clock at the corner keeping its time; and a moment after its
 * last message a hand sweeps across, the film ending as every string rings brightest. An MP4 in H.264, made faster than it plays. Null when the browser
 * can't encode it (then makePostcard gives the picture). */
export async function makePostcardFilm(mind: Mind, opts: PostcardOptions = {}): Promise<Blob | null> {
  const format = opts.format ?? "landscape", [W, H] = SIZE[format], d = dayOf(mind, opts);
  if (typeof VideoEncoder === "undefined") return null;
  const mb = await import("mediabunny");
  const quality = mb.QUALITY_VERY_HIGH;
  if (!(await mb.canEncodeVideo("avc", { width: W, height: H, quality, frameRate: FPS }).catch(() => false))) return null;

  const words = await wordsFor(mind, d, format, W, H, opts.who);
  const loom = loomOf(mind, d, opts, W, H), dt = 1 / FPS, n = loom.A.length;
  let { t, start } = openDay(loom);
  // a moment on the morning before it weaves, then the day, then the sweep and the hold
  const pace = loom.pace, lead = t + 0.6;
  loom.pace = 0;
  const frames = Math.ceil((0.6 + loom.weaveTime(start) / pace + HOLD + SWEEP_RINGS) * FPS);
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const g = out.getContext("2d")!;
  const target = new mb.BufferTarget();
  const film = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const source = new mb.CanvasSource(out, { codec: "avc", quality });
  film.addVideoTrack(source, { frameRate: FPS });
  try {
    await film.start();
    let sweepAt = Infinity, end = Infinity;
    const seen: number[] = [];
    for (let f = 0; t < end && f < 30 * FPS; f++) {
      if (f) { t += dt; if (t >= lead) loom.pace = pace; loom.frame(t, dt); }
      drawNames(loom);
      if (sweepAt === Infinity && loom.cur >= n) sweepAt = t + HOLD;
      if (end === Infinity && t >= sweepAt) { loom.sweep(t); end = t + SWEEP_RINGS; }
      compose(g, loom.canvas, words, W, H);
      clock(g, dayClock(loom, start), format, W, t, seen);
      await source.add(f / FPS, dt);
      if (f % 10 === 0) {
        opts.onProgress?.(Math.min(0.99, f / frames));
        await new Promise(ok => setTimeout(ok));   // let the page paint how far along it is
      }
    }
    await film.finalize();
  } catch (e) {
    console.warn("Postcard: the film couldn't be made, saving the picture instead", e);
    await film.cancel().catch(() => {});
    return null;
  } finally { loom.dispose(); }
  const blob = new Blob([target.buffer!], { type: "video/mp4" });
  if (opts.download !== false) download(blob, `${mind.days[d]}-${format}`, "mp4");
  return blob;
}

/** The postcard as a page: one HTML file, small enough to send, that weaves the day live in any browser, wide or tall
 * as the screen is, the words as words. It carries the shapes of the day and the two before it (times, project ranks
 * and types, nothing anyone wrote) and the Loom that draws them; nothing is fetched. */
export async function makePostcardPage(mind: Mind, opts: PostcardOptions = {}): Promise<Blob> {
  const d = dayOf(mind, opts), { date, lines } = postcardLines(mind, d), { default: player } = await import("virtual:postcard-player");
  const shapes = JSON.stringify(pack(dayMind(mind, d, opts.names))).replace(/</g, "\\u003c");
  const html = page(date, lines, legend(mind, d), postcardQuestion(opts.who), mind.days[d], shapes, player.replace(/<\/script/gi, "<\\/script"));
  const blob = new Blob([html], { type: "text/html" });
  if (opts.download !== false) download(blob, mind.days[d], "html");
  return blob;
}

function download(blob: Blob, name: string, ext: string) {
  const a = document.createElement("a");
  a.download = `wimym-postcard-${name}.${ext}`;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The page around the live loom: the same words as the film, as text, at the left on a wide screen and above and
 * below the loom on a tall one; the clock at the corner; a way to weave the day again. */
function page(date: string, lines: string[], legend: string, q: [string, string], day: string, shapes: string, player: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(q.join(" "))} ${esc(date)}</title>
<meta name="description" content="${esc(lines.join(" "))}">
<meta name="color-scheme" content="dark"><meta name="generator" content="Wimym postcard, ${day}">
<style>
:root{--ground:${DARK.ground};--ink:#eef1f7;--ink2:#c2c9d6;--muted:#8b93a5;--accent:${ACCENT};--scrim:8,11,20;
--display:"Bricolage Grotesque Variable","Bricolage Grotesque","Avenir Next",system-ui,sans-serif;--text:"Instrument Sans Variable","Instrument Sans",-apple-system,system-ui,sans-serif}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--ground);color:var(--ink);font-family:var(--text);overflow:hidden;-webkit-font-smoothing:antialiased}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
.scrim{position:fixed;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(var(--scrim),1),rgba(var(--scrim),.8) 30%,rgba(var(--scrim),0) 50%)}
main{position:fixed;inset:0;display:flex;flex-direction:column;justify-content:center;gap:28px;padding:48px 64px 96px;pointer-events:none;max-width:min(620px,46vw)}
.kicker{margin:0 0 14px;font:600 13px/1 var(--text);letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
h1{margin:0;font:650 clamp(30px,min(6.2vw,var(--fit)),84px)/1.02 var(--display);letter-spacing:-.035em;white-space:nowrap;--fit:calc(46vw / (.56 * var(--n)))}
ul{margin:0;padding:0;list-style:none;font-size:clamp(17px,1.6vw,22px);line-height:1.5;color:var(--ink2)}
.legend{margin:14px 0 0;font-size:14px;line-height:1.5;color:var(--muted);max-width:420px}
.clock{position:fixed;top:40px;right:48px;text-align:right;pointer-events:none;text-shadow:0 0 18px var(--ground)}
.clock b{display:block;font:600 36px/1 var(--display);letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.clock span{display:block;margin-top:8px;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums}
.clock .scale{margin-top:4px;min-height:1.4em;opacity:0;transition:opacity .6s}.clock .scale.on{opacity:1}
.mark{position:fixed;left:64px;bottom:36px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted);pointer-events:none}
.mark i{width:18px;height:18px;border-radius:50%;background:linear-gradient(90deg,#aea38a 50%,#1b2a44 50%);position:relative;flex:none}
.mark i::after{content:"";position:absolute;width:4px;height:4px;border-radius:50%;left:11px;top:5px;background:#ffb85c;box-shadow:0 0 8px #ff8a3d}
.mark b{font:700 18px var(--display);color:var(--ink);letter-spacing:-.02em}
#again{position:fixed;right:48px;bottom:32px;font:500 14px var(--text);color:var(--ink);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:9px 16px;cursor:pointer;transition:opacity .4s}
#again:hover{background:rgba(255,255,255,.12)}#again[hidden]{display:block;opacity:0;pointer-events:none}
#tip{position:fixed;pointer-events:none;font-size:13px;padding:6px 9px;border-radius:8px;background:rgba(3,5,10,.86);border:1px solid rgba(255,255,255,.1);opacity:0;transition:opacity .15s;white-space:nowrap}
#tip .m{color:var(--muted)}
@media (max-aspect-ratio:5/4){
  .scrim{background:linear-gradient(180deg,rgba(var(--scrim),.9),rgba(var(--scrim),0) 30%,rgba(var(--scrim),0) 62%,rgba(var(--scrim),.92) 80%)}
  main{justify-content:space-between;max-width:none;padding:28px 20px 76px}
  h1{font-size:min(44px,var(--fit));--fit:calc((100vw - 40px) / (.56 * var(--n)))}
  .clock{top:auto;bottom:calc(40% + 20px);right:20px}.clock b{font-size:26px}
  .mark{left:20px;bottom:24px}.mark span{display:none}
  #again{right:20px;bottom:18px}
}
@media (prefers-reduced-motion:reduce){#again{display:none}}
</style></head>
<body>
<canvas id="loom" role="img" aria-label="The day's messages as a harp of light, each string a session, under an aurora of the weight each project carries"></canvas>
<div class="scrim"></div>
<main>
  <div><p class="kicker">${esc(date)}</p><h1 style="--n:${Math.max(...q.map(l => l.length))}">${esc(q[0])}<br>${esc(q[1])}</h1></div>
  <div><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>
  <p class="legend">${esc(legend)}</p></div>
</main>
<div class="clock"><b id="time"></b><span id="count"></span><span class="scale"></span><span class="scale"></span><span class="scale"></span></div>
<div class="mark"><i></i><b>Wimym</b><span>reads your own transcripts, on your own machine</span></div>
<button id="again" hidden>Weave the day again</button>
<div id="tip"></div>
<script type="application/json" id="shapes">${shapes}</script>
<script>${player}</script>
</body></html>
`;
}

/** The small mark: a planet with one warm light, and the name. */
function mark(g: CanvasRenderingContext2D, x: number, y: number, ink: string, muted: string, s = 1) {
  const r = 9 * s, cx = x + r, cy = y - 6 * s;
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = "#1b2a44"; g.fill();
  g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.5, Math.PI * 1.5); g.fillStyle = "#aea38a"; g.fill();
  g.beginPath(); g.arc(cx + r * 0.42, cy - r * 0.18, 2 * s, 0, Math.PI * 2); g.fillStyle = "#ffb85c"; g.shadowColor = "#ff8a3d"; g.shadowBlur = 8 * s; g.fill();
  g.restore();
  g.fillStyle = ink; g.font = `700 ${20 * s}px ${DISPLAY}`; g.letterSpacing = "-0.4px";
  g.fillText("Wimym", x + 2 * r + 10 * s, y);
  const wW = g.measureText("Wimym").width;
  g.letterSpacing = "0px";
  g.fillStyle = muted; g.font = `400 ${14 * s}px ${TEXT}`;
  g.fillText("reads your own transcripts, on your own machine", x + 2 * r + 10 * s + wW + 12 * s, y);
}

// share mode on, unless the postcard is to show the projects' own names
const toMind = (data: PointsPayload | readonly RawMessage[], days?: readonly RawDay[] | null, opts: PostcardOptions = {}) => {
  const shared = () => opts.names !== "shown";
  return Array.isArray(data) ? mindFrom(data as readonly RawMessage[], days ?? [], shared) : mindFromPoints(data as PointsPayload, days, shared);
};
/** The postcard's loom for day d, its columns named as opts.names says. */
const loomOf = (mind: Mind, d: number, opts: PostcardOptions, W: number, H: number) =>
  postcardLoom(dayMind(mind, d, opts.names), W, H, 2, undefined, (opts.names ?? "hidden") !== "hidden");

/** For the app without a Hero on screen, straight from /api/points (days optional), or from messages and days: the
 * film of the day, or the picture where the browser can't make one. */
export async function savePostcard(data: PointsPayload | readonly RawMessage[], days?: readonly RawDay[] | null, opts: PostcardOptions = {}): Promise<{ kind: "film" | "picture"; blob: Blob }> {
  const mind = toMind(data, days, opts);
  const film = await makePostcardFilm(mind, opts);
  if (film) return { kind: "film", blob: film };
  const cv = await makePostcard(mind, opts);
  return { kind: "picture", blob: await new Promise<Blob>(ok => cv.toBlob(b => ok(b!), "image/png")) };
}

/** The same, as the page that weaves the day live. */
export async function savePostcardPage(data: PointsPayload | readonly RawMessage[], days?: readonly RawDay[] | null, opts: PostcardOptions = {}): Promise<Blob> {
  return makePostcardPage(toMind(data, days, opts), opts);
}

/** The days a postcard of this record can tell, first to last: every day with a message on it, YYYY-MM-DD, its date as
 * the postcard writes it, and whether it is the record's last day, still going. The last is the one told by default. */
export function postcardDays(data: PointsPayload | readonly RawMessage[], days?: readonly RawDay[] | null): { day: string; date: string; today: boolean }[] {
  const mind = toMind(data, days), on = new Uint8Array(mind.days.length);
  for (let i = 0; i < mind.n; i++) on[mind.day[i]] = 1;
  const out: { day: string; date: string; today: boolean }[] = [];
  on.forEach((x, d) => { if (x) out.push({ day: mind.days[d], date: longDay(mind.days[d]), today: d === mind.days.length - 1 }); });
  return out;
}
