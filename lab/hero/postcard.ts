// The postcard: the planet, the question, and two true lines about the person, as a PNG to post.
// Always in share mode: no message text, no project names, nothing anyone wrote. Only counts and
// times, computed here from the same shapes the planet is drawn from.
import { mindFrom, mindFromPoints, type Mind, type PointsPayload, type RawDay, type RawMessage } from "../src/shared/data";
import { DARK, LIGHT, type Theme } from "../src/shared/palette";
import { fmtHour, fmtMonth } from "../src/shared/piece";
import { Globe } from "../src/pieces/globe";

export type PostcardFormat = "landscape" | "portrait";
export interface PostcardOptions {
  /** 1200x630 (link previews, X, LinkedIn) or 1080x1350 (Instagram). Default "landscape". */
  format?: PostcardFormat;
  theme?: "dark" | "light";
  /** Save it as a file as well as returning it. Default true. */
  download?: boolean;
}

const SIZE: Record<PostcardFormat, [number, number]> = { landscape: [1200, 630], portrait: [1080, 1350] };
const DISPLAY = '"Bricolage Grotesque Variable", "Avenir Next", system-ui, sans-serif';
const TEXT = '"Instrument Sans Variable", -apple-system, system-ui, sans-serif';
const fmt = (n: number) => n.toLocaleString("en");

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

/** Draws the postcard and returns its canvas (and saves it unless download is false). */
export async function makePostcard(mind: Mind, opts: PostcardOptions = {}): Promise<HTMLCanvasElement> {
  const format = opts.format ?? "landscape", theme: Theme = opts.theme === "light" ? LIGHT : DARK;
  const [W, H] = SIZE[format];
  await Promise.all([document.fonts.load(`650 64px ${DISPLAY}`), document.fonts.load(`700 20px ${DISPLAY}`), document.fonts.load(`400 22px ${TEXT}`)]).catch(() => {});

  // the planet, drawn at twice the size and scaled down, still, shapes only, facing its night
  const gl = document.createElement("canvas");
  const planet = new Globe(gl, mind, theme, true, true, false, { preserve: true });
  planet.resize(W, H, 2);
  if (format === "landscape") planet.setFrame(0.205, 0.07, 1.13);
  else planet.setFrame(0, 0.11, 1.08);
  planet.frame(8, 0);

  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const g = out.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(gl, 0, 0, W, H);
  planet.dispose();

  const ink = theme.dark ? "#eef1f7" : "#121725", ink2 = theme.dark ? "#c2c9d6" : "#3d4559", muted = theme.dark ? "#8b93a5" : "#6b7386";
  const lines = postcardLines(mind);
  const wrap = (text: string, max: number) => {
    const words = text.split(" "), lines: string[] = [];
    let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (g.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  };
  const scrim = (y0: number, y1: number) => {
    // a soft fade behind the words where they cross the planet
    const r = g.createLinearGradient(0, y0, 0, y1);
    const c = theme.dark ? "8,11,20" : "238,240,244";
    r.addColorStop(0, `rgba(${c},0)`); r.addColorStop(1, `rgba(${c},0.85)`);
    g.fillStyle = r; g.fillRect(0, y0, W, y1 - y0);
  };

  g.textBaseline = "alphabetic";
  if (format === "landscape") {
    const x = 64;
    g.fillStyle = ink; g.font = `650 72px ${DISPLAY}`; g.letterSpacing = "-2.5px";
    g.fillText("Where is", x, 160); g.fillText("your mind?", x, 236);
    g.letterSpacing = "0px";
    g.font = `400 22px ${TEXT}`; g.fillStyle = ink2;
    let y = 314;
    for (const t of lines) for (const line of wrap(t, 470)) { g.fillText(line, x, y); y += 33; }
    g.font = `400 15px ${TEXT}`; g.fillStyle = muted;
    y += 16;
    for (const line of wrap("Each light is one message, placed by its day and hour. The dark side is night.", 420)) { g.fillText(line, x, y); y += 22; }
    mark(g, x, H - 46, ink, muted, theme);
  } else {
    const x = 72;
    g.fillStyle = ink; g.font = `650 96px ${DISPLAY}`; g.letterSpacing = "-3.5px";
    g.fillText("Where is", x, 170); g.fillText("your mind?", x, 270);
    g.letterSpacing = "0px";
    scrim(H - 400, H - 190);
    g.fillStyle = theme.dark ? "rgba(8,11,20,.85)" : "rgba(238,240,244,.85)"; g.fillRect(0, H - 190, W, 190);
    g.font = `400 31px ${TEXT}`; g.fillStyle = ink2;
    let y = H - 262;
    for (const t of lines) for (const line of wrap(t, W - 2 * x)) { g.fillText(line, x, y); y += 44; }
    mark(g, x, H - 62, ink, muted, theme, 1.25);
  }

  if (opts.download !== false) {
    const a = document.createElement("a");
    a.download = `wimym-postcard-${format}-${new Date().toISOString().slice(0, 10)}.png`;
    a.href = out.toDataURL("image/png");
    a.click();
  }
  return out;
}

/** The small mark: a planet with one warm light, and the name. */
function mark(g: CanvasRenderingContext2D, x: number, y: number, ink: string, muted: string, theme: Theme, s = 1) {
  const r = 9 * s, cx = x + r, cy = y - 6 * s;
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = theme.dark ? "#1b2a44" : "#c9d6e6"; g.fill();
  g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.5, Math.PI * 1.5); g.fillStyle = theme.dark ? "#aea38a" : "#f3efe6"; g.fill();
  g.beginPath(); g.arc(cx + r * 0.42, cy - r * 0.18, 2 * s, 0, Math.PI * 2); g.fillStyle = "#ffb85c"; g.shadowColor = "#ff8a3d"; g.shadowBlur = 8 * s; g.fill();
  g.restore();
  g.fillStyle = ink; g.font = `700 ${20 * s}px ${DISPLAY}`; g.letterSpacing = "-0.4px";
  g.fillText("Wimym", x + 2 * r + 10 * s, y);
  const wW = g.measureText("Wimym").width;
  g.letterSpacing = "0px";
  g.fillStyle = muted; g.font = `400 ${14 * s}px ${TEXT}`;
  g.fillText("reads your own transcripts, on your own machine", x + 2 * r + 10 * s + wW + 12 * s, y);
}

/** For the app without a Hero on screen: the postcard straight from /api/points (days optional), or from messages and days. */
export function savePostcard(data: PointsPayload | readonly RawMessage[], days?: readonly RawDay[] | null, opts: PostcardOptions = {}) {
  const mind = Array.isArray(data) ? mindFrom(data as readonly RawMessage[], days ?? [], () => true) : mindFromPoints(data as PointsPayload, days, () => true);
  return makePostcard(mind, opts);
}
