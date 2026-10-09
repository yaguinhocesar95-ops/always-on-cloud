/**
 * Validar Aposta Supremo — lógica pura (sem rede, sem relógio).
 *
 * Tudo aqui recebe velas de 1 s reais (Binance) e devolve números. Nenhum dado
 * de mercado é inventado: segundos sem negócio mantêm o último preço (o preço
 * não mudou), e horas com cobertura baixa são marcadas e excluídas.
 */
import type { Candle } from "./replay";
import { GROSS_TARGET_PCT } from "./scalp";
import { buildExecutionModel, classifyRegime, type ExecutionModel } from "./execution";
import { computeMetrics, type Metrics, type ResolvedTrade } from "./metrics";
import { MAX_AGE_MS, MIN_COVERAGE } from "./feed-quality";
import { VELOCITY_MS, VELOCITY_SIGMA } from "./scalp";

// ===== Constantes configuráveis =====
/** Largura fixa de cada faixa, relativa ao preço (0,25%). */
export const BAND_PCT = 0.0025;
/** Tempo mínimo fora da faixa para uma nova entrada contar como nova visita. */
export const REVISIT_GAP_MS = 5_000;
/** Índice mínimo para liberar a aposta ao vivo. */
export const MIN_REPETICOES = 3;
/** Cobertura mínima de segundos com vela para a hora valer. */
export const SUPREMO_MIN_COVERAGE = MIN_COVERAGE;
/** Dado mais velho que isso bloqueia a aposta ao vivo. */
export const SUPREMO_MAX_AGE_MS = MAX_AGE_MS;
/** Multiplicador gatilho→alvo e stop→gatilho (+0,55% bruto, igual ao app). */
export const LEG_MULT = 1 + GROSS_TARGET_PCT;
export const HOUR_MS = 3_600_000;
export const DEFAULT_TOP_N = 60;
export const DEFAULT_MIN_VOLUME_USDT = 1_000_000;
export const DEFAULT_PERIOD_HOURS = 6;
export const SMALL_SAMPLE = 30;
export const STRONG_SAMPLE = 100;

// ===== Faixas =====
/** Índice da faixa (log-espaçada, largura bandPct relativa ao preço). */
export function bandIndex(price: number, bandPct = BAND_PCT): number {
  return Math.floor(Math.log(price) / Math.log(1 + bandPct));
}
export function bandBounds(index: number, bandPct = BAND_PCT) {
  const low = Math.pow(1 + bandPct, index);
  const high = low * (1 + bandPct);
  return { low, high, center: (low + high) / 2 };
}

export type BandStat = {
  index: number;
  low: number;
  high: number;
  center: number;
  /** Segundos de permanência na faixa (com o último preço mantido nos segundos sem negócio). */
  seconds: number;
  /** Visitas separadas (entrada após ≥ 5 s fora). */
  visits: number;
  /** Instantes em que cada visita começou. */
  visitTimes: number[];
};

/**
 * Histograma de permanência + contagem de visitas por faixa.
 * `endTime` fecha a duração da última vela (padrão: +1 s).
 */
export function bandStats(
  candles: readonly Candle[],
  bandPct = BAND_PCT,
  endTime?: number,
  gapMs = REVISIT_GAP_MS,
): BandStat[] {
  const map = new Map<number, BandStat>();
  const outSince = new Map<number, number | null>();
  let prevBand: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (!(c.close > 0)) continue;
    const idx = bandIndex(c.close, bandPct);
    const next = candles[i + 1]?.time ?? endTime ?? c.time + 1000;
    const dur = Math.max(1, Math.round((next - c.time) / 1000));
    let s = map.get(idx);
    if (!s) {
      s = { index: idx, ...bandBounds(idx, bandPct), seconds: 0, visits: 0, visitTimes: [] };
      map.set(idx, s);
    }
    s.seconds += dur;
    if (prevBand !== idx) {
      // Saiu da faixa anterior: marca desde quando ela está "fora".
      if (prevBand != null && outSince.get(prevBand) == null) outSince.set(prevBand, c.time);
      const since = outSince.get(idx);
      const isNew = !map.has(idx) || s.visits === 0 || (since != null && c.time - since >= gapMs);
      if (isNew) {
        s.visits += 1;
        s.visitTimes.push(c.time);
      }
      outSince.set(idx, null);
    }
    prevBand = idx;
  }
  return [...map.values()];
}

/** Ordena: mais segundos → mais visitas → menor preço. */
export function rankBands(stats: readonly BandStat[]): BandStat[] {
  return [...stats].sort(
    (a, b) => b.seconds - a.seconds || b.visits - a.visits || a.center - b.center,
  );
}

export type HourAnalysis = {
  hourStart: number;
  coverage: number;
  complete: boolean;
  /** Faixa mais repetida (mais segundos). */
  top: BandStat | null;
  /** Segunda colocada (fallback do alvo). */
  second: BandStat | null;
  /** Índice de repetição = visitas à faixa mais repetida. */
  index: number;
  lastClose: number | null;
  rangePct: number | null;
  bands: BandStat[];
};

export function coverageOf(candles: readonly Candle[], spanMs: number): number {
  if (spanMs <= 0) return 0;
  return Math.min(1, candles.length / Math.round(spanMs / 1000));
}

/** Analisa um bloco de velas (uma hora fechada ou a janela móvel de 60 min). */
export function analyzeWindow(
  candles: readonly Candle[],
  start: number,
  spanMs = HOUR_MS,
  bandPct = BAND_PCT,
): HourAnalysis {
  const coverage = coverageOf(candles, spanMs);
  const bands = rankBands(bandStats(candles, bandPct, start + spanMs));
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  return {
    hourStart: start,
    coverage,
    complete: coverage >= SUPREMO_MIN_COVERAGE,
    top: bands[0] ?? null,
    second: bands[1] ?? null,
    index: bands[0]?.visits ?? 0,
    lastClose: candles.length ? candles[candles.length - 1]!.close : null,
    rangePct: isFinite(lo) && lo > 0 ? ((hi - lo) / lo) * 100 : null,
    bands,
  };
}

/** Separa velas em horas fechadas [start, start+1h). */
export function splitHours(candles: readonly Candle[], from: number, hours: number): Candle[][] {
  const out: Candle[][] = Array.from({ length: hours }, () => []);
  for (const c of candles) {
    const h = Math.floor((c.time - from) / HOUR_MS);
    if (h >= 0 && h < hours) out[h]!.push(c);
  }
  return out;
}

// ===== Aposta =====
export type SupremoBetPlan = {
  target: number;
  trigger: number;
  stop: number;
  band: BandStat;
  usedSecond: boolean;
};

/**
 * Alvo = centro da faixa mais repetida; se o preço já está nela ou acima do
 * alvo, usa a segunda colocada (igual ao scalp.ts). Gatilho = alvo ÷ 1,0055;
 * stop = gatilho ÷ 1,0055.
 */
export function planBet(a: Pick<HourAnalysis, "top" | "second">, price: number): SupremoBetPlan | null {
  const ok = (b: BandStat | null) => b != null && !(price >= b.low && price <= b.high) && price < b.center;
  let band: BandStat | null = null;
  let usedSecond = false;
  if (ok(a.top)) band = a.top;
  else if (ok(a.second)) {
    band = a.second;
    usedSecond = true;
  }
  if (!band) return null;
  const target = band.center;
  const trigger = target / LEG_MULT;
  const stop = trigger / LEG_MULT;
  return { target, trigger, stop, band, usedSecond };
}

export type SimOutcome = "win" | "loss" | "nao-executada" | "sem-desfecho";

export type SimResult = {
  outcome: SimOutcome;
  ambiguous: boolean;
  armedAt: number | null;
  resolvedAt: number | null;
};

/**
 * Simula a aposta nas velas de 1 s: abre quando o preço cruza o gatilho (no
 * sentido em que estava na criação); alvo e stop só contam a partir da vela
 * seguinte ao acionamento (como no placar). Mesma vela tocando alvo e stop =
 * derrota (política conservadora do app).
 */
export function simulateBet(
  plan: Pick<SupremoBetPlan, "trigger" | "target" | "stop">,
  priceAtCreate: number,
  candles: readonly Candle[],
): SimResult {
  let armedAt: number | null = null;
  const fromBelow = priceAtCreate <= plan.trigger;
  for (const c of candles) {
    if (armedAt == null) {
      const touched = fromBelow ? c.high >= plan.trigger : c.low <= plan.trigger;
      if (touched) armedAt = c.time;
      continue;
    }
    const hitT = c.high >= plan.target;
    const hitS = c.low <= plan.stop;
    if (hitT && hitS) return { outcome: "loss", ambiguous: true, armedAt, resolvedAt: c.time };
    if (hitT) return { outcome: "win", ambiguous: false, armedAt, resolvedAt: c.time };
    if (hitS) return { outcome: "loss", ambiguous: false, armedAt, resolvedAt: c.time };
  }
  return {
    outcome: armedAt == null ? "nao-executada" : "sem-desfecho",
    ambiguous: false,
    armedAt,
    resolvedAt: null,
  };
}

// ===== Backtest =====
export type CoinHours = {
  symbol: string;
  /** Velas por hora fechada, na mesma ordem de `hourStarts`. */
  hours: Candle[][];
};

export type BacktestRow = {
  hourStart: number;
  symbol: string;
  index: number;
  target: number;
  trigger: number;
  stop: number;
  priceAtCreate: number;
  usedSecond: boolean;
  outcome: SimOutcome;
  ambiguous: boolean;
  netIfWin: number;
  netIfLoss: number;
  execution: ExecutionModel;
};

export type CostOptions = { fee?: number; spread?: number | null };

function toTrade(r: BacktestRow): ResolvedTrade | null {
  if (r.outcome !== "win" && r.outcome !== "loss") return null;
  return {
    id: `${r.symbol}-${r.hourStart}`,
    symbol: r.symbol,
    hour: new Date(r.hourStart).getHours(),
    engineVersion: "supremo-1.0.0",
    regime: r.execution.regime,
    outcome: r.outcome,
    ambiguous: r.ambiguous,
    netIfWin: r.netIfWin,
    netIfLoss: r.netIfLoss,
    resolvedAt: r.hourStart,
  };
}

export function rowsMetrics(rows: readonly BacktestRow[]): Metrics {
  return computeMetrics(rows.map(toTrade).filter((t): t is ResolvedTrade => t != null), "conservadora");
}

function buildRow(
  symbol: string,
  prev: HourAnalysis,
  next: readonly Candle[],
  hourStart: number,
  cost: CostOptions,
): BacktestRow | null {
  if (prev.lastClose == null) return null;
  const plan = planBet(prev, prev.lastClose);
  if (!plan) return null;
  const sim = simulateBet(plan, prev.lastClose, next);
  const execution = buildExecutionModel({
    trigger: plan.trigger,
    target: plan.target,
    stop: plan.stop,
    regime: classifyRegime(prev.rangePct),
    ...(cost.fee != null ? { fee: cost.fee } : {}),
    ...(cost.spread != null ? { spread: cost.spread } : {}),
  });
  return {
    hourStart,
    symbol,
    index: prev.index,
    target: plan.target,
    trigger: plan.trigger,
    stop: plan.stop,
    priceAtCreate: prev.lastClose,
    usedSecond: plan.usedSecond,
    outcome: sim.outcome,
    ambiguous: sim.ambiguous,
    netIfWin: execution.netIfWin,
    netIfLoss: execution.netIfLoss,
    execution,
  };
}

export type BacktestResult = {
  /** Regra Supremo: a moeda de maior índice na hora anterior. */
  chosen: BacktestRow[];
  /** Mesma aposta simulada em TODAS as moedas válidas, toda hora (sem escolher). */
  isolated: BacktestRow[];
  chosenMetrics: Metrics;
  isolatedMetrics: Metrics;
  perCoin: {
    symbol: string;
    chosenWins: number;
    chosenCount: number;
    isolatedWins: number;
    isolatedCount: number;
  }[];
};

/**
 * Em cada virada de hora h (1..N-1): escolhe a moeda com maior índice na hora
 * h-1 (desempate: mais segundos na faixa) entre as horas completas, e simula a
 * hora h.
 */
export function runBacktest(
  coins: readonly CoinHours[],
  hourStarts: readonly number[],
  bandPct = BAND_PCT,
  cost: CostOptions | ((symbol: string) => CostOptions) = {},
): BacktestResult {
  const costFor = typeof cost === "function" ? cost : () => cost;
  const analyses = coins.map((c) =>
    c.hours.map((h, i) => analyzeWindow(h, hourStarts[i]!, HOUR_MS, bandPct)),
  );
  const chosen: BacktestRow[] = [];
  const isolated: BacktestRow[] = [];
  for (let h = 1; h < hourStarts.length; h++) {
    let best: { ci: number; a: HourAnalysis } | null = null;
    for (let ci = 0; ci < coins.length; ci++) {
      const a = analyses[ci]![h - 1]!;
      const nextCov = coverageOf(coins[ci]!.hours[h]!, HOUR_MS);
      if (!a.complete || nextCov < SUPREMO_MIN_COVERAGE || !a.top) continue;
      const row = buildRow(coins[ci]!.symbol, a, coins[ci]!.hours[h]!, hourStarts[h]!, costFor(coins[ci]!.symbol));
      if (row) isolated.push(row);
      if (
        !best ||
        a.index > best.a.index ||
        (a.index === best.a.index && a.top.seconds > (best.a.top?.seconds ?? 0))
      ) {
        // Só vale se a aposta for montável.
        if (row) best = { ci, a };
      }
    }
    if (best) {
      const row = isolated.find(
        (r) => r.symbol === coins[best!.ci]!.symbol && r.hourStart === hourStarts[h],
      );
      if (row) chosen.push(row);
    }
  }
  const per = new Map<string, BacktestResult["perCoin"][number]>();
  const get = (s: string) => {
    let p = per.get(s);
    if (!p) {
      p = { symbol: s, chosenWins: 0, chosenCount: 0, isolatedWins: 0, isolatedCount: 0 };
      per.set(s, p);
    }
    return p;
  };
  for (const r of isolated) {
    if (r.outcome !== "win" && r.outcome !== "loss") continue;
    const p = get(r.symbol);
    p.isolatedCount += 1;
    if (r.outcome === "win") p.isolatedWins += 1;
  }
  for (const r of chosen) {
    if (r.outcome !== "win" && r.outcome !== "loss") continue;
    const p = get(r.symbol);
    p.chosenCount += 1;
    if (r.outcome === "win") p.chosenWins += 1;
  }
  return {
    chosen,
    isolated,
    chosenMetrics: rowsMetrics(chosen),
    isolatedMetrics: rowsMetrics(isolated),
    perCoin: [...per.values()].sort((a, b) => b.chosenCount - a.chosenCount || b.isolatedCount - a.isolatedCount),
  };
}

export function sampleLabel(n: number): string {
  if (n < SMALL_SAMPLE) return "amostra pequena";
  if (n >= STRONG_SAMPLE) return "amostra forte";
  return "amostra moderada";
}

// ===== Bloqueios da aposta ao vivo =====
export type LiveBlock =
  | "dados-velhos"
  | "cobertura"
  | "parado"
  | "perigo"
  | "indice-baixo"
  | "sem-alvo"
  | "trauma"
  | "stablecoin"
  | "longe-do-gatilho"
  | "alvo-ultrapassado"
  | "taxa-baixa"
  | "mercado-em-queda"
  | "mercado-em-alta"
  | "derrota-recente"
  | "pausa-pos-derrota"
  | "em-alta-recente"
  | "perseguindo-alta";

export const LIVE_BLOCK_LABEL: Record<LiveBlock, string> = {
  "dados-velhos": "dados velhos (> 3 s)",
  cobertura: "cobertura abaixo de 60%",
  parado: "mercado parado",
  perigo: "perigo: queda > 3 desvios em 5 s",
  "indice-baixo": "índice abaixo do mínimo",
  "sem-alvo": "sem alvo acima do preço",
  trauma: "trauma da moeda: em observação após queda forte",
  stablecoin: "stablecoin ou faixa de 24 h abaixo de 0,3%",
  "longe-do-gatilho": "preço longe do gatilho (monitorando)",
  "alvo-ultrapassado": "preço já está no alvo ou acima",
  "taxa-baixa": "taxa de acerto histórica abaixo do ponto de equilíbrio",
  "mercado-em-queda": "mercado em queda: apostas pausadas",
  "mercado-em-alta": "mercado em alta: moeda sem histórico acima do ponto de equilíbrio (amostra ≥ 5)",
  "derrota-recente": "derrota recente nesta moeda (penalidade)",
  "pausa-pos-derrota": "pausa de 10 min após derrota",
  "em-alta-recente": "passou do alvo sem armar há pouco (15 min)",
  "perseguindo-alta": "subiu mais de 0,30% nos últimos 5 min",
};

/** Diagnóstico do critério de perigo: queda observada, desvio-padrão e limite. */
export type DangerStats = {
  danger: boolean;
  /** Variação relativa dos últimos 5 s (negativa = queda). */
  last: number;
  mean: number;
  sd: number;
  /** Distância máxima tolerada da média (sigma × desvio-padrão). */
  limit: number;
};

export function dangerStats(candles: readonly Candle[], stepMs = VELOCITY_MS, sigma = VELOCITY_SIGMA): DangerStats | null {
  const step = Math.round(stepMs / 1000);
  if (candles.length < step * 4) return null;
  const closes = candles.map((c) => c.close);
  const diffs: number[] = [];
  for (let i = step; i < closes.length; i++) diffs.push((closes[i]! - closes[i - step]!) / closes[i - step]!);
  const last = diffs[diffs.length - 1]!;
  const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / diffs.length);
  return { danger: sd > 0 && last < 0 && Math.abs(last - mean) > sigma * sd, last, mean, sd, limit: sigma * sd };
}

/** Queda dos últimos 5 s maior que 3 desvios-padrão das variações de 5 s da janela. */
export function isDanger(candles: readonly Candle[], stepMs = VELOCITY_MS, sigma = VELOCITY_SIGMA): boolean {
  return dangerStats(candles, stepMs, sigma)?.danger ?? false;
}

export function isFlat(candles: readonly Candle[]): boolean {
  if (candles.length < 2) return true;
  const tail = candles.slice(-60);
  return tail.every((c) => c.high === tail[0]!.high && c.low === tail[0]!.low);
}

export function liveBlocks(input: {
  analysis: HourAnalysis;
  candles: readonly Candle[];
  fetchedAt: number;
  price: number;
  minRep: number;
}): LiveBlock[] {
  const out: LiveBlock[] = [];
  const last = input.candles[input.candles.length - 1];
  // Vela de 1 s aberta em t fecha em t+1 s; o atraso é medido a partir daí.
  if (!last || input.fetchedAt - (last.time + 1000) > SUPREMO_MAX_AGE_MS) out.push("dados-velhos");
  if (!input.analysis.complete) out.push("cobertura");
  if (isFlat(input.candles)) out.push("parado");
  if (isDanger(input.candles)) out.push("perigo");
  if (input.analysis.index < input.minRep) out.push("indice-baixo");
  if (!planBet(input.analysis, input.price)) out.push("sem-alvo");
  return out;
}

export function rowsToCsv(rows: readonly BacktestRow[]): string {
  const head = "hora,moeda,indice,preco_criacao,gatilho,alvo,stop,segunda_faixa,resultado,ambigua,liquido_se_ganha,liquido_se_perde";
  const lines = rows.map((r) =>
    [
      new Date(r.hourStart).toISOString(),
      r.symbol,
      r.index,
      r.priceAtCreate,
      r.trigger,
      r.target,
      r.stop,
      r.usedSecond ? "sim" : "nao",
      r.outcome,
      r.ambiguous ? "sim" : "nao",
      r.netIfWin.toFixed(6),
      r.netIfLoss.toFixed(6),
    ].join(","),
  );
  return [head, ...lines].join("\n");
}
