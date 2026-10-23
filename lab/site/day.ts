// One of Robin's days as a score, for the public page's "A new kind of work": a lane per project, a mark per message
// in the Loom's colour for its type, a thread from lane to lane at each switch, and the hour Robin meant to stop.
// Beside it, the risks the page names, each found in that day's record; pointing at one lights its messages.
// The day buttons are in the page (data-day); everything else is drawn here. Nothing real: Robin is made up.
import type { RobinFile } from "../src/shared/robin";
import { FAM_NAMES } from "../src/shared/palette";
import { PLAIN_DARK, TYPE_DARK } from "../src/pieces/loom-strum";

const STOP = 21.5;            // the stopping hour Robin set (the page's hook quote says 21:30)
const DEEP_BY = 18;           // the longest stretch is looked for in the working day, before this hour
const QUICK = 3;              // a go-ahead of at most this many words
const LANE = 46, TOP = 30, FOOT = 28, MIN_W = 640;
const APPROVE = FAM_NAMES.indexOf("Approve");
// the agent sent back: a correction, whatever type the labeller gave it
const BACK = /^(no\b|not quite|wait\b|that broke|undo|stop\b)|third try|try again/i, SHARP = /third try|slow down/i;

interface Msg { i: number; h: number; p: number; f: number; words: number; text: string }
interface Moment { key: string; name: string; fact: string; marks: Set<number>; switches?: boolean; span?: [number, number, number] }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const hm = (h: number) => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const dur = (h: number) => { const m = Math.round(h * 60); return m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
const quote = (s: string, n = 60) => `“${s.length > n ? s.slice(0, s.lastIndexOf(" ", n)) + "…" : s}”`;
const longDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

/** The day's messages, in order, and the moments the page's risks point at. */
function read(r: RobinFile, day: string) {
  const ms: Msg[] = r.rows.map(([d, h, p, f, words, text], i) => ({ d, i, h, p, f, words, text }))
    .filter(m => m.d === day).sort((a, b) => a.h - b.h);
  const lanes = [...new Set(ms.map(m => m.p))];
  const first = ms[0].h, last = ms[ms.length - 1].h;
  const moments: Moment[] = [];

  // Losing the hours: what came after the stopping hour
  const late = ms.filter(m => m.h >= STOP);
  moments.push(late.length
    ? { key: "late", name: "Losing the hours", marks: new Set(late.map(m => m.i)), fact: `${late.length} message${late.length > 1 ? "s" : ""} after ${hm(STOP)}, the hour Robin meant to stop. The last at ${hm(last)}.` }
    : { key: "late", name: "Losing the hours", marks: new Set(), fact: `Not this day: done at ${hm(last)}, before the ${hm(STOP)} Robin set.` });

  // No end of day: the run of days with work in it, up to this one
  const n = new Map(r.days.map(row => [row[0] as string, row[1] as number]));
  let streak = 0;
  for (let t = new Date(day + "T12:00:00"); (n.get(t.toISOString().slice(0, 10)) ?? 0) > 0; t = new Date(t.getTime() - 864e5)) streak++;
  moments.push({ key: "streak", name: "No end of day", marks: new Set(), fact: streak > 1 ? `Day ${streak} in a row without a day off, from ${hm(first)} to ${hm(last)}.` : `The first day back after a day off.` });

  // Dispersion: every change of project
  const sw: number[] = [];
  for (let k = 1; k < ms.length; k++) if (ms[k].p !== ms[k - 1].p) sw.push(k);
  moments.push({ key: "switch", name: "Dispersion", switches: true, marks: new Set(sw.flatMap(k => [ms[k - 1].i, ms[k].i])),
    fact: sw.length ? `${sw.length} switches between ${lanes.length} projects: one every ${Math.round(((last - first) * 60) / sw.length)} minutes.` : `One project all day.` });

  // Loss of depth: the longest stretch on one project in the working day
  let best: [number, number] = [0, 0];
  for (let a = 0, b = 0; a < ms.length; a = b) {
    for (b = a + 1; b < ms.length && ms[b].p === ms[a].p; b++);
    if (ms[b - 1].h <= DEEP_BY && ms[b - 1].h - ms[a].h >= ms[best[1]].h - ms[best[0]].h) best = [a, b - 1];
  }
  const deep = ms.slice(best[0], best[1] + 1), long = deep[deep.length - 1].h - deep[0].h;
  moments.push({ key: "deep", name: "Loss of depth", marks: new Set(deep.map(m => m.i)), span: [deep[0].h, deep[deep.length - 1].h, deep[0].p],
    fact: `Before ${hm(DEEP_BY)}, the longest stretch on one project was ${dur(long)}, from ${hm(deep[0].h)}.` });

  // Rubber-stamping: go-aheads of a few words
  const quick = ms.filter(m => m.f === APPROVE && m.words <= QUICK);
  const often = new Map<string, number>();
  for (const m of quick) { const t = m.text.replace(/[.!]$/, "").toLowerCase(); often.set(t, (often.get(t) ?? 0) + 1); }
  const said = [...often].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  moments.push({ key: "quick", name: "Rubber-stamping", marks: new Set(quick.map(m => m.i)),
    fact: quick.length ? `${quick.length} go-aheads of three words or fewer: ${said.map(s => `“${s}”`).join(", ")}.` : `No go-ahead shorter than a sentence.` });

  // Strain: the agent sent back, and the sharpest of it
  const steer = ms.filter(m => BACK.test(m.text)), sharp = steer.find(m => SHARP.test(m.text)) ?? steer[steer.length - 1];
  moments.push({ key: "steer", name: "Strain", marks: new Set(steer.map(m => m.i)),
    fact: steer.length ? `${steer.length} times the agent was sent back. At ${hm(sharp.h)}: ${quote(sharp.text)}` : `Nothing sent back all day.` });

  return { ms, lanes, first, last, moments };
}

/** Draws into el: the day's heading (#day .dy-head), the score (.dy-score) and the moments (.dy-moments). */
export function mountDay(el: HTMLElement, r: RobinFile) {
  const buttons = [...el.querySelectorAll<HTMLButtonElement>("[data-day]")];
  const head = el.querySelector<HTMLElement>(".dy-head")!, scroll = el.querySelector<HTMLElement>(".dy-score")!;
  const list = el.querySelector<HTMLElement>(".dy-moments")!, tip = el.querySelector<HTMLElement>(".dy-tip")!;
  let day = buttons.find(b => b.getAttribute("aria-pressed") === "true")?.dataset.day ?? buttons[0].dataset.day!;
  let data = read(r, day), on: string | null = null, pinned = false;

  const draw = () => {
    const type = TYPE_DARK, plain = PLAIN_DARK;
    const W = Math.max(MIN_W, scroll.clientWidth), narrow = scroll.clientWidth < 720;
    const gutter = narrow ? 12 : 108, right = 16;
    const h0 = Math.floor(data.first), h1 = Math.max(Math.ceil(data.last + 0.15), Math.ceil(STOP + 0.75));
    const x = (h: number) => gutter + ((h - h0) / (h1 - h0)) * (W - gutter - right);
    const laneY = (p: number) => TOP + data.lanes.indexOf(p) * LANE + LANE / 2;
    const H = TOP + data.lanes.length * LANE + FOOT;
    const m = data.moments.find(q => q.key === on);
    const lit = (i: number) => !m || m.marks.has(i);
    const step = W < 820 ? 2 : 1;

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${longDay(day)}: ${data.ms.length} messages in ${data.lanes.length} projects`)}">`;
    // the hours after the stopping hour, and its line
    s += `<rect class="dy-night" x="${x(STOP)}" y="${TOP - 8}" width="${x(h1) - x(STOP)}" height="${H - TOP - FOOT + 16}" rx="6"/>`;
    s += `<line class="dy-stop" x1="${x(STOP)}" x2="${x(STOP)}" y1="${TOP - 14}" y2="${H - FOOT + 8}"/>`;
    s += `<text class="dy-stop-t" x="${x(STOP) - 6}" y="${TOP - 14}" text-anchor="end">${hm(STOP)}, the hour Robin set to stop</text>`;
    // hours along the foot
    for (let h = h0; h <= h1; h += step) s += `<line class="dy-hour" x1="${x(h)}" x2="${x(h)}" y1="${TOP - 4}" y2="${H - FOOT + 4}"/><text class="dy-hour-t" x="${x(h)}" y="${H - 8}">${String(h % 24).padStart(2, "0")}</text>`;
    // lanes and their names
    data.lanes.forEach(p => {
      const y = laneY(p);
      s += `<line class="dy-lane" x1="${gutter}" x2="${W - right}" y1="${y}" y2="${y}"/>`;
      s += narrow ? `<text class="dy-name" x="${gutter}" y="${y - 15}">${esc(r.projects[p])}</text>` : `<text class="dy-name" x="${gutter - 14}" y="${y + 4}" text-anchor="end">${esc(r.projects[p])}</text>`;
    });
    // the longest stretch, as a band in its lane
    if (m?.span) s += `<rect class="dy-span" x="${x(m.span[0]) - 4}" y="${laneY(m.span[2]) - 19}" width="${x(m.span[1]) - x(m.span[0]) + 8}" height="38" rx="8"/>`;
    // a thread from lane to lane at each switch
    let path = "";
    for (let k = 1; k < data.ms.length; k++) {
      const a = data.ms[k - 1], b = data.ms[k];
      if (a.p !== b.p) path += `M${x(a.h).toFixed(1)} ${laneY(a.p)}C${x((a.h + b.h) / 2).toFixed(1)} ${laneY(a.p)} ${x((a.h + b.h) / 2).toFixed(1)} ${laneY(b.p)} ${x(b.h).toFixed(1)} ${laneY(b.p)}`;
    }
    s += `<path class="dy-thread${m?.switches ? " on" : ""}" d="${path}"/>`;
    // the messages, as long as they are wordy
    for (const q of data.ms) {
      const len = Math.min(30, 8 + q.words * 1.1), c = q.f < 0 ? plain : type[q.f];
      s += `<rect class="dy-m${lit(q.i) ? "" : " dim"}" x="${(x(q.h) - 1.5).toFixed(1)}" y="${(laneY(q.p) - len / 2).toFixed(1)}" width="3" height="${len.toFixed(1)}" rx="1.5" fill="${c}"/>`;
    }
    s += `</svg>`;
    scroll.innerHTML = s;
    scroll.classList.toggle("focus", !!m);

    // hover: the nearest message in the lane under the pointer
    const svg = scroll.querySelector("svg")!;
    svg.onpointermove = e => {
      const b = svg.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
      let near: Msg | null = null, d = 14;
      for (const q of data.ms) { const dd = Math.abs(x(q.h) - px) + Math.abs(laneY(q.p) - py) / 3; if (dd < d && Math.abs(laneY(q.p) - py) < LANE / 2) { d = dd; near = q; } }
      if (!near) { tip.hidden = true; return; }
      tip.innerHTML = `<span class="m">${hm(near.h)} · ${esc(r.projects[near.p])} · ${near.f < 0 ? "Unlabelled" : FAM_NAMES[near.f]}</span><span class="q">${esc(near.text)}</span>`;
      tip.hidden = false;
      const host = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(host.width - t.width - 8, e.clientX - host.left + 14)) + "px";
      tip.style.top = (e.clientY - host.top + 18) + "px";
    };
    svg.onpointerleave = () => { tip.hidden = true; };
  };

  const fill = () => {
    head.textContent = `${longDay(day)}: ${data.ms.length} messages from ${hm(data.first)} to ${hm(data.last)}, in ${data.lanes.length} projects.`;
    list.innerHTML = data.moments.map(q => `<li><button type="button" data-key="${q.key}" aria-pressed="${q.key === on}"${q.marks.size || q.switches ? "" : " data-quiet"}><b>${q.name}</b><span>${esc(q.fact)}</span></button></li>`).join("");
    list.querySelectorAll<HTMLButtonElement>("button").forEach(b => {
      const key = b.dataset.key!;
      b.onpointerenter = () => { if (!pinned) light(key); };
      b.onpointerleave = () => { if (!pinned) light(null); };
      b.onfocus = () => { if (!pinned) light(key); };
      b.onblur = () => { if (!pinned) light(null); };
      b.onclick = () => { pinned = on !== key || !pinned; light(pinned ? key : null); };
    });
  };
  const light = (key: string | null) => {
    on = key;
    list.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.key === on)));
    draw();
  };

  buttons.forEach(b => b.addEventListener("click", () => {
    day = b.dataset.day!; data = read(r, day); on = null; pinned = false;
    buttons.forEach(o => o.setAttribute("aria-pressed", String(o === b)));
    fill(); draw();
  }));
  fill(); draw();
  el.classList.add("is-live");
  new ResizeObserver(() => draw()).observe(scroll);
}
