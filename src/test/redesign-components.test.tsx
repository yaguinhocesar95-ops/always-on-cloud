// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BetTicket, STATUS_META } from "@/components/BetTicket";
import { BetRuler, rulerPosition } from "@/components/BetRuler";
import { StarRating } from "@/components/StarRating";
import type { Bet, BetStatus } from "@/hooks/useBets";
import { UI_LAYOUT_KEY, readUiLayout, resetUiLayoutCache, writeUiLayout } from "@/hooks/useUiLayout";

afterEach(() => cleanup());

function bet(status: BetStatus): Bet {
  const t = Date.now();
  return {
    id: `b-${status}`,
    symbol: "BTCUSDT",
    quote: "USDT",
    triggerPrice: 100,
    entryPrice: 100,
    target: 100.55,
    stop: 99.45,
    hitRate: 0.9,
    sampleSize: 100,
    createdAt: t - 60_000,
    armedAt: status === "pending" ? null : t - 30_000,
    resolvedAt: status === "win" || status === "loss" || status === "cancelled" ? t : null,
    status,
    priceAtCreate: 100.2,
    best: 100.3,
    worst: 99.9,
    stake: 10,
    leverage: 5,
    stakeCurrency: "USDT",
  };
}

describe("BetTicket", () => {
  for (const status of ["pending", "open", "win", "loss", "cancelled"] as BetStatus[]) {
    it(`mostra o selo de status "${STATUS_META[status].label}"`, () => {
      render(<BetTicket bet={bet(status)} currency="USDT" livePrices={new Map([["BTCUSDT", 100.2]])} />);
      expect(screen.getAllByText(STATUS_META[status].label).length).toBeGreaterThan(0);
    });
  }
});

describe("BetRuler", () => {
  it.each([
    [99.45, 0],
    [100, 0.5],
    [100.55, 1],
  ])("posição de %s = %s", (v, expected) => {
    expect(rulerPosition(v, 99.45, 100.55).pct).toBeCloseTo(expected, 5);
  });
  it("preço fora da faixa fica preso na borda e é sinalizado", () => {
    expect(rulerPosition(98, 99.45, 100.55)).toEqual({ pct: 0, outside: "below" });
    expect(rulerPosition(102, 99.45, 100.55)).toEqual({ pct: 1, outside: "above" });
  });
  it("renderiza sem erro", () => {
    const { container } = render(
      <BetRuler stop={99.45} trigger={100} target={100.55} current={100.2} fmt={(v) => String(v)} />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

describe("StarRating", () => {
  for (const n of [0, 1, 2, 3, 4, 5]) {
    it(`${n} estrelinhas`, () => {
      const { container } = render(<StarRating value={n} />);
      expect(screen.getByRole("img")).toHaveAttribute("aria-label", `${n} de 5 estrelinhas`);
      expect(container.querySelectorAll('[data-filled="true"]').length).toBe(n);
    });
  }
});

describe("ypx-ui-layout-v1", () => {
  beforeEach(() => {
    localStorage.clear();
    resetUiLayoutCache();
  });
  it("salva e relê as preferências", () => {
    writeUiLayout({ density: "compact", textSize: "large", contrast: "high", focus: true, sections: { a: false } });
    expect(JSON.parse(localStorage.getItem(UI_LAYOUT_KEY)!).density).toBe("compact");
    resetUiLayoutCache();
    const ui = readUiLayout();
    expect(ui).toMatchObject({ density: "compact", textSize: "large", contrast: "high", focus: true, sections: { a: false } });
  });
  it("ignora dado corrompido", () => {
    localStorage.setItem(UI_LAYOUT_KEY, "{oops");
    expect(readUiLayout().density).toBe("comfortable");
  });
});
