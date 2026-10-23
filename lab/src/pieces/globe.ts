// Planet: your days as a world. Each day is a line of latitude, March at the south and today at
// the north; longitude is the hour. Land is the stretch of each day you were at it, first message
// to last, so your habits draw the coastlines and days off are open sea. Every message is a light.
// The sun stands over 13:00, and the planet faces you with its evening and night, rocking gently;
// the lights there are the hours you worked after dark: amber in the evening, redder and brighter
// the later. Drag to turn it; it comes back to face its night.
//
// On a first visit in a session the messages arrive as the nebula's spiral of stars and fall into
// place (?intro in the lab shows it again, ?at=1.5 holds one moment of it).
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import type { Mind } from "../shared/data";
import { backdrop } from "../shared/backdrop";
import { hex, type Theme } from "../shared/palette";
import { esc, fmtDay, fmtHour, fmtMonth, roundN, type Piece, type PieceFactory } from "../shared/piece";

const LAT = 62 * (Math.PI / 180);   // days run from -62° to +62°
const SUN_HOUR = 13;
const TW = 2048, TH = 1024;
const TILT = 0.32;                 // the north, today, tipped toward the viewer
// the planet faces you with its evening and night, 22:20 at the centre, and rocks gently either side
const FACE_HOUR = 22.33, ROCK = 0.45, ROCK_PERIOD = 50;
const SPIN0 = -((FACE_HOUR - 5) / 24) * Math.PI * 2;
const ENTER = 3.4;                  // seconds for the stars to condense into the planet
const SEEN_KEY = "wimym-planet-entered";
const SWING = 1.4;                  // how far the spiral turns as it falls into place

const VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vObjN; varying vec2 vUv; varying vec3 vView;
  void main() {
    vUv = uv; vObjN = normalize(position);
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  uniform sampler2D uDay, uGlow; uniform vec3 uSun, uNight, uAtmo, uMark; uniform float uDark, uSolid, uHoverLat, uRow;
  varying vec3 vN; varying vec3 vObjN; varying vec2 vUv; varying vec3 vView;
  void main() {
    float lit = smoothstep(-0.12, 0.25, dot(vObjN, uSun));
    vec3 day = texture2D(uDay, vUv).rgb;
    float shade = 0.75 + 0.25 * max(dot(normalize(vN), normalize(vec3(0.4, 0.6, 1.0))), 0.0);
    vec3 col = mix(uNight * (0.6 + 0.4 * day.g), day * shade, lit);
    // the glow the lights cast on the ground, only where it is dark
    col += texture2D(uGlow, vUv).rgb * (1.0 - lit) * (uDark > 0.5 ? 1.1 : 0.9);
    float fres = pow(1.0 - max(dot(normalize(vN), normalize(vView)), 0.0), 3.0);
    col += uAtmo * fres * (0.2 + 0.8 * lit) * (uDark > 0.5 ? 0.8 : 0.5);
    // the day under the pointer, as a fine ring
    float lat = asin(clamp(vObjN.y, -1.0, 1.0));
    float ring = 1.0 - smoothstep(uRow * 0.4, uRow * 1.1, abs(lat - uHoverLat));
    col = mix(col, uMark, ring * 0.32);
    gl_FragColor = vec4(col, uSolid);
  }`;
const PVERT = /* glsl */ `
  attribute float aSize; attribute float aHeat; attribute float aDay; attribute float aDelay; attribute vec3 aFrom;
  uniform vec3 uSun; uniform float uPx, uHoverDay, uMorph, uAppear;
  varying float vNight; varying float vHeat; varying float vHov; varying float vFly;
  void main() {
    // on the way in: from the nebula's spiral, swinging round as it falls into place
    float k = smoothstep(aDelay, aDelay + 0.55, uMorph);
    float sw = (1.0 - k) * ${SWING.toFixed(2)};
    vec3 from = vec3(cos(sw) * aFrom.x + sin(sw) * aFrom.z, aFrom.y, -sin(sw) * aFrom.x + cos(sw) * aFrom.z);
    vec3 p = mix(from, position, k * k * (3.0 - 2.0 * k));
    vec3 n = normalize(position);
    vNight = mix(0.85, 1.0 - smoothstep(-0.15, 0.2, dot(n, uSun)), k);
    vFly = 1.0 - k;
    vHeat = aHeat;
    vHov = abs(aDay - uHoverDay) < 0.5 ? 1.0 : 0.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPx * (0.55 + 1.0 * vNight) * (1.0 + vHov * 0.8 + vFly * 0.9) * (6.0 / -mv.z) * uAppear;
  }`;
const PFRAG = /* glsl */ `
  uniform vec3 uAmber, uOrange, uRed, uStar; uniform float uDark;
  varying float vNight; varying float vHeat; varying float vHov; varying float vFly;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p);
    if (d > 1.0) discard;
    float core = exp(-d * 9.0), halo = exp(-d * 2.4);
    // evening amber, then orange, then red after eleven
    vec3 c = vHeat < 0.5 ? mix(uAmber, uOrange, vHeat * 2.0) : mix(uOrange, uRed, vHeat * 2.0 - 1.0);
    // in flight they are the nebula's white stars; they turn to lamps as they land
    c = mix(c, uStar, vFly * 0.8);
    float bright = (0.75 + 0.9 * vHeat) * mix(0.16, 1.0, vNight) * (1.0 + vHov * 0.9 + vFly * 1.2);
    if (uDark > 0.5) {
      // light added up, hot enough at the core to bloom
      gl_FragColor = vec4(c * (core * 1.5 + halo * 0.1) * bright, 1.0);
    } else {
      gl_FragColor = vec4(c, (core + halo * 0.18) * min(1.0, bright));
    }
  }`;
const SVERT = /* glsl */ `
  attribute float aSize; attribute float aSeed; uniform float uTime, uPx;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = (0.35 + 0.65 * aSeed) * (0.75 + 0.25 * sin(uTime * (0.6 + aSeed * 1.7) + aSeed * 50.0));
    gl_PointSize = aSize * uPx;
  }`;
const SFRAG = /* glsl */ `
  varying float vA;
  void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); if (d > 1.0) discard; gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * exp(-d * 4.0) * vA * 0.55, 1.0); }`;

export const globe: PieceFactory = (canvas, mind, theme, opts) => new Globe(canvas, mind, theme, opts.share, opts.still, opts.intro);

/**
 * Where a message sits in the nebula the planet condenses from, in view space (x right, y up, toward
 * the viewer): t is its time from 0 (first day) to 1 (now), hour its hour of the day. The first run
 * draws its stars here too, so the hand-over to the planet's entrance is seamless.
 */
export function spiralPoint(t: number, hour: number, lift: number, out = new THREE.Vector3()) {
  const r = (0.08 + 0.92 * Math.sqrt(t)) * 2.3, a = -((hour - 5) / 24) * Math.PI * 2 + Math.PI * 1.3 * r / 2.3;
  return out.set(Math.cos(a) * r, lift, Math.sin(a) * r).applyEuler(SPIRAL_TILT);
}
const SPIRAL_TILT = new THREE.Euler(-1.05, 0, 0.25);
/** How far the camera stands at the start of the entrance, for a given aspect and zoom. */
export const entranceDistance = (aspect: number, zoom = 1) => (4.7 / Math.min(1, aspect * 1.05) / zoom) * 1.32;

function sized(c: HTMLCanvasElement) { c.width = TW; c.height = TH; return c; }

/** Whether this browser session has already seen the entrance. */
function seen() { try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } }
function markSeen() { try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode: show it again next time */ } }

export class Globe implements Piece {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer; bloom: UnrealBloomPass;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  world = new THREE.Group();
  ball: THREE.Mesh; lights: THREE.Points; halo: THREE.Mesh; stars: THREE.Points;
  dayCanvas = sized(document.createElement("canvas")); dayTex = new THREE.CanvasTexture(this.dayCanvas);
  glowCanvas = sized(document.createElement("canvas")); glowTex = new THREE.CanvasTexture(this.glowCanvas);
  pos: Float32Array;
  byDay: Int32Array[];               // message indexes of each day, in time order
  sun = new THREE.Vector3();
  u = {
    uDay: { value: null as THREE.Texture | null }, uGlow: { value: null as THREE.Texture | null }, uSun: { value: this.sun },
    uNight: { value: new THREE.Color() }, uAtmo: { value: new THREE.Color() }, uMark: { value: new THREE.Color() },
    uDark: { value: 1 }, uSolid: { value: 1 }, uHoverLat: { value: -10 }, uRow: { value: 0.01 },
  };
  pu = {
    uSun: { value: this.sun }, uPx: { value: 1 }, uHoverDay: { value: -1 }, uMorph: { value: 1 }, uAppear: { value: 1 },
    uAmber: { value: new THREE.Color() }, uOrange: { value: new THREE.Color() }, uRed: { value: new THREE.Color() }, uStar: { value: new THREE.Color() }, uDark: { value: 1 },
  };
  su = { uTime: { value: 0 }, uPx: { value: 1 } };
  w = 1; h = 1; theme: Theme; afterDark = 0;
  entering: boolean;
  // turning: the planet rocks on its own; a drag throws it round, and it settles back to face its night
  spin = SPIN0; offset = 0; vel = 0; drag: { x: number; t: number } | null = null;
  hoverDay = -1;

  readonly canvas: HTMLCanvasElement; readonly mind: Mind; share: boolean; readonly still: boolean;

  constructor(canvas: HTMLCanvasElement, mind: Mind, theme: Theme, share: boolean, still: boolean, intro?: boolean, opts: { preserve?: boolean } = {}) {
    this.canvas = canvas; this.mind = mind; this.share = share; this.still = still;
    this.theme = theme;
    this.entering = !still && (intro ?? (!seen() || new URLSearchParams(location.search).has("intro")));
    if (intro !== false && !still) markSeen();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: !!opts.preserve });
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.35, 1.0);
    this.composer.addPass(this.bloom);
    // end on a plain copy: the bloom's own copy to screen would convert colour and wash the planet out
    this.composer.addPass(new ShaderPass(CopyShader));

    this.dayTex.anisotropy = this.glowTex.anisotropy = 8;
    this.dayTex.colorSpace = THREE.SRGBColorSpace;
    this.u.uDay.value = this.dayTex;
    this.u.uGlow.value = this.glowTex;
    this.u.uRow.value = (2 * LAT) / Math.max(1, mind.days.length - 1);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true }));
    this.sun.copy(this.dir(SUN_HOUR, 0));

    // the lights, and where each one starts on the way in: its place in the nebula's spiral
    const n = mind.n, D = mind.days.length;
    const pos = (this.pos = new Float32Array(n * 3)), from = new Float32Array(n * 3);
    const size = new Float32Array(n), heat = new Float32Array(n), dayA = new Float32Array(n), delay = new Float32Array(n);
    // the spiral faces the viewer at the start; the shader swings it 1.4 rad round the axis as it falls,
    // so it starts pre-turned the other way
    const toObject = new THREE.Matrix4().makeRotationY(-SWING).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(TILT, SPIN0, 0)).invert());
    const v = new THREE.Vector3();
    let s = 3;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const p = this.dir(mind.hour[i] + (rnd() - 0.5) * 0.05, this.lat(mind.day[i] + (rnd() - 0.5) * 0.7)).multiplyScalar(1.004);
      pos.set([p.x, p.y, p.z], i * 3);
      const t = (mind.day[i] + (mind.hour[i] - 5) / 24) / D;
      spiralPoint(t, mind.hour[i], (rnd() - 0.5) * 0.04, v).applyMatrix4(toObject);
      from.set([v.x, v.y, v.z], i * 3);
      delay[i] = 0.42 * t + rnd() * 0.03;
      size[i] = 1.0 + Math.log2(2 + mind.words[i]) * 0.3;
      heat[i] = Math.min(1, Math.max(0, (mind.hour[i] - 18) / 6));
      dayA[i] = mind.day[i];
      if (mind.hour[i] >= 21) this.afterDark++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aFrom", new THREE.BufferAttribute(from, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aHeat", new THREE.BufferAttribute(heat, 1));
    g.setAttribute("aDay", new THREE.BufferAttribute(dayA, 1));
    g.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
    this.lights = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: PVERT, fragmentShader: PFRAG, uniforms: this.pu, transparent: true, depthWrite: false }));
    this.lights.renderOrder = 2;

    const counts = new Int32Array(D);
    for (let i = 0; i < n; i++) counts[mind.day[i]]++;
    this.byDay = Array.from({ length: D }, (_, d) => new Int32Array(counts[d]));
    const fill = new Int32Array(D);
    for (let i = 0; i < n; i++) this.byDay[mind.day[i]][fill[mind.day[i]]++] = i;

    // a thin atmosphere: brightest at the planet's edge, nothing at the shell's own edge
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 48), new THREE.ShaderMaterial({
      uniforms: { uC: this.u.uAtmo, uDark: this.u.uDark, uSolid: this.u.uSolid },
      vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 uC; uniform float uDark, uSolid; varying vec3 vN; void main(){ float f = pow(clamp(-vN.z / 0.45, 0.0, 1.0), 4.0); gl_FragColor = vec4(uC, f * uSolid * (uDark > 0.5 ? 0.9 : 0.5)); }",
      side: THREE.BackSide, transparent: true, depthWrite: false,
    }));

    // a faint field of stars far behind, for the dark theme
    const SN = 2600, spos = new Float32Array(SN * 3), ssize = new Float32Array(SN), sseed = new Float32Array(SN);
    for (let i = 0; i < SN; i++) {
      v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(60);
      if (v.z > 20) v.z = -v.z;  // keep them behind the planet
      spos.set([v.x, v.y, v.z], i * 3);
      ssize[i] = 0.8 + Math.pow(rnd(), 6) * 2.8;
      sseed[i] = rnd();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(spos, 3));
    sg.setAttribute("aSize", new THREE.BufferAttribute(ssize, 1));
    sg.setAttribute("aSeed", new THREE.BufferAttribute(sseed, 1));
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: SVERT, fragmentShader: SFRAG, uniforms: this.su, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));

    this.world.add(this.ball, this.lights);
    this.world.rotation.x = TILT;
    this.scene.add(this.stars, this.halo, this.world);
    this.camera.position.set(0, 0, 5);
    this.paintGlow();
    this.setTheme(theme);
    canvas.addEventListener("pointerdown", this.down);
    addEventListener("pointermove", this.move);
    addEventListener("pointerup", this.up);
  }

  down = (e: PointerEvent) => { this.drag = { x: e.clientX, t: performance.now() }; this.vel = 0; };
  move = (e: PointerEvent) => {
    if (!this.drag) return;
    const now = performance.now(), dx = e.clientX - this.drag.x, dt = Math.max(1, now - this.drag.t) / 1000;
    const turn = (dx / Math.max(300, this.h * 0.6)) * Math.PI;
    this.offset += turn;
    this.vel = turn / dt;
    this.drag = { x: e.clientX, t: now };
  };
  up = () => { this.drag = null; };

  /** Latitude of a day, and the direction of an hour on the planet (object space). */
  lat(day: number) { return -LAT + (2 * LAT * day) / Math.max(1, this.mind.days.length - 1); }
  dir(hour: number, lat: number) {
    const lon = ((hour - 5) / 24) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
  }
  // equirectangular texture coordinates matching dir(): three's spheres put u = lon / 2π + 0.25
  private xOf(hour: number) { return ((((hour - 5) / 24 + 0.25) % 1) + 1) % 1 * TW; }
  private yOf(lat: number) { return (0.5 - lat / Math.PI) * TH; }

  /** The day map: land where you were at it, sea elsewhere. */
  paint(theme: Theme) {
    const g = this.dayCanvas.getContext("2d")!, m = this.mind, D = m.days.length;
    const sea = theme.dark ? "#1b3a5c" : "#c9d6e6", deep = theme.dark ? "#10243d" : "#b4c4d8";
    const land = theme.dark ? "#aea38a" : "#f3efe6", shore = theme.dark ? "#788a6c" : "#cfd8bf";
    const grad = g.createLinearGradient(0, 0, 0, TH);
    grad.addColorStop(0, deep); grad.addColorStop(0.5, sea); grad.addColorStop(1, deep);
    g.fillStyle = grad; g.fillRect(0, 0, TW, TH);
    const row = Math.abs(this.yOf(this.lat(1)) - this.yOf(this.lat(0))) + 0.6;
    const span = (x0: number, x1: number, y: number, h: number) => {
      if (x1 >= x0) g.fillRect(x0, y, x1 - x0, h); else { g.fillRect(x0, y, TW - x0, h); g.fillRect(0, y, x1, h); }
    };
    for (let d = 0; d < D; d++) {
      const r = m.perDay[d];
      if (!r.n || r.start == null || r.end == null) continue;
      const y = this.yOf(this.lat(d)) - row / 2;
      g.fillStyle = shore; span(this.xOf(r.start - 0.35), this.xOf(r.end + 0.35), y, row);
      g.fillStyle = land; span(this.xOf(r.start), this.xOf(r.end), y, row);
    }
    // polar caps beyond the record
    g.fillStyle = theme.dark ? "#2a3550" : "#e6ebf2";
    g.fillRect(0, 0, TW, this.yOf(LAT) - 2); g.fillRect(0, this.yOf(-LAT) + 2, TW, TH);
    this.dayTex.needsUpdate = true;
  }

  /** The ground glow under the lights: every message a soft warm spot, added up. */
  paintGlow() {
    const g = this.glowCanvas.getContext("2d")!, m = this.mind;
    g.fillStyle = "#000"; g.fillRect(0, 0, TW, TH);
    g.globalCompositeOperation = "lighter";
    const sprite = (rgb: string) => {
      const c = document.createElement("canvas"); c.width = c.height = 32;
      const x = c.getContext("2d")!, r = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      r.addColorStop(0, `rgba(${rgb},0.045)`); r.addColorStop(1, `rgba(${rgb},0)`);
      x.fillStyle = r; x.fillRect(0, 0, 32, 32);
      return c;
    };
    const sprites = [sprite("255,170,80"), sprite("255,120,50"), sprite("255,70,35")];
    for (let i = 0; i < m.n; i++) {
      const h = m.hour[i], k = h < 21 ? 0 : h < 23 ? 1 : 2;
      g.drawImage(sprites[k], this.xOf(h) - 16, this.yOf(this.lat(m.day[i])) - 16);
    }
    g.globalCompositeOperation = "source-over";
    this.glowTex.needsUpdate = true;
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    this.paint(theme);
    const dark = theme.dark;
    this.u.uDark.value = this.pu.uDark.value = dark ? 1 : 0;
    this.u.uNight.value.setRGB(...hex(dark ? "#03050c" : "#1d2438"));
    this.u.uAtmo.value.setRGB(...hex(dark ? "#5b9cf0" : "#7fa6d9"));
    this.u.uMark.value.setRGB(...hex(dark ? "#ffffff" : "#121725"));
    this.pu.uAmber.value.setRGB(...hex(dark ? "#ffb85c" : "#f0a030"));
    this.pu.uOrange.value.setRGB(...hex(dark ? "#ff7a2e" : "#e8641c"));
    this.pu.uRed.value.setRGB(...hex(dark ? "#ff3b24" : "#c8321a"));
    this.pu.uStar.value.setRGB(...hex(dark ? "#c7dbff" : "#2b3550"));
    this.blend();
    this.stars.visible = dark;
    (this.scene.background as THREE.Texture | null)?.dispose();
    const bg = backdrop(theme, dark ? "#0c1222" : undefined);
    // through the bloom's render targets nothing converts colour, so in the dark the ground is drawn as written
    if (dark) bg.colorSpace = THREE.NoColorSpace;
    this.scene.background = bg;
  }
  /** Lights add up, except on paper while they fly in, where added light would vanish. */
  private blend() {
    const mat = this.lights.material as THREE.ShaderMaterial;
    const want = !this.theme.dark && this.entering ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (mat.blending !== want) { mat.blending = want; mat.needsUpdate = true; }
  }
  setShare(on: boolean) { this.share = on; }

  shift = 0; shiftY = 0; zoom = 1;
  setShift(x: number) { this.shift = x; this.applyShift(); }
  /** Place the planet in the frame: x and y as shares of the width and height (down is positive), and a size. */
  setFrame(x: number, y: number, zoom: number) { this.shift = x; this.shiftY = y; this.zoom = zoom; this.applyShift(); }
  private applyShift() {
    if (this.shift || this.shiftY) this.camera.setViewOffset(this.w, this.h, -this.shift * this.w, -this.shiftY * this.h, this.w, this.h);
    else this.camera.clearViewOffset();
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    // the glow is soft, so it needs no more than half the pixels
    this.bloom.setSize(w * Math.min(dpr, 1.5) / 2, h * Math.min(dpr, 1.5) / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pu.uPx.value = dpr * Math.min(1.5, h / 800);
    this.su.uPx.value = dpr;
    this.applyShift();
  }

  frame(t: number, dt: number) {
    if (!this.still && !this.drag && dt) {
      this.offset += this.vel * dt;
      this.vel *= Math.exp(-dt * 1.6);
      // come home the short way round, over a few seconds
      this.offset = Math.atan2(Math.sin(this.offset), Math.cos(this.offset)) * Math.exp(-dt * 0.35);
    }
    this.spin = SPIN0 + (this.still ? 0 : ROCK * Math.sin((t / ROCK_PERIOD) * Math.PI * 2)) + this.offset;
    this.world.rotation.y = this.spin;
    this.stars.rotation.y = this.spin * 0.04;
    this.su.uTime.value = t;
    const z = 4.7 / Math.min(1, this.camera.aspect * 1.05) / this.zoom;
    if (this.entering) {
      // the entrance: the stars of the nebula fall into place, then the ground forms under them
      const m = Math.min(1, Math.max(0, (t - 0.15) / ENTER));
      this.pu.uMorph.value = m;
      this.pu.uAppear.value = Math.min(1, t / 0.6);
      this.u.uSolid.value = Math.min(1, Math.max(0, (m - 0.5) / 0.45)) ** 1.5;
      this.camera.position.z = z * (1 + 0.32 * Math.pow(1 - m, 2));
      if (m >= 1) { this.entering = false; this.blend(); }
    } else {
      this.pu.uMorph.value = 1; this.pu.uAppear.value = 1; this.u.uSolid.value = 1;
      this.camera.position.z = z;
    }
    this.ball.visible = this.u.uSolid.value > 0.002;
    if (this.theme.dark) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }

  // ---------- pointing ----------

  private v = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private inv = new THREE.Matrix4();
  /** The day and hour under the pointer, from where its ray meets the planet. */
  private at(x: number, y: number) {
    if (x < 0 || this.entering) return null;
    this.ray.setFromCamera(new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1), this.camera);
    const hit = this.ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1.01), this.v);
    if (!hit) return null;
    this.world.updateMatrixWorld();
    const p = hit.applyMatrix4(this.inv.copy(this.world.matrixWorld).invert()).normalize();
    const lat = Math.asin(p.y);
    if (Math.abs(lat) > LAT + this.u.uRow.value) return null;
    const day = Math.max(0, Math.min(this.mind.days.length - 1, Math.round(((lat + LAT) / (2 * LAT)) * (this.mind.days.length - 1))));
    let hour = (Math.atan2(p.x, p.z) / (Math.PI * 2)) * 24 + 5;
    while (hour < 5) hour += 24;
    while (hour >= 29) hour -= 24;
    return { day, hour };
  }

  select(x: number, y: number) {
    const a = this.at(x, y);
    return a ? this.mind.days[a.day] : null;
  }

  hover(x: number, y: number) {
    const a = this.drag ? null : this.at(x, y);
    this.hoverDay = a ? a.day : -1;
    this.u.uHoverLat.value = a ? this.lat(a.day) : -10;
    this.pu.uHoverDay.value = this.hoverDay;
    if (!a) return null;
    const m = this.mind, r = m.perDay[a.day];
    const head = `<b>${fmtDay(m.days[a.day])}</b>`;
    if (!r.n) return `${head}<div class=m>A day off</div>`;
    const span = r.start != null && r.end != null ? `, ${fmtHour(r.start)} to ${fmtHour(r.end)}` : "";
    const late = this.byDay[a.day].reduce((k, i) => k + (m.hour[i] >= 21 ? 1 : 0), 0);
    let out = `${head}<div class=m>${r.n} message${r.n > 1 ? "s" : ""}${span}${late ? `, ${late} after 9 pm` : ""}</div>`;
    // outside share mode, the message nearest the pointer's hour, if one is close
    let best = -1, bd = 0.34;
    for (const i of this.byDay[a.day]) { const d = Math.abs(m.hour[i] - a.hour); if (d < bd) { bd = d; best = i; } }
    const det = best >= 0 ? m.detail(best) : null;
    if (det) {
      const text = det.text.replace(/\s+/g, " ").trim();
      out += `<div class=q><span class=m>${fmtHour(m.hour[best])}, ${esc(det.project)}:</span> ${esc(text.slice(0, 110))}${text.length > 110 ? "…" : ""}</div>`;
    }
    return out;
  }

  caption() {
    return {
      line: `Your days as a planet: ${roundN(this.mind.n)} messages since ${fmtMonth(this.mind.days[0])}, each one a light.`,
      sub: `Each day is a line of latitude and the land is when you were at it. ${roundN(this.afterDark)} lights sit on the night side, sent after 9 pm.`,
    };
  }

  labels() {
    if (this.entering) return [];
    const out: { x: number; y: number; text: string; align?: "left" | "center" | "right" }[] = [];
    const put = (p: THREE.Vector3, text: string, dy = 0) => { p.project(this.camera); out.push({ x: (p.x * 0.5 + 0.5) * this.w, y: (-p.y * 0.5 + 0.5) * this.h + dy, text }); };
    // the poles: where the record starts and where it is now
    put(this.v.set(0, Math.sin(LAT + 0.3) * 1.12, 0).applyMatrix4(this.world.matrixWorld), "today", -10);
    put(this.v.set(0, -1.17, 0), fmtMonth(this.mind.days[0]));
    // midnight, where the night side faces you
    const mid = this.dir(24, 0.1).multiplyScalar(1.02).applyMatrix4(this.world.matrixWorld);
    if (mid.z > 0.35) put(mid, "midnight");
    return out;
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.down);
    removeEventListener("pointermove", this.move);
    removeEventListener("pointerup", this.up);
    this.composer.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.dayTex.dispose(); this.glowTex.dispose();
  }
}
