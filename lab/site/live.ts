// The public page's live pieces, on Robin's record (a made-up person): the strummed Loom and its aurora across the
// hero, and one of Robin's days as a score in "A new kind of work". Data from site/media/robin.json. Built to
// site/live/ by `npm --prefix lab run build:site`. The Loom is mounted on its own, the way hero/Hero.tsx drives it,
// without React or three: it draws on a 2D canvas, so the page needs no WebGL.
import { mindFrom } from "../src/shared/data";
import { DARK } from "../src/shared/palette";
import { unpackRobin, type RobinFile } from "../src/shared/robin";
import { Strum } from "../src/pieces/loom-strum";
import { mountDay } from "./day";

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
// asked of the server each time (a 304 when unchanged): /media/ is cached for a week, and a stale record would miss the page's days
const robin = fetch("/media/robin.json", { cache: "no-cache" }).then(r => r.json() as Promise<RobinFile>);

function mountLoom(hero: HTMLElement, box: HTMLElement, r: RobinFile) {
  const { messages, days } = unpackRobin(r);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
  const labels = document.createElement("div"), tip = document.createElement("div");
  labels.className = "lm-labels"; labels.setAttribute("aria-hidden", "true"); tip.className = "lm-tip"; tip.hidden = true;
  box.append(canvas, labels, tip);
  // loomHero's, with the loom kept to the right of the page's words: they end about half way across
  const p = new Strum(canvas, mindFrom(messages, days, () => false), DARK, false, still,
    { mass: true, colour: "type", keys: false, caption: false, wheel: false, intro: true, clear: 0.47 });

  const size = () => { const b = box.getBoundingClientRect(); if (b.width && b.height) p.resize(b.width, b.height, Math.min(devicePixelRatio || 1, 2)); };
  size();
  new ResizeObserver(size).observe(box);

  // the names and the legend, as words over the canvas
  const overlay = () => {
    const ls = p.labels?.() ?? [];
    while (labels.children.length < ls.length) labels.append(document.createElement("span"));
    [...labels.children].forEach((node, i) => {
      const l = ls[i], s = node as HTMLSpanElement;
      if (!l) { s.hidden = true; return; }
      s.hidden = false;
      if (s.textContent !== l.text) s.textContent = l.text;
      s.style.opacity = l.alpha == null ? "" : String(l.alpha);
      const shift = l.align === "right" ? "-100%" : l.align === "left" ? "0" : "-50%";
      s.style.transform = `translate(${l.x}px, ${l.y}px) translate(${shift}, -50%)`;
    });
  };
  let shown = false;
  const draw = (t: number, dt: number) => {
    p.frame(t, dt); overlay();
    if (!shown) { shown = true; hero.classList.add("is-live"); }
  };

  // run only while on screen
  let visible = true, raf = 0, t = 0, last = performance.now();
  const loop = (now: number) => {
    if (!visible) { raf = 0; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    draw(t, dt);
    raf = requestAnimationFrame(loop);
  };
  if (still) requestAnimationFrame(() => draw(8, 0));
  else {
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    }).observe(box);
    raf = requestAnimationFrame(loop);
  }

  canvas.addEventListener("pointermove", e => {
    const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const html = p.hover(x, y);
    if (!html) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(b.width - r.width - 8, x + 16) + "px";
    tip.style.top = Math.min(b.height - r.height - 8, y + 16) + "px";
  });
  canvas.addEventListener("pointerleave", () => { tip.hidden = true; p.hover(-1, -1); });
}

const hero = document.getElementById("loom"), box = hero?.querySelector<HTMLElement>(".live");
if (hero && box) robin.then(r => mountLoom(hero, box, r)).catch(() => {});

const day = document.getElementById("day");
if (day) robin.then(r => mountDay(day, r)).catch(() => {});
