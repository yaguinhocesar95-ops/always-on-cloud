/**
 * Laboratório de Alvo e Stop — funções puras (sem rede, sem relógio).
 *
 * Reaproveita as MESMAS apostas candidatas do backtest por hora do Supremo
 * (moeda de maior índice na hora anterior) e só troca alvo e stop. Cada
 * combinação é resolvida nas velas reais de 1 s com custos de execution.ts.
 */
import type { Candle } from "./replay";
import { GROSS_TARGET_PCT } from "./scalp";
import { buildExecutionModel, type Regime } from "./execution";
import { wilsonInterval } from "./metrics";
import { simulateBet, type BacktestRow } from "./supremo";

/** Combinação usada hoje nas apostas reais (+0,55% / −0,55% bruto). */
export const CURRENT_TARGET_PCT = GROSS_TARGET_PCT;
export const CURRENT_STOP_PCT = GROSS_TARGET_PCT;
export const MAX_COMBOS = 400;
export const LAB_MIN_SAMPLE = 30;
export const LAB_STRONG_SAMPLE = 100;

/** "percentual": gatilho = ímã ÷ (1 + alvo). "fixo-ima": gatilho atual, só o stop varia. */
export type LabMode = "percentual" | "fixo-ima";

export type LabCandidate = {
  id: string;
  symbol: string;
  hourStart: number;
  /** Centro da faixa mais repetida — o ímã. */
  magnet: number;
  priceAtCreate: number;
  regime: Regime;
  fee: number;
  spread: number | null;
  /** Velas de 1 s da hora em que a aposta vale. */
  candles: readonly Candle[];
};

export type GridSpec = {
  targetFrom: number;
  targetTo: number;
  targetStep: number;
  stopFrom: number;
  stopTo: number;
  stopStep: number;
};

export const DEFAULT_GRID: GridSpec = {
  targetFrom: 0.0035,
  targetTo: 0.009,
  targetStep: 0.0005,
  stopFrom: 0.002,
  stopTo: 0.007,
  stopStep: 0.0005,
};

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function gridValues(from: number, to: number, step: number): number[] {
  if (!(step > 0) || !(to >= from)) return [];
  const out: number[] = [];
  const n = Math.floor((to - from) / step + 1e-9);
  for (let i = 0; i <= n && out.length <= MAX_COMBOS; i++) out.push(r6(from + i * step));
  return out;
}

export function buildGrid(spec: GridSpec, mode: LabMode): { targets: number[]; stops: number[] } {
  const targets = mode === "fixo-ima" ? [CURRENT_TARGET_PCT] : gridValues(spec.targetFrom, spec.targetTo, spec.targetStep);
  return { targets, stops: gridValues(spec.stopFrom, spec.stopTo, spec.stopStep) };
}

export function planCombo(magnet: number, targetPct: number, stopPct: number, mode: LabMode) {
  const legT = mode === "fixo-ima" ? CURRENT_TARGET_PCT : targetPct;
  const trigger = magnet / (1 + legT);
  return { target: magnet, trigger, stop: trigger / (1 + stopPct) };
}

/** Acerto necessário para empatar: perda ÷ (ganho + perda). */
export function breakevenRate(netWin: number, netLoss: number): number | null {
  const loss = Math.abs(netLoss);
  if (!(netWin > 0) || !(loss > 0)) return null;
  return loss / (netWin + loss);
}

export type CandidateOutcome = {
  outcome: "win" | "loss" | "nao-executada" | "sem-desfecho";
  ambiguous: boolean;
  netIfWin: number;
  netIfLoss: number;
  durationMs: number | null;
};

/** Simulação opcional: saída por tempo (só simulação, nunca em apostas reais). */
export const TIME_EXIT_MS = 15 * 60_000;
export type SimOptions = { timeExitMs?: number | undefined };

/** Resolve como simulateBet, mas encerra a mercado se passar `timeExitMs` valendo e estiver no prejuízo. */
export function simulateWithTimeExit(
  plan: { trigger: number; target: number; stop: number },
  priceAtCreate: number,
  candles: readonly Candle[],
  timeExitMs: number,
): { outcome: CandidateOutcome["outcome"]; ambiguous: boolean; armedAt: number | null; resolvedAt: number | null; exitPrice: number | null } {
  let armedAt: number | null = null;
  const fromBelow = priceAtCreate <= plan.trigger;
  for (const c of candles) {
    if (armedAt == null) {
      if (fromBelow ? c.high >= plan.trigger : c.low <= plan.trigger) armedAt = c.time;
      continue;
    }
    const hitT = c.high >= plan.target;
    const hitS = c.low <= plan.stop;
    if (hitT && hitS) return { outcome: "loss", ambiguous: true, armedAt, resolvedAt: c.time, exitPrice: null };
    if (hitT) return { outcome: "win", ambiguous: false, armedAt, resolvedAt: c.time, exitPrice: null };
    if (hitS) return { outcome: "loss", ambiguous: false, armedAt, resolvedAt: c.time, exitPrice: null };
    if (c.time - armedAt >= timeExitMs && c.close < plan.trigger)
      return { outcome: "loss", ambiguous: false, armedAt, resolvedAt: c.time, exitPrice: c.close };
  }
  return { outcome: armedAt == null ? "nao-executada" : "sem-desfecho", ambiguous: false, armedAt, resolvedAt: null, exitPrice: null };
}

/** Resultado líquido proporcional de uma saída a mercado entre gatilho e stop. */
export function timeExitNet(plan: { trigger: number; stop: number }, exitPrice: number, netIfLoss: number): number {
  const span = plan.trigger - plan.stop;
  if (!(span > 0)) return netIfLoss;
  return netIfLoss * Math.min(1, Math.max(0, (plan.trigger - exitPrice) / span));
}

export function simulateCandidate(c: LabCandidate, targetPct: number, stopPct: number, mode: LabMode, opt: SimOptions = {}): CandidateOutcome {
  const plan = planCombo(c.magnet, targetPct, stopPct, mode);
  const ex = buildExecutionModel({ ...plan, regime: c.regime, fee: c.fee, spread: c.spread });
  if (opt.timeExitMs) {
    const t = simulateWithTimeExit(plan, c.priceAtCreate, c.candles, opt.timeExitMs);
    return {
      outcome: t.outcome,
      ambiguous: t.ambiguous,
      netIfWin: ex.netIfWin,
      netIfLoss: t.exitPrice != null ? timeExitNet(plan, t.exitPrice, ex.netIfLoss) : ex.netIfLoss,
      durationMs: t.armedAt != null && t.resolvedAt != null ? t.resolvedAt - t.armedAt : null,
    };
  }
  const sim = simulateBet(plan, c.priceAtCreate, c.candles);
  return {
    outcome: sim.outcome,
    ambiguous: sim.ambiguous,
    netIfWin: ex.netIfWin,
    netIfLoss: ex.netIfLoss,
    durationMs: sim.armedAt != null && sim.resolvedAt != null ? sim.resolvedAt - sim.armedAt : null,
  };
}

export type ComboStats = {
  targetPct: number;
  stopPct: number;
  executed: number;
  wins: number;
  losses: number;
  ambiguous: number;
  notExecuted: number;
  unresolved: number;
  hitRate: number | null;
  wilson: { low: number; high: number } | null;
  avgNetWin: number | null;
  avgNetLoss: number | null;
  breakeven: number | null;
  margin: number | null;
  expectancy: number | null;
  totalReturn: number;
  expectancyWilsonLow: number | null;
  avgResolveMs: number | null;
};

export function evaluateCombo(
  cands: readonly LabCandidate[],
  targetPct: number,
  stopPct: number,
  mode: LabMode,
  opt: SimOptions = {},
): ComboStats {
  let wins = 0, losses = 0, ambiguous = 0, notExecuted = 0, unresolved = 0;
  let total = 0, sumWin = 0, sumLoss = 0, sumDur = 0, nDur = 0;
  for (const c of cands) {
    const o = simulateCandidate(c, targetPct, stopPct, mode, opt);
    sumWin += o.netIfWin;
    sumLoss += o.netIfLoss;
    if (o.outcome === "nao-executada") { notExecuted++; continue; }
    if (o.outcome === "sem-desfecho") { unresolved++; continue; }
    if (o.outcome === "win") { wins++; total += o.netIfWin; }
    else { losses++; total += o.netIfLoss; if (o.ambiguous) ambiguous++; }
    if (o.durationMs != null) { sumDur += o.durationMs; nDur++; }
  }
  const executed = wins + losses;
  const avgNetWin = cands.length ? sumWin / cands.length : null;
  const avgNetLoss = cands.length ? sumLoss / cands.length : null;
  const hitRate = executed ? wins / executed : null;
  const wilson = wilsonInterval(wins, executed);
  const breakeven = avgNetWin != null && avgNetLoss != null ? breakevenRate(avgNetWin, avgNetLoss) : null;
  return {
    targetPct,
    stopPct,
    executed,
    wins,
    losses,
    ambiguous,
    notExecuted,
    unresolved,
    hitRate,
    wilson,
    avgNetWin,
    avgNetLoss,
    breakeven,
    margin: hitRate != null && breakeven != null ? hitRate - breakeven : null,
    expectancy: executed ? total / executed : null,
    totalReturn: total,
    expectancyWilsonLow:
      wilson && avgNetWin != null && avgNetLoss != null ? wilson.low * avgNetWin + (1 - wilson.low) * avgNetLoss : null,
    avgResolveMs: nDur ? sumDur / nDur : null,
  };
}

export function evaluateGrid(
  cands: readonly LabCandidate[],
  targets: readonly number[],
  stops: readonly number[],
  mode: LabMode,
): ComboStats[] {
  const out: ComboStats[] = [];
  for (const t of targets) for (const s of stops) out.push(evaluateCombo(cands, t, s, mode));
  return out;
}

/** Melhor primeiro pelo limite inferior do Wilson, só com amostra mínima. */
export function rankCombos(stats: readonly ComboStats[], minSample = LAB_MIN_SAMPLE): ComboStats[] {
  return stats
    .filter((s) => s.executed >= minSample && s.expectancyWilsonLow != null)
    .sort((a, b) => b.expectancyWilsonLow! - a.expectancyWilsonLow! || (b.expectancy ?? 0) - (a.expectancy ?? 0));
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

export type Stability = {
  neighbors: ComboStats[];
  positive: number;
  robust: boolean;
  overfit: boolean;
};

/** Vizinhas na grade = um passo para cada lado em alvo e/ou stop. */
export function stabilityOf(
  best: ComboStats,
  stats: readonly ComboStats[],
  targets: readonly number[],
  stops: readonly number[],
): Stability {
  const ti = targets.findIndex((t) => near(t, best.targetPct));
  const si = stops.findIndex((s) => near(s, best.stopPct));
  const neighbors = stats.filter((s) => {
    const a = targets.findIndex((t) => near(t, s.targetPct));
    const b = stops.findIndex((x) => near(x, s.stopPct));
    return !(a === ti && b === si) && Math.abs(a - ti) <= 1 && Math.abs(b - si) <= 1;
  });
  const positive = neighbors.filter((n) => (n.expectancy ?? -1) > 0).length;
  const vals = neighbors.map((n) => n.expectancy).filter((v): v is number => v != null);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const be = best.expectancy ?? 0;
  return {
    neighbors,
    positive,
    robust: be > 0 && neighbors.length > 0 && positive >= Math.ceil(neighbors.length / 2),
    overfit: be > 0 && (mean == null || mean <= 0 || be - mean > Math.abs(be) * 0.5),
  };
}

/** Divide pelo tempo: a primeira metade das horas nunca contém velas da segunda. */
export function splitWalkForward(cands: readonly LabCandidate[]) {
  const hours = [...new Set(cands.map((c) => c.hourStart))].sort((a, b) => a - b);
  const cutoff = hours[Math.floor(hours.length / 2)] ?? Infinity;
  return {
    cutoff,
    first: cands.filter((c) => c.hourStart < cutoff),
    second: cands.filter((c) => c.hourStart >= cutoff),
  };
}

export type WalkForward = {
  cutoff: number;
  trainSize: number;
  testSize: number;
  train: ComboStats | null;
  test: ComboStats | null;
};

export function walkForward(
  cands: readonly LabCandidate[],
  targets: readonly number[],
  stops: readonly number[],
  mode: LabMode,
  minSample = LAB_MIN_SAMPLE,
): WalkForward {
  const { cutoff, first, second } = splitWalkForward(cands);
  const trainStats = evaluateGrid(first, targets, stops, mode);
  const ranked = rankCombos(trainStats, Math.max(5, Math.floor(minSample / 2)));
  const train = ranked[0] ?? null;
  return {
    cutoff,
    trainSize: first.length,
    testSize: second.length,
    train,
    test: train ? evaluateCombo(second, train.targetPct, train.stopPct, mode) : null,
  };
}

/** Converte as apostas escolhidas pelo backtest por hora em candidatas. */
export function candidatesFromBacktest(
  chosen: readonly BacktestRow[],
  coins: readonly { symbol: string; hours: Candle[][] }[],
  hourStarts: readonly number[],
): LabCandidate[] {
  const bySymbol = new Map(coins.map((c) => [c.symbol, c.hours]));
  const out: LabCandidate[] = [];
  for (const r of chosen) {
    const h = hourStarts.indexOf(r.hourStart);
    const candles = bySymbol.get(r.symbol)?.[h];
    if (!candles) continue;
    out.push({
      id: `${r.symbol}-${r.hourStart}`,
      symbol: r.symbol,
      hourStart: r.hourStart,
      magnet: r.target,
      priceAtCreate: r.priceAtCreate,
      regime: r.execution.regime,
      fee: r.execution.fee,
      spread: r.execution.spread,
      candles,
    });
  }
  return out;
}

export function pctLabel(v: number, digits = 2) {
  return `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}
export function comboLabel(targetPct: number, stopPct: number, mode: LabMode = "percentual") {
  return `alvo +${pctLabel(mode === "fixo-ima" ? CURRENT_TARGET_PCT : targetPct)} / stop −${pctLabel(stopPct)}${mode === "fixo-ima" ? " (ímã)" : ""}`;
}

/** Candidatas extras com stop mais curto (bruto), além da grade. */
export const EXTRA_COMBOS: readonly [number, number][] = [
  [0.004, 0.003],
  [0.005, 0.0035],
  [0.0035, 0.0035],
];

/** Acrescenta as extras à lista de pares sem duplicar e respeitando MAX_COMBOS. */
export function withExtraCombos(pairs: readonly (readonly [number, number])[]): [number, number][] {
  const out = pairs.map((p) => [p[0], p[1]] as [number, number]);
  for (const e of EXTRA_COMBOS) {
    if (out.length >= MAX_COMBOS) break;
    if (!out.some((p) => near(p[0], e[0]) && near(p[1], e[1]))) out.push([e[0], e[1]]);
  }
  return out.slice(0, MAX_COMBOS);
}

export type BreakEvenRow = { targetPct: number; stopPct: number; breakeven: number | null; hitRate: number | null; wilsonLow: number | null; executed: number; passes: boolean };

/** Quadro "Break-even por combinação": passa só se Wilson inferior > break-even com amostra ≥ 30. */
export function breakEvenTable(stats: readonly ComboStats[], minSample = LAB_MIN_SAMPLE): { rows: BreakEvenRow[]; anyPasses: boolean } {
  const rows = stats.map((s) => {
    const wl = s.wilson?.low ?? null;
    return {
      targetPct: s.targetPct,
      stopPct: s.stopPct,
      breakeven: s.breakeven,
      hitRate: s.hitRate,
      wilsonLow: wl,
      executed: s.executed,
      passes: s.executed >= minSample && wl != null && s.breakeven != null && wl > s.breakeven,
    };
  });
  return { rows, anyPasses: rows.some((r) => r.passes) };
}
