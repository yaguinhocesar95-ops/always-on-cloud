/**
 * Fase 2 — normalização e qualidade do dado.
 *
 * Um único lugar transforma leituras cruas (websocket, REST, semente de velas)
 * na série normalizada de 1 ponto por segundo que o motor consome, e mede a
 * saúde desse dado. Regra dura: dado velho, incompleto, fora de ordem ou
 * abaixo do limite de cobertura NUNCA produz sinal executável.
 */

export type TickSource = "trade" | "ticker" | "rest" | "seed" | "hold";

export type RawTick = { time: number; price: number; source?: TickSource };
export type Tick = { time: number; price: number };

/** Idade máxima aceita da última leitura. */
export const MAX_AGE_MS = 3_000;
/** Cobertura mínima de segundos preenchidos dentro do intervalo observado. */
export const MIN_COVERAGE = 0.6;

export type FeedLevel = "empty" | "healthy" | "degraded" | "stale";

export type FeedQuality = {
  /** Pontos normalizados (1 por segundo) dentro da janela. */
  points: number;
  /** Intervalo coberto, em segundos. */
  spanSeconds: number;
  /** Idade da última leitura, em ms. */
  ageMs: number | null;
  /** Leituras descartadas por chegarem fora de ordem. */
  outOfOrder: number;
  /** Leituras do mesmo segundo (a última vence). */
  duplicates: number;
  /** Segundos sem nenhuma leitura dentro do intervalo observado. */
  missingSeconds: number;
  /** Fração de segundos preenchidos (0..1). */
  coverage: number;
  /** Leituras rejeitadas por preço/timestamp inválido. */
  invalid: number;
  level: FeedLevel;
  /** true quando o sinal não pode ser considerado executável. */
  blocking: boolean;
};

export const EMPTY_QUALITY: FeedQuality = {
  points: 0,
  spanSeconds: 0,
  ageMs: null,
  outOfOrder: 0,
  duplicates: 0,
  missingSeconds: 0,
  coverage: 0,
  invalid: 0,
  level: "empty",
  blocking: true,
};

export type Normalized = { ticks: Tick[]; quality: FeedQuality };

/**
 * Agrupa por segundo de forma determinística (a última leitura do segundo
 * vence), rejeita leituras fora de ordem e mede duplicatas, buracos e idade.
 */
export function normalizeTicks(
  raw: readonly RawTick[],
  now: number,
  windowMs: number,
  maxPoints: number,
): Normalized {
  let invalid = 0;
  let outOfOrder = 0;
  let duplicates = 0;

  const cutoff = now - windowMs;
  const bySecond = new Map<number, Tick>();
  let lastAccepted = -Infinity;

  for (const t of raw) {
    if (
      t == null ||
      !isFinite(t.time) ||
      !isFinite(t.price) ||
      t.price <= 0 ||
      t.time > now + 2_000
    ) {
      invalid += 1;
      continue;
    }
    // Fora de ordem: só é aceito se ainda for do segundo corrente da série.
    if (t.time < lastAccepted - 1_000) {
      outOfOrder += 1;
      continue;
    }
    lastAccepted = Math.max(lastAccepted, t.time);
    if (t.time < cutoff) continue;

    // Segundo determinístico relativo a `now`: a mesma leitura sempre cai na
    // mesma caixa, independentemente do offset do relógio de época.
    const second = -Math.floor((now - t.time) / 1000);
    if (bySecond.has(second)) duplicates += 1;
    bySecond.set(second, { time: t.time, price: t.price });
  }

  let entries = [...bySecond.entries()].sort((a, b) => a[0] - b[0]);
  if (entries.length > maxPoints) entries = entries.slice(entries.length - maxPoints);
  const ticks = entries.map(([, v]) => v);

  if (ticks.length === 0) {
    return { ticks, quality: { ...EMPTY_QUALITY, invalid, outOfOrder, duplicates } };
  }

  const firstSecond = entries[0]![0];
  const lastSecond = entries[entries.length - 1]![0];
  const expected = lastSecond - firstSecond + 1;
  const missingSeconds = Math.max(0, expected - ticks.length);
  const coverage = expected > 0 ? ticks.length / expected : 0;
  const ageMs = Math.max(0, now - ticks[ticks.length - 1]!.time);
  const stale = ageMs > MAX_AGE_MS;
  const degraded = coverage < MIN_COVERAGE;

  return {
    ticks,
    quality: {
      points: ticks.length,
      spanSeconds: expected,
      ageMs,
      outOfOrder,
      duplicates,
      missingSeconds,
      coverage,
      invalid,
      level: stale ? "stale" : degraded ? "degraded" : "healthy",
      blocking: stale || degraded,
    },
  };
}
