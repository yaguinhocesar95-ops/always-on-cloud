import { useEffect, useState } from "react";
import { DEFAULT_COMBO, readActiveCombo, type ActiveCombo } from "@/lib/supremo-combo";

/** Combinação ativa, atualizada quando o laboratório troca. */
export function useActiveCombo(): ActiveCombo {
  const [c, setC] = useState<ActiveCombo>(DEFAULT_COMBO);
  useEffect(() => {
    const sync = () => setC(readActiveCombo());
    sync();
    window.addEventListener("supremo-combo", sync);
    return () => window.removeEventListener("supremo-combo", sync);
  }, []);
  return c;
}
