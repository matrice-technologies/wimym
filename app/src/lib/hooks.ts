import { useEffect, useRef, useState } from "react";

/** A CSS color as canvas takes it: #rrggbb, or rgba() when it is see-through (the tokens are oklch, which alpha can't read). */
let probe: CanvasRenderingContext2D | null = null;
function canvasColor(css: string) {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe || !css) return css;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return a === 255 ? "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1) : `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
}

/** The theme's colors, read from CSS. */
export function useColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const g = (k: string) => canvasColor(s.getPropertyValue(k).trim());
    return {
      ground: g("--ground"), surface: g("--surface"), raised: g("--raised"), line: g("--line"), line2: g("--line-2"),
      ink: g("--ink"), ink2: g("--ink-2"), muted: g("--muted"), faint: g("--faint"), focus: g("--focus"), late: g("--late"),
      fam: {
        ask: g("--f-ask"), steer: g("--f-steer"), make: g("--f-make"), approve: g("--f-approve"),
        run: g("--f-run"), ship: g("--f-ship"), think: g("--f-think"), none: g("--f-none"),
      } as Record<string, string>,
    };
  };
  const [c] = useState(read);
  return c;
}
export type Colors = ReturnType<typeof useColors>;

/** Width of an element, kept current. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function alpha(color: string, a: number) {
  if (color.startsWith("#") && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return color;
}

/** Whether the window is wide enough to set words beside a picture rather than over it. */
export function useWide(q = "(min-width: 1100px)") {
  const [w, setW] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q), on = () => setW(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return w;
}
