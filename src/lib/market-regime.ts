/**
 * Filtro de regime de mercado (puro). Usa BTCUSDT e ETHUSDT (velas de 1 min)
 * e a amplitude de queda do universo Supremo. Só BLOQUEIA — nunca cria sinal.
 */
import type { Candle } from "./replay";

export type MarketRegime = "calmo" | "queda" | "alta" | "indefinido";

export const CALM_BAND = 0.0025;
export const DROP_15M = -0.004;
export const RISE_60M = 0.004;
export const BREADTH_DROP_PCT = -0.003;
export const BREADTH_CALM_MAX = 0.4;
export const BREADTH_DROP_MIN = 0.6;
export const ALTA_MIN_SAMPLE = 5;

export type RegimeInput = {
  btc15: number | null;
  btc60: number | null;
  eth15: number | null;
  eth60: number | null;
  /** Fração (0–1) das moedas que caíram mais de 0,30% em 15 min; null sem dados. */
  breadthDown: number | null;
};

export type RegimeReading = RegimeInput & { regime: MarketRegime };

export const REGIME_LABEL: Record<MarketRegime, string> = {
  calmo: "Mercado calmo",
  queda: "Mercado em queda",
  alta: "Mercado em alta",
  indefinido: "Regime indefinido",
};

export function classifyRegime(i: RegimeInput): MarketRegime {
  const { btc15, btc60, eth15, eth60, breadthDown } = i;
  if ((btc15 != null && btc15 <= DROP_15M) || (eth15 != null && eth15 <= DROP_15M) || (breadthDown != null && breadthDown >= BREADTH_DROP_MIN))
    return "queda";
  if (btc60 == null || eth60 == null || btc15 == null || eth15 == null || breadthDown == null) return "indefinido";
  if (btc60 >= RISE_60M && eth60 >= RISE_60M) return "alta";
  if (Math.abs(btc60) <= CALM_BAND && Math.abs(eth60) <= CALM_BAND && breadthDown < BREADTH_CALM_MAX) return "calmo";
  return "indefinido";
}

/** Variação do fechamento entre `now - ms` e a última vela; null se faltar cobertura. */
export function changeOver(candles: readonly Candle[], ms: number, now: number): number | null {
  if (candles.length < 2) return null;
  const from = now - ms;
  const first = candles.find((c) => c.time >= from);
  const last = candles[candles.length - 1]!;
  if (!first || first === last) return null;
  // Precisa cobrir ao menos 80% da janela.
  if (last.time - first.time < ms * 0.8) return null;
  const base = first.open ?? first.close;
  return base > 0 ? last.close / base - 1 : null;
}

export function breadthDown(changes15: readonly (number | null)[]): number | null {
  const v = changes15.filter((x): x is number => x != null);
  if (v.length === 0) return null;
  return v.filter((x) => x < BREADTH_DROP_PCT).length / v.length;
}

export function readRegime(input: {
  btc: readonly Candle[];
  eth: readonly Candle[];
  universe15: readonly (number | null)[];
  now: number;
}): RegimeReading {
  const r: RegimeInput = {
    btc15: changeOver(input.btc, 15 * 60_000, input.now),
    btc60: changeOver(input.btc, 60 * 60_000, input.now),
    eth15: changeOver(input.eth, 15 * 60_000, input.now),
    eth60: changeOver(input.eth, 60 * 60_000, input.now),
    breadthDown: breadthDown(input.universe15),
  };
  return { ...r, regime: classifyRegime(r) };
}

/** Bloqueio do regime para uma moeda. */
export function regimeBlock(
  regime: MarketRegime,
  coin: { hitRate: number | null | undefined; sample: number | null | undefined; breakEven: number },
): "mercado-em-queda" | "mercado-em-alta" | null {
  if (regime === "queda") return "mercado-em-queda";
  if (regime === "alta") {
    const ok = (coin.hitRate ?? 0) >= coin.breakEven && (coin.sample ?? 0) >= ALTA_MIN_SAMPLE;
    return ok ? null : "mercado-em-alta";
  }
  return null;
}
