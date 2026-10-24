// Loom (a sketch): your attention as one continuous weft thread. The few projects you worked on most
// over the past week (a rolling week, judged at every message) each have a column, as wide as the most
// sessions it had open at once: a
// column opens when a project climbs among them and closes when it falls away, so the cloth widens and
// narrows with the projects that matter at the time. Messages anywhere else are woven together in one
// more column at the edge, Other projects. Each thread of warp in a column is a session: it starts
// with the session's first message (a knot), is bright while the session runs, stays a day after its
// last message, then fades over the next and leaves its place to a new one. Threads fill a column from
// its middle, so a project's cloth is as wide as the sessions you had open in it. Every message is one
// pass of the shuttle through its project's live sessions, over and under them, knotted on its own, in
// the order you sent them: it turns at the edge to come back for the next message in the same project,
// and is carried across when the next is in another. Pauses leave bare warp. The loom weaves the last
// days pick by pick, the shuttle through the shed and the reed beating each pick in; scroll to unroll
// the weeks before.
import type { Mind } from "../shared/data";
import { hex, type Theme } from "../shared/palette";
import { esc, fmtDay, fmtHour, fmtMonth, messageTip, roundN, type Piece, type PieceFactory } from "../shared/piece";

const PICK = 3.2;             // px of cloth per message
const W = 2.3;                // px, the weft's thickness
const PAUSE = 1.5;            // hours: a longer gap leaves bare warp
const SESSION_GAP = 0.75;     // without session ids: a project's messages less than this apart are one session
const HOLD = 24, FADE = 24;   // hours a session's thread stays after its last message, then fades
const TOP = 7;                // columns at most: the projects worked on most over the rolling week
const WINDOW = 24 * 7;        // hours: the rolling week
const MIN_OPEN = 6, SHARE_OPEN = 0.04;   // a project needs this many of the week's messages, and this share, for a column
const SHARE_KEEP = 0.015;     // and keeps it until its share falls under this, or a clearly busier project needs the place
const MARGIN = 1.25;          // how much busier, for that
const OPEN = 90, CLOSE = 90;  // px of cloth over which a column opens, and closes
const LOOP = 14;              // px past the cloth's edge where a detour loops (when there is no Other projects column)
const OTHER = -1;             // the project of the Other projects column
const START_DAYS = 6;         // the live weaving starts this many days before the end
const SP = 7;                 // px between two session threads
export const EDGE = 9, GAP = 16;   // px of cloth past a column's outer threads, and between two columns
const PASS = 0.07, SLOW = 0.36;    // seconds a pick takes, and how much slower the last few go
const ROLL = 170;             // px of cloth a second rolled through a pause
export const SHED = 14;       // px past the fell where the shuttle flies
const BOX = 26;               // px past the cloth's edge where the shuttle waits
const FLOSS_DARK = ["#7f9fd6", "#6fb5a7", "#a693d8", "#cfa86a", "#d48aa6", "#8cc0d8", "#b7c47a", "#9aa6c4"];

export const loom: PieceFactory = (canvas, mind, theme, opts) => new Loom(canvas, mind, theme, opts.share, opts.still);

/** Where the Loom is shown: wheel, whether the wheel unrolls the cloth (on a lab page; on a page that scrolls, the
 * wheel is the page's). */
export interface LoomOptions { wheel?: boolean }

/** A project's stretch among the most worked-on: its column, from the message that earned it to the one that closed it.
 * dips: where it began to close for a rest and where its project came back before it had, in pairs. */
export interface Column { p: number; first: number; t0: number; key: number; floss: number; lanes: number; width: number; y0: number; yClose: number; yGone: number; dips: number[] }
/** A session's thread in one column. tEnd: when it hands over to the same session's thread in another column (variants);
 * from: the thread it took over from, -1 for a session's first. */
export interface Session { col: number; first: number; last: number; n: number; t0: number; t1: number; lane: number; y0: number; y1: number; yHold: number; yGone: number; tEnd: number; from: number }
export type Stage = "rest" | "cross" | "fly" | "beat" | "ret" | "done";

export class Loom implements Piece {
  readonly canvas: HTMLCanvasElement; readonly mind: Mind; share: boolean; readonly still: boolean;
  g: CanvasRenderingContext2D; theme: Theme;
  w = 1; h = 1; dpr = 1;
  order: number[];              // messages in time order; k below is a place in it, a pick
  A: Float64Array;              // each pick's time, in hours from the first day's 05:00
  Y: Float32Array;              // where each pick lies along the cloth
  cols: Column[] = []; colOf: Int32Array;
  sess: Session[] = []; sessOf: Int32Array; nth: Int32Array;
  alive: Int32Array[] = [];     // per pick: the lanes of its column live at that moment
  aliveSess: Int32Array[] = []; // and the sessions on them
  protected knots = true;       // each pick knotted on its own session
  protected warp = true;        // the session threads drawn, in the cloth and from the back of the loom
  protected crossings = true;   // the session threads shown over the picks, every other one
  protected weft = true;        // the weft drawn: the picks, their turns and floats, the thread in the shed
  protected rollAway = true;    // the cloth fading out at the top
  dir: Int8Array;               // per pick: 1 if the shuttle goes left to right; a detour: the side it loops out to
  par: Uint8Array;              // per pick: odd or even in its column, for over and under
  // where the columns stand at one point of the cloth, filled by place()
  vis: number[] = []; cx: Float32Array; cw: Float32Array;
  centre = 0; fell = 0;
  // the weaving: picks before cur are in the cloth; e seconds into the pick at cur
  cur = 0; e = 0; T = { rest: 0, cross: 0, fly: 0, beat: 0, ret: 0 }; Tk = -1;
  back = 0; t = 0; hoverK = -1; hoverS = -1;
  switches = 0; inferred: boolean;
  protected x0 = 0; protected x1 = 0;   // the last span()
  protected room = 1;           // px across the loom has for its columns

  readonly scrolls: boolean;

  constructor(canvas: HTMLCanvasElement, mind: Mind, theme: Theme, share: boolean, still: boolean, opts: LoomOptions = {}) {
    this.canvas = canvas; this.mind = mind; this.theme = theme; this.share = share; this.still = still;
    this.scrolls = opts.wheel ?? true;
    this.g = canvas.getContext("2d")!;
    const n = mind.n, abs = (i: number) => mind.day[i] * 24 + mind.hour[i];
    this.order = Array.from({ length: n }, (_, i) => i).sort((a, b) => abs(a) - abs(b));
    this.A = Float64Array.from(this.order, abs);
    this.Y = new Float32Array(n);
    let y = 0;
    for (let k = 1; k < n; k++) {
      const gap = this.A[k] - this.A[k - 1];
      // a pause leaves bare warp, more for longer, but a weekend doesn't swallow the screen
      y += gap > PAUSE ? 8 + Math.min(80, Math.sqrt(gap) * 10) : PICK;
      this.Y[k] = y;
      if (gap <= PAUSE && mind.project[this.order[k]] !== mind.project[this.order[k - 1]]) this.switches++;
    }
    this.inferred = !mind.session;
    this.colOf = new Int32Array(n); this.sessOf = new Int32Array(n); this.nth = new Int32Array(n);
    this.dir = new Int8Array(n); this.par = new Uint8Array(n);
    this.buildColumns();
    this.buildSessions();
    this.cx = new Float32Array(this.cols.length); this.cw = new Float32Array(this.cols.length);
    const startAt = this.order.findIndex(i => mind.day[i] >= mind.days.length - START_DAYS);
    this.cur = still || startAt < 0 ? n : startAt;
    if (this.scrolls) canvas.addEventListener("wheel", this.wheel, { passive: false });
  }

  /** The columns: at every message, which projects were worked on most over the week before it. */
  protected buildColumns() {
    const m = this.mind, n = m.n, proj = (k: number) => m.project[this.order[k]];
    const count = new Map<number, number>(), open = new Map<number, number>(), picks: number[] = [];
    const lastY: number[] = [], rested = new Map<number, number>(), quiet = this.quiet();   // per column, its last message; a rested project's column
    let tail = 0, total = 0, left = 0, right = 0, other = -1, others = 0, otherWas = -1;
    const endAt = (c: number, Y: number) => { const C = this.cols[c]; C.yClose = Y; C.yGone = Y + CLOSE; };
    // a rested column its project comes back to before it has quite closed opens again, from as far as it had closed
    const revive = (c: number, k: number) => {
      const C = this.cols[c];
      if (!(this.Y[k] < C.yGone)) return false;
      C.dips.push(C.yClose, this.Y[k]); C.yClose = C.yGone = Infinity;
      return true;
    };
    const end = (c: number, k: number) => endAt(c, this.Y[k]);
    const close = (q: number, k: number) => { end(open.get(q)!, k); open.delete(q); };
    for (let k = 0; k < n; k++) {
      const t = this.A[k], p = proj(k);
      while (this.A[tail] < t - WINDOW) {
        if (this.cols[this.colOf[tail]]?.p === OTHER) others--;
        const q = proj(tail++); count.set(q, count.get(q)! - 1); total--;
      }
      count.set(p, (count.get(p) ?? 0) + 1); total++;
      // a column whose project has gone quiet closes
      for (const q of [...open.keys()]) { const c = count.get(q) ?? 0; if (q !== p && (!c || c < total * SHARE_KEEP)) { close(q, k); rested.delete(q); } }
      // with a quiet stretch set (variants): a column with no message for that long rests, closing where the stretch
      // ran out, and keeps its place for when its project comes back
      const rest = (c: number) => endAt(c, Math.min(this.Y[k], lastY[c] + quiet));
      for (const [q, c] of [...open]) if (q !== p && this.Y[k] - lastY[c] > quiet) { rest(c); open.delete(q); rested.set(q, c); }
      let c = open.get(p);
      const mine = count.get(p)!;
      for (const q of [...rested.keys()]) if ((count.get(q) ?? 0) < total * SHARE_KEEP) rested.delete(q);
      if (c == null && (rested.has(p) || (mine >= MIN_OPEN && mine >= total * SHARE_OPEN))) {
        // full: the least worked-on gives way, if this one is clearly busier
        if (open.size >= TOP) {
          let weak = -1, least = Infinity;
          for (const q of open.keys()) { const x = count.get(q) ?? 0; if (x < least) { least = x; weak = q; } }
          if (mine > least * MARGIN) close(weak, k);
        }
        if (open.size < TOP) {
          // back in its place after a rest; or on the side with fewer open, so the oldest stay in the middle
          let l = 0; for (const cc of open.values()) if (this.cols[cc].key < 0) l++;
          const was = rested.get(p);
          rested.delete(p);
          if (was != null && revive(was, k)) c = was;
          else {
            const key = was != null ? this.cols[was].key : l < open.size - l ? --left : l > open.size - l ? ++right : (this.cols.length % 2 ? --left : ++right);
            c = this.cols.length;
            this.cols.push({ p, first: k, t0: t, key, floss: 0, lanes: 1, width: 0, y0: this.Y[k], yClose: Infinity, yGone: Infinity, dips: [] });
          }
          open.set(p, c);
        }
      }
      // anywhere else: the Other projects column at the right edge, open while the week has such messages
      if (c == null) {
        if (other < 0 && otherWas >= 0 && revive(otherWas, k)) other = otherWas;
        else if (other < 0) {
          other = this.cols.length;
          this.cols.push({ p: OTHER, first: k, t0: t, key: 1e6, floss: 0, lanes: 1, width: 0, y0: this.Y[k], yClose: Infinity, yGone: Infinity, dips: [] });
        }
        c = other; others++;
      } else if (other >= 0 && !others) { end(other, k); other = -1; }
      else if (other >= 0 && this.Y[k] - lastY[other] > quiet) { rest(other); otherWas = other; other = -1; }
      lastY[c] = this.Y[k];
      this.colOf[k] = c;
      if (c != null) { this.par[k] = (picks[c] = (picks[c] ?? -1) + 1) & 1; }
      // the shuttle's way: back from the edge it turned at, in from the side it was carried from, out to the near edge for a detour
      const pc = k ? this.colOf[k - 1] : -2;
      if (c == null) this.dir[k] = pc === -1 ? this.dir[k - 1] : pc >= 0 && this.cols[pc].key < 0 ? -1 : 1;
      else if (pc === c) this.dir[k] = -this.dir[k - 1];
      else if (pc === -1) this.dir[k] = this.dir[k - 1] < 0 ? 1 : -1;
      else this.dir[k] = pc < 0 || this.cols[pc].key < this.cols[c].key ? 1 : -1;
    }
    // a project keeps its colour when it comes back, unless an open column has it; Other projects has the last
    const lastFloss = new Map<number, number>(), F = FLOSS_DARK.length - 1;
    this.cols.forEach((C, c) => {
      if (C.p === OTHER) { C.floss = F; return; }
      const used = new Array(F).fill(0);
      for (let j = 0; j < c; j++) if (this.cols[j].yGone >= C.y0 && this.cols[j].p !== OTHER) used[this.cols[j].floss]++;
      const was = lastFloss.get(C.p);
      C.floss = was != null && !used[was] ? was : used.indexOf(Math.min(...used));
      lastFloss.set(C.p, C.floss);
    });
  }

  /** Sessions from the data's ids, or guessed from pauses; their places in the column; who is live at each pick. */
  protected buildSessions() {
    const m = this.mind, n = m.n, byKey = new Map<string, number>(), lastOfCol = new Map<number, number>();   // keyed by column and project, for Other projects
    const hand = this.handOver(), now = new Map<number, number>(), lastOfProj = new Map<number, number>();   // a session's thread now; a project's last guessed one
    const start = (k: number, c: number, from: number) => {
      const s = this.sess.length, S = this.newSession(k, c);
      if (from >= 0) { this.sess[from].tEnd = this.A[k]; S.from = from; }
      this.sess.push(S);
      return s;
    };
    for (let k = 0; k < n; k++) {
      const i = this.order[k], c = this.colOf[k];
      let s: number;
      if (c < 0) { this.sessOf[k] = -1; continue; }   // a detour: no session drawn
      if (hand) {
        // one thread per session on the loom at a time: when its messages move to another column, a new thread
        // takes over there and the old one leaves the loom
        const r = m.session && m.session[i] >= 0 ? m.session[i] : -1, was = r >= 0 ? now.get(r) : lastOfProj.get(m.project[i]);
        const goesOn = was != null && (r >= 0 || this.A[k] - this.sess[was].t1 <= SESSION_GAP);
        s = goesOn && this.sess[was!].col === c ? was! : start(k, c, goesOn ? was! : -1);
        if (r >= 0) now.set(r, s); else lastOfProj.set(m.project[i], s);
      } else if (m.session && m.session[i] >= 0) {
        const key = m.session[i] + ":" + c;
        s = byKey.get(key) ?? -1;
        if (s < 0) { s = this.sess.length; byKey.set(key, s); this.sess.push(this.newSession(k, c)); }
      } else {
        const prev = lastOfCol.get(c * 256 + m.project[i]);
        if (prev != null && this.A[k] - this.sess[prev].t1 <= SESSION_GAP) s = prev;
        else { s = this.sess.length; this.sess.push(this.newSession(k, c)); }
        lastOfCol.set(c * 256 + m.project[i], s);
      }
      const S = this.sess[s];
      S.last = k; S.t1 = this.A[k]; S.n++;
      this.sessOf[k] = s; this.nth[k] = S.n;
    }
    // places: each column's sessions take the free lane nearest its middle
    const free: number[][] = this.cols.map(() => []);   // per column: when each lane is free again
    const byStart = this.sess.map((_, s) => s).sort((a, b) => this.sess[a].t0 - this.sess[b].t0);
    for (const s of byStart) {
      const S = this.sess[s], f = free[S.col];
      let lane = f.findIndex(t => t < S.t0);
      if (lane < 0) lane = f.length;
      S.lane = lane; f[lane] = Math.min(S.tEnd, S.t1 + HOLD + FADE);
      S.y0 = this.Y[S.first]; S.y1 = this.Y[S.last];
      S.yHold = this.yAt(Math.min(S.tEnd, S.t1 + HOLD)); S.yGone = this.yAt(Math.min(S.tEnd, S.t1 + HOLD + FADE));
    }
    this.cols.forEach((C, c) => { C.lanes = Math.max(1, free[c].length); });
    // who is live at each pick, in its column: the weft passes through them
    const live: number[][] = this.cols.map(() => []);
    let next = 0;
    for (let k = 0; k < n; k++) {
      const t = this.A[k], c = this.colOf[k];
      while (next < byStart.length && this.sess[byStart[next]].t0 <= t) { const S = this.sess[byStart[next]]; live[S.col].push(byStart[next]); next++; }
      if (c < 0) { this.alive.push(new Int32Array(0)); this.aliveSess.push(new Int32Array(0)); continue; }
      live[c] = live[c].filter(s => this.sess[s].t1 + HOLD >= t && t < this.sess[s].tEnd);
      this.alive.push(Int32Array.from(new Set(live[c].map(s => this.sess[s].lane))).sort());
      this.aliveSess.push(Int32Array.from(live[c]));
    }
  }
  /** For variants: whether a session moving to another column hands its thread over, so it is never on the loom twice; not here. */
  protected handOver() { return false; }
  /** For variants: px of cloth with no message after which a column rests until its project comes back; never, here. */
  protected quiet() { return Infinity; }
  protected newSession(k: number, col: number): Session {
    return { col, first: k, last: k, n: 0, t0: this.A[k], t1: this.A[k], lane: 0, y0: 0, y1: 0, yHold: 0, yGone: 0, tEnd: Infinity, from: -1 };
  }
  /** Where a moment lies along the cloth: between two picks in proportion to the time, past the last at its end. */
  protected yAt(t: number) {
    const A = this.A, n = A.length;
    if (t >= A[n - 1]) return this.Y[n - 1] + Math.min(80, Math.sqrt(t - A[n - 1]) * 10);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (A[mid] <= t) lo = mid; else hi = mid; }
    const span = A[hi] - A[lo];
    return this.Y[lo] + (span > 0 ? ((t - A[lo]) / span) * (this.Y[hi] - this.Y[lo]) : 0);
  }

  wheel = (e: WheelEvent) => { e.preventDefault(); this.scroll(e.deltaY); };
  /** The wheel unrolls the cloth: the view goes back while the loom weaves on. */
  protected scroll(dy: number) { this.back = Math.max(0, Math.min(this.woven(), this.back - dy)); }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    const wide = w / h > 1.25, room = wide ? Math.min(w * 0.56, 1000) : w * 0.9;
    this.room = room;
    // each column as wide as the most sessions it had open at once, so they sit close; all of them fit
    const most = room / (TOP + 1) - GAP;
    for (const C of this.cols) C.width = Math.min(most, 2 * Math.ceil((C.lanes - 1) / 2) * SP + 2 * EDGE);
    this.centre = wide ? w * 0.6 : w / 2;
    this.fell = h * (wide ? 0.72 : 0.76);
  }

  // ---------- where things are ----------

  /** How open a column is at a point of the cloth: opening after the message that earned it, closing after the one that ended it. */
  protected weight(C: Column, Y: number) {
    if (Y < C.y0 || Y > C.yGone) return 0;
    let w = Y < C.y0 + OPEN ? smooth((Y - C.y0) / OPEN) : 1;
    for (let d = 0; d < C.dips.length && Y > C.dips[d]; d += 2) {
      // closing from where it rested, then opening again from as far as it got
      const a = C.dips[d], b = C.dips[d + 1], low = 1 - smooth((Math.min(Y, b) - a) / CLOSE);
      w *= Y < b ? low : low + (1 - low) * smooth((Y - b) / OPEN);
    }
    return Y > C.yClose ? w * (1 - smooth((Y - C.yClose) / CLOSE)) : w;
  }
  /** The columns in view, in their order across the loom. */
  protected see(lo: number, hi: number) {
    this.vis = [];
    this.cols.forEach((C, c) => { if (C.y0 <= hi && C.yGone >= lo) this.vis.push(c); });
    this.vis.sort((a, b) => this.cols[a].key - this.cols[b].key);
  }
  /** Where each column in view stands at a point of the cloth: side by side, as wide as it is open, centred. */
  protected place(Y: number) {
    let total = 0;
    for (const c of this.vis) { const w = this.weight(this.cols[c], Y); this.cw[c] = w; total += w; }
    let wide = 0;
    for (const c of this.vis) wide += this.cw[c] * (this.cols[c].width + GAP);
    let x = this.centre - wide / 2;
    for (const c of this.vis) { const w = this.cw[c] * (this.cols[c].width + GAP); this.cx[c] = x + w / 2; x += w; }
    return total;
  }
  /** The x of a lane, after place(): the middle first, then either side, closer when the column is crowded. */
  protected laneX(c: number, lane: number) {
    const sp = this.gap(c);
    const off = lane === 0 ? 0 : (lane % 2 ? 1 : -1) * Math.ceil(lane / 2);
    return this.cx[c] + off * sp * this.spread(c);
  }
  /** px between two of a column's lanes: SP, closer when the column is crowded. */
  protected gap(c: number) { const C = this.cols[c]; return Math.min(SP, (C.width - 2 * EDGE) / Math.max(1, 2 * Math.ceil((C.lanes - 1) / 2))); }
  /** How far a column's threads stand apart, after place(), from 0 (gathered in its middle) to 1: here, as open as it is. */
  protected spread(c: number) { return this.cw[c]; }
  /** A pick's ends, after place() at its point: across its column's live sessions. */
  protected span(k: number) {
    const c = this.colOf[k];
    if (c < 0) { const [l, r] = this.edges(); this.x0 = this.x1 = this.dir[k] < 0 ? l - LOOP : r + LOOP; return; }
    let x0 = this.laneX(c, this.sess[this.sessOf[k]].lane), x1 = x0;
    for (const l of this.alive[k]) { const x = this.laneX(c, l); if (x < x0) x0 = x; if (x > x1) x1 = x; }
    const pad = SP * 0.6 * Math.max(0.4, this.cw[c]);
    this.x0 = x0 - pad; this.x1 = x1 + pad;
  }
  protected entry(k: number) { return this.dir[k] > 0 ? this.x0 : this.x1; }
  protected exit(k: number) { return this.dir[k] > 0 ? this.x1 : this.x0; }
  /** Where pick k ends, placed at its own point. */
  protected exitAt(k: number) { this.place(this.Y[k]); this.span(k); return this.exit(k); }
  protected entryAt(k: number) { this.place(this.Y[k]); this.span(k); return this.entry(k); }
  /** The cloth's edges at a point, after place(). */
  protected edges() {
    let l = Infinity, r = -Infinity;
    for (const c of this.vis) if (this.cw[c] > 0.01) { const half = this.cw[c] * this.cols[c].width / 2; l = Math.min(l, this.cx[c] - half); r = Math.max(r, this.cx[c] + half); }
    return l < r ? [l, r] : [this.centre - 20, this.centre + 20];
  }

  // ---------- the weaving, in time ----------

  /** How long each step of pick k takes: rolling through a pause, carrying across, the pass, the beat, the reed back. */
  protected timing(k: number) {
    if (this.Tk === k) return this.T;
    const n = this.A.length, d = PASS + SLOW * Math.exp(-(n - 1 - k) / 14);
    const gap = k ? this.Y[k] - this.Y[k - 1] - PICK : 0, moved = k > 0 && this.colOf[k] !== this.colOf[k - 1];
    this.T = { rest: Math.max(0, gap) / ROLL, cross: moved ? d * 0.8 : 0, fly: d * 0.55, beat: d * 0.25, ret: d * 0.2 };
    this.Tk = k;
    return this.T;
  }
  protected stage(): [Stage, number] {
    if (this.cur >= this.A.length) return ["done", 1];
    const T = this.timing(this.cur);
    let e = this.e;
    for (const s of ["rest", "cross", "fly", "beat", "ret"] as const) {
      if (e < T[s]) return [s, e / T[s]];
      e -= T[s];
    }
    return ["ret", 1];
  }
  /** Seconds the weaving takes from pick `from` to the end, at its own pace. */
  weaveTime(from = 0) {
    let s = 0;
    for (let k = Math.max(0, from); k < this.A.length; k++) { const T = this.timing(k); s += T.rest + T.cross + T.fly + T.beat + T.ret; }
    return s;
  }
  protected advance(dt: number) {
    const n = this.A.length;
    while (dt > 0 && this.cur < n) {
      const T = this.timing(this.cur), total = T.rest + T.cross + T.fly + T.beat + T.ret, take = Math.min(dt, total - this.e);
      this.e += take; dt -= take;
      if (this.e >= total - 1e-9) { this.cur++; this.e = 0; }
    }
  }
  /** The cloth at the fell: the last pick beaten in, rolled on through a pause before the next. */
  protected woven() {
    const n = this.A.length, k = this.cur;
    if (!n) return 0;
    if (k >= n) return this.Y[n - 1];
    const [s, p] = this.stage(), base = k ? this.Y[k - 1] : this.Y[0] - PICK, to = Math.max(base, this.Y[k] - PICK);
    if (s === "rest") return base + (to - base) * ease(p);
    if (s === "ret") return to + (this.Y[k] - to) * ease(p);
    return to;
  }

  setShare(on: boolean) { this.share = on; }

  protected colours() {
    return {
      warp: FLOSS_DARK, silk: "#d8deec",
      shadow: "rgba(0,0,0,.55)", shine: "rgba(255,255,255,.5)",
      warm: ["#ffb85c", "#ff7a2e", "#ff3b24"],
      ground: this.theme.ground, muted: this.theme.muted,
    };
  }
  protected weftColour(i: number, C: ReturnType<Loom["colours"]>) {
    const h = this.mind.hour[i];
    if (h < 20) return C.silk;
    const k = Math.min(1, (h - 20) / 3);
    return k < 0.5 ? mix(C.warm[0], C.warm[1], k * 2) : mix(C.warm[1], C.warm[2], k * 2 - 1);
  }
  frame(t: number, dt: number) {
    this.t = t;
    const g = this.g, C = this.colours(), m = this.mind, n = m.n;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = C.ground; g.fillRect(0, 0, this.w, this.h);
    if (!n) return;
    if (!this.still && dt) this.advance(dt);
    const woven = this.woven(), now = woven - this.back, lo = now - this.fell - 40, off = this.fell - now;
    const sy = (Y: number) => Y + off;
    const [stage, sp] = this.back ? ["done", 1] as [Stage, number] : this.stage(), drawn = this.drawn(now);
    this.see(lo, now + 60);

    // the warp: a thread per session, from its knot to a day after its last message, then fading
    g.lineCap = "round"; g.lineJoin = "round";
    if (this.warp) this.sess.forEach((S, s) => {
      if (S.first >= drawn || S.yGone < lo) return;
      // a session cut short by its column closing ends there
      const stop = Math.min(now, this.cols[S.col].yGone);
      const col = C.warp[this.cols[S.col].floss], hov = s === this.hoverS, top = Math.max(S.y0, lo), end = Math.min(S.yGone, stop);
      const run = Math.min(S.y1, stop), held = Math.min(S.yHold, stop);
      if (run > top) { this.strand(S, top, run, off); g.strokeStyle = col; g.globalAlpha = 1; g.lineWidth = hov ? 2.6 : 1.8; g.stroke(); g.strokeStyle = C.shine; g.lineWidth = 0.6; g.globalAlpha = 0.7; g.stroke(); }
      if (held > Math.max(top, run)) { this.strand(S, Math.max(top, run), held, off); g.strokeStyle = col; g.globalAlpha = hov ? 0.8 : 0.42; g.lineWidth = 1.2; g.stroke(); }
      if (end > Math.max(top, held)) {
        const a = Math.max(top, held), grad = g.createLinearGradient(0, sy(S.yHold), 0, sy(S.yGone));
        grad.addColorStop(0, hexA(col, 0.42)); grad.addColorStop(1, hexA(col, 0));
        this.strand(S, a, end, off); g.globalAlpha = 1; g.strokeStyle = grad; g.lineWidth = 1.2; g.stroke();
      }
      // the knot where it began
      if (S.y0 >= lo) {
        this.place(S.y0); const x = this.laneX(S.col, S.lane), y = sy(S.y0);
        g.globalAlpha = 1; g.fillStyle = C.shadow; g.beginPath(); g.arc(x, y + 0.6, 3, 0, Math.PI * 2); g.fill();
        g.fillStyle = col; g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill();
      }
    });
    g.globalAlpha = 1;

    // the picks in view: across their column's live sessions, under and over them by turns, knotted on
    // their own, turning at the edge or carried across to the next; a detour loops off the edge
    const k0 = Math.max(0, lowerBound(this.Y, lo) - 1), floats: number[] = [];
    let px = 0, py = 0;
    g.lineCap = "round";
    for (let k = this.weft ? k0 : drawn; k < drawn; k++) {
      const i = this.order[k], c = this.colOf[k], Yk = this.Y[k], y = sy(Yk);
      this.place(Yk); this.span(k);
      const x0 = this.x0, x1 = this.x1, inX = this.entry(k), outX = this.exit(k), col = this.weftColour(i, C);
      if (k > k0) {
        const paused = this.A[k] - this.A[k - 1] > PAUSE;
        if (c < 0 && this.colOf[k - 1] < 0) {
          // detour after detour: along the edge from one loop to the next
          g.globalAlpha = paused ? 0.3 : 0.7; g.strokeStyle = col; g.lineWidth = 1; line(g, px, py, inX, y); g.globalAlpha = 1;
        } else if (this.colOf[k - 1] === c) {
          // the turn at the selvedge: out a little and back in, one pick further on
          const out = (this.dir[k] > 0 ? -1 : 1) * (2.4 + Math.min(4, (y - py) * 0.05));
          g.globalAlpha = paused ? 0.5 : 1;
          g.beginPath(); g.moveTo(px, py); g.bezierCurveTo(px + out, py, inX + out, y, inX, y);
          g.strokeStyle = C.shadow; g.lineWidth = (paused ? 1.2 : W) + 1.2; g.stroke();
          g.strokeStyle = col; g.lineWidth = paused ? 1.2 : W; g.stroke();
          g.globalAlpha = 1;
        } else floats.push(px, py, inX, y, paused ? 1 : 0, k);
      }
      if (c < 0) {
        // a detour: a loop of thread off the cloth, out and back
        const r = k === this.hoverK ? 3.6 : 2.6, cx = x0 + this.dir[k] * r;
        g.strokeStyle = C.shadow; g.lineWidth = 2.4; g.beginPath(); g.arc(cx, y + 0.5, r, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = col; g.lineWidth = 1.3; g.beginPath(); g.arc(cx, y, r, 0, Math.PI * 2); g.stroke();
        px = outX; py = y;
        continue;
      }
      const floss = C.warp[this.cols[c].floss];
      // the weft: its shadow, the thread, the light along it
      const hot = m.hour[i] >= 21, wide = k === this.hoverK ? W * 1.7 : W;
      if (hot) { g.globalAlpha = 0.3; g.strokeStyle = col; g.lineWidth = W * 3; line(g, x0, y, x1, y); g.globalAlpha = 1; }
      g.strokeStyle = C.shadow; g.lineWidth = wide + 1.4; line(g, x0, y + 0.6, x1, y + 0.6);
      g.strokeStyle = col; g.lineWidth = wide; line(g, x0, y, x1, y);
      g.strokeStyle = C.shine; g.lineWidth = 0.6; g.globalAlpha = 0.55; line(g, x0 + 1, y - wide * 0.22, x1 - 1, y - wide * 0.22); g.globalAlpha = 1;
      // the sessions it passes under lie over it, every other one, in its shadow's dip
      const own = this.sess[this.sessOf[k]].lane;
      if (this.crossings) this.alive[k].forEach((l, q) => {
        if (l === own || ((q + this.par[k]) & 1)) return;
        const x = this.laneX(c, l);
        g.fillStyle = C.shadow; g.fillRect(x - 2, y - wide / 2 - 0.9, 4, wide + 2.2);
        g.strokeStyle = floss; g.lineWidth = 1.8; line(g, x, y - wide / 2 - 0.7, x, y + wide / 2 + 0.7);
        g.strokeStyle = C.shine; g.lineWidth = 0.6; g.globalAlpha = 0.7; line(g, x - 0.3, y - wide / 2, x - 0.3, y + wide / 2); g.globalAlpha = 1;
      });
      // knotted on its own session
      if (this.knots) {
        const ox = this.laneX(c, own);
        g.fillStyle = C.shadow; g.beginPath(); g.arc(ox, y + 0.5, 2.1, 0, Math.PI * 2); g.fill();
        g.fillStyle = floss; g.beginPath(); g.arc(ox, y, 1.6, 0, Math.PI * 2); g.fill();
      }
      px = outX; py = y;
    }
    // the thread carried across from one project to the next, a fine float over everything between
    for (let f = 0; f < floats.length; f += 6) {
      const [ax, ay, bx, by, paused, k] = floats.slice(f, f + 6);
      g.beginPath(); g.moveTo(ax, ay); g.bezierCurveTo(ax + (bx - ax) * 0.4, ay, ax + (bx - ax) * 0.6, by, bx, by);
      g.globalAlpha = paused ? 0.14 : 0.34;
      g.strokeStyle = this.weftColour(this.order[k], C); g.lineWidth = paused ? 0.7 : 0.9; g.stroke();
    }
    g.globalAlpha = 1;
    this.overCloth(off, t);

    // the cloth rolls away at the top
    if (this.rollAway) {
      const fade = g.createLinearGradient(0, 0, 0, this.h * 0.3);
      fade.addColorStop(0, C.ground); fade.addColorStop(1, hexA(C.ground, 0));
      g.fillStyle = fade; g.fillRect(0, 0, this.w, this.h * 0.3);
    }

    this.drawLoom(C, stage, sp, now, sy, t, drawn);
  }
  /** How many picks are in the cloth at the fell: all woven so far, or those before the moment scrolled back to. */
  protected drawn(now: number) {
    const woven = this.cur + (this.stage()[0] === "ret" ? 1 : 0);
    return this.back ? Math.min(woven, lowerBound(this.Y, now + 0.01)) : woven;
  }

  /** A session's thread between two points of the cloth, bending where the columns move. */
  protected strand(S: Session, a: number, b: number, off: number) {
    const g = this.g, steps = Math.max(1, Math.ceil((b - a) / this.step(S)));
    g.beginPath();
    for (let q = 0; q <= steps; q++) {
      const Y = a + (b - a) * q / steps;
      this.place(Y);
      const x = this.laneX(S.col, S.lane) + this.sway(S, Y);
      q ? g.lineTo(x, Y + off) : g.moveTo(x, Y + off);
    }
  }

  // for variants: how finely a session's thread is drawn, how far it is moved off its line, what is drawn over the cloth
  protected step(_S: Session) { return 6; }
  protected sway(_S: Session, _Y: number) { return 0; }
  protected overCloth(_off: number, _t: number) {}
  /** Where the shuttle is while it flies through the shed for pick k, p of the way. */
  protected flyX(k: number, p: number) { const a = this.entryAt(k), b = this.exit(k), d = this.dir[k]; return lerp(a - d * BOX, b + d * BOX, ease(p)); }

  /** The back of the loom, the shed, the pick being laid, the shuttle and the reed. */
  protected drawLoom(C: ReturnType<Loom["colours"]>, stage: Stage, p: number, now: number, sy: (Y: number) => number, t: number, drawn: number) {
    const g = this.g, n = this.A.length, k = Math.min(this.cur, n - 1), fy = sy(now), shed = fy + SHED, rest = shed + 7;
    const done = stage === "done";
    // where the thread is: the end of the last pick in the cloth, and the pick being laid
    const last = drawn - 1;
    const ax = last >= 0 ? this.exitAt(last) : 0, ay = last >= 0 ? sy(this.Y[last]) : fy;
    const ldir = last >= 0 ? this.dir[last] : 1;
    let inX = 0, outX = 0, d = 1;
    if (!done) { inX = this.entryAt(k); outX = this.exit(k); d = this.dir[k]; }
    // the shuttle: waiting in its box past the last pick, carried across, through the shed, waiting past this one
    let sx = ax + ldir * BOX, laid = -1, py = shed;
    if (!done) {
      if (last < 0 && stage === "rest") sx = inX - d * BOX;
      if (stage === "cross") sx = lerp(ax + ldir * BOX, inX - d * BOX, ease(p));
      else if (stage === "fly") { sx = this.flyX(k, p); laid = sx; }
      else if (stage === "beat") { sx = outX + d * BOX; laid = outX; py = lerp(shed, sy(this.Y[k]), ease(p)); }
      else if (stage === "ret") sx = outX + d * BOX;
    }
    const reedY = stage === "beat" ? py + 3 : stage === "ret" ? lerp(sy(this.Y[k]) + 3, rest, ease(p)) : rest;

    // the warp on its way from the back of the loom, the shed open: every other thread raised over the shuttle's path
    this.place(now);
    const liveAt: [number, number, number][] = [];   // x, colour index, raised
    const pk = done ? drawn : this.cur, laying = stage === "cross" || stage === "fly" || stage === "beat";
    this.sess.forEach((S, s) => {
      if (S.yGone <= now || this.cols[S.col].yGone <= now || (S.first >= drawn && !(laying && S.first === pk))) return;
      liveAt.push([this.laneX(S.col, S.lane), s, (S.lane + pk) & 1]);
    });
    const warpDown = (raised: number) => {
      for (const [x, s, up] of liveAt) {
        if (up !== raised) continue;
        const S = this.sess[s], col = C.warp[this.cols[S.col].floss];
        const a = S.yHold > now ? (S.y1 >= now - PICK * 2 ? 0.85 : 0.42) : 0.42 * Math.max(0, (S.yGone - now) / Math.max(1, S.yGone - S.yHold));
        g.globalAlpha = a * (raised ? 1 : 0.6); g.strokeStyle = col; g.lineWidth = raised ? 1.4 : 1.1;
        const sway = this.still ? 0 : Math.sin(t * 0.9 + x * 0.05) * 0.6, bx = this.centre + (x - this.centre) * 0.55;
        g.beginPath(); g.moveTo(x, fy); g.quadraticCurveTo(x + sway, (fy + this.h) / 2, bx, this.h); g.stroke();
      }
      g.globalAlpha = 1;
    };
    if (this.warp) warpDown(0);
    // the weft in the shed: from the cloth's edge to the pick being laid, and on to the shuttle
    if (n && this.weft) {
      const col = this.weftColour(this.order[done ? Math.max(0, last) : k], C);
      g.beginPath(); g.moveTo(ax, ay);
      if (laid >= 0) { g.lineTo(inX, py); g.lineTo(laid, py); }
      g.lineTo(sx, shed);
      g.strokeStyle = C.shadow; g.lineWidth = W + 1; g.stroke();
      g.strokeStyle = col; g.lineWidth = laid >= 0 && stage === "beat" ? W : 1.3; g.stroke();
    }
    if (this.warp) warpDown(1);

    const [l, r] = this.edges();
    this.drawReed(C, l, r, reedY, fy);
    this.drawShuttle(C, sx, shed, done ? Math.max(0, last) : k, stage, t);
  }
  /** The reed, a comb across the open columns. */
  protected drawReed(_C: ReturnType<Loom["colours"]>, l: number, r: number, reedY: number, _fy: number) {
    const g = this.g;
    g.strokeStyle = "rgba(205,214,234,.5)"; g.lineWidth = 1.4;
    line(g, l - 22, reedY - 3, r + 22, reedY - 3); line(g, l - 22, reedY + 3, r + 22, reedY + 3);
    g.lineWidth = 0.6; g.globalAlpha = 0.5; g.beginPath();
    for (let x = l - 20; x <= r + 20; x += 3) { g.moveTo(x, reedY - 3); g.lineTo(x, reedY + 3); }
    g.stroke(); g.globalAlpha = 1;
  }
  /** The shuttle, at sx on the shed's line, carrying pick k: a boat of wood with the bobbin of thread in it. */
  protected drawShuttle(C: ReturnType<Loom["colours"]>, sx: number, sY: number, k: number, _stage: Stage, _t: number) {
    const g = this.g, L = 44;
    const wood = g.createLinearGradient(0, sY - 6, 0, sY + 6);
    wood.addColorStop(0, "#e2c08a"); wood.addColorStop(1, "#8a6634");
    g.fillStyle = C.shadow; g.beginPath(); boat(g, sx, sY + 2, L); g.fill();
    g.fillStyle = wood; g.beginPath(); boat(g, sx, sY, L); g.fill();
    g.fillStyle = this.weftColour(this.order[k], C);
    g.beginPath(); g.roundRect(sx - 9, sY - 2, 18, 4, 2); g.fill();
  }

  // ---------- pointing ----------

  protected pickAt(x: number, y: number) {
    const now = this.woven() - this.back, Y = now - (this.fell - y), k = lowerBound(this.Y, Y - PICK / 2);
    const drawn = this.drawn(now);
    if (k >= drawn || k >= this.Y.length || Math.abs(this.Y[k] - Y) > PICK / 2 + 0.6) return -1;
    this.place(this.Y[k]); this.span(k);
    const reach = this.colOf[k] < 0 ? 8 : 6, mid = this.colOf[k] < 0 ? this.dir[k] * 2.6 : 0;
    return x >= this.x0 + mid - reach && x <= this.x1 + mid + reach ? k : -1;
  }
  protected threadAt(x: number, y: number) {
    const now = this.woven() - this.back, Y = now - (this.fell - y);
    if (Y > now) return -1;
    this.place(Y);
    let best = -1, bd = 3.5;
    this.sess.forEach((S, s) => {
      if (Y < S.y0 - 3 || Y > Math.min(S.yGone, this.cols[S.col].yGone) || !this.vis.includes(S.col)) return;
      const d = Math.abs(this.laneX(S.col, S.lane) - x);
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }
  select(x: number, y: number) { const k = this.pickAt(x, y); return k >= 0 ? this.mind.days[this.mind.day[this.order[k]]] : null; }

  hover(x: number, y: number) {
    const m = this.mind, k = this.pickAt(x, y);
    this.hoverK = k; this.hoverS = -1;
    if (k >= 0) {
      const i = this.order[k];
      if (this.colOf[k] < 0) return messageTip(m, i, "a detour, outside the week's main projects");
      const S = this.sess[this.sessOf[k]];
      const sw = k && this.colOf[k - 1] !== this.colOf[k] && this.A[k] - this.A[k - 1] <= PAUSE;
      this.hoverS = this.sessOf[k];
      return messageTip(m, i, `message ${this.nth[k]} of ${S.n} in a session from ${fmtHour(m.hour[this.order[S.first]])}${sw ? ", a switch" : ""}`);
    }
    const s = this.threadAt(x, y);
    this.hoverS = s;
    if (s < 0) return null;
    const S = this.sess[s], a = this.order[S.first], z = this.order[S.last], det = m.detail(a);
    const span = m.day[a] === m.day[z] ? `${fmtDay(m.days[m.day[a]])}, ${fmtHour(m.hour[a])} to ${fmtHour(m.hour[z])}` : `${fmtDay(m.days[m.day[a]])} ${fmtHour(m.hour[a])} to ${fmtDay(m.days[m.day[z]])} ${fmtHour(m.hour[z])}`;
    return `<b>A session${det ? ` in ${esc(det.project)}` : ""}</b><div class=m>${S.n} message${S.n > 1 ? "s" : ""}, ${span}${this.inferred ? " (guessed from pauses)" : ""}</div>`;
  }

  caption() {
    const m = this.mind;
    return {
      line: `Your attention as one thread: ${roundN(m.n)} messages since ${fmtMonth(m.days[0])}, woven in the order you sent them.`,
      sub: `Up to ${TOP} projects you worked on most over the past week each have a column, and the rest are woven together under Other projects; each thread in a column is a session, fading a day after its last message. ${roundN(this.sess.length)} sessions, ${roundN(this.switches)} switches; pauses leave bare warp.${this.scrolls ? " Scroll to unroll the weeks before." : ""}`,
    };
  }

  labels() {
    const out: { x: number; y: number; text: string; align?: "left" | "center" | "right"; alpha?: number }[] = [];
    const m = this.mind, n = m.n;
    if (!n) return out;
    const now = this.woven() - this.back, lo = now - this.fell, drawn = this.drawn(now);
    // the first pick of each day, at the cloth's left edge
    for (let k = Math.max(0, lowerBound(this.Y, lo)); k < drawn && this.Y[k] <= now; k++) {
      if (k && m.day[this.order[k]] === m.day[this.order[k - 1]]) continue;
      const y = this.fell - (now - this.Y[k]);
      if (y < this.h * 0.18) continue;
      this.place(this.Y[k]);
      out.push({ x: this.edges()[0] - 14, y, text: `${fmtDay(m.days[m.day[this.order[k]]])}, ${fmtHour(m.hour[this.order[k]])}`, align: "right" });
    }
    // each open column's project under the loom, or only a number in share mode; a closing one fades
    this.place(now);
    const ends = [-Infinity, -Infinity, -Infinity];   // where each row's last name ends, to set the next one lower if they'd touch
    for (const c of this.vis) {
      const w = this.cw[c];
      if (w < 0.05) continue;
      const text = this.columnName(c), half = text.length * 3.3 + 6;
      let row = ends.findIndex(e => e < this.cx[c] - half);
      if (row < 0) row = ends.indexOf(Math.min(...ends));
      ends[row] = this.cx[c] + half;
      out.push({ x: this.cx[c], y: this.fell + SHED + 40 + row * 15, text, alpha: Math.min(1, w * 1.4) });
    }
    return out;
  }

  /** A column's name: its project's, or Other projects. */
  protected columnName(c: number) {
    if (this.cols[c].p === OTHER) return "Other projects";
    const C = this.cols[c], name = this.mind.name ? this.mind.name(C.p) : this.mind.detail(this.order[C.first])?.project;
    return name || `Project ${C.p + 1}`;
  }

  dispose() { this.canvas.removeEventListener("wheel", this.wheel); }
}

export function lowerBound(a: Float32Array, v: number) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; } return lo; }
function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
function boat(g: CanvasRenderingContext2D, x: number, y: number, L: number) {
  g.moveTo(x - L / 2, y); g.bezierCurveTo(x - L / 4, y - 6, x + L / 4, y - 6, x + L / 2, y); g.bezierCurveTo(x + L / 4, y + 6, x - L / 4, y + 6, x - L / 2, y);
}
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function mix(a: string, b: string, k: number) { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(255 * (v + (B[i] - v) * k))).join(",")})`; }
function hexA(c: string, a: number) { const [r, g, b] = hex(c); return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`; }
