import * as THREE from "three";
import type { Theme } from "./palette";

/** A soft radial ground as a scene background, so post-processing and saved stills keep it. */
export function backdrop(theme: Theme, glow = theme.dark ? "#121a30" : "#f8f9fc") {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(256, 236, 0, 256, 256, 362);
  r.addColorStop(0, glow); r.addColorStop(0.55, theme.ground); r.addColorStop(1, theme.deep);
  g.fillStyle = r; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
