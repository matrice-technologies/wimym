import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Show = (content: ReactNode, x: number, y: number) => void;
const Ctx = createContext<{ show: Show; hide: () => void }>({ show: () => {}, hide: () => {} });

export function TipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ c: ReactNode; x: number; y: number } | null>(null);
  const show = useCallback<Show>((c, x, y) => setTip({ c, x, y }), []);
  const hide = useCallback(() => setTip(null), []);
  const value = useMemo(() => ({ show, hide }), [show, hide]);
  let style: React.CSSProperties | undefined;
  if (tip) {
    const left = tip.x + 16 + 340 > window.innerWidth ? tip.x - 16 - 340 : tip.x + 16;
    const top = Math.min(tip.y + 14, window.innerHeight - 160);
    style = { left: Math.max(8, left), top: Math.max(8, top) };
  }
  return (
    <Ctx.Provider value={value}>
      {children}
      {tip && <div className="tip" style={style}>{tip.c}</div>}
    </Ctx.Provider>
  );
}

export const useTip = () => useContext(Ctx);
