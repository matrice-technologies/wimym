// The postcard page's own script (bundled into the page by player-plugin.ts): the day read from the page, woven live
// on the strummed Loom, wide or tall as the window is; the clock kept at the corner; a hand sweeping across now and
// then once the day is woven, and a string plucked where it is pointed at. Reduced motion shows the day woven, still.
import { clockLine, dayClock, dayStart, drawNames, fitLoom, openDay, postcardLoom, unpack, type Packed } from "./postcard-day";

const AGAIN = 8;   // seconds between the sweeps once the day is woven
const LEAD = 0.8;  // seconds on the morning before it weaves

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const data = JSON.parse($("shapes").textContent!) as Packed, mind = unpack(data), named = !!data.names;
const canvas = $<HTMLCanvasElement>("loom"), time = $("time"), count = $("count"), again = $<HTMLButtonElement>("again"), tip = $("tip");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const size = () => [innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1)] as const;

let loom = postcardLoom(mind, ...size(), canvas, named), start = 0, t = 0, pace = 1, swept = Infinity, last = 0;
const n = loom.A.length;

function begin() {
  loom.dispose();
  loom = postcardLoom(mind, ...size(), canvas, named);
  if (still) { start = dayStart(loom); t = loom.pose(); loom.frame(t, 0); drawNames(loom); show(); return; }
  ({ t, start } = openDay(loom));
  pace = loom.pace; loom.pace = 0; swept = Infinity;
  again.hidden = true;
}
function show() {
  const c = dayClock(loom, start);
  time.textContent = c.time;
  count.textContent = clockLine(c);
}
function tick(now: number) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now; t += dt;
  if (!loom.pace && swept === Infinity && t >= LEAD) loom.pace = pace;
  loom.frame(t, dt);
  drawNames(loom);
  if (swept === Infinity && loom.cur >= n) { loom.sweep(t); swept = t; again.hidden = false; }
  else if (t - swept >= AGAIN) { loom.sweep(t); swept = t; }
  show();
  requestAnimationFrame(tick);
}

begin();
if (!still) requestAnimationFrame(tick);
again.onclick = begin;
addEventListener("resize", () => { fitLoom(loom, ...size()); if (still) { loom.frame(t, 0); drawNames(loom); } });
canvas.addEventListener("pointermove", e => {
  const html = loom.hover(e.clientX, e.clientY);
  tip.style.opacity = html ? "1" : "0";
  if (!html) return;
  tip.innerHTML = html;
  tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 14) + "px";
  tip.style.top = e.clientY + 16 + "px";
});
canvas.addEventListener("pointerleave", () => { tip.style.opacity = "0"; });
