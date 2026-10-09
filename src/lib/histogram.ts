/**
 * Histograma de preços da janela viva (baseline imutável: 20 caixas iguais).
 * Vive em módulo próprio para que as métricas da Fase 3 possam reusá-lo sem
 * importar o motor inteiro.
 */

/** Número de caixas do histograma de preços. */
export const BIN_COUNT = 20;

export type PriceBin = {
  index: number;
  low: number;
  high: number;
  center: number;
  count: number;
};

export type ClusterPick = {
  bin: PriceBin;
  /** Frequência da caixa vencedora. */
  count: number;
  /** true quando o vencedor absoluto estava colado no preço e foi trocado. */
  usedSecondChoice: boolean;
};

export function meanAndSd(values: number[]): { mean: number; sd: number } {
  const n = values.length;
  if (n === 0) return { mean: NaN, sd: NaN };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let acc = 0;
  for (const v of values) acc += (v - mean) ** 2;
  return { mean, sd: Math.sqrt(acc / n) };
}

/** Histograma: divide [min, max] da janela em `bins` caixas iguais. */
export function buildPriceBins(prices: readonly number[], bins = BIN_COUNT): PriceBin[] {
  if (prices.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const p of prices) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  if (!isFinite(min) || !isFinite(max)) return [];
  // Janela totalmente parada (mesmo preço do começo ao fim): uma única caixa.
  if (max <= min) {
    return [{ index: 0, low: min, high: min, center: min, count: prices.length }];
  }

  const width = (max - min) / bins;
  const out: PriceBin[] = Array.from({ length: bins }, (_, i) => ({
    index: i,
    low: min + i * width,
    high: min + (i + 1) * width,
    center: min + (i + 0.5) * width,
    count: 0,
  }));

  for (const p of prices) {
    const raw = Math.floor((p - min) / width);
    const idx = Math.min(bins - 1, Math.max(0, raw));
    out[idx]!.count += 1;
  }
  return out;
}

/**
 * ÍMÃ ESTATÍSTICO: a caixa de maior frequência de TODA a janela.
 * O centro dessa caixa é o preço para onde o mercado mais volta — usado como
 * ALVO (take profit), não como entrada.
 *
 * Exceção: quando a caixa vencedora é a que contém o preço ATUAL, o alvo
 * viraria uma mera cópia do último preço (mercado parado em cima dele). Nesse
 * caso vale a segunda caixa mais frequente — uma referência de fato distante
 * para onde o preço tende a voltar.
 */
export function findMagnet(
  bins: readonly PriceBin[],
  currentPrice?: number | null,
): ClusterPick | null {
  const filled = bins
    .filter((b) => b.count > 0)
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.center - b.center));
  if (filled.length === 0) return null;
  const winner = filled[0]!;
  const gluedToPrice =
    currentPrice != null && currentPrice >= winner.low && currentPrice <= winner.high;
  if (gluedToPrice && filled.length > 1) {
    const second = filled[1]!;
    return { bin: second, count: second.count, usedSecondChoice: true };
  }
  return { bin: winner, count: winner.count, usedSecondChoice: false };
}
