// The painting of the mass behind the strummed loom, as an aurora: given each project's stretch of sky at each depth
// and the weight in it, its curtain of light there, all of them adding up, on a small grid of cells.
// It runs in a worker, so that the page never waits on it; the mass asks for a picture now and then and fades from
// one to the next. Called directly when there is no worker, or for a still.

export const CELL = 3;               // px a cell of the painted layer spans
const FULL = 32;                     // messages that make a curtain two thirds as tall as it gets
// the depths, near to far, one curtain behind another: how tall a curtain gets (of the band's height, before TALL),
// where it hangs (from the band's middle, down toward the horizon), how bright, and how much of its colour distance
// leaves it
export const DEPTHS = [
  { thick: 0.25, at: 0, bright: 1, sat: 2.1 },
  { thick: 0.19, at: 0.03, bright: 0.66, sat: 1.4 },
  { thick: 0.14, at: 0.06, bright: 0.42, sat: 0.8 },
];
const TALL = 2.2;                    // how much taller a curtain is than the thickness above
const RAGGED = 0.16;                 // how far a curtain's height swells and shrinks along the current, as a share of it
const RAYS = 14;                     // how many rays to 260 px of the current: soft, never fine lines
const FOLD = 0.5;                    // how far a curtain's lower edge folds up and down, as a share of its height
const GLOW = 0.34;                   // how bright a curtain is at most, near: kept well under the strings' light
const CHROMA = 0.17, LIGHT = 0.8;    // how strong a curtain's colour is, near (OKLab chroma), and how light
const PALE = 0.15;                   // how much paler a curtain is at its lower edge, where it burns brightest
const VIOLET = 0.45, HIGH = [0.7, 0.4, 1];   // how far it leans, up high, toward the aurora's violet
const GULP_PX = 7, GULP_MAX = 22, GULP_WIDE = 34;   // px a struck string's curtain flares by, at most, and how wide
export const CURTAIN = 6;            // numbers per curtain in a job: slot, depth, middle (px), half width (px), weight, y (from the band's middle)
export const FLARE = 3;              // numbers per flare: slot, x, how much
export const PROJECT = 3;            // numbers per project: project, mean a, mean b

/** What a picture is painted from. */
export interface Job {
  gw: number; gh: number; y0: number; mid: number; tall: number; t: number; W: number; dark: boolean;
  curtains: Float32Array; flares: Float32Array; projects: Float32Array;
}
export interface Picture { px: Uint8ClampedArray; gw: number; gh: number; y0: number; dark: boolean }

/** A project's colour at depth d: the average hue of its messages (mean OKLab a and b), at an aurora's strength,
 * less where its types pull every way at once, and less far off. */
export function curtainColour(ma: number, mb: number, d: number): [number, number, number] {
  const hue = Math.atan2(mb, ma), chroma = CHROMA * DEPTHS[d].sat / DEPTHS[0].sat * Math.min(1, Math.hypot(ma, mb) / 0.012);
  return srgb(LIGHT, chroma * Math.cos(hue), chroma * Math.sin(hue));
}

/** Each project's curtain at each depth, over its stretch of sky: as tall as the weight in it, flat across the
 * stretch and softening off its ends into its neighbours'; its lower edge where the project hangs (folding slowly),
 * brightest just above that edge and fading upward, in rays that are the curtain's own and shimmer. The sky turns:
 * a curtain going out at one side comes back in at the other (W px around). */
export function paintField(job: Job): Picture {
  const { gw, gh, y0, mid, tall: bandTall, t, W, dark, curtains, flares, projects } = job;
  const NP = projects.length / PROJECT, acc = new Float32Array(gw * gh * 3), G = new Float32Array(NP * gw);
  // where a struck string flares, in its project's stretch
  for (let f = 0; f < flares.length; f += FLARE) {
    const q = flares[f], k = flares[f + 2];
    for (const x of [flares[f + 1] - W, flares[f + 1], flares[f + 1] + W]) {
      const ca = Math.max(0, Math.floor((x - 3 * GULP_WIDE) / CELL)), cb = Math.min(gw - 1, Math.ceil((x + 3 * GULP_WIDE) / CELL));
      for (let c = ca; c <= cb; c++) { const dx = (c * CELL - x) / GULP_WIDE; G[q * gw + c] += k * Math.exp(-dx * dx); }
    }
  }
  const [hr, hg, hb] = HIGH;
  // far curtains first, though they only add up
  for (let o = 0; o < curtains.length; o += CURTAIN) {
    const q = curtains[o], d = curtains[o + 1], x0 = curtains[o + 2], hw = curtains[o + 3], weight = curtains[o + 4], hang = curtains[o + 5];
    if (weight < 0.05 || hw < 1) continue;
    const De = DEPTHS[d], tall = De.thick * bandTall * TALL, base = mid + De.at * bandTall + hang * (1 - 0.4 * d);
    // a curtain comes in and goes out gently with its weight, never all at once
    const fade = smooth(weight / 1.5);
    // its colour, a little paler at the lower edge and leaning to violet up high; its folds and rays its own
    const proj = projects[q * PROJECT], seed = d * 17.3 + proj * 5.1;
    const [tr, tg, tb] = curtainColour(projects[q * PROJECT + 1], projects[q * PROJECT + 2], d);
    const lr = tr + (1 - tr) * PALE, lg = tg + (1 - tg) * PALE, lb = tb + (1 - tb) * PALE;
    const ur = tr + (hr - tr) * VIOLET, ug = tg + (hg - tg) * VIOLET, ub = tb + (hb - tb) * VIOLET;
    const most = tall * Math.pow(1 - Math.exp(-weight / FULL), 0.75);
    // the curtain, and its other self around the sky, as it comes in at one side while it goes out at the other
    for (const x of [x0 - W, x0, x0 + W]) {
      const ca = Math.max(0, Math.floor((x - 1.8 * hw) / CELL)), cb = Math.min(gw - 1, Math.ceil((x + 1.8 * hw) / CELL));
      for (let c = ca; c <= cb; c++) {
        // flat across its stretch, softening off the ends
        const u = (c * CELL - x) / hw, shape = Math.exp(-(u * u * u * u));
        if (shape < 0.01) continue;
        // where this column is in the curtain, so that its folds and rays go round with it
        const X = (c * CELL - x) / 260 + proj * 3.7, flare = d ? 0 : Math.min(GULP_MAX, G[q * gw + c] * GULP_PX);
        const ray = 0.6 * noise(X * RAYS + t * 0.07, seed + 5) + 0.4 * noise(X * RAYS * 1.9 - t * 0.11, seed + 9);
        const ragged = 1 + RAGGED * (noise(X * 0.7, seed) - 0.5) * 2;
        const H = most * Math.sqrt(shape) * ragged * (0.55 + 0.75 * ray) + flare * 2;
        if (H < 3) continue;
        // its lower edge: where the project hangs, folding slowly
        const edge = base + H * 0.3 + FOLD * tall * (noise(X * 1.7 + t * 0.03, seed + 3) - 0.5);
        const glow = GLOW * De.bright * fade * shape * (0.45 + 0.55 * ray * ray * 1.6) * (1 + flare / GULP_MAX);
        const ra = Math.max(0, Math.floor((edge - H * 1.5 - y0) / CELL)), rb = Math.min(gh - 1, Math.ceil((edge + 12 - y0) / CELL));
        for (let r = ra; r <= rb; r++) {
          const y = y0 + r * CELL, v = (edge - y) / H;   // 0 at the lower edge, 1 a curtain's height above it
          // near the edge, taken at four heights across the cell, so that it runs smooth from one column to the next
          let I = 0;
          if (Math.abs(edge - y) < 3 * CELL) for (let k = -1.5; k <= 1.5; k++) I += light(edge - y - k * CELL / 4, H) / 4;
          else I = light(edge - y, H);
          if (I < 0.01) continue;
          const up = smooth((v - 0.1) / 0.75), k = I * glow, i = (r * gw + c) * 3;
          acc[i] += (lr + (ur - lr) * up) * k; acc[i + 1] += (lg + (ug - lg) * up) * k; acc[i + 2] += (lb + (ub - lb) * up) * k;
        }
      }
    }
  }
  // in the dark it is laid on as light; in the light, as its colour, deepened, where it would shine
  const px = new Uint8ClampedArray(gw * gh * 4), fadeTop = 60 / CELL, fadeBot = 20 / CELL;
  for (let r = 0; r < gh; r++) {
    // it thins out at the top and toward the horizon, so it never ends on a line
    const v = Math.max(0, Math.min(1, r / fadeTop, (gh - 1 - r) / fadeBot));
    for (let c = 0; c < gw; c++) {
      const i = (r * gw + c) * 3, o = (r * gw + c) * 4, R = acc[i], G = acc[i + 1], B = acc[i + 2], m = Math.max(R, G, B);
      if (m < 0.002) continue;
      if (dark) { px[o] = R * 255; px[o + 1] = G * 255; px[o + 2] = B * 255; px[o + 3] = v * 255; }
      else { px[o] = R / m * 150; px[o + 1] = G / m * 150; px[o + 2] = B / m * 150; px[o + 3] = Math.min(1, m * 1.3) * v * 255; }
    }
  }
  return { px, gw, gh, y0, dark };
}

/** A curtain's light at h px above its lower edge, for a curtain H px tall: nothing a few px below the edge, rising
 * steeply to its brightest just above it, then fading upward. */
function light(h: number, H: number) {
  return h < 0 ? Math.exp(h / 2.5) : Math.min(1, 0.5 + h / 5) * Math.exp(-h / H * 2.4);
}

/** sRGB (0 to 1) to OKLab, and back, clamped. */
export function oklab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function srgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const gam = (c: number) => clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return [gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

/** Value noise, smooth, in [0, 1]. */
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function hash(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// in a worker: paint each job as it comes, and hand the picture back without copying it
if (typeof window === "undefined") {
  const scope = self as unknown as { onmessage: (e: MessageEvent<Job>) => void; postMessage(m: Picture, t: Transferable[]): void };
  scope.onmessage = e => { const pic = paintField(e.data); scope.postMessage(pic, [pic.px.buffer]); };
}
