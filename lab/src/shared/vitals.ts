// The week's vital signs, each read against the person's own range (docs/contract-vitals.md).
// From /api/vitals when the engine has it; otherwise worked out from the days the same way, so
// synthetic data and older engines still give the organism something true to breathe with.
import type { Mind } from "./data";

export interface Sign { value: number | null; lo: number | null; mid: number | null; hi: number | null; stress: number }
export interface WeekSigns {
  week: string;
  load: Sign;      // active hours
  night: Sign;     // median night, hours
  switches: Sign;  // switches between sessions an hour
  peak: Sign;      // most sessions at once
  stretch: Sign;   // longest stretch on one project, hours
  strain: Sign;    // share of messages showing strain
}
export const SIGN_KEYS = ["load", "night", "switches", "peak", "stretch", "strain"] as const;
type Key = (typeof SIGN_KEYS)[number];
// which way is worse, for the stress score: +1 when more is worse
const WORSE: Record<Key, number> = { load: 1, night: -1, switches: 1, peak: 1, stretch: -1, strain: 1 };

interface ApiMeasure { key: string; weekly: (number | null)[]; band: ({ lo: number; mid: number; hi: number } | null)[] }

/** How far a value sits outside the usual range, in widths of that range, signed so that more is worse. */
function stress(key: Key, v: number | null, lo: number | null, mid: number | null, hi: number | null) {
  if (v == null || mid == null || lo == null || hi == null) return 0;
  const width = Math.max(hi - lo, Math.abs(mid) * 0.12, 0.05);
  const outside = v > hi ? (v - hi) / width : v < lo ? (v - lo) / width : 0;
  return Math.max(-2, Math.min(2.5, outside * WORSE[key]));
}

function quartiles(xs: number[]) {
  const s = xs.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length < 4) return null;
  const q = (p: number) => { const i = (s.length - 1) * p, f = Math.floor(i); return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (i - f); };
  return { lo: q(0.25), mid: q(0.5), hi: q(0.75) };
}

function build(weeks: string[], weekly: Record<Key, (number | null)[]>, band: Record<Key, ({ lo: number; mid: number; hi: number } | null)[]>): WeekSigns[] {
  return weeks.map((week, w) => {
    const out = { week } as WeekSigns;
    for (const k of SIGN_KEYS) {
      const v = weekly[k][w] ?? null;
      // before there are four weeks to compare with, compare with every week there is
      const b = band[k][w] ?? quartiles(weekly[k].filter((x): x is number => x != null));
      out[k] = { value: v, lo: b?.lo ?? null, mid: b?.mid ?? null, hi: b?.hi ?? null, stress: stress(k, v, b?.lo ?? null, b?.mid ?? null, b?.hi ?? null) };
    }
    return out;
  });
}

export async function loadSigns(mind: Mind): Promise<WeekSigns[]> {
  if (!mind.synthetic) {
    try {
      const r = await fetch("/api/vitals");
      if (r.ok) {
        const v = await r.json();
        const by = new Map<string, ApiMeasure>((v.measures as ApiMeasure[]).map(m => [m.key, m]));
        const weekly = {} as Record<Key, (number | null)[]>, band = {} as Record<Key, ({ lo: number; mid: number; hi: number } | null)[]>;
        for (const k of SIGN_KEYS) {
          const m = by.get(k);
          weekly[k] = m?.weekly ?? v.weeks.map(() => null);
          band[k] = m?.band ?? v.weeks.map(() => null);
        }
        return build(v.weeks, weekly, band);
      }
    } catch { /* fall through to the days */ }
  }
  return signsFromDays(mind);
}

/** The same signs from the days alone, with the range taken from the eight weeks before, as the engine does. */
export function signsFromDays(mind: Mind): WeekSigns[] {
  const W = mind.weeks.length, wi = new Map(mind.weeks.map((w, i) => [w, i]));
  const monday = (s: string) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const per: { active: number[]; rest: number[]; sw: number[]; proj: number[]; fr: number[] }[] = Array.from({ length: W }, () => ({ active: [], rest: [], sw: [], proj: [], fr: [] }));
  mind.perDay.forEach((d, i) => {
    const w = wi.get(monday(mind.days[i]));
    if (w == null) return;
    per[w].active.push(d.active);
    if (d.n && d.rest != null) per[w].rest.push(d.rest);
    if (d.switchH != null) per[w].sw.push(d.switchH);
    if (d.n) per[w].proj.push(d.projects);
    if (d.frustrated != null) per[w].fr.push(d.frustrated);
  });
  const med = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : null);
  const weekly: Record<Key, (number | null)[]> = {
    load: per.map(p => p.active.reduce((a, b) => a + b, 0)),
    night: per.map(p => med(p.rest)),
    switches: per.map(p => med(p.sw)),
    peak: per.map(p => (p.proj.length ? Math.max(...p.proj) : null)),
    stretch: per.map(() => null),
    strain: per.map(p => med(p.fr)),
  };
  const band = {} as Record<Key, ({ lo: number; mid: number; hi: number } | null)[]>;
  for (const k of SIGN_KEYS) band[k] = weekly[k].map((_, w) => quartiles(weekly[k].slice(Math.max(0, w - 8), w).filter((x): x is number => x != null)));
  return build(mind.weeks, weekly, band);
}
