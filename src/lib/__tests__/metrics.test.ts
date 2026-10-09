/** Fase 9 — testes das métricas honestas e da política de vela ambígua. */
import { describe, expect, it } from "vitest";

import {
  computeMetrics,
  groupMetrics,
  wilsonInterval,
  MIN_SIGNIFICANT_SAMPLE,
  type ResolvedTrade,
} from "@/lib/metrics";

function trade(over: Partial<ResolvedTrade> & { id: string }): ResolvedTrade {
  return {
    symbol: "BTCBRL",
    hour: 10,
    engineVersion: "baseline-1.0.0",
    regime: "normal",
    outcome: "win",
    ambiguous: false,
    netIfWin: 0.0035,
    netIfLoss: -0.0075,
    resolvedAt: 1,
    ...over,
  };
}

const mixed: ResolvedTrade[] = [
  trade({ id: "1", outcome: "win", resolvedAt: 1 }),
  trade({ id: "2", outcome: "loss", resolvedAt: 2 }),
  trade({ id: "3", outcome: "win", resolvedAt: 3 }),
  trade({ id: "4", outcome: "loss", resolvedAt: 4 }),
];

describe("amostra", () => {
  it("sem operações não conclui nada", () => {
    const m = computeMetrics([]);
    expect(m.sample).toBe(0);
    expect(m.expectancy).toBeNull();
    expect(m.lowSignificance).toBe(true);
  });

  it("avisa que amostra pequena é ruído", () => {
    const m = computeMetrics(mixed);
    expect(m.sample).toBe(4);
    expect(m.lowSignificance).toBe(true);
    expect(m.significanceNote).toContain(String(MIN_SIGNIFICANT_SAMPLE));
  });
});

describe("expectativa x taxa de acerto", () => {
  it("50% de acerto com perda maior que o ganho dá expectativa negativa", () => {
    const m = computeMetrics(mixed);
    expect(m.hitRate).toBe(0.5);
    expect(m.expectancy!).toBeLessThan(0);
    expect(m.profitFactor!).toBeLessThan(1);
    expect(m.breakevenHitRate!).toBeGreaterThan(0.5);
  });

  it("mede rebaixamento e pior sequência de perdas", () => {
    const losing = [
      trade({ id: "a", outcome: "loss", resolvedAt: 1 }),
      trade({ id: "b", outcome: "loss", resolvedAt: 2 }),
      trade({ id: "c", outcome: "win", resolvedAt: 3 }),
      trade({ id: "d", outcome: "loss", resolvedAt: 4 }),
    ];
    const m = computeMetrics(losing);
    expect(m.worstLosingStreak).toBe(2);
    expect(m.maxDrawdown).toBeGreaterThan(0);
    expect(m.totalReturn).toBeLessThan(0);
  });

  it("retorno por unidade de risco usa a perda potencial", () => {
    const m = computeMetrics(mixed);
    expect(m.returnPerRisk!).toBeCloseTo(m.expectancy! / 0.0075, 10);
  });
});

describe("vela ambígua (alvo e stop juntos)", () => {
  const withAmbiguous = [
    trade({ id: "1", outcome: "win", resolvedAt: 1 }),
    trade({ id: "2", outcome: "loss", ambiguous: true, resolvedAt: 2 }),
  ];

  it("conservadora conta como perda", () => {
    const m = computeMetrics(withAmbiguous, "conservadora");
    expect(m.sample).toBe(2);
    expect(m.wins).toBe(1);
    expect(m.ambiguousCount).toBe(1);
  });

  it("excluir tira da estatística e diz quantas saíram", () => {
    const m = computeMetrics(withAmbiguous, "excluir");
    expect(m.sample).toBe(1);
    expect(m.excludedCount).toBe(1);
  });

  it("otimista conta como ganho (só para comparação)", () => {
    const m = computeMetrics(withAmbiguous, "otimista");
    expect(m.wins).toBe(2);
    expect(m.expectancy!).toBeGreaterThan(0);
  });
});

describe("intervalo de Wilson", () => {
  it("é largo com amostra pequena e inválido sem amostra", () => {
    const ci = wilsonInterval(1, 2)!;
    expect(ci.high - ci.low).toBeGreaterThan(0.5);
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe("agrupamento", () => {
  it("separa por par e ordena a chave", () => {
    const groups = groupMetrics(
      [trade({ id: "1", symbol: "ETHBRL" }), trade({ id: "2", symbol: "BTCBRL" })],
      (t) => t.symbol,
    );
    expect(groups.map((g) => g.key)).toEqual(["BTCBRL", "ETHBRL"]);
    expect(groups[0]!.metrics.sample).toBe(1);
  });
});
