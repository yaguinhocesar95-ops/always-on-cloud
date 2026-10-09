import { describe, expect, it } from "vitest";
import type { Candle } from "../replay";
import {
  breakevenRate,
  evaluateCombo,
  planCombo,
  splitWalkForward,
  walkForward,
  type LabCandidate,
} from "../target-stop-lab";

const H = 3_600_000;
const c = (time: number, low: number, high: number): Candle =>
  ({ time, open: low, high, low, close: (low + high) / 2, volume: 1 }) as Candle;

function cand(id: string, hourStart: number, candles: Candle[]): LabCandidate {
  return { id, symbol: "X", hourStart, magnet: 101, priceAtCreate: 102, regime: "normal", fee: 0.002, spread: null, candles };
}

describe("target-stop-lab", () => {
  it("ponto de equilíbrio = perda ÷ (ganho + perda)", () => {
    expect(breakevenRate(0.0035, -0.0075)).toBeCloseTo(0.0075 / 0.011, 10);
    expect(breakevenRate(-0.001, -0.005)).toBeNull();
  });

  it("expectativa usa o líquido de cada combinação", () => {
    const p = planCombo(101, 0.005, 0.003, "percentual");
    const win = cand("w", 0, [c(0, p.trigger - 0.01, p.trigger), c(1000, p.trigger, 101.1)]);
    const loss = cand("l", 0, [c(0, p.trigger - 0.01, p.trigger), c(1000, p.stop - 0.01, p.trigger)]);
    const s = evaluateCombo([win, loss], 0.005, 0.003, "percentual");
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.expectancy).toBeCloseTo((s.avgNetWin! + s.avgNetLoss!) / 2, 10);
    expect(s.avgNetWin!).toBeGreaterThan(0);
    expect(s.avgNetWin!).toBeLessThan(0.005);
  });

  it("toque ambíguo na mesma vela = derrota", () => {
    const p = planCombo(101, 0.005, 0.003, "percentual");
    const amb = cand("a", 0, [c(0, p.trigger - 0.01, p.trigger), c(1000, p.stop - 0.01, 101.2)]);
    const s = evaluateCombo([amb], 0.005, 0.003, "percentual");
    expect(s.losses).toBe(1);
    expect(s.ambiguous).toBe(1);
    expect(s.wins).toBe(0);
  });

  it("aposta não executada fica fora da conta", () => {
    const never = cand("n", 0, [c(0, 101.5, 102.5), c(1000, 101.5, 102.5)]);
    const s = evaluateCombo([never], 0.005, 0.003, "percentual");
    expect(s.notExecuted).toBe(1);
    expect(s.executed).toBe(0);
    expect(s.expectancy).toBeNull();
  });

  it("walk-forward: a primeira metade não usa dados da segunda", () => {
    const cands = [0, 1, 2, 3].map((h) => cand(`c${h}`, h * H, [c(h * H, 99, 100)]));
    const { first, second, cutoff } = splitWalkForward(cands);
    expect(first.every((x) => x.hourStart < cutoff)).toBe(true);
    expect(first.every((x) => x.candles.every((k) => k.time < cutoff))).toBe(true);
    expect(second.every((x) => x.hourStart >= cutoff)).toBe(true);
    expect(first.length + second.length).toBe(cands.length);
    const wf = walkForward(cands, [0.005], [0.003], "percentual");
    expect(wf.trainSize).toBe(2);
    expect(wf.testSize).toBe(2);
  });
});
