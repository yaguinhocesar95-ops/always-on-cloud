import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, LAB_MIN_SAMPLE, buildGrid, rankCombos, stabilityOf } from "@/lib/target-stop-lab";

describe("auditoria do Laboratório", () => {
  it("grade 0,35–0,90 / 0,20–0,70 com passos de 0,05", () => {
    const { targets, stops } = buildGrid(DEFAULT_GRID, "percentual");
    expect(targets[0]).toBe(0.0035);
    expect(targets.at(-1)).toBe(0.009);
    expect(targets).toHaveLength(12);
    expect(stops[0]).toBe(0.002);
    expect(stops.at(-1)).toBe(0.007);
    expect(stops).toHaveLength(11);
  });
  it("modo fixo-ima usa só o alvo atual", () => {
    expect(buildGrid(DEFAULT_GRID, "fixo-ima").targets).toHaveLength(1);
  });
  it("ranking exige 30 executadas", () => {
    expect(LAB_MIN_SAMPLE).toBe(30);
    const s = (executed: number) => ({ targetPct: 0.005, stopPct: 0.005, executed, expectancy: 1, expectancyWilsonLow: 1 }) as never;
    expect(rankCombos([s(29), s(30)])).toHaveLength(1);
  });
  it("8 vizinhas no meio da grade", () => {
    const { targets, stops } = buildGrid(DEFAULT_GRID, "percentual");
    const all = targets.flatMap((t) => stops.map((st) => ({ targetPct: t, stopPct: st, expectancy: 0.1 }) as never));
    const best = { targetPct: targets[5], stopPct: stops[5], expectancy: 0.1 } as never;
    const st = stabilityOf(best, all, targets, stops);
    expect(st.neighbors).toHaveLength(8);
    expect(st.robust).toBe(true);
    expect(st.overfit).toBe(false);
  });
});
