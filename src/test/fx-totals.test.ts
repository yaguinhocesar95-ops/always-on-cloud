import { describe, expect, it } from "vitest";
import { conversionText, financialsUsdt, round2, sumUsdt, toUsdt, FX_MAX_AGE_MS } from "@/lib/fx-totals";

const NOW = 1_000_000_000;
const fx = { rate: 5.5555, at: NOW - 1000 };
const it_ = (id: string, value: number, currency: string) => ({ id, label: id, value, currency });

const bet = (o: Record<string, unknown>) =>
  ({ id: "b", symbol: "BTCUSDT", status: "win", stake: 100, leverage: 1, stakeCurrency: "USDT", entryPrice: 100, triggerPrice: 100, target: 101, stop: 99, ...o }) as never;

describe("conversão para USDT", () => {
  it("BRL → USDT", () => {
    const c = toUsdt(1500, "BRL", fx, NOW);
    expect(c.ok && round2(c.usdt)).toBe(270.0);
    expect(conversionText(1500, "BRL", fx, NOW)).toBe("R$ 1.500,00 → US$ 270,00 USDT");
  });
  it("soma valores já em USDT", () => {
    expect(sumUsdt([it_("a", 10.1, "USDT"), it_("b", 20.2, "USDT")], null, NOW).total).toBe(30.3);
  });
  it("mistura BRL e USDT converte antes de somar", () => {
    const r = sumUsdt([it_("a", 100, "USDT"), it_("b", 1500, "BRL")], fx, NOW);
    expect(r.total).toBe(370);
    expect(r.excluded).toHaveLength(0);
  });
  it("cotação ausente: BRL fica fora", () => {
    const r = sumUsdt([it_("a", 100, "USDT"), it_("b", 1500, "BRL")], { rate: null, at: null }, NOW);
    expect(r.total).toBe(100);
    expect(r.excluded[0]).toMatchObject({ id: "b", reason: "ausente" });
    expect(conversionText(1500, "BRL", null, NOW)).toMatch(/aguardando cotação/);
  });
  it("cotação velha: BRL fica fora", () => {
    const r = sumUsdt([it_("b", 1500, "BRL")], { rate: 5.5, at: NOW - FX_MAX_AGE_MS - 1 }, NOW);
    expect(r.total).toBe(0);
    expect(r.excluded[0]!.reason).toBe("velha");
  });
  it("cotação inválida: BRL fica fora", () => {
    for (const rate of [0, -1, NaN, Infinity]) {
      expect(sumUsdt([it_("b", 1, "BRL")], { rate, at: NOW }, NOW).excluded[0]!.reason).toBe("invalida");
    }
  });
  it("arredonda para 2 casas", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(sumUsdt([it_("b", 100, "BRL")], { rate: 3, at: NOW }, NOW).total).toBe(33.33);
  });
});

describe("apostas", () => {
  it("preserva o valor original da aposta", () => {
    const b = bet({ stake: 1500, stakeCurrency: "BRL", status: "pending" });
    const snap = JSON.stringify(b);
    const f = financialsUsdt([b], () => null, fx, NOW);
    expect(JSON.stringify(b)).toBe(snap);
    expect(f.awaiting.included[0]).toMatchObject({ value: 1500, currency: "BRL" });
    expect(round2(f.awaiting.included[0]!.usdt)).toBe(270);
  });
  it("recarregar a página (salvar/ler) dá os mesmos totais", () => {
    const bets = [bet({ id: "1", stake: 1500, stakeCurrency: "BRL", status: "pending" }), bet({ id: "2", stake: 50, status: "open" })];
    const reloaded = JSON.parse(JSON.stringify(bets));
    const a = financialsUsdt(bets, () => 100, fx, NOW);
    const b = financialsUsdt(reloaded, () => 100, fx, NOW);
    expect(b.exposure.total).toBe(a.exposure.total);
    expect(b.awaiting.total).toBe(270);
    expect(b.perCoin).toEqual(a.perCoin);
  });
});
