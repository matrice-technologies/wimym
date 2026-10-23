// Loom, strummed (a sketch beside the Loom): the same loom with no weft, and the session threads dark.
// The shuttle strums every session thread it crosses, like
// strings: each one it touches sends a pulse of light both ways along its thread, up through the
// session's own cloth and down to the back of the loom, that shows the thread as it passes and leaves
// it glowing a moment before it goes dark again;
// the string shivers where the pulse is. The message's own session rings brightest; the others it
// passes are brushed. Pointing at a thread plucks it too. The wheel rewinds the loom, which weaves on
// from there.
import type { Mind } from "../shared/data";
import { FAM_NAMES, hex, type Theme } from "../shared/palette";
import { fmtDay, fmtHour, type PieceFactory } from "../shared/piece";
import { EDGE, GAP, Loom, lowerBound, SHED, type LoomOptions, type Session, type Stage } from "./loom";
import { Mass } from "./loom-mass";

const SPEED = 640;            // px a second the light runs up the thread
const DECAY = 2.4;            // seconds for a pulse to fall to a third
const AFTER = 0.55;           // seconds the thread glows after the pulse has passed, to a third
const OWN = 1, BRUSH = 0.45;  // how hard the message's own session is struck, and the others crossed
const LENGTH = 26;            // px, the pulse's half length along the thread
const SHIVER = 1.6, WAVE = 20;  // px the string moves at most, and the length of its ripple
const MAX = 400;              // waves alive at once at most
const SWEEP_IN = 0.15, SWEEP = 0.9, SWEPT = 0.6;   // the opening sweep: seconds before it, across, and how hard
const SP_MIN = 4, SP_MAX = 12;  // px between strings at most and least: as far apart as the strings on screen let the loom fill its room
const FIT = 1.6;              // how quickly the spacing follows (per second)
const RUN = 1100;             // px a second a change in the loom runs up its strings, from the fell
const CAP_CLEAR = 76;         // px from the fell to the caption's top, on a narrow screen: the names fit between
const NAME_PAD = 18;          // px at least between two columns' names
const DAY_EASE = 7;           // how quickly the days follow the cloth (per second): it moves on a pick at a time, they glide
const DAY_IN = 24;            // px above the fell over which a day comes in
const BIRTH = 0.9, BORN = 1.3;   // seconds a new session's spark lasts, and how hard its first strike rings
// the types' colours, as lights in a dark room (and their light-theme twins): ask ice blue, steer ember, make gold,
// approve a champagne white (the commonest type, kept quiet), run aqua, ship mint, think lavender; unlabelled slate.
// Searched in OKLCH so that any two stay apart side by side: worst pair ΔE 14.7 for full colour vision and 7.4 under
// protanopia or deuteranopia (the app's palette: 9.8, and 0.5 for ship and steer)
const TYPE_DARK = ["#85cdff", "#ff7e75", "#f3c443", "#f9edda", "#00b5b7", "#7df292", "#bb94f4"], PLAIN_DARK = "#707883";
const TYPE_LIGHT = ["#005da2", "#c44132", "#bb8800", "#7a654d", "#009a97", "#42b352", "#925ac9"], PLAIN_LIGHT = "#a0a5ac";
const QUIET = 320;            // px of cloth without a message after which a column rests
// what strikes the strings at the fell: a spark of light, running along a faint horizon
const SHED_UP = 11;           // px above the shed's line, at the fell, where the spark runs
const TAIL = 0.12;            // seconds of the spark's path kept, for its tail

export const loomStrum: PieceFactory = (canvas, mind, theme, opts) => {
  const q = new URLSearchParams(location.search);
  return new Strum(canvas, mind, theme, opts.share, opts.still, { mass: q.has("mass"), colour: q.get("colour") === "project" ? "project" : "type", keys: true, caption: true });
};
/** The front page's: the aurora on, coloured by type, and nothing of the lab page's (its keys, its wheel, its caption over the loom). */
export const loomHero: PieceFactory = (canvas, mind, theme, opts) =>
  new Strum(canvas, mind, theme, opts.share, opts.still, { mass: true, colour: "type", keys: false, caption: false, wheel: false });

/** mass: the aurora at first; keys: C and M change the colour and the aurora; caption: a lab page's .cap spans the
 * bottom on a narrow screen, and the loom sits above it. */
export interface StrumOptions extends LoomOptions { mass?: boolean; colour?: "project" | "type"; keys?: boolean; caption?: boolean }

/** A strike on string s at Y; i: the message that struck it, -1 for a pluck. */
interface Wave { s: number; Y: number; t0: number; a: number; i: number }
interface Trace { x: number; Y: number; t: number; col: string }

export class Strum extends Loom {
  protected knots = false;
  protected warp = false;
  protected weft = false;
  protected rollAway = false;
  waves: Wave[] = [];
  bySess = new Map<number, Wave[]>();
  struck = new Set<number>();   // lanes of the pick in the shed already struck
  sk = 0;                       // the pick being strummed
  plucked = -1;                 // the thread last plucked by the pointer
  noticeAt = -10; notice = "";  // what was last changed, named a moment
  mass: Mass; massOn: boolean;  // the weight of attention the projects carry, a slow body far behind the loom (M, or ?mass)
  colourBy: "project" | "type"; // what the light takes its colour from: the string's project, or the message's type
  legend: { x: number; y: number; text: string; alpha: number; align: "left" }[] = [];
  trail: Trace[] = [];          // the shuttle's path lately, along the cloth
  dark = true;                  // every string on screen still unstruck: at first, and after the wheel
  sp = 0;                       // px between strings now, easing to fit
  reach: Float32Array;          // per column: how many lanes out from its middle its strings on screen reach, easing
  names: { x: number; y: number; text: string; alpha: number }[] = [];   // the columns' names, laid out
  days: { x: number; y: number; text: string; alpha: number; align: "left" | "right" }[] = [];   // the days beside the loom, laid out
  dayY = NaN;                   // the fell, along the cloth, as the days follow it
  nowY = 0;                     // the fell, along the cloth, this frame
  onLoom: number[] = [];        // the sessions whose strings are on the loom now
  hist: { t: number; x: Float32Array }[] = [];   // where each string on the loom crossed the fell, lately
  births: { s: number; Y: number; t0: number; i: number }[] = [];   // new sessions' first strikes, sparking
  born = new Set<number>();
  widths = new Map<string, number>(); font = "";

  readonly keys: boolean; readonly overCaption: boolean;

  constructor(canvas: HTMLCanvasElement, mind: Mind, theme: Theme, share: boolean, still: boolean, opts: StrumOptions = {}) {
    super(canvas, mind, theme, share, still, opts);
    this.sk = this.cur;
    this.reach = new Float32Array(this.cols.length);
    this.colourBy = opts.colour ?? "type";
    this.mass = new Mass({ x: s => this.xAt(s, this.nowY), light: (s, i) => this.colourOf(this.sess[s], i) });
    this.massOn = opts.mass ?? false;
    this.keys = opts.keys ?? false; this.overCaption = opts.caption ?? false;
    if (this.keys) addEventListener("keydown", this.key);
  }
  key = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "c") {
      this.colourBy = this.colourBy === "type" ? "project" : "type";
      this.notice = `Colour by ${this.colourBy} · C to change`; this.trail = [];
    } else if (k === "m") {
      this.massOn = !this.massOn;
      this.notice = `Mass ${this.massOn ? "on" : "off"} · M to change`;
    } else return;
    this.noticeAt = this.t;
  };
  dispose() { super.dispose(); if (this.keys) removeEventListener("keydown", this.key); this.mass.dispose(); }

  resize(w: number, h: number, dpr: number) { super.resize(w, h, dpr); this.clearCaption(); }
  /** On a narrow screen the caption spans the bottom: the fell sits above it, with room for the names between. Its
   * height is read from the page, now and then, as its text arrives after the data. */
  private clearCaption() {
    this.capRead = this.t;
    if (this.w / this.h > 1.25 || !this.overCaption) return;
    const cap = document.querySelector(".cap"), top = cap ? cap.getBoundingClientRect().top - this.canvas.getBoundingClientRect().top : this.h;
    this.fell = Math.max(this.h * 0.42, Math.min(this.h * 0.76, top - CAP_CLEAR));
  }
  private capRead = -1;

  frame(t: number, dt: number) {
    this.t = t;
    if (t - this.capRead > 0.5) this.clearCaption();
    // weave on and strike first, so the threads shiver as the cloth is drawn
    if (!this.still && dt) this.advance(dt);
    this.nowY = this.woven() - this.back;
    this.fit(dt);
    this.record(t);
    this.strum(t);
    super.frame(t, 0);
    this.name();
    this.date(dt);
  }

  /** The spacing of the strings, from how many are on the loom: each column as wide as the lanes its strings reach,
   * and one spacing for all, so that together they fill the loom's room, within SP_MIN and SP_MAX. */
  private fit(dt: number) {
    const now = this.nowY, lo = now - this.fell - 40, hi = now + 60, reach = new Float32Array(this.cols.length);
    this.onLoom = [];
    this.sess.forEach((S, s) => {
      if (S.y0 > now || S.yGone <= now || this.cols[S.col].yGone <= now) return;
      this.onLoom.push(s); reach[S.col] = Math.max(reach[S.col], Math.ceil(S.lane / 2));
    });
    const first = this.sp === 0, k = first || !dt ? 1 : 1 - Math.exp(-dt * FIT);
    for (let c = 0; c < reach.length; c++) this.reach[c] += (reach[c] - this.reach[c]) * k;
    this.see(lo, hi);
    let fixed = 0, lanes = 0;
    for (const c of this.vis) { const w = this.weight(this.cols[c], now); fixed += w * (2 * EDGE + GAP); lanes += w * 2 * this.reach[c]; }
    // on a wide screen the caption is at the left: the loom keeps to the right of it
    const room = this.w / this.h > 1.25 ? Math.min(this.room, 2 * (this.centre - this.w * 0.39)) : this.room;
    const want = lanes > 0.01 ? Math.max(SP_MIN, Math.min(SP_MAX, (room - fixed) / lanes)) : SP_MAX;
    this.sp += (want - this.sp) * k;
    this.cols.forEach((C, c) => { C.width = 2 * this.reach[c] * this.sp + 2 * EDGE; });
  }
  protected gap(_c: number) { return this.sp || SP_MAX; }

  // ---------- strings straight up from the loom ----------
  // A string runs straight up from where it is on the loom now, not where its column stood when that stretch of
  // cloth was woven. When the loom changes (a column opens, rests, the spacing eases), the change starts at the fell
  // and runs up the string at RUN px a second: a bend at the base that climbs, leaving the string straight.

  /** Where each string on the loom crosses the fell this frame, kept as long as a change takes to reach the top. */
  private record(t: number) {
    const x = new Float32Array(this.sess.length).fill(NaN);
    this.place(this.nowY);
    for (const s of this.onLoom) { const S = this.sess[s]; x[s] = this.laneX(S.col, S.lane); }
    this.hist.push({ t, x });
    const keep = (this.fell + 60) / RUN + 0.1;
    while (this.hist.length > 2 && this.hist[1].t < t - keep) this.hist.shift();
  }
  /** Where string s is at a point of the cloth: where it was on the loom when the change reaching that height left the fell. */
  private xAt(s: number, Y: number) {
    const h = this.hist, n = h.length;
    if (!n) return NaN;
    const tq = this.t - Math.max(0, this.nowY - Y) / RUN;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (h[mid].t <= tq) lo = mid; else hi = mid - 1; }
    for (let i = lo; i < n; i++) { const v = h[i].x[s]; if (!Number.isNaN(v)) return v; }   // not on the loom then: as it came on
    for (let i = lo - 1; i >= 0; i--) { const v = h[i].x[s]; if (!Number.isNaN(v)) return v; }   // off it since: as it left
    const S = this.sess[s]; this.place(this.nowY); return this.laneX(S.col, S.lane);
  }

  /** The open columns' names under the loom, in one row in their order, each as near its column as the others let
   * it be (two rows when they can't fit), with a faint line to its column when it had to move aside. */
  private name() {
    const g = this.g, now = this.woven() - this.back, y = this.fell + SHED + 40;
    if (!this.font) this.font = `500 12px ${getComputedStyle(document.body).fontFamily}`;
    g.font = this.font;
    this.place(now);
    const items: { x: number; w: number; text: string; alpha: number; at: number; y: number }[] = [];
    for (const c of this.vis) {
      const w = this.cw[c];
      if (w < 0.05) continue;
      const text = this.columnName(c), alpha = Math.min(1, w * 1.4);
      let tw = this.widths.get(text);
      if (tw == null) { tw = g.measureText(text).width; this.widths.set(text, tw); }
      items.push({ x: this.cx[c], w: tw * alpha, text, alpha, at: this.cx[c], y });
    }
    items.sort((a, b) => a.x - b.x);
    const total = items.reduce((a, it) => a + it.w + NAME_PAD, 0), rows = total > this.room + 160 ? 2 : 1;
    this.names = [];
    for (let r = 0; r < rows; r++) {
      const row = items.filter((_, i) => i % rows === r);
      dodge(row, NAME_PAD);
      for (const it of row) { it.y = y + r * 16; this.names.push({ x: it.at, y: it.y, text: it.text, alpha: it.alpha }); }
    }
    this.drawLegend(g);
    const C = this.colours();
    // a faint line from a name that had to move aside up to its column
    g.save(); g.strokeStyle = C.muted; g.lineWidth = 0.6;
    for (const it of items) {
      const d = Math.abs(it.at - it.x);
      if (d < 4) continue;
      g.globalAlpha = 0.35 * it.alpha * Math.min(1, (d - 4) / 12);
      g.beginPath(); g.moveTo(it.x, this.fell + SHED - 2); g.lineTo(it.x, this.fell + SHED + 8); g.lineTo(it.at, it.y - 10); g.stroke();
    }
    // a soft patch of the room's dark behind each name, so the strings running down past it don't cross the letters
    g.fillStyle = C.ground; g.shadowColor = C.ground; g.shadowBlur = 10;
    for (const it of items) {
      const tw = this.widths.get(it.text)!;
      g.globalAlpha = 0.88 * it.alpha;
      g.beginPath(); g.roundRect(it.at - tw / 2 - 7, it.y - 9, tw + 14, 18, 9); g.fill();
    }
    g.restore();
  }

  /** The days beside the loom, each where its first message lies in the cloth, on a patch of the room's dark as the
   * names are. The cloth moves on a pick at a time; the days follow it eased, so they glide up rather than tick, and
   * come in at the fell and go near the top gently. On a narrow screen they keep to the left margin; on a wide one,
   * at the loom's left edge when a caption is at the bottom, and at its right when the page's words fill the left. */
  private date(dt: number) {
    const m = this.mind, now = this.nowY;
    this.days = [];
    if (!m.n) return;
    this.dayY = dt && Math.abs(now - this.dayY) < 300 ? this.dayY + (now - this.dayY) * (1 - Math.exp(-dt * DAY_EASE)) : now;
    const at = Math.min(this.dayY, now), top = this.h * 0.18, drawn = this.drawn(now);
    this.place(now);
    const [l0, r0] = this.edges(), narrow = this.w / this.h <= 1.25;
    const align = narrow || !this.overCaption ? "left" : "right", x = narrow ? 16 : this.overCaption ? l0 - 14 : r0 + 14;
    for (let k = Math.max(0, lowerBound(this.Y, at - this.fell)); k < drawn && this.Y[k] <= at; k++) {
      if (k && m.day[this.order[k]] === m.day[this.order[k - 1]]) continue;
      const y = this.fell - (at - this.Y[k]);
      if (y < top) continue;
      const alpha = Math.max(0, Math.min(1, (y - top) / (this.h * 0.08), 0.2 + (this.fell - y) / DAY_IN));
      this.days.push({ x, y, text: `${fmtDay(m.days[m.day[this.order[k]]])}, ${fmtHour(m.hour[this.order[k]])}`, alpha, align });
    }
    const g = this.g, C = this.colours();
    g.save(); g.font = this.font; g.fillStyle = C.ground; g.shadowColor = C.ground; g.shadowBlur = 10;
    for (const d of this.days) {
      let tw = this.widths.get(d.text);
      if (tw == null) { tw = g.measureText(d.text).width; this.widths.set(d.text, tw); }
      g.globalAlpha = 0.88 * d.alpha;
      g.beginPath(); g.roundRect(d.align === "left" ? d.x - 7 : d.x - tw - 7, d.y - 9, tw + 14, 18, 9); g.fill();
    }
    g.restore();
  }

  /** In colour by type, the legend: in the corner opposite the caption, as the caption sits (bottom right, a heading
   * and a row per type, a dot of its colour before its name); on a narrow screen, where the caption spans the
   * bottom, in a row or two along the top. */
  private drawLegend(g: CanvasRenderingContext2D) {
    this.legend = [];
    if (this.colourBy !== "type") return;
    const keys = [...FAM_NAMES.map((t, f) => [t, f] as const), ["Unlabelled", -1] as const];
    const ws = keys.map(([t]) => { let tw = this.widths.get(t); if (tw == null) { tw = g.measureText(t).width; this.widths.set(t, tw); } return tw; });
    const dot = (x: number, y: number, f: number) => { g.fillStyle = this.typeColour(f); g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); };
    g.save();
    if (this.w / this.h > 1.25) {
      // the caption's margins, mirrored
      const side = Math.max(16, Math.min(48, this.w * 0.04)), foot = Math.max(20, Math.min(48, this.h * 0.05)), row = 19;
      const x = this.w - side - (Math.max(...ws) + 12), last = this.h - foot - 9;
      this.legend.push({ x, y: last - keys.length * row - 6, text: "Message type", alpha: 0.6, align: "left" });
      keys.forEach(([t, f], q) => { const y = last - (keys.length - 1 - q) * row; dot(x + 3, y, f); this.legend.push({ x: x + 12, y, text: t, alpha: 0.9, align: "left" }); });
    } else {
      // along the top, below the keys, in two rows when one won't fit
      const gap = 14, item = (q: number) => ws[q] + 12, one = ws.reduce((a, _, q) => a + item(q), 0) + gap * (keys.length - 1);
      const rows = one > this.w - 32 ? 2 : 1, per = Math.ceil(keys.length / rows);
      for (let r = 0; r < rows; r++) {
        const qs = keys.map((_, q) => q).slice(r * per, (r + 1) * per), span = qs.reduce((a, q) => a + item(q), 0) + gap * (qs.length - 1);
        let x = this.w / 2 - span / 2;
        const y = 52 + r * 18;
        // the strings run up past it: the room's dark behind it, as behind the names
        g.save(); g.fillStyle = this.theme.ground; g.shadowColor = this.theme.ground; g.shadowBlur = 10; g.globalAlpha = 0.88;
        g.beginPath(); g.roundRect(x - 8, y - 9, span + 16, 18, 9); g.fill(); g.restore();
        for (const q of qs) { dot(x + 3, y, keys[q][1]); this.legend.push({ x: x + 12, y, text: keys[q][0], alpha: 0.9, align: "left" }); x += item(q) + gap; }
      }
    }
    g.restore();
  }

  /** Strike every lane the shuttle has passed since the last frame, then forget the waves that died. */
  private strum(t: number) {
    const n = this.A.length;
    if (!n || this.still) return;
    if (this.dark) { this.dark = false; this.reveal(t); }
    while (this.sk < Math.min(this.cur, n)) { this.strike(this.sk, Infinity, t); this.sk++; this.struck.clear(); }
    if (this.cur < n && this.sk === this.cur) {
      const [st, p] = this.stage();
      if (st === "fly") this.strike(this.cur, this.flyX(this.cur, p), t);
      else if (st === "beat" || st === "ret") this.strike(this.cur, Infinity, t);
    }
    if (this.waves.length > MAX) this.waves.splice(0, this.waves.length - MAX);
    this.waves = this.waves.filter(w => t - w.t0 < DECAY * 3);
    this.births = this.births.filter(b => t - b.t0 < BIRTH);
    this.index();
  }
  /** Strike the lanes of pick k up to where the shuttle is (all of them for Infinity). */
  private strike(k: number, upTo: number, t: number) {
    if (this.colOf[k] < 0) return;
    this.place(this.Y[k]); this.span(k);
    const own = this.sessOf[k], d = this.dir[k], ss = this.aliveSess[k];
    for (const s of ss) {
      const S = this.sess[s];
      if (this.struck.has(S.lane)) continue;
      const x = this.laneX(S.col, S.lane);
      if (upTo !== Infinity && (d > 0 ? x > upTo : x < upTo)) continue;
      this.struck.add(S.lane);
      this.waves.push({ s, Y: this.Y[k], t0: t, a: s === own ? OWN : BRUSH, i: this.order[k] });
    }
    if (own >= 0 && !this.struck.has(this.sess[own].lane)) {
      const S = this.sess[own], x = this.laneX(S.col, S.lane);
      if (upTo === Infinity || (d > 0 ? x <= upTo : x >= upTo)) { this.struck.add(S.lane); this.waves.push({ s: own, Y: this.Y[k], t0: t, a: OWN, i: this.order[k] }); }
    }
    // a session's very first message (not its string taken over in another column): a spark, and a string that rings harder
    const O = own >= 0 ? this.sess[own] : null;
    if (O && O.first === k && O.from < 0 && this.struck.has(O.lane) && !this.born.has(own)) {
      this.born.add(own);
      this.births.push({ s: own, Y: this.Y[k], t0: t, i: this.order[k] });
      this.waves.push({ s: own, Y: this.Y[k], t0: t, a: BORN, i: this.order[k] });
    }
  }
  /** A hand swept across the loom, left to right: every string on it struck once at the fell, so it opens lit. */
  private reveal(t: number) {
    const now = this.nowY, at: [number, number, number][] = [];
    for (const s of this.onLoom) if (this.sess[s].first < this.cur) at.push([s, now, this.xAt(s, now)]);
    if (!at.length) return;
    const xs = at.map(a => a[2]), x0 = Math.min(...xs), wide = Math.max(1, Math.max(...xs) - x0);
    for (const [s, Y, x] of at) this.waves.push({ s, Y, t0: t + SWEEP_IN + SWEEP * (x - x0) / wide, a: SWEPT, i: this.lastSent(s) });
  }
  private index() {
    this.bySess.clear();
    for (const w of this.waves) { const l = this.bySess.get(w.s); l ? l.push(w) : this.bySess.set(w.s, [w]); }
  }

  protected step(S: Session) { return this.bySess.has(this.sessIndex(S)) ? 3 : 6; }
  protected sway(S: Session, Y: number) {
    const ws = this.bySess.get(this.sessIndex(S));
    if (!ws) return 0;
    let x = 0;
    for (const w of ws) {
      const age = this.t - w.t0;
      if (age < 0) continue;   // a sweep's strike still to come
      for (const at of [w.Y - age * SPEED, w.Y + age * SPEED]) {   // the pulse up, and the one down
        const u = (Y - at) / LENGTH;
        if (u * u > 4) continue;
        x += SHIVER * w.a * Math.exp(-age / DECAY) * Math.exp(-u * u) * Math.sin((Y - at) * (Math.PI * 2 / WAVE) + age * 40);
      }
    }
    return x;
  }
  private sessIndex(S: Session) { return this.sessOf[S.first]; }
  /** Strings keep their spacing while their column opens or closes, rather than gathering to its middle. */
  protected spread(_c: number) { return 1; }
  /** A dark string shows only when struck: a column whose project has gone quiet rests, and opens again in its place. */
  protected quiet() { return QUIET; }
  /** A session is one string: moving to another column, it hands its string over. */
  protected handOver() { return true; }

  /** The light running up and down each struck thread, the thread glowing in its wake, and a flash where the shuttle touched it. */
  protected overCloth(off: number, t: number) {
    const g = this.g, dark = this.theme.dark, now = this.woven() - this.back, wake = SPEED * AFTER;
    // far back, before any light: the mass
    if (this.massOn) this.mass.draw(g, this, this.still);
    g.save();
    // light adds up in the dark; by type, it screens, so a string struck again and again keeps its colour
    if (dark) g.globalCompositeOperation = this.colourBy === "type" ? "screen" : "lighter";
    g.lineCap = "round";
    this.place(now);
    for (const w of this.waves) {
      const S = this.sess[w.s], age = t - w.t0, fall = Math.exp(-age / DECAY) * w.a;
      if (age < 0 || fall < 0.02) continue;
      const col = this.colourOf(S, w.i), up = w.Y - age * SPEED, down = w.Y + age * SPEED;
      // up through the session's cloth and on up its lane, to the top of the screen
      this.lit(S, Math.max(-off - 20, up - LENGTH), Math.min(now, w.Y, up + wake * 3), up, -1, fall, col, off);
      // down through the cloth to the fell
      this.lit(S, Math.max(S.y0, w.Y, down - wake * 3), Math.min(now, down + LENGTH), down, 1, fall, col, off);
      // and on down the thread to the back of the loom, if the session is still on the loom
      if (down + LENGTH > now && down - wake * 3 < now + this.h && S.yGone > now && this.cols[S.col].yGone > now && this.vis.includes(S.col)) {
        const fy = now + off, x = this.xAt(w.s, now), sway = this.still ? 0 : Math.sin(t * 0.9 + x * 0.05) * 0.6;
        const bx = this.centre + (x - this.centre) * 0.55, front = fy + (down - now);
        // on a narrow screen it stops above the caption
        const narrow = this.w / this.h <= 1.25 && this.overCaption;
        if (narrow) { g.save(); g.beginPath(); g.rect(0, 0, this.w, this.fell + CAP_CLEAR - 8); g.clip(); }
        g.beginPath(); g.moveTo(x, fy); g.quadraticCurveTo(x + sway, (fy + this.h) / 2, bx, this.h);
        g.strokeStyle = this.glow(front, 1, fall, col); g.lineWidth = 1.4 + 2.2 * fall; g.stroke();
        if (narrow) g.restore();
      }
      // the flash at the strike, short
      if (age < 0.3 && w.Y <= now) {
        const x = this.xAt(w.s, w.Y), y = w.Y + off, k = 1 - age / 0.3, r = 5 + 8 * w.a;
        const flash = g.createRadialGradient(x, y, 0, x, y, r);
        flash.addColorStop(0, rgba(col, k * w.a)); flash.addColorStop(1, rgba(col, 0));
        g.fillStyle = flash; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }
    for (const b of this.births) this.spark(b, off, t);
    g.restore();
  }
  /** A new session's spark where its string was first struck: a flash, a ring opening out, and sparks thrown off it. */
  private spark(b: { s: number; Y: number; t0: number; i: number }, off: number, t: number) {
    const g = this.g, p = (t - b.t0) / BIRTH;
    if (p < 0 || p >= 1) return;
    const S = this.sess[b.s], col = this.colourOf(S, b.i), x = this.xAt(b.s, b.Y), y = b.Y + off, out = 1 - (1 - p) ** 3, fade = 1 - p;
    const r = 4 + 16 * (1 - p), flash = g.createRadialGradient(x, y, 0, x, y, r);
    flash.addColorStop(0, `rgba(255,255,255,${0.9 * fade * fade})`); flash.addColorStop(0.4, rgba(col, 0.6 * fade)); flash.addColorStop(1, rgba(col, 0));
    g.fillStyle = flash; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = rgba(col, 0.8 * fade ** 1.5); g.lineWidth = 1.4 * fade + 0.3;
    g.beginPath(); g.arc(x, y, 3 + 30 * out, 0, Math.PI * 2); g.stroke();
    const turn = (b.s * 2.399) % (Math.PI * 2);   // each session's sparks thrown its own way
    g.lineWidth = 1; g.strokeStyle = rgba(col, 0.9 * fade * fade);
    g.beginPath();
    for (let q = 0; q < 8; q++) {
      const a = turn + q * Math.PI / 4, r1 = 5 + 24 * out, r2 = r1 + 7 * fade;
      g.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); g.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
    }
    g.stroke();
  }
  /** Light a stretch [a, b] of a thread in the cloth for a pulse at `front` going `dir` (-1 up, 1 down). */
  private lit(S: Session, a: number, b: number, front: number, dir: number, fall: number, col: string, off: number) {
    if (b <= a) return;
    const g = this.g;
    this.ray(S, a, b, off);
    g.strokeStyle = this.glow(front + off, dir, fall, col); g.lineWidth = 1.6 + 2.6 * fall; g.stroke();
    // a white core at the pulse itself
    const ca = Math.max(a, front - LENGTH * 0.6), cb = Math.min(b, front + LENGTH * 0.6);
    if (cb > ca) {
      const core = g.createLinearGradient(0, front - LENGTH * 0.6 + off, 0, front + LENGTH * 0.6 + off), white = (this.theme.dark ? 0.85 : 0.6) * (this.colourBy === "type" ? 0.45 : 1);
      core.addColorStop(0, "rgba(255,255,255,0)"); core.addColorStop(0.5, `rgba(255,255,255,${white * Math.min(1, fall)})`); core.addColorStop(1, "rgba(255,255,255,0)");
      this.ray(S, ca, cb, off); g.strokeStyle = core; g.lineWidth = 1.1; g.stroke();
    }
  }
  /** A string between two points of the cloth, straight up from the loom but for a change climbing it. */
  private ray(S: Session, a: number, b: number, off: number) {
    const g = this.g, s = this.sessIndex(S), steps = Math.max(1, Math.ceil((b - a) / this.step(S)));
    g.beginPath();
    for (let q = steps; q >= 0; q--) {
      const Y = a + (b - a) * q / steps;
      const sx = this.xAt(s, Y) + this.sway(S, Y);
      q === steps ? g.moveTo(sx, Y + off) : g.lineTo(sx, Y + off);
    }
  }
  /** A vertical gradient (screen y): nothing ahead of the pulse, brightest at it, the wake dimming behind. */
  private glow(front: number, dir: number, fall: number, col: string) {
    const wake = SPEED * AFTER, ahead = front + dir * LENGTH, behind = front - dir * wake * 3;
    const grad = this.g.createLinearGradient(0, ahead, 0, behind), span = LENGTH + wake * 3, stop = (d: number) => Math.min(1, d / span);
    const peak = Math.min(1, fall);
    grad.addColorStop(0, rgba(col, 0));
    grad.addColorStop(stop(LENGTH), rgba(col, peak));
    for (const q of [0.5, 1, 2]) grad.addColorStop(stop(LENGTH + wake * q), rgba(col, peak * Math.exp(-q) * 0.8));
    grad.addColorStop(1, rgba(col, 0));
    return grad;
  }
  private warpColour(S: Session) {
    const dark = this.theme.dark;
    const F = dark ? ["#a9c3f0", "#8fdccb", "#c6b6f5", "#f0cb8a", "#f2a9c5", "#acdcf0", "#d6e29a", "#c0cae6"] : ["#3f68b0", "#24806f", "#6a4fb8", "#9a6d1c", "#a8406e", "#1f7ea3", "#66781c", "#4f5a7a"];
    return F[this.cols[S.col].floss % F.length];
  }

  // ---------- the spark ----------

  /** The colour of what the shuttle carries for pick k: its column's. */
  private tint(k: number) {
    if (this.colourBy === "type") return this.typeColour(this.mind.family[this.order[k]]);
    const c = this.colOf[k]; return c < 0 ? (this.theme.dark ? "#e8ecf6" : "#2a3350") : this.warpColour(this.sess[this.sessOf[k]]);
  }
  /** The colour of the light a message sends along string S: the string's project's, or the message's type's. */
  private colourOf(S: Session, i: number) { return this.colourBy === "type" ? this.typeColour(i < 0 ? -1 : this.mind.family[i]) : this.warpColour(S); }
  /** A type's colour; unlabelled messages slate. */
  private typeColour(f: number) {
    const dark = this.theme.dark;
    return f < 0 ? (dark ? PLAIN_DARK : PLAIN_LIGHT) : (dark ? TYPE_DARK : TYPE_LIGHT)[f];
  }
  /** The last message sent on string s so far. */
  private lastSent(s: number) {
    const S = this.sess[s];
    if (S.last < this.cur) return this.order[S.last];
    for (let k = Math.min(this.cur, this.A.length) - 1; k >= S.first; k--) if (this.sessOf[k] === s) return this.order[k];
    return this.order[S.first];
  }

  /** A horizon across the room, faint, brightest under the cloth, with no ends: the line the spark runs along. */
  protected drawReed(_C: Parameters<Loom["drawReed"]>[0], l: number, r: number, _reedY: number, fy: number) {
    const g = this.g, ink = this.theme.dark ? "214,224,246" : "36,44,70";
    const y = fy + SHED - SHED_UP, cx = (l + r) / 2, reach = Math.max(this.w * 0.42, (r - l) / 2 + 120);
    const hz = g.createLinearGradient(cx - reach, 0, cx + reach, 0);
    hz.addColorStop(0, `rgba(${ink},0)`); hz.addColorStop(0.5, `rgba(${ink},0.2)`); hz.addColorStop(1, `rgba(${ink},0)`);
    g.fillStyle = hz; g.fillRect(cx - reach, y - 0.5, reach * 2, 1);
  }

  /** The spark: a point of light in the colour of the message it carries, with a short tail, breathing while it waits. */
  protected drawShuttle(_C: Parameters<Loom["drawShuttle"]>[0], sx: number, sY: number, k: number, stage: Stage, t: number) {
    const g = this.g, dark = this.theme.dark, col = this.tint(k), off = this.fell - this.nowY, moving = stage === "cross" || stage === "fly";
    const y = sY - SHED_UP, tr = this.trail;
    // its path, kept along the cloth so that it rises with it
    tr.push({ x: sx, Y: y - off, t, col });
    while (tr.length && t - tr[0].t > TAIL) tr.shift();
    g.save();
    if (dark) g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1], b = tr[i], f = 1 - (t - b.t) / TAIL;
      if (Math.abs(b.x - a.x) + Math.abs(b.Y - a.Y) < 0.01 || b.t - a.t > 0.1) continue;
      g.strokeStyle = rgba(b.col, f * 0.9); g.lineWidth = 2.4 * f;
      g.beginPath(); g.moveTo(a.x, a.Y + off); g.lineTo(b.x, b.Y + off); g.stroke();
    }
    const breath = moving ? 1 : 0.55 + 0.15 * Math.sin(t * 2.2), rh = 15 * breath;
    const halo = g.createRadialGradient(sx, y, 0, sx, y, rh);
    halo.addColorStop(0, rgba(col, 0.55 * breath)); halo.addColorStop(1, rgba(col, 0));
    g.fillStyle = halo; g.beginPath(); g.arc(sx, y, rh, 0, Math.PI * 2); g.fill();
    g.fillStyle = dark ? `rgba(255,255,255,${0.95 * breath})` : rgba(col, breath); g.beginPath(); g.arc(sx, y, 2, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  labels() {
    // the days and the columns' names as date() and name() laid them out; the legend; and what was changed, a moment
    const shown = this.t - this.noticeAt;
    const out: ReturnType<Loom["labels"]> = [...this.days, ...this.names, ...this.legend];
    // under the names; on a narrow screen, where the caption is, under the legend at the top
    const ny = this.w / this.h > 1.25 ? this.fell + SHED + 70 : (this.legend.length ? Math.max(...this.legend.map(l => l.y)) : 52) + 22;
    if (shown < 3) out.push({ x: this.centre, y: ny, text: this.notice, alpha: Math.min(1, (3 - shown) * 1.5) });
    return out;
  }

  /** The wheel rewinds the loom (or winds it on): it weaves on, strumming, from the message scrolled to. */
  protected scroll(dy: number) {
    const n = this.A.length;
    if (!n || this.still) return super.scroll(dy);
    const to = this.woven() + dy;
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.Y[mid] < to) lo = mid + 1; else hi = mid; }
    this.cur = Math.max(1, lo); this.e = 0; this.sk = this.cur; this.back = 0;
    this.struck.clear(); this.waves = []; this.trail = []; this.hist = []; this.births = []; this.born.clear(); this.dark = true; this.index();
  }

  /** The string pointed at: the nearest on the loom, where it runs now. */
  protected threadAt(x: number, y: number) {
    const Y = this.nowY - (this.fell - y);
    if (Y > this.nowY) return -1;
    let best = -1, bd = 4;
    for (const s of this.onLoom) { const d = Math.abs(this.xAt(s, Y) - x); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  hover(x: number, y: number) {
    const html = super.hover(x, y);
    // pointing at a thread plucks it, once each time the pointer comes to it
    const s = this.hoverS;
    if (s >= 0 && s !== this.plucked) {
      const Y = this.woven() - this.back - (this.fell - y);
      this.waves.push({ s, Y, t0: this.t, a: 0.7, i: this.lastSent(s) }); this.index();
    }
    this.plucked = s;
    return html;
  }

  caption() {
    const c = super.caption();
    return {
      line: c.line,
      sub: c.sub.replace("each have a column,", "each have a column, which rests while the project is quiet,")
        .replace("each thread in a column is a session", "each thread in a column is a session, a string the shuttle strums as it passes"),
    };
  }
}

function rgba(c: string, a: number) { const [r, g, b] = hex(c); return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`; }

/** Move items apart along a line, keeping their order, so that none is closer than pad to the next, each as near
 * where it wants to be (x) as it can: neighbours that would touch move as a block, centred on where they want to be. */
function dodge(items: { x: number; w: number; at: number }[], pad: number) {
  const blocks: { from: number; to: number; left: number; width: number }[] = [];
  items.forEach((it, i) => {
    let b = { from: i, to: i, left: it.x - it.w / 2, width: it.w };
    for (let p = blocks[blocks.length - 1]; p && p.left + p.width + pad > b.left; p = blocks[blocks.length - 1]) {
      blocks.pop();
      b = { from: p.from, to: b.to, left: 0, width: p.width + pad + b.width };
      let off = 0, sum = 0;
      for (let j = b.from; j <= b.to; j++) { sum += items[j].x - items[j].w / 2 - off; off += items[j].w + pad; }
      b.left = sum / (b.to - b.from + 1);
    }
    blocks.push(b);
  });
  for (const b of blocks) {
    let x = b.left;
    for (let j = b.from; j <= b.to; j++) { items[j].at = x + items[j].w / 2; x += items[j].w + pad; }
  }
}

