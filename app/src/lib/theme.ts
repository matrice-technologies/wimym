import { useEffect, useState } from "react";

// Matrice's theme rule (matrice-website-v2, theme-provider.tsx): a first visit is dark, whatever the system says;
// D switches it, and the choice is kept in this browser. index.html sets it before the first paint.
export type Theme = "dark" | "light";
const META = { dark: "#0a0a0a", light: "#ffffff" };

const current = (): Theme => (document.documentElement.classList.contains("light") ? "light" : "dark");

function apply(t: Theme) {
  const root = document.documentElement;
  // the switch is instant, as Matrice's is: nothing fades from one theme to the other on the way
  root.classList.add("switching");
  root.classList.remove("dark", "light");
  root.classList.add(t);
  void root.offsetWidth;
  requestAnimationFrame(() => root.classList.remove("switching"));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META[t]);
  try { localStorage.setItem("theme", t); } catch { /* not kept */ }
  window.dispatchEvent(new Event("wimym:theme"));
}

export const flipTheme = () => apply(current() === "dark" ? "light" : "dark");

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

/** The page's theme, and D to switch it (not while typing, nor with a modifier). */
export function useTheme(): Theme {
  const [t, setT] = useState<Theme>(current);
  useEffect(() => {
    const on = () => setT(current());
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "d" || typing(e.target)) return;
      flipTheme();
    };
    window.addEventListener("wimym:theme", on);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("wimym:theme", on); window.removeEventListener("keydown", key); };
  }, []);
  return t;
}
