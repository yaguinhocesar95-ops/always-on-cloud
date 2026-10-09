/**
 * Fase 6 — replay / validação fora da amostra.
 *
 * Reproduz o MESMO motor determinístico sobre velas históricas de 1 s, com os
 * mesmos dados normalizados do modo ao vivo. Regras duras:
 *  - sem look-ahead: em cada segundo o motor só enxerga velas já fechadas;
 *  - o gatilho só arma quando a vela toca o preço, e a resolução começa no
 *    segundo SEGUINTE ao toque, já descontado o atraso assumido;
 *  - quando a mesma vela toca alvo e stop, a operação é marcada como AMBÍGUA
 *    e a política configurável decide (padrão: conta como perda);
 *  - custos (taxa, spread/slippage estimado, atraso, passo de preço) entram
 *    pelo modelo de execução da Fase 5.
 *
 * Nada aqui envia ordem: é simulação histórica, rotulada como tal.
 */

import {
  buildExecutionModel,
  classifyRegime,
  REGIME_SLIPPAGE_FALLBACK,
  type ExecutionModel,
} from "./execution";
import {
  MAX_POINTS,
  WINDOW_MS,
  runScalpEngine,
  type EngineMode,
  type RawTick,
  type ScalpBlockReason,
} from "./scalp";
import type { FilterId, MarketContext } from "./filters";
import { computeMetrics, type AmbiguityPolicy, type Metrics, type ResolvedTrade } from "./metrics";

/** Vela de 1 segundo vinda da corretora. */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Intervalo mínimo entre sinais do mesmo par (baseline: 10 min). */
export const REPLAY_COOLDOWN_MS = 600_000;
/** Expiração de sinal pendente (baseline: 1 h). */
export const REPLAY_EXPIRY_MS = 3_600_000;

export type ReplayOptions = {
  mode?: EngineMode;
  cooldownMs?: number;
  expiryMs?: number;
  latencyMs?: number;
  feePct?: number;
  tickSize?: number | null;
  /** Spread médio medido; null = usar a premissa do regime (marcado "estimado"). */
  spread?: number | null;
  /**
   * O histórico de velas não traz livro de ofertas. Com `true`, os filtros que
   * dependem do livro (spread, liquidez, slippage) usam a PREMISSA do regime
   * em vez de ficarem "não mensuráveis" — premissa declarada, não medição.
   * Com `false` (padrão), o modo com filtros bloqueia por falta de dado.
   */
  assumeBook?: boolean;
};

export type ReplayTrade = ResolvedTrade & {
  symbol: string;
  mode: EngineMode;
  createdAt: number;
  armedAt: number | null;
  trigger: number;
  target: number;
  stop: number;
  execution: ExecutionModel;
  /** Status final, incluindo os que nunca resolveram. */
  status: "win" | "loss" | "ambiguo" | "expirado" | "aberto";
};

export type ReplayResult = {
  symbol: string;
  mode: EngineMode;
  engineVersion: string;
  /** Primeiro e último segundo cobertos pelos dados. */
  from: number;
  to: number;
  candles: number;
  /** Segundos em que o motor foi avaliado (após o aquecimento). */
  evaluated: number;
  /** Segundos em que o baseline liberaria o sinal. */
  baselineReady: number;
  /** Sinais efetivamente criados. */
  signals: number;
  expired: number;
  stillOpen: number;
  ambiguous: number;
  /** Quantas vezes cada motivo do baseline bloqueou. */
  blockedByReason: Record<string, number>;
  /** Quantas vezes cada filtro (Fase 4) derrubou um sinal do baseline. */
  blockedByFilter: Record<string, number>;
  trades: ReplayTrade[];
};

type ActiveSignal = {
  createdAt: number;
  trigger: number;
  target: number;
  stop: number;
  execution: ExecutionModel;
  regime: string;
  armedAt: number | null;
  /** A partir de quando a resolução pode ocorrer (toque + atraso). */
  liveFrom: number | null;
};

/**
 * Contexto de mercado usado no replay. O histórico de velas não traz livro de
 * ofertas; sem `assumeBook` os filtros dependentes do livro permanecem "não
 * mensuráveis" e o modo com filtros bloqueia (fallback conservador). Com
 * `assumeBook`, usamos a PREMISSA de spread do regime — declarada, nunca
 * apresentada como medição.
 */
function assumedBookContext(
  window: readonly RawTick[],
  close: number,
  options: ReplayOptions,
): MarketContext {
  if (!options.assumeBook) return { stakeQuote: null };
  let hi = -Infinity;
  let lo = Infinity;
  for (const t of window) {
    hi = Math.max(hi, t.price);
    lo = Math.min(lo, t.price);
  }
  const rangePct = close > 0 && isFinite(hi) ? ((hi - lo) / close) * 100 : 0;
  const regime = classifyRegime(rangePct);
  const spread = options.spread ?? REGIME_SLIPPAGE_FALLBACK[regime] * 2;
  const half = (close * spread) / 2;
  return {
    stakeQuote: null,
    bestBid: close - half,
    bestAsk: close + half,
    bidQty: null,
    askQty: null,
  };
}

/**
 * Executa o motor segundo a segundo sobre as velas fornecidas.
 * `candles` deve estar ordenado por tempo crescente, 1 vela por segundo.
 */
export function replayCandles(
  symbol: string,
  candles: readonly Candle[],
  options: ReplayOptions = {},
): ReplayResult {
  const mode: EngineMode = options.mode ?? "baseline";
  const cooldownMs = options.cooldownMs ?? REPLAY_COOLDOWN_MS;
  const expiryMs = options.expiryMs ?? REPLAY_EXPIRY_MS;
  const blockedByReason: Record<string, number> = {};
  const blockedByFilter: Record<string, number> = {};
  const trades: ReplayTrade[] = [];

  let window: RawTick[] = [];
  let active: ActiveSignal | null = null;
  let lastSignalAt = -Infinity;
  let evaluated = 0;
  let baselineReady = 0;
  let signals = 0;
  let expired = 0;
  let ambiguous = 0;
  let engineVersion = "";

  const closeTrade = (
    s: ActiveSignal,
    status: ReplayTrade["status"],
    resolvedAt: number,
    isAmbiguous: boolean,
  ) => {
    if (status === "win" || status === "loss" || status === "ambiguo") {
      trades.push({
        id: `${symbol}-${s.createdAt}`,
        symbol,
        mode,
        hour: new Date(s.createdAt).getHours(),
        engineVersion,
        regime: s.regime,
        outcome: status === "win" ? "win" : "loss",
        ambiguous: isAmbiguous,
        netIfWin: s.execution.netIfWin,
        netIfLoss: s.execution.netIfLoss,
        resolvedAt,
        createdAt: s.createdAt,
        armedAt: s.armedAt,
        trigger: s.trigger,
        target: s.target,
        stop: s.stop,
        execution: s.execution,
        status,
      });
      if (isAmbiguous) ambiguous += 1;
    } else if (status === "expirado") {
      expired += 1;
    }
  };

  for (const candle of candles) {
    const now = candle.time;

    // 1) Evolução do sinal aberto — usa apenas a vela corrente.
    if (active) {
      if (active.armedAt == null) {
        if (candle.low <= active.trigger) {
          active.armedAt = now;
          // Resolução só a partir do atraso assumido (sem look-ahead).
          active.liveFrom = now + active.execution.latencyMs;
        } else if (now - active.createdAt >= expiryMs) {
          closeTrade(active, "expirado", now, false);
          active = null;
        }
      } else if (active.liveFrom != null && now >= active.liveFrom) {
        const hitTarget = candle.high >= active.execution.targetFill;
        const hitStop = candle.low <= active.execution.stopFill;
        if (hitTarget && hitStop) {
          closeTrade(active, "ambiguo", now, true);
          active = null;
        } else if (hitTarget) {
          closeTrade(active, "win", now, false);
          active = null;
        } else if (hitStop) {
          closeTrade(active, "loss", now, false);
          active = null;
        }
      }
    }

    // 2) Alimenta a janela viva com o fechamento do segundo.
    window.push({ time: now, price: candle.close, source: "trade" });
    if (window.length > MAX_POINTS * 2) window = window.slice(-MAX_POINTS);

    // 3) Avalia o motor com os dados já fechados. A avaliação acontece em TODO
    //    segundo (para medir liberação e bloqueios); só a criação do sinal
    //    respeita "um sinal por vez" e o intervalo mínimo por par.
    const engine = runScalpEngine(window, now, {
      mode,
      context: assumedBookContext(window, candle.close, options),
    });
    engineVersion = engine.engineVersion;
    if (engine.ticks < MAX_POINTS / 2) continue; // ainda aquecendo
    evaluated += 1;
    if (engine.readyBaseline) baselineReady += 1;

    if (!engine.ready) {
      for (const r of engine.blockReasons) {
        if (r === "filtro") continue;
        blockedByReason[r] = (blockedByReason[r] ?? 0) + 1;
      }
      if (engine.readyBaseline) {
        for (const f of engine.filters) {
          if (f.status !== "pass") {
            const id: FilterId = f.id;
            blockedByFilter[id] = (blockedByFilter[id] ?? 0) + 1;
          }
        }
      }
      continue;
    }

    if (active != null || now - lastSignalAt < cooldownMs) continue;
    if (engine.entryTrigger == null || engine.grossTarget == null || engine.stop == null) continue;

    const regime = classifyRegime(engine.rangePct);
    const execution = buildExecutionModel({
      trigger: engine.entryTrigger,
      target: engine.grossTarget,
      stop: engine.stop,
      spread: options.spread ?? null,
      regime,
      tickSize: options.tickSize ?? null,
      ...(options.latencyMs != null ? { latencyMs: options.latencyMs } : {}),
      ...(options.feePct != null ? { fee: options.feePct } : {}),
    });

    active = {
      createdAt: now,
      trigger: engine.entryTrigger,
      target: engine.grossTarget,
      stop: engine.stop,
      execution,
      regime,
      armedAt: null,
      liveFrom: null,
    };
    signals += 1;
    lastSignalAt = now;
  }

  const stillOpen = active != null ? 1 : 0;

  return {
    symbol,
    mode,
    engineVersion,
    from: candles.length > 0 ? candles[0]!.time : 0,
    to: candles.length > 0 ? candles[candles.length - 1]!.time : 0,
    candles: candles.length,
    evaluated,
    baselineReady,
    signals,
    expired,
    stillOpen,
    ambiguous,
    blockedByReason,
    blockedByFilter,
    trades,
  };
}

/** Rótulo legível dos motivos do baseline. */
export const REASON_LABEL: Record<ScalpBlockReason | string, string> = {
  warmup: "aquecendo",
  flat: "mercado parado",
  "no-cluster": "sem cluster",
  "below-entry": "preço abaixo do gatilho",
  danger: "perigo de cauda",
  "stale-data": "dado atrasado",
  "incomplete-data": "dado incompleto",
  filtro: "filtro",
};

/* ------------------------------------------------------------------ */
/* Separação por tempo: treino / validação / teste                     */
/* ------------------------------------------------------------------ */

export type SplitName = "treino" | "validacao" | "teste";

export const SPLIT_LABEL: Record<SplitName, string> = {
  treino: "treino",
  validacao: "validação",
  teste: "teste (fora da amostra)",
};

export type SplitSlice = {
  name: SplitName;
  from: number;
  to: number;
  trades: ReplayTrade[];
  metrics: Metrics;
};

/** Limites por tempo de treino/validação/teste (frações somam 1). */
export function timeBounds(
  from: number,
  to: number,
  fractions: [number, number, number] = [0.5, 0.25, 0.25],
): Array<{ name: SplitName; from: number; to: number }> {
  const span = Math.max(1, to - from);
  const b1 = from + span * fractions[0];
  const b2 = b1 + span * fractions[1];
  return [
    { name: "treino", from, to: b1 },
    { name: "validacao", from: b1, to: b2 },
    { name: "teste", from: b2, to },
  ];
}

/**
 * Corta a linha do tempo em treino/validação/teste (50/25/25 por padrão).
 * Nunca ajuste parâmetro olhando o mesmo período usado para declarar
 * desempenho: o bloco "teste" existe só para leitura final.
 */
export function splitByTime(
  result: ReplayResult,
  policy: AmbiguityPolicy = "conservadora",
  fractions: [number, number, number] = [0.5, 0.25, 0.25],
): SplitSlice[] {
  const bounds = timeBounds(result.from, result.to, fractions);
  return bounds.map((b) => {
    const trades = result.trades.filter((t) => t.createdAt >= b.from && t.createdAt < b.to);
    return { ...b, trades, metrics: computeMetrics(trades, policy) };
  });
}

export type WalkForwardFold = {
  index: number;
  from: number;
  to: number;
  trades: number;
  metrics: Metrics;
};

/** Walk-forward simples: blocos de tempo iguais, avaliados em sequência. */
export function walkForward(
  result: ReplayResult,
  folds = 4,
  policy: AmbiguityPolicy = "conservadora",
): WalkForwardFold[] {
  const span = Math.max(1, result.to - result.from);
  const step = span / Math.max(1, folds);
  const out: WalkForwardFold[] = [];
  for (let i = 0; i < folds; i++) {
    const from = result.from + step * i;
    const to = i === folds - 1 ? result.to + 1 : from + step;
    const trades = result.trades.filter((t) => t.createdAt >= from && t.createdAt < to);
    out.push({
      index: i + 1,
      from,
      to,
      trades: trades.length,
      metrics: computeMetrics(trades, policy),
    });
  }
  return out;
}

/** CSV das operações simuladas, para auditoria fora da ferramenta. */
export function tradesToCsv(trades: readonly ReplayTrade[]): string {
  const head = [
    "id",
    "par",
    "modo",
    "criado_em",
    "armado_em",
    "resolvido_em",
    "hora_local",
    "regime",
    "gatilho",
    "alvo",
    "stop",
    "entrada_executada",
    "alvo_executado",
    "stop_executado",
    "taxa",
    "slippage_por_perna",
    "origem_slippage",
    "liquido_se_ganha",
    "liquido_se_perde",
    "status",
    "ambiguo",
  ].join(",");
  const iso = (t: number | null) => (t == null ? "" : new Date(t).toISOString());
  const rows = trades.map((t) =>
    [
      t.id,
      t.symbol,
      t.mode,
      iso(t.createdAt),
      iso(t.armedAt),
      iso(t.resolvedAt),
      t.hour,
      t.regime,
      t.trigger,
      t.target,
      t.stop,
      t.execution.entryFill,
      t.execution.targetFill,
      t.execution.stopFill,
      t.execution.fee,
      t.execution.slippagePerLeg,
      t.execution.slippageSource,
      t.netIfWin,
      t.netIfLoss,
      t.status,
      t.ambiguous ? "sim" : "nao",
    ].join(","),
  );
  return [head, ...rows].join("\n");
}

/** Detecta mudança de regime ao longo do período (amplitude por bloco). */
export type RegimeSegment = { from: number; to: number; rangePct: number; regime: string };

export function detectRegimes(candles: readonly Candle[], blockMs = 900_000): RegimeSegment[] {
  if (candles.length === 0) return [];
  const out: RegimeSegment[] = [];
  let start = 0;
  while (start < candles.length) {
    const from = candles[start]!.time;
    let end = start;
    let hi = -Infinity;
    let lo = Infinity;
    while (end < candles.length && candles[end]!.time - from < blockMs) {
      hi = Math.max(hi, candles[end]!.high);
      lo = Math.min(lo, candles[end]!.low);
      end++;
    }
    const last = candles[Math.min(end, candles.length - 1)]!;
    const rangePct = last.close > 0 ? ((hi - lo) / last.close) * 100 : 0;
    out.push({ from, to: last.time, rangePct, regime: classifyRegime(rangePct) });
    start = end;
  }
  return out;
}

/** Janela máxima de dados de 1 s que a corretora entrega por requisição. */
export const KLINE_PAGE = 1000;

/** Busca velas de 1 s da Binance, paginando até cobrir o período pedido. */
export async function fetchCandles(
  symbol: string,
  minutes: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const total = Math.max(1, Math.round(minutes * 60));
  const endTime = Date.now();
  const startTime = endTime - total * 1000;
  const out: Candle[] = [];
  let cursor = startTime;
  while (cursor < endTime && out.length < total + KLINE_PAGE) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1s&startTime=${cursor}&limit=${KLINE_PAGE}`;
    const res = await fetch(url, signal ? { signal } : {});
    if (!res.ok) throw new Error(`Binance ${res.status}`);
    const rows = (await res.json()) as unknown[][];
    if (rows.length === 0) break;
    for (const r of rows) {
      out.push({
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
      });
    }
    const lastTime = Number(rows[rows.length - 1]![0]);
    if (!isFinite(lastTime) || lastTime <= cursor) break;
    cursor = lastTime + 1000;
  }
  return out.filter((c) => isFinite(c.close) && c.close > 0);
}

export { WINDOW_MS };
