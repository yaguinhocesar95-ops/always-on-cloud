import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { economiaDaCombinacao, breakEvenDoPlano, parseComboLabel, rotuloDesfecho } from "@/lib/supremo-economics";
import { breakEvenAtivo, combinacaoAtiva, DEFAULT_COMBO } from "@/lib/supremo-combo";
import { regimeBlock } from "@/lib/market-regime";
import { exposureBlock, MAX_ACTIVE_ANTI_RAJADA } from "@/lib/supremo-live";
import { episodios, EPISODE_GAP_MS } from "@/lib/supremo-episodes";
import { isShadowCandidate } from "@/lib/supremo-shadow";
import { splitSlots, TRAIN_FRACTION, NENHUMA_TEXT } from "@/lib/supremo-expectancy-lab";
import { seededRandom } from "@/lib/supremo-control";

describe("economia da combinação", () => {
  it("break-even sai do alvo/stop + taxa", () => {
    const e = economiaDaCombinacao({ alvoBruto: 0.0035, stopBruto: 0.0065, taxaIdaVolta: 0.002 });
    expect(e.ganhoLiquido).toBeCloseTo(0.0015);
    expect(e.perdaLiquida).toBeCloseTo(0.0085);
    expect(e.breakEven).toBeCloseTo(0.85);
    expect(e.baselineAleatorio).toBeCloseTo(0.65);
  });
  it("alvo menor que a taxa exige 100%", () => {
    expect(economiaDaCombinacao({ alvoBruto: 0.001, stopBruto: 0.005, taxaIdaVolta: 0.002 }).breakEven).toBe(1);
  });
  it("plano gatilho/alvo/stop", () => {
    expect(breakEvenDoPlano({ trigger: 100, target: 100.35, stop: 100 / 1.0065 })).toBeCloseTo(0.85, 2);
  });
  it("rótulo do desfecho usa números da própria aposta", () => {
    const c = parseComboLabel("alvo +0,35% / stop −0,65%")!;
    expect(c.alvoBruto).toBeCloseTo(0.0035);
    expect(c.stopBruto).toBeCloseTo(0.0065);
    const txt = rotuloDesfecho({ combo: "alvo +0,35% / stop −0,65%" } as any, "win");
    expect(txt).toContain("0,35%");
    expect(txt).toContain("0,15%");
  });
  it("regra de alta usa o break-even da combinação", () => {
    const be = breakEvenAtivo(DEFAULT_COMBO);
    expect(regimeBlock("alta", { hitRate: be - 0.01, sample: 10, breakEven: be })).toBe("mercado-em-alta");
    expect(regimeBlock("alta", { hitRate: be, sample: 10, breakEven: be })).toBeNull();
  });
});

describe("guarda contra o 68% fixo", () => {
  it("break-even muda com a combinação (não é constante)", () => {
    const usada = { targetPct: 0.0035, stopPct: 0.0065, mode: "percentual" as const };
    expect(breakEvenAtivo(usada)).toBeCloseTo(0.85);
    expect(breakEvenAtivo({ ...usada, stopPct: 0.003 })).toBeCloseTo(0.5 / 0.65);
    expect(economiaDaCombinacao(combinacaoAtiva(DEFAULT_COMBO)).breakEven).toBeCloseTo(breakEvenAtivo(DEFAULT_COMBO));
  });
  it("nenhum arquivo do app ou dos testes usa 0.68 / 68% como break-even", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !p.endsWith("supremo-economics.test.ts") && !p.includes(`${join("components", "ui")}`)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    const bad = files.filter((p) => /\b0[.,]68\b(?!rem)|\b68\s*%/.test(readFileSync(p, "utf8").replace(/0\.68rem/g, "")));
    expect(bad).toEqual([]);
  });
});

describe("anti-rajada", () => {
  const NOW = 1_800_000_000_000;
  it(`máx. ${MAX_ACTIVE_ANTI_RAJADA} ativas contando pendentes`, () => {
    const bets = [
      { status: "pending", symbol: "AUSDT", createdAt: NOW - 3_600_000 },
      { status: "open", symbol: "BUSDT", createdAt: NOW - 3_600_000 },
    ] as any;
    expect(exposureBlock(bets, "CUSDT", "x", undefined, NOW)).toMatch(/limite de 2/);
  });
  it("sem intervalo mínimo: aposta 1 min depois da anterior", () => {
    const bets = [{ status: "win", symbol: "AUSDT", createdAt: NOW - 60_000 }] as any;
    expect(exposureBlock(bets, "CUSDT", "x", undefined, NOW)).toBeNull();
  });
});

describe("episódios, sombra e laboratório", () => {
  it("apostas próximas viram 1 episódio", () => {
    const t = 1_800_000_000_000;
    const b = (createdAt: number) => ({ id: String(createdAt), createdAt, status: "win", symbol: "AUSDT" }) as any;
    const eps = episodios([b(t), b(t + 60_000), b(t + EPISODE_GAP_MS * 3)], null, t + EPISODE_GAP_MS * 4);
    expect(eps.length).toBe(2);
  });
  it("sombra só para canceladas por passar do alvo", () => {
    expect(isShadowCandidate({ status: "win", cancelReason: undefined } as any)).toBe(false);
  });
  it("treino/validação 70/30 em ordem", () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({ hourStart: i * 3_600_000 }) as any);
    const r = splitSlots(slots);
    expect(r.treino.length).toBe(Math.round(10 * TRAIN_FRACTION));
    expect(Math.max(...r.treino.map((x) => x.hourStart))).toBeLessThan(Math.min(...r.validacao.map((x) => x.hourStart)));
    expect(NENHUMA_TEXT).toMatch(/expectativa positiva/);
  });
  it("aleatório com semente é reprodutível", () => {
    const a = seededRandom(7), b = seededRandom(7);
    expect([a(), a()]).toEqual([b(), b()]);
  });
});
