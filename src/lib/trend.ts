/**
 * Patch — filtro de movimento direcional excessivo (tendência × repique).
 *
 * A tese do robô é REVERSÃO À MÉDIA: o preço cai rápido e volta ao ímã. Quando
 * a janela inteira já está caindo de forma consistente, a queda dos últimos
 * segundos não é repique — é continuação de tendência, e o "ímã" fica para
 * trás. Aqui medimos a inclinação de fundo (regressão linear dos 180 s) e a
 * comparamos com a queda recente de 5 s.
 *
 * Esta regra só BLOQUEIA — nunca cria sinal.
 */

/** Inclinação de fundo, em % do preço ao longo da janela, que já é tendência. */
export const TREND_SLOPE_BLOCK_PCT = 0.25;
/** Fração da queda recente que precisa estar explicada pela tendência. */
export const TREND_CONTINUATION_RATIO = 0.6;

export type TrendAssessment = {
  /** Inclinação de fundo da janela, em % do preço (negativa = caindo). */
  slopePct: number | null;
  /** Queda observada nos últimos 5 s, em % do preço (positiva = caiu). */
  recentDropPct: number | null;
  /** Queda projetada pela tendência de fundo no mesmo intervalo, em %. */
  trendDropPct: number | null;
  blocked: boolean;
  /** Texto curto em pt-BR com os componentes medidos. */
  detail: string;
};

export const TREND_BLOCK_REASON =
  "possível continuação da queda — o movimento parece tendência, não recuperação";

const fmt = (v: number, d = 3) => `${v.toFixed(d).replace(".", ",")}%`;

/** Regressão linear simples: devolve a inclinação por ponto. */
export function linearSlope(values: readonly number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  let meanY = 0;
  for (const v of values) meanY += v;
  meanY /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * (values[i]! - meanY);
    den += dx * dx;
  }
  if (den === 0) return null;
  return num / den;
}

/**
 * Compara a inclinação de fundo da janela completa com a queda dos últimos 5 s.
 * Bloqueia quando a tendência já cai forte e explica boa parte da queda recente.
 */
export function assessTrend(
  prices: readonly number[],
  recentDrop: number,
  recentWindowPoints = 5,
): TrendAssessment {
  const last = prices.length > 0 ? prices[prices.length - 1]! : null;
  const slope = linearSlope(prices);
  if (last == null || last <= 0 || slope == null) {
    return {
      slopePct: null,
      recentDropPct: null,
      trendDropPct: null,
      blocked: false,
      detail: "não mensurável — janela curta demais",
    };
  }

  const slopePct = ((slope * prices.length) / last) * 100;
  const recentDropPct = (recentDrop / last) * 100;
  const trendDropPct = (-(slope * recentWindowPoints) / last) * 100;

  const strongDowntrend = slopePct <= -TREND_SLOPE_BLOCK_PCT;
  const fallingNow = recentDropPct > 0;
  const explained =
    recentDropPct > 0 ? trendDropPct / recentDropPct >= TREND_CONTINUATION_RATIO : false;
  const blocked = strongDowntrend && fallingNow && explained;

  const detail = `inclinação de fundo ${fmt(slopePct)} na janela · queda de 5 s ${fmt(recentDropPct)} (limite ${fmt(-TREND_SLOPE_BLOCK_PCT, 2)})`;

  return { slopePct, recentDropPct, trendDropPct, blocked, detail };
}
