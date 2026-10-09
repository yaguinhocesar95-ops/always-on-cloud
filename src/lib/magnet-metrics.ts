/**
 * Fase 3 — robustez do ímã, sem sair do scalp puro.
 *
 * Tudo aqui é MÉTRICA de leitura sobre o mesmo histograma do baseline:
 * nenhuma destas contas cria sinal novo, antecipa entrada ou muda alvo/stop.
 * Elas só descrevem o quanto a caixa vencedora é confiável — e podem, no modo
 * opcional "cluster estável", BLOQUEAR um sinal que o baseline aceitaria.
 */

import { buildPriceBins, type ClusterPick, type PriceBin } from "./histogram";

export type MagnetMetrics = {
  /** Fração da janela concentrada na caixa vencedora (0..1). */
  concentration: number;
  /** Vantagem da 1ª sobre a 2ª caixa, em fração da janela (0..1). */
  gapToSecond: number;
  /** Toques na caixa vencedora. */
  touches: number;
  /** Maior sequência contínua de segundos dentro da caixa vencedora. */
  longestStreak: number;
  /** Quantas vezes o preço ENTROU na caixa (persistência x idas e vindas). */
  visits: number;
  /** Distância do ímã ao centro da janela, em % do preço atual. */
  distanceToWindowCenterPct: number;
  /** Deslocamento do ímã entre a meia-janela e a janela cheia, em %. */
  stabilityDriftPct: number | null;
  /** true quando mover a borda das caixas em meia largura troca o ímã. */
  edgeSensitive: boolean;
  /** Ímã alternativo com as bordas deslocadas (para comparação visual). */
  alternativeMagnet: number | null;
};

/**
 * Limites do filtro opcional "cluster estável" (só bloqueia, nunca cria).
 * Calibrados com leituras reais de 20 caixas em 180 s: os limites antigos
 * (18% / 3 p.p. + borda) bloqueavam praticamente 100% do tempo.
 */
export const STABLE_MIN_CONCENTRATION = 0.12;
export const STABLE_MIN_GAP = 0.01;
export const STABLE_MAX_DRIFT_PCT = 0.2;

function magnetCenter(bins: PriceBin[]): number | null {
  let best: PriceBin | null = null;
  for (const b of bins) {
    if (b.count === 0) continue;
    if (
      best == null ||
      b.count > best.count ||
      (b.count === best.count && b.center < best.center)
    ) {
      best = b;
    }
  }
  return best ? best.center : null;
}

export function computeMagnetMetrics(
  prices: readonly number[],
  bins: readonly PriceBin[],
  cluster: ClusterPick,
  currentPrice: number,
): MagnetMetrics {
  const total = prices.length || 1;
  const sorted = [...bins].filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
  const second = sorted[1]?.count ?? 0;

  let longestStreak = 0;
  let streak = 0;
  let visits = 0;
  let inside = false;
  for (const p of prices) {
    const isIn = p >= cluster.bin.low && p <= cluster.bin.high;
    if (isIn) {
      if (!inside) visits += 1;
      streak += 1;
      if (streak > longestStreak) longestStreak = streak;
    } else {
      streak = 0;
    }
    inside = isIn;
  }

  const low = bins.length > 0 ? bins[0]!.low : Math.min(...prices);
  const high = bins.length > 0 ? bins[bins.length - 1]!.high : Math.max(...prices);
  const windowCenter = (low + high) / 2;

  // Estabilidade: o ímã da metade mais recente coincide com o da janela cheia?
  const halfPrices = prices.slice(Math.floor(prices.length / 2));
  const halfMagnet = halfPrices.length >= 5 ? magnetCenter(buildPriceBins(halfPrices)) : null;
  const stabilityDriftPct =
    halfMagnet == null ? null : ((halfMagnet - cluster.bin.center) / cluster.bin.center) * 100;

  // Sensibilidade a bordas: desloca o grid em meia caixa e vê se o ímã muda.
  const width = bins.length > 0 ? bins[0]!.high - bins[0]!.low : 0;
  let alternativeMagnet: number | null = null;
  let edgeSensitive = false;
  if (width > 0) {
    const shifted = buildPriceBins([...prices, low - width / 2, high + width / 2]);
    alternativeMagnet = magnetCenter(shifted);
    edgeSensitive =
      alternativeMagnet != null && Math.abs(alternativeMagnet - cluster.bin.center) > width;
  }

  return {
    concentration: cluster.count / total,
    gapToSecond: (cluster.count - second) / total,
    touches: cluster.count,
    longestStreak,
    visits,
    distanceToWindowCenterPct: ((cluster.bin.center - windowCenter) / currentPrice) * 100,
    stabilityDriftPct,
    edgeSensitive,
    alternativeMagnet,
  };
}

/**
 * true quando o cluster NÃO passa no critério de estabilidade.
 * Sensibilidade à borda sozinha não bloqueia: só derruba quando a vantagem
 * sobre a 2ª caixa também é mínima (ímã realmente ambíguo).
 */
export function isClusterUnstable(m: MagnetMetrics): boolean {
  return (
    m.concentration < STABLE_MIN_CONCENTRATION ||
    m.gapToSecond < STABLE_MIN_GAP ||
    (m.edgeSensitive && m.gapToSecond < STABLE_MIN_GAP * 2) ||
    (m.stabilityDriftPct != null && Math.abs(m.stabilityDriftPct) > STABLE_MAX_DRIFT_PCT)
  );
}
