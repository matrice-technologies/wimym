// The postcard: a few seconds of the strummed Loom under its aurora, the question, and three true lines about the
// person, as an MP4 to post (a PNG where the browser can't encode video). Always in share mode: no message text, no
// project names, nothing anyone wrote. Only counts and times, computed here from the same shapes the Loom is drawn from.
import { mindFrom, mindFromPoints, type Mind, type PointsPayload, type RawDay, type RawMessage } from "../src/shared/data";
import { DARK } from "../src/shared/palette";
import { fmtHour, fmtMonth } from "../src/shared/piece";
import { Strum, SWEEP_RINGS } from "../src/pieces/loom-strum";

export type PostcardFormat = "landscape" | "portrait";
export interface PostcardOptions {
  /** 1200x630 (link previews, X, LinkedIn) or 1080x1350 (Instagram). Default "landscape". */
  format?: PostcardFormat;
  /** Save it as a file as well as returning it. Default true. */
  download?: boolean;
  /** For the film: how far along it is, 0 to 1, as its frames are drawn. */
  onProgress?: (done: number) => void;
}

const SIZE: Record<PostcardFormat, [number, number]> = { landscape: [1200, 630], portrait: [1080, 1350] };
const DISPLAY = '"Bricolage Grotesque Variable", "Avenir Next", system-ui, sans-serif';
const TEXT = '"Instrument Sans Variable", -apple-system, system-ui, sans-serif';
const fmt = (n: number) => n.toLocaleString("en");
const FPS = 30;
const FILM = 6;       // seconds: it opens on the picture and comes back to it, so it loops
const WOVEN_ON = 40;  // messages left to weave while it runs

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

/** Three short true lines that make someone wonder about their own. */
export function postcardLines(m: Mind): string[] {
  const f = postcardFacts(m);
  return [
    `${fmt(f.messages)} messages to AI agents since ${fmtMonth(f.since)}.`,
    f.current >= 7 ? `${f.current} days in a row, and counting.` : `At most ${f.longest} days in a row.`,
    f.after9 ? `${fmt(f.after9)} sent after 9 pm${f.latest >= 24 ? `, the latest at ${fmtHour(f.latest)}` : ""}.` : "Not one sent after 9 pm.",
  ];
}

/** The Loom for a postcard, at twice the size: shapes only, no names or days on it; the aurora painted in step, so a
 * film made faster than it plays has it in every frame. Tall, the fell sits higher, clear of the lines at the bottom. */
function loomFor(mind: Mind, format: PostcardFormat, W: number, H: number) {
  const loom = new Strum(document.createElement("canvas"), mind, DARK, true, false, { mass: true, colour: "type", words: false, worker: false, wheel: false });
  loom.resize(W, H, 2);
  if (format === "portrait") loom.fell = H * 0.6;
  return loom;
}

/** The question, the lines, the mark, and the soft fades behind them where they cross the loom: one layer, drawn
 * once and laid over every frame. */
async function wordsFor(mind: Mind, format: PostcardFormat, W: number, H: number) {
  await Promise.all([document.fonts.load(`650 64px ${DISPLAY}`), document.fonts.load(`700 20px ${DISPLAY}`), document.fonts.load(`400 22px ${TEXT}`)]).catch(() => {});
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  const ink = "#eef1f7", ink2 = "#c2c9d6", muted = "#8b93a5", c = "8,11,20";
  const lines = postcardLines(mind);
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

  g.textBaseline = "alphabetic";
  if (format === "landscape") {
    const x = 64;
    // the words at the left, the loom at the right: the sky fades out behind the words, as on the page
    const r = g.createLinearGradient(0, 0, W, 0);
    r.addColorStop(0, `rgba(${c},1)`); r.addColorStop(0.3, `rgba(${c},0.8)`); r.addColorStop(0.5, `rgba(${c},0)`);
    g.fillStyle = r; g.fillRect(0, 0, W, H);
    g.fillStyle = ink; g.font = `650 72px ${DISPLAY}`; g.letterSpacing = "-2.5px";
    g.fillText("Where is", x, 160); g.fillText("your mind?", x, 236);
    g.letterSpacing = "0px";
    g.font = `400 22px ${TEXT}`; g.fillStyle = ink2;
    let y = 314;
    for (const t of lines) for (const line of wrap(t, 470)) { g.fillText(line, x, y); y += 33; }
    g.font = `400 15px ${TEXT}`; g.fillStyle = muted;
    y += 16;
    for (const line of wrap("Each string is a session, rung as its messages pass. The aurora is the weight each project carries.", 420)) { g.fillText(line, x, y); y += 22; }
    mark(g, x, H - 46, ink, muted);
  } else {
    const x = 72;
    scrim(320, 0);
    g.fillStyle = ink; g.font = `650 96px ${DISPLAY}`; g.letterSpacing = "-3.5px";
    g.fillText("Where is", x, 170); g.fillText("your mind?", x, 270);
    g.letterSpacing = "0px";
    scrim(H - 400, H - 190);
    g.fillStyle = `rgba(${c},.85)`; g.fillRect(0, H - 190, W, 190);
    g.font = `400 31px ${TEXT}`; g.fillStyle = ink2;
    let y = H - 262;
    for (const t of lines) for (const line of wrap(t, W - 2 * x)) { g.fillText(line, x, y); y += 44; }
    mark(g, x, H - 62, ink, muted, 1.25);
  }
  return cv;
}

/** One frame of the postcard: the ground, the loom scaled down, the words over it. */
function compose(g: CanvasRenderingContext2D, loom: HTMLCanvasElement, words: HTMLCanvasElement, W: number, H: number) {
  g.fillStyle = DARK.ground; g.fillRect(0, 0, W, H);
  g.imageSmoothingQuality = "high";
  g.drawImage(loom, 0, 0, W, H);
  g.drawImage(words, 0, 0);
}

/** The postcard as a picture: the loom posed, every string on it lit. Returns its canvas (and saves it unless download is false). */
export async function makePostcard(mind: Mind, opts: PostcardOptions = {}): Promise<HTMLCanvasElement> {
  const format = opts.format ?? "landscape", [W, H] = SIZE[format];
  const words = await wordsFor(mind, format, W, H);
  const loom = loomFor(mind, format, W, H);
  loom.pose();
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  compose(out.getContext("2d")!, loom.canvas, words, W, H);
  loom.dispose();
  if (opts.download !== false) out.toBlob(b => b && download(b, format, "png"), "image/png");
  return out;
}

/** The postcard as a film: it opens on the picture, every string lit; the last messages are woven, each striking its
 * string as it lands, under the aurora; and a hand sweeps across again, so it ends where it began and loops. An MP4
 * in H.264, made faster than it plays. Null when the browser can't encode it (then makePostcard gives the picture). */
export async function makePostcardFilm(mind: Mind, opts: PostcardOptions = {}): Promise<Blob | null> {
  const format = opts.format ?? "landscape", [W, H] = SIZE[format];
  if (typeof VideoEncoder === "undefined") return null;
  const mb = await import("mediabunny");
  const quality = mb.QUALITY_VERY_HIGH;
  if (!(await mb.canEncodeVideo("avc", { width: W, height: H, quality, frameRate: FPS }).catch(() => false))) return null;

  const words = await wordsFor(mind, format, W, H);
  const loom = loomFor(mind, format, W, H), frames = FILM * FPS, dt = 1 / FPS;
  // the hand sweeps again so that the last frame is the first once more
  let t = loom.pose(40, WOVEN_ON);
  const again = Math.round((FILM - SWEEP_RINGS) * FPS);
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const g = out.getContext("2d")!;
  const target = new mb.BufferTarget();
  const film = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const source = new mb.CanvasSource(out, { codec: "avc", quality });
  film.addVideoTrack(source, { frameRate: FPS });
  try {
    await film.start();
    for (let f = 0; f < frames; f++) {
      if (f === again) loom.sweep(t);
      if (f) { t += dt; loom.frame(t, dt); }
      compose(g, loom.canvas, words, W, H);
      await source.add(f / FPS, dt);
      if (f % 10 === 0) {
        opts.onProgress?.(f / frames);
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
  if (opts.download !== false) download(blob, format, "mp4");
  return blob;
}

function download(blob: Blob, format: PostcardFormat, ext: string) {
  const a = document.createElement("a");
  a.download = `wimym-postcard-${format}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
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

/** For the app without a Hero on screen, straight from /api/points (days optional), or from messages and days: the
 * film, or the picture where the browser can't make one. */
export async function savePostcard(data: PointsPayload | readonly RawMessage[], days?: readonly RawDay[] | null, opts: PostcardOptions = {}): Promise<{ kind: "film" | "picture"; blob: Blob }> {
  const mind = Array.isArray(data) ? mindFrom(data as readonly RawMessage[], days ?? [], () => true) : mindFromPoints(data as PointsPayload, days, () => true);
  const film = await makePostcardFilm(mind, opts);
  if (film) return { kind: "film", blob: film };
  const cv = await makePostcard(mind, opts);
  return { kind: "picture", blob: await new Promise<Blob>(ok => cv.toBlob(b => ok(b!), "image/png")) };
}
