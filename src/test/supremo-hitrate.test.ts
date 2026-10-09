import { describe, expect, it } from "vitest";
import { cycleStats, simulateCycles, starsFor, wilsonLower, sampleClass } from "@/lib/supremo-hitrate";
import { entryBlocks, exposureBlock, starReport } from "@/lib/supremo-live";
import { pendingExpiry, PENDING_MAX_MS, FAR_MAX_MS } from "@/lib/supremo-expiry";
import type { Candle } from "@/lib/replay";

const M = 60_000;
const k = (i: number, low: number, high: number): Candle =>
  ({ time: i * M, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 1 }) as Candle;
const plan = { target: 110, trigger: 100, stop: 90 };

describe("simulateCycles", () => {
  it("conta alvo", () => {
    const c = simulateCycles([k(0, 99, 101), k(1, 100.5, 105), k(2, 101, 111)], plan);
    expect(c).toEqual([{ triggerAt: 0, outcome: "alvo", minutes: 2 }]);
  });
  it("conta stop", () => {
    const c = simulateCycles([k(0, 99, 101), k(1, 89, 99)], plan);
    expect(c[0]!.outcome).toBe("stop");
  });
  it("mesma vela com alvo e stop = derrota", () => {
    const c = simulateCycles([k(0, 99, 101), k(1, 89, 111)], plan);
    expect(c[0]!.outcome).toBe("stop");
  });
  it("expira após 30 min", () => {
    const cs = [k(0, 99, 101), ...Array.from({ length: 35 }, (_, i) => k(i + 1, 95, 105))];
    const c = simulateCycles(cs, plan);
    expect(c[0]!.outcome).toBe("expirou");
    const s = cycleStats(c);
    expect(s.expirados).toBe(1);
    expect(s.taxaAcerto).toBeNull();
  });
});

describe("Wilson, amostra e estrelinhas", () => {
  it("Wilson inferior abaixo da taxa observada", () => {
    const w = wilsonLower(8, 10)!;
    expect(w).toBeGreaterThan(0.4);
    expect(w).toBeLessThan(0.8);
    expect(wilsonLower(0, 0)).toBeNull();
  });
  it("classe da amostra", () => {
    expect(sampleClass(4)).toBe("insuficiente");
    expect(sampleClass(5)).toBe("pequena");
    expect(sampleClass(15)).toBe("ok");
  });
  it("mapeia pontuação", () => {
    expect([90, 80, 70, 50, 40, 10].map(starsFor)).toEqual([5, 5, 4, 3, 2, 1]);
  });
});

describe("bloqueios novos", () => {
  const p = { trigger: 100, target: 100.55 };
  it("stablecoin", () => {
    expect(entryBlocks({ symbol: "USDCUSDT", price: null, plan: null })).toContain("stablecoin");
    expect(entryBlocks({ symbol: "XUSDT", price: null, plan: null, range24h: 0.001 })).toContain("stablecoin");
  });
  it("longe-do-gatilho", () => {
    expect(entryBlocks({ symbol: "BTCUSDT", price: 100.5, plan: p })).toContain("longe-do-gatilho");
    expect(entryBlocks({ symbol: "BTCUSDT", price: 99, plan: p })).toContain("longe-do-gatilho");
    expect(entryBlocks({ symbol: "BTCUSDT", price: 100.1, plan: p })).toEqual([]);
  });
  it("alvo-ultrapassado", () => {
    expect(entryBlocks({ symbol: "BTCUSDT", price: 101, plan: p })).toContain("alvo-ultrapassado");
  });
  it("taxa-baixa", () => {
    expect(entryBlocks({ symbol: "BTCUSDT", price: 100.1, plan: p, abaixoEquilibrio: true })).toContain("taxa-baixa");
  });
});

describe("expiração de pendentes", () => {
  const b = { status: "pending", createdAt: 0, triggerPrice: 100, target: 100.55 };
  it("10 min sem armar", () => {
    expect(pendingExpiry(b, 100.1, PENDING_MAX_MS).cancel).toBe(true);
  });
  it("preço acima do alvo", () => {
    expect(pendingExpiry(b, 101, M).cancel).toBe(true);
  });
  it("1% acima do gatilho por 5 min", () => {
    const d1 = pendingExpiry({ ...b, target: 200 }, 101.2, M);
    expect(d1).toEqual({ cancel: false, farSince: M });
    expect(pendingExpiry({ ...b, target: 200, farSince: M }, 101.2, M + FAR_MAX_MS).cancel).toBe(true);
  });
  it("cancelada libera a vaga da moeda", () => {
    const s = { maxActivePerCoin: 1, allowRepeat: false } as never;
    expect(exposureBlock([{ status: "pending", symbol: "X", combo: "a" }], "X", "a", s)).not.toBeNull();
    expect(exposureBlock([{ status: "cancelled", symbol: "X", combo: "a" }], "X", "a", s)).toBeNull();
  });
});

describe("starReport", () => {
  it("agrupa por estrelinhas e conta canceladas", () => {
    const meta = (stars: number) => ({ score: 0, stars, hitRate: null, cycles: 0 });
    const r = starReport([
      { status: "win", supremoMeta: meta(5), armedAt: 0, resolvedAt: 4 * M },
      { status: "loss", supremoMeta: meta(5), armedAt: 0, resolvedAt: 2 * M },
      { status: "win", supremoMeta: meta(2), armedAt: null, resolvedAt: null },
      { status: "cancelled", armedAt: null, resolvedAt: 1 },
    ] as never);
    expect(r.buckets[4]).toMatchObject({ wins: 1, losses: 1, rate: 0.5 });
    expect(r.buckets[1]!.rate).toBe(1);
    expect(r.canceladas).toBe(1);
    expect(r.tempoMedioResolver).toBe(3);
  });
});
