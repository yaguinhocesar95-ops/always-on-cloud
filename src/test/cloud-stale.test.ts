import { describe, expect, it } from "vitest";
import { isCloudStale } from "@/hooks/useSupremoAuto";

describe("navegador assume quando a nuvem para", () => {
  const now = 1_000_000_000;
  it("nuvem com sinal há 1 minuto continua no comando", () => {
    expect(isCloudStale(now, now - 60_000)).toBe(false);
  });
  it("nuvem sem sinal há 3 minutos: navegador assume", () => {
    expect(isCloudStale(now, now - 3 * 60_000)).toBe(true);
  });
  it("nuvem que nunca deu sinal: navegador assume", () => {
    expect(isCloudStale(now, 0)).toBe(true);
  });
});
