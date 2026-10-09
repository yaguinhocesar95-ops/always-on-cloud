/**
 * Fase 9 — testes unitários do motor determinístico.
 *
 * Cada caso corresponde a uma situação obrigatória do escopo: aquecimento,
 * mercado parado, ausência de cluster, preço abaixo do gatilho, perigo de
 * cauda, dado velho, fora de ordem, segundo sem leitura e duplicidade.
 */
import { describe, expect, it } from "vitest";

import {
  ENGINE_VERSION,
  ENGINE_VERSION_FILTERED,
  GROSS_TARGET_PCT,
  MIN_TICKS,
  runScalpEngine,
  type RawTick,
} from "@/lib/scalp";
import { MAX_AGE_MS, normalizeTicks } from "@/lib/feed-quality";

const NOW = 1_700_000_000_000;

/** Série de 1 ponto por segundo terminando exatamente em `now`. */
function series(prices: number[], now = NOW): RawTick[] {
  const n = prices.length;
  return prices.map((price, i) => ({
    time: now - (n - 1 - i) * 1000,
    price,
    source: "trade" as const,
  }));
}

function flat(count: number, price: number): number[] {
  return Array.from({ length: count }, () => price);
}

describe("aquecimento", () => {
  it("não produz sinal antes de 30 pontos", () => {
    const e = runScalpEngine(series(flat(MIN_TICKS - 1, 100)), NOW);
    expect(e.ready).toBe(false);
    expect(e.reason).toBe("warmup");
    expect(e.entryTrigger).toBeNull();
    expect(e.warmupPct).toBeLessThan(1);
  });

  it("janela vazia devolve estado vazio e bloqueado", () => {
    const e = runScalpEngine([], NOW);
    expect(e.ready).toBe(false);
    expect(e.price).toBeNull();
    expect(e.quality.level).toBe("empty");
  });
});

describe("mercado parado", () => {
  it("preço constante bloqueia com motivo 'flat'", () => {
    const e = runScalpEngine(series(flat(120, 100)), NOW);
    expect(e.ready).toBe(false);
    expect(e.blockReasons).toContain("flat");
    expect(e.sd).toBe(0);
    expect(e.danger).toBe(false);
  });
});

describe("gatilho válido", () => {
  const prices = [...flat(150, 100), ...Array.from({ length: 30 }, (_, i) => 100 + (i + 1) * 0.03)];
  const e = runScalpEngine(series(prices), NOW);

  it("libera o sinal com o preço acima do gatilho", () => {
    expect(e.ready).toBe(true);
    expect(e.reason).toBeNull();
    expect(e.engineVersion).toBe(ENGINE_VERSION);
  });

  it("alvo é o ímã e o gatilho nasce 0,55% abaixo dele", () => {
    expect(e.grossTarget).toBe(e.magnetPrice);
    expect(e.entryTrigger!).toBeCloseTo(e.magnetPrice! / (1 + GROSS_TARGET_PCT), 10);
    expect(e.stop!).toBeCloseTo(e.entryTrigger! / (1 + GROSS_TARGET_PCT), 10);
    expect(e.price!).toBeGreaterThan(e.entryTrigger!);
  });

  it("é determinístico: mesmo input, mesmo output", () => {
    const again = runScalpEngine(series(prices), NOW);
    expect(again).toEqual(e);
  });
});

describe("preço abaixo do gatilho", () => {
  it("bloqueia quando a queda já passou da entrada", () => {
    const prices = [...flat(120, 100), ...Array.from({ length: 60 }, (_, i) => 100 - (i + 1) / 60)];
    const e = runScalpEngine(series(prices), NOW);
    expect(e.ready).toBe(false);
    expect(e.blockReasons).toContain("below-entry");
    expect(e.entryTrigger).toBeNull();
  });
});

describe("perigo de cauda", () => {
  it("queda acima de 3 desvios em 5 s invalida o sinal", () => {
    const prices = [...flat(178, 100), 96, 95];
    const e = runScalpEngine(series(prices), NOW);
    expect(e.danger).toBe(true);
    expect(e.velocitySigma!).toBeGreaterThan(3);
    expect(e.blockReasons).toContain("danger");
    expect(e.ready).toBe(false);
  });
});

describe("qualidade do dado", () => {
  it("dado velho nunca é executável", () => {
    const e = runScalpEngine(series(flat(120, 100), NOW - 10_000), NOW);
    expect(e.quality.level).toBe("stale");
    expect(e.quality.ageMs!).toBeGreaterThan(MAX_AGE_MS);
    expect(e.blockReasons).toContain("stale-data");
    expect(e.ready).toBe(false);
  });

  it("cobertura baixa marca o dado como incompleto", () => {
    const sparse: RawTick[] = Array.from({ length: 40 }, (_, i) => ({
      time: NOW - (39 - i) * 4000,
      price: 100 + (i % 5) * 0.1,
    }));
    const e = runScalpEngine(sparse, NOW);
    expect(e.quality.missingSeconds).toBeGreaterThan(0);
    expect(e.quality.coverage).toBeLessThan(0.6);
    expect(e.blockReasons).toContain("incomplete-data");
  });

  it("duplicatas no mesmo segundo: a última vence e é contada", () => {
    const raw: RawTick[] = [
      { time: NOW - 2000, price: 100 },
      { time: NOW - 1500, price: 101 },
      { time: NOW - 1200, price: 102 },
      { time: NOW, price: 103 },
    ];
    const { ticks, quality } = normalizeTicks(raw, NOW, 180_000, 180);
    expect(quality.duplicates).toBe(1);
    expect(ticks.map((t) => t.price)).toEqual([100, 102, 103]);
  });

  it("leitura fora de ordem é rejeitada e contada", () => {
    const raw: RawTick[] = [
      { time: NOW - 10_000, price: 100 },
      { time: NOW - 60_000, price: 99 },
      { time: NOW, price: 101 },
    ];
    const { ticks, quality } = normalizeTicks(raw, NOW, 180_000, 180);
    expect(quality.outOfOrder).toBe(1);
    expect(ticks).toHaveLength(2);
  });

  it("preço inválido ou timestamp do futuro é descartado", () => {
    const raw: RawTick[] = [
      { time: NOW - 1000, price: 0 },
      { time: NOW + 60_000, price: 100 },
      { time: NaN, price: 100 },
      { time: NOW, price: 100 },
    ];
    const { ticks, quality } = normalizeTicks(raw, NOW, 180_000, 180);
    expect(quality.invalid).toBe(3);
    expect(ticks).toHaveLength(1);
  });

  it("segundos sem leitura são contados como buraco", () => {
    const raw: RawTick[] = [
      { time: NOW - 4000, price: 100 },
      { time: NOW - 3000, price: 100 },
      { time: NOW, price: 100 },
    ];
    const { quality } = normalizeTicks(raw, NOW, 180_000, 180);
    expect(quality.missingSeconds).toBe(2);
  });
});

describe("modo aprimorado só bloqueia", () => {
  const prices = [...flat(150, 100), ...Array.from({ length: 30 }, (_, i) => 100 + (i + 1) * 0.03)];

  it("nunca cria sinal que o baseline não deu", () => {
    const base = runScalpEngine(series(flat(120, 100)), NOW);
    const filtered = runScalpEngine(series(flat(120, 100)), NOW, { mode: "stable-cluster" });
    expect(base.ready).toBe(false);
    expect(filtered.ready).toBe(false);
  });

  it("mantém os números do baseline e apenas acrescenta motivo", () => {
    const base = runScalpEngine(series(prices), NOW);
    const filtered = runScalpEngine(series(prices), NOW, { mode: "stable-cluster" });
    expect(filtered.magnetPrice).toBe(base.magnetPrice);
    expect(filtered.entryTrigger).toBe(base.entryTrigger);
    expect(filtered.readyBaseline).toBe(true);
    expect(filtered.engineVersion).toBe(ENGINE_VERSION_FILTERED);
    if (!filtered.ready) expect(filtered.blockReasons).toContain("filtro");
  });

  it("sem livro de ofertas, spread e slippage não derrubam o sinal no modo aprimorado", () => {
    const filtered = runScalpEngine(series(prices), NOW, { mode: "stable-cluster" });
    const book = filtered.filters.filter((f) => f.id === "spread" || f.id === "slippage");
    expect(book.every((f) => f.status === "unavailable")).toBe(true);
    expect(filtered.blockReasons).not.toContain("filtro");
    // Com o livro em mãos, os mesmos filtros continuam bloqueando quando reprovam.
    const withBadBook = runScalpEngine(series(prices), NOW, {
      mode: "stable-cluster",
      context: { bestBid: 100, bestAsk: 100.2, askQty: 1 },
    });
    expect(withBadBook.blockReasons).toContain("filtro");
  });

  it("exchange fora do ar derruba o sinal no modo aprimorado", () => {
    const filtered = runScalpEngine(series(prices), NOW, {
      mode: "stable-cluster",
      context: { exchangeDown: true },
    });
    expect(filtered.ready).toBe(false);
    expect(filtered.filters.some((f) => f.id === "exchange" && f.status !== "pass")).toBe(true);
  });
});
