// What the engine (engine/wimym/model.py) sends.

export type Family = "ask" | "steer" | "make" | "approve" | "run" | "ship" | "think";

export interface Message {
  id: string; sid: string; project: string; ts: string; day: string; hour: number; dow: number;
  src: "desk" | "massistant"; kind: "prompt" | "shell" | "command";
  words: number; chars: number; images: number; pasted: number; text: string; lang: "en" | "fr" | null;
  typos: number; checked: number;
  intent: string | null; family: Family | null; tone: "neutral" | "pleased" | "frustrated" | null; specific: boolean | null;
  own: boolean | null; who: string | null; scope: string | null; pressure: boolean | null; irk: string | null; play: boolean | null;
  dur: number; wait1: number | null; tools: number; cat: Record<string, number>; files: number; add: number; del: number;
  commits: number; pushes: number; prs: number; out: number; ctx: number; stopped: boolean; model: string | null;
  effort: string | null; thinkMs: number; mode: string | null; asked: number; auto: number; denied: number; blocked: number;
  fail: number; agents: number; spawn: number; questions: number;
  first: boolean; gap: number | null; queued: boolean; after: "answered" | "changed" | "shipped" | "stopped" | null;
  claudeAsked: boolean; next: string | null; nextGap: number | null;
  origin?: "transcript" | "history";
  readWords?: number | null;  // words in Claude's reply before this message
  // readings by a model (the acts labels), not checked yet; absent until labelled
  decides?: boolean | null; decision?: string | null; defers?: boolean | null; putOff?: string | null;
  withPeople?: boolean | null; people?: string[] | string | null; selfState?: string | null; handsOver?: boolean | null;
  rule?: string | null; domain?: string | null; notDone?: boolean | string | null;  // history: a prompt from history.jsonl, with no reply or tools (null, not zero)
}

export interface Check { energy?: number; mood?: number; focus?: number; note?: string }

export interface Day {
  day: string; dow: number; n: number; streak: number;
  start?: number; end?: number; span?: number; active?: number; breaks?: number; stretch?: number; late?: boolean; rest?: number | null;
  projects?: number; top?: string; sessions?: number; switchH?: number | null; labelled?: number; fam?: Partial<Record<Family, number>>;
  goahead?: number | null; correct?: number | null; specific?: number | null; frustrated?: number | null; pleased?: number | null;
  words?: number | null; typos?: number | null; french?: number | null; voice?: number; stopped?: number; queued?: number;
  commits?: number; prs?: number; lines?: number; files?: number; tools?: number;
  peak?: number; avgAt?: number | null; sessionH?: number; peakAll?: number; subPeak?: number;
  claudeH?: number; autoTurns?: number; out?: number; cost?: number | null; check?: Check;
  sig?: number; own?: number | null; handed?: number | null; irkClaude?: number | null;
}

export interface Week {
  week: string; days: number; off: number; n: number; labelled: number; fam: Record<Family, number>; intents: Record<string, number>;
  span: number | null; start: number | null; end: number | null; projects: number | null; avgAt: number | null; peak: number;
  words: number | null; tools: number | null; specific: number | null; frustrated: number | null; pleased: number | null;
  correct: number | null; goahead: number | null; french: number | null; stopped: number | null;
  commits: number; lines: number; prs: number; claudeH: number; cost: number; late: number; reply: number | null;
  sig: number; own: number; who: Record<string, number>; scope: Record<string, number>; irk: Record<string, number>; play: number; pressure: number;
}

export interface Trait {
  key: string; group: "lead" | "attention" | "rhythm" | "voice" | "output"; name: string;
  value: number | null; unit: string; recent: number | null; before: number | null;
  series: [string, number | null][]; sentence: string; detail: Record<string, number>;
}

export interface Coverage { labelled: number; of: number; version: number | null; covered: boolean }

export interface Profile {
  /** Set alone, with none of the fields below, when there are no messages of yours yet. */
  empty?: true;
  since: string; until: string; recentFrom: string; fullFrom?: string;
  coverage: { categories: Coverage; signals: Coverage };
  totals: Record<string, number>;
  families: { key: Family; name: string; intents: string[]; share: number; recent: number; before: number }[];
  intents: { key: string; name: string; family: Family; n: number }[];
  traits: Trait[];
  eras: { project: string; from: string; to: string; n: number; weeks: number; share: number }[];
  firsts: { key: string; label: string; day: string; value: string | null; id: string | null }[];
  typos: [string, number][];
}

export interface Project {
  project: string; n: number; first: string; last: string; days: number; sessions: number; fam: Partial<Record<Family, number>>;
  tools: number; commits: number; prs: number; lines: number; claudeH: number; words: number | null; frustrated: number | null;
  weekly: number[]; cost: number;
}

export interface Session {
  sid: string; project: string; title: string | null; kind: "you" | "side" | "auto"; spans: [number, number][];
  start: string | null; end: string | null; turns: number; mine: number; tools: number; out: number; cost: number | null;
  subs: number; entry: string | null; model: string | null; first: string | null; ex: string;
  // the session's account (sessions labels), a model's reading, absent until labelled
  goal?: string | null; outcome?: "landed" | "partial" | "abandoned" | "answered" | string | null; decisions?: string[]; open?: string[];
  rework?: boolean | null; redone?: string | null; people?: string[]; account?: string | null;
}

export interface Note {
  name: string; desc: string; type: string; project: string; mtime: number; body: string; file: string; reads: number;
  written: string | null; taught: { id: string; text: string; day: string; intent: string | null; family: Family | null } | null;
}
export interface Memory { counts: Record<string, number>; notes: Note[]; projects: number; total: number; reads: number }

export interface Core { generated: string; profile: Profile; days: Day[]; weeks: Week[]; projects: Project[]; memory: Memory }

export interface DayTurn {
  id: string; sid: string; project: string; src: string; kind: string; at: number; to: number; tools: number; commits: number;
  prs: number; stopped: boolean; files: number; lines: number; mine: boolean; family: Family | null; intent: string | null;
  tone: string | null; text: string;
  own?: boolean | null; who?: string | null; scope?: string | null; pressure?: boolean | null; irk?: string | null; play?: boolean | null;
}
export interface DayDetail {
  day: string; row: Day | null; turns: DayTurn[]; curve: [number, number, number][];
  sessions: { sid: string; project: string; title: string | null; kind: string; ex: string; model: string | null; subs: number }[];
}
export interface MessageDetail {
  id: string; text: string; own: string; reply: string; files: string[]; sid: string; cwd: string; title: string | null; truncated: boolean;
  skills: string[]; perm: Record<string, number>;
}

// GET /api/labels: what the labels mean, how they were made, how far to trust them.
export interface Ratio { k: number; n: number; ci: [number, number] | null }
export interface LabelValue {
  key: string; name: string; meaning: string; rule: string | null; n: number; share: number | null;
  examples: { id: string; text: string; day: string }[];
}
export interface LabelField {
  set: "categories" | "signals"; key: string; msg: keyof Message; name: string; plain: string; rule: string | null;
  labelled: number; of: number; values: LabelValue[]; used: string[];
  audit: { v: number; unclear: number; random: Ratio; values: Record<string, Ratio>; now: Ratio | null;
    wrong: { id: string; was: string; fix: string | null; why: string | null; text: string }[] } | null;
  biases: { text: string; status: "better" | "rule" | "still" }[];
  rerun: { agree: number; note: string } | null;
}
export interface LabelSet {
  key: "categories" | "signals"; name: string; about: string; version: number | null; labelled: number; of: number;
  changes: { v: number; text: string }[]; notes: string[];
  made: { model: string; calls: number; messages: number; usd: number; from: string | null; to: string | null; allUsd: number; thisVersionOnly: boolean } | null;
}
export interface LabelsPage {
  generated: string; sets: LabelSet[]; fields: LabelField[]; notTyped: number; covered: number;
  /** All null until a second judge has audited the labels. */
  audit: { by: string | null; model: string | null; at: string | null; marks: number; cards: number };
}

// GET /api/vitals: the vital signs, as docs/contract-vitals.md sets them out.
export type MeasureUnit = "h" | "min" | "days" | "%" | "count" | "perh";
export interface Band { lo: number; mid: number; hi: number }
export interface Measure {
  key: string; goal: string; label: string; question: string; unit: MeasureUnit; better: "higher" | "lower" | null;
  daily?: (number | null)[]; weekly: (number | null)[]; band: (Band | null)[]; now: number | null;
  flag: "above" | "below" | null; sentence: string | null; status: "ok" | "partial" | "missing"; note: string | null;
  since: string | null; evidence: { messages: string[] };
}
export interface Goal { key: string; label: string; group: "health" | "performance"; measures: string[] }
export interface Vitals {
  asof: string;
  coverage: { full_from: string | null; prompts_from: string; git: boolean };
  days: string[]; weeks: string[];
  limits: { stopHour: number | null; daysOffPerWeek: number | null; maxSessions: number | null; priorities?: string[] | null };
  goals: Goal[]; measures: Measure[];
}

// GET /api/week?start=YYYY-MM-DD: one week for the retro, as docs/contract-week.md sets it out.
export interface WeekBlock { from: number; to: number; messages: number; id: string }  // hours since midnight; 25.5 is 01:30 next morning
export interface WeekDay {
  day: string; dow: number; messages: number; off: boolean; night: number | null; landed: number | null;
  first?: number; last?: number; active?: number; blocks?: WeekBlock[]; stretch?: number; switches?: number; late?: number | null;
  projects?: Record<string, number>; sessions?: number; unread?: number | null; stopped?: number | null; corrections?: number; history?: number;
  account?: string | null;  // a few plain sentences about the day, citing messages as [id8]; a model's reading
}
export interface WeekMoment {
  key?: string; title?: string; about?: string; question?: string;  // the engine's words for the retro, when it has them
  kind: string; day: string | null; reason: string; messages: string[]; value: number | null; unusual: number | null;
  branches?: { project: string; name: string; ahead: number; last: string }[];
}
export interface WeekVital {
  key: string; goal: string; label: string; unit: MeasureUnit; better: "higher" | "lower" | null; value: number | null;
  band: Band | null; side: "above" | "below" | null; status: "ok" | "partial" | "missing"; note: string | null;
  flag?: "above" | "below" | null; sentence?: string | null;
}
export interface WeekPage { week: string; complete: boolean; summary?: string | null; figures?: string | null;
  account?: { account?: string | null } | null; more?: Record<string, WeekMoment[]>; vitals: WeekVital[]; days: WeekDay[]; moments: WeekMoment[] }

// GET /api/points: every message as a compact row, for drawing (docs/contract-points.md); the type is the lab's.
export type { PointsPayload as Points } from "@wimym/hero";
