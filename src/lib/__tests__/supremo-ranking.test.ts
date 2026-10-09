import { describe, expect, it } from "vitest";
import { breakEvenAtivo, DEFAULT_COMBO } from "@/lib/supremo-combo";
const BE = breakEvenAtivo(DEFAULT_COMBO);
import type { Bet } from "@/hooks/useBets";
import {
  SNAPSHOT_MAX_MS,
  appendSnapshots,
  betNetUsdt,
  betProgress,
  currentStreak,
  leituraPlacar,
  placarPorEstrelas,
  rankingApostas,
  resumoGeral,
  scoreTrend,
} from "@/lib/supremo-ranking";

const NOW = 1_800_000_000_000;
let seq = 0;
function bet(p: Partial<Bet>): Bet {
  return {
    id: `b${seq++}`,
    symbol: "BTCUSDT",
    quote: "USDT",
    triggerPrice: 100,
    entryPrice: 100,
    target: 100.55,
    stop: 99.45,
    hitRate: 0,
    sampleSize: 0,
    createdAt: NOW - 600_000,
    armedAt: NOW - 500_000,
    resolvedAt: null,
    status: "open",
    priceAtCreate: 100,
    best: 100,
    worst: 100,
    stake: 100,
    leverage: 1,
    stakeCurrency: "USDT",
    ...p,
  };
}
const win = (p: Partial<Bet> = {}) => bet({ status: "win", resolvedAt: NOW - 100_000, ...p });
const loss = (p: Partial<Bet> = {}) => bet({ status: "loss", resolvedAt: NOW - 100_000, ...p });
const fx = { rate: 5, at: NOW };

describe("placar por estrelinhas", () => {
  it("agrega por faixa, mantém faixa vazia e marca amostra pequena", () => {
    const bets = [win({ starsAtCreate: 5 }), win({ starsAtCreate: 5 }), loss({ starsAtCreate: 5 }), loss({ starsAtCreate: 1 })];
    const { bands } = placarPorEstrelas(bets, fx, NOW, BE);
    const b5 = bands[4]!;
    expect(b5.ganhas).toBe(2);
    expect(b5.perdidas).toBe(1);
    expect(b5.taxa).toBeCloseTo(2 / 3);
    expect(b5.amostraPequena).toBe(true);
    expect(b5.vsEquilibrio).toBe("abaixo");
    expect(bands[2]!.total).toBe(0);
    expect(bands[2]!.taxa).toBeNull();
  });
  it("apostas sem starsAtCreate ficam fora do placar", () => {
    const r = placarPorEstrelas([win(), win({ starsAtCreate: 3 })], fx, NOW, BE);
    expect(r.semEstrelas).toBe(1);
    expect(r.bands.reduce((s, b) => s + b.total, 0)).toBe(1);
    expect(rankingApostas([win()], () => null, fx, NOW)[0]!.stars).toBeNull();
  });
  it("leitura detecta relação invertida", () => {
    const { bands } = placarPorEstrelas([loss({ starsAtCreate: 5 }), win({ starsAtCreate: 1 })], fx, NOW, BE);
    expect(leituraPlacar(bands).invertido).toBe(true);
  });
});

describe("progresso stop→alvo", () => {
  const b = bet({});
  it("0% no stop e 100% no alvo, com limites", () => {
    expect(betProgress(b, 99.45)!.pos).toBe(0);
    expect(betProgress(b, 90)!.pos).toBe(0);
    expect(betProgress(b, 100.55)!.pos).toBe(1);
    expect(betProgress(b, 200)!.pos).toBe(1);
    expect(betProgress(b, 100)!.pos).toBeCloseTo(0.5);
  });
  it("pendente não tem progresso", () => {
    expect(betProgress(bet({ status: "pending" }), 100)).toBeNull();
  });
});

describe("snapshots e tendência", () => {
  it("compara com o ciclo anterior", () => {
    const s = [
      { t: NOW - 120_000, symbol: "X", score: 50, stars: 3, status: "" },
      { t: NOW - 60_000, symbol: "X", score: 60, stars: 3, status: "" },
    ];
    expect(scoreTrend(s, "X", 60)).toBe("subiu");
    expect(scoreTrend(s, "X", 55)).toBe("desceu");
    expect(scoreTrend([], "X", 55)).toBeNull();
  });
  it("descarta snapshots com mais de 24 h", () => {
    const old = { t: NOW - SNAPSHOT_MAX_MS - 1, symbol: "X", score: 1, stars: 1, status: "" };
    const fresh = { t: NOW, symbol: "X", score: 2, stars: 1, status: "" };
    expect(appendSnapshots([old], [fresh], NOW)).toEqual([fresh]);
  });
});

describe("moedas da banca", () => {
  it("converte BRL para USDT e não soma sem cotação", () => {
    const brl = win({ stakeCurrency: "BRL", stake: 500 });
    const usdt = win({ stake: 100 });
    expect(betNetUsdt(brl, null, fx, NOW)).toBeCloseTo(betNetUsdt(usdt, null, fx, NOW)!);
    const r = resumoGeral([brl, usdt], null, NOW);
    expect(r.excluidas).toBe(1);
    expect(r.lucro).toBeCloseTo(betNetUsdt(usdt, null, fx, NOW)!, 2);
  });
});

describe("sequência", () => {
  it("conta vitórias seguidas mais recentes", () => {
    expect(currentStreak([loss({ resolvedAt: 1 }), win({ resolvedAt: 2 }), win({ resolvedAt: 3 })])).toEqual({ tipo: "vitorias", n: 2 });
    expect(currentStreak([win({ resolvedAt: 1 }), loss({ resolvedAt: 2 })])).toEqual({ tipo: "derrotas", n: 1 });
    expect(currentStreak([])).toBeNull();
  });
});
