// Core sample: the days stacked into a column you can turn, March at the bottom and today on top.
// Around each slice is the 24-hour clock. Where you sent messages the slice swells out, so the
// hours you worked carve the column's outline and the hours you didn't, your nights, run up it as
// a groove. Days off pinch it thin and pale; late hours burn at the edge; the top is today.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Mind } from "../shared/data";
import { backdrop } from "../shared/backdrop";
import { hex, type Theme } from "../shared/palette";
import { fmtDay, fmtHour, fmtMonth, type Piece, type PieceFactory } from "../shared/piece";

const A = 96;              // slices of the clock, 15 minutes each
const DY = 0.034;          // height of a day
const PITH = 0.5, SWELL = 1.7;
const GROW = 4.5;          // seconds for the column to grow

export const core: PieceFactory = (canvas, mind, theme, opts) => new Core(canvas, mind, theme, opts.share, opts.still);

class Core implements Piece {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  controls: OrbitControls;
  mesh: THREE.Mesh; cap: THREE.Mesh; marks: THREE.LineSegments;
  act: Float32Array; radius: Float32Array; count: Uint16Array;
  D: number; H: number;
  w = 1; h = 1; theme: Theme;
  raycaster = new THREE.Raycaster();
  hoverRing: THREE.Mesh;

  readonly canvas: HTMLCanvasElement; readonly mind: Mind; share: boolean; readonly still: boolean;

  constructor(canvas: HTMLCanvasElement, mind: Mind, theme: Theme, share: boolean, still: boolean) {
    this.canvas = canvas; this.mind = mind; this.share = share; this.still = still;
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const D = (this.D = mind.days.length);
    this.H = D * DY;

    // messages per 15 minutes, then softened over neighbouring slices and days
    const count = (this.count = new Uint16Array(D * A));
    for (let i = 0; i < mind.n; i++) {
      const a = Math.min(A - 1, Math.max(0, Math.floor((mind.hour[i] - 5) * 4)));
      count[mind.day[i] * A + a]++;
    }
    const act = (this.act = new Float32Array(D * A));
    const kA = [0.06, 0.12, 0.2, 0.24, 0.2, 0.12, 0.06], kD = [0.1, 0.2, 0.4, 0.2, 0.1];
    for (let d = 0; d < D; d++) for (let a = 0; a < A; a++) {
      let s = 0;
      for (let j = -2; j <= 2; j++) {
        const dd = d + j;
        if (dd < 0 || dd >= D) continue;
        for (let k = -3; k <= 3; k++) s += kD[j + 2] * kA[k + 3] * count[dd * A + ((a + k + A) % A)];
      }
      act[d * A + a] = s;
    }
    const sorted = [...act].filter(v => v > 0).sort((x, y) => x - y);
    const top = sorted[Math.floor(sorted.length * 0.985)] || 1;
    const radius = (this.radius = new Float32Array(D * A));
    for (let d = 0; d < D; d++) {
      const off = !mind.perDay[d].n;
      for (let a = 0; a < A; a++) radius[d * A + a] = off ? PITH * 0.82 : PITH + SWELL * Math.sqrt(Math.min(1.3, act[d * A + a] / top));
    }

    // the column: one ring of vertices a day, the clock around it (noon facing the camera at rest)
    const pos = new Float32Array(D * (A + 1) * 3);
    const uv = new Float32Array(D * (A + 1) * 2);
    for (let d = 0; d < D; d++) for (let a = 0; a <= A; a++) {
      const r = radius[d * A + (a % A)], th = this.angle(a);
      const v = d * (A + 1) + a;
      pos.set([Math.cos(th) * r, d * DY - this.H / 2, Math.sin(th) * r], v * 3);
      uv.set([a / A, d / (D - 1)], v * 2);
    }
    const idx: number[] = [];
    for (let d = 0; d < D - 1; d++) for (let a = 0; a < A; a++) {
      const p = d * (A + 1) + a, q = p + A + 1;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(D * (A + 1) * 3), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide }));

    // the top: today's cross-section, like the cut end of a log
    const capGeo = new THREE.BufferGeometry();
    capGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((A + 2) * 3), 3));
    capGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array((A + 2) * 3), 3));
    const ci: number[] = [];
    for (let a = 0; a < A; a++) ci.push(0, a + 2, a + 1);
    capGeo.setIndex(ci);
    this.cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));

    // a fine line at the start of every month, like strata
    const mk: number[] = [];
    mind.days.forEach((day, d) => {
      if (!day.endsWith("-01") || d === 0) return;
      for (let a = 0; a < A; a++) {
        const r0 = radius[d * A + a] + 0.01, r1 = radius[d * A + ((a + 1) % A)] + 0.01, t0 = this.angle(a), t1 = this.angle(a + 1), y = d * DY - this.H / 2;
        mk.push(Math.cos(t0) * r0, y, Math.sin(t0) * r0, Math.cos(t1) * r1, y, Math.sin(t1) * r1);
      }
    });
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.Float32BufferAttribute(mk, 3));
    this.marks = new THREE.LineSegments(mg, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }));

    this.hoverRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 128), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 }));
    this.hoverRing.rotation.x = Math.PI / 2;
    this.hoverRing.visible = false;

    const key = new THREE.DirectionalLight(0xfff1e0, 2.2), rim = new THREE.DirectionalLight(0x8fb4ff, 1.4);
    key.position.set(6, 9, 7); rim.position.set(-8, 2, -6);
    const lights = [new THREE.HemisphereLight(0xffffff, 0x404858, 1.1), key, rim];
    this.scene.add(this.mesh, this.cap, this.marks, this.hoverRing, ...lights);

    this.camera.position.set(0, this.H * 0.75, this.H * 2.4);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, -this.H * 0.04, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.autoRotate = !still;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.minDistance = this.H * 0.6;
    this.controls.maxDistance = this.H * 3.5;
    this.colour(theme);
  }

  /** Noon faces the viewer at rest, so the day side is what you see first and the night groove sits behind. */
  angle(a: number) { return (a / A) * Math.PI * 2 + Math.PI / 2 - ((12 - 5) / 24) * Math.PI * 2; }

  private colour(theme: Theme) {
    const m = this.mind, D = this.D;
    const fam = theme.fam.map(hex), plain = hex("#c9c2b4"), pale = hex("#3a4152");
    const ember = hex(theme.ember), now = hex("#ffe2a8");
    // each day's colour: the mix of what it asked for, softened toward bone
    const mix = new Float32Array(D * 3), n = new Float32Array(D);
    for (let i = 0; i < m.n; i++) {
      const c = m.family[i] >= 0 ? fam[m.family[i]] : plain, d = m.day[i];
      mix[d * 3] += c[0]; mix[d * 3 + 1] += c[1]; mix[d * 3 + 2] += c[2]; n[d]++;
    }
    const col = this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    for (let d = 0; d < D; d++) {
      let base: number[] = n[d] ? [mix[d * 3] / n[d], mix[d * 3 + 1] / n[d], mix[d * 3 + 2] / n[d]] : pale;
      if (n[d]) base = base.map((v, k) => v * 0.55 + plain[k] * 0.45);
      if (d > D - 8) base = base.map((v, k) => v * 0.5 + now[k] * 0.5);
      for (let a = 0; a <= A; a++) {
        const hour = 5 + (a % A) / 4;
        const late = n[d] ? Math.min(1, Math.max(0, (hour - 22) / 2)) * Math.min(1, this.act[d * A + (a % A)] * 2) : 0;
        const c = base.map((v, k) => v + (ember[k] - v) * late);
        col.setXYZ(d * (A + 1) + a, c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2);  // vertex colours are linear
      }
    }
    col.needsUpdate = true;
    (this.marks.material as THREE.LineBasicMaterial).color.set("#e9edf5");
    (this.hoverRing.material as THREE.MeshBasicMaterial).color.set("#ffffff");
    this.scene.background = backdrop(theme);
    this.renderer.toneMappingExposure = 1.0;
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // frame the whole column, on wide and on tall screens
    const want = this.H * 2.55 / Math.min(1, this.camera.aspect * 1.1);
    this.camera.position.setLength(want);
    this.applyShift();
  }

  private grown = -1;
  frame(t: number) {
    // grow from March to today, once
    const g = this.still ? 1 : Math.min(1, 1 - Math.pow(1 - Math.min(1, t / GROW), 3));
    const rows = Math.max(2, Math.round(g * this.D));
    if (rows !== this.grown) {
      this.grown = rows;
      this.mesh.geometry.setDrawRange(0, (rows - 1) * A * 6);
      this.marks.geometry.setDrawRange(0, this.marksUpTo(rows));
      this.updateCap(rows - 1);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private marksUpTo(rows: number) {
    let n = 0;
    this.mind.days.forEach((d, i) => { if (i > 0 && i < rows && d.endsWith("-01")) n += A * 2; });
    return n;
  }

  private updateCap(d: number) {
    const pos = this.cap.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.cap.geometry.getAttribute("color") as THREE.BufferAttribute;
    const body = this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const y = d * DY - this.H / 2 + 0.0005;
    pos.setXYZ(0, 0, y, 0);
    col.setXYZ(0, body.getX(d * (A + 1)) * 0.45, body.getY(d * (A + 1)) * 0.45, body.getZ(d * (A + 1)) * 0.45);
    for (let a = 0; a <= A; a++) {
      const r = this.radius[d * A + (a % A)], th = this.angle(a), v = d * (A + 1) + a;
      pos.setXYZ(a + 1, Math.cos(th) * r, y, Math.sin(th) * r);
      col.setXYZ(a + 1, body.getX(v), body.getY(v), body.getZ(v));
    }
    pos.needsUpdate = col.needsUpdate = true;
    this.cap.geometry.computeVertexNormals();
    this.cap.geometry.computeBoundingSphere();
  }

  hover(x: number, y: number) {
    if (x < 0) { this.hoverRing.visible = false; return null; }
    this.raycaster.setFromCamera(new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObject(this.mesh)[0];
    if (!hit?.uv) { this.hoverRing.visible = false; return null; }
    const d = Math.round(hit.uv.y * (this.D - 1)), a = Math.floor(hit.uv.x * A) % A;
    const day = this.mind.perDay[d];
    let rmax = 0;
    for (let k = 0; k < A; k++) rmax = Math.max(rmax, this.radius[d * A + k]);
    this.hoverRing.visible = true;
    this.hoverRing.position.y = d * DY - this.H / 2;
    this.hoverRing.scale.setScalar(rmax + 0.06);
    const head = `<b>${fmtDay(this.mind.days[d])}</b>`;
    if (!day.n) return `${head}<div class=m>A day off</div>`;
    const slot = this.count[d * A + a];
    const span = day.start != null && day.end != null ? `${fmtHour(day.start)} to ${fmtHour(day.end)}` : "";
    return `${head}<div class=m>${day.n} messages, ${span}</div><div class=q>${fmtHour(5 + a / 4)}: ${slot ? slot + " message" + (slot > 1 ? "s" : "") : "nothing sent"}</div>`;
  }

  caption() {
    const off = this.mind.perDay.filter(d => !d.n).length;
    return {
      line: `${this.D} days since ${fmtMonth(this.mind.days[0])}, stacked: the column grows where you worked.`,
      sub: `Around each slice is the clock. The groove is your nights, the ${off} thin pale rings are days off, and the top is today.`,
    };
  }

  labels() {
    const out: { x: number; y: number; text: string; align?: "left" | "center" | "right" }[] = [];
    const v = new THREE.Vector3();
    const put = (d: number, text: string) => {
      v.set(0, d * DY - this.H / 2, 0);
      // place the word just right of the column, at that height
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(PITH + SWELL + 0.35);
      v.add(right).project(this.camera);
      if (d < this.grown) out.push({ x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, text, align: "left" });
    };
    this.mind.days.forEach((day, d) => { if (day.endsWith("-01") || d === 0) put(d, fmtMonth(day)); });
    put(this.D - 1, "today");
    return out;
  }

  dispose() { this.controls.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); }
}
