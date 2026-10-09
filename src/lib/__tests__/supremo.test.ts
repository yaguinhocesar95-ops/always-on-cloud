import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/replay";
import { analyzeWindow, bandBounds, bandIndex, bandStats, planBet, rankBands, simulateBet } from "@/lib/supremo";

const T0 = 1_700_000_000_000;
/** Velas de 1 s com fechamento = high = low = preço dado. */
function series(prices: number[], t0 = T0): Candle[] {
  return prices.map((p, i) => ({ time: t0 + i * 1000, open: p, high: p, low: p, close: p }));
}
// Preços centrais de duas faixas distintas.
const A = bandBounds(bandIndex(100)).center;
const B = bandBounds(bandIndex(100) + 3).center;
const rep = (p: number, n: number) => Array<number>(n).fill(p);

describe("contagem de visitas", () => {
  it("conta nova visita só após ≥ 5 s fora", () => {
    const s = bandStats(series([...rep(A, 3), ...rep(B, 6), ...rep(A, 3)]));
    expect(s.find((b) => b.center === A)!.visits).toBe(2);
  });
  it("saída e volta rápida (< 5 s) é a mesma visita", () => {
    const s = bandStats(series([...rep(A, 3), ...rep(B, 2), ...rep(A, 3)]));
    expect(s.find((b) => b.center === A)!.visits).toBe(1);
  });
  it("segundos sem negócio mantêm o último preço", () => {
    const c = series([A, B]);
    c[1]!.time = T0 + 10_000; // 9 s sem vela
    const s = bandStats(c, undefined, T0 + 11_000);
    expect(s.find((b) => b.center === A)!.seconds).toBe(10);
  });
});

describe("faixa mais repetida", () => {
  it("é a de mais segundos", () => {
    const a = analyzeWindow(series([...rep(A, 10), ...rep(B, 30)]), T0, 40_000);
    expect(a.top!.center).toBe(B);
    expect(a.index).toBe(1);
  });
  it("desempate: mais visitas", () => {
    const ranked = rankBands([
      { index: 1, low: 0, high: 0, center: 1, seconds: 10, visits: 1, visitTimes: [] },
      { index: 2, low: 0, high: 0, center: 2, seconds: 10, visits: 3, visitTimes: [] },
    ]);
    expect(ranked[0]!.index).toBe(2);
  });
  it("usa a segunda colocada quando o preço já está na faixa", () => {
    const a = analyzeWindow(series([...rep(B, 30), ...rep(A * 1.02, 10)]), T0, 40_000);
    const plan = planBet(a, B);
    expect(plan?.usedSecond).toBe(true);
  });
});

describe("simulação", () => {
  const plan = { target: 110, trigger: 100, stop: 90 };
  it("toque ambíguo na mesma vela = derrota", () => {
    const c: Candle[] = [
      { time: T0, open: 99, high: 100, low: 99, close: 100 },
      { time: T0 + 1000, open: 100, high: 111, low: 89, close: 100 },
    ];
    const r = simulateBet(plan, 99, c);
    expect(r.outcome).toBe("loss");
    expect(r.ambiguous).toBe(true);
  });
  it("aposta não aberta = não executada", () => {
    expect(simulateBet(plan, 95, series([95, 96, 97])).outcome).toBe("nao-executada");
  });
  it("vitória quando toca o alvo antes do stop", () => {
    expect(simulateBet(plan, 95, series([95, 100, 105, 110])).outcome).toBe("win");
  });
});
