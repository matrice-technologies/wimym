import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { redact, shareOn } from "./share";
import type { Core, DayDetail, LabelsPage, Message, MessageDetail, Points, Session, Vitals, WeekPage } from "./types";

/** What the engine is doing (docs/contract-state.md): a first-run screen reads label, first and found. */
export interface EngineState {
  phase: "starting" | "indexing" | "history" | "measuring" | "git" | "ready" | "error"; label?: string; done: number; total: number; first?: boolean; error?: string | null;
  found?: { conversations?: number; messages?: number; firstDay?: string | null; history?: number; repos?: number; commits?: number };
}

/** Whether a newer Wimym is out, or the engine runs older code than its folder (docs/contract-state.md). */
export interface Update { available: boolean; restart: boolean; checked: string | null; command: string; restartCommand: string }

interface Data {
  core: Core | null;
  /** Every message (19 MB raw): null until a page asks for it with useMessages(). */
  messages: Message[] | null;
  sessions: Session[] | null;
  state: EngineState | null;
  update: Update | null;
  byId: Map<string, Message>;
  reload: () => void;
  want: (what: "messages" | "sessions") => void;
}

// Kept across hot reloads of this file, so a provider made before a reload still serves consumers made after it.
const hot = import.meta.hot?.data as { ctx?: React.Context<Data | null> } | undefined;
const Ctx = hot?.ctx ?? createContext<Data | null>(null);
if (hot) hot.ctx = Ctx;

/** Until the engine's first build ends, data endpoints answer {"state", "data": null}: not an answer yet. */
class NotReady extends Error {}
async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const j = await r.json();
  if (j && typeof j === "object" && "data" in j && j.data === null && "state" in j) throw new NotReady(path);
  return redact(j);
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [core, setCore] = useState<Core | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [gen, setGen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [wanted, setWanted] = useState({ messages: false, sessions: false });

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/state", { cache: "no-store" });
        const s = (await r.json()) as { state: EngineState; generated: string | null; update?: Update };
        if (stop) return;
        setState(s.state);
        setUpdate(u => (JSON.stringify(u) === JSON.stringify(s.update ?? null) ? u : s.update ?? null));
        if (s.generated && s.generated !== gen) setGen(s.generated);
      } catch { /* engine restarting */ }
    };
    poll();
    // every half second while the first build runs (the first-run show follows it), else every 20 s
    const t = setInterval(poll, gen && !state?.first ? 20000 : 500);
    return () => { stop = true; clearInterval(t); };
  }, [gen, state?.first]);

  useEffect(() => {
    if (!gen) return;
    get<Core>("/api/core").then(setCore).catch(() => {});
  }, [gen, tick]);
  useEffect(() => {
    if (gen && wanted.messages) get<{ messages: Message[] }>("/api/messages").then(d => setMessages(d.messages)).catch(() => {});
  }, [gen, tick, wanted.messages]);
  useEffect(() => {
    if (gen && wanted.sessions) get<{ sessions: Session[] }>("/api/sessions").then(d => setSessions(d.sessions)).catch(() => {});
  }, [gen, tick, wanted.sessions]);

  const byId = useMemo(() => new Map((messages || []).map(m => [m.id, m])), [messages]);
  const want = useCallback((what: "messages" | "sessions") => setWanted(w => (w[what] ? w : { ...w, [what]: true })), []);
  const value = useMemo(() => ({ core, messages, sessions, state, update, byId, reload: () => setTick(t => t + 1), want }), [core, messages, sessions, state, update, byId, want]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Every message, loaded the first time a page asks (the front page draws from /api/points instead). */
export function useMessages() {
  const d = useData();
  useEffect(() => d.want("messages"), [d.want]);
  return { messages: d.messages, byId: d.byId };
}

/** Every session, loaded the first time a page asks. */
export function useSessions() {
  const d = useData();
  useEffect(() => d.want("sessions"), [d.want]);
  return d.sessions;
}

export function useData() {
  const d = useContext(Ctx);
  if (!d) throw new Error("useData outside DataProvider");
  return d;
}

export function useDay(day: string | undefined) {
  const [d, setD] = useState<DayDetail | null>(null);
  useEffect(() => {
    setD(null);
    if (day) get<DayDetail>(`/api/day/${day}`).then(setD).catch(() => setD(null));
  }, [day]);
  return d;
}

/** The labels page's data: asked for when the page opens, and again when the engine rebuilds. */
export function useLabels() {
  const { core } = useData();
  const [d, setD] = useState<LabelsPage | null>(null);
  useEffect(() => { get<LabelsPage>("/api/labels").then(setD).catch(() => setD(null)); }, [core?.generated]);
  return d;
}

export function useMessageDetail(id: string | null) {
  const [d, setD] = useState<MessageDetail | null>(null);
  useEffect(() => {
    setD(null);
    if (id) get<MessageDetail>(`/api/message/${encodeURIComponent(id)}`).then(setD).catch(() => setD(null));
  }, [id]);
  return d;
}

export async function saveCheckin(body: Record<string, unknown>) {
  if (shareOn) throw new Error("Share mode is on: nothing can be changed.");
  const r = await fetch("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Couldn't save");
  // the engine recomputes in the background; ask again once it has had a moment
  for (const ms of [1200, 4000]) setTimeout(() => window.dispatchEvent(new Event("wimym:changed")), ms);
  return j.result;
}

/** The vital signs (GET /api/vitals), asked for again when the engine rebuilds; "absent" from an older engine. */
export function useVitals() {
  return useOptional<Vitals>("/api/vitals", x => Array.isArray(x?.measures));
}

/** One week for the retro (GET /api/week), the current one without `start`. */
export function useWeek(start?: string | null) {
  return useOptional<WeekPage>(start ? `/api/week?start=${start}` : "/api/week", x => Array.isArray(x?.days));
}

/**
 * An endpoint an older engine may not have: null while asked (or while the engine is still
 * computing it, when `ok` says the answer isn't there yet), "absent" on a 404.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useOptional<T>(path: string, ok: (x: any) => boolean = () => true) {
  const { core } = useData();
  const [d, setD] = useState<T | null | "absent">(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    // in share mode a view waits for core, so every project name is known before its sentences show
    if (shareOn && !core) return;
    let stop = false, t = 0;
    fetch(path, { cache: "no-store" })
      .then(r => (r.ok ? r.json().then(redact) : "absent"))
      .then(x => {
        if (stop) return;
        if (x === "absent" || (ok(x) && !(x && typeof x === "object" && "data" in x && x.data === null))) setD(x);
        else t = window.setTimeout(() => setAgain(n => n + 1), 3000);  // still computing: ask again shortly
      })
      .catch(() => { if (!stop) setD("absent"); });
    return () => { stop = true; clearTimeout(t); };
  }, [path, core?.generated, again]);
  useEffect(() => {
    const on = () => setAgain(n => n + 1);
    window.addEventListener("wimym:changed", on);
    return () => window.removeEventListener("wimym:changed", on);
  }, []);
  return d;
}

/** What you mean to keep to: a stopping hour, days off, sessions at once, priority projects. */
export async function saveLimits(body: Record<string, unknown>) {
  if (shareOn) throw new Error("Share mode is on: nothing can be changed.");
  const r = await fetch("/api/limits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Couldn't save");
  // the engine recomputes in the background; ask again once it has had a moment
  for (const ms of [1200, 4000]) setTimeout(() => window.dispatchEvent(new Event("wimym:changed")), ms);
  return j.result;
}

/** Every message as a compact row for drawing (GET /api/points, docs/contract-points.md). */
export function usePoints() {
  return useOptional<Points>("/api/points", x => Array.isArray(x?.rows));
}
