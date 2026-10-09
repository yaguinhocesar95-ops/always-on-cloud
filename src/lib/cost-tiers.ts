/**
 * Sugestão de parâmetros de custo por tier de liquidez.
 *
 * NADA aqui toca a matemática do motor de sinais (+0,55% bruto, −0,55% stop,
 * janela de 180s, 20 bins, cauda de 3 desvios/5s, NET_WIN_PCT = 0,35%).
 * São apenas premissas de CUSTO, sugeridas ao usuário e sempre editáveis.
 *
 * Os números são heurísticas de mercado consolidadas para scalp puro em
 * cripto — não são leitura em tempo real do spread/slippage real do par.
 */

export type LiquidityTier = "A" | "B" | "C";

/** Origem dos parâmetros de custo usados em uma aposta. */
export type CostSource = "motor" | "sugerido" | "manual";

export type CostSuggestion = {
  /** Taxa por ponta, em fração (0,001 = 0,10%). */
  fee_pct: number;
  /** Spread assumido, em fração. */
  spread_pct: number;
  /** Escorregamento assumido por perna, em fração. */
  slippage_pct: number;
};

export const TIER_LABEL: Record<LiquidityTier, string> = {
  A: "majors",
  B: "médios",
  C: "cauda",
};

/** Faixas por tier, em fração. O valor sugerido é o meio da faixa. */
export const TIER_RANGES: Record<
  LiquidityTier,
  { fee: number; spread: [number, number]; slippage: [number, number] }
> = {
  A: { fee: 0.001, spread: [0.0002, 0.0005], slippage: [0.0005, 0.001] },
  B: { fee: 0.001, spread: [0.0005, 0.001], slippage: [0.001, 0.0015] },
  C: { fee: 0.001, spread: [0.001, 0.002], slippage: [0.0015, 0.0025] },
};

const mid = ([a, b]: [number, number]) => Number((((a + b) / 2)).toFixed(6));

/** Classifica pela posição no ranking de volume 24h dentro do top 100. */
export function tierFromRank(rank: number): LiquidityTier {
  if (rank <= 10) return "A";
  if (rank <= 40) return "B";
  return "C";
}

export function suggestionForTier(tier: LiquidityTier): CostSuggestion {
  const r = TIER_RANGES[tier];
  return { fee_pct: r.fee, spread_pct: mid(r.spread), slippage_pct: mid(r.slippage) };
}

/** Texto curto de faixa, para tooltip: "0,02%–0,05%". */
export function rangeLabel([a, b]: [number, number]): string {
  const f = (v: number) => `${(v * 100).toFixed(2).replace(".", ",")}%`;
  return `${f(a)}–${f(b)}`;
}
