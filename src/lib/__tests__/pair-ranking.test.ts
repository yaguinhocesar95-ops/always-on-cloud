import { describe, expect, it } from "vitest";

import { rankPairs, rankingHeadline, type PairRankInput } from "../pair-ranking";
import { runScalpEngine } from "../scalp";
import type { RawTick } from "../feed-quality";
import { computeMetrics, type ResolvedTrade } from "../metrics";

const NOW = 1_700_000_000_000;

/** Janela sintética de 180 s com um ímã claro acima do preço atual. */
function window(opts: { base: number; magnetBias: number }): RawTick[] {
  const out: RawTick[] = [];
  for (let i = 0; i < 180; i++) {
    const t = NOW - (180 - i) * 1000;
    const wave = Math.sin(i / 7) * opts.base * 0.002;
    const magnet = i % 3 === 0 ? opts.base * opts.magnetBias : 0;
    out.push({ time: t, price: opts.base + wave + magnet, source: "trade" });
  }
  return out;
}

function trades(symbol: string, wins: number, losses: number): ResolvedTrade[] {
  const list: ResolvedTrade[] = [];
  for (let i = 0; i < wins + losses; i++) {
    list.push({
      id: `${symbol}-${i}`,
      symbol,
      hour: 10,
      engineVersion: "baseline-1.0.0",
      regime: "normal",
      outcome: i < wins ? "win" : "loss",
      ambiguous: false,
      netIfWin: 0.0035,
      netIfLoss: -0.0075,
      resolvedAt: NOW - i * 1000,
    });
  }
  return list;
}

function input(symbol: string, ticks: RawTick[], resolved: ResolvedTrade[]): PairRankInput {
  return {
    symbol,
    base: symbol.slice(0, 3),
    quote: symbol.slice(3),
    engine: ticks.length > 0 ? runScalpEngine(ticks, NOW) : null,
    history: resolved.length > 0 ? computeMetrics(resolved, "conservadora") : null,
  };
}

describe("ranking informativo de pares", () => {
  it("ordena do cenário mais limpo para o mais sujo e nunca passa de 0..1", () => {
    const ranked = rankPairs([
      input("BTCBRL", window({ base: 500_000, magnetBias: 0.004 }), trades("BTCBRL", 60, 20)),
      input("ETHBRL", [], []),
    ]);

    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.symbol).toBe("BTCBRL");
    for (const r of ranked) {
      if (r.score != null) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("par sem leitura fica sem nota e com componentes não mensuráveis", () => {
    const [r] = rankPairs([input("SOLBRL", [], [])]);
    expect(r!.score).toBeNull();
    expect(r!.state).toBe("sem-dado");
    expect(r!.components.every((c) => c.value == null)).toBe(true);
  });

  it("amostra pequena não pesa no componente histórico", () => {
    const [r] = rankPairs([
      input("BTCBRL", window({ base: 500_000, magnetBias: 0.004 }), trades("BTCBRL", 3, 1)),
    ]);
    const hist = r!.components.find((c) => c.id === "historico")!;
    expect(hist.value).toBeNull();
    expect(hist.detail).toContain("pequena demais");
  });

  it("a frase do topo é honesta quando ninguém tem gatilho válido", () => {
    const ranked = rankPairs([input("BTCBRL", [], []), input("ETHBRL", [], [])]);
    expect(rankingHeadline(ranked)).toContain("Sem leitura suficiente");
  });

  it("expectativa líquida negativa derruba o componente histórico", () => {
    const ticks = window({ base: 500_000, magnetBias: 0.004 });
    const good = rankPairs([input("BTCBRL", ticks, trades("BTCBRL", 60, 20))])[0]!;
    const bad = rankPairs([input("BTCBRL", ticks, trades("BTCBRL", 10, 70))])[0]!;
    const g = good.components.find((c) => c.id === "historico")!.value!;
    const b = bad.components.find((c) => c.id === "historico")!.value!;
    expect(g).toBeGreaterThan(b);
  });

  it("no agrupamento estável, os filtros viram o ingrediente dominante da nota", () => {
    const ticks = window({ base: 500_000, magnetBias: 0.004 });
    const history = trades("BTCBRL", 10, 70);
    const baseline = rankPairs([input("BTCBRL", ticks, history)])[0]!;
    expect(baseline.mode).toBe("baseline");
    expect(baseline.components.find((c) => c.id === "filtros")!.weight).toBeCloseTo(0.25);

    const engine = runScalpEngine(ticks, NOW, { mode: "stable-cluster" });
    const stable = rankPairs([
      {
        symbol: "BTCBRL",
        base: "BTC",
        quote: "BRL",
        engine,
        history: computeMetrics(history, "conservadora"),
      },
    ])[0]!;
    expect(stable.mode).toBe("stable-cluster");
    expect(stable.components.find((c) => c.id === "filtros")!.weight).toBeCloseTo(0.5);
  });

  it("no agrupamento estável, o melhor placar de filtros vence mesmo com histórico pior", () => {
    const ticks = window({ base: 500_000, magnetBias: 0.004 });
    const engine = runScalpEngine(ticks, NOW, { mode: "stable-cluster" });
    // Mesmos números de motor; só o placar de filtros muda (dois reprovas).
    const dirty = {
      ...engine,
      filters: engine.filters.map((f) =>
        f.id === "volatility" || f.id === "cluster-stable"
          ? { ...f, status: "block" as const }
          : f,
      ),
    };
    const ranked = rankPairs([
      {
        symbol: "AAAABRL",
        base: "AAAA",
        quote: "BRL",
        engine,
        history: computeMetrics(trades("AAAABRL", 10, 70), "conservadora"),
      },
      {
        symbol: "BBBBBRL",
        base: "BBBB",
        quote: "BRL",
        engine: dirty,
        history: computeMetrics(trades("BBBBBRL", 60, 20), "conservadora"),
      },
    ]);
    expect(ranked[0]!.symbol).toBe("AAAABRL");
  });
});
