/**
 * Função de servidor que sugere parâmetros de custo para um par.
 *
 * O ranking de volume 24h vem da própria Binance (ticker/24hr), calculado no
 * servidor — nunca no cliente e nunca hardcoded em componente. A resposta é
 * uma SUGESTÃO editável: quem grava é o usuário, depois de confirmar.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  suggestionForTier,
  tierFromRank,
  type CostSuggestion,
  type LiquidityTier,
} from "./cost-tiers";

export type CostSuggestionResult = {
  symbol: string;
  tier: LiquidityTier;
  rank: number;
  quoteVolume: number;
  suggestion: CostSuggestion;
  /** Premissa declarada, não medição do livro do par. */
  note: string;
};

const input = z.object({ symbol: z.string().min(4).max(20) });

type Ticker24h = { symbol: string; lastPrice: string; quoteVolume: string };

export const suggestCostParams = createServerFn({ method: "GET" })
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data }): Promise<CostSuggestionResult> => {
    const symbol = data.symbol.toUpperCase();
    const quote = symbol.endsWith("USDT") ? "USDT" : symbol.endsWith("BRL") ? "BRL" : "";

    // Binance pode bloquear a região do servidor (HTTP 451); cai para a OKX,
    // classificando pelo ativo base contra USDT (a OKX não lista pares BRL).
    let ranked: { symbol: string; quoteVolume: number }[] | null = null;
    let target = symbol;
    for (const host of ["https://data-api.binance.vision", "https://api.binance.com"]) {
      try {
        const res = await fetch(`${host}/api/v3/ticker/24hr`);
        if (!res.ok) continue;
        const rows = (await res.json()) as Ticker24h[];
        ranked = rows
          .filter((r) => (quote ? r.symbol.endsWith(quote) : true) && Number(r.lastPrice) > 0)
          .map((r) => ({ symbol: r.symbol, quoteVolume: Number(r.quoteVolume) || 0 }))
          .sort((a, b) => b.quoteVolume - a.quoteVolume)
          .slice(0, 100);
        break;
      } catch {
        /* tenta a próxima fonte */
      }
    }
    if (!ranked) {
      const res = await fetch("https://www.okx.com/api/v5/market/tickers?instType=SPOT");
      if (!res.ok) throw new Error(`tickers OKX falhou (${res.status})`);
      const body = (await res.json()) as {
        data?: { instId: string; last: string; volCcy24h: string }[];
      };
      ranked = (body.data ?? [])
        .filter((r) => r.instId.endsWith("-USDT") && Number(r.last) > 0)
        .map((r) => ({ symbol: r.instId.replace("-", ""), quoteVolume: Number(r.volCcy24h) || 0 }))
        .sort((a, b) => b.quoteVolume - a.quoteVolume)
        .slice(0, 100);
      if (quote === "BRL") target = `${symbol.slice(0, -3)}USDT`;
    }

    const idx = ranked.findIndex((r) => r.symbol === target);
    // Fora do top 100 por volume: tratado como cauda (premissa conservadora).
    const rank = idx >= 0 ? idx + 1 : 100;
    const tier = tierFromRank(rank);

    return {
      symbol,
      tier,
      rank,
      quoteVolume: idx >= 0 ? ranked[idx]!.quoteVolume : 0,
      suggestion: suggestionForTier(tier),
      note: "valores sugeridos com base em padrões de mercado para scalp puro, ajuste conforme o par",
    };
  });
