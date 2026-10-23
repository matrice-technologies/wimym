// A week's vital signs, read against the person's own range, as a form and as words.
// Every sign is measured in widths of its usual range (the 8 weeks before, docs/contract-week.md):
// inside the range is 0, so a week inside every range is the calm, round form.
import { CALM, type FormShape } from "../src/pieces/form";

/** GET /api/week (docs/contract-week.md): the fields read here. */
export interface WeekPayload {
  week: string;
  complete?: boolean;
  summary?: string | null;
  vitals: { key: string; label?: string; unit?: string; better?: string | null; value: number | null; band: { lo: number; mid: number; hi: number } | null; side?: string | null }[];
  days?: unknown[];
}

/** How far outside its usual range a sign is: + above, - below, 0 inside or unknown. In widths of the range. */
function outside(w: WeekPayload, key: string) {
  const v = w.vitals.find(x => x.key === key);
  if (!v || v.value == null || !v.band) return { v: null as number | null, out: 0, lo: 0, hi: 0 };
  const { lo, mid, hi } = v.band, width = Math.max(hi - lo, Math.abs(mid) * 0.12, 0.05);
  const out = v.value > hi ? (v.value - hi) / width : v.value < lo ? (v.value - lo) / width : 0;
  return { v: v.value, out: Math.max(-3, Math.min(3, out)), lo, hi };
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** The form for a week. */
export function weekShape(w: WeekPayload | null): FormShape {
  if (!w) return { ...CALM };
  const sw = outside(w, "switches"), pk = outside(w, "peak"), night = outside(w, "night"), strain = outside(w, "strain");
  const streak = outside(w, "streak"), stretch = outside(w, "stretch"), load = outside(w, "load");
  const up = (x: number) => Math.max(0, x), down = (x: number) => Math.max(0, -x);
  const scatter = up(sw.out) + 0.6 * up(pk.out);
  const fray = down(night.out) + up(strain.out);
  return {
    core: clamp(0.36 + 0.42 * clamp((stretch.v ?? 0.9) / 1.2, 0, 1.3) + 0.06 * stretch.out, 0.4, 0.9),
    lobes: clamp(Math.round(pk.v ?? 3), 1, 10),
    spread: clamp(0.14 + 0.55 * scatter + 0.03 * (sw.v ?? 6), 0.1, 1.6),
    k: clamp(0.78 - 0.3 * scatter, 0.12, 0.8),
    noise: clamp(0.022 + 0.07 * fray + 0.02 * up(load.out), 0.02, 0.22),
    flow: clamp(0.12 + 0.3 * fray, 0.1, 0.9),
    breath: clamp(0.1 + 0.035 * load.out, 0.06, 0.2),
    pulse: clamp(0.012 + 0.03 * up(streak.out), 0, 0.08),
    beat: clamp(0.85 - 0.12 * up(streak.out), 0.5, 0.9),
    warm: clamp((scatter + fray + 0.5 * up(streak.out) + up(load.out) + down(stretch.out) * 0.5) / 2.6, 0, 1),
  };
}

const n0 = (x: number) => String(Math.round(x));
const n1 = (x: number) => (Math.abs(x) >= 10 ? String(Math.round(x)) : x.toFixed(1));
const range = (lo: number, hi: number, f: (x: number) => string) => (f(lo) === f(hi) ? f(lo) : `${f(lo)} to ${f(hi)}`);

/** Which signs shape the form, strongest first: a line, and the next one or two. */
export function weekCaption(w: WeekPayload | null): { line: string; sub: string } {
  if (!w) return { line: "", sub: "" };
  type S = { out: number; text: string };
  const said: S[] = [];
  const add = (key: string, f: (x: number) => string, above: string | null, below: string | null) => {
    const s = outside(w, key);
    if (!s.out || s.v == null) return;
    const t = s.out > 0 ? above : below;
    if (t) said.push({ out: Math.abs(s.out), text: t.replace("{v}", f(s.v)).replace("{usual}", range(s.lo, s.hi, f)) });
  };
  add("switches", n1, "Fragmented: {v} session changes an hour, your usual is {usual}.", "Gathered: {v} session changes an hour, your usual is {usual}.");
  add("peak", n0, "Split: {v} sessions at once, your usual is {usual}.", "Single-minded: {v} sessions at once at most, your usual is {usual}.");
  add("night", n1, "Rested: nights of {v} hours, your usual is {usual}.", "Restless: nights of {v} hours, your usual is {usual}.");
  add("strain", n0, "Frayed: {v}% of your messages corrected Claude or sounded frustrated, your usual is {usual}%.", "Smooth: {v}% of your messages corrected Claude or sounded frustrated, your usual is {usual}%.");
  add("streak", n0, "A slow, heavy pulse: {v} days in a row, your usual run is {usual}.", null);
  add("stretch", n1, "A deep core: your longest stretch on one project was {v} hours, your usual is {usual}.", "Thin at the core: your longest stretch on one project was {v} hours, your usual is {usual}.");
  add("load", n0, "Swollen: {v} hours of work, your usual is {usual}.", "Light: {v} hours of work, your usual is {usual}.");
  said.sort((a, b) => b.out - a.out);
  if (!said.length) return { line: "Calm: every sign inside your usual range.", sub: "" };
  return { line: said[0].text, sub: said.slice(1, 3).map(s => s.text).join(" ") };
}
