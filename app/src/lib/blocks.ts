// Work blocks as the contract defines them: a run of your messages with no gap over 20 minutes,
// each counted from its first message to its last plus 5 minutes. Times are hours on any axis.
import type { Message } from "./types";

export const GAP = 20 / 60, TAIL = 5 / 60, DAY0 = 5;
export interface Block { a: number; b: number; day: string; n: number; projects: Set<string>; first: Message }

/** Hours since 05:00 on the message's own day (the engine's day runs 05:00 to 05:00). */
export const dayHour = (m: Message) => (m.hour < DAY0 ? m.hour + 24 : m.hour) - DAY0;

export function blocksOf(timed: { m: Message; t: number }[]): Block[] {
  const out: Block[] = [];
  for (const { m, t } of [...timed].sort((x, y) => x.t - y.t)) {
    const last = out[out.length - 1];
    if (last && t - (last.b - TAIL) <= GAP) { last.b = t + TAIL; last.n++; last.projects.add(m.project); }
    else out.push({ a: t, b: t + TAIL, day: m.day, n: 1, projects: new Set([m.project]), first: m });
  }
  return out;
}

/** Your usual day: the median first and last message over the eight weeks before `mon`. */
export function usualDay(days: { day: string; n: number; start?: number; end?: number }[], mon: string) {
  const from = new Date(new Date(mon + "T12:00:00").getTime() - 56 * 864e5).toISOString().slice(0, 10);
  const ds = days.filter(d => d.n && d.day >= from && d.day < mon && d.start != null && d.end != null);
  if (ds.length < 7) return null;
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  return { start: med(ds.map(d => d.start!)), end: med(ds.map(d => d.end!)) };
}
