// One living form for one week, driven directly by a reading of its vital signs (see hero/weekShape.ts).
// The organism's own shader: a soft body with lobes that merge or drift apart, a skin that frays,
// a breath, and here also a pulse.
import * as THREE from "three";
import { hex, type Theme } from "../shared/palette";
import { FORM_FRAG, MAXB } from "./organism";

/** How the form looks; every field eases toward its new value, so a change of week is seen as a change of form. */
export interface FormShape {
  core: number;      // body radius, 0.4 to 0.9: the longest stretch on one project
  lobes: number;     // how many lobes, 1 to 10: sessions at once
  spread: number;    // how far they drift, 0.1 to 1.6: switching
  k: number;         // how readily they merge, 0.12 to 0.8
  noise: number;     // skin fray, 0.02 to 0.22: short nights, strain
  flow: number;      // how fast the fray moves
  breath: number;    // breaths a second: hours of work
  pulse: number;     // a heartbeat's strength, 0 to 0.08: days in a row
  beat: number;      // heartbeats a second
  warm: number;      // 0 cool (inside the usual) to 1 hot (far outside)
}

export const CALM: FormShape = { core: 0.75, lobes: 3, spread: 0.18, k: 0.75, noise: 0.025, flow: 0.12, breath: 0.1, pulse: 0, beat: 0.8, warm: 0 };

export class Form {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  u = {
    uRes: { value: new THREE.Vector2(1, 1) }, uShift: { value: 0 }, uTime: { value: 0 }, uBreath: { value: 1 }, uCore: { value: 0.8 }, uK: { value: 0.6 },
    uNoise: { value: 0.03 }, uFlow: { value: 0.2 }, uDark: { value: 1 }, uWarm: { value: 0 }, uN: { value: 0 },
    uB: { value: Array.from({ length: MAXB }, () => new THREE.Vector3()) }, uR: { value: new Array(MAXB).fill(0.3) },
    uCool: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color() }, uInk: { value: new THREE.Color() },
  };
  shape: FormShape = { ...CALM };
  target: FormShape = { ...CALM };
  breathPhase = 0; beatPhase = 0; still: boolean;

  constructor(canvas: HTMLCanvasElement, theme: Theme, still: boolean, opts: { preserve?: boolean } = {}) {
    this.still = still;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: !!opts.preserve });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: FORM_FRAG, uniforms: this.u,
    })));
    this.setTheme(theme);
  }

  /** The form to grow toward; `now` jumps straight there (the first week shown, or a still). */
  setShape(s: FormShape, now = false) {
    this.target = { ...s };
    if (now || this.still) this.shape = { ...s };
  }

  setTheme(theme: Theme) {
    const u = this.u;
    u.uDark.value = theme.dark ? 1 : 0;
    u.uCool.value.setRGB(...hex(theme.dark ? "#6aa7f0" : "#2a78d6"));
    u.uMid.value.setRGB(...hex(theme.dark ? "#a48cf0" : "#6250d6"));
    u.uHot.value.setRGB(...hex(theme.dark ? "#ff7a45" : "#d8431c"));
    u.uGround.value.setRGB(...hex(theme.dark ? "#0e1424" : "#f7f8fb"));
    u.uDeep.value.setRGB(...hex(theme.deep));
    u.uInk.value.setRGB(...hex(theme.ink));
  }
  setShift(x: number) { this.u.uShift.value = x; }

  resize(w: number, h: number, dpr: number) {
    // soft enough to draw at a lower resolution and stay smooth at 60 fps
    const r = Math.min(dpr, 1.25);
    this.renderer.setPixelRatio(r);
    this.renderer.setSize(w, h, false);
    this.u.uRes.value.set(w * r, h * r);
  }

  frame(t: number, dt: number) {
    const ease = dt ? 1 - Math.exp(-dt * 1.8) : 1;
    const p = this.shape;
    for (const k of Object.keys(p) as (keyof FormShape)[]) p[k] += (this.target[k] - p[k]) * ease;
    const u = this.u;
    this.breathPhase += dt * p.breath * Math.PI * 2;
    this.beatPhase += dt * p.beat * Math.PI * 2;
    // a heartbeat: a quick double knock, then rest
    const b = this.beatPhase % (Math.PI * 2);
    const knock = Math.exp(-((b - 0.5) ** 2) * 40) + 0.55 * Math.exp(-((b - 1.15) ** 2) * 40);
    u.uTime.value = t;
    u.uBreath.value = 1 + Math.sin(this.breathPhase) * 0.04 + p.pulse * knock;
    u.uCore.value = p.core; u.uK.value = p.k; u.uNoise.value = p.noise; u.uFlow.value = p.flow; u.uWarm.value = p.warm;
    const n = Math.max(1, Math.min(MAXB, Math.round(p.lobes)));
    u.uN.value = n;
    for (let i = 0; i < n; i++) {
      // lobes orbit on tilted rings, each at its own pace
      const a = t * (0.11 + i * 0.023) + i * 2.399, tilt = i * 1.3;
      const r = p.core + 0.12 + p.spread * (0.55 + 0.45 * Math.sin(t * 0.21 + i));
      u.uB.value[i].set(Math.cos(a) * r, Math.sin(a) * Math.cos(tilt) * r * 0.8, Math.sin(a) * Math.sin(tilt) * r);
      // lobes grow with the core: a thin week is a smaller creature, not only a smaller heart
      u.uR.value[i] = (0.2 + 0.16 * Math.sin(i * 1.7 + 1) ** 2) * (0.4 + 0.85 * p.core);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); this.renderer.forceContextLoss(); }
}
