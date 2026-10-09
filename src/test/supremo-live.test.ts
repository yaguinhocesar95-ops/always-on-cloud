import { describe, expect, it, vi } from "vitest";
import { bookStats, exposureBlock, hitRateText, isStale, selectCoin, DEFAULT_EXPOSURE } from "@/lib/supremo-live";
import { startSupremoTimer } from "@/hooks/useSupremoAuto";

const bet = (symbol: string, status = "open", combo?: string) => ({ symbol, status, combo }) as never;

describe("exposição", () => {
  it("bloqueia duplicada da mesma moeda e combinação", () => {
    expect(exposureBlock([bet("BTCUSDT", "open", "A")], "BTCUSDT", "A")).toMatch(/mesma combinação/);
  });
  it("respeita limite por moeda", () => {
    expect(exposureBlock([bet("BTCUSDT", "open", "A")], "BTCUSDT", "B", { ...DEFAULT_EXPOSURE, allowRepeat: true })).toMatch(/por moeda/);
  });
  it("aplica o limite total de apostas ativas", () => {
    const many = Array.from({ length: 50 }, (_, i) => bet(`C${i}`));
    expect(exposureBlock(many, "X", undefined)).toMatch(/limite/);
  });
  it("ignora apostas encerradas", () => {
    expect(exposureBlock([bet("BTCUSDT", "win")], "BTCUSDT", undefined)).toBeNull();
  });
});

describe("seleção", () => {
  const row = (symbol: string, index: number, blocks: string[] = []) =>
    ({ symbol, analysis: { index, top: { seconds: 1 }, coverage: 1 }, price: 1, blocks }) as never;
  it("pula moeda bloqueada e escolhe a próxima", () => {
    const { chosen, coins } = selectCoin([row("A", 9, ["perigo"]), row("B", 5)], () => null);
    expect((chosen as any)?.symbol).toBe("B");
    expect(coins).toHaveLength(2);
  });
  it("registra bloqueio de exposição", () => {
    const { chosen, coins } = selectCoin([row("A", 9)], () => "cheio");
    expect(chosen).toBeNull();
    expect(coins[0]!.exposure).toBe("cheio");
  });
});

describe("estatísticas e preço", () => {
  it("taxa de acerto mostra denominador", () => {
    const s = bookStats([{ status: "win" }, { status: "loss" }, { status: "open" }] as never);
    expect(s.resolved).toBe(2);
    expect(hitRateText(s)).toMatch(/1 vitória.* em 2/);
  });
  it("dado velho após 3s", () => {
    expect(isStale(0, 4000)).toBe(true);
    expect(isStale(0, 1000)).toBe(false);
  });
});

describe("timer", () => {
  it("dispara uma vez por intervalo e para ao cancelar", () => {
    vi.useFakeTimers();
    let t = 0;
    const due = vi.fn();
    const timer = startSupremoTimer(() => {}, due, 60_000, () => t);
    for (let i = 0; i < 125; i++) { t += 1000; vi.advanceTimersByTime(1000); }
    expect(due).toHaveBeenCalledTimes(2);
    timer.stop();
    for (let i = 0; i < 70; i++) { t += 1000; vi.advanceTimersByTime(1000); }
    expect(due).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
