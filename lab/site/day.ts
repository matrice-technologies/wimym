// One of Robin's days, replayed, for the public page's "Working with agents". Each project is a string across the
// stage and each message plucks it at its hour, in the Loom's colour for its type, as long as it is wordy; a thread
// runs from string to string at each switch. A clock runs the day in about half a minute, the counts climb, and the
// risks the page names are said at the moment they show in the record. Past the hour Robin meant to stop, it is night.
// Below, the six moments: pointing at one lights its messages, choosing one takes the replay there.
// The day buttons are in the page (data-day); everything else is drawn here. Nothing real: Robin is made up.
import type { RobinFile } from "../src/shared/robin";
import { FAMILIES } from "../src/shared/data";
import { PLAIN_DARK, TYPE_DARK } from "../src/pieces/loom-strum";

const STOP = 21.5;            // the stopping hour Robin set (the page's hook quote says 21:30)
const DEEP_BY = 18;           // the longest stretch is looked for in the working day, before this hour
const QUICK = 3;              // a go-ahead of at most this many words
const PLAY = 30;              // seconds the whole day takes to replay
const RING = 1.6;             // seconds a plucked string rings
const MIN_LANE = 34, MAX_LANE = 72, ROOM = 340;   // px between strings, and at most for all of them
// the agent sent back: a correction, whatever type the labeller gave it
const BACK = /^(no\b|not quite|wait\b|that broke|undo|stop\b)|third try|try again/i, SHARP = /third try|slow down/i;

interface Msg { i: number; h: number; p: number; f: number; words: number; text: string }
interface Moment { key: string; name: string; num: string; unit: string; fact: string; at: number; marks: Set<number>; switches?: boolean; span?: [number, number, number] }
interface Beat { h: number; key: string; title: string; text: string }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const hm = (h: number) => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const dur = (h: number) => { const m = Math.round(h * 60); return m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
const quote = (s: string, n = 72) => `“${s.length > n ? s.slice(0, s.lastIndexOf(" ", n)) + "…" : s}”`;
const longDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The day's messages, in order, the moments the page's risks point at, and when in the day each is said. */
function read(r: RobinFile, day: string) {
  // the file's families are in its own order: through their names to the Loom's colours
  const fam = r.families.map(f => FAMILIES.indexOf(f as (typeof FAMILIES)[number]));
  const ms: Msg[] = r.rows.map(([d, h, p, f, words, text], i) => ({ d, i, h, p, f: f < 0 ? -1 : fam[f], words, text }))
    .filter(m => m.d === day).sort((a, b) => a.h - b.h);
  const lanes = [...new Set(ms.map(m => m.p))];
  const first = ms[0].h, last = ms[ms.length - 1].h;
  const moments: Moment[] = [], beats: Beat[] = [];

  // No day off: the run of days with work in it, up to this one
  const n = new Map(r.days.map(row => [row[0] as string, row[1] as number]));
  let streak = 0;
  for (let t = new Date(day + "T12:00:00"); (n.get(t.toISOString().slice(0, 10)) ?? 0) > 0; t = new Date(t.getTime() - 864e5)) streak++;
  moments.push({ key: "streak", name: "No day off", num: String(streak), unit: streak > 1 ? "days in a row" : "day back", at: first, marks: new Set(),
    fact: streak > 1 ? `without a day off, this one from ${hm(first)} to ${hm(last)}.` : `after a day off, from ${hm(first)} to ${hm(last)}.` });
  beats.push({ h: first, key: "streak", title: `${hm(first)}, the first message`, text: streak > 1 ? `Day ${streak} in a row without a day off.` : `The first day back after a day off.` });

  // Shallow work: the longest stretch on one project in the working day
  let best: [number, number] = [0, 0];
  for (let a = 0, b = 0; a < ms.length; a = b) {
    for (b = a + 1; b < ms.length && ms[b].p === ms[a].p; b++);
    if (ms[b - 1].h <= DEEP_BY && ms[b - 1].h - ms[a].h >= ms[best[1]].h - ms[best[0]].h) best = [a, b - 1];
  }
  const deep = ms.slice(best[0], best[1] + 1), d0 = deep[0].h, d1 = deep[deep.length - 1].h;
  const mins = Math.round((d1 - d0) * 60);
  moments.push({ key: "deep", name: "Shallow work", num: mins < 90 ? String(mins) : (mins / 60).toFixed(1), unit: mins < 90 ? "minutes" : "hours", at: d0, marks: new Set(deep.map(m => m.i)), span: [d0, d1, deep[0].p],
    fact: `the longest stretch on one project before ${hm(DEEP_BY)}, from ${hm(d0)}.` });
  beats.push({ h: d1, key: "deep", title: "Shallow work", text: `${cap(dur(d1 - d0))} on ${r.projects[deep[0].p]}, from ${hm(d0)}: as deep as the day will go before ${hm(DEEP_BY)}.` });

  // Rubber-stamping: go-aheads of a few words
  const approve = FAMILIES.indexOf("approve");
  const quick = ms.filter(m => m.f === approve && m.words <= QUICK);
  const often = new Map<string, number>();
  for (const m of quick) { const t = m.text.replace(/[.!]$/, "").toLowerCase(); often.set(t, (often.get(t) ?? 0) + 1); }
  const said = [...often].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => `“${t}”`);
  moments.push({ key: "quick", name: "Rubber-stamping", num: String(quick.length), unit: "go-aheads", at: quick[0]?.h ?? first, marks: new Set(quick.map(m => m.i)),
    fact: quick.length ? `of three words or fewer: ${said.join(", ")}.` : `None shorter than a sentence.` });
  if (quick.length >= 3) beats.push({ h: quick[2].h, key: "quick", title: "Rubber-stamping", text: `${quick.slice(0, 3).map(m => `“${m.text.replace(/[.!]$/, "")}”`).join(" ")} Go-aheads of three words or fewer: ${quick.length} by the end of the day.` });

  // Dispersion: every change of project
  const sw: number[] = [];
  for (let k = 1; k < ms.length; k++) if (ms[k].p !== ms[k - 1].p) sw.push(k);
  const every = sw.length ? Math.round(((last - first) * 60) / sw.length) : 0;
  moments.push({ key: "switch", name: "Dispersion", num: String(sw.length), unit: "switches", at: first, switches: true, marks: new Set(sw.flatMap(k => [ms[k - 1].i, ms[k].i])),
    fact: sw.length ? `between ${lanes.length} projects: one every ${every} minutes.` : `One project all day.` });
  if (sw.length >= 8) { const k = sw[Math.floor(sw.length / 2)]; beats.push({ h: ms[k].h, key: "switch", title: "Dispersion", text: `${Math.floor(sw.length / 2) + 1} switches between projects since ${hm(first)}: one every ${every} minutes.` }); }

  // Strain: the agent sent back, and the sharpest of it
  const steer = ms.filter(m => BACK.test(m.text)), sharp = steer.find(m => SHARP.test(m.text)) ?? steer[steer.length - 1];
  moments.push({ key: "steer", name: "Strain", num: String(steer.length), unit: "times sent back", at: sharp?.h ?? first, marks: new Set(steer.map(m => m.i)),
    fact: steer.length ? `At ${hm(sharp.h)}: ${quote(sharp.text, 56)}` : `Nothing sent back all day.` });
  if (sharp) beats.push({ h: sharp.h, key: "steer", title: `Strain, at ${hm(sharp.h)}`, text: quote(sharp.text, 110) });

  // Working late: what came after the stopping hour
  const late = ms.filter(m => m.h >= STOP);
  moments.push({ key: "late", name: "Working late", num: String(late.length), unit: late.length === 1 ? "message" : "messages", at: STOP, marks: new Set(late.map(m => m.i)),
    fact: late.length ? `after ${hm(STOP)}, the hour Robin meant to stop. The last at ${hm(last)}.` : `after ${hm(STOP)}: done at ${hm(last)}, before the hour Robin set.` });
  beats.push(late.length
    ? { h: STOP, key: "late", title: `${hm(STOP)}, the hour Robin meant to stop`, text: `It passes. ${late.length} more message${late.length > 1 ? "s" : ""} to come.` }
    : { h: last, key: "done", title: `${hm(last)}, done`, text: `Before the ${hm(STOP)} Robin set.` });

  if (late.length) beats.push({ h: last, key: "", title: `${hm(last)}, the last message`, text: `${ms.length} messages, ${sw.length} switches, ${lanes.length} projects. Tomorrow is day ${streak + 1}.` });
  beats.sort((a, b) => a.h - b.h);

  const order = ["late", "streak", "switch", "deep", "quick", "steer"];
  moments.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return { ms, lanes, first, last, moments, beats, sw: new Set(sw.map(k => ms[k].i)), quick: new Set(quick.map(m => m.i)), steer: new Set(steer.map(m => m.i)) };
}

/** A soft round light, painted once and stamped wherever something glows: no filters per draw. */
function glow(color: string) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!, rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, color); rg.addColorStop(0.25, color + "88"); rg.addColorStop(1, color + "00");
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  return c;
}

/** Plays into el: the clock and counts (.rp-*), the strings on a canvas in .rp-strings, and the moments (.rp-moments). */
export function mountDay(el: HTMLElement, r: RobinFile) {
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const buttons = [...el.querySelectorAll<HTMLButtonElement>("[data-day]")];
  const box = $(".rp-strings"), time = $(".rp-time"), date = $(".rp-date"), caption = $(".rp-caption"), list = $(".rp-moments"), tip = $(".dy-tip");
  const play = $<HTMLButtonElement>(".rp-play"), scrub = $<HTMLInputElement>(".rp-scrub");
  const counts = Object.fromEntries([...el.querySelectorAll<HTMLElement>("[data-c]")].map(c => [c.dataset.c!, c]));
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const canvas = document.createElement("canvas"), g = canvas.getContext("2d")!;
  canvas.setAttribute("aria-hidden", "true");
  box.append(canvas);
  const names = document.createElement("div"); names.className = "rp-names"; names.setAttribute("aria-hidden", "true"); box.append(names);
  const spark = glow("#fff3d6"), sprites = new Map<string, HTMLCanvasElement>();
  const lightOf = (c: string) => { let s = sprites.get(c); if (!s) sprites.set(c, (s = glow(c))); return s; };

  let day = buttons.find(b => b.getAttribute("aria-pressed") === "true")?.dataset.day ?? buttons[0].dataset.day!;
  let data = read(r, day), on: string | null = null, pinned = false;
  let h0 = 0, h1 = 0, end = 0, now = 0, playing = false, ended = false, started = false, visible = false;
  let W = 0, H = 0, x0 = 0, x1 = 0, top = 0, lane = 0, shuttleY = 0, beat = -1;
  let plucks: { p: number; x: number; t: number; c: string; amp: number }[] = [];
  const born = new Map<number, number>();   // message → when it was plucked, for its mark's pop

  // the axis runs past the stopping hour; the replay ends on the last message
  const span = () => { h0 = Math.floor(data.first); h1 = Math.max(Math.ceil(data.last + 0.15), Math.ceil(STOP + 0.75)); end = data.last + 1e-4; };
  const X = (h: number) => x0 + ((h - h0) / (h1 - h0)) * (x1 - x0);
  const laneY = (p: number) => top + data.lanes.indexOf(p) * lane + lane / 2;
  const colour = (q: Msg) => q.f < 0 ? PLAIN_DARK : TYPE_DARK[q.f];

  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = box.clientWidth;
    lane = Math.max(MIN_LANE, Math.min(MAX_LANE, Math.max(52, W / 22), ROOM / data.lanes.length));
    top = 30; H = top + lane * data.lanes.length + 34;
    box.style.height = H + "px";
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the strings line up with the page's text; the hours run along the foot
    const pad = W >= 720 ? 32 : 16;
    x0 = Math.max(pad, (W - 1180) / 2 + pad); x1 = W - x0;
    layoutNames();
    if (!shuttleY) shuttleY = laneY(data.ms[0].p);
  };
  const layoutNames = () => {
    names.innerHTML = data.lanes.map(p => `<span style="left:${x0}px;top:${laneY(p) - lane / 2}px">${esc(r.projects[p])}</span>`).join("");
  };

  // where the replay is: the clock, the counts, the line said about this moment
  const hud = () => {
    const done = data.ms.filter(q => q.h <= now);
    time.textContent = hm(now);
    const c = { msgs: done.length, sw: done.filter(q => data.sw.has(q.i)).length, quick: done.filter(q => data.quick.has(q.i)).length, steer: done.filter(q => data.steer.has(q.i)).length };
    for (const [k, v] of Object.entries(c)) if (counts[k] && counts[k].textContent !== String(v)) { counts[k].textContent = String(v); counts[k].classList.remove("tick"); void counts[k].offsetWidth; counts[k].classList.add("tick"); }
    let b = -1;
    data.beats.forEach((q, k) => { if (q.h <= now + 1e-6) b = k; });
    if (b !== beat) {
      beat = b;
      const q = data.beats[b];
      caption.innerHTML = q ? `<b>${esc(q.title)}</b><span>${esc(q.text)}</span>` : "";
      caption.dataset.key = q?.key ?? "";
      caption.classList.remove("in"); void caption.offsetWidth; caption.classList.add("in");
    }
    el.classList.toggle("is-night", now >= STOP);
    scrub.value = String(Math.round(((now - h0) / (h1 - h0)) * 1000));
    scrub.setAttribute("aria-valuetext", hm(now));
  };

  const draw = (t: number) => {
    g.clearRect(0, 0, W, H);
    const m = data.moments.find(q => q.key === on);
    const lit = (i: number) => !m || m.marks.has(i);
    const head = X(now), yA = top - 14, yB = top + lane * data.lanes.length;

    // night, past the stopping hour, as far as the day has come
    const xs = X(STOP);
    if (head > xs) {
      const ng = g.createLinearGradient(xs, 0, Math.min(head, X(h1)), 0);
      ng.addColorStop(0, "rgba(141,143,245,0.05)"); ng.addColorStop(1, "rgba(141,143,245,0.13)");
      g.fillStyle = ng; g.beginPath(); g.rect(xs, yA, Math.min(head, X(h1)) - xs, yB - yA); g.fill();
    }
    // the hours along the foot
    g.font = "400 11px 'JetBrains Mono Variable', ui-monospace, monospace"; g.textAlign = "center"; g.textBaseline = "alphabetic";
    const step = x1 - x0 < 700 ? 3 : x1 - x0 < 1000 ? 2 : 1;
    for (let h = h0; h <= h1; h += step) {
      g.fillStyle = "rgba(180,180,180,0.55)"; g.fillText(String(h % 24).padStart(2, "0"), X(h), yB + 22);
      g.fillStyle = "rgba(255,255,255,0.07)"; g.fillRect(X(h) - 0.5, yA, 1, yB - yA);
    }
    // the stopping hour
    g.strokeStyle = now >= STOP ? "rgba(240,160,80,0.95)" : "rgba(240,160,80,0.4)"; g.lineWidth = 1.5; g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(xs, yA - 6); g.lineTo(xs, yB); g.stroke(); g.setLineDash([]);
    g.fillStyle = now >= STOP ? "#f0a050" : "rgba(240,160,80,0.6)"; g.textAlign = "right";
    g.fillText(x1 - x0 < 560 ? hm(STOP) : `${hm(STOP)}, the hour Robin set to stop`, xs - 7, yA - 2);

    // the longest stretch, lit
    if (m?.span) {
      const y = laneY(m.span[2]);
      g.fillStyle = "rgba(106,167,240,0.14)"; g.strokeStyle = "rgba(106,167,240,0.8)"; g.lineWidth = 1;
      g.beginPath(); g.roundRect(X(m.span[0]) - 5, y - lane / 2 + 6, X(m.span[1]) - X(m.span[0]) + 10, lane - 12, 8); g.fill(); g.stroke();
    }
    // a thread from string to string at each switch, as far as the day has come
    g.beginPath();
    for (let k = 1; k < data.ms.length && data.ms[k].h <= now; k++) {
      const a = data.ms[k - 1], b = data.ms[k];
      if (a.p === b.p) continue;
      const xm = (X(a.h) + X(b.h)) / 2;
      g.moveTo(X(a.h), laneY(a.p)); g.bezierCurveTo(xm, laneY(a.p), xm, laneY(b.p), X(b.h), laneY(b.p));
    }
    g.strokeStyle = m?.switches ? "rgba(233,237,245,0.5)" : `rgba(233,237,245,${m ? 0.05 : 0.12})`; g.lineWidth = 1; g.stroke();

    // the strings, ringing where they were plucked
    plucks = plucks.filter(q => t - q.t < RING);
    for (const p of data.lanes) {
      const y = laneY(p), mine = plucks.filter(q => q.p === p);
      const dy = (x: number) => {
        let s = 0;
        for (const q of mine) {
          const age = t - q.t, w = 18 + 260 * age;
          s += q.amp * Math.exp(-2.6 * age) * Math.sin(30 * age) * Math.exp(-((x - q.x) ** 2) / (2 * w * w));
        }
        return s;
      };
      const path = (a: number, b: number) => { g.beginPath(); for (let x = a; x <= b + 3; x += 3) { const xx = Math.min(x, b); xx === a ? g.moveTo(xx, y + dy(xx)) : g.lineTo(xx, y + dy(xx)); } };
      // played: bright; still to come: faint; past the page's text, it fades to the edges
      path(0, Math.min(head, W)); g.strokeStyle = "rgba(233,237,245,0.42)"; g.lineWidth = 1.2; g.stroke();
      if (head < W) { path(Math.max(0, head), W); g.strokeStyle = "rgba(233,237,245,0.10)"; g.lineWidth = 1; g.stroke(); }
      // the ring, in the colour of what plucked it
      for (const q of mine) {
        const age = t - q.t, a = Math.exp(-2.2 * age), w = 24 + 220 * age;
        path(Math.max(0, q.x - w * 1.6), Math.min(W, q.x + w * 1.6));
        g.globalAlpha = 0.85 * a; g.strokeStyle = q.c; g.lineWidth = 1.8; g.stroke(); g.globalAlpha = 1;
        const s = 46 * a + 10; g.globalAlpha = 0.6 * a; g.drawImage(lightOf(q.c), q.x - s / 2, y - s / 2, s, s); g.globalAlpha = 1;
      }
    }
    // a mark for each message so far, as long as it is wordy, in the colour of its type
    for (const q of data.ms) {
      if (q.h > now) break;
      const age = t - (born.get(q.i) ?? -9), pop = age < 0.35 ? 1 + 0.9 * (1 - age / 0.35) : 1;
      const len = Math.min(lane * (x1 - x0 < 700 ? 0.36 : 0.56), 8 + q.words * 1.1) * pop, x = X(q.h), y = laneY(q.p);
      g.globalAlpha = lit(q.i) ? 1 : 0.12;
      g.fillStyle = colour(q); g.beginPath(); g.roundRect(x - 1.5, y - len / 2, 3, len, 1.5); g.fill();
    }
    g.globalAlpha = 1;
    // the shuttle: where the day is, on the string it last struck
    if (now < end && started) {
      const s = 34; g.drawImage(spark, head - s / 2, shuttleY - s / 2, s, s);
      const lg = g.createLinearGradient(0, yA, 0, yB); lg.addColorStop(0, "rgba(255,243,214,0)"); lg.addColorStop(0.5, "rgba(255,243,214,0.22)"); lg.addColorStop(1, "rgba(255,243,214,0)");
      g.fillStyle = lg; g.fillRect(head - 0.5, yA, 1, yB - yA);
    }
  };

  // the clock: advance the day, pluck what it passes
  let raf = 0, last = 0;
  const frame = (ms: number) => {
    const t = ms / 1000, dt = Math.min(0.05, t - last); last = t;
    if (playing) {
      const was = now;
      now = Math.min(end, now + (dt / PLAY) * (h1 - h0));
      for (const q of data.ms) if (q.h > was && q.h <= now) {
        plucks.push({ p: q.p, x: X(q.h), t, c: colour(q), amp: Math.min(lane * 0.32, 4 + q.words * 0.35) });
        born.set(q.i, t);
      }
      if (now >= end) { playing = false; ended = true; setButton(); }
      hud();
    }
    const y = data.ms.filter(q => q.h <= now).pop();
    if (y) shuttleY += (laneY(y.p) - shuttleY) * Math.min(1, dt * 10);
    draw(t);
    raf = visible && (playing || plucks.length || [...born.values()].some(b => t - b < 0.4)) ? requestAnimationFrame(frame) : 0;
  };
  const kick = () => { if (!raf) { last = performance.now() / 1000; raf = requestAnimationFrame(frame); } };
  const redraw = () => { hud(); draw(performance.now() / 1000); };

  const setButton = () => {
    play.dataset.state = playing ? "pause" : ended ? "again" : "play";
    play.setAttribute("aria-label", playing ? "Pause the day" : ended ? "Replay the day" : "Play the day");
  };
  const start = () => {
    if (ended || now >= end) { now = h0 + (data.first - h0) * 0.6; ended = false; plucks = []; born.clear(); beat = -2; }
    started = true; playing = true; setButton(); kick();
  };
  play.onclick = () => { if (playing) { playing = false; setButton(); } else start(); };
  scrub.oninput = () => {
    now = Math.min(end, h0 + (+scrub.value / 1000) * (h1 - h0)); started = true; playing = false; ended = now >= end; plucks = []; setButton();
    const y = data.ms.filter(q => q.h <= now).pop(); if (y) shuttleY = laneY(y.p);
    redraw();
  };

  const fill = () => {
    date.textContent = `${longDay(day)} · ${data.ms.length} messages · ${data.lanes.length} projects`;
    list.innerHTML = data.moments.map(q => `<li><button type="button" data-key="${q.key}" aria-pressed="${q.key === on}"${q.marks.size || q.switches ? "" : " data-quiet"}>`
      + `<span class="mo-name">${q.name}</span><span class="mo-num"><b>${esc(q.num)}</b> ${esc(q.unit)}</span><span class="mo-fact">${esc(q.fact)}</span></button></li>`).join("");
    list.querySelectorAll<HTMLButtonElement>("button").forEach(b => {
      const key = b.dataset.key!;
      b.onpointerenter = () => { if (!pinned) light(key); };
      b.onpointerleave = () => { if (!pinned) light(null); };
      b.onfocus = () => { if (!pinned) light(key); };
      b.onblur = () => { if (!pinned) light(null); };
      b.onclick = () => {
        pinned = on !== key || !pinned; light(pinned ? key : null);
        // choosing a moment shows the whole day, with its messages lit
        if (pinned) { playing = false; ended = true; started = true; now = end; plucks = []; setButton(); redraw(); }
      };
    });
  };
  const light = (key: string | null) => {
    on = key;
    list.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.key === on)));
    el.classList.toggle("is-lit", !!on);
    redraw();
  };
  const load = (d: string) => {
    day = d; data = read(r, day); on = null; pinned = false; span(); size(); fill();
    plucks = []; born.clear(); beat = -2; shuttleY = laneY(data.ms[0].p);
    now = h0 + (data.first - h0) * 0.6; ended = false;
  };

  buttons.forEach(b => b.addEventListener("click", () => {
    buttons.forEach(o => o.setAttribute("aria-pressed", String(o === b)));
    load(b.dataset.day!);
    if (still) { now = end; ended = true; setButton(); redraw(); } else start();
  }));

  // hover: the nearest message so far, on the string under the pointer
  canvas.addEventListener("pointermove", e => {
    const b = canvas.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    let near: Msg | null = null, d = 14;
    for (const q of data.ms) {
      if (q.h > now) break;
      const dd = Math.abs(X(q.h) - px) + Math.abs(laneY(q.p) - py) / 3;
      if (dd < d && Math.abs(laneY(q.p) - py) < lane / 2) { d = dd; near = q; }
    }
    if (!near) { tip.hidden = true; return; }
    tip.innerHTML = `<span class="m">${hm(near.h)} · ${esc(r.projects[near.p])} · ${near.f < 0 ? "Unlabelled" : cap(FAMILIES[near.f])}</span><span class="q">${esc(near.text)}</span>`;
    tip.hidden = false;
    const host = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(host.width - t.width - 8, e.clientX - host.left + 14)) + "px";
    tip.style.top = (e.clientY - host.top + 18) + "px";
  });
  canvas.addEventListener("pointerleave", () => { tip.hidden = true; });

  load(day);
  if (still) { now = end; ended = true; started = true; }
  setButton(); redraw();
  el.classList.add("is-live");
  new ResizeObserver(() => { size(); redraw(); }).observe(box);
  // it plays the first time it comes into view, and draws only while on screen
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !started && !still && e.intersectionRatio > 0.35) start();
    if (visible) kick();
  }, { threshold: [0, 0.35] }).observe(box);
}
