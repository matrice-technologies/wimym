// The lab page around a piece: full-bleed canvas, a caption, a tooltip and the keys.
//   S  save a PNG (with the caption)      L  record a 6 second loop (webm)
//   P  share mode: shapes only            D  demo: synthetic data
//   T  light or dark                      Space  pause
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource-variable/instrument-sans/index.css";
import "./stage.css";
import { getMind, share, type Mind } from "./data";
import { DARK, LIGHT, type Theme } from "./palette";
import type { Piece, PieceFactory } from "./piece";
import { recordLoop, savePNG } from "./capture";

const params = new URLSearchParams(location.search);

function initialTheme(): Theme {
  const t = params.get("theme");
  if (t === "light") return LIGHT;
  if (t === "dark") return DARK;
  return matchMedia("(prefers-color-scheme: dark)").matches ? DARK : LIGHT;
}

export async function mountLab(name: string, factory: PieceFactory) {
  let theme = initialTheme();
  document.documentElement.dataset.theme = theme.dark ? "dark" : "light";
  document.title = `${name} · Wimym lab`;
  const root = document.createElement("div");
  root.className = "stage";
  root.innerHTML = `
    <canvas></canvas>
    <div class="cap"><p class="line"></p><p class="sub"></p></div>
    <nav class="keys"><a href="/">Lab</a><span><kbd>S</kbd> still</span><span><kbd>L</kbd> loop</span><span><kbd>P</kbd> share</span><span><kbd>D</kbd> demo</span><span><kbd>T</kbd> theme</span></nav>
    <div class="badge"></div>
    <div class="labels"></div>
    <div class="tip" hidden></div>
    <div class="wait">Reading your messages…</div>`;
  document.body.append(root);
  const canvas = root.querySelector("canvas")!;
  const tip = root.querySelector<HTMLDivElement>(".tip")!;
  const badge = root.querySelector<HTMLDivElement>(".badge")!;
  const labelBox = root.querySelector<HTMLDivElement>(".labels")!;

  const mind: Mind = await getMind();
  root.querySelector(".wait")!.remove();
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || params.has("still");
  const piece: Piece = factory(canvas, mind, theme, { share: share.on, still });

  const line = root.querySelector(".line")!, sub = root.querySelector(".sub")!;
  const setCaption = () => {
    const c = piece.caption();
    if (line.textContent !== c.line) line.textContent = c.line;
    if (sub.textContent !== c.sub) sub.textContent = c.sub;
    badge.textContent = [mind.synthetic ? "Synthetic data" : "", share.on ? "Share mode: shapes only" : ""].filter(Boolean).join(" · ");
  };
  setCaption();

  const size = () => piece.resize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));
  size();
  addEventListener("resize", size);

  let paused = false, t = 0, last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!paused) { t += dt; piece.frame(t, dt); drawLabels(); }
    if (!still) requestAnimationFrame(loop);
  };
  let lastCap = 0;
  const drawLabels = () => {
    if (performance.now() - lastCap > 200) { lastCap = performance.now(); setCaption(); }
    const ls = piece.labels?.() ?? [];
    while (labelBox.children.length < ls.length) labelBox.append(document.createElement("span"));
    [...labelBox.children].forEach((el, i) => {
      const l = ls[i], e = el as HTMLSpanElement;
      if (!l) { e.hidden = true; return; }
      e.hidden = false; e.textContent = l.text;
      const shift = l.align === "right" ? "-100%" : l.align === "left" ? "0" : "-50%";
      e.style.transform = `translate(${l.x}px, ${l.y}px) translate(${shift}, -50%)`;
    });
  };
  // with reduced motion the picture holds still, redrawn now and then in case its data arrived late
  // ?at=1.5 holds the picture at that moment, for judging an entrance frame by frame
  const at = params.get("at");
  const hold = () => requestAnimationFrame(() => { piece.frame(at ? +at : 8, 0); drawLabels(); });
  if (still || at) { hold(); setInterval(hold, 700); } else requestAnimationFrame(loop);

  canvas.addEventListener("pointermove", e => {
    const html = piece.hover(e.clientX, e.clientY);
    if (!html) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(innerWidth - r.width - 12, e.clientX + 16) + "px";
    tip.style.top = Math.min(innerHeight - r.height - 12, e.clientY + 16) + "px";
  });
  canvas.addEventListener("pointerleave", () => { tip.hidden = true; piece.hover(-1, -1); });

  addEventListener("keydown", e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "s") savePNG(piece, theme, name, still ? 8 : t);
    else if (k === "l") recordLoop(piece, name);
    else if (k === "p") { share.on = !share.on; piece.setShare(share.on); setCaption(); tip.hidden = true; }
    else if (k === "d") { params.has("demo") ? params.delete("demo") : params.set("demo", "1"); location.search = params.toString(); }
    else if (k === "t") {
      theme = theme.dark ? LIGHT : DARK;
      document.documentElement.dataset.theme = theme.dark ? "dark" : "light";
      piece.setTheme(theme);
      if (still) piece.frame(8, 0);
    } else if (k === " ") { paused = !paused; e.preventDefault(); }
  });
}

