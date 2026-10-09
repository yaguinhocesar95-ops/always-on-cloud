/**
 * Motor de precisão do scalping — determinístico, compartilhado por
 * navegador, servidor e replay.
 *
 * Regras do modelo (agrupamento estatístico de preços / moda):
 *  - janela viva de 180 s (apenas ticks do websocket + semente de 1 s);
 *  - o preço MAIS REPETIDO da janela (moda do histograma de 20 caixas) é o
 *    ÍMÃ ESTATÍSTICO e vira o ALVO (take profit), pois o mercado tende a
 *    voltar a ele;
 *  - a entrada é calculada de trás para frente: gatilho = ímã ÷ 1,0055,
 *    garantindo exatamente +0,55% bruto até o alvo (+0,35% líquido);
 *  - stop = gatilho ÷ 1,0055 (−0,55% da entrada);
 *  - o gatilho só é válido se o preço atual estiver ACIMA dele: esperamos a
 *    queda súbita para pegar o repique até o ímã;
 *  - proteção de cauda: se o preço cair mais de 3 desvios em 5 s, o cálculo é
 *    invalidado (risco de slippage extremo).
 *
 * Fases 3 e 4 entram como MÉTRICAS e FILTROS: no modo "baseline" nada muda
 * nos números; no modo "stable-cluster" os filtros só podem BLOQUEAR.
 */

import {
  EMPTY_QUALITY,
  normalizeTicks,
  type FeedQuality,
  type RawTick,
  type Tick as NormalizedTick,
} from "./feed-quality";
import {
  BIN_COUNT,
  buildPriceBins,
  findMagnet,
  meanAndSd,
  type ClusterPick,
  type PriceBin,
} from "./histogram";
import { computeMagnetMetrics, type MagnetMetrics } from "./magnet-metrics";
import { evaluateFilters, type FilterResult, type MarketContext } from "./filters";
import { assessTrend, type TrendAssessment } from "./trend";

/** Versão do algoritmo — gravada junto de cada aposta do robô. */
export const ENGINE_VERSION = "baseline-1.0.0";
/** Versão do modo aprimorado (filtros ligados). */
export const ENGINE_VERSION_FILTERED = "stable-cluster-1.0.0";

export const NET_TARGET_PCT = 0.0035;
export const FEE_ROUND_TRIP_PCT = 0.002;
export const GROSS_TARGET_PCT = NET_TARGET_PCT + FEE_ROUND_TRIP_PCT; // 0,55%
export const WINDOW_MS = 180_000;
export const VELOCITY_MS = 5_000;
export const VELOCITY_SIGMA = 3;
export const MIN_TICKS = 30;
/** Um ponto por segundo, 180 segundos. */
export const MAX_POINTS = 180;
/** Distância mínima do gatilho ao preço atual (0,10%). */
export const MIN_GAP_PCT = 0.001;

export { BIN_COUNT, buildPriceBins, findMagnet, meanAndSd };
export type { PriceBin, ClusterPick, MagnetMetrics, FilterResult, MarketContext, TrendAssessment };
export type Tick = NormalizedTick;
export type { RawTick, FeedQuality };

/** baseline = números originais; stable-cluster = baseline + filtros. */
export type EngineMode = "baseline" | "stable-cluster";

export type EngineOptions = {
  mode?: EngineMode;
  context?: MarketContext;
};

/** Mantém apenas os últimos 180 pontos (1 por segundo) dentro da janela. */
export function pruneWindow(ticks: Tick[], now = Date.now(), windowMs = WINDOW_MS): Tick[] {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < ticks.length && ticks[i]!.time < cutoff) i++;
  const inWindow = i === 0 ? ticks : ticks.slice(i);
  return inWindow.length > MAX_POINTS ? inWindow.slice(inWindow.length - MAX_POINTS) : inWindow;
}

export type ScalpEngine = {
  /** Último preço da janela. */
  price: number | null;
  ticks: number;
  /** Segundos de dados acumulados (máx. 180). */
  seconds: number;
  warmupPct: number;
  ready: boolean;
  mean: number | null;
  sd: number | null;
  /** Amplitude da janela (máx − mín) em % do preço atual. */
  rangePct: number | null;
  /** Mínimo e máximo da janela. */
  low: number | null;
  high: number | null;
  /** Histograma completo (20 caixas). */
  bins: PriceBin[];
  /** Preço-ímã = centro da caixa mais repetida da janela (é o ALVO). */
  magnetPrice: number | null;
  /** Caixa vencedora (cluster mais repetido da janela). */
  cluster: ClusterPick | null;
  /** Quantas vezes o preço bateu na caixa vencedora. */
  clusterHits: number | null;
  /** Fração da janela concentrada na caixa vencedora. */
  clusterSharePct: number | null;
  /** Largura de cada caixa, em dinheiro. */
  binWidth: number | null;
  /** Distância do preço atual até o gatilho. */
  requiredDrop: number | null;
  requiredDropPct: number | null;
  /** Gatilho de entrada = ímã ÷ 1,0055 (0,55% abaixo do alvo). */
  entryTrigger: number | null;
  /** Alvo bruto = o próprio ímã. Stop = gatilho ÷ 1,0055. */
  grossTarget: number | null;
  stop: number | null;
  /** Queda observada nos últimos 5 s (positiva = caiu). */
  velocityDrop: number;
  velocitySigma: number | null;
  danger: boolean;
  /** Por que não há gatilho: aquecendo, mercado parado, dado ruim, etc. */
  reason: ScalpBlockReason | null;
  /** Todos os motivos de bloqueio ativos, em ordem de prioridade. */
  blockReasons: ScalpBlockReason[];
  /** Versão do algoritmo que produziu este resultado. */
  engineVersion: string;
  /** Modo em vigor. */
  mode: EngineMode;
  /** Instante do cálculo (ms). */
  computedAt: number;
  /** Saúde do dado que alimentou o cálculo. */
  quality: FeedQuality;
  /** Série normalizada usada no cálculo (1 ponto/segundo). */
  window: Tick[];
  /** Métricas de robustez do ímã (Fase 3) — leitura, nunca sinal. */
  metrics: MagnetMetrics | null;
  /** Filtros avaliados (Fase 4), sempre com o componente medido. */
  filters: FilterResult[];
  /** Leitura de tendência de fundo (Patch) — só bloqueia. */
  trend: TrendAssessment | null;
  /** true quando o baseline liberaria o sinal e só os filtros o derrubaram. */
  readyBaseline: boolean;
};

export type ScalpBlockReason =
  | "warmup"
  | "flat"
  | "no-cluster"
  | "below-entry"
  | "danger"
  | "stale-data"
  | "incomplete-data"
  | "tendencia"
  | "correlacionado"
  | "filtro";

export function runScalpEngine(
  rawTicks: readonly RawTick[],
  now = Date.now(),
  options: EngineOptions = {},
): ScalpEngine {
  const mode: EngineMode = options.mode ?? "baseline";
  const context: MarketContext = options.context ?? {};
  const { ticks: w, quality } =
    rawTicks.length === 0
      ? { ticks: [] as Tick[], quality: EMPTY_QUALITY }
      : normalizeTicks(rawTicks, now, WINDOW_MS, MAX_POINTS);
  const prices = w.map((t) => t.price);
  const last = prices.length > 0 ? prices[prices.length - 1]! : null;
  const seconds = w.length > 1 ? Math.min(WINDOW_MS, now - w[0]!.time) / 1000 : 0;
  const warmupPct = Math.max(0, Math.min(1, seconds / (WINDOW_MS / 1000)));

  const empty: ScalpEngine = {
    price: last,
    ticks: w.length,
    seconds,
    warmupPct,
    ready: false,
    readyBaseline: false,
    mean: null,
    sd: null,
    rangePct: null,
    low: null,
    high: null,
    bins: [],
    magnetPrice: null,
    cluster: null,
    clusterHits: null,
    clusterSharePct: null,
    binWidth: null,
    requiredDrop: null,
    requiredDropPct: null,
    entryTrigger: null,
    grossTarget: null,
    stop: null,
    velocityDrop: 0,
    velocitySigma: null,
    danger: false,
    reason: "warmup",
    blockReasons: ["warmup"],
    engineVersion: mode === "baseline" ? ENGINE_VERSION : ENGINE_VERSION_FILTERED,
    mode,
    computedAt: now,
    quality,
    window: w,
    metrics: null,
    filters: [],
    trend: null,
  };

  if (last == null || w.length < MIN_TICKS) return empty;

  const { mean, sd } = meanAndSd(prices);
  if (!isFinite(mean) || !isFinite(sd)) return empty;

  // Velocidade: variação nos últimos 5 segundos.
  const cutoff = now - VELOCITY_MS;
  let refIdx = w.length - 1;
  for (let i = w.length - 1; i >= 0; i--) {
    if (w[i]!.time <= cutoff) {
      refIdx = i;
      break;
    }
    refIdx = i;
  }
  const ref = w[refIdx]!.price;
  const velocityDrop = ref - last; // positivo = caindo
  // Mercado totalmente parado (sd = 0): sem sigma e sem perigo de cauda.
  const velocitySigma = sd > 0 ? velocityDrop / sd : null;
  const danger = velocitySigma != null && velocitySigma > VELOCITY_SIGMA;

  const bins = buildPriceBins(prices);
  const low = bins.length > 0 ? bins[0]!.low : Math.min(...prices);
  const high = bins.length > 0 ? bins[bins.length - 1]!.high : Math.max(...prices);
  const binWidth = bins.length > 0 ? bins[0]!.high - bins[0]!.low : null;

  // Engenharia reversa: o ímã é o ALVO; a entrada nasce 0,55% abaixo dele.
  const cluster = bins.length > 0 ? findMagnet(bins, last) : null;
  const magnetPrice = cluster ? cluster.bin.center : null;
  const rawEntry = magnetPrice == null ? null : magnetPrice / (1 + GROSS_TARGET_PCT);
  // Mercado parado: janela sem amplitude nenhuma não tem repique para capturar.
  const flatMarket = !(high > low) || sd === 0;
  // Só vale se o preço atual estiver ACIMA do gatilho (esperamos a queda).
  const entryTrigger = rawEntry != null && !flatMarket && last > rawEntry ? rawEntry : null;
  const requiredDrop = entryTrigger == null ? null : last - entryTrigger;
  const rangePct = ((high - low) / last) * 100;

  // Fase 3: métricas de robustez do ímã (não alteram nenhum número acima).
  const metrics = cluster ? computeMagnetMetrics(prices, bins, cluster, last) : null;

  // Patch: tendência de fundo da janela completa × queda dos últimos 5 s.
  const trend = assessTrend(prices, velocityDrop ?? 0);

  // Fase 4: filtros sempre avaliados para exibição, com o componente medido.
  const filters = evaluateFilters({
    quality,
    danger,
    velocitySigma,
    rangePct,
    price: last,
    metrics,
    context,
    trend,
  });

  // Motivos do baseline (inalterados).
  const blockReasons: ScalpBlockReason[] = [];
  if (danger) blockReasons.push("danger");
  if (quality.level === "stale") blockReasons.push("stale-data");
  if (quality.level === "degraded") blockReasons.push("incomplete-data");
  if (entryTrigger == null) {
    blockReasons.push(flatMarket ? "flat" : rawEntry != null ? "below-entry" : "no-cluster");
  }
  const readyBaseline = blockReasons.length === 0;

  // No modo aprimorado, qualquer filtro bloqueado ou não mensurável derruba o
  // sinal — nunca cria um. O baseline segue visível lado a lado.
  // Exceção: os filtros que dependem do livro de ofertas (spread e slippage)
  // não derrubam o sinal quando o livro simplesmente não foi recebido — entre
  // pares no ranking o livro nunca existe, e derrubar todos por isso esvaziava
  // a comparação. Com o livro em mãos, eles continuam bloqueando normalmente.
  const bookMissing = context.bestBid == null && context.bestAsk == null;
  const filterBlocked =
    mode === "stable-cluster" &&
    filters.some(
      (f) =>
        f.status !== "pass" &&
        f.id !== "trend" &&
        f.id !== "correlation" &&
        !(
          bookMissing &&
          f.status === "unavailable" &&
          (f.id === "spread" || f.id === "slippage")
        ),
    );
  if (filterBlocked) blockReasons.push("filtro");

  // Patch: bloqueios de pureza aplicados nos dois modos — só bloqueiam.
  if (trend.blocked) blockReasons.push("tendencia");
  if ((context.correlatedOpen?.length ?? 0) > 0) blockReasons.push("correlacionado");

  return {
    price: last,
    ticks: w.length,
    seconds,
    warmupPct,
    ready: blockReasons.length === 0,
    readyBaseline,
    mean,
    sd,
    rangePct,
    low,
    high,
    bins,
    magnetPrice,
    cluster,
    clusterHits: cluster ? cluster.count : null,
    clusterSharePct: cluster ? (cluster.count / prices.length) * 100 : null,
    binWidth,
    requiredDrop,
    requiredDropPct: requiredDrop == null ? null : (requiredDrop / last) * 100,
    entryTrigger,
    grossTarget: entryTrigger == null ? null : magnetPrice,
    stop: entryTrigger == null ? null : entryTrigger / (1 + GROSS_TARGET_PCT),
    velocityDrop,
    velocitySigma,
    danger,
    reason: blockReasons[0] ?? null,
    blockReasons,
    engineVersion: mode === "baseline" ? ENGINE_VERSION : ENGINE_VERSION_FILTERED,
    mode,
    computedAt: now,
    quality,
    window: w,
    metrics,
    filters,
    trend,
  };
}
