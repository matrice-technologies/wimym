// The second label set's values in plain words, and whether a label set covers enough of your messages to show.
import type { Core, Coverage, Message } from "./types";

export const WHO: Record<string, string> = { alex: "You", claude: "Claude", open: "Still open", none: "Nothing to decide" };
export const SCOPE: Record<string, string> = { tweak: "A tweak", task: "A task", project: "A project", strategy: "Strategy", none: "No work asked" };
export const IRK: Record<string, string> = { none: "Nobody", claude: "Claude", other: "Something else" };
export const SCOPE_ORDER = ["tweak", "task", "project", "strategy", "none"];
export const WHO_ORDER = ["alex", "claude", "open", "none"];

/** Scope is ordered by size: one hue, light to dark; "no work asked" stays grey. */
export const scopeColor = (k: string) =>
  k === "none" ? "var(--line-2)" : `color-mix(in srgb, var(--f-think) ${({ tweak: 42, task: 64, project: 84, strategy: 100 } as Record<string, number>)[k] ?? 50}%, var(--surface))`;
export const whoColor = (k: string) => ({ alex: "var(--ink-2)", claude: "var(--f-think)", open: "var(--f-approve)", none: "var(--line-2)" }[k] || "var(--faint)");

export const signals = (core: Core): Coverage => core.profile.coverage?.signals ?? { labelled: 0, of: 0, version: null, covered: false };
export const categories = (core: Core): Coverage => core.profile.coverage?.categories ?? { labelled: 0, of: 0, version: null, covered: false };
export const hasSignals = (m: Message) => m.who != null;
