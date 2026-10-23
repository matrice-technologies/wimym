// The shapes every piece is drawn from: one row per message and one per day, as typed arrays.
// Text and project names stay out of the arrays. They are looked up only for a tooltip, and never
// in share mode, so a shared still or loop carries times and shapes, nothing anyone wrote.

export const FAMILIES = ["ask", "steer", "make", "approve", "run", "ship", "think"] as const;
export type Family = (typeof FAMILIES)[number];

export interface Mind {
  synthetic: boolean;
  days: string[];            // every calendar day, first message to today
  weeks: string[];           // Mondays over the same span
  fullFrom: number;          // first day index with labels (before it, prompts only)
  n: number;                 // messages
  day: Uint16Array;          // day index of each message
  hour: Float32Array;        // hour within its day, which runs 05:00 to 05:00 (so 1:30 am is 25.5)
  project: Uint8Array;       // rank of the project by messages, 0 is the biggest
  family: Int8Array;         // index in FAMILIES, -1 when not labelled
  words: Uint16Array;
  projects: number;          // distinct projects
  perDay: DayRow[];
  /** What a tooltip may say about message i. Null in share mode, and always null for synthetic data.
   * With points, text is fetched on first ask: null until it arrives, then listen() callers hear of it. */
  detail(i: number): { text: string; project: string } | null;
  /** Hear when a lazily fetched detail arrives, to redraw a tooltip. Returns the way to stop. */
  listen?(cb: () => void): () => void;
}

/** GET /api/points (docs/contract-points.md): every message as a compact row. */
export interface PointsPayload {
  generated?: string | null; t0: number; day0: string;
  fields: string[]; rows: (number | null)[][];
  intents: string[]; origins: string[]; projects: string[];
}

// what each intent belongs to, as engine/wimym/labels.py has it
const FAMILY_OF: Record<string, Family> = {
  question: "ask", correct: "steer", build: "make", fix: "make", design: "make", "go-ahead": "approve", answer: "approve",
  ops: "run", setup: "run", ship: "ship", plan: "think", review: "think",
};

export interface DayRow {
  n: number; start: number | null; end: number | null; active: number; rest: number | null;
  projects: number; switchH: number | null; late: number; frustrated: number | null;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const noon = (s: string) => new Date(s + "T12:00:00");
export const monday = (s: string) => { const d = noon(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };

function calendar(first: string, last: string) {
  const out: string[] = [];
  for (let d = noon(first); iso(d) <= last; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}
function mondays(days: string[]) {
  const w: string[] = [];
  for (const d of days) { const m = monday(d); if (w[w.length - 1] !== m) w.push(m); }
  return w;
}

/** The fields read from the app's Message (engine /api/messages); the app's own type fits as is. */
export interface RawMessage { id: string; project: string; day: string; hour: number; kind: string; words: number; family: string | null; text: string }
/** The fields read from the app's Day (engine /api/core days). */
export interface RawDay { day: string; n: number; start?: number; end?: number; active?: number; rest?: number | null; projects?: number; switchH?: number | null; frustrated?: number | null }

/** Real data from the engine: /api/points and /api/core's days; /api/messages only for an engine without points. */
export async function loadMind(base = ""): Promise<Mind> {
  const get = (u: string) => fetch(base + u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
  const c = await get("/api/core");
  const pts = await get("/api/points").catch(() => null);
  if (pts?.rows) return mindFromPoints(pts, c.days, undefined, base);
  return mindFrom((await get("/api/messages")).messages, c.days);
}

/**
 * The shapes, from data the caller already has. isShared is asked at every tooltip, so share mode
 * can be switched on at any time and no text or project name is handed out after that.
 */
export function mindFrom(messages: readonly RawMessage[], coreDays: readonly RawDay[], isShared: () => boolean = () => share.on): Mind {
  const msgs = messages.filter(x => x.kind === "prompt");
  const first = coreDays[0]?.day ?? msgs[0]?.day ?? iso(new Date());
  const days = calendar(first, coreDays[coreDays.length - 1]?.day ?? iso(new Date()));
  const di = new Map(days.map((d, i) => [d, i]));

  const counts = new Map<string, number>();
  for (const x of msgs) counts.set(x.project, (counts.get(x.project) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const rank = new Map(ranked.map((p, i) => [p, Math.min(i, 254)]));

  const n = msgs.length;
  const day = new Uint16Array(n), hour = new Float32Array(n), project = new Uint8Array(n);
  const family = new Int8Array(n), words = new Uint16Array(n);
  let fullFrom = days.length;
  msgs.forEach((x, i) => {
    day[i] = di.get(x.day) ?? 0;
    hour[i] = x.hour;
    project[i] = rank.get(x.project) ?? 254;
    family[i] = x.family ? FAMILIES.indexOf(x.family as Family) : -1;
    if (family[i] >= 0 && day[i] < fullFrom) fullFrom = day[i];
    words[i] = Math.min(65535, x.words || 0);
  });

  const byDay = new Map(coreDays.map(d => [d.day, d]));
  const late = new Uint16Array(days.length);
  for (let i = 0; i < n; i++) if (hour[i] >= 23) late[day[i]]++;
  const perDay: DayRow[] = days.map((d, i) => {
    const r = byDay.get(d);
    if (!r || !r.n) return { n: 0, start: null, end: null, active: 0, rest: r?.rest ?? null, projects: 0, switchH: null, late: 0, frustrated: null };
    return { n: r.n, start: r.start ?? null, end: r.end ?? null, active: r.active ?? 0, rest: r.rest ?? null, projects: r.projects ?? 0,
      switchH: r.switchH ?? null, late: late[i], frustrated: r.frustrated ?? null };
  });

  return {
    synthetic: false, days, weeks: mondays(days), fullFrom, n, day, hour, project, family, words, projects: ranked.length, perDay,
    detail: i => (isShared() ? null : { text: msgs[i].text, project: msgs[i].project }),
  };
}

/**
 * The shapes from /api/points, without the 19 MB of /api/messages. Days come from /api/core when
 * given (for nights and active hours); otherwise from the points themselves. Message text is fetched
 * one message at a time, on hover, from /api/points?ids=1 and /api/message/<id>, never in share mode.
 */
export function mindFromPoints(pts: PointsPayload, coreDays?: readonly RawDay[] | null, isShared: () => boolean = () => share.on, base = ""): Mind {
  const F = (name: string) => pts.fields.indexOf(name);
  const fDay = F("day"), fHour = F("hour"), fIntent = F("intent"), fProject = F("project");
  const rows = pts.rows, n = rows.length;
  let last = 0;
  for (const r of rows) last = Math.max(last, r[fDay] as number);
  // the calendar runs to today (the day of `generated`, which starts at 05:00), or to core's last day
  const gen = pts.generated ? new Date(new Date(pts.generated).getTime() - 5 * 3600e3) : null;
  const end = coreDays?.length ? coreDays[coreDays.length - 1].day : gen ? iso(gen) : null;
  let days = calendar(pts.day0, end ?? pts.day0);
  if (days.length < last + 1) days = calendar(pts.day0, iso(new Date(noon(pts.day0).getTime() + last * 864e5)));

  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r[fProject] as number, (counts.get(r[fProject] as number) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const rank = new Map(ranked.map((p, i) => [p, Math.min(i, 254)]));

  const day = new Uint16Array(n), hour = new Float32Array(n), project = new Uint8Array(n);
  const family = new Int8Array(n), words = new Uint16Array(n).fill(12);   // points carry no length; every star the same weight
  let fullFrom = days.length;
  rows.forEach((r, i) => {
    day[i] = r[fDay] as number;
    hour[i] = r[fHour] as number;
    project[i] = rank.get(r[fProject] as number) ?? 254;
    const intent = r[fIntent] == null ? null : pts.intents[r[fIntent] as number];
    family[i] = intent && FAMILY_OF[intent] ? FAMILIES.indexOf(FAMILY_OF[intent]) : -1;
    if (family[i] >= 0 && day[i] < fullFrom) fullFrom = day[i];
  });

  const late = new Uint16Array(days.length);
  for (let i = 0; i < n; i++) if (hour[i] >= 23) late[day[i]]++;
  let perDay: DayRow[];
  if (coreDays?.length) {
    const byDay = new Map(coreDays.map(d => [d.day, d]));
    perDay = days.map((d, i) => {
      const r = byDay.get(d);
      if (!r || !r.n) return { n: 0, start: null, end: null, active: 0, rest: r?.rest ?? null, projects: 0, switchH: null, late: 0, frustrated: null };
      return { n: r.n, start: r.start ?? null, end: r.end ?? null, active: r.active ?? 0, rest: r.rest ?? null, projects: r.projects ?? 0,
        switchH: r.switchH ?? null, late: late[i], frustrated: r.frustrated ?? null };
    });
  } else {
    // the days from the points: first and last message, active time in blocks with no gap over 20 minutes
    const by: number[][] = days.map(() => []);
    for (let i = 0; i < n; i++) by[day[i]].push(i);
    let prevEnd: number | null = null;
    perDay = by.map(ix => {
      if (!ix.length) { prevEnd = null; return { n: 0, start: null, end: null, active: 0, rest: null, projects: 0, switchH: null, late: 0, frustrated: null }; }
      const hs = ix.map(i => hour[i]).sort((a, b) => a - b);
      let active = 0, b0 = hs[0];
      for (let k = 1; k <= hs.length; k++) if (k === hs.length || hs[k] - hs[k - 1] > 1 / 3) { active += hs[k - 1] - b0 + 1 / 12; b0 = hs[k]; }
      const start = hs[0], endH = hs[hs.length - 1];
      const rest = prevEnd == null ? null : 24 - prevEnd + start;
      prevEnd = endH;
      return { n: ix.length, start, end: endH, active, rest, projects: new Set(ix.map(i => project[i])).size, switchH: null,
        late: ix.filter(i => hour[i] >= 23).length, frustrated: null };
    });
  }

  // text on demand: the ids once, then each message as it is pointed at
  const text = new Map<number, string>(), asked = new Set<number>(), listeners = new Set<() => void>();
  let ids: Promise<string[]> | null = null;
  const fetchText = (i: number) => {
    if (asked.has(i)) return;
    asked.add(i);
    ids ??= fetch(base + "/api/points?ids=1").then(r => r.json()).then(j => j.ids as string[]);
    ids.then(list => fetch(base + "/api/message/" + encodeURIComponent(list[i])))
      .then(r => r.json()).then(j => { text.set(i, String((j.data ?? j).text ?? "")); listeners.forEach(f => f()); })
      .catch(() => asked.delete(i));
  };
  return {
    synthetic: false, days, weeks: mondays(days), fullFrom, n, day, hour, project, family, words, projects: ranked.length, perDay,
    detail: i => {
      if (isShared()) return null;
      const t = text.get(i);
      if (t == null) { fetchText(i); return null; }
      return { text: t, project: pts.projects[rows[i][fProject] as number] ?? "" };
    },
    listen: cb => { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

/** Share mode, read by detail() and by every piece's captions. Set from ?share=1 or the P key. */
export const share = { on: new URLSearchParams(location.search).has("share") };

// ---------- synthetic: a believable person who never existed ----------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Seven months of someone who starts calm and slowly takes on more: longer days, fewer days off,
 * more projects at once, a few late nights near the end. For demos, so nothing real is shown.
 */
export function syntheticMind(seed = 7): Mind {
  const R = rng(seed);
  const gauss = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const today = new Date(); const start = new Date(today); start.setDate(start.getDate() - 213);
  const days = calendar(iso(start), iso(today));
  const D = days.length;
  // projects as eras: each rises, holds and fades
  const P = 14;
  const eras = Array.from({ length: P }, (_, p) => {
    const c = p === 0 ? D * 0.35 : R() * D * 1.05;
    return { c, w: (p === 0 ? 0.45 : 0.06 + R() * 0.22) * D, wt: p === 0 ? 3 : 0.4 + R() * 1.6 };
  });
  const H: number[] = [], Dy: number[] = [], Pr: number[] = [], F: number[] = [], W: number[] = [];
  const perDay: DayRow[] = [];
  let lastEnd: number | null = null;
  for (let d = 0; d < D; d++) {
    const p = d / D;  // 0 → 1: escalation
    const dow = (noon(days[d]).getDay() + 6) % 7;
    const off = (dow === 6 && R() < 0.8 - p * 0.6) || (dow === 5 && R() < 0.35 - p * 0.3) || R() < 0.02;
    if (off) { perDay.push({ n: 0, start: null, end: null, active: 0, rest: null, projects: 0, switchH: null, late: 0, frustrated: null }); continue; }
    const s0 = 8.6 + gauss() * 0.7 - p * 0.6;
    const e0 = Math.min(28.5, 20.5 + p * 2.2 + gauss() * 1.1 + (R() < 0.08 + p * 0.12 ? 2 + R() * 2 : 0));
    const count = Math.max(6, Math.round((30 + p * 85) * (0.6 + R() * 0.8)));
    const weights = eras.map(e => e.wt * Math.exp(-(((d - e.c) / e.w) ** 2)));
    const tot = weights.reduce((a, b) => a + b, 0) || 1;
    const used = new Set<number>();
    let late = 0;
    for (let k = 0; k < count; k++) {
      // the day has a lunch dip and a dinner dip
      let h = s0 + R() * (e0 - s0);
      if (Math.abs(h - 13) < 0.6 && R() < 0.7) h += 1.2;
      if (Math.abs(h - 19.3) < 0.8 && R() < 0.75) h += 1.6;
      h = Math.min(h, e0);
      let r = R() * tot, pr = 0;
      for (; pr < P - 1; pr++) { r -= weights[pr]; if (r <= 0) break; }
      used.add(pr);
      H.push(h); Dy.push(d); Pr.push(pr); F.push(Math.floor(R() * 7)); W.push(Math.max(1, Math.round(Math.exp(2.4 + gauss() * 1.1))));
      if (h >= 23) late++;
    }
    const rest = lastEnd == null ? null : 24 - lastEnd + s0;
    lastEnd = e0;
    perDay.push({ n: count, start: s0, end: e0, active: (e0 - s0) * (0.68 + R() * 0.12), rest, projects: used.size,
      switchH: 2 + used.size * 0.9 + gauss(), late, frustrated: Math.max(0, 3 + p * 6 + gauss() * 2) });
  }
  // sort by time so the arrays read like the real ones
  const order = H.map((_, i) => i).sort((a, b) => Dy[a] - Dy[b] || H[a] - H[b]);
  const n = order.length;
  const pick = <T extends Uint16Array | Float32Array | Uint8Array | Int8Array>(arr: T, src: number[]) => { order.forEach((o, i) => (arr[i] = src[o])); return arr; };
  return {
    synthetic: true, days, weeks: mondays(days), fullFrom: 0, n,
    day: pick(new Uint16Array(n), Dy), hour: pick(new Float32Array(n), H), project: pick(new Uint8Array(n), Pr),
    family: pick(new Int8Array(n), F), words: pick(new Uint16Array(n), W), projects: P, perDay, detail: () => null,
  };
}

/** Real data unless ?demo is in the URL; falls back to synthetic when the engine can't be reached. */
export async function getMind(): Promise<Mind> {
  if (new URLSearchParams(location.search).has("demo")) return syntheticMind();
  try { return await loadMind(); } catch (e) { console.warn("engine not reachable, showing synthetic data", e); return syntheticMind(); }
}

/** Synthetic data in the engine's own shapes, so the hero can be shown on someone who never existed. */
export function syntheticData(seed = 7): { messages: RawMessage[]; days: RawDay[] } {
  const m = syntheticMind(seed);
  const messages: RawMessage[] = Array.from({ length: m.n }, (_, i) => ({
    id: `syn-${i}`, project: `Project ${m.project[i] + 1}`, day: m.days[m.day[i]], hour: m.hour[i], kind: "prompt",
    words: m.words[i], family: m.family[i] >= 0 ? FAMILIES[m.family[i]] : null, text: "",
  }));
  const days: RawDay[] = m.days.map((day, i) => {
    const r = m.perDay[i];
    return { day, n: r.n, start: r.start ?? undefined, end: r.end ?? undefined, active: r.active, rest: r.rest, projects: r.projects, switchH: r.switchH, frustrated: r.frustrated };
  });
  return { messages, days };
}
