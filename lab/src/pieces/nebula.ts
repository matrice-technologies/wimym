// Nebula: every message since March as a star. Time winds outwards in a spiral, one turn a day,
// so the first day is the core and this week is the rim. The angle is the hour, so the hours you
// don't work, your nights, leave a dark lane that curls through the whole galaxy. Colour is what
// the message asks for, late hours burn warmer, and the projects lie in thin sheets.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Mind } from "../shared/data";
import { hex, type Theme } from "../shared/palette";
import { backdrop } from "../shared/backdrop";
import { fmtMonth, messageTip, roundN, type Piece, type PieceFactory } from "../shared/piece";

const RADIUS = 10, R0 = 0.06, TWIST = Math.PI * 1.3, REVEAL = 5.5;
// equal area for equal time, so the months after the busy summer aren't spread thin at the rim
const radiusAt = (t: number) => R0 + (1 - R0) * Math.sqrt(Math.max(0, t));

const VERT = /* glsl */ `
  attribute float aT;       // 0 at the first message, 1 now
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aGlow;    // 1 for this week
  attribute float aSeed;
  uniform float uTime, uReveal, uPx, uHover, uDust;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float born = uReveal - aT;                       // seconds-ish since this star appeared
    float seen = smoothstep(0.0, 0.015, born);
    float flash = 1.0 + 2.5 * exp(-born * 60.0) * seen;
    float tw = 1.0 + aGlow * (0.35 * sin(uTime * 2.3 + aSeed * 40.0));
    float hov = (abs(float(gl_VertexID) - uHover) < 0.5) ? 3.5 : 1.0;
    gl_PointSize = aSize * uPx * flash * tw * hov * (30.0 / -mv.z);
    vColor = aColor;
    vAlpha = seen * (uDust > 0.0 ? 1.0 : min(1.0, flash));
  }`;
const FRAG = /* glsl */ `
  uniform float uDust;  // 0 for stars, else the glow's strength
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float core = exp(-d * 9.0), halo = exp(-d * 2.6) * 0.35;
    float a = uDust > 0.0 ? exp(-d * 2.2) * 0.9 * uDust : core + halo;
    vec3 c = vColor * (0.45 + core * 0.9);
    gl_FragColor = vec4(c, a * vAlpha);
  }`;

/** The longest run of days without a message, for a label: rest shows as a gap in the spiral. */
function longestRest(m: Mind) {
  let best: { from: number; len: number } | null = null, run = 0;
  m.perDay.forEach((d, i) => {
    run = d.n ? 0 : run + 1;
    if (run && (!best || run > best.len)) best = { from: i - run + 1, len: run };
  });
  return best as { from: number; len: number } | null;
}

export const nebula: PieceFactory = (canvas, mind, theme0, opts) => new Nebula(canvas, mind, theme0, opts.share, opts.still);

class Nebula implements Piece {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  group = new THREE.Group();
  stars: THREE.Points; dust: THREE.Points;
  pos: Float32Array; tOf: Float32Array;
  uniforms = { uTime: { value: 0 }, uReveal: { value: 0 }, uPx: { value: 1 }, uHover: { value: -1 }, uDust: { value: 0 } };
  dustU = { ...this.uniforms, uDust: { value: 1 }, uHover: { value: -1 } };
  w = 1; h = 1; hoverI = -1; mx = 0; my = 0;
  theme: Theme;
  composer: EffectComposer; bloom: UnrealBloomPass;

  readonly canvas: HTMLCanvasElement; readonly mind: Mind; share: boolean; readonly still: boolean;

  constructor(canvas: HTMLCanvasElement, mind: Mind, theme: Theme, share: boolean, still: boolean) {
    this.canvas = canvas; this.mind = mind; this.share = share; this.still = still;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.theme = theme;
    this.renderer.setClearColor(0x000000, 0);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 0.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    const n = mind.n, D = mind.days.length;
    const pos = new Float32Array(n * 3), tOf = new Float32Array(n), size = new Float32Array(n);
    const glow = new Float32Array(n), seed = new Float32Array(n);
    let s = 1;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.87;
    const nowDay = D - 1;
    for (let i = 0; i < n; i++) {
      const t = (mind.day[i] + (mind.hour[i] - 5) / 24) / D;
      const r = radiusAt(t);
      const a = -((mind.hour[i] - 5) / 24) * Math.PI * 2 + TWIST * r + gauss() * 0.018;
      const rr = (r + gauss() * 0.004) * RADIUS;
      const p = mind.project[i];
      const sheet = p < 9 ? (p - 4) * 0.075 : gauss() * 0.35;
      const z = sheet + gauss() * 0.035 * (1 + 3 * Math.pow(1 - r, 3));
      pos.set([Math.cos(a) * rr, Math.sin(a) * rr, z], i * 3);
      tOf[i] = t;
      size[i] = 1.0 + Math.log2(2 + mind.words[i]) * 0.3;
      glow[i] = mind.day[i] > nowDay - 7 ? 1 : 0;
      if (glow[i]) size[i] *= 1.5;
      seed[i] = rnd();
    }
    this.pos = pos; this.tOf = tOf;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aT", new THREE.BufferAttribute(tOf, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aGlow", new THREE.BufferAttribute(glow, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.stars = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));

    // the glow of the nebula: the same stars, blown up and very faint
    const dgeo = geo.clone();
    const dsize = new Float32Array(n);
    for (let i = 0; i < n; i++) dsize[i] = 6 + rnd() * 9;
    dgeo.setAttribute("aSize", new THREE.BufferAttribute(dsize, 1));
    dgeo.setAttribute("aGlow", new THREE.BufferAttribute(new Float32Array(n), 1));
    this.dust = new THREE.Points(dgeo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.group.add(this.dust, this.stars);
    this.group.rotation.x = -Math.PI / 2;
    this.scene.add(this.group);
    this.colour(theme);
    canvas.addEventListener("pointermove", e => { this.mx = e.offsetX / this.w - 0.5; this.my = e.offsetY / this.h - 0.5; });
  }

  private colour(theme: Theme) {
    const m = this.mind, col = this.stars.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const fam = theme.fam.map(hex), plain = hex(theme.plain), ember = hex(theme.ember), now = hex(theme.now);
    const D = m.days.length;
    for (let i = 0; i < m.n; i++) {
      let c = m.family[i] >= 0 ? fam[m.family[i]] : plain;
      const late = Math.min(1, Math.max(0, (m.hour[i] - 21.5) / 2.5));
      c = c.map((v, k) => v + (ember[k] - v) * late * 0.85) as [number, number, number];
      if (m.family[i] >= 0) c = c.map((v, k) => v + (plain[k] - v) * 0.3) as [number, number, number];
      if (m.day[i] > D - 8) c = c.map((v, k) => v + (now[k] - v) * 0.6) as [number, number, number];
      col.setXYZ(i, c[0], c[1], c[2]);
    }
    col.needsUpdate = true;
    // the glow: a faint light added up
    const dcol = this.dust.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const k = 0.07;
    for (let i = 0; i < m.n; i++) dcol.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k * 1.15);
    dcol.needsUpdate = true;
    this.scene.background = backdrop(theme);
  }

  setShare(on: boolean) { this.share = on; }

  shift = 0;
  setShift(x: number) { this.shift = x; this.applyShift(); }
  private applyShift() {
    if (this.shift) this.camera.setViewOffset(this.w, this.h, -this.shift * this.w, 0, this.w, this.h);
    else this.camera.clearViewOffset();
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the whole disc in view on tall and wide screens
    this.camera.position.set(0, 0, 38 / Math.min(1, this.camera.aspect * 0.85));
    this.camera.updateProjectionMatrix();
    this.uniforms.uPx.value = dpr * Math.min(1.4, Math.max(0.8, h / 900));
    this.applyShift();
  }

  frame(t: number, _dt: number) {
    this.uniforms.uTime.value = t;
    this.uniforms.uReveal.value = this.still ? 2 : Math.min(2, (t / REVEAL) ** 1.6 * 1.0001);
    // slow drift: the galaxy turns, the camera breathes between a tilt and a view from above
    this.group.rotation.z = t * 0.018;
    const el = this.still ? 0.95 : 0.9 + Math.sin(t * 0.07) * 0.18 - this.my * 0.25;
    const az = (this.still ? 0 : Math.sin(t * 0.05) * 0.35) + this.mx * 0.4;
    const L = this.camera.position.length() || 38;
    this.camera.position.set(Math.sin(az) * Math.cos(el) * L, Math.sin(el) * L, Math.cos(az) * Math.cos(el) * L);
    this.camera.lookAt(0, -0.6, 0);
    // light in the dark: bloom
    this.composer.render();
  }

  private v = new THREE.Vector3();
  private toScreen(i: number) {
    this.v.fromArray(this.pos, i * 3).applyMatrix4(this.stars.matrixWorld).project(this.camera);
    return [(this.v.x * 0.5 + 0.5) * this.w, (-this.v.y * 0.5 + 0.5) * this.h, this.v.z] as const;
  }

  hover(x: number, y: number) {
    let best = -1, bd = 100;
    if (x >= 0) for (let i = 0; i < this.mind.n; i++) {
      const [sx, sy, sz] = this.toScreen(i);
      if (sz > 1) continue;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    this.uniforms.uHover.value = best;
    this.hoverI = best;
    return best < 0 ? null : messageTip(this.mind, best);
  }

  caption() {
    const m = this.mind;
    return {
      line: `Every message you've sent an agent since ${fmtMonth(m.days[0])}: ${roundN(m.n)} stars.`,
      sub: "Time spirals outwards, one turn a day. The empty lane is your nights. The rim is this week.",
    };
  }

  labels() {
    const m = this.mind, D = m.days.length;
    const at = (day: number, hour: number) => {
      const t = (day + (hour - 5) / 24) / D, r = radiusAt(t);
      const a = -((hour - 5) / 24) * Math.PI * 2 + TWIST * r;
      this.v.set(Math.cos(a) * r * RADIUS, Math.sin(a) * r * RADIUS, 0).applyMatrix4(this.group.matrixWorld).project(this.camera);
      return { x: (this.v.x * 0.5 + 0.5) * this.w, y: (-this.v.y * 0.5 + 0.5) * this.h };
    };
    const reveal = this.uniforms.uReveal.value;
    const out: { x: number; y: number; text: string; align?: "left" | "center" | "right" }[] = [];
    if (reveal > 0.05) out.push({ ...at(0, 5), text: fmtMonth(m.days[0]) });
    if (reveal > 0.6) out.push({ ...at(Math.round(D * 0.72), 27.5), text: "nights" });
    const rest = longestRest(m);
    if (rest && rest.len >= 5 && reveal > (rest.from + rest.len / 2) / D + 0.1) out.push({ ...at(rest.from + rest.len / 2, 14), text: `${rest.len} days off` });
    if (reveal > 1) out.push({ ...at(D * 1.12, 17), text: "this week" });
    return out;
  }

  dispose() { this.renderer.dispose(); this.renderer.forceContextLoss(); this.stars.geometry.dispose(); this.dust.geometry.dispose(); }
}
