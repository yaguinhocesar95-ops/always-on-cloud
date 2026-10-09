/** Fase 9 — testes do modelo de execução (taxa, spread, slippage, tick). */
import { describe, expect, it } from "vitest";

import {
  buildExecutionModel,
  classifyRegime,
  estimateTickSize,
  roundToTick,
  spreadFromBook,
  DEFAULT_LATENCY_MS,
  FEE_ROUND_TRIP_PCT,
} from "@/lib/execution";
import { convertMoney, formatMoney } from "@/lib/money";

describe("arredondamento de tick", () => {
  it("usa sempre o lado pedido", () => {
    expect(roundToTick(100.017, 0.01, "up")).toBe(100.02);
    expect(roundToTick(100.017, 0.01, "down")).toBe(100.01);
    expect(roundToTick(100.017, 0.01, "nearest")).toBe(100.02);
  });

  it("tick inválido não altera o preço", () => {
    expect(roundToTick(100.017, 0, "up")).toBe(100.017);
    expect(roundToTick(100.017, NaN, "up")).toBe(100.017);
  });

  it("estimativa de tick acompanha a escala do preço", () => {
    expect(estimateTickSize(450_000)).toBe(1);
    expect(estimateTickSize(2_000)).toBe(0.1);
    expect(estimateTickSize(120)).toBe(0.0001);
    expect(estimateTickSize(0.5)).toBe(0.000001);
    expect(estimateTickSize(-1)).toBe(0.01);
  });
});

describe("spread do livro", () => {
  it("calcula a fração quando o livro veio", () => {
    expect(spreadFromBook(100, 100.1)!).toBeCloseTo(0.001, 10);
  });

  it("devolve null quando o livro é inválido ou ausente", () => {
    expect(spreadFromBook(null, 100)).toBeNull();
    expect(spreadFromBook(100, 99)).toBeNull();
    expect(spreadFromBook(0, 1)).toBeNull();
  });
});

describe("regime", () => {
  it("classifica pela amplitude da janela", () => {
    expect(classifyRegime(0.1)).toBe("calmo");
    expect(classifyRegime(0.8)).toBe("normal");
    expect(classifyRegime(2)).toBe("agitado");
    expect(classifyRegime(null)).toBe("normal");
  });
});

describe("modelo de execução", () => {
  const trigger = 100;
  const target = 100.55;
  const stop = 99.45;

  it("todos os desvios são contra o operador", () => {
    const m = buildExecutionModel({ trigger, target, stop, spread: 0.0004, tickSize: 0.01 });
    expect(m.entryFill).toBeGreaterThanOrEqual(trigger);
    expect(m.targetFill).toBeLessThanOrEqual(target);
    expect(m.stopFill).toBeLessThanOrEqual(stop);
    expect(m.slippageSource).toBe("livro");
  });

  it("sem livro, o slippage é estimado e marcado como tal", () => {
    const m = buildExecutionModel({ trigger, target, stop, regime: "agitado" });
    expect(m.slippageSource).toBe("estimado");
    expect(m.tickEstimated).toBe(true);
    expect(m.latencyMs).toBe(DEFAULT_LATENCY_MS);
  });

  it("o resultado líquido é sempre pior que o bruto", () => {
    const m = buildExecutionModel({ trigger, target, stop, spread: 0.0004, tickSize: 0.01 });
    const grossWin = (target - trigger) / trigger;
    expect(m.netIfWin).toBeLessThan(grossWin);
    expect(m.netIfLoss).toBeLessThan(0);
    expect(m.fee).toBe(FEE_ROUND_TRIP_PCT);
    expect(m.totalCostPct).toBeCloseTo(m.fee + m.slippagePerLeg * 2, 12);
  });

  it("acerto mínimo para empatar fica entre 0 e 1", () => {
    const m = buildExecutionModel({ trigger, target, stop, spread: 0.0002, tickSize: 0.01 });
    expect(m.breakevenHitRate!).toBeGreaterThan(0);
    expect(m.breakevenHitRate!).toBeLessThan(1);
  });

  it("aguenta preços extremos sem perder precisão", () => {
    const m = buildExecutionModel({
      trigger: 0.00001234,
      target: 0.00001241,
      stop: 0.00001227,
      tickSize: 0.00000001,
    });
    expect(Number.isFinite(m.entryFill)).toBe(true);
    expect(Number.isFinite(m.netIfWin)).toBe(true);
  });
});

describe("conversão BRL/USDT", () => {
  it("converte nos dois sentidos", () => {
    expect(convertMoney(10, "USDT", "BRL", 5)).toBe(50);
    expect(convertMoney(50, "BRL", "USDT", 5)).toBe(10);
    expect(convertMoney(50, "BRL", "BRL", 5)).toBe(50);
  });

  it("sem cotação não inventa número", () => {
    expect(convertMoney(10, "USDT", "BRL", null)).toBeNull();
    expect(convertMoney(10, "USDT", "BRL", 0)).toBeNull();
  });

  it("formata em pt-BR com sinal explícito", () => {
    expect(formatMoney(1234.5, "BRL")).toBe("R$ 1.234,50");
    expect(formatMoney(-1.5, "BRL", { signed: true })).toBe("−R$ 1,50");
    expect(formatMoney(null, "BRL")).toBe("—");
  });
});
