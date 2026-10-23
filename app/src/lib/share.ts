// Share mode: the page can be shown or screenshotted without giving away what was said or for whom.
// Everything the engine sends passes through redact() before the app sees it, so no page can forget:
// words become runs of dots of the same length, project names become stable aliases (also inside
// sentences), file paths disappear. Shapes, times and numbers stay. Turned on with ?share=1 or the
// switch in the rail, kept for the browser tab, and the page reloads so nothing redacted lingers.

const KEY = "wimym-share";

export const shareOn: boolean = (() => {
  try {
    const q = new URLSearchParams(location.search).get("share");
    if (q === "1") sessionStorage.setItem(KEY, "1");
    if (q === "0") sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === "1";
  } catch { return false; }
})();

export function setShare(on: boolean) {
  try { if (on) sessionStorage.setItem(KEY, "1"); else sessionStorage.removeItem(KEY); } catch { /* private window */ }
  const u = new URL(location.href);
  u.searchParams.delete("share");
  location.replace(u.toString());
}

// Every string is hidden unless its field is known to be safe: ids, dates, codes and the engine's own
// words about measures (labels, questions, units, sentences made from numbers). Those are kept, with any
// project name in them swapped for its alias.
const SAFE = new Set([
  "id", "sid", "m", "messages", "ids", "day", "days", "day0", "week", "weeks", "ts", "at", "asof", "from", "to", "since", "until",
  "start", "end", "first", "last", "firstDay", "fullFrom", "full_from", "prompts_from", "recentFrom", "generated", "updated", "written", "series",
  "key", "kind", "about", "goal", "group", "measures", "better", "unit", "status", "flag", "side", "phase", "set", "msg", "by", "was", "fix", "used",
  "intent", "intents", "family", "tone", "irk", "who", "scope", "origin", "origins", "src", "lang", "entry", "model", "next", "outcome", "type", "fields",
  "label", "question", "sentence", "figures", "value", "meaning", "plain", "notes", "name", "note",
]);
// Moments drawn from the model's accounts of days, sessions and weeks: their words are private too.
const ACCOUNT = new Set(["week", "high", "low", "decided", "dropped", "postponed", "abandoned"]);
// Paths and file names.
const PATH = new Set(["cwd", "file", "files", "skills", "where"]);
// Project names, as a value or as the keys of an object of minutes or counts.
const PROJECT = new Set(["project", "top", "projects"]);  // "projects": also the list in /api/points
const PROJECT_KEYS = new Set(["projects"]);

const TREES = ["Alder", "Birch", "Cedar", "Dogwood", "Elm", "Fir", "Ginkgo", "Hazel", "Ivy", "Juniper", "Kauri", "Larch", "Maple",
  "Nutmeg", "Oak", "Pine", "Quince", "Rowan", "Spruce", "Teak", "Umbra", "Vine", "Willow", "Yew", "Zelkova", "Aspen", "Beech", "Cypress"];
const seen = new Map<string, string>();
const taken = new Set<string>();

/** A project's alias: a tree, the same one every time for the same name. */
export function alias(name: string): string {
  if (!name) return name;
  const hit = seen.get(name);
  if (hit) return hit;
  const h = hash(name);
  let a = TREES[h % TREES.length], k = 2;
  while (taken.has(a)) a = `${TREES[h % TREES.length]} ${k++}`;
  seen.set(name, a);
  taken.add(a);
  return a;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
// Words become dots of the same length; an invisible tail (zero-width characters spelling a hash of
// the original) keeps two different hidden texts different, so lists keyed by text stay sound.
const tail = (s: string) => { const h = hash(s); let t = ""; for (let i = 0; i < 20; i++) t += h & (1 << i) ? "\u200c" : "\u200b"; return t; };
const dots = (s: string) => s.replace(/\S+/g, w => "•".repeat(Math.min(w.length, 14))) + tail(s);

/** Project names inside a sentence, longest first so "truva-academy" wins over "truva". */
function names(s: string) {
  if (!seen.size) return s;
  for (const n of [...seen.keys()].sort((a, b) => b.length - a.length)) if (n.length > 2 && s.includes(n)) s = s.split(n).join(seen.get(n)!);
  return s;
}

function walk(x: unknown, key: string | null, parent: Record<string, unknown> | null): unknown {
  if (x == null || typeof x === "number" || typeof x === "boolean") return x;
  if (typeof x === "string") {
    if (key && PROJECT.has(key)) return alias(x);
    if (key && PATH.has(key)) return dots(x.split("/").pop() || "");
    // a field name that is safe in one payload can be private in another
    const p = parent ?? {};
    const priv = (key === "name" && ("body" in p || "ahead" in p))                      // a memory note's or a branch's name
      || (key === "note" && ("energy" in p || "mood" in p || "focus" in p))               // a check-in's note
      || (key === "goal" && ("sid" in p || "outcome" in p))                               // a session's goal, not a goal's key
      || (key === "question" && ACCOUNT.has(String(p.key ?? p.kind)))                    // a question drawn from an account
      || (key === "first" && "sid" in p && !/^[0-9a-f-]{20,}$/i.test(x) && !/^\d{4}-/.test(x));  // a session's first words
    if (!key || !SAFE.has(key) || priv) return dots(x);
    return names(x);
  }
  if (Array.isArray(x)) return x.map(v => walk(v, key, parent));
  if (typeof x === "object") {
    const o = x as Record<string, unknown>, out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (PROJECT_KEYS.has(k) && v && typeof v === "object" && !Array.isArray(v)) {
        out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([p, n]) => [alias(p), n]));
      } else out[k] = walk(v, k, o);
    }
    return out;
  }
  return x;
}

/** First every project name the payload carries, so its sentences are aliased whatever the order. */
function learn(x: unknown, key: string | null) {
  if (typeof x === "string") { if (key && PROJECT.has(key)) alias(x); return; }
  if (Array.isArray(x)) { for (const v of x) learn(v, key); return; }
  if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (PROJECT_KEYS.has(k) && v && typeof v === "object" && !Array.isArray(v)) Object.keys(v).forEach(p => alias(p));
      else learn(v, k);
    }
  }
}

/** The engine's answer as share mode shows it; untouched when share mode is off. */
export function redact<T>(x: T): T {
  if (!shareOn) return x;
  learn(x, null);
  return walk(x, null, null) as T;
}
