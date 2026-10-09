import { describe, expect, it } from "vitest";
import { breakEvenAtivo, DEFAULT_COMBO } from "@/lib/supremo-combo";
const BE = breakEvenAtivo(DEFAULT_COMBO);
import { classifyRegime, regimeBlock, readRegime } from "@/lib/market-regime";
import { coinPenalty, globalPauseUntil, hotRecentUntil, PASSED_TARGET_REASON } from "@/lib/supremo-penalty";
import { entryBlocks, exposureBlock, DEFAULT_EXPOSURE } from "@/lib/supremo-live";
import { pendingExpiry } from "@/lib/supremo-expiry";
import { breakEvenTable, simulateWithTimeExit, type ComboStats } from "@/lib/target-stop-lab";

const M = 60_000;
const H = 60 * M;

describe("regime de mercado", () => {
  const base = { btc15: 0, btc60: 0, eth15: 0, eth60: 0, breadthDown: 0.1 };
  it("calmo", () => expect(classifyRegime(base)).toBe("calmo"));
  it("queda por BTC 15 min", () => expect(classifyRegime({ ...base, btc15: -0.004 })).toBe("queda"));
  it("queda por amplitude", () => expect(classifyRegime({ ...base, breadthDown: 0.6 })).toBe("queda"));
  it("alta", () => expect(classifyRegime({ ...base, btc60: 0.004, eth60: 0.005 })).toBe("alta"));
  it("indefinido", () => expect(classifyRegime({ ...base, btc60: 0.003 })).toBe("indefinido"));
  it("dados insuficientes", () => expect(readRegime({ btc: [], eth: [], universe15: [], now: 0 }).regime).toBe("indefinido"));
  it("bloqueia em queda", () => expect(regimeBlock("queda", { hitRate: 1, sample: 50, breakEven: BE })).toBe("mercado-em-queda"));
  it("alta exige o break-even com amostra 5", () => {
    expect(regimeBlock("alta", { hitRate: 0.7, sample: 4, breakEven: BE })).toBe("mercado-em-alta");
    expect(regimeBlock("alta", { hitRate: BE, sample: 5, breakEven: BE })).toBeNull();
  });
});

const bet = (status: string, resolvedAt: number, symbol = "XUSDT", cancelReason?: string) =>
  ({ symbol, status, resolvedAt, cancelReason }) as any;

describe("penalidade por derrota", () => {
  it("30 min após 1 derrota", () => {
    const b = [bet("loss", 0)];
    expect(coinPenalty(b, "XUSDT", 29 * M)).not.toBeNull();
    expect(coinPenalty(b, "XUSDT", 30 * M)).toBeNull();
  });
  it("2 h na 2ª e 6 h na 3ª seguida", () => {
    expect(coinPenalty([bet("loss", 0), bet("loss", -1)], "XUSDT", 2 * H - 1)).not.toBeNull();
    expect(coinPenalty([bet("loss", 0), bet("loss", -1)], "XUSDT", 2 * H)).toBeNull();
    const three = [bet("loss", 0), bet("loss", -1), bet("loss", -2)];
    expect(coinPenalty(three, "XUSDT", 6 * H - 1)).not.toBeNull();
    expect(coinPenalty(three, "XUSDT", 6 * H)).toBeNull();
  });
  it("vitória zera", () => expect(coinPenalty([bet("win", 10), bet("loss", 0)], "XUSDT", 11)).toBeNull());
  it("2 de 3 últimas perdidas", () => {
    const b = [bet("loss", 0), bet("win", -1), bet("loss", -2)];
    expect(coinPenalty(b, "XUSDT", H)?.reason).toBe("perdeu 2 das últimas 3");
  });
  it("pausa global de 10 min", () => {
    expect(globalPauseUntil([bet("loss", H, "Y")], H + 9 * M)).toBe(H + 10 * M);
    expect(globalPauseUntil([bet("loss", H, "Y")], H + 10 * M)).toBeNull();
  });
  it("em-alta-recente por 15 min", () => {
    const b = [bet("cancelled", H, "XUSDT", PASSED_TARGET_REASON)];
    expect(hotRecentUntil(b, "XUSDT", H + 14 * M)).toBe(H + 15 * M);
    expect(hotRecentUntil(b, "XUSDT", H + 15 * M)).toBeNull();
  });
});

describe("exposição", () => {
  it("1 por grupo de correlação", () => {
    expect(exposureBlock([{ symbol: "BTCBRL", status: "open", combo: "a" }], "ETHBRL", "a")).toMatch(/grupo/);
  });
  it("anti-rajada: máximo 2 ativas", () => {
    const b = ["A", "B", "C"].map((s) => ({ symbol: s, status: "open" as const, combo: "a" }));
    expect(exposureBlock(b, "D", "a")).toMatch(/limite de 2/);
  });
  it("aplica maxActiveTotal", () => {
    const b = ["A", "B"].map((s) => ({ symbol: s, status: "pending" as const, combo: "a" }));
    expect(exposureBlock(b, "D", "a", { ...DEFAULT_EXPOSURE, maxActiveTotal: 2 })).toMatch(/limite de 2/);
  });
});

describe("entrada", () => {
  const p = { trigger: 100, target: 101 };
  it("faixa 0,05%–0,20% acima do gatilho", () => {
    expect(entryBlocks({ symbol: "BTCUSDT", price: 100.03, plan: p })).toContain("longe-do-gatilho");
    expect(entryBlocks({ symbol: "BTCUSDT", price: 100.1, plan: p })).toEqual([]);
    expect(entryBlocks({ symbol: "BTCUSDT", price: 100.25, plan: p })).toContain("longe-do-gatilho");
  });
  it("não persegue alta de 5 min", () => {
    expect(entryBlocks({ symbol: "BTCUSDT", price: 100.1, plan: p, rise5m: 0.0031 })).toContain("perseguindo-alta");
  });
  it("expira em 10 min", () => {
    const b = { status: "pending", createdAt: 0, triggerPrice: 100, target: 101 };
    expect(pendingExpiry(b, 100.1, 10 * M - 1).cancel).toBe(false);
    expect(pendingExpiry(b, 100.1, 10 * M).cancel).toBe(true);
  });
});

describe("laboratório", () => {
  const st = (o: Partial<ComboStats>) => ({ targetPct: 0.004, stopPct: 0.003, executed: 40, wilson: { low: 0.6, high: 0.8 }, breakeven: 0.5, hitRate: 0.7, ...o }) as ComboStats;
  it("break-even: passa só com Wilson acima e amostra ≥ 30", () => {
    expect(breakEvenTable([st({})]).anyPasses).toBe(true);
    expect(breakEvenTable([st({ executed: 29 })]).anyPasses).toBe(false);
    expect(breakEvenTable([st({ breakeven: 0.85 })]).anyPasses).toBe(false);
  });
  it("saída por tempo encerra após 15 min no prejuízo", () => {
    const plan = { trigger: 100, target: 101, stop: 99 };
    const c = (t: number, close: number) => ({ time: t, open: close, high: close, low: close, close, volume: 0 }) as any;
    const candles = [c(0, 100), c(5 * M, 99.6), c(15 * M, 99.5)];
    const r = simulateWithTimeExit(plan, 99.9, candles, 15 * M);
    expect(r.outcome).toBe("loss");
    expect(r.exitPrice).toBe(99.5);
  });
});
