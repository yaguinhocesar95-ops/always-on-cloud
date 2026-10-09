/**
 * Supremo — chance histórica de bater o ALVO antes do STOP (lógica pura).
 *
 * Recebe velas de 1 minuto (até 24 h) e o plano ATUAL da moeda (alvo,
 * gatilho, stop) e mede, no passado recente, quantas vezes "gatilho tocado →
 * alvo" aconteceu contra "gatilho tocado → stop". Nada de rede nem relógio.
 */
import type { Candle } from "./replay";
import { BAND_PCT, HOUR_MS, MIN_REPETICOES, bandBounds, bandIndex, bandStats, rankBands } from "./supremo";
import { wilsonInterval } from "./metrics";
import { breakEvenDoPlano } from "./supremo-economics";

export const MINUTE_MS = 60_000;
export const CYCLE_EXPIRY_MIN = 30;
export const WINDOWS_H = [1, 3, 6, 24] as const;
export type WindowH = (typeof WINDOWS_H)[number];

export type SampleClass = "insuficiente" | "pequena" | "ok";
export function sampleClass(n: number): SampleClass {
  if (n < 5) return "insuficiente";
  if (n < 15) return "pequena";
  return "ok";
}

export function wilsonLower(wins: number, n: number): number | null {
  return wilsonInterval(wins, n)?.low ?? null;
}

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// ===== a) Toques na faixa-ímã =====
/** Faixa de 0,25% que contém o alvo (mesma grade de faixas do Supremo). */
export function magnetBand(target: number, bandPct = BAND_PCT) {
  return bandBounds(bandIndex(target, bandPct), bandPct);
}

/**
 * Visitas à faixa: uma vela "toca" se seu intervalo [low, high] cruza a
 * faixa. Nova visita só depois de pelo menos 1 vela inteira fora.
 */
export function countMagnetTouches(candles: readonly Candle[], target: number, bandPct = BAND_PCT): number {
  const { low, high } = magnetBand(target, bandPct);
  let touches = 0;
  let inside = false;
  for (const c of candles) {
    const hit = c.low <= high && c.high >= low;
    if (hit && !inside) touches++;
    inside = hit;
  }
  return touches;
}

// ===== b) Ciclos gatilho → alvo / stop =====
export type CyclePlan = { target: number; trigger: number; stop: number };
export type Cycle = { triggerAt: number; outcome: "alvo" | "stop" | "expirou"; minutes: number };

/**
 * Para cada toque no gatilho (low ≤ gatilho), simula a partir da vela
 * seguinte. Mesma vela com alvo e stop = derrota. 30 min sem desfecho =
 * "expirou". Depois de um ciclo, um novo só começa quando o preço voltar
 * acima do gatilho (vela com low > gatilho) e tocar de novo.
 */
export function simulateCycles(
  candles: readonly Candle[],
  plan: CyclePlan,
  expiryMin = CYCLE_EXPIRY_MIN,
): Cycle[] {
  const out: Cycle[] = [];
  let armed = true; // pode iniciar ciclo
  let i = 0;
  while (i < candles.length) {
    const c = candles[i]!;
    if (!armed) {
      if (c.low > plan.trigger) armed = true;
      i++;
      continue;
    }
    if (c.low > plan.trigger) {
      i++;
      continue;
    }
    // Gatilho tocado nesta vela.
    const t0 = c.time;
    let j = i + 1;
    let res: Cycle | null = null;
    for (; j < candles.length; j++) {
      const k = candles[j]!;
      const minutes = (k.time - t0) / MINUTE_MS;
      if (minutes > expiryMin) {
        res = { triggerAt: t0, outcome: "expirou", minutes: expiryMin };
        break;
      }
      const hitT = k.high >= plan.target;
      const hitS = k.low <= plan.stop;
      if (hitT && hitS) { res = { triggerAt: t0, outcome: "stop", minutes }; break; }
      if (hitT) { res = { triggerAt: t0, outcome: "alvo", minutes }; break; }
      if (hitS) { res = { triggerAt: t0, outcome: "stop", minutes }; break; }
    }
    if (!res) break; // ciclo ainda em andamento no fim dos dados: não conta
    out.push(res);
    armed = false;
    i = res.outcome === "expirou" ? j : j + 1;
  }
  return out;
}

export type CycleStats = {
  alvos: number;
  stops: number;
  expirados: number;
  /** alvos ÷ (alvos + stops); null sem ciclos resolvidos. */
  taxaAcerto: number | null;
  wilsonLow: number | null;
  amostra: SampleClass;
  tempoMedianoAteAlvo: number | null;
};

export function cycleStats(cycles: readonly Cycle[]): CycleStats {
  const alvos = cycles.filter((c) => c.outcome === "alvo");
  const stops = cycles.filter((c) => c.outcome === "stop").length;
  const n = alvos.length + stops;
  return {
    alvos: alvos.length,
    stops,
    expirados: cycles.filter((c) => c.outcome === "expirou").length,
    taxaAcerto: n ? alvos.length / n : null,
    wilsonLow: wilsonLower(alvos.length, n),
    amostra: sampleClass(n),
    tempoMedianoAteAlvo: median(alvos.map((c) => c.minutes)),
  };
}

/** Mediana do tempo (min) entre toques consecutivos no gatilho. */
export function medianTimeToTrigger(candles: readonly Candle[], trigger: number): number | null {
  const times: number[] = [];
  let inside = false;
  for (const c of candles) {
    const hit = c.low <= trigger;
    if (hit && !inside) times.push(c.time);
    inside = hit;
  }
  const gaps = times.slice(1).map((t, i) => (t - times[i]!) / MINUTE_MS);
  return median(gaps);
}

// ===== Índice por hora (velas de 1 min) =====
export type HourIndex = { hourStart: number; index: number; center: number | null };

/** Índice de repetição por hora cheia usando a regra de revisita adaptada (1 vela fora). */
export function hourlyIndices(candles: readonly Candle[], from: number, hours: number, bandPct = BAND_PCT): HourIndex[] {
  const out: HourIndex[] = [];
  for (let h = 0; h < hours; h++) {
    const start = from + h * HOUR_MS;
    const slice = candles.filter((c) => c.time >= start && c.time < start + HOUR_MS);
    const top = rankBands(bandStats(slice, bandPct, start + HOUR_MS, MINUTE_MS))[0];
    out.push({ hourStart: start, index: top?.visits ?? 0, center: top?.center ?? null });
  }
  return out;
}

// ===== e) Estabilidade do ímã =====
export type Stability = { horasOk: number; horas: number; deriva: number | null };

export function magnetStability(last6: readonly HourIndex[], minRep = MIN_REPETICOES): Stability {
  const horasOk = last6.filter((h) => h.index >= minRep).length;
  const centers = last6.map((h) => h.center).filter((c): c is number => c != null && c > 0);
  let deriva: number | null = null;
  if (centers.length >= 2) {
    const mean = centers.reduce((s, v) => s + v, 0) / centers.length;
    const sd = Math.sqrt(centers.reduce((s, v) => s + (v - mean) ** 2, 0) / centers.length);
    deriva = sd / mean;
  }
  return { horasOk, horas: last6.length, deriva };
}

// ===== f) Dentro do esperado =====
export type Expected = {
  percentil: number | null;
  z: number | null;
  dentro: boolean;
  /** Distância preço→gatilho compatível com a mediana histórica. */
  distanciaCompativel: boolean;
};

export function expectedBehavior(
  history: readonly number[],
  current: number,
  distNow: number | null,
  distMedian: number | null,
): Expected {
  if (history.length < 3) return { percentil: null, z: null, dentro: false, distanciaCompativel: true };
  const below = history.filter((v) => v < current).length;
  const equal = history.filter((v) => v === current).length;
  const percentil = ((below + equal / 2) / history.length) * 100;
  const mean = history.reduce((s, v) => s + v, 0) / history.length;
  const sd = Math.sqrt(history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length);
  const z = sd > 0 ? (current - mean) / sd : 0;
  const distanciaCompativel =
    distNow == null || distMedian == null || distMedian <= 0 ? true : distNow <= distMedian * 2;
  return { percentil, z, dentro: percentil >= 25 && percentil <= 90 && distanciaCompativel, distanciaCompativel };
}

// ===== g) Pontuação e estrelinhas =====
export function starsFor(score: number): 1 | 2 | 3 | 4 | 5 {
  if (score >= 80) return 5;
  if (score >= 65) return 4;
  if (score >= 50) return 3;
  if (score >= 35) return 2;
  return 1;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export type ScoreParts = {
  wilsonLow: number | null;
  stability: Stability;
  ciclosPorHora: number;
  /** (preço − gatilho) ÷ gatilho; null sem preço. */
  distGatilho: number | null;
  dentro: boolean;
  /** Ponto de equilíbrio da combinação (perda líquida ÷ (ganho + perda)). */
  breakEven: number;
};

export function scoreOf(p: ScoreParts): number {
  const w = clamp01((p.wilsonLow ?? 0) / (p.breakEven > 0 ? p.breakEven : 1));
  const driftPenalty = p.stability.deriva == null ? 0.5 : clamp01(1 - p.stability.deriva / 0.01);
  const s = p.stability.horas ? (p.stability.horasOk / p.stability.horas) * (0.5 + 0.5 * driftPenalty) : 0;
  const f = clamp01(p.ciclosPorHora / 2);
  const prox = p.distGatilho == null || p.distGatilho < 0 ? 0 : clamp01(1 - p.distGatilho / 0.01);
  const e = p.dentro ? 1 : 0;
  return Math.round(100 * (0.4 * w + 0.2 * s + 0.15 * f + 0.15 * prox + 0.1 * e));
}

export type HitRateReport = {
  symbol: string;
  plan: CyclePlan;
  toquesNoIma: Record<WindowH, number>;
  ciclos: Record<WindowH, CycleStats>;
  /** Estatística usada na decisão (24 h). */
  principal: CycleStats;
  tempoMedianoAteGatilho: number | null;
  estabilidade: Stability;
  esperado: Expected;
  indiceAtual: number;
  indicesHora: HourIndex[];
  indiceMediana: number | null;
  /** Faixa de preço das 24 h (fração). */
  faixa24h: number | null;
  pontuacao: number;
  estrelas: 1 | 2 | 3 | 4 | 5;
  abaixoEquilibrio: boolean;
  /** Ponto de equilíbrio do plano avaliado. */
  breakEven: number;
  motivo: string;
};

const pct = (v: number | null, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d).replace(".", ",")}%`);

export function hitRateReport(input: {
  symbol: string;
  candles: readonly Candle[];
  plan: CyclePlan;
  price: number | null;
  now: number;
  minRep?: number;
}): HitRateReport {
  const { candles, plan, now } = input;
  const minRep = input.minRep ?? MIN_REPETICOES;
  const sliceH = (h: number) => candles.filter((c) => c.time >= now - h * HOUR_MS);
  const toques = {} as Record<WindowH, number>;
  const ciclos = {} as Record<WindowH, CycleStats>;
  for (const h of WINDOWS_H) {
    const s = sliceH(h);
    toques[h] = countMagnetTouches(s, plan.target);
    ciclos[h] = cycleStats(simulateCycles(s, plan));
  }
  const principal = ciclos[24];
  const curHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const indicesHora = hourlyIndices(candles, curHour - 24 * HOUR_MS, 24);
  const last6 = indicesHora.slice(-6);
  const estabilidade = magnetStability(last6, minRep);
  const lastHour = candles.filter((c) => c.time >= now - HOUR_MS);
  const indiceAtual = rankBands(bandStats(lastHour, BAND_PCT, now, MINUTE_MS))[0]?.visits ?? 0;
  const hist = indicesHora.filter((h) => h.index > 0).map((h) => h.index);
  const distGatilho = input.price != null ? (input.price - plan.trigger) / plan.trigger : null;
  const dists = candles.map((c) => (c.close - plan.trigger) / plan.trigger).filter((d) => d >= 0);
  const esperado = expectedBehavior(hist, indiceAtual, distGatilho, median(dists));
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
  const faixa24h = isFinite(lo) && lo > 0 ? (hi - lo) / lo : null;
  const ciclosResolvidos6 = ciclos[6].alvos + ciclos[6].stops;
  const breakEven = breakEvenDoPlano(plan);
  const pontuacao = scoreOf({
    breakEven,
    wilsonLow: principal.wilsonLow,
    stability: estabilidade,
    ciclosPorHora: ciclosResolvidos6 / 6,
    distGatilho,
    dentro: esperado.dentro,
  });
  let estrelas = starsFor(pontuacao);
  if (principal.amostra === "insuficiente" && estrelas > 2) estrelas = 2;
  const abaixoEquilibrio = principal.amostra === "ok" && (principal.wilsonLow ?? 0) < breakEven;
  const n24 = principal.alvos + principal.stops;
  const motivo = `Wilson ${pct(principal.wilsonLow)}, ${ciclosResolvidos6} ciclos em 6h (${n24} em 24h), ímã estável ${estabilidade.horasOk}/${estabilidade.horas} horas`;
  return {
    symbol: input.symbol,
    plan,
    toquesNoIma: toques,
    ciclos,
    principal,
    tempoMedianoAteGatilho: medianTimeToTrigger(candles, plan.trigger),
    estabilidade,
    esperado,
    indiceAtual,
    indicesHora,
    indiceMediana: median(hist),
    faixa24h,
    pontuacao,
    estrelas,
    abaixoEquilibrio,
    breakEven,
    motivo,
  };
}
