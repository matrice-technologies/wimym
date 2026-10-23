// Organism: one week as a living thing, moved by its vital signs read against your own range.
// It breathes with your hours, faster when you were at it longer than usual. Its skin frays with
// strain and short nights. It breaks into pieces when your attention did: one lobe for each
// session at once, drifting further out the more you switched. A calm week is one round, slow form.
import * as THREE from "three";
import type { Mind } from "../shared/data";
import { hex, type Theme } from "../shared/palette";
import { fmtDay, type Piece, type PieceFactory } from "../shared/piece";
import { loadSigns, type WeekSigns } from "../shared/vitals";

export const MAXB = 10;

export const FORM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec2 uRes; uniform float uShift; uniform float uTime, uBreath, uCore, uK, uNoise, uFlow, uWarm, uN;
  uniform vec3 uB[${MAXB}]; uniform float uR[${MAXB}];
  uniform vec3 uCool, uMid, uHot, uGround, uDeep;
  vec3 toneOf(float w) { return w < 0.5 ? mix(uCool, uMid, w * 2.0) : mix(uMid, uHot, w * 2.0 - 1.0); }
  varying vec2 vUv;

  // gradient noise, after Inigo Quilez
  vec3 h3(vec3 p) { p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(h3(i), f), dot(h3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(h3(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(h3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(h3(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(h3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(h3(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(h3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }
  float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }

  float field(vec3 p) {
    float d = length(p) - uCore * uBreath;
    for (int i = 0; i < ${MAXB}; i++) {
      if (float(i) >= uN) break;
      d = smin(d, length(p - uB[i]) - uR[i] * uBreath, uK);
    }
    float n = noise(p * 2.3 + vec3(0.0, uTime * uFlow, uTime * 0.13)) + 0.5 * noise(p * 5.1 - vec3(uTime * uFlow * 1.7));
    return d + n * uNoise;
  }
  vec3 normalAt(vec3 p) {
    vec2 e = vec2(0.002, -0.002);
    return normalize(e.xyy * field(p + e.xyy) + e.yyx * field(p + e.yyx) + e.yxy * field(p + e.yxy) + e.xxx * field(p + e.xxx));
  }

  void main() {
    vec2 uv = (vUv - 0.5 - vec2(uShift, 0.0)) * vec2(uRes.x / uRes.y, 1.0);
    vec3 ro = vec3(0.0, 0.0, 4.2), rd = normalize(vec3(uv, -1.15));
    // the ground: a soft glow behind the form
    float vig = length(uv);
    vec3 col = mix(uGround, uDeep, smoothstep(0.1, 0.95, vig));
    col += 0.06 * toneOf(uWarm) * exp(-vig * vig * 4.0);
    // march, inside a bounding sphere
    float b = dot(ro, rd), c = dot(ro, ro) - 2.6 * 2.6, disc = b * b - c;
    float t = 0.0, hit = 0.0, glow = 0.0;
    if (disc > 0.0) {
      t = max(0.0, -b - sqrt(disc));
      for (int i = 0; i < 90; i++) {
        vec3 p = ro + rd * t;
        float d = field(p);
        glow += exp(-max(d, 0.0) * 9.0) * 0.012;
        if (d < 0.0015) { hit = 1.0; break; }
        t += d * 0.7;
        if (t > 8.0) break;
      }
    }
    vec3 tone = toneOf(uWarm);
    if (hit > 0.5) {
      vec3 p = ro + rd * t, n = normalAt(p), v = -rd;
      vec3 l = normalize(vec3(0.6, 0.8, 0.5));
      float diff = max(dot(n, l), 0.0), fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
      float spec = pow(max(dot(reflect(-l, n), v), 0.0), 40.0);
      // light through the skin: thin parts glow
      float thick = clamp(field(p - n * 0.25) / -0.25, 0.0, 1.0);
      vec3 irid = 0.5 + 0.5 * cos(6.2831 * (fres * 0.6 + vec3(0.0, 0.33, 0.67) + uTime * 0.02));
      vec3 body = tone * (0.16 + 0.42 * diff) + tone * (1.0 - thick) * 0.7;
      col = body + mix(tone, irid, 0.35) * fres * 1.1 + spec * 0.5;
    } else {
      col += tone * glow;
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export const organism: PieceFactory = (canvas, mind, theme, opts) => new Organism(canvas, mind, theme, opts.share, opts.still);

interface Params { breath: number; core: number; k: number; noise: number; flow: number; spread: number; lobes: number; warm: number }

class Organism implements Piece {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  u = {
    uRes: { value: new THREE.Vector2(1, 1) }, uShift: { value: 0 }, uTime: { value: 0 }, uBreath: { value: 1 }, uCore: { value: 0.8 }, uK: { value: 0.6 },
    uNoise: { value: 0.03 }, uFlow: { value: 0.2 }, uWarm: { value: 0 }, uN: { value: 0 },
    uB: { value: Array.from({ length: MAXB }, () => new THREE.Vector3()) }, uR: { value: new Array(MAXB).fill(0.3) },
    uCool: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color() },
  };
  signs: WeekSigns[] = [];
  week = -1;                      // the week shown
  p: Params = { breath: 0.12, core: 0.8, k: 0.7, noise: 0.03, flow: 0.15, spread: 0.2, lobes: 3, warm: 0 };
  target: Params = { ...this.p };
  phase = 0; w = 1; h = 1; theme: Theme;
  tour = true;                    // walk through the weeks once, then rest on the last full one
  tourT = 0;

  readonly canvas: HTMLCanvasElement; readonly mind: Mind; share: boolean; readonly still: boolean;

  constructor(canvas: HTMLCanvasElement, mind: Mind, theme: Theme, share: boolean, still: boolean) {
    this.canvas = canvas; this.mind = mind; this.share = share; this.still = still;
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: FORM_FRAG, uniforms: this.u,
    }));
    this.scene.add(quad);
    this.colour(theme);
    loadSigns(mind).then(s => {
      this.signs = s;
      this.tour = !still;
      this.show(still ? this.lastFull() : 0);
      if (still) this.p = { ...this.target };
    });
    addEventListener("keydown", this.onKey);
  }

  onKey = (e: KeyboardEvent) => {
    if (!this.signs.length) return;
    if (e.key === "ArrowLeft") { this.tour = false; this.show(Math.max(0, this.week - 1)); }
    if (e.key === "ArrowRight") { this.tour = false; this.show(Math.min(this.signs.length - 1, this.week + 1)); }
  };

  lastFull() { return Math.max(0, this.signs.length - 2); }

  /** Read a week's signs into the form's parameters. */
  show(w: number) {
    this.week = w;
    const s = this.signs[w];
    const st = (x: number) => Math.max(0, x);
    const load = s.load.value == null || s.load.mid == null ? 0 : (s.load.value - s.load.mid) / Math.max(1, s.load.hi! - s.load.lo!);
    const fray = st(s.strain.stress) * 0.6 + st(s.night.stress) * 0.8;
    const scatter = st(s.switches.stress) + st(s.peak.stress) * 0.5;
    const lobes = Math.max(1, Math.min(MAXB, Math.round(s.peak.value ?? 3)));
    const depth = s.stretch.value == null ? 0.8 : Math.min(1.2, Math.max(0.3, s.stretch.value));
    this.target = {
      breath: 0.1 + Math.max(-0.04, Math.min(0.14, load * 0.06)),         // breaths a second
      core: 0.5 + depth * 0.3,
      k: Math.max(0.12, 0.75 - scatter * 0.3),                            // how readily lobes merge
      noise: 0.02 + Math.min(0.2, fray * 0.08),
      flow: 0.12 + Math.min(0.7, fray * 0.25),
      spread: Math.min(1.5, 0.15 + scatter * 0.45 + (s.switches.value ?? 6) * 0.02),
      lobes,
      warm: Math.min(1, (fray + scatter + Math.max(0, load)) / 2.4),
    };
  }

  private colour(theme: Theme) {
    const u = this.u;
    u.uCool.value.setRGB(...hex("#6aa7f0"));
    u.uMid.value.setRGB(...hex("#a48cf0"));
    u.uHot.value.setRGB(...hex("#ff7a45"));
    u.uGround.value.setRGB(...hex("#0e1424"));
    u.uDeep.value.setRGB(...hex(theme.deep));
  }
  setShare(on: boolean) { this.share = on; }
  setShift(x: number) { this.u.uShift.value = x; }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h;
    // the form is soft, so it can be drawn at a lower resolution and stay smooth at 60 fps
    const r = Math.min(dpr, 1.25);
    this.renderer.setPixelRatio(r);
    this.renderer.setSize(w, h, false);
    this.u.uRes.value.set(w * r, h * r);
  }

  frame(t: number, dt: number) {
    if (this.tour && this.signs.length) {
      this.tourT += dt;
      const w = Math.min(this.lastFull(), Math.floor(this.tourT / 0.55));
      if (w !== this.week) this.show(w);
      if (w >= this.lastFull()) this.tour = false;
    }
    const ease = dt ? 1 - Math.exp(-dt * 2.2) : 1;
    for (const k of Object.keys(this.p) as (keyof Params)[]) this.p[k] += (this.target[k] - this.p[k]) * ease;
    const p = this.p, u = this.u;
    this.phase += dt * p.breath * Math.PI * 2;
    u.uTime.value = t;
    u.uBreath.value = 1 + Math.sin(this.phase) * 0.045;
    u.uCore.value = p.core; u.uK.value = p.k; u.uNoise.value = p.noise; u.uFlow.value = p.flow; u.uWarm.value = p.warm;
    const n = Math.round(p.lobes);
    u.uN.value = n;
    for (let i = 0; i < n; i++) {
      // lobes orbit on tilted rings, each at its own pace
      const a = t * (0.11 + i * 0.023) + i * 2.399, tilt = i * 1.3;
      const r = p.core + 0.12 + p.spread * (0.55 + 0.45 * Math.sin(t * 0.21 + i));
      u.uB.value[i].set(Math.cos(a) * r, Math.sin(a) * Math.cos(tilt) * r * 0.8, Math.sin(a) * Math.sin(tilt) * r);
      u.uR.value[i] = 0.2 + 0.16 * Math.sin(i * 1.7 + 1) ** 2;
    }
    this.renderer.render(this.scene, this.camera);
  }

  hover() { return null; }

  caption() {
    const s = this.signs[this.week];
    if (!s) return { line: "One week, alive.", sub: "Reading your vital signs…" };
    const when = this.week === this.signs.length - 1 ? "This week so far" : this.week === this.signs.length - 2 ? "Last week" : `The week of ${fmtDay(s.week)}`;
    const bits: string[] = [];
    const f = (x: number | null, d = 0) => (x == null ? "?" : x.toFixed(d));
    if (s.load.value != null) bits.push(`${f(s.load.value)} hours at it${s.load.lo != null ? ` (usually ${f(s.load.lo)} to ${f(s.load.hi)})` : ""}`);
    if (s.night.value != null) bits.push(`nights of ${f(s.night.value, 1)} h`);
    if (s.switches.value != null) bits.push(`${f(s.switches.value, 1)} switches an hour`);
    return {
      line: `${when}, alive: it breathes with your hours, frays with strain, and splits when your attention does.`,
      sub: bits.join(", ") + ". ← → to walk through the weeks.",
    };
  }

  labels() {
    if (!this.signs.length) return [];
    // the weeks as a row of marks along the bottom, the shown one named
    const W = this.signs.length, span = Math.min(this.w * 0.5, W * 16), x0 = this.w / 2 - span / 2, y = this.h - 34;
    const out = this.signs.map((_, i) => ({ x: x0 + (i / (W - 1)) * span, y, text: i === this.week ? "●" : "·" }));
    out.push({ x: x0 + (this.week / (W - 1)) * span, y: y - 18, text: fmtDay(this.signs[this.week].week).replace(/^\w+ /, "") });
    return out;
  }

  dispose() { removeEventListener("keydown", this.onKey); this.renderer.dispose(); this.renderer.forceContextLoss(); }
}
