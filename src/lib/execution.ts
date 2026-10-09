/**
 * Fase 5 — modelo de execução honesto.
 *
 * Traduz um sinal teórico (gatilho / alvo / stop) no que realmente aconteceria
 * ao operar: taxa ida-e-volta, spread, slippage, atraso entre o sinal e o
 * preenchimento e arredondamento de tick/lote da exchange.
 *
 * Regras:
 *  - nada aqui cria sinal. É apenas custo e realismo em cima do que o motor
 *    estatístico já decidiu;
 *  - tudo em FRAÇÃO (0,0035 = 0,35%). Arredondamento decimal só na tela;
 *  - quando um insumo não existe (livro de ofertas, tick real da exchange),
 *    o valor é marcado como ESTIMADO e a estimativa é sempre conservadora —
 *    nunca otimista, nunca inventada como se fosse medida.
 */

import { FEE_ROUND_TRIP_PCT } from "./scalp";

export { FEE_ROUND_TRIP_PCT };

/** Regime de volatilidade da janela, medido pela amplitude em % do preço. */
export type Regime = "calmo" | "normal" | "agitado";

/** Limites de amplitude (em % do preço) que separam os regimes. */
export const REGIME_CALM_MAX_PCT = 0.35;
export const REGIME_BUSY_MIN_PCT = 1.2;

export function classifyRegime(rangePct: number | null): Regime {
  if (rangePct == null || !isFinite(rangePct)) return "normal";
  if (rangePct < REGIME_CALM_MAX_PCT) return "calmo";
  if (rangePct > REGIME_BUSY_MIN_PCT) return "agitado";
  return "normal";
}

/**
 * Slippage-base por regime, usado SOMENTE quando o livro de ofertas não está
 * disponível. São premissas declaradas, não medições.
 */
export const REGIME_SLIPPAGE_FALLBACK: Record<Regime, number> = {
  calmo: 0.0002, // 0,02%
  normal: 0.0005, // 0,05%
  agitado: 0.0012, // 0,12%
};

/**
 * Atraso assumido entre o sinal, o toque no gatilho e o preenchimento real.
 * Premissa declarada: sem log de execução real não há como medir.
 */
export const DEFAULT_LATENCY_MS = 1_200;

/** Penalidade extra de slippage por atraso (fração por segundo de latência). */
export const LATENCY_SLIPPAGE_PER_SEC = 0.0002;

export type SlippageSource = "livro" | "estimado";

export type ExecutionInputs = {
  /** Gatilho teórico de entrada. */
  trigger: number;
  /** Alvo teórico (ímã). */
  target: number;
  /** Stop teórico. */
  stop: number;
  /** Spread do livro em fração; null quando o livro não foi recebido. */
  spread?: number | null;
  /** Regime da janela, para o fallback de slippage. */
  regime?: Regime;
  /** Tamanho do passo de preço da exchange; null = estimar pela escala. */
  tickSize?: number | null;
  /** Atraso assumido até o preenchimento (ms). */
  latencyMs?: number;
  /** Taxa ida-e-volta em fração. */
  fee?: number;
};

export type ExecutionModel = {
  /** Preço em que a compra realmente sairia (pior que o gatilho). */
  entryFill: number;
  /** Preço em que a venda no alvo realmente sairia (pior que o alvo). */
  targetFill: number;
  /** Preço em que a venda no stop realmente sairia (pior que o stop). */
  stopFill: number;
  /** Taxa ida-e-volta aplicada (fração). */
  fee: number;
  /** Spread usado (fração) ou null quando não disponível. */
  spread: number | null;
  /** Slippage total assumido por perna (fração). */
  slippagePerLeg: number;
  /** De onde veio o slippage: medido no livro ou estimado. */
  slippageSource: SlippageSource;
  /** Passo de preço usado no arredondamento. */
  tickSize: number;
  /** true quando o tick veio de estimativa, não da exchange. */
  tickEstimated: boolean;
  latencyMs: number;
  regime: Regime;
  /** Retorno líquido se a operação vencer (fração, já com taxa e slippage). */
  netIfWin: number;
  /** Retorno líquido se a operação perder (fração, negativo). */
  netIfLoss: number;
  /** Risco por operação: módulo da perda líquida. */
  riskPerTrade: number;
  /** Quantos % de acerto são necessários só para empatar. */
  breakevenHitRate: number | null;
  /** Custo total embutido (taxa + slippage das duas pernas), em fração. */
  totalCostPct: number;
};

/**
 * Passo de preço estimado quando a exchange não informou o filtro real.
 * Conservador: usa a escala do preço (2 casas acima de 1000, 6 abaixo de 1).
 */
export function estimateTickSize(price: number): number {
  if (!isFinite(price) || price <= 0) return 0.01;
  if (price >= 10_000) return 1;
  if (price >= 1_000) return 0.1;
  if (price >= 1) return 0.0001;
  return 0.000001;
}

/** Arredonda um preço para o passo da exchange. `dir` escolhe o lado pior. */
export function roundToTick(
  price: number,
  tick: number,
  dir: "up" | "down" | "nearest" = "nearest",
): number {
  if (!isFinite(price) || !isFinite(tick) || tick <= 0) return price;
  const steps = price / tick;
  const n =
    dir === "up" ? Math.ceil(steps) : dir === "down" ? Math.floor(steps) : Math.round(steps);
  // Recompõe com correção de ponto flutuante sem arredondar o valor financeiro
  // antes da conta: o arredondamento AQUI é o da exchange, não o da tela.
  const decimals = tick < 1 ? Math.min(12, Math.ceil(-Math.log10(tick))) : 0;
  return Number((n * tick).toFixed(decimals));
}

/**
 * Constrói o modelo de execução de uma operação de repique (compra no gatilho,
 * venda no alvo ou no stop). Todos os desvios são contra o operador.
 */
export function buildExecutionModel(input: ExecutionInputs): ExecutionModel {
  const regime = input.regime ?? "normal";
  const fee = input.fee ?? FEE_ROUND_TRIP_PCT;
  const latencyMs = input.latencyMs ?? DEFAULT_LATENCY_MS;
  const spread = input.spread != null && isFinite(input.spread) ? Math.max(0, input.spread) : null;

  // Slippage por perna: metade do spread quando há livro; caso contrário, a
  // premissa do regime. Em ambos os casos soma-se a penalidade de atraso.
  const latencyPenalty = (latencyMs / 1000) * LATENCY_SLIPPAGE_PER_SEC;
  const base = spread != null ? spread / 2 : REGIME_SLIPPAGE_FALLBACK[regime];
  const slippagePerLeg = base + latencyPenalty;
  const slippageSource: SlippageSource = spread != null ? "livro" : "estimado";

  const tickEstimated = input.tickSize == null || !isFinite(input.tickSize) || input.tickSize <= 0;
  const tickSize = tickEstimated ? estimateTickSize(input.trigger) : input.tickSize!;

  // Compra sai mais cara, vendas saem mais baratas — sempre o lado ruim.
  const entryFill = roundToTick(input.trigger * (1 + slippagePerLeg), tickSize, "up");
  const targetFill = roundToTick(input.target * (1 - slippagePerLeg), tickSize, "down");
  const stopFill = roundToTick(input.stop * (1 - slippagePerLeg), tickSize, "down");

  const netIfWin = (targetFill - entryFill) / entryFill - fee;
  const netIfLoss = (stopFill - entryFill) / entryFill - fee;
  const riskPerTrade = Math.abs(netIfLoss);
  const breakevenHitRate =
    netIfWin > 0 && riskPerTrade > 0 ? riskPerTrade / (netIfWin + riskPerTrade) : null;

  return {
    entryFill,
    targetFill,
    stopFill,
    fee,
    spread,
    slippagePerLeg,
    slippageSource,
    tickSize,
    tickEstimated,
    latencyMs,
    regime,
    netIfWin,
    netIfLoss,
    riskPerTrade,
    breakevenHitRate,
    totalCostPct: fee + slippagePerLeg * 2,
  };
}

/** Spread em fração a partir do topo do livro; null se o livro não veio. */
export function spreadFromBook(bid: number | null, ask: number | null): number | null {
  if (bid == null || ask == null || !isFinite(bid) || !isFinite(ask) || bid <= 0) return null;
  if (ask < bid) return null;
  return (ask - bid) / bid;
}
