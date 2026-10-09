/**
 * Junta o que já existe para montar o ranking informativo entre pares:
 * janela de 180 s de cada par → mesmo motor → mesmos filtros, mais as métricas
 * históricas por par já calculadas na Fase 5. Nenhum número novo é inventado.
 */

import { useEffect, useMemo, useState } from "react";

import { usePairFeeds, type StreamStatus } from "@/hooks/usePairFeeds";
import type { ResolvedTrade } from "@/lib/metrics";
type MetricsData = { trades: ResolvedTrade[] };
import { computeMetrics, type AmbiguityPolicy } from "@/lib/metrics";
import { rankPairs, type PairRank } from "@/lib/pair-ranking";
import { runScalpEngine, type EngineMode, type ScalpEngine } from "@/lib/scalp";

export type RankedPairInfo = {
  symbol: string;
  base: string;
  quote: string;
};

export type PairRankingResult = {
  ranked: PairRank[];
  /** Motor (mesmo modo do ranking) por par — fonte do gatilho de cada par. */
  engines: Map<string, ScalpEngine>;
  /** Motor no modo stable-cluster por par (ranking de decisão, só leitura). */
  decisionEngines: Map<string, ScalpEngine>;
  /** Pares comparados (já filtrados pelos que a corretora negocia). */
  pairs: readonly RankedPairInfo[];
  /** Saúde do fluxo ao vivo usado para comparar os pares. */
  stream: {
    status: StreamStatus;
    reconnects: number;
    lastFrameAt: number | null;
    /** Pares sem negócio novo há mais de um minuto (dados atrasados). */
    stale: Set<string>;
    /** Instante do último negócio por par. */
    lastTickAt: Map<string, number>;
  };
};

export function usePairRanking(
  pairs: readonly RankedPairInfo[],
  metrics: MetricsData | undefined,
  mode: EngineMode,
  policy: AmbiguityPolicy = "conservadora",
): PairRankingResult {
  // Só compara pares que a corretora ainda negocia: pares deslistados ou
  // suspensos nunca recebem dado novo e ficariam eternamente "carregando".
  const [trading, setTrading] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    const hosts = ["https://api.binance.com", "https://data-api.binance.vision"];
    const load = async () => {
      for (const host of hosts) {
        try {
          const res = await fetch(`${host}/api/v3/exchangeInfo?symbolStatus=TRADING`);
          if (!res.ok) continue;
          const raw = (await res.json()) as { symbols?: { symbol?: string }[] };
          const set = new Set((raw.symbols ?? []).map((x) => x.symbol ?? ""));
          if (alive && set.size > 0) setTrading(set);
          return;
        } catch {
          /* tenta o próximo host */
        }
      }
    };
    void load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  const activePairs = useMemo(
    () => (trading ? pairs.filter((p) => trading.has(p.symbol)) : pairs),
    [pairs, trading],
  );
  pairs = activePairs;
  const symbolsKey = useMemo(() => pairs.map((p) => p.symbol).join(","), [pairs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const symbols = useMemo(() => (symbolsKey ? symbolsKey.split(",") : []), [symbolsKey]);
  const feedState = usePairFeeds(symbols);
  const feeds = feedState.windows;

  // Relógio de 1 s: a nota envelhece junto com o dado, como no par aberto.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const historyBySymbol = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeMetrics>>();
    const trades = metrics?.trades ?? [];
    for (const symbol of symbols) {
      const list = trades.filter((t) => t.symbol === symbol);
      map.set(symbol, computeMetrics(list, policy));
    }
    return map;
  }, [metrics, policy, symbols]);

  const { ranked, engines } = useMemo(() => {
    const engines = new Map<string, ScalpEngine>();
    const ranked = rankPairs(
      pairs.map((p) => {
        const ticks = feeds.get(p.symbol) ?? [];
        // Contexto vazio de propósito: todos os pares precisam ser
        // comparados com a mesma base de informação.
        const engine = ticks.length > 0 ? runScalpEngine(ticks, clock, { mode }) : null;
        if (engine) engines.set(p.symbol, engine);
        return {
          symbol: p.symbol,
          base: p.base,
          quote: p.quote,
          engine,
          history: historyBySymbol.get(p.symbol) ?? null,
        };
      }),
    );
    return { ranked, engines };
  }, [pairs, feeds, clock, mode, historyBySymbol]);

  const decisionEngines = useMemo(() => {
    const m = new Map<string, ScalpEngine>();
    for (const p of pairs) {
      const ticks = feeds.get(p.symbol) ?? [];
      if (ticks.length > 0) m.set(p.symbol, runScalpEngine(ticks, clock, { mode: "stable-cluster" }));
    }
    return m;
  }, [pairs, feeds, clock]);

  return useMemo(
    () => ({
      ranked,
      engines,
      decisionEngines,
      pairs,
      stream: {
        status: feedState.status,
        reconnects: feedState.reconnects,
        lastFrameAt: feedState.lastFrameAt,
        stale: feedState.stale,
        lastTickAt: feedState.lastTickAt,
      },
    }),
    [ranked, engines, decisionEngines, pairs, feedState],
  );
}
