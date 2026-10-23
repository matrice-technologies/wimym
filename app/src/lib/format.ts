import type { Family } from "./types";

export const FAMILIES: { key: Family; name: string; verb: string }[] = [
  { key: "ask", name: "Ask", verb: "questions" },
  { key: "steer", name: "Steer", verb: "corrections" },
  { key: "make", name: "Make", verb: "build, fix and design requests" },
  { key: "approve", name: "Approve", verb: "go-aheads and answers" },
  { key: "run", name: "Run", verb: "ops and setup" },
  { key: "ship", name: "Ship", verb: "commits, pushes and deploys" },
  { key: "think", name: "Think", verb: "plans and reviews" },
];
export const famColor = (f: Family | null | undefined) => `var(--f-${f || "none"})`;
export const famName = (f: Family | null | undefined) => FAMILIES.find(x => x.key === f)?.name ?? "Not labelled";

export const INTENTS: Record<string, string> = {
  question: "Question", "go-ahead": "Go-ahead", answer: "Answer", build: "Build", fix: "Fix", design: "Design feedback",
  plan: "Plan", review: "Review", correct: "Correction", ship: "Ship", ops: "Ops", setup: "Claude setup",
};

export const fmtN = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en"));
export const fmtK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n)));
export const fmtP = (n: number | null | undefined, d = 0) => (n == null ? "—" : n.toFixed(d) + "%");
export const fmtDur = (s: number | null | undefined) =>
  s == null ? "—" : s < 60 ? Math.round(s) + " s" : s < 3600 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(s < 36000 ? 1 : 0) + " h";
export const fmtHour = (h: number | null | undefined) => {
  if (h == null) return "—";
  const x = ((h % 24) + 24) % 24;
  return `${String(Math.floor(x)).padStart(2, "0")}:${String(Math.round((x % 1) * 60) % 60).padStart(2, "0")}`;
};

const D = (s: string) => new Date(s.length > 10 ? s + (s.endsWith("Z") ? "" : "Z") : s + "T12:00:00");
export const toDate = D;
export const fmtDay = (s: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => D(s).toLocaleDateString("en-GB", o);
export const fmtDate = (s: string) => D(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const fmtWhen = (ts: string) => D(ts).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const plural = (n: number, w: string, ws = w + "s") => `${fmtN(n)} ${n === 1 ? w : ws}`;
