import { useEffect, useRef, useState } from "react";
import type { Bet } from "@/hooks/useBets";
import type { FxQuote } from "@/lib/fx-totals";
import { getMinuteRange } from "@/lib/supremo-data";
import { SHADOW_HORIZON_MS, isShadowCandidate, readShadow, shadowEntry, writeShadow, type ShadowEntry } from "@/lib/supremo-shadow";

/** Simula em segundo plano as canceladas por alta (sombra; nunca cria aposta). */
export function useShadow(bets: readonly Bet[], fx: FxQuote | null | undefined) {
  const [store, setStore] = useState<Record<string, ShadowEntry>>({});
  const busy = useRef(false);
  useEffect(() => setStore(readShadow()), []);
  useEffect(() => {
    if (busy.current) return;
    const now = Date.now();
    const todo = bets.filter((b) => isShadowCandidate(b) && !store[b.id] && b.createdAt + SHADOW_HORIZON_MS < now);
    if (!todo.length) return;
    busy.current = true;
    void (async () => {
      const next = { ...readShadow() };
      for (const b of todo.slice(0, 10)) {
        try {
          const candles = await getMinuteRange(b.symbol, b.createdAt - 60_000, b.createdAt + SHADOW_HORIZON_MS);
          if (candles.length) next[b.id] = shadowEntry(b, candles, fx, Date.now());
        } catch {
          /* silencioso */
        }
      }
      writeShadow(next);
      setStore(next);
      busy.current = false;
    })();
  }, [bets, fx, store]);
  return store;
}
