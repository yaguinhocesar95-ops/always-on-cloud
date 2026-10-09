/**
 * SupremoLab por expectativa líquida — lógica pura sobre velas de 1 min.
 * Usa as oportunidades do grupo (a) (faixa mais visitada, o que o Supremo usa)
 * e avalia uma grade de alvo/stop BRUTOS com validação fora da amostra.
 */
import { timeBounds } from "./replay";
import { MAX_COMBOS, gridValues } from "./target-stop-lab";
import { economiaDaCombinacao, type Combinacao } from "./supremo-economics";
import { simulateLevel, type Slot } from "./supremo-control";
import { wilsonInterval } from "./metrics";

export const EXP_LAB_MIN_SAMPLE = 30;
export const TRAIN_FRACTION = 0.7;
export const FEE_DEFAULT = 0.002;
export const FEE_SENSITIVITY = [0.0015, 0.001] as const;
export const EXP_GRID = { alvoFrom: 0.0035, alvoTo: 0.012, stopFrom: 0.0025, stopTo: 0.01, step: 0.0005 };

/** Grade alvo × stop respeitando o limite de combinações. */
export function expGrid(step = EXP_GRID.step): [number, number][] {
  let s = step;
  for (;;) {
    const t = gridValues(EXP_GRID.alvoFrom, EXP_GRID.alvoTo, s);
    const st = gridValues(EXP_GRID.stopFrom, EXP_GRID.stopTo, s);
    if (t.length * st.length <= MAX_COMBOS) return t.flatMap((a) => st.map((b) => [a, b] as [number, number]));
    s += 0.0005;
  }
}

export type PartStats = {
  amostra: number;
  wins: number;
  taxa: number | null;
  expectativa: number | null;
  /** Expectativa usando o limite inferior de Wilson da taxa. */
  expectativaLow: number | null;
};

export type ExpRow = {
  alvoBruto: number;
  stopBruto: number;
  breakEven: number | null;
  baseline: number | null;
  vantagem: number | null;
  total: PartStats;
  treino: PartStats;
  validacao: PartStats;
  /** Amostra ≥ 30 nas duas partes e expectativa > 0 nas duas. */
  aprovada: boolean;
};

function part(wins: number, n: number, c: Combinacao): PartStats {
  const e = economiaDaCombinacao(c);
  const taxa = n ? wins / n : null;
  const wl = wilsonInterval(wins, n)?.low ?? null;
  const ex = (p: number | null) => (p == null ? null : p * e.ganhoLiquido - (1 - p) * e.perdaLiquida);
  return { amostra: n, wins, taxa, expectativa: ex(taxa), expectativaLow: ex(wl) };
}

/** Divide as oportunidades por tempo: 70% iniciais = treino, 30% finais = validação. */
export function splitSlots(slots: readonly Slot[], frac = TRAIN_FRACTION) {
  if (!slots.length) return { treino: [] as Slot[], validacao: [] as Slot[], corte: null as number | null };
  const from = Math.min(...slots.map((s) => s.hourStart));
  const to = Math.max(...slots.map((s) => s.hourStart)) + 1;
  const [tr] = timeBounds(from, to, [frac, 1 - frac, 0]);
  const corte = tr!.to;
  return { treino: slots.filter((s) => s.hourStart < corte), validacao: slots.filter((s) => s.hourStart >= corte), corte };
}

/** Desfecho por oportunidade (só depende de alvo/stop, não da taxa). */
type Tally = { tw: number; tn: number; vw: number; vn: number };

export function tallyCombo(slots: readonly Slot[], corte: number, alvo: number, stop: number): Tally {
  const t: Tally = { tw: 0, tn: 0, vw: 0, vn: 0 };
  for (const s of slots) {
    const lv = s.levels.find((l) => l.group === "a");
    if (!lv) continue;
    const o = simulateLevel(s, lv.magnet, { alvoBruto: alvo, stopBruto: stop });
    if (o !== "win" && o !== "loss") continue;
    const w = o === "win" ? 1 : 0;
    if (s.hourStart < corte) { t.tn++; t.tw += w; } else { t.vn++; t.vw += w; }
  }
  return t;
}

export function rowFromTally(alvo: number, stop: number, t: Tally, fee: number, minSample = EXP_LAB_MIN_SAMPLE): ExpRow {
  const c: Combinacao = { alvoBruto: alvo, stopBruto: stop, taxaIdaVolta: fee };
  const e = economiaDaCombinacao(c);
  const total = part(t.tw + t.vw, t.tn + t.vn, c);
  const treino = part(t.tw, t.tn, c);
  const validacao = part(t.vw, t.vn, c);
  return {
    alvoBruto: alvo,
    stopBruto: stop,
    breakEven: e.breakEven,
    baseline: e.baselineAleatorio,
    vantagem: total.taxa != null && e.baselineAleatorio != null ? total.taxa - e.baselineAleatorio : null,
    total,
    treino,
    validacao,
    aprovada:
      treino.amostra >= minSample && validacao.amostra >= minSample &&
      (treino.expectativa ?? -1) > 0 && (validacao.expectativa ?? -1) > 0,
  };
}

export type Tallies = { corte: number | null; items: { alvo: number; stop: number; t: Tally }[] };

/** Simula a grade inteira uma vez; a taxa pode mudar depois sem resimular. */
export function tallyGrid(slots: readonly Slot[], grid = expGrid()): Tallies {
  const { corte } = splitSlots(slots);
  if (corte == null) return { corte, items: [] };
  return { corte, items: grid.map(([a, s]) => ({ alvo: a, stop: s, t: tallyCombo(slots, corte, a, s) })) };
}

/** Linhas ordenadas: aprovadas primeiro, depois pelo limite inferior da expectativa. */
export function expRows(tallies: Tallies, fee: number): ExpRow[] {
  return tallies.items
    .map((i) => rowFromTally(i.alvo, i.stop, i.t, fee))
    .sort(
      (x, y) =>
        Number(y.aprovada) - Number(x.aprovada) ||
        (y.total.expectativaLow ?? -1) - (x.total.expectativaLow ?? -1),
    );
}

export const NENHUMA_TEXT = "Nenhuma combinação tem expectativa positiva com a amostra atual";
