/**
 * Fase 4 — filtros de scalp, todos com motivo legível.
 *
 * Cada filtro devolve: passou, bloqueou ou NÃO MENSURÁVEL. Nenhum filtro cria
 * sinal: eles só podem derrubar um sinal que o motor estatístico já produziu.
 * Quando um requisito crítico não pode ser medido, o modo aprimorado prefere
 * não gerar sinal (fallback conservador) — o baseline segue intacto.
 */

import type { FeedQuality } from "./feed-quality";
import { MAX_AGE_MS } from "./feed-quality";
import type { MagnetMetrics } from "./magnet-metrics";
import { isClusterUnstable } from "./magnet-metrics";
import type { TrendAssessment } from "./trend";

/** Contexto de mercado que o motor não calcula sozinho. */
export type MarketContext = {
  /** Melhor compra e melhor venda do livro (quando disponíveis). */
  bestBid?: number | null;
  bestAsk?: number | null;
  /** Quantidade no topo do livro, na moeda base. */
  bidQty?: number | null;
  askQty?: number | null;
  /** Tamanho pretendido da operação, na moeda de cotação. */
  stakeQuote?: number | null;
  /** Exchange sinalizada como indisponível pelo leitor ao vivo. */
  exchangeDown?: boolean;
  /**
   * Pares correlacionados com aposta pendente/aberta agora. `null` = não
   * consultado (fica "não disponível"); lista vazia = nada a bloquear.
   */
  correlatedOpen?: readonly string[] | null;
};

export type FilterStatus = "pass" | "block" | "unavailable";

export type FilterResult = {
  id: FilterId;
  /** Texto curto em pt-BR mostrado na tela. */
  label: string;
  status: FilterStatus;
  /** Componente medido, já formatado (nunca uma nota opaca). */
  detail: string;
};

export type FilterId =
  | "feed"
  | "data-age"
  | "tail"
  | "volatility"
  | "spread"
  | "liquidity"
  | "slippage"
  | "cluster-stable"
  | "trend"
  | "exchange"
  | "correlation";

/** Volatilidade útil para o repique: amplitude da janela em % do preço. */
export const MIN_RANGE_PCT = 0.15;
export const MAX_RANGE_PCT = 3;
/** Spread máximo tolerado (ida-e-volta já custa 0,20%). */
export const MAX_SPREAD_PCT = 0.08;
/** Slippage estimado máximo. */
export const MAX_SLIPPAGE_PCT = 0.05;
/** Liquidez mínima no topo do livro, em múltiplos do tamanho da operação. */
export const MIN_BOOK_MULTIPLE = 3;

const pct = (v: number, d = 3) => `${v.toFixed(d).replace(".", ",")}%`;

export type FilterInput = {
  quality: FeedQuality;
  danger: boolean;
  velocitySigma: number | null;
  rangePct: number | null;
  price: number | null;
  metrics: MagnetMetrics | null;
  context: MarketContext;
  /** Leitura de tendência de fundo (Patch) — só bloqueia. */
  trend?: TrendAssessment | null;
};

export function evaluateFilters(input: FilterInput): FilterResult[] {
  const { quality, danger, velocitySigma, rangePct, price, metrics, context, trend } = input;
  const out: FilterResult[] = [];

  out.push({
    id: "feed",
    label: "qualidade do feed",
    status:
      quality.level === "healthy" ? "pass" : quality.level === "empty" ? "unavailable" : "block",
    detail: `cobertura ${(quality.coverage * 100).toFixed(0)}% · ${quality.missingSeconds} s sem leitura · ${quality.outOfOrder} fora de ordem`,
  });

  out.push({
    id: "data-age",
    label: "idade do dado",
    status: quality.ageMs == null ? "unavailable" : quality.ageMs > MAX_AGE_MS ? "block" : "pass",
    detail:
      quality.ageMs == null
        ? "sem leitura"
        : `${(quality.ageMs / 1000).toFixed(1).replace(".", ",")} s (limite ${MAX_AGE_MS / 1000} s)`,
  });

  out.push({
    id: "tail",
    label: "velocidade de queda",
    status: danger ? "block" : velocitySigma == null ? "unavailable" : "pass",
    detail:
      velocitySigma == null
        ? "não mensurável (mercado parado)"
        : `${velocitySigma.toFixed(2)}σ em 5 s`,
  });

  out.push({
    id: "volatility",
    label: "volatilidade da janela",
    status:
      rangePct == null
        ? "unavailable"
        : rangePct < MIN_RANGE_PCT || rangePct > MAX_RANGE_PCT
          ? "block"
          : "pass",
    detail:
      rangePct == null
        ? "não mensurável"
        : `${pct(rangePct)} (faixa útil ${pct(MIN_RANGE_PCT, 2)}–${pct(MAX_RANGE_PCT, 2)})`,
  });

  // Spread e liquidez dependem do topo do livro; sem ele, não inventamos valor.
  const bid = context.bestBid ?? null;
  const ask = context.bestAsk ?? null;
  const spreadPct = bid != null && ask != null && bid > 0 ? ((ask - bid) / bid) * 100 : null;
  out.push({
    id: "spread",
    label: "spread do livro",
    status: spreadPct == null ? "unavailable" : spreadPct > MAX_SPREAD_PCT ? "block" : "pass",
    detail:
      spreadPct == null
        ? "não disponível — livro de ofertas não recebido"
        : `${pct(spreadPct)} (máx. ${pct(MAX_SPREAD_PCT, 2)})`,
  });

  const stake = context.stakeQuote ?? null;
  const askNotional = ask != null && context.askQty != null ? ask * context.askQty : null;
  // Sem tamanho de aposta declarado não há requisito de liquidez a verificar:
  // o filtro fica "aplicável apenas quando a aposta é dimensionada".
  const liquidityNotApplicable = stake == null || stake <= 0;
  out.push({
    id: "liquidity",
    label: "liquidez no topo do livro",
    status: liquidityNotApplicable
      ? "pass"
      : askNotional == null
        ? "unavailable"
        : askNotional < stake! * MIN_BOOK_MULTIPLE
          ? "block"
          : "pass",
    detail: liquidityNotApplicable
      ? "aposta não dimensionada — requisito não aplicável"
      : askNotional == null
        ? "não disponível — profundidade do livro não recebida"
        : `${askNotional.toFixed(0)} na melhor venda · ${MIN_BOOK_MULTIPLE}× a aposta = ${(stake! * MIN_BOOK_MULTIPLE).toFixed(0)}`,
  });

  // Slippage estimado: metade do spread + impacto se a aposta come o topo.
  const slippagePct =
    spreadPct == null
      ? null
      : spreadPct / 2 +
        (askNotional != null && stake != null && stake > 0 && askNotional > 0
          ? Math.max(0, stake / askNotional - 1) * spreadPct
          : 0);
  out.push({
    id: "slippage",
    label: "slippage estimado",
    status: slippagePct == null ? "unavailable" : slippagePct > MAX_SLIPPAGE_PCT ? "block" : "pass",
    detail:
      slippagePct == null
        ? "não disponível — depende do livro de ofertas"
        : `${pct(slippagePct)} (máx. ${pct(MAX_SLIPPAGE_PCT, 2)})`,
  });

  out.push({
    id: "cluster-stable",
    label: "estabilidade do cluster",
    status: metrics == null ? "unavailable" : isClusterUnstable(metrics) ? "block" : "pass",
    detail:
      metrics == null
        ? "sem caixa vencedora"
        : `concentração ${(metrics.concentration * 100).toFixed(0)}% · vantagem ${(metrics.gapToSecond * 100).toFixed(0)} p.p. · deriva ${metrics.stabilityDriftPct == null ? "—" : pct(metrics.stabilityDriftPct)}${metrics.edgeSensitive ? " · sensível à borda" : ""}`,
  });

  // Patch: tendência de fundo. Só bloqueia — nunca cria sinal.
  out.push({
    id: "trend",
    label: "tendência de fundo × recuperação do preço",
    status: trend == null ? "unavailable" : trend.blocked ? "block" : "pass",
    detail: trend == null ? "não avaliada" : trend.detail,
  });

  // Patch: exposição correlacionada entre pares (BRL juntos, USDT à parte).
  const correlated = context.correlatedOpen ?? null;
  out.push({
    id: "correlation",
    label: "exposição correlacionada",
    status: correlated == null ? "unavailable" : correlated.length > 0 ? "block" : "pass",
    detail:
      correlated == null
        ? "não disponível — apostas abertas não consultadas"
        : correlated.length > 0
          ? `já há aposta em ${correlated.join(", ")}`
          : "nenhum par correlacionado aberto",
  });

  out.push({
    id: "exchange",
    label: "conexão com a exchange",
    status: context.exchangeDown ? "block" : "pass",
    detail: context.exchangeDown ? "sem fluxo da Binance" : "recebendo preço",
  });

  void price;
  return out;
}

/** Filtros que, no modo aprimorado, derrubam o sinal. */
export function blockingFilters(results: readonly FilterResult[]): FilterResult[] {
  return results.filter((r) => r.status === "block" || r.status === "unavailable");
}
