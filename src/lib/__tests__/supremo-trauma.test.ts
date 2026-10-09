import { describe, expect, it } from "vitest";
import type { Candle } from "../replay";
import { dangerStats } from "../supremo";
import {
  applyTrauma,
  TRAUMA_COOLDOWN_MS,
  TRAUMA_STABLE_MS,
  traumaText,
  updateTrauma,
  type TraumaState,
} from "../supremo-trauma";

const SYM = "TESTUSDT";

/** Velas de 1 s com oscilação pequena (±0,01%) em torno de `base`. */
function calm(start: number, n: number, base = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = base * (1 + (i % 2 ? 0.0001 : -0.0001));
    return { time: start + i * 1000, open: p, high: p * 1.00005, low: p * 0.99995, close: p };
  });
}

/** Janela calma seguida de uma queda forte nos últimos 5 s. */
function crash(start: number, n = 120, base = 100, dropPct = 3): Candle[] {
  const c = calm(start, n, base);
  for (let k = 1; k <= 5; k++) {
    const p = base * (1 - (dropPct / 100) * (k / 5));
    const i = n - 6 + k;
    c[i] = { time: start + i * 1000, open: p, high: p, low: p, close: p };
  }
  return c;
}

const lastTime = (c: Candle[]) => c[c.length - 1]!.time;
const at = (c: Candle[]) => lastTime(c) + 1500; // dados frescos (< 3 s)

describe("trauma da moeda", () => {
  it("usa exatamente o gatilho de perigo (3σ)", () => {
    const c = crash(0);
    expect(dangerStats(c)?.danger).toBe(true);
    const s = updateTrauma(undefined, { symbol: SYM, candles: c, now: at(c), coverage: 1, blocks: ["perigo"] });
    expect(s.active).toBe(true);
    expect(s.phase).toBe("trauma");
    expect(s.reason).toMatch(/desvio-padrão/);
    expect(s.reason).toMatch(/3σ/);
  });

  it("não entra em trauma sem perigo", () => {
    const c = calm(0, 120);
    expect(dangerStats(c)?.danger).toBe(false);
    const s = updateTrauma(undefined, { symbol: SYM, candles: c, now: at(c), coverage: 1, blocks: [] });
    expect(s.active).toBe(false);
    expect(traumaText(s)).toBeNull();
  });

  it("texto mostra motivo e aviso de condição técnica", () => {
    const c = crash(0);
    const s = updateTrauma(undefined, { symbol: SYM, candles: c, now: at(c), coverage: 1, blocks: [] });
    const t = traumaText(s)!;
    expect(t).toMatch(/queda de/);
    expect(t).toMatch(/não garantia/);
  });

  function triggered(): { s: TraumaState; t0: number } {
    const c = crash(0);
    return { s: updateTrauma(undefined, { symbol: SYM, candles: c, now: at(c), coverage: 1, blocks: [] }), t0: lastTime(c) };
  }

  it("segue em trauma antes de 60 s sem nova mínima", () => {
    const { s, t0 } = triggered();
    const c = calm(t0 + 1000, 30, 97.5);
    const n = updateTrauma(s, { symbol: SYM, candles: c, now: at(c), coverage: 1, blocks: [] });
    expect(n.active).toBe(true);
    expect(n.phase).toBe("trauma");
    expect(n.waiting).toMatch(/nova mínima/);
  });

  it("estabiliza, cumpre cooldown de 5 min e é liberada se passar nos bloqueios normais", () => {
    const { s, t0 } = triggered();
    const c1 = calm(t0 + 1000, 120, 98);
    const n1 = updateTrauma(s, { symbol: SYM, candles: c1, now: at(c1), coverage: 1, blocks: [] });
    expect(n1.phase).toBe("cooldown");
    expect(n1.active).toBe(true);

    const c2 = calm(lastTime(c1) + 1000, 120, 98);
    const n2 = updateTrauma(n1, { symbol: SYM, candles: c2, now: at(c2), coverage: 1, blocks: [] });
    expect(n2.phase).toBe("cooldown");
    expect(n2.waiting).toMatch(/cooldown: faltam/);

    const c3 = calm(n1.recoveredAt! + TRAUMA_COOLDOWN_MS, 120, 98);
    const n3 = updateTrauma(n2, { symbol: SYM, candles: c3, now: at(c3), coverage: 1, blocks: [] });
    expect(n3.active).toBe(false);
    expect(n3.phase).toBe("liberada");
  });

  it("reavaliação final com bloqueio normal recomeça o trauma", () => {
    const { s, t0 } = triggered();
    const c1 = calm(t0 + 1000, 120, 98);
    const n1 = updateTrauma(s, { symbol: SYM, candles: c1, now: at(c1), coverage: 1, blocks: [] });
    const c3 = calm(n1.recoveredAt! + TRAUMA_COOLDOWN_MS, 120, 98);
    const n3 = updateTrauma(n1, { symbol: SYM, candles: c3, now: at(c3), coverage: 1, blocks: ["indice-baixo"] });
    expect(n3.active).toBe(true);
    expect(n3.phase).toBe("trauma");
    expect(n3.waiting).toMatch(/indice-baixo/);
  });

  it("nova mínima durante o cooldown recomeça o trauma", () => {
    const { s, t0 } = triggered();
    const c1 = calm(t0 + 1000, 120, 98);
    const n1 = updateTrauma(s, { symbol: SYM, candles: c1, now: at(c1), coverage: 1, blocks: [] });
    const c2 = calm(lastTime(c1) + 1000, 120, 98);
    const i = c2.length - 3;
    c2[i] = { ...c2[i]!, low: 96.9 }; // abaixo da mínima do gatilho (97)
    const n2 = updateTrauma(n1, { symbol: SYM, candles: c2, now: at(c2), coverage: 1, blocks: [] });
    expect(n2.phase).toBe("trauma");
    expect(n2.lowestPrice).toBe(96.9);
  });

  it("amplitude acima de 0,50% impede a estabilização", () => {
    const { s, t0 } = triggered();
    const c = calm(t0 + 1000, 120, 98);
    const i = c.length - 10;
    c[i] = { ...c[i]!, high: 99 }; // ~1% acima
    const n = updateTrauma(s, { symbol: SYM, candles: c, now: at(c), coverage: 1, blocks: [] });
    expect(n.phase).toBe("trauma");
    expect(n.waiting).toMatch(/amplitude/);
  });

  it("dados velhos e cobertura baixa impedem a estabilização", () => {
    const { s, t0 } = triggered();
    const c = calm(t0 + 1000, 120, 98);
    const old = updateTrauma(s, { symbol: SYM, candles: c, now: lastTime(c) + 10_000, coverage: 1, blocks: [] });
    expect(old.waiting).toMatch(/dados velhos/);
    const cov = updateTrauma(s, { symbol: SYM, candles: c, now: at(c), coverage: 0.3, blocks: [] });
    expect(cov.waiting).toMatch(/cobertura/);
    expect(cov.phase).toBe("trauma");
  });

  it("novo perigo durante o cooldown volta ao trauma", () => {
    const { s, t0 } = triggered();
    const c1 = calm(t0 + 1000, 120, 98);
    const n1 = updateTrauma(s, { symbol: SYM, candles: c1, now: at(c1), coverage: 1, blocks: [] });
    expect(n1.phase).toBe("cooldown");
    const c2 = crash(lastTime(c1) + 1000, 120, 98);
    const n2 = updateTrauma(n1, { symbol: SYM, candles: c2, now: at(c2), coverage: 1, blocks: [] });
    expect(n2.phase).toBe("trauma");
    expect(n2.recoveredAt).toBeUndefined();
  });

  it("applyTrauma acrescenta o bloqueio 'trauma' e grava no mapa", () => {
    const map: Record<string, TraumaState> = {};
    const c = crash(0);
    const r = applyTrauma(map, { symbol: SYM, candles: c, now: at(c), coverage: 1, blocks: ["perigo"] });
    expect(r.blocks).toEqual(["perigo", "trauma"]);
    expect(map[SYM]?.active).toBe(true);
    // estado serializável (persistência no navegador)
    expect(JSON.parse(JSON.stringify(map))[SYM].phase).toBe("trauma");
  });

  it("constantes conforme a especificação", () => {
    expect(TRAUMA_STABLE_MS).toBe(60_000);
    expect(TRAUMA_COOLDOWN_MS).toBe(300_000);
  });
});
