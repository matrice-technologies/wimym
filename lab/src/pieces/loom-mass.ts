// The mass behind the strummed loom: the weight of attention the projects carry, drawn as an aurora far behind the
// harp, the light the sparks leave in the sky. Three speeds, each heavier than the last: a message is a spark, a
// session a string that rings, and the aurora gathers the sessions over days. It mirrors the loom: each project has
// a stretch of sky in the same order as the loom's columns, Other projects at the right, and together they span the
// whole width, each as wide as the weight it carries; when the weights shift, the stretches slide aside, slowly, as
// heavy things do. Weight settles over days and sinks back, so each project hangs as three curtains, near, middle
// and far (fresh, a day or so, days old), the far ones dimmer and greyer, and slower to follow: they show the sky as
// it was. A struck string flares its project's near curtain. And the whole sky turns, right to left, the curtains
// going out at the left and coming back in at the right, keeping their order: turned by a current that fresh weight
// pushes like a flywheel, faster while the work goes on, coasting after, the far depths turning slower. The painting is in
// loom-mass-paint.ts, in a worker: a picture ten times a second, each fading into the next.
import type { Mind } from "../shared/data";
import { hex } from "../shared/palette";
import { CELL, CURTAIN, DEPTHS, FLARE, oklab, paintField, PROJECT, type Job, type Picture } from "./loom-mass-paint";

const KEEP = 24 * 9;          // hours of sessions the aurora holds, at most
const SETTLE = 60;            // hours for a session's weight to fall to a third, after its last message
const DEEP = 30;              // hours for it to sink back into the far, to a third of the way left
const SINK = 1.5;             // seconds what is shown of a session's depth takes to follow it, to a third: never a jump
const GROW = 0.6;             // seconds what is shown of its weight takes to follow it, to a third
const GULP = 1;               // a message's flare of its project's near curtain
const RISE = 0.25, GULPED = 1.3;   // seconds a flare takes to rise, and to settle, to a third
const WIDE = 0.6;             // a stretch is as wide as its weight to this power: the small still show, the big don't swallow the sky
const OVERLAP = 1.15;         // how far a curtain reaches past its stretch, into its neighbours'
const FOLLOW = [0.7, 0.25, 0.09];   // per second squared, near to far: how hard a stretch is drawn to its place; the far, heavier, lag
const U_MIN = 1.4, U_MAX = 15;   // px a second the current runs, near: at rest, and at full momentum
const E0 = 260;               // messages of fresh weight that give it two thirds of its full speed
const SPIN = 7;               // seconds the current takes to follow its momentum, to a third: a heavy flywheel
const FAR_SPEED = 0.62;       // how much slower the far turns than the near: the parallax
const REFRESH = 10;           // pictures a second
const FIRST = 1.4;            // seconds the first picture takes to come out of the dark
const OTHER = 1e6;            // the order of projects that never had a column: at the right, as in the loom

/** What the aurora reads from the loom in front of it. */
export interface Front {
  mind: Mind; order: number[]; A: Float64Array; cur: number; sessOf: Int32Array; onLoom: number[]; cols: { p: number; key: number }[];
  w: number; h: number; dpr: number; fell: number; t: number;
}
/** What only the loom can say: where a string crosses the fell now, and the colour of the light a message sent on it. */
export interface Strings { x(s: number): number; light(s: number, i: number): string }

/** A session's string in the aurora: the weight its messages carry. w and z: its weight and depth now; e and zs: what
 * is shown of them, following; kick and gulp: a flare to come, and the flare. */
interface Sess { s: number; p: number; i: number; n: number; t1: number; ca: number; cb: number; w: number; e: number; z: number; zs: number; kick: number; gulp: number }
/** A project's stretch of sky at one depth: its middle and half width, how fast each is moving, and its weight. */
interface Stretch { x: number; v: number; hw: number; hv: number; weight: number }
interface Shown { cv: HTMLCanvasElement; pic: Picture }

export class Mass {
  private sess = new Map<number, Sess>();   // per string
  private stretches = new Map<string, Stretch>();   // per project and depth, "p:d"
  private seen = 0;             // picks taken in so far
  private u = U_MIN;            // px a second the current runs now, near
  private roll = new Float64Array(DEPTHS.length);   // px each depth has turned, right to left
  private then = -1; private since = 0; private asked = -Infinity;
  private inks = new Map<string, [number, number, number]>();
  private flares: { p: number; x: number; k: number }[] = [];
  // the pictures: the one fading out and the one fading in, since it came
  private worker: Worker | null = null; private busy = false;
  private before: Shown | null = null; private latest: Shown | null = null; private came = -Infinity;
  private strings: Strings;

  /** worker: false paints every picture at once, on the caller's time: for a still made by running the loom on
   * (the postcard), where a worker's pictures would come too late. */
  constructor(strings: Strings, worker = true) {
    this.strings = strings;
    if (worker) try {
      this.worker = new Worker(new URL("./loom-mass-paint.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<Picture>) => { this.busy = false; this.show(e.data); };
    } catch { this.worker = null; }
  }
  dispose() { this.worker?.terminate(); }

  /** Lay the aurora behind the loom: weighed, its stretches moved and a picture asked for now and then, the last two
   * faded one into the other. fade: how far the whole sky has come out of the dark, 0 to 1. */
  draw(g: CanvasRenderingContext2D, L: Front, still: boolean, fade = 1) {
    const dt = this.then < 0 || L.t < this.then ? 0 : Math.min(0.25, L.t - this.then);
    this.then = L.t; this.since += dt;
    if (L.t - this.asked >= 1 / REFRESH || L.t < this.asked || !this.latest) {
      if (!this.busy || still) { this.step(L, still ? 0 : this.since); this.since = 0; this.asked = L.t; this.ask(L, still); }
    }
    const k = still ? 1 : Math.min(1, (L.t - this.came) * (this.before ? REFRESH : 1 / FIRST));
    g.save();
    g.globalCompositeOperation = "screen";
    // smoothed plainly: the sky is soft enough that "high" changes it by at most 3 levels in 255, and it costs about
    // 9 ms of the GPU's time for each of the two pictures, every frame
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "low";
    for (const [s, a] of [[this.before, 1 - k], [this.latest, k]] as const) {
      if (!s || a <= 0) continue;
      g.globalAlpha = a * fade;
      g.drawImage(s.cv, 0, 0, s.pic.gw, s.pic.gh, 0, s.pic.y0, s.pic.gw * CELL, s.pic.gh * CELL);
    }
    g.restore();
  }
  /** A picture came: it fades in over the one before. */
  private show(pic: Picture) {
    const cv = this.before?.cv ?? document.createElement("canvas");
    if (cv.width !== pic.gw || cv.height !== pic.gh) { cv.width = pic.gw; cv.height = pic.gh; }
    cv.getContext("2d")!.putImageData(new ImageData(pic.px as Uint8ClampedArray<ArrayBuffer>, pic.gw, pic.gh), 0, 0);
    this.before = this.latest; this.latest = { cv, pic }; this.came = this.then;
  }

  // ---------- the weighing ----------

  private now(L: Front) { const n = L.A.length; return n ? L.A[Math.max(0, Math.min(L.cur, n) - 1)] : 0; }
  private band(L: Front) {
    const wide = L.w / L.h > 1.25, top = wide ? L.h * 0.1 : 104, bottom = L.fell - 30;
    return { top, bottom, mid: top + (bottom - top) * 0.56, tall: bottom - top };
  }
  /** How far above or below the band's middle a project hangs: a place of its own, the same every time. */
  private hang(L: Front, p: number) { return (((p * 0.618034 + 0.31) % 1) - 0.5) * this.band(L).tall * 0.22; }

  /** Take in the messages woven since last time; after the wheel, start again from the moment scrolled to. */
  private take(L: Front) {
    const n = Math.min(L.cur, L.A.length);
    let fresh = false;
    if (n < this.seen || n - this.seen > 600) {
      this.sess.clear(); this.stretches.clear(); fresh = true;
      const T0 = n ? L.A[n - 1] - KEEP : 0;
      let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (L.A[mid] < T0) lo = mid + 1; else hi = mid; }
      this.seen = lo;
    }
    for (; this.seen < n; this.seen++) this.add(L, this.seen, fresh);
    return fresh;
  }
  private add(L: Front, k: number, quiet: boolean) {
    const s = L.sessOf[k];
    if (s < 0) return;
    const i = L.order[k];
    let S = this.sess.get(s);
    if (!S) { S = { s, p: L.mind.project[i], i, n: 0, t1: 0, ca: 0, cb: 0, w: 0, e: 0, z: 0, zs: 0, kick: 0, gulp: 0 }; this.sess.set(s, S); }
    // its colour, as a direction on the colour wheel (OKLab's a and b), so that colours average to a hue, not to grey
    const [, oa, ob] = this.ink(this.strings.light(s, i));
    S.n++; S.t1 = L.A[k]; S.ca += oa; S.cb += ob;
    if (!quiet) S.kick += GULP;
  }
  private ink(c: string) {
    let v = this.inks.get(c);
    if (!v) { v = oklab(hex(c)); this.inks.set(c, v); }
    return v;
  }

  /** How fast depth d turns with the current, as the near does. */
  private speed(d: number) { return 1 - (1 - FAR_SPEED) * d / (DEPTHS.length - 1); }

  private step(L: Front, dt: number) {
    const snap = this.take(L), T = this.now(L);
    // each session's weight and depth now; what is shown of them follows, even when the weave rolls through a night
    const grow = dt && !snap ? 1 - Math.exp(-dt / GROW) : 1, sink = dt && !snap ? 1 - Math.exp(-dt / SINK) : 1;
    const rise = dt ? 1 - Math.exp(-dt / RISE) : 1, gulped = Math.exp(-dt / GULPED);
    let fresh = 0;
    for (const [s, S] of this.sess) {
      const age = Math.max(0, T - S.t1);
      S.w = age < KEEP ? S.n * Math.exp(-age / SETTLE) : 0;
      S.z = 1 - Math.exp(-age / DEEP);
      S.e += (S.w - S.e) * grow; S.zs += (S.z - S.zs) * sink;
      const up = S.kick * rise; S.kick -= up; S.gulp = (S.gulp + up) * gulped;
      fresh += S.w * (1 - S.z);
      if (S.w < 0.05 && S.e < 0.05) this.sess.delete(s);
    }
    // the flywheel follows its momentum slowly, and the sky turns with it
    const want = U_MIN + (U_MAX - U_MIN) * (1 - Math.exp(-fresh / E0));
    this.u = snap ? want : this.u + (want - this.u) * (1 - Math.exp(-dt / SPIN));
    this.roll.forEach((x, d) => { this.roll[d] = (x - this.u * this.speed(d) * dt) % (L.w * 1000); });
    this.lay(L, dt, snap);
  }

  /** Each project's stretch of sky at each depth: in the loom's order across the whole width, as wide as its weight
   * there; each drawn to its place like a weight on a spring, without overshooting, the far ones more slowly. */
  private lay(L: Front, dt: number, snap: boolean) {
    const D = DEPTHS.length, order = new Map<number, number>();
    for (const C of L.cols) if (C.p >= 0) order.set(C.p, C.key);   // the column it has, or had last
    const weight = new Map<number, number[]>();
    for (const S of this.sess.values()) {
      const z = S.zs, part = [(1 - z) * (1 - z), 2 * z * (1 - z), z * z], W = weight.get(S.p) ?? new Array(D).fill(0);
      for (let d = 0; d < D; d++) W[d] += S.e * part[d];
      weight.set(S.p, W);
    }
    const ps = [...weight.keys()].sort((a, b) => (order.get(a) ?? OTHER + a) - (order.get(b) ?? OTHER + b));
    for (let d = 0; d < D; d++) {
      const size = ps.map(p => Math.pow(weight.get(p)![d], WIDE)), total = size.reduce((a, b) => a + b, 0);
      const k = total > 0 ? L.w / total : 0, K = FOLLOW[d], damp = 2 * Math.sqrt(K);
      let at = 0;
      ps.forEach((p, q) => {
        const x = at + size[q] * k / 2, hw = size[q] * k / 2 * OVERLAP;
        at += size[q] * k;
        const key = `${p}:${d}`;
        let st = this.stretches.get(key);
        // a project coming into the sky opens from nothing at its place
        if (!st) { st = { x, v: 0, hw: 0, hv: 0, weight: 0 }; this.stretches.set(key, st); }
        st.weight = weight.get(p)![d];
        if (snap || !dt) { st.x = x; st.hw = hw; st.v = st.hv = 0; return; }
        for (let left = dt; left > 1e-4; left -= 1 / 30) {
          const h = Math.min(1 / 30, left);
          st.v += (K * (x - st.x) - damp * st.v) * h; st.x += st.v * h;
          st.hv += (K * (hw - st.hw) - damp * st.hv) * h; st.hw += st.hv * h;
        }
      });
    }
    for (const key of [...this.stretches.keys()]) if (!weight.has(+key.split(":")[0])) this.stretches.delete(key);
    // where struck strings flare: where the string stands across the loom, carried over to the whole width, and kept
    // within its project's near stretch
    const xs = L.onLoom.map(s => this.strings.x(s)), lo = Math.min(...xs) - 20, hi = Math.max(...xs) + 20;
    this.flares = [];
    for (const S of this.sess.values()) {
      const st = this.stretches.get(`${S.p}:0`);
      if (S.gulp < 0.02 || !st) continue;
      const on = L.onLoom.includes(S.s), x = on && hi > lo ? (this.strings.x(S.s) - lo) / (hi - lo) * L.w : st.x;
      this.flares.push({ p: S.p, x: Math.max(st.x - 0.8 * st.hw, Math.min(st.x + 0.8 * st.hw, x)), k: S.gulp });
    }
  }

  // ---------- the picture ----------

  /** Where a place in the sky's layout is on screen, now the sky at depth d has turned. */
  private turned(L: Front, x: number, d: number) { const W = L.w; return (((x + this.roll[d]) % W) + W) % W; }

  /** Ask for a picture of the sky as it is: from the worker, or at once for a still. */
  private ask(L: Front, still: boolean) {
    const b = this.band(L), y0 = Math.max(0, Math.floor(b.top - 50)), y1 = L.fell - 6;
    const gw = Math.ceil(L.w / CELL) + 1, gh = Math.max(1, Math.ceil((y1 - y0) / CELL));
    // a slot for each project, with the mean of its messages' colours, each counting by the weight it still carries
    const slot = new Map<number, number>(), sums: number[][] = [];
    for (const S of this.sess.values()) {
      if (S.e < 0.05) continue;
      let q = slot.get(S.p);
      if (q == null) { q = sums.length; slot.set(S.p, q); sums.push([S.p, 0, 0, 0]); }
      const k = S.e / S.n, U = sums[q];
      U[1] += S.ca * k; U[2] += S.cb * k; U[3] += S.e;
    }
    const projects = new Float32Array(sums.length * PROJECT);
    sums.forEach(([p, a, bb, w], q) => projects.set([p, a / w, bb / w], q * PROJECT));
    // the far curtains first
    const list = [...this.stretches].filter(([key]) => slot.has(+key.split(":")[0])).sort(([a], [b]) => +b.split(":")[1] - +a.split(":")[1]);
    const curtains = new Float32Array(list.length * CURTAIN);
    list.forEach(([key, st], n) => {
      const [p, d] = key.split(":").map(Number);
      curtains.set([slot.get(p)!, d, this.turned(L, st.x, d), st.hw, st.weight, this.hang(L, p)], n * CURTAIN);
    });
    const fl = this.flares.filter(f => slot.has(f.p)), flares = new Float32Array(fl.length * FLARE);
    fl.forEach((f, n) => flares.set([slot.get(f.p)!, this.turned(L, f.x, 0), f.k], n * FLARE));
    const job: Job = { gw, gh, y0, mid: b.mid, tall: b.tall, t: L.t, W: L.w, curtains, flares, projects };
    if (still || !this.worker) { this.show(paintField(job)); this.came = -Infinity; return; }
    this.busy = true;
    this.worker.postMessage(job);
  }
}
