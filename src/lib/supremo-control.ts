/**
 * Grupo de controle do Supremo — backtest puro em velas de 1 min.
 *
 * Pergunta: a faixa MAIS visitada (o que o Supremo usa) bate o alvo mais
 * vezes do que outras faixas ou do que níveis aleatórios? Mesma combinação,
 * mesma regra de entrada (gatilho), mesma expiração e mesma vela com alvo e
 * stop = derrota. Só informa; nunca mexe na seleção ao vivo.
 */
import type { Candle } from "./replay";
import { BAND_PCT, HOUR_MS, bandStats, rankBands, simulateBet } from "./supremo";
import { wilsonInterval } from "./metrics";
import { planCombo } from "./target-stop-lab";
import { economiaDaCombinacao, type Combinacao } from "./supremo-economics";

export const MINUTE = 60_000;
/** Distância mínima da faixa "menos visitada" até o preço. */
export const MIN_DIST_COLD = 0.0025;
/** Expiração: a aposta simulada vale por 1 hora após a criação. */
export const CONTROL_EXPIRY_MS = HOUR_MS;

export type GroupKey = "a" | "b" | "c" | "d";
export const GROUP_LABEL: Record<GroupKey, string> = {
  a: "Faixa mais visitada (Supremo)",
  b: "2ª e 3ª faixas mais visitadas",
  c: "Faixa menos visitada (≥ 0,25% do preço)",
  d: "Níveis aleatórios",
};

export type Level = { group: GroupKey; magnet: number };

/** Uma oportunidade = início de hora com as velas da hora anterior e da seguinte. */
export type Slot = {
  symbol: string;
  hourStart: number;
  price: number;
  levels: Level[];
  next: readonly Candle[];
};

/** Gerador pseudoaleatório com semente fixa (mulberry32). */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monta as oportunidades por hora cheia (níveis de cada grupo + velas da hora seguinte). */
export function buildSlots(symbol: string, candles: readonly Candle[], seed = 42, bandPct = BAND_PCT): Slot[] {
  if (candles.length === 0) return [];
  const rnd = seededRandom(seed);
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const first = Math.ceil(sorted[0]!.time / HOUR_MS) * HOUR_MS + HOUR_MS;
  const last = sorted[sorted.length - 1]!.time;
  const out: Slot[] = [];
  for (let h = first; h + CONTROL_EXPIRY_MS <= last + MINUTE; h += HOUR_MS) {
    const prev = sorted.filter((c) => c.time >= h - HOUR_MS && c.time < h);
    const next = sorted.filter((c) => c.time >= h && c.time < h + CONTROL_EXPIRY_MS);
    if (prev.length < 30 || next.length < 10) continue;
    const price = prev[prev.length - 1]!.close;
    const ranked = rankBands(bandStats(prev, bandPct, h, MINUTE));
    if (ranked.length === 0) continue;
    const levels: Level[] = [{ group: "a", magnet: ranked[0]!.center }];
    for (const b of ranked.slice(1, 3)) levels.push({ group: "b", magnet: b.center });
    const cold = [...ranked].reverse().find((b) => Math.abs(b.center - price) / price >= MIN_DIST_COLD);
    if (cold) levels.push({ group: "c", magnet: cold.center });
    let lo = Infinity, hi = -Infinity;
    for (const c of prev) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
    if (hi > lo) levels.push({ group: "d", magnet: lo + rnd() * (hi - lo) });
    out.push({ symbol, hourStart: h, price, levels, next });
  }
  return out;
}

export type Outcome = "win" | "loss" | "nao-executada" | "sem-desfecho";

export function simulateLevel(slot: Pick<Slot, "price" | "next">, magnet: number, c: Pick<Combinacao, "alvoBruto" | "stopBruto">): Outcome {
  const plan = planCombo(magnet, c.alvoBruto, c.stopBruto, "percentual");
  return simulateBet(plan, slot.price, slot.next).outcome;
}

export type GroupResult = {
  wins: number;
  losses: number;
  amostra: number;
  taxa: number | null;
  wilson: { low: number; high: number } | null;
  /** Expectativa líquida por aposta resolvida (fração). */
  expectativa: number | null;
};

export function groupResult(wins: number, losses: number, combo: Combinacao): GroupResult {
  const n = wins + losses;
  const e = economiaDaCombinacao(combo);
  const taxa = n ? wins / n : null;
  return {
    wins,
    losses,
    amostra: n,
    taxa,
    wilson: wilsonInterval(wins, n),
    expectativa: taxa == null ? null : taxa * e.ganhoLiquido - (1 - taxa) * e.perdaLiquida,
  };
}

/** Intervalo da diferença de proporções (método de Newcombe, a partir dos Wilson). */
export function diffInterval(a: GroupResult, b: GroupResult): { diff: number; low: number; high: number } | null {
  if (a.taxa == null || b.taxa == null || !a.wilson || !b.wilson) return null;
  const diff = a.taxa - b.taxa;
  return {
    diff,
    low: diff - Math.sqrt((a.taxa - a.wilson.low) ** 2 + (b.wilson.high - b.taxa) ** 2),
    high: diff + Math.sqrt((a.wilson.high - a.taxa) ** 2 + (b.taxa - b.wilson.low) ** 2),
  };
}

export type ControlReport = {
  groups: Record<GroupKey, GroupResult>;
  diffAD: { diff: number; low: number; high: number } | null;
  preditivo: boolean;
  conclusao: string;
};

export function controlReport(slots: readonly Slot[], combo: Combinacao): ControlReport {
  const cnt: Record<GroupKey, { w: number; l: number }> = { a: { w: 0, l: 0 }, b: { w: 0, l: 0 }, c: { w: 0, l: 0 }, d: { w: 0, l: 0 } };
  for (const s of slots) {
    for (const lv of s.levels) {
      const o = simulateLevel(s, lv.magnet, combo);
      if (o === "win") cnt[lv.group].w++;
      else if (o === "loss") cnt[lv.group].l++;
    }
  }
  const groups = {
    a: groupResult(cnt.a.w, cnt.a.l, combo),
    b: groupResult(cnt.b.w, cnt.b.l, combo),
    c: groupResult(cnt.c.w, cnt.c.l, combo),
    d: groupResult(cnt.d.w, cnt.d.l, combo),
  };
  const { a, c, d } = groups;
  const preditivo =
    a.taxa != null && c.taxa != null && d.taxa != null && a.wilson != null &&
    a.taxa > c.taxa && a.taxa > d.taxa && a.wilson.low > (c.taxa + d.taxa) / 2;
  return {
    groups,
    diffAD: diffInterval(a, d),
    preditivo,
    conclusao: preditivo ? "O índice de repetição tem poder preditivo" : "Sem evidência de que o índice prevê o alvo",
  };
}
